import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Clock3,
  Film,
  Info,
  ListOrdered,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Save,
  ShieldCheck,
  Square,
  VolumeX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DialogueAudioAsset,
  DialogueShotClip,
  DramaManifest,
  LipsyncAsset,
  ReviewedShotCandidate,
  VideoClip,
  deriveDialogueLines,
  getMultiLineShotPlanSourceSignature,
  resolveMultiLineShotPlanContext,
  validateSavedMultiLineShotPlanAgainstCurrent,
} from "@/lib/dramaStudio";
import type {
  CurrentMultiLineShotPlanContext,
  CurrentMultiLineShotPlanLineContext,
  DialogueLine,
  SavedMultiLineShotPlan,
  SavedMultiLineShotPlanLine,
  SavedShotPlanReviewedCloseupShot,
  SavedShotPlanSnapshot,
  SavedShotPlanShot,
} from "@/lib/dramaStudio";
import { normalizeSavedMultiLineShotPlan } from "@/lib/savedShotPlan";
import type { CoverageLineProgress } from "@/lib/sceneCoverageRunner";

export interface MultiLineShotPlanProofProps {
  manifest: DramaManifest;
  selectedSceneNumber: number | null;
  onSelectedSceneNumberChange?: (sceneNumber: number | null) => void;
  videoClips?: VideoClip[];
  audioAssets?: DialogueAudioAsset[];
  dialogueShotClips?: DialogueShotClip[];
  lipsyncAssets?: LipsyncAsset[];
  savedShotPlan?: SavedShotPlanSnapshot | null;
  shotPlanValidationError?: string | null;
  isSavingShotPlan?: boolean;
  shotPlanSaveError?: string | null;
  onSaveShotPlan?: (plan: SavedShotPlanSnapshot) => Promise<boolean>;
  onShotPlanDirtyChange?: (dirty: boolean) => void;
  coverageRunState?: {
    sceneNumber: number | null;
    status: "idle" | "running" | "complete" | "failed" | "canceled";
    progress: readonly CoverageLineProgress[];
    error?: string | null;
  };
  onRunSceneCoverage?: (sceneNumber: number) => Promise<boolean>;
  onCancelSceneCoverage?: () => void;
}

type ShotRole = "master" | "reviewed-closeup";

type MultiLineShotMedia = {
  key: string;
  role: ShotRole;
  label: string;
  videoUrl: string;
  sourceIdentity: string;
  line: DialogueLine;
  masterClip?: VideoClip;
  candidate?: ReviewedShotCandidate;
  savedDuration: number;
};

type MultiLineCard = {
  line: DialogueLine;
  masterClip: VideoClip | null;
  reviewedCandidate: ReviewedShotCandidate | null;
  shots: MultiLineShotMedia[];
};

type MultiLineFreshness = {
  isCurrent: boolean;
  reason: string;
};

type DraftEligibility = {
  canSave: boolean;
  reason: string;
  plan: SavedMultiLineShotPlan | null;
};

type MetadataMeasurementRecord = {
  videoUrl: string;
  status: "loading" | "measured" | "error";
};

type MetadataLoadFailure = {
  videoUrl: string;
  label: string;
};

const SOURCE_WINDOW_SECONDS = 5;

function isSecureHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "https:" && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

function formatScene(sceneNumber: number): string {
  return String(sceneNumber).padStart(2, "0");
}

function formatDuration(value: number | null | undefined): string {
  if (!Number.isFinite(value) || !value || value <= 0) return "Not measured";
  return `${value.toFixed(value >= 10 ? 1 : 2)}s`;
}

function normalizeCharacterId(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function shortId(value: string, maxLength = 22): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, Math.max(8, Math.floor(maxLength / 2)))}…${trimmed.slice(-7)}`;
}

function mediaToken(value: string): string {
  try {
    const parsed = new URL(value);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const lastPart = parts[parts.length - 1] || "saved-media";
    return shortId(lastPart.replace(/\.[a-z0-9]+$/i, ""), 18);
  } catch {
    return "saved-media";
  }
}

function roleLabel(role: ShotRole): string {
  return role === "master" ? "Master / wide" : "Reviewed close-up";
}

function roleShortLabel(role: ShotRole): string {
  return role === "master" ? "Master" : "Close-up";
}

function coveragePhaseLabel(phase: CoverageLineProgress["phase"]): string {
  if (phase === "closeup") return "Close-up";
  if (phase === "lipsync") return "Lip-sync";
  return "Voice";
}

function coverageStatusLabel(status: CoverageLineProgress["status"]): string {
  if (status === "reusing") return "Reusing ready coverage";
  if (status === "generating") return "Generating";
  if (status === "complete") return "Complete";
  if (status === "failed") return "Failed";
  if (status === "canceled") return "Canceled";
  return "Pending";
}

function coverageRunStatusLabel(status: "idle" | "running" | "complete" | "failed" | "canceled"): string {
  if (status === "running") return "Running";
  if (status === "complete") return "Complete";
  if (status === "failed") return "Failed";
  if (status === "canceled") return "Canceled";
  return "Ready";
}

function coverageStatusTone(status: CoverageLineProgress["status"]): string {
  if (status === "complete") return "border-emerald-500/25 bg-emerald-500/10 text-emerald-200";
  if (status === "failed") return "border-red-500/30 bg-red-500/10 text-red-200";
  if (status === "canceled") return "border-slate-500/30 bg-slate-500/10 text-slate-200";
  if (status === "generating") return "border-amber-500/30 bg-amber-500/10 text-amber-100";
  if (status === "reusing") return "border-sky-500/30 bg-sky-500/10 text-sky-100";
  return "border-[#35425d] bg-[#151e2e] text-gray-300";
}

function coverageSpeakerLabel(line: DialogueLine | undefined, progress: CoverageLineProgress): string {
  return progress.speaker?.trim() || progress.characterId?.trim() || line?.character_id?.trim() || "Speaker";
}

function planIdentity(plan: SavedMultiLineShotPlan | null, rawPlan: unknown): string {
  if (plan) {
    try {
      return `plan:${JSON.stringify(plan)}`;
    } catch {
      return `plan:${plan.updated_at}`;
    }
  }
  if (rawPlan) {
    try {
      return `invalid:${JSON.stringify(rawPlan)}`;
    } catch {
      return "invalid:stored-plan";
    }
  }
  return "none";
}

function planContentIdentity(plan: SavedMultiLineShotPlan | null): string {
  if (!plan) return "none";
  try {
    const { approved_at: _approvedAt, updated_at: _updatedAt, ...content } = plan;
    return JSON.stringify(content);
  } catch {
    return `content:${plan.scene_number}:${plan.source_signature}`;
  }
}

function savedShotKey(
  shot: SavedShotPlanShot,
  sceneNumber: number,
  lineId: string
): string {
  if (shot.role === "master") {
    return `master:${sceneNumber}:${shot.clip_prediction_id}`;
  }
  return `reviewed:${sceneNumber}:${lineId}:${shot.closeup_prediction_id}:${shot.lipsync_prediction_id}`;
}

function mediaShotKey(
  sceneNumber: number,
  lineId: string,
  role: ShotRole,
  masterClip?: VideoClip,
  candidate?: ReviewedShotCandidate
): string {
  if (role === "master" && masterClip) {
    return `master:${sceneNumber}:${masterClip.prediction_id}`;
  }
  if (role === "reviewed-closeup" && candidate) {
    return `reviewed:${sceneNumber}:${lineId}:${candidate.closeup_prediction_id}:${candidate.lipsync_prediction_id}`;
  }
  return `${role}:${sceneNumber}:${lineId}`;
}

function shotLineageToken(shot: MultiLineShotMedia): string {
  if (shot.role === "master" && shot.masterClip) {
    return JSON.stringify({
      role: shot.role,
      scene_number: shot.line ? shot.line.order : null,
      prediction_id: shot.masterClip.prediction_id,
      video_url: shot.masterClip.video_url,
      created_at: shot.masterClip.created_at,
      updated_at: shot.masterClip.updated_at,
    });
  }
  if (shot.role === "reviewed-closeup" && shot.candidate) {
    return JSON.stringify({
      role: shot.role,
      scene_number: shot.line.order,
      line_id: shot.line.line_id,
      closeup_prediction_id: shot.candidate.closeup_prediction_id,
      closeup_video_url: shot.candidate.closeup_video_url,
      lipsync_prediction_id: shot.candidate.lipsync_prediction_id,
      lipsync_video_url: shot.candidate.lipsync_video_url,
      audio_url: shot.candidate.audio_url,
      closeup_updated_at: shot.candidate.closeup_updated_at,
      lipsync_updated_at: shot.candidate.lipsync_updated_at,
      audio_updated_at: shot.candidate.audio_updated_at,
    });
  }
  return `${shot.role}:${shot.videoUrl}`;
}

function durationMeasurementKey(shot: MultiLineShotMedia): string {
  return shot.key;
}

function exactCurrentMedia(
  shot: MultiLineShotMedia,
  lineContext: CurrentMultiLineShotPlanLineContext
): boolean {
  if (
    shot.line.line_id !== lineContext.line.line_id ||
    shot.line.character_id !== lineContext.line.character_id ||
    shot.line.text !== lineContext.line.text
  ) {
    return false;
  }

  if (shot.role === "master") {
    const current = lineContext.masterClip;
    return Boolean(
      current &&
        shot.masterClip &&
        shot.masterClip.prediction_id === current.prediction_id &&
        shot.masterClip.video_url === current.video_url &&
        shot.masterClip.created_at === current.created_at &&
        shot.masterClip.updated_at === current.updated_at
    );
  }

  const current = lineContext.reviewedCandidate;
  return Boolean(
    current &&
      shot.candidate &&
      shot.candidate.closeup_prediction_id === current.closeup_prediction_id &&
      shot.candidate.closeup_video_url === current.closeup_video_url &&
      shot.candidate.closeup_created_at === current.closeup_created_at &&
      shot.candidate.closeup_updated_at === current.closeup_updated_at &&
      shot.candidate.lipsync_prediction_id === current.lipsync_prediction_id &&
      shot.candidate.lipsync_video_url === current.lipsync_video_url &&
      shot.candidate.lipsync_created_at === current.lipsync_created_at &&
      shot.candidate.lipsync_updated_at === current.lipsync_updated_at &&
      shot.candidate.audio_url === current.audio_url &&
      shot.candidate.audio_created_at === current.audio_created_at &&
      shot.candidate.audio_updated_at === current.audio_updated_at
  );
}

function buildLineMedia(
  sceneNumber: number,
  entry: CurrentMultiLineShotPlanLineContext,
  savedLine: SavedMultiLineShotPlanLine | null
): MultiLineCard {
  const savedMaster = savedLine?.shots.find((shot) => shot.role === "master");
  const savedReviewed = savedLine?.shots.find((shot) => shot.role === "reviewed-closeup");
  const shots: MultiLineShotMedia[] = [];

  if (entry.masterClip && isSecureHttpsUrl(entry.masterClip.video_url)) {
    shots.push({
      key: mediaShotKey(sceneNumber, entry.line.line_id, "master", entry.masterClip),
      role: "master",
      label: "Master / wide",
      videoUrl: entry.masterClip.video_url.trim(),
      sourceIdentity: `Scene ${formatScene(sceneNumber)} master · motion ${shortId(entry.masterClip.prediction_id)}`,
      line: entry.line,
      masterClip: entry.masterClip,
      savedDuration: savedMaster?.duration_seconds || entry.masterClip.duration_seconds || SOURCE_WINDOW_SECONDS,
    });
  }

  if (entry.reviewedCandidate && isSecureHttpsUrl(entry.reviewedCandidate.lipsync_video_url)) {
    shots.push({
      key: mediaShotKey(sceneNumber, entry.line.line_id, "reviewed-closeup", undefined, entry.reviewedCandidate),
      role: "reviewed-closeup",
      label: "Reviewed close-up",
      videoUrl: entry.reviewedCandidate.lipsync_video_url.trim(),
      sourceIdentity: `Close-up ${shortId(entry.reviewedCandidate.closeup_prediction_id)} · lip-sync ${shortId(entry.reviewedCandidate.lipsync_prediction_id)}`,
      line: entry.line,
      candidate: entry.reviewedCandidate,
      savedDuration: savedReviewed?.duration_seconds || SOURCE_WINDOW_SECONDS,
    });
  }

  return {
    line: entry.line,
    masterClip: entry.masterClip,
    reviewedCandidate: entry.reviewedCandidate,
    shots,
  };
}

function lineOrderIdentity(orders: Record<string, string[]>): string {
  try {
    return JSON.stringify(orders);
  } catch {
    return "";
  }
}

function buildSavedShot(
  shot: MultiLineShotMedia,
  duration: number
): SavedShotPlanShot | null {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 60) return null;

  if (shot.role === "master") {
    if (!shot.masterClip || !isSecureHttpsUrl(shot.masterClip.video_url)) return null;
    return {
      role: "master",
      duration_seconds: duration,
      clip_prediction_id: shot.masterClip.prediction_id,
      video_url: shot.masterClip.video_url,
      created_at: shot.masterClip.created_at,
      updated_at: shot.masterClip.updated_at,
    };
  }

  const candidate = shot.candidate;
  if (
    !candidate ||
    !isSecureHttpsUrl(candidate.closeup_video_url) ||
    !isSecureHttpsUrl(candidate.lipsync_video_url) ||
    !isSecureHttpsUrl(candidate.audio_url)
  ) {
    return null;
  }

  const reviewed: SavedShotPlanReviewedCloseupShot = {
    role: "reviewed-closeup",
    duration_seconds: duration,
    closeup_prediction_id: candidate.closeup_prediction_id,
    closeup_video_url: candidate.closeup_video_url,
    closeup_created_at: candidate.closeup_created_at,
    closeup_updated_at: candidate.closeup_updated_at,
    lipsync_prediction_id: candidate.lipsync_prediction_id,
    lipsync_video_url: candidate.lipsync_video_url,
    lipsync_created_at: candidate.lipsync_created_at,
    lipsync_updated_at: candidate.lipsync_updated_at,
    audio_url: candidate.audio_url,
    audio_created_at: candidate.audio_created_at,
    audio_updated_at: candidate.audio_updated_at,
  };
  return reviewed;
}

function normalizeLineOrders(
  cards: MultiLineCard[],
  current: Record<string, string[]>
): Record<string, string[]> {
  const next: Record<string, string[]> = {};
  cards.forEach((card) => {
    const availableKeys = card.shots.map((shot) => shot.key);
    const currentKeys = Array.isArray(current[card.line.line_id]) ? current[card.line.line_id] : [];
    const ordered = currentKeys.filter((key) => availableKeys.includes(key));
    availableKeys.forEach((key) => {
      if (!ordered.includes(key)) ordered.push(key);
    });
    next[card.line.line_id] = ordered;
  });
  return next;
}

function sameLineOrders(left: Record<string, string[]>, right: Record<string, string[]>): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(
    (key) =>
      Array.isArray(right[key]) &&
      left[key].length === right[key].length &&
      left[key].every((value, index) => value === right[key][index])
  );
}

export const MultiLineShotPlanProof: React.FC<MultiLineShotPlanProofProps> = ({
  manifest,
  selectedSceneNumber,
  onSelectedSceneNumberChange,
  videoClips = [],
  audioAssets = [],
  dialogueShotClips = [],
  lipsyncAssets = [],
  savedShotPlan,
  shotPlanValidationError = null,
  isSavingShotPlan = false,
  shotPlanSaveError = null,
  onSaveShotPlan,
  onShotPlanDirtyChange,
  coverageRunState,
  onRunSceneCoverage,
  onCancelSceneCoverage,
}) => {
  const sceneEntries = useMemo(() => {
    const scenes = Array.isArray(manifest?.scenes) ? manifest.scenes : [];
    return [...scenes]
      .sort((left, right) => left.scene_number - right.scene_number)
      .map((scene) => ({
        sceneNumber: scene.scene_number,
        lines: deriveDialogueLines(scene),
      }));
  }, [manifest]);

  const safeVideoClips = useMemo(() => (Array.isArray(videoClips) ? videoClips : []), [videoClips]);
  const safeAudioAssets = useMemo(() => (Array.isArray(audioAssets) ? audioAssets : []), [audioAssets]);
  const safeDialogueShotClips = useMemo(
    () => (Array.isArray(dialogueShotClips) ? dialogueShotClips : []),
    [dialogueShotClips]
  );
  const safeLipsyncAssets = useMemo(
    () => (Array.isArray(lipsyncAssets) ? lipsyncAssets : []),
    [lipsyncAssets]
  );

  const rawV2Plan = useMemo(() => {
    if (!savedShotPlan) return null;
    const version = (savedShotPlan as unknown as { version?: unknown }).version;
    return version === 2 ? savedShotPlan : null;
  }, [savedShotPlan]);
  const rawStoredPlan = rawV2Plan;
  const storedPlan = useMemo(
    () => (rawStoredPlan ? normalizeSavedMultiLineShotPlan(rawStoredPlan) : null),
    [rawStoredPlan]
  );
  const storedPlanIdentity = useMemo(
    () => planIdentity(storedPlan, rawStoredPlan),
    [rawStoredPlan, storedPlan]
  );
  const [lineOrders, setLineOrders] = useState<Record<string, string[]>>({});
  const [measuredDurations, setMeasuredDurations] = useState<Record<string, number>>({});
  const [metadataLoadErrors, setMetadataLoadErrors] = useState<Record<string, MetadataLoadFailure>>({});
  const [metadataMeasurementRevision, setMetadataMeasurementRevision] = useState(0);
  const [hasUserEdited, setHasUserEdited] = useState(false);
  const [stalePlanDismissedIdentity, setStalePlanDismissedIdentity] = useState<string | null>(null);
  const [isSaveRequestActive, setIsSaveRequestActive] = useState(false);
  const [internalSaveError, setInternalSaveError] = useState<string | null>(null);
  const [currentShotIndex, setCurrentShotIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [playbackNotice, setPlaybackNotice] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const isPlayingRef = useRef(false);
  const continueAfterSourceChangeRef = useRef(false);
  const previewRunRef = useRef(0);
  const hydrationRef = useRef({ identity: "", applied: false });
  const metadataMeasurementRegistryRef = useRef<Map<string, MetadataMeasurementRecord>>(new Map());
  const activeMeasurementSourcesRef = useRef<Map<string, string>>(new Map());
  const draftPlanClockRef = useRef({ identity: "", timestamp: "" });
  const saveInFlightRef = useRef(false);
  const autoSaveAttemptedIdentityRef = useRef<string | null>(null);
  const autoSaveFailedIdentityRef = useRef<string | null>(null);
  const autoSaveDraftIdentityRef = useRef<string | null>(null);
  const lastReportedDirtyRef = useRef<boolean | null>(null);
  const lastDirtyCallbackRef = useRef<MultiLineShotPlanProofProps["onShotPlanDirtyChange"]>(undefined);

  const selectedSceneEntry = useMemo(
    () => sceneEntries.find((entry) => entry.sceneNumber === selectedSceneNumber) || null,
    [sceneEntries, selectedSceneNumber]
  );

  const selectedCoverageRunState = useMemo(() => {
    if (!coverageRunState) return null;
    if (
      coverageRunState.sceneNumber !== null &&
      coverageRunState.sceneNumber !== selectedSceneNumber
    ) {
      return null;
    }
    return coverageRunState;
  }, [coverageRunState, selectedSceneNumber]);

  const coverageProgressRows = useMemo(() => {
    if (!selectedSceneEntry) return [];
    const progressByLineId = new Map(
      (selectedCoverageRunState?.progress || []).map((entry) => [entry.lineId, entry] as const)
    );

    return selectedSceneEntry.lines.map((line) => {
      const existing = progressByLineId.get(line.line_id);
      const fallback: CoverageLineProgress = {
        sceneNumber: selectedSceneNumber ?? selectedSceneEntry.sceneNumber,
        lineId: line.line_id,
        order: line.order,
        characterId: line.character_id,
        phase: "voice",
        status: "pending",
      };
      return { line, progress: existing || fallback };
    });
  }, [selectedCoverageRunState, selectedSceneEntry, selectedSceneNumber]);

  const coverageRunIsActive = coverageRunState?.status === "running";
  const coverageRunIsActiveForSelection = selectedCoverageRunState?.status === "running";
  const coverageRunIsRunningElsewhere = coverageRunIsActive && !coverageRunIsActiveForSelection;
  const coverageRunStatus = selectedCoverageRunState?.status || (coverageRunIsActive ? "running" : "idle");
  const coverageCompletedCount = coverageProgressRows.filter(
    ({ progress }) => progress.status === "complete"
  ).length;
  const firstCoverageFailure = selectedCoverageRunState?.progress.find(
    (progress) => progress.status === "failed"
  ) || null;
  const activeCoverageProgress = coverageProgressRows.find(
    ({ progress }) => progress.status === "generating" || progress.status === "reusing"
  ) || coverageProgressRows.find(({ progress }) => progress.status === "pending") || null;
  const coverageRunError = firstCoverageFailure?.error || selectedCoverageRunState?.error || null;
  const canRunCoverage = Boolean(onRunSceneCoverage && selectedSceneNumber !== null && !coverageRunIsActive);
  const coverageStatusMessage = coverageRunStatus === "running"
    ? coverageRunIsRunningElsewhere
      ? coverageRunState && coverageRunState.sceneNumber !== null
        ? `Scene ${formatScene(coverageRunState.sceneNumber)} is currently running. Wait for it to finish before starting this scene.`
        : "Another scene is currently running. Wait for it to finish before starting this scene."
      : activeCoverageProgress
        ? `Line ${activeCoverageProgress.line.order} is in ${coveragePhaseLabel(activeCoverageProgress.progress.phase).toLowerCase()} coverage.`
        : "Working through the selected scene in screenplay order."
    : coverageRunStatus === "complete"
      ? "Coverage is complete. Automatic timing measurement and shot-plan saving still determine approval below."
      : coverageRunStatus === "failed"
        ? "The run stopped at the first failed line. Ready coverage from earlier lines remains available for retry."
        : coverageRunStatus === "canceled"
          ? "The run was stopped. Completed line progress remains visible, and you can run this scene again."
          : "Ready to process each canonical line in screenplay order. Ready assets will be reused before anything new is generated.";

  const currentContext = useMemo<CurrentMultiLineShotPlanContext | null>(
    () =>
      selectedSceneNumber === null
        ? null
        : resolveMultiLineShotPlanContext({
            manifest,
            scene_number: selectedSceneNumber,
            video_clips: safeVideoClips,
            dialogue_shot_clips: safeDialogueShotClips,
            lipsync_assets: safeLipsyncAssets,
            audio_assets: safeAudioAssets,
          }),
    [
      manifest,
      safeAudioAssets,
      safeDialogueShotClips,
      safeLipsyncAssets,
      safeVideoClips,
      selectedSceneNumber,
    ]
  );

  const savedPlanFreshness = useMemo<MultiLineFreshness>(() => {
    if (!rawStoredPlan) {
      return { isCurrent: false, reason: "No saved multi-line approval is attached to this project yet." };
    }
    if (!storedPlan) {
      return {
        isCurrent: false,
        reason: "The stored multi-line approval failed structural validation and stays unavailable for playback.",
      };
    }
    const validation = validateSavedMultiLineShotPlanAgainstCurrent({
      plan: storedPlan,
      manifest,
      video_clips: safeVideoClips,
      dialogue_shot_clips: safeDialogueShotClips,
      lipsync_assets: safeLipsyncAssets,
      audio_assets: safeAudioAssets,
    });
    return {
      isCurrent: validation.valid,
      reason: validation.valid
        ? "The saved order matches the current canonical lines and exact media lineage."
        : validation.error || "The saved multi-line approval no longer matches current media.",
    };
  }, [
    audioAssets,
    manifest,
    rawStoredPlan,
    safeAudioAssets,
    safeDialogueShotClips,
    safeLipsyncAssets,
    safeVideoClips,
    storedPlan,
  ]);

  const hasStaleStoredPlan = Boolean(rawStoredPlan && !savedPlanFreshness.isCurrent);
  const savedPlanWasDismissed = Boolean(
    hasStaleStoredPlan && stalePlanDismissedIdentity === storedPlanIdentity
  );
  const isStalePreviewBlocked = Boolean(hasStaleStoredPlan && !savedPlanWasDismissed);
  const savedPlanMatchesSelection = Boolean(
    storedPlan &&
      savedPlanFreshness.isCurrent &&
      selectedSceneNumber === storedPlan.scene_number
  );

  useEffect(() => {
    if (hydrationRef.current.identity === storedPlanIdentity) return;
    hydrationRef.current = { identity: storedPlanIdentity, applied: false };
    setHasUserEdited(false);
    setMeasuredDurations({});
    setInternalSaveError(null);
  }, [storedPlanIdentity]);

  useEffect(() => {
    autoSaveDraftIdentityRef.current = null;
    autoSaveAttemptedIdentityRef.current = null;
    autoSaveFailedIdentityRef.current = null;
  }, [storedPlanIdentity]);

  useEffect(() => {
    if (selectedSceneNumber !== null && sceneEntries.some((entry) => entry.sceneNumber === selectedSceneNumber)) return;
    const fallback = sceneEntries.find((entry) => entry.lines.length >= 2 && entry.lines.length <= 3) || sceneEntries[0];
    onSelectedSceneNumberChange?.(fallback?.sceneNumber ?? null);
  }, [onSelectedSceneNumberChange, sceneEntries, selectedSceneNumber]);

  const savedLinesById = useMemo(() => {
    const map = new Map<string, SavedMultiLineShotPlanLine>();
    if (savedPlanMatchesSelection && storedPlan) {
      storedPlan.lines.forEach((line) => map.set(line.line_id, line));
    }
    return map;
  }, [savedPlanMatchesSelection, storedPlan]);

  const baseLineCards = useMemo<MultiLineCard[]>(() => {
    if (!currentContext) return [];
    return currentContext.lines.map((entry) =>
      buildLineMedia(currentContext.scene.scene_number, entry, savedLinesById.get(entry.line.line_id) || null)
    );
  }, [currentContext, savedLinesById]);

  useEffect(() => {
    if (isStalePreviewBlocked) {
      setLineOrders((current) => (Object.keys(current).length ? {} : current));
      return;
    }

    if (
      savedPlanMatchesSelection &&
      storedPlan &&
      !hasUserEdited &&
      !hydrationRef.current.applied
    ) {
      const desired: Record<string, string[]> = {};
      const savedDurations: Record<string, number> = {};
      let complete = true;
      storedPlan.lines.forEach((line) => {
        const keys = line.shots.map((shot) => savedShotKey(shot, storedPlan.scene_number, line.line_id));
        const card = baseLineCards.find((candidate) => candidate.line.line_id === line.line_id);
        if (!card || !keys.every((key) => card.shots.some((shot) => shot.key === key))) {
          complete = false;
          return;
        }
        desired[line.line_id] = keys;
        line.shots.forEach((shot, index) => {
          const key = keys[index];
          if (key && Number.isFinite(shot.duration_seconds) && shot.duration_seconds > 0) {
            savedDurations[key] = shot.duration_seconds;
          }
        });
      });
      if (complete && Object.keys(desired).length === baseLineCards.length) {
        setLineOrders((current) => (sameLineOrders(current, desired) ? current : desired));
        setMeasuredDurations(savedDurations);
        hydrationRef.current.applied = true;
        return;
      }
    }

    setLineOrders((current) => {
      const next = normalizeLineOrders(baseLineCards, current);
      return sameLineOrders(current, next) ? current : next;
    });
  }, [
    baseLineCards,
    hasUserEdited,
    isStalePreviewBlocked,
    savedPlanMatchesSelection,
    storedPlan,
  ]);

  const playableLineCards = isStalePreviewBlocked ? [] : baseLineCards;
  const orderedShots = useMemo(() => {
    const shots: MultiLineShotMedia[] = [];
    playableLineCards.forEach((card) => {
      const byKey = new Map(card.shots.map((shot) => [shot.key, shot]));
      const order = lineOrders[card.line.line_id] || [];
      order.forEach((key) => {
        const shot = byKey.get(key);
        if (shot) shots.push(shot);
      });
    });
    return shots;
  }, [lineOrders, playableLineCards]);

  const uniqueShots = useMemo(() => {
    const seen = new Set<string>();
    return orderedShots.filter((shot) => {
      if (seen.has(shot.key)) return false;
      seen.add(shot.key);
      return true;
    });
  }, [orderedShots]);

  const uniqueShotMeasurementEntries = useMemo(
    () =>
      uniqueShots
        .map((shot) => ({
          measurementKey: durationMeasurementKey(shot),
          videoUrl: shot.videoUrl.trim(),
          label: `${roleShortLabel(shot.role)} on line ${shot.line.order}`,
        }))
        .filter((entry) => isSecureHttpsUrl(entry.videoUrl)),
    [uniqueShots]
  );
  const uniqueShotMeasurementIdentity = useMemo(
    () => JSON.stringify(uniqueShotMeasurementEntries.map((entry) => [entry.measurementKey, entry.videoUrl])),
    [uniqueShotMeasurementEntries]
  );

  const currentShot = orderedShots[currentShotIndex] || null;
  const orderIdentity = useMemo(
    () => orderedShots.map((shot) => `${shot.key}:${shotLineageToken(shot)}`).join("|"),
    [orderedShots]
  );
  const previewContextKey = `${selectedSceneNumber ?? "none"}:${lineOrderIdentity(lineOrders)}:${orderIdentity}`;

  useEffect(() => {
    const runId = previewRunRef.current + 1;
    previewRunRef.current = runId;
    continueAfterSourceChangeRef.current = false;
    isPlayingRef.current = false;
    videoRef.current?.pause();
    try {
      if (videoRef.current) videoRef.current.currentTime = 0;
    } catch {
      // Browsers can reject a seek while the next source is loading.
    }
    setCurrentShotIndex(0);
    setIsPlaying(false);
    setPlaybackError(null);
    setPlaybackNotice(null);
    return () => {
      if (previewRunRef.current !== runId) return;
      continueAfterSourceChangeRef.current = false;
      isPlayingRef.current = false;
      videoRef.current?.pause();
    };
  }, [previewContextKey]);

  const registerVideoDuration = useCallback(
    (measurementKey: string, duration: number, videoUrl?: string) => {
      if (!measurementKey || !Number.isFinite(duration) || duration <= 0 || duration > 3600) return;

      const normalizedUrl = typeof videoUrl === "string" ? videoUrl.trim() : null;
      if (normalizedUrl !== null && !isSecureHttpsUrl(normalizedUrl)) return;

      const activeUrl = activeMeasurementSourcesRef.current.get(measurementKey);
      if (normalizedUrl !== null && activeUrl !== normalizedUrl) return;
      if (!activeUrl) return;

      const registry = metadataMeasurementRegistryRef.current;
      const existing = registry.get(measurementKey);
      const resolvedUrl = normalizedUrl || activeUrl;
      if (resolvedUrl !== activeUrl || (existing && existing.videoUrl !== resolvedUrl)) return;

      registry.set(measurementKey, { videoUrl: resolvedUrl, status: "measured" });
      setMetadataLoadErrors((current) => {
        if (!current[measurementKey]) return current;
        const next = { ...current };
        delete next[measurementKey];
        return next;
      });
      setMeasuredDurations((current) => {
        if (Math.abs((current[measurementKey] || 0) - duration) < 0.01) return current;
        return { ...current, [measurementKey]: duration };
      });
    },
    []
  );

  const markMetadataLoadError = useCallback((measurementKey: string, videoUrl: string, label: string) => {
    const normalizedUrl = videoUrl.trim();
    if (!isSecureHttpsUrl(normalizedUrl)) return;
    if (activeMeasurementSourcesRef.current.get(measurementKey) !== normalizedUrl) return;

    const record = metadataMeasurementRegistryRef.current.get(measurementKey);
    if (!record || record.videoUrl !== normalizedUrl) return;
    record.status = "error";
    setMeasuredDurations((current) => {
      if (!(measurementKey in current)) return current;
      const next = { ...current };
      delete next[measurementKey];
      return next;
    });
    setMetadataLoadErrors((current) => {
      const previous = current[measurementKey];
      if (previous?.videoUrl === normalizedUrl && previous.label === label) return current;
      return { ...current, [measurementKey]: { videoUrl: normalizedUrl, label } };
    });
  }, []);

  useEffect(() => {
    const activeSources = new Map(
      uniqueShotMeasurementEntries.map((entry) => [entry.measurementKey, entry.videoUrl])
    );
    activeMeasurementSourcesRef.current = activeSources;

    const registry = metadataMeasurementRegistryRef.current;
    registry.forEach((record, measurementKey) => {
      const activeUrl = activeSources.get(measurementKey);
      if (!activeUrl || activeUrl !== record.videoUrl) registry.delete(measurementKey);
    });
    activeSources.forEach((videoUrl, measurementKey) => {
      const existing = registry.get(measurementKey);
      if (!existing || existing.videoUrl !== videoUrl) {
        registry.set(measurementKey, { videoUrl, status: "loading" });
      }
    });

    setMeasuredDurations((current) => {
      let changed = false;
      const next = { ...current };
      Object.keys(next).forEach((measurementKey) => {
        const activeUrl = activeSources.get(measurementKey);
        const record = registry.get(measurementKey);
        if (!activeUrl || !record || record.videoUrl !== activeUrl || record.status === "error") {
          delete next[measurementKey];
          changed = true;
        }
      });
      return changed ? next : current;
    });
    setMetadataLoadErrors((current) => {
      let changed = false;
      const next = { ...current };
      Object.entries(current).forEach(([measurementKey, failure]) => {
        if (activeSources.get(measurementKey) !== failure.videoUrl) {
          delete next[measurementKey];
          changed = true;
        }
      });
      return changed ? next : current;
    });
    setMetadataMeasurementRevision((current) => current + 1);
  }, [uniqueShotMeasurementEntries, uniqueShotMeasurementIdentity]);

  const handleMetadataLoaderLoaded = useCallback(
    (
      measurementKey: string,
      videoUrl: string,
      event: React.SyntheticEvent<HTMLVideoElement>
    ) => {
      registerVideoDuration(measurementKey, event.currentTarget.duration, videoUrl);
    },
    [registerVideoDuration]
  );

  const handleMetadataLoaderError = useCallback(
    (measurementKey: string, videoUrl: string, label: string) => {
      markMetadataLoadError(measurementKey, videoUrl, label);
    },
    [markMetadataLoadError]
  );

  const handleVideoMetadata = (event: React.SyntheticEvent<HTMLVideoElement>) => {
    if (!currentShot) return;
    registerVideoDuration(
      durationMeasurementKey(currentShot),
      event.currentTarget.duration,
      currentShot.videoUrl
    );
  };

  const stopPreview = useCallback((notice: string | null = null, resetToStart = false) => {
    continueAfterSourceChangeRef.current = false;
    isPlayingRef.current = false;
    videoRef.current?.pause();
    if (resetToStart) {
      try {
        if (videoRef.current) videoRef.current.currentTime = 0;
      } catch {
        // Browsers can reject a seek before metadata is available.
      }
    }
    setIsPlaying(false);
    setPlaybackError(null);
    if (resetToStart) setCurrentShotIndex(0);
    setPlaybackNotice(notice);
  }, []);

  const handlePlay = async () => {
    if (!currentShot || isPlayingRef.current || !videoRef.current) return;
    const runId = previewRunRef.current;
    setPlaybackError(null);
    setPlaybackNotice(null);
    if (videoRef.current.ended) {
      try {
        videoRef.current.currentTime = 0;
      } catch {
        // Browsers can reject a seek before metadata is available.
      }
    }
    isPlayingRef.current = true;
    setIsPlaying(true);
    try {
      await videoRef.current.play();
    } catch {
      if (previewRunRef.current !== runId || !isPlayingRef.current) return;
      isPlayingRef.current = false;
      setIsPlaying(false);
      setPlaybackError(`The current ${roleLabel(currentShot.role).toLowerCase()} could not play in this browser. The proof stopped without substituting another clip.`);
    }
  };

  const handlePause = () => {
    continueAfterSourceChangeRef.current = false;
    isPlayingRef.current = false;
    videoRef.current?.pause();
    setIsPlaying(false);
    setPlaybackNotice("Paused. Press Play to continue this local multi-line proof.");
  };

  const handleRestart = () => stopPreview("Restarted at line 1. Press Play when ready.", true);
  const handleStop = () => stopPreview("Stopped. The multi-line proof is ready to play again.", true);

  const handleCanPlay = () => {
    if (!continueAfterSourceChangeRef.current || !isPlayingRef.current || !videoRef.current) return;
    continueAfterSourceChangeRef.current = false;
    const runId = previewRunRef.current;
    void videoRef.current.play().catch(() => {
      if (previewRunRef.current !== runId || !isPlayingRef.current) return;
      isPlayingRef.current = false;
      setIsPlaying(false);
      setPlaybackError("The next hard-cut shot could not continue in this browser. The proof stopped without substituting another clip.");
    });
  };

  const handleVideoEnded = () => {
    if (!isPlayingRef.current) return;
    if (currentShotIndex < orderedShots.length - 1) {
      continueAfterSourceChangeRef.current = true;
      const nextShot = orderedShots[currentShotIndex + 1];
      setCurrentShotIndex((current) => current + 1);
      setPlaybackNotice(`Hard cut to ${roleLabel(nextShot.role)} on line ${nextShot.line.order}. The screenplay line order stays fixed.`);
      return;
    }
    continueAfterSourceChangeRef.current = false;
    isPlayingRef.current = false;
    setIsPlaying(false);
    setPlaybackNotice("Multi-line shot-plan proof complete. Nothing was added to the final assembly or project timeline.");
  };

  const handleVideoError = () => {
    continueAfterSourceChangeRef.current = false;
    isPlayingRef.current = false;
    setIsPlaying(false);
    if (currentShot) {
      markMetadataLoadError(
        durationMeasurementKey(currentShot),
        currentShot.videoUrl,
        `${roleShortLabel(currentShot.role)} on line ${currentShot.line.order}`
      );
    }
    setPlaybackError(`The current ${currentShot ? roleLabel(currentShot.role).toLowerCase() : "shot"} could not load in this browser. The proof stopped and kept its exact media boundary.`);
    setPlaybackNotice(null);
  };

  const getMeasuredDuration = (shot: MultiLineShotMedia): number | null => {
    const measurementKey = durationMeasurementKey(shot);
    const activeUrl = activeMeasurementSourcesRef.current.get(measurementKey);
    const record = metadataMeasurementRegistryRef.current.get(measurementKey);
    const currentUrl = shot.videoUrl.trim();
    if (activeUrl !== currentUrl || record?.videoUrl !== currentUrl || record.status === "error") return null;
    const measured = measuredDurations[measurementKey];
    return Number.isFinite(measured) && measured > 0 ? measured : null;
  };

  const currentLineContextById = useMemo(() => {
    const map = new Map<string, CurrentMultiLineShotPlanLineContext>();
    currentContext?.lines.forEach((entry) => map.set(entry.line.line_id, entry));
    return map;
  }, [currentContext]);

  const lineReadiness = useMemo(() => {
    const results = playableLineCards.map((card) => {
      const order = lineOrders[card.line.line_id] || [];
      const ordered = order
        .map((key) => card.shots.find((shot) => shot.key === key))
        .filter((shot): shot is MultiLineShotMedia => Boolean(shot));
      const rolesAreExact = ordered.length === 2 &&
        ordered.filter((shot) => shot.role === "master").length === 1 &&
        ordered.filter((shot) => shot.role === "reviewed-closeup").length === 1;
      const context = currentLineContextById.get(card.line.line_id);
      const exact = Boolean(context && rolesAreExact && ordered.every((shot) => exactCurrentMedia(shot, context)));
      return { card, ordered, rolesAreExact, exact };
    });
    return results;
  }, [currentLineContextById, lineOrders, playableLineCards]);

  const allLineageExact = lineReadiness.length >= 2 && lineReadiness.length <= 3 &&
    lineReadiness.every((line) => line.rolesAreExact && line.exact);
  const missingMeasuredShots = useMemo(
    () => uniqueShots.filter((shot) => getMeasuredDuration(shot) === null),
    [metadataMeasurementRevision, measuredDurations, uniqueShots]
  );
  const allDurationsMeasured = uniqueShots.length > 0 && missingMeasuredShots.length === 0;
  const currentDraftIsValid = allLineageExact && allDurationsMeasured;

  const draftPlan = useMemo<SavedMultiLineShotPlan | null>(() => {
    if (!currentContext || currentContext.lines.length < 2 || currentContext.lines.length > 3) return null;
    if (!allLineageExact || !allDurationsMeasured) return null;
    const sourceSignature = getMultiLineShotPlanSourceSignature(manifest, currentContext);
    if (!sourceSignature) return null;

    const lines: SavedMultiLineShotPlanLine[] = [];
    for (const lineResult of lineReadiness) {
      const shotRecords: SavedShotPlanShot[] = [];
      for (const shot of lineResult.ordered) {
        const duration = getMeasuredDuration(shot);
        const record = buildSavedShot(shot, duration || 0);
        if (!record) return null;
        shotRecords.push(record);
      }
      if (shotRecords.length !== 2) return null;
      const lineDuration = shotRecords.reduce((sum, shot) => sum + shot.duration_seconds, 0);
      lines.push({
        line_id: lineResult.card.line.line_id,
        character_id: lineResult.card.line.character_id,
        text: lineResult.card.line.text,
        order: lineResult.card.line.order,
        shots: [shotRecords[0], shotRecords[1]],
        total_duration_seconds: lineDuration,
      });
    }

    const totalDuration = lines.reduce((sum, line) => sum + line.total_duration_seconds, 0);
    const draftShape = {
      version: 2 as const,
      mode: "multi_line_hard_cut" as const,
      status: "APPROVED" as const,
      scene_number: currentContext.scene.scene_number,
      source_signature: sourceSignature,
      lines,
      total_duration_seconds: totalDuration,
    };
    const draftContentKey = JSON.stringify(draftShape);
    const now = draftPlanClockRef.current.identity === draftContentKey && draftPlanClockRef.current.timestamp
      ? draftPlanClockRef.current.timestamp
      : new Date().toISOString();
    draftPlanClockRef.current = { identity: draftContentKey, timestamp: now };
    return normalizeSavedMultiLineShotPlan({
      ...draftShape,
      approved_at: now,
      updated_at: now,
    });
  }, [allDurationsMeasured, allLineageExact, currentContext, lineReadiness, manifest, measuredDurations]);

  const draftMatchesSavedPlan = useMemo(() => {
    if (!savedPlanMatchesSelection || !storedPlan || !draftPlan || !currentDraftIsValid) return false;
    return planContentIdentity(storedPlan) === planContentIdentity(draftPlan);
  }, [currentDraftIsValid, draftPlan, savedPlanMatchesSelection, storedPlan]);

  const draftPlanIdentity = useMemo(() => planIdentity(draftPlan, null), [draftPlan]);

  const effectiveIsSaving = Boolean(isSavingShotPlan || isSaveRequestActive);
  const draftSaveEligibility = useMemo<DraftEligibility>(() => {
    if (effectiveIsSaving) {
      return { canSave: false, reason: "Saving the approved multi-line snapshot…", plan: draftPlan };
    }
    if (isPlaying) {
      return { canSave: false, reason: "Stop the local preview before saving the approved line-by-line order.", plan: draftPlan };
    }
    if (isStalePreviewBlocked) {
      return { canSave: false, reason: "Start a new draft from current media before saving a multi-line order.", plan: null };
    }
    if (!onSaveShotPlan) {
      return { canSave: false, reason: "The project save bridge is not connected in this proof yet.", plan: draftPlan };
    }
    if (!currentContext || currentContext.lines.length < 2 || currentContext.lines.length > 3) {
      return { canSave: false, reason: "Choose a scene with two or three canonical dialogue lines for this proof.", plan: null };
    }
    if (!allLineageExact) {
      return { canSave: false, reason: "Every canonical line needs one current strict master and one exact reviewed close-up.", plan: null };
    }
    if (!allDurationsMeasured) {
      const missing = missingMeasuredShots.map((shot) => `${roleShortLabel(shot.role)} on line ${shot.line.order}`).join(", ");
      return {
        canSave: false,
        reason: `Automatic measurement is still pending for ${missing || "all shots"}. Keep this proof open while the browser reads each exact MP4; Play remains available as a manual retry.`,
        plan: null,
      };
    }
    if (!draftPlan) {
      return { canSave: false, reason: "The current line order could not be normalized into an approved multi-line snapshot.", plan: null };
    }
    return {
      canSave: true,
      reason: "Every line has exact current coverage and every unique MP4 has a browser-measured duration.",
      plan: draftPlan,
    };
  }, [
    allDurationsMeasured,
    allLineageExact,
    currentContext,
    draftPlan,
    effectiveIsSaving,
    isPlaying,
    isStalePreviewBlocked,
    missingMeasuredShots,
    onSaveShotPlan,
  ]);

  const currentDirty = Boolean(
    !draftMatchesSavedPlan &&
      ((hasUserEdited && (currentDraftIsValid || savedPlanWasDismissed)) ||
        (!savedPlanMatchesSelection && currentDraftIsValid))
  );

  useEffect(() => {
    if (
      lastReportedDirtyRef.current === currentDirty &&
      lastDirtyCallbackRef.current === onShotPlanDirtyChange
    ) {
      return;
    }
    lastReportedDirtyRef.current = currentDirty;
    lastDirtyCallbackRef.current = onShotPlanDirtyChange;
    onShotPlanDirtyChange?.(currentDirty);
  }, [currentDirty, onShotPlanDirtyChange]);

  const handleSceneChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const nextSceneNumber = Number(event.target.value);
    if (!Number.isInteger(nextSceneNumber)) return;
    onSelectedSceneNumberChange?.(nextSceneNumber);
    setInternalSaveError(null);
    setPlaybackError(null);
    setPlaybackNotice("Selected a different scene. Line order remains fixed to that scene's screenplay.");
  };

  const handleRunSceneCoverage = useCallback(() => {
    if (coverageRunIsActive || !onRunSceneCoverage || selectedSceneNumber === null) return;
    void onRunSceneCoverage(selectedSceneNumber).catch(() => undefined);
  }, [coverageRunIsActive, onRunSceneCoverage, selectedSceneNumber]);

  const handleCancelSceneCoverage = useCallback(() => {
    if (!coverageRunIsActive || !onCancelSceneCoverage) return;
    onCancelSceneCoverage();
  }, [coverageRunIsActive, onCancelSceneCoverage]);

  const moveShot = (lineId: string, index: number, direction: -1 | 1) => {
    if (isPlaying) return;
    const current = lineOrders[lineId] || [];
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= current.length) return;
    const nextOrder = [...current];
    [nextOrder[index], nextOrder[targetIndex]] = [nextOrder[targetIndex], nextOrder[index]];
    setLineOrders((orders) => ({ ...orders, [lineId]: nextOrder }));
    setHasUserEdited(true);
    setInternalSaveError(null);
  };

  const startNewDraftFromCurrentMedia = () => {
    if (!rawStoredPlan || !hasStaleStoredPlan) return;
    setStalePlanDismissedIdentity(storedPlanIdentity);
    hydrationRef.current = { identity: storedPlanIdentity, applied: true };
    setHasUserEdited(true);
    setLineOrders({});
    setMeasuredDurations({});
    setInternalSaveError(null);
    setPlaybackError(null);
    setPlaybackNotice("Started a new local multi-line draft from current media. The stale approval remains unchanged.");
  };

  const persistShotPlan = useCallback(
    async (plan: SavedMultiLineShotPlan): Promise<boolean | null> => {
      if (!onSaveShotPlan || isSavingShotPlan || saveInFlightRef.current) return null;
      saveInFlightRef.current = true;
      setInternalSaveError(null);
      setIsSaveRequestActive(true);
      try {
        const saved = await onSaveShotPlan(plan);
        if (!saved) {
          setInternalSaveError("The project did not confirm this save. Your local line order is still here, unchanged.");
          return false;
        }
        setHasUserEdited(false);
        hydrationRef.current = { identity: planIdentity(plan, null), applied: true };
        setPlaybackNotice("Approved multi-line shot plan saved. Media, Scene Mix, and Episode Mix were not changed.");
        return true;
      } catch (error) {
        console.error("Failed to save multi-line shot plan:", error);
        setInternalSaveError("The multi-line shot plan could not be saved. Your local order is still here, unchanged. Try again when the project is ready.");
        return false;
      } finally {
        saveInFlightRef.current = false;
        setIsSaveRequestActive(false);
      }
    },
    [isSavingShotPlan, onSaveShotPlan]
  );

  const handleSaveShotPlan = async () => {
    const plan = draftSaveEligibility.plan;
    if (!draftSaveEligibility.canSave || !plan || !onSaveShotPlan) return;
    const identity = planIdentity(plan, null);
    autoSaveDraftIdentityRef.current = identity;
    autoSaveAttemptedIdentityRef.current = identity;
    autoSaveFailedIdentityRef.current = null;
    const saved = await persistShotPlan(plan);
    if (saved === false) {
      autoSaveAttemptedIdentityRef.current = null;
      autoSaveFailedIdentityRef.current = identity;
    } else if (saved === null) {
      autoSaveAttemptedIdentityRef.current = null;
    }
  };

  useEffect(() => {
    if (autoSaveDraftIdentityRef.current === draftPlanIdentity) return;
    autoSaveDraftIdentityRef.current = draftPlanIdentity;
    autoSaveAttemptedIdentityRef.current = null;
    autoSaveFailedIdentityRef.current = null;
  }, [draftPlanIdentity]);

  useEffect(() => {
    if (
      !draftPlan ||
      draftPlan.version !== 2 ||
      !draftSaveEligibility.canSave ||
      !currentDraftIsValid ||
      draftMatchesSavedPlan ||
      isPlaying ||
      effectiveIsSaving
    ) {
      return;
    }

    const identity = draftPlanIdentity;
    if (!identity || identity === "none") return;
    if (
      autoSaveAttemptedIdentityRef.current === identity ||
      autoSaveFailedIdentityRef.current === identity
    ) {
      return;
    }

    autoSaveAttemptedIdentityRef.current = identity;
    void persistShotPlan(draftPlan).then((saved) => {
      if (saved === true) {
        autoSaveFailedIdentityRef.current = null;
        return;
      }
      if (saved === false) {
        autoSaveAttemptedIdentityRef.current = null;
        autoSaveFailedIdentityRef.current = identity;
      } else {
        autoSaveAttemptedIdentityRef.current = null;
      }
    });
  }, [
    currentDraftIsValid,
    draftMatchesSavedPlan,
    draftPlan,
    draftPlanIdentity,
    draftSaveEligibility.canSave,
    effectiveIsSaving,
    isPlaying,
    persistShotPlan,
  ]);

  const saveError = shotPlanSaveError || internalSaveError;
  const hasInvalidStoredPlan = Boolean((rawStoredPlan && !storedPlan) || shotPlanValidationError);
  const statusLabel = effectiveIsSaving
    ? "Saving…"
    : saveError
      ? "Save needs attention"
      : hasStaleStoredPlan && !savedPlanWasDismissed
        ? "Saved plan unavailable/stale"
        : hasInvalidStoredPlan
          ? "Saved plan unavailable/stale"
          : savedPlanMatchesSelection && !hasUserEdited
            ? "Saved"
            : currentDraftIsValid || hasUserEdited
              ? "Unsaved multi-line order"
              : "No saved multi-line plan";
  const statusMessage = effectiveIsSaving
    ? "The project is validating one full scene, every canonical line, and each exact media lineage. Keep this local order open until it finishes."
    : saveError
      ? saveError
      : hasStaleStoredPlan && !savedPlanWasDismissed
        ? `${savedPlanFreshness.reason} The stored snapshot remains untouched. Start a new draft to preview current media.`
        : hasInvalidStoredPlan
          ? shotPlanValidationError || "The stored multi-line approval failed structural validation and stays outside the playable order."
          : savedPlanMatchesSelection && !hasUserEdited
            ? "This approved order matches the current screenplay and exact master, close-up, lip-sync, and audio lineage for every line."
            : currentDraftIsValid
              ? "This local order is ready for explicit approval."
              : "This is a multi-line shot-plan proof, not final assembly. Save stays locked until every unique shot is measured and every line has exact current coverage.";
  const statusTone = statusLabel === "Saved"
    ? "border-emerald-500/25 bg-emerald-950/15"
    : statusLabel === "Saved plan unavailable/stale"
      ? "border-amber-500/35 bg-amber-950/20"
      : statusLabel === "Saving…"
        ? "border-sky-500/25 bg-sky-950/15"
        : statusLabel === "Save needs attention"
          ? "border-red-500/30 bg-red-950/20"
          : "border-[#2d3a54] bg-[#0d131e]";
  const metadataFailureLabels = missingMeasuredShots
    .map((shot) => metadataLoadErrors[durationMeasurementKey(shot)]?.label)
    .filter((label): label is string => Boolean(label));
  const metadataStatusLine = metadataFailureLabels.length
    ? `Automatic measurement could not load ${metadataFailureLabels.join(", ")}. ${metadataFailureLabels.length === 1 ? "It still needs" : "They still need"} measurement.`
    : missingMeasuredShots.length > 0 && uniqueShotMeasurementEntries.length > 0
      ? "Measuring shots automatically…"
      : null;

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-2xl border border-amber-500/[0.35] bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,0.17),transparent_43%),#121926] shadow-xl shadow-black/20">
        <div className="border-b border-amber-500/20 px-4 py-5 sm:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-xs font-mono uppercase tracking-[0.18em] text-amber-300">
                <ListOrdered className="h-4 w-4" aria-hidden="true" /> Multi-line shot-plan proof
                <span className="rounded-md border border-amber-400/[0.35] bg-amber-500/[0.15] px-2 py-1 text-[10px] tracking-wider text-amber-100">
                  Local draft · media unchanged
                </span>
              </div>
              <h2 className="text-2xl font-serif font-bold tracking-tight text-white sm:text-3xl">
                Plan the scene line by line.
              </h2>
              <p className="max-w-2xl text-sm leading-relaxed text-gray-300">
                Review every current dialogue line in screenplay order. Each line carries one exact master and one reviewed close-up, while Earlier and Later only change the two-shot order inside that line. This proof does not assemble the final scene.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2 rounded-xl border border-[#33415d] bg-[#0c111b]/80 px-3 py-2.5 text-xs text-gray-300">
              <ShieldCheck className="h-4 w-4 text-emerald-300" /> No media changes
            </div>
          </div>
        </div>

        <div className="grid gap-4 px-4 py-4 sm:px-6 sm:py-5 lg:grid-cols-[minmax(0,1fr)_minmax(240px,0.7fr)]">
          <label className="block space-y-1.5 text-xs text-gray-300">
            <span className="font-mono uppercase tracking-wider text-gray-400">Selected scene</span>
            <select
              value={selectedSceneNumber ?? ""}
              onChange={handleSceneChange}
              disabled={!sceneEntries.length || coverageRunIsActive}
              className="h-11 w-full rounded-lg border border-[#33415d] bg-[#0c111b] px-3 text-sm text-gray-100 outline-none transition-colors focus:border-amber-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="" disabled>{sceneEntries.length ? "Choose a scene" : "No saved scenes"}</option>
              {sceneEntries.map((entry) => (
                <option key={entry.sceneNumber} value={entry.sceneNumber}>
                  Scene {formatScene(entry.sceneNumber)} · {entry.lines.length} canonical line{entry.lines.length === 1 ? "" : "s"}
                </option>
              ))}
            </select>
          </label>
          <div className="rounded-xl border border-[#2b3850] bg-[#0b1019] p-3.5">
            <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-gray-500">Line policy</p>
            <p className="mt-2 text-sm font-medium text-amber-100">
              {selectedSceneEntry?.lines.length === 2 || selectedSceneEntry?.lines.length === 3
                ? `${selectedSceneEntry.lines.length} lines · screenplay order locked`
                : "Two or three canonical lines required"}
            </p>
            <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
              The plan flattens line 1, then line 2, then line 3. It never interleaves or reorders screenplay lines.
            </p>
          </div>
        </div>
      </section>

      {selectedSceneEntry && selectedSceneEntry.lines.length >= 2 && selectedSceneEntry.lines.length <= 3 ? (
        <section className="rounded-2xl border border-[#293650] bg-[#0d131e] p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-amber-400">Coverage rule</p>
              <h3 className="mt-1 text-xl font-serif font-bold text-white">Two shots per canonical line</h3>
            </div>
            <span className="rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-emerald-200">
              {lineReadiness.filter((line) => line.exact).length}/{lineReadiness.length || selectedSceneEntry.lines.length} lines exact
            </span>
          </div>
          <p className="mt-2 max-w-3xl text-xs leading-relaxed text-gray-400">
            Ordinary masters stay muted. Reviewed lip-sync MP4s use their embedded audio. Linked MP3 takes prove lineage only and never become a second playback layer.
          </p>
        </section>
      ) : (
        <section className="rounded-2xl border border-amber-500/30 bg-amber-950/20 p-5 text-sm leading-relaxed text-amber-100">
          This multi-line proof needs a selected scene with two or three current canonical dialogue lines. Single-line scenes stay in the one-line proof.
        </section>
      )}

      {selectedSceneEntry && selectedSceneEntry.lines.length >= 2 && selectedSceneEntry.lines.length <= 3 && (
        <section
          className="overflow-hidden rounded-2xl border border-sky-500/30 bg-[radial-gradient(circle_at_top_right,rgba(14,165,233,0.14),transparent_46%),#0d1622] shadow-lg shadow-black/[0.14]"
          aria-labelledby="automatic-coverage-title"
        >
          <div className="border-b border-sky-500/20 px-4 py-4 sm:px-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-3xl">
                <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono uppercase tracking-[0.18em] text-sky-300">
                  <Loader2 className={`h-4 w-4 ${coverageRunIsActive ? "animate-spin" : ""}`} aria-hidden="true" />
                  Automatic scene coverage
                  <span className="rounded-md border border-sky-400/30 bg-sky-400/10 px-2 py-1 text-[10px] tracking-wider text-sky-100">
                    Scene {formatScene(selectedSceneEntry.sceneNumber)} · line order locked
                  </span>
                </div>
                <h3 id="automatic-coverage-title" className="mt-2 text-xl font-serif font-bold text-white sm:text-2xl">
                  Process every line in order.
                </h3>
                <p className="mt-1.5 text-xs leading-relaxed text-gray-300">
                  This run checks each canonical line, reuses exact ready assets, and generates only missing voice, close-up, or lip-sync coverage. Completed lines stay recorded when a later line fails.
                </p>
              </div>
              <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:min-w-[230px]">
                {coverageRunIsActive ? (
                  <Button
                    type="button"
                    onClick={handleCancelSceneCoverage}
                    disabled={!onCancelSceneCoverage}
                    aria-label="Cancel automatic scene coverage"
                    className="h-10 w-full gap-2 border border-red-400/35 bg-red-500/15 px-3 text-xs font-semibold text-red-100 hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Square className="h-3.5 w-3.5" aria-hidden="true" /> Cancel
                  </Button>
                ) : (
                  <Button
                    type="button"
                    onClick={handleRunSceneCoverage}
                    disabled={!canRunCoverage}
                    aria-label="Run this scene automatically"
                    className="h-10 w-full gap-2 bg-sky-400 px-3 text-xs font-semibold text-slate-950 hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <ListOrdered className="h-3.5 w-3.5" aria-hidden="true" /> Run this scene automatically
                  </Button>
                )}
                {coverageRunStatus === "failed" && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleRunSceneCoverage}
                    disabled={!canRunCoverage}
                    aria-label="Retry automatic scene coverage"
                    className="h-9 w-full gap-2 border-sky-400/35 bg-sky-500/10 px-3 text-[11px] font-semibold text-sky-100 hover:border-sky-300 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Retry
                  </Button>
                )}
              </div>
            </div>
          </div>

          <div className="px-4 py-4 sm:px-5">
            <div className="grid gap-2 sm:grid-cols-[auto_auto_minmax(0,1fr)] sm:items-stretch">
              <div className="rounded-xl border border-[#2b4561] bg-[#0b1420] px-3 py-2.5">
                <p className="text-[10px] font-mono uppercase tracking-wider text-gray-500">Completed lines</p>
                <p className="mt-1 text-lg font-semibold text-white">{coverageCompletedCount} <span className="text-xs font-normal text-gray-500">/ {coverageProgressRows.length}</span></p>
              </div>
              <div className="rounded-xl border border-[#2b4561] bg-[#0b1420] px-3 py-2.5">
                <p className="text-[10px] font-mono uppercase tracking-wider text-gray-500">Run status</p>
                <p className="mt-1 text-sm font-semibold text-sky-100">{coverageRunStatusLabel(coverageRunStatus)}</p>
              </div>
              <div className="flex min-w-0 items-center rounded-xl border border-[#2b4561] bg-[#0b1420] px-3 py-2.5 text-xs leading-relaxed text-gray-300" aria-live="polite">
                {coverageStatusMessage}
              </div>
            </div>

            <div className="mt-3 space-y-2" aria-label="Automatic coverage progress">
              {coverageProgressRows.map(({ line, progress }) => {
                const speaker = coverageSpeakerLabel(line, progress);
                const lineIdentity = progress.lineId || line.line_id;
                return (
                  <div key={line.line_id} className="flex flex-col gap-2 rounded-xl border border-[#263d56] bg-[#0a121d] px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-sky-400/25 bg-sky-400/10 font-mono text-xs font-bold text-sky-100">
                        {String(line.order).padStart(2, "0")}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-white" title={`${speaker} · ${lineIdentity}`}>
                          {speaker} <span className="font-mono font-normal text-gray-500">· {lineIdentity}</span>
                        </p>
                        <p className="mt-1 truncate text-[11px] leading-relaxed text-gray-500" title={line.text}>{line.text}</p>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:justify-end">
                      <span className="rounded-md border border-[#35425d] bg-[#151e2e] px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-gray-300">
                        {coveragePhaseLabel(progress.phase)}
                      </span>
                      <span className={`rounded-md border px-2 py-1 text-[10px] font-mono uppercase tracking-wider ${coverageStatusTone(progress.status)}`}>
                        {coverageStatusLabel(progress.status)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {coverageRunStatus === "failed" && (
              <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-500/35 bg-red-950/25 px-3 py-3 text-[11px] leading-relaxed text-red-100" role="alert">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="font-semibold text-red-100">
                    First failure{firstCoverageFailure ? ` · line ${String(firstCoverageFailure.order).padStart(2, "0")} · ${coverageSpeakerLabel(selectedSceneEntry.lines.find((line) => line.line_id === firstCoverageFailure.lineId) || selectedSceneEntry.lines[0], firstCoverageFailure)}` : ""}
                  </p>
                  <p className="mt-1 break-words text-red-200/80">{coverageRunError || "The scene runner stopped before all lines completed."}</p>
                  <p className="mt-1 text-red-200/70">Retry uses the same selected scene and keeps ready coverage from completed lines.</p>
                </div>
              </div>
            )}

            {!onRunSceneCoverage && (
              <p className="mt-3 rounded-lg border border-sky-500/20 bg-sky-500/[0.06] px-3 py-2.5 text-[11px] leading-relaxed text-sky-100/70">
                Automatic coverage is ready in this proof, but the scene runner is not connected in this preview. Manual proof controls remain available below.
              </p>
            )}
          </div>
        </section>
      )}

      <section className={`rounded-2xl border p-4 sm:p-5 ${statusTone}`} aria-live="polite">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className={`mt-0.5 rounded-lg border p-2 ${statusLabel === "Saved" ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300" : statusLabel === "Saved plan unavailable/stale" ? "border-amber-500/30 bg-amber-500/10 text-amber-200" : statusLabel === "Save needs attention" ? "border-red-500/30 bg-red-500/10 text-red-200" : "border-[#40506c] bg-[#172238] text-gray-200"}`}>
              {statusLabel === "Saved" ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : statusLabel === "Saving…" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : statusLabel === "Saved plan unavailable/stale" ? <AlertTriangle className="h-4 w-4" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-white">{statusLabel}</p>
                {hasUserEdited && <span className="rounded-md border border-amber-400/25 bg-amber-400/10 px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-amber-100">Local changes</span>}
              </div>
              <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-gray-300">{statusMessage}</p>
              {effectiveIsSaving ? (
                <p className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-sky-200" aria-live="polite">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  Saving the approved multi-line plan…
                </p>
              ) : metadataStatusLine ? (
                <p className="mt-2 flex items-start gap-1.5 text-[11px] font-medium text-amber-200" aria-live="polite">
                  <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>{metadataStatusLine}</span>
                </p>
              ) : null}
              {!effectiveIsSaving && !saveError && statusLabel !== "Saved" && statusLabel !== "Saved plan unavailable/stale" && (
                <p className="mt-2 text-[11px] leading-relaxed text-gray-500">{draftSaveEligibility.reason}</p>
              )}
            </div>
          </div>
          <Button
            type="button"
            onClick={() => void handleSaveShotPlan()}
            disabled={!draftSaveEligibility.canSave}
            className="h-10 shrink-0 gap-2 bg-amber-500 px-3 text-xs font-semibold text-black hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {effectiveIsSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Save className="h-3.5 w-3.5" aria-hidden="true" />}
            {effectiveIsSaving ? "Saving…" : "Save approved shot plan"}
          </Button>
        </div>

        {saveError && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-950/25 px-3 py-2.5 text-[11px] leading-relaxed text-red-200" role="alert">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-300" aria-hidden="true" />
            <span>{saveError}</span>
          </div>
        )}

        {hasStaleStoredPlan && !savedPlanWasDismissed && (
          <div className="mt-3 flex flex-col gap-3 rounded-xl border border-amber-500/30 bg-amber-950/20 p-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[11px] leading-relaxed text-amber-100/80">
              The saved approval is retained as history. Current media stays out of the player until you choose a fresh multi-line draft.
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={startNewDraftFromCurrentMedia}
              className="h-9 shrink-0 border-amber-400/40 bg-amber-500/10 px-3 text-[11px] text-amber-100 hover:border-amber-300 hover:bg-amber-500/20"
            >
              Start new multi-line draft from current media
            </Button>
          </div>
        )}
      </section>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
        <section className="min-w-0 space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-amber-400">Fixed screenplay order</p>
              <h3 className="mt-1 text-xl font-serif font-bold text-white">Line cards and local shot order</h3>
            </div>
            <p className="text-xs text-gray-500">{orderedShots.length ? `${orderedShots.length} playback shots · no cross-line interleaving` : "No eligible shots to order"}</p>
          </div>

          {playableLineCards.length ? (
            <div className="space-y-4">
              {lineReadiness.map(({ card, ordered, rolesAreExact, exact }) => {
                const lineOrder = lineOrders[card.line.line_id] || [];
                const missingMaster = !card.shots.some((shot) => shot.role === "master");
                const missingReviewed = !card.shots.some((shot) => shot.role === "reviewed-closeup");
                return (
                  <article key={card.line.line_id} className="overflow-hidden rounded-2xl border border-[#293650] bg-[#101622] shadow-lg shadow-black/[0.15]">
                    <div className="border-b border-[#202b42] px-4 py-4 sm:px-5">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex min-w-0 items-start gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-amber-500/30 bg-amber-500/10 font-mono text-sm font-bold text-amber-200">
                            {String(card.line.order).padStart(2, "0")}
                          </div>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-[10px] font-mono uppercase tracking-wider text-amber-300">Line {String(card.line.order).padStart(2, "0")}</span>
                              <span className="rounded-md border border-[#35425d] bg-[#151e2e] px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-gray-300">{normalizeCharacterId(card.line.character_id)}</span>
                              <span className={`rounded-md border px-2 py-1 text-[10px] font-mono uppercase tracking-wider ${exact ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-amber-500/30 bg-amber-500/10 text-amber-200"}`}>
                                {exact ? "Exact current coverage" : "Coverage needs attention"}
                              </span>
                            </div>
                            <p className="mt-2 max-w-3xl font-serif text-base italic leading-relaxed text-gray-100">“{card.line.text}”</p>
                          </div>
                        </div>
                        <span className="shrink-0 text-[10px] text-gray-500">Line order locked</span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-[10px]">
                        <span className={`rounded-md border px-2 py-1 ${missingMaster ? "border-amber-500/30 bg-amber-500/10 text-amber-200" : "border-emerald-500/25 bg-emerald-500/10 text-emerald-200"}`}>
                          {missingMaster ? "Master unavailable" : "Master available"}
                        </span>
                        <span className={`rounded-md border px-2 py-1 ${missingReviewed ? "border-amber-500/30 bg-amber-500/10 text-amber-200" : "border-emerald-500/25 bg-emerald-500/10 text-emerald-200"}`}>
                          {missingReviewed ? "Reviewed close-up unavailable" : "Reviewed close-up available"}
                        </span>
                        <span className="rounded-md border border-[#35425d] bg-[#151e2e] px-2 py-1 text-gray-400">
                          {rolesAreExact ? "2 / 2 roles ready" : `${card.shots.length} / 2 roles ready`}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-3 p-4 sm:p-5">
                      {ordered.length ? ordered.map((shot, index) => {
                        const measured = getMeasuredDuration(shot);
                        const isCurrent = currentShot?.key === shot.key;
                        return (
                          <div key={`${shot.key}:${shotLineageToken(shot)}`} className={`rounded-xl border bg-[#0b1019] p-3 ${isCurrent ? "border-amber-500/50 ring-1 ring-amber-300/[0.15]" : "border-[#27344d]"}`}>
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div className="flex min-w-0 items-start gap-3">
                                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-amber-500/25 bg-amber-500/10 font-mono text-xs text-amber-200">{index + 1}</div>
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="rounded-md border border-amber-500/25 bg-amber-500/10 px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-amber-200">{roleShortLabel(shot.role)}</span>
                                    {isCurrent && <span className="text-[10px] text-amber-300">Current preview shot</span>}
                                  </div>
                                  <p className="mt-2 text-sm font-semibold text-white">{shot.label}</p>
                                  <p className="mt-1 text-[11px] leading-relaxed text-gray-500">{shot.sourceIdentity}</p>
                                </div>
                              </div>
                              <div className="flex shrink-0 items-center gap-1.5 self-end sm:self-start">
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={() => moveShot(card.line.line_id, index, -1)}
                                  disabled={isPlaying || index === 0 || ordered.length < 2}
                                  className="h-8 gap-1 border-[#33415d] bg-[#151e2e] px-2 text-[11px] text-gray-200 hover:border-amber-500/50 hover:bg-[#1c2940] disabled:cursor-not-allowed disabled:opacity-40"
                                  title="Move this shot earlier inside this line"
                                >
                                  <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" /> Earlier
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={() => moveShot(card.line.line_id, index, 1)}
                                  disabled={isPlaying || index === ordered.length - 1 || ordered.length < 2}
                                  className="h-8 gap-1 border-[#33415d] bg-[#151e2e] px-2 text-[11px] text-gray-200 hover:border-amber-500/50 hover:bg-[#1c2940] disabled:cursor-not-allowed disabled:opacity-40"
                                  title="Move this shot later inside this line"
                                >
                                  Later <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                                </Button>
                              </div>
                            </div>
                            <div className="mt-3 grid gap-2 sm:grid-cols-2">
                              <div className="rounded-lg border border-[#27344d] bg-[#101622] p-2.5">
                                <p className="text-[10px] font-mono uppercase tracking-wider text-gray-500">Measured duration</p>
                                <p className={`mt-1 text-sm ${measured ? "text-emerald-200" : "text-amber-200"}`}>{formatDuration(measured || shot.savedDuration)}</p>
                                <p className="mt-1 text-[10px] leading-relaxed text-gray-500">{measured ? "Measured from browser video metadata." : "Automatic measurement is pending. Play remains available as a manual retry."}</p>
                              </div>
                              <div className="rounded-lg border border-[#27344d] bg-[#101622] p-2.5">
                                <p className="text-[10px] font-mono uppercase tracking-wider text-gray-500">Lineage</p>
                                <p className="mt-1 text-[11px] leading-relaxed text-gray-300">{shot.role === "master" ? "Ordinary master, muted in playback." : "Reviewed lip-sync MP4, embedded audio only."}</p>
                                {shot.role === "reviewed-closeup" && shot.candidate && (
                                  <p className="mt-1 text-[10px] text-gray-500">Audio take {mediaToken(shot.candidate.audio_url)}</p>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      }) : (
                        <div className="rounded-xl border border-dashed border-amber-500/30 bg-amber-950/15 p-4 text-xs leading-relaxed text-amber-100/80">
                          This line is missing one or both required current shot roles. The proof will not borrow coverage from another line.
                        </div>
                      )}
                      {lineOrder.length > 0 && lineOrder.length < 2 && (
                        <p className="text-[11px] text-amber-200">Choose both current roles before this line can be approved.</p>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-[#35425d] bg-[#101622] p-5 text-sm leading-relaxed text-gray-500">
              {isStalePreviewBlocked
                ? "The saved approval is unavailable for current media. Start a new multi-line draft before previewing an order."
                : "No eligible current line coverage is available for this scene. Missing roles remain unavailable instead of being filled with stale or unrelated media."}
            </div>
          )}
        </section>

        <section className="space-y-3 lg:sticky lg:top-4">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-amber-400">Flattened hard-cut preview</p>
            <h3 className="mt-1 text-xl font-serif font-bold text-white">Play every line in order</h3>
          </div>
          <div className="rounded-2xl border border-[#293650] bg-[#0d131e] p-3 shadow-xl shadow-black/[0.15] sm:p-4">
            <div className="relative mx-auto aspect-[9/16] w-full max-w-[320px] overflow-hidden rounded-xl border border-[#34415c] bg-black">
              {currentShot ? (
                <video
                  key={shotLineageToken(currentShot)}
                  ref={videoRef}
                  src={currentShot.videoUrl}
                  muted={currentShot.role === "master"}
                  playsInline
                  preload="metadata"
                  className="h-full w-full bg-black object-contain"
                  onLoadedMetadata={handleVideoMetadata}
                  onCanPlay={handleCanPlay}
                  onEnded={handleVideoEnded}
                  onError={handleVideoError}
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-gray-500">
                  <Film className="h-8 w-8 text-gray-600" aria-hidden="true" />
                  <p className="text-sm">{isStalePreviewBlocked ? "Start a new draft to preview current media." : "The player waits for current line coverage."}</p>
                </div>
              )}
              {currentShot && (
                <div className="pointer-events-none absolute inset-x-3 top-3 flex items-start justify-between gap-2">
                  <span className="rounded-md border border-black/30 bg-black/75 px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-amber-100 backdrop-blur-sm">
                    Line {String(currentShot.line.order).padStart(2, "0")} · {roleLabel(currentShot.role)}
                  </span>
                  {currentShot.role === "master" ? (
                    <span className="flex items-center gap-1 rounded-md border border-black/30 bg-black/75 px-2 py-1 text-[10px] text-gray-200 backdrop-blur-sm">
                      <VolumeX className="h-3 w-3" aria-hidden="true" /> Muted
                    </span>
                  ) : (
                    <span className="rounded-md border border-emerald-300/25 bg-emerald-950/75 px-2 py-1 text-[10px] text-emerald-100 backdrop-blur-sm">
                      Embedded audio
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-mono uppercase tracking-wider text-amber-200">
                {currentShot ? `Shot ${currentShotIndex + 1} of ${orderedShots.length}` : "No shot selected"}
              </span>
              <span className="text-gray-500">{currentShot ? `Line ${currentShot.line.order}` : "Waiting for current media"}</span>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() => void handlePlay()}
                disabled={!currentShot || isPlaying}
                className="h-10 gap-2 bg-amber-500 px-3 text-xs font-semibold text-black hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Play className="h-3.5 w-3.5" aria-hidden="true" /> Play
              </Button>
              <Button
                type="button"
                onClick={handlePause}
                disabled={!currentShot || !isPlaying}
                variant="outline"
                className="h-10 gap-2 border-[#3b4963] bg-[#151e2e] px-3 text-xs text-gray-200 hover:border-amber-500/50 hover:bg-[#1c2940] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Pause className="h-3.5 w-3.5" aria-hidden="true" /> Pause
              </Button>
              <Button
                type="button"
                onClick={handleRestart}
                disabled={!currentShot}
                variant="outline"
                className="h-10 gap-2 border-[#3b4963] bg-[#151e2e] px-3 text-xs text-gray-200 hover:border-amber-500/50 hover:bg-[#1c2940] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Restart
              </Button>
              <Button
                type="button"
                onClick={handleStop}
                disabled={!currentShot}
                variant="outline"
                className="h-10 gap-2 border-[#3b4963] bg-[#151e2e] px-3 text-xs text-gray-200 hover:border-amber-500/50 hover:bg-[#1c2940] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Square className="h-3.5 w-3.5" aria-hidden="true" /> Stop
              </Button>
            </div>

            {playbackError && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-700/[0.45] bg-red-950/25 px-3 py-2.5 text-[11px] leading-relaxed text-red-200" role="alert">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-300" aria-hidden="true" />
                <span>{playbackError}</span>
              </div>
            )}
            {playbackNotice && !playbackError && (
              <p className="mt-3 flex items-start gap-2 text-[11px] leading-relaxed text-amber-100/70" aria-live="polite">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden="true" />
                <span>{playbackNotice}</span>
              </p>
            )}

            <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-950/[0.15] p-3 text-[11px] leading-relaxed text-amber-100/75">
              <p className="font-semibold text-amber-100">Media boundary</p>
              <p className="mt-1">Play starts only when you press Play. Masters stay muted. Reviewed lip-sync MP4s supply their embedded audio, and this proof never layers linked MP3 files underneath. Saving records only the approved per-line order and exact lineage.</p>
            </div>
          </div>
        </section>
      </div>

      <div className="sr-only" aria-hidden="true">
        {uniqueShotMeasurementEntries.map((entry) => (
          <video
            key={`${entry.measurementKey}:${entry.videoUrl}`}
            src={entry.videoUrl}
            muted
            playsInline
            preload="metadata"
            onLoadedMetadata={(event) => handleMetadataLoaderLoaded(entry.measurementKey, entry.videoUrl, event)}
            onError={() => handleMetadataLoaderError(entry.measurementKey, entry.videoUrl, entry.label)}
          />
        ))}
      </div>
    </div>
  );
};
