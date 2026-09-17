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
import { MultiLineShotPlanProof } from "@/components/MultiLineShotPlanProof";
import {
  DialogueAudioAsset,
  DialogueLine,
  DialogueShotClip,
  DramaManifest,
  DramaScene,
  LipsyncAsset,
  ReviewedShotCandidate,
  VideoClip,
  deriveDialogueLines,
  getLegacyDialogueLineId,
  resolveShotPlanContext,
} from "@/lib/dramaStudio";
import type {
  CurrentShotPlanContext,
  SavedShotPlan,
  SavedShotPlanMasterShot,
  SavedShotPlanReviewedCloseupShot,
  SavedShotPlanSnapshot,
} from "@/lib/dramaStudio";
import { normalizeSavedShotPlan } from "@/lib/savedShotPlan";
import type { CoverageLineProgress } from "@/lib/sceneCoverageRunner";

export interface ShotPlanProofProps {
  manifest: DramaManifest;
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
  selectedSceneNumber?: number | null;
  onSelectedSceneNumberChange?: (sceneNumber: number | null) => void;
}

type ShotRole = "master" | "reviewed-closeup";

type ShotPlanMedia = {
  key: string;
  role: ShotRole;
  label: string;
  videoUrl: string;
  sourceIdentity: string;
  linkedAudioUrl: string | null;
  audioTake: DialogueAudioAsset | null;
  line: DialogueLine;
  savedDuration: number;
  savedApprovalDuration?: boolean;
  candidate?: ReviewedShotCandidate;
  masterClip?: VideoClip;
};

type SceneEntry = {
  scene: DramaScene;
  sceneNumber: number;
  lines: DialogueLine[];
};

type SavedPlanFreshness = {
  isCurrent: boolean;
  reason: string;
  context: CurrentShotPlanContext | null;
  sourceSignature: string | null;
};

type DraftSaveEligibility = {
  canSave: boolean;
  reason: string;
  plan: SavedShotPlan | null;
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

function mediaTimestamp(value: { updated_at?: string; created_at?: string }): number {
  const updated = Date.parse(value.updated_at || "");
  if (Number.isFinite(updated)) return updated;
  const created = Date.parse(value.created_at || "");
  return Number.isFinite(created) ? created : 0;
}

function getAudioLineId(asset: DialogueAudioAsset): string {
  return asset.line_id?.trim() || getLegacyDialogueLineId(asset.scene_number);
}

function findNewestMatchingAudio(
  assets: DialogueAudioAsset[],
  sceneNumber: number,
  line: DialogueLine
): DialogueAudioAsset | null {
  return [...assets]
    .filter(
      (asset) =>
        asset.asset_type === "dialogue" &&
        asset.provider === "elevenlabs" &&
        asset.status === "READY" &&
        asset.scene_number === sceneNumber &&
        getAudioLineId(asset) === line.line_id &&
        asset.character_id === line.character_id &&
        asset.text === line.text &&
        asset.content_type === "audio/mpeg" &&
        isSecureHttpsUrl(asset.audio_url)
    )
    .sort((left, right) => mediaTimestamp(right) - mediaTimestamp(left))[0] || null;
}

function normalizeCharacterId(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function formatScene(sceneNumber: number): string {
  return String(sceneNumber).padStart(2, "0");
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

function formatSavedAt(value: string | undefined): string {
  const timestamp = Date.parse(value || "");
  if (!Number.isFinite(timestamp)) return "saved take";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

function audioTakeIdentity(audioTake: DialogueAudioAsset | null, linkedAudioUrl: string | null): string {
  if (audioTake && isSecureHttpsUrl(audioTake.audio_url)) {
    const voice = audioTake.voice_name?.trim() || "Saved voice";
    return `${voice} · take ${mediaToken(audioTake.audio_url)} · ${formatSavedAt(audioTake.updated_at || audioTake.created_at)}`;
  }
  if (linkedAudioUrl && isSecureHttpsUrl(linkedAudioUrl)) {
    return `Exact saved take · ${mediaToken(linkedAudioUrl)}`;
  }
  return "No exact READY audio take linked";
}

function formatDuration(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "Not measured";
  return `${value.toFixed(value >= 10 ? 1 : 2)}s`;
}

function savedDuration(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : SOURCE_WINDOW_SECONDS;
}

function getAudioDuration(asset: DialogueAudioAsset | null): number | null {
  if (!asset) return null;
  const parsed = Number(asset.duration_seconds);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function roleLabel(role: ShotRole): string {
  return role === "master" ? "Master / wide" : "Reviewed close-up";
}

function roleShortLabel(role: ShotRole): string {
  return role === "master" ? "Master" : "Close-up";
}

function describeMissingReviewedShot(
  selectedLine: DialogueLine | null,
  selectedAudioTake: DialogueAudioAsset | null,
  hasCloseupRecord: boolean,
  hasLipsyncRecord: boolean
): string {
  if (!selectedLine) return "Choose a current dialogue line to check reviewed coverage.";
  if (!selectedAudioTake) {
    return "No exact READY audio take matches this saved line. A reviewed shot cannot borrow another take.";
  }
  if (hasCloseupRecord && hasLipsyncRecord) {
    return "Saved close-up and lip-sync attempts exist, but their source, result, or exact audio lineage is stale for this line.";
  }
  if (hasCloseupRecord) {
    return "A close-up source exists, but no READY lip-sync result still matches this line and exact take.";
  }
  if (hasLipsyncRecord) {
    return "A lip-sync result exists, but its close-up source or exact audio take no longer matches this line.";
  }
  return "No current reviewed close-up lineage is saved for this line.";
}

/** A compact deterministic signature keeps broader screenplay/source edits visible in a saved plan. */
function hashSource(value: string): string {
  let first = 2166136261;
  let second = 2246822519;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first ^= code;
    first = Math.imul(first, 16777619);
    second ^= code + index;
    second = Math.imul(second, 3266489917);
  }
  return `v1-${(first >>> 0).toString(16).padStart(8, "0")}-${(second >>> 0).toString(16).padStart(8, "0")}`;
}

function objectIdentity(value: unknown): string {
  try {
    return hashSource(JSON.stringify(value) || "null");
  } catch {
    return hashSource(String(value));
  }
}

function contextSourceSignature(
  manifest: DramaManifest | null | undefined,
  context: CurrentShotPlanContext | null
): string | null {
  if (!manifest || !context) return null;
  try {
    return hashSource(
      JSON.stringify({
        manifest,
        selected_context: {
          scene: context.scene,
          line: context.line,
          master: context.masterClip
            ? {
                prediction_id: context.masterClip.prediction_id,
                video_url: context.masterClip.video_url,
                created_at: context.masterClip.created_at,
                updated_at: context.masterClip.updated_at,
              }
            : null,
          reviewed: context.reviewedCandidate
            ? {
                closeup_prediction_id: context.reviewedCandidate.closeup_prediction_id,
                closeup_video_url: context.reviewedCandidate.closeup_video_url,
                lipsync_prediction_id: context.reviewedCandidate.lipsync_prediction_id,
                lipsync_video_url: context.reviewedCandidate.lipsync_video_url,
                audio_url: context.reviewedCandidate.audio_url,
                closeup_created_at: context.reviewedCandidate.closeup_created_at,
                closeup_updated_at: context.reviewedCandidate.closeup_updated_at,
                lipsync_created_at: context.reviewedCandidate.lipsync_created_at,
                lipsync_updated_at: context.reviewedCandidate.lipsync_updated_at,
                audio_created_at: context.reviewedCandidate.audio_created_at,
                audio_updated_at: context.reviewedCandidate.audio_updated_at,
              }
            : null,
        },
      }) || "null"
    );
  } catch {
    return null;
  }
}

function isMasterPlanShot(shot: SavedShotPlan["shots"][number]): shot is SavedShotPlanMasterShot {
  return shot.role === "master";
}

function isReviewedPlanShot(
  shot: SavedShotPlan["shots"][number]
): shot is SavedShotPlanReviewedCloseupShot {
  return shot.role === "reviewed-closeup";
}

function getSavedPlanShot(plan: SavedShotPlan, role: ShotRole): SavedShotPlan["shots"][number] | null {
  return plan.shots.find((shot) => shot.role === role) || null;
}

function compareSavedPlanToCurrent(
  plan: SavedShotPlan,
  manifest: DramaManifest | null | undefined,
  context: CurrentShotPlanContext | null
): SavedPlanFreshness {
  const sourceSignature = contextSourceSignature(manifest, context);
  if (!context) {
    return {
      isCurrent: false,
      reason: "The saved scene, dialogue line, or one of its exact current media sources is no longer available.",
      context: null,
      sourceSignature,
    };
  }

  if (
    plan.scene_number !== context.scene.scene_number ||
    plan.line_id !== context.line.line_id ||
    plan.character_id !== context.line.character_id ||
    plan.text !== context.line.text
  ) {
    return {
      isCurrent: false,
      reason: "The saved approval no longer matches the current screenplay line, speaker, or wording.",
      context,
      sourceSignature,
    };
  }

  const savedMaster = getSavedPlanShot(plan, "master");
  const savedReviewed = getSavedPlanShot(plan, "reviewed-closeup");
  if (!savedMaster || !isMasterPlanShot(savedMaster) || !context.masterClip) {
    return {
      isCurrent: false,
      reason: "The approved master / wide source is no longer a current strict READY scene clip.",
      context,
      sourceSignature,
    };
  }
  if (
    savedMaster.clip_prediction_id !== context.masterClip.prediction_id ||
    savedMaster.video_url !== context.masterClip.video_url ||
    savedMaster.created_at !== context.masterClip.created_at ||
    savedMaster.updated_at !== context.masterClip.updated_at
  ) {
    return {
      isCurrent: false,
      reason: "The current master / wide lineage changed after this approval.",
      context,
      sourceSignature,
    };
  }

  if (!savedReviewed || !isReviewedPlanShot(savedReviewed) || !context.reviewedCandidate) {
    return {
      isCurrent: false,
      reason: "The approved reviewed close-up lineage is no longer a current exact close-up, lip-sync, and audio pair.",
      context,
      sourceSignature,
    };
  }
  const currentReviewed = context.reviewedCandidate;
  if (
    savedReviewed.closeup_prediction_id !== currentReviewed.closeup_prediction_id ||
    savedReviewed.closeup_video_url !== currentReviewed.closeup_video_url ||
    savedReviewed.closeup_created_at !== currentReviewed.closeup_created_at ||
    savedReviewed.closeup_updated_at !== currentReviewed.closeup_updated_at ||
    savedReviewed.lipsync_prediction_id !== currentReviewed.lipsync_prediction_id ||
    savedReviewed.lipsync_video_url !== currentReviewed.lipsync_video_url ||
    savedReviewed.lipsync_created_at !== currentReviewed.lipsync_created_at ||
    savedReviewed.lipsync_updated_at !== currentReviewed.lipsync_updated_at ||
    savedReviewed.audio_url !== currentReviewed.audio_url ||
    savedReviewed.audio_created_at !== currentReviewed.audio_created_at ||
    savedReviewed.audio_updated_at !== currentReviewed.audio_updated_at
  ) {
    return {
      isCurrent: false,
      reason: "The current reviewed close-up, lip-sync result, or exact audio take changed after this approval.",
      context,
      sourceSignature,
    };
  }

  if (!plan.source_signature) {
    return {
      isCurrent: false,
      reason: "This saved approval predates source signatures, so it needs one explicit reapproval before preview or saving.",
      context,
      sourceSignature,
    };
  }
  if (!sourceSignature || plan.source_signature !== sourceSignature) {
    return {
      isCurrent: false,
      reason: "The canonical screenplay or source metadata changed after this approval.",
      context,
      sourceSignature,
    };
  }

  return {
    isCurrent: true,
    reason: "The saved approval matches the current screenplay and exact media lineage.",
    context,
    sourceSignature,
  };
}

function shotLineageToken(shot: ShotPlanMedia): string {
  if (shot.role === "master" && shot.masterClip) {
    return JSON.stringify({
      role: shot.role,
      prediction_id: shot.masterClip.prediction_id,
      video_url: shot.masterClip.video_url,
      created_at: shot.masterClip.created_at,
      updated_at: shot.masterClip.updated_at,
    });
  }
  if (shot.role === "reviewed-closeup" && shot.candidate) {
    return JSON.stringify({
      role: shot.role,
      closeup_prediction_id: shot.candidate.closeup_prediction_id,
      closeup_video_url: shot.candidate.closeup_video_url,
      closeup_created_at: shot.candidate.closeup_created_at,
      closeup_updated_at: shot.candidate.closeup_updated_at,
      lipsync_prediction_id: shot.candidate.lipsync_prediction_id,
      lipsync_video_url: shot.candidate.lipsync_video_url,
      lipsync_created_at: shot.candidate.lipsync_created_at,
      lipsync_updated_at: shot.candidate.lipsync_updated_at,
      audio_url: shot.candidate.audio_url,
      audio_created_at: shot.candidate.audio_created_at,
      audio_updated_at: shot.candidate.audio_updated_at,
    });
  }
  return `${shot.role}:${shot.videoUrl}`;
}

function durationMeasurementKey(shot: ShotPlanMedia): string {
  return `${shot.role}:${shotLineageToken(shot)}`;
}

function shotKeyForSavedPlan(planShot: SavedShotPlan["shots"][number], sceneNumber: number, lineId: string): string {
  if (isMasterPlanShot(planShot)) {
    return `master:${sceneNumber}:${planShot.clip_prediction_id}`;
  }
  return `reviewed:${sceneNumber}:${lineId}:${planShot.lipsync_prediction_id}:${planShot.closeup_prediction_id}`;
}

function exactCurrentShotMedia(
  shot: ShotPlanMedia,
  context: CurrentShotPlanContext | null
): boolean {
  if (!context || shot.line.line_id !== context.line.line_id || shot.line.character_id !== context.line.character_id || shot.line.text !== context.line.text) {
    return false;
  }
  if (shot.role === "master") {
    const current = context.masterClip;
    return Boolean(
      current &&
        shot.masterClip &&
        shot.masterClip.prediction_id === current.prediction_id &&
        shot.masterClip.video_url === current.video_url &&
        shot.masterClip.created_at === current.created_at &&
        shot.masterClip.updated_at === current.updated_at
    );
  }
  const current = context.reviewedCandidate;
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

function buildApprovedShotPlan(params: {
  manifest: DramaManifest;
  context: CurrentShotPlanContext | null;
  orderedShots: ShotPlanMedia[];
  measuredDurations: Record<string, number>;
}): SavedShotPlan | null {
  const { manifest, context, orderedShots, measuredDurations } = params;
  if (!context || orderedShots.length !== 2) return null;

  const roleCount = orderedShots.reduce(
    (counts, shot) => {
      counts[shot.role] += 1;
      return counts;
    },
    { master: 0, "reviewed-closeup": 0 }
  );
  if (roleCount.master !== 1 || roleCount["reviewed-closeup"] !== 1) return null;
  if (!orderedShots.every((shot) => exactCurrentShotMedia(shot, context))) return null;

  const sourceSignature = contextSourceSignature(manifest, context);
  if (!sourceSignature) return null;

  const shotRecords: Array<SavedShotPlan["shots"][number]> = [];
  const durations: number[] = [];
  for (const shot of orderedShots) {
    const duration = measuredDurations[durationMeasurementKey(shot)];
    if (!Number.isFinite(duration) || duration <= 0 || duration > 60) return null;
    durations.push(duration);

    if (shot.role === "master") {
      const clip = shot.masterClip;
      if (!clip || !isSecureHttpsUrl(clip.video_url)) return null;
      shotRecords.push({
        role: "master",
        duration_seconds: duration,
        clip_prediction_id: clip.prediction_id,
        video_url: clip.video_url,
        created_at: clip.created_at,
        updated_at: clip.updated_at,
      });
      continue;
    }

    const candidate = shot.candidate;
    if (!candidate || !isSecureHttpsUrl(candidate.closeup_video_url) || !isSecureHttpsUrl(candidate.lipsync_video_url) || !isSecureHttpsUrl(candidate.audio_url)) {
      return null;
    }
    shotRecords.push({
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
    });
  }

  const firstShot = shotRecords[0];
  const secondShot = shotRecords[1];
  if (!firstShot || !secondShot) return null;

  const now = new Date().toISOString();
  return normalizeSavedShotPlan({
    version: 1,
    mode: "one_line_hard_cut",
    status: "APPROVED",
    scene_number: context.scene.scene_number,
    line_id: context.line.line_id,
    character_id: context.line.character_id,
    text: context.line.text,
    source_signature: sourceSignature,
    shots: [firstShot, secondShot],
    total_duration_seconds: durations.reduce((sum, duration) => sum + duration, 0),
    approved_at: now,
    updated_at: now,
  });
}

const OneLineShotPlanProof: React.FC<ShotPlanProofProps> = ({
  manifest,
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
  selectedSceneNumber: controlledSelectedSceneNumber,
  onSelectedSceneNumberChange,
}) => {
  const sceneEntries = useMemo<SceneEntry[]>(() => {
    const safeScenes = Array.isArray(manifest?.scenes) ? manifest.scenes : [];
    return [...safeScenes]
      .sort((left, right) => left.scene_number - right.scene_number)
      .map((scene) => {
        let lines: DialogueLine[] = [];
        try {
          lines = deriveDialogueLines(scene);
        } catch {
          lines = [];
        }
        return {
          scene,
          sceneNumber: scene.scene_number,
          lines,
        };
      });
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

  const [hasUserEdited, setHasUserEdited] = useState(false);
  const [stalePlanDismissedIdentity, setStalePlanDismissedIdentity] = useState<string | null>(null);
  const [isSaveRequestActive, setIsSaveRequestActive] = useState(false);
  const [internalSaveError, setInternalSaveError] = useState<string | null>(null);

  const rawStoredPlan = savedShotPlan ?? null;
  const storedPlan = useMemo(
    () => (rawStoredPlan ? normalizeSavedShotPlan(rawStoredPlan) : null),
    [rawStoredPlan]
  );
  const storedPlanIdentity = useMemo(() => {
    if (storedPlan) return `plan:${objectIdentity(storedPlan)}`;
    if (rawStoredPlan) return `invalid:${objectIdentity(rawStoredPlan)}`;
    return "none";
  }, [rawStoredPlan, storedPlan]);
  const [selectedSceneNumber, setSelectedSceneNumber] = useState<number | null>(null);
  const [selectedLineId, setSelectedLineId] = useState("");
  const [localOrder, setLocalOrder] = useState<string[]>([]);
  const [measuredDurations, setMeasuredDurations] = useState<Record<string, number>>({});
  const [currentShotIndex, setCurrentShotIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [playbackNotice, setPlaybackNotice] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const isPlayingRef = useRef(false);
  const continueAfterSourceChangeRef = useRef(false);
  const previewRunRef = useRef(0);
  const hydrationRef = useRef<{ identity: string; applied: boolean }>({ identity: "", applied: false });
  const lastReportedDirtyRef = useRef<boolean | null>(null);
  const lastDirtyCallbackRef = useRef<ShotPlanProofProps["onShotPlanDirtyChange"]>(undefined);

  const storedPlanContext = useMemo(
    () =>
      storedPlan
        ? resolveShotPlanContext({
            manifest,
            scene_number: storedPlan.scene_number,
            line_id: storedPlan.line_id,
            video_clips: safeVideoClips,
            dialogue_shot_clips: safeDialogueShotClips,
            lipsync_assets: safeLipsyncAssets,
            audio_assets: safeAudioAssets,
          })
        : null,
    [manifest, safeAudioAssets, safeDialogueShotClips, safeLipsyncAssets, safeVideoClips, storedPlan]
  );
  const storedPlanFreshness = useMemo<SavedPlanFreshness>(() => {
    if (!storedPlan) {
      return {
        isCurrent: false,
        reason: "No saved plan is attached to this project yet.",
        context: null,
        sourceSignature: null,
      };
    }
    return compareSavedPlanToCurrent(storedPlan, manifest, storedPlanContext);
  }, [manifest, storedPlan, storedPlanContext]);
  const hasStaleStoredPlan = Boolean(storedPlan && !storedPlanFreshness.isCurrent);
  const isStalePreviewBlocked = Boolean(
    hasStaleStoredPlan && stalePlanDismissedIdentity !== storedPlanIdentity
  );

  useEffect(() => {
    if (hydrationRef.current.identity === storedPlanIdentity) return;
    hydrationRef.current = { identity: storedPlanIdentity, applied: false };
    setHasUserEdited(false);
  }, [storedPlanIdentity]);

  useEffect(() => {
    if (controlledSelectedSceneNumber !== undefined) {
      setSelectedSceneNumber(controlledSelectedSceneNumber);
      return;
    }
    setSelectedSceneNumber((current) => {
      if (current !== null && sceneEntries.some((entry) => entry.sceneNumber === current)) return current;
      return sceneEntries.find((entry) => entry.lines.length > 0)?.sceneNumber ?? sceneEntries[0]?.sceneNumber ?? null;
    });
  }, [controlledSelectedSceneNumber, sceneEntries]);

  const selectedEntry = useMemo(
    () => sceneEntries.find((entry) => entry.sceneNumber === selectedSceneNumber) || null,
    [sceneEntries, selectedSceneNumber]
  );

  useEffect(() => {
    const lines = selectedEntry?.lines || [];
    setSelectedLineId((current) =>
      current && lines.some((line) => line.line_id === current) ? current : lines[0]?.line_id || ""
    );
  }, [selectedEntry]);

  const selectedLine = useMemo(
    () => selectedEntry?.lines.find((line) => line.line_id === selectedLineId) || null,
    [selectedEntry, selectedLineId]
  );

  const selectedContext = useMemo(
    () =>
      selectedSceneNumber !== null && selectedLineId
        ? resolveShotPlanContext({
            manifest,
            scene_number: selectedSceneNumber,
            line_id: selectedLineId,
            video_clips: safeVideoClips,
            dialogue_shot_clips: safeDialogueShotClips,
            lipsync_assets: safeLipsyncAssets,
            audio_assets: safeAudioAssets,
          })
        : null,
    [
      manifest,
      safeAudioAssets,
      safeDialogueShotClips,
      safeLipsyncAssets,
      safeVideoClips,
      selectedLineId,
      selectedSceneNumber,
    ]
  );

  const selectedAudioTake = useMemo(
    () =>
      selectedEntry && selectedLine
        ? findNewestMatchingAudio(safeAudioAssets, selectedEntry.sceneNumber, selectedLine)
        : null,
    [safeAudioAssets, selectedEntry, selectedLine]
  );

  const selectedMasterClip = selectedContext?.masterClip || null;
  const selectedReviewedCandidate = selectedContext?.reviewedCandidate || null;

  const hasCloseupRecord = Boolean(
    selectedEntry &&
      safeDialogueShotClips.some(
        (clip) => clip && typeof clip === "object" && clip.scene_number === selectedEntry.sceneNumber
      )
  );
  const hasLipsyncRecord = Boolean(
    selectedEntry &&
      safeLipsyncAssets.some(
        (asset) => asset && typeof asset === "object" && asset.scene_number === selectedEntry.sceneNumber
      )
  );

  const baseShots = useMemo<ShotPlanMedia[]>(() => {
    if (!selectedEntry || !selectedLine) return [];

    const savedPlanMatchesSelection = Boolean(
      storedPlan &&
        storedPlanFreshness.isCurrent &&
        storedPlan.scene_number === selectedEntry.sceneNumber &&
        storedPlan.line_id === selectedLine.line_id
    );
    const shots: ShotPlanMedia[] = [];
    const savedMaster = savedPlanMatchesSelection && storedPlan ? getSavedPlanShot(storedPlan, "master") : null;
    const savedReviewed = savedPlanMatchesSelection && storedPlan ? getSavedPlanShot(storedPlan, "reviewed-closeup") : null;

    if (selectedMasterClip && isSecureHttpsUrl(selectedMasterClip.video_url)) {
      shots.push({
        key: `master:${selectedEntry.sceneNumber}:${selectedMasterClip.prediction_id}`,
        role: "master",
        label: "Master / wide",
        videoUrl: selectedMasterClip.video_url.trim(),
        sourceIdentity: `Saved Scene ${formatScene(selectedEntry.sceneNumber)} storyboard · motion ${shortId(selectedMasterClip.prediction_id)}`,
        linkedAudioUrl: selectedAudioTake?.audio_url?.trim() || null,
        audioTake: selectedAudioTake,
        line: selectedLine,
        savedDuration: savedMaster && isMasterPlanShot(savedMaster)
          ? savedMaster.duration_seconds
          : savedDuration(selectedMasterClip.duration_seconds),
        savedApprovalDuration: Boolean(savedMaster && isMasterPlanShot(savedMaster)),
        masterClip: selectedMasterClip,
      });
    }

    if (selectedReviewedCandidate && isSecureHttpsUrl(selectedReviewedCandidate.lipsync_video_url)) {
      shots.push({
        key: `reviewed:${selectedReviewedCandidate.scene_number}:${selectedReviewedCandidate.line_id}:${selectedReviewedCandidate.lipsync_prediction_id}:${selectedReviewedCandidate.closeup_prediction_id}`,
        role: "reviewed-closeup",
        label: "Reviewed close-up",
        videoUrl: selectedReviewedCandidate.lipsync_video_url.trim(),
        sourceIdentity: `Close-up source ${shortId(selectedReviewedCandidate.closeup_prediction_id)} · lip-sync ${shortId(selectedReviewedCandidate.lipsync_prediction_id)}`,
        linkedAudioUrl: selectedReviewedCandidate.audio_url.trim(),
        audioTake: selectedAudioTake,
        line: selectedLine,
        savedDuration: savedReviewed && isReviewedPlanShot(savedReviewed)
          ? savedReviewed.duration_seconds
          : SOURCE_WINDOW_SECONDS,
        savedApprovalDuration: Boolean(savedReviewed && isReviewedPlanShot(savedReviewed)),
        candidate: selectedReviewedCandidate,
      });
    }

    return shots;
  }, [
    selectedAudioTake,
    selectedEntry,
    selectedLine,
    selectedMasterClip,
    selectedReviewedCandidate,
    storedPlan,
    storedPlanFreshness.isCurrent,
  ]);

  useEffect(() => {
    if (!storedPlan || !storedPlanFreshness.isCurrent || isStalePreviewBlocked) return;
    if (hydrationRef.current.identity !== storedPlanIdentity) {
      hydrationRef.current = { identity: storedPlanIdentity, applied: false };
    }
    if (hydrationRef.current.applied || hasUserEdited) return;

    if (selectedSceneNumber !== storedPlan.scene_number || selectedLineId !== storedPlan.line_id) {
      setSelectedSceneNumber(storedPlan.scene_number);
      setSelectedLineId(storedPlan.line_id);
      return;
    }

    const desiredKeys = storedPlan.shots.map((shot) =>
      shotKeyForSavedPlan(shot, storedPlan.scene_number, storedPlan.line_id)
    );
    if (!desiredKeys.every((key) => baseShots.some((shot) => shot.key === key))) return;
    setLocalOrder((current) =>
      current.length === desiredKeys.length && current.every((key, index) => key === desiredKeys[index])
        ? current
        : desiredKeys
    );
    hydrationRef.current.applied = true;
  }, [
    baseShots,
    hasUserEdited,
    isStalePreviewBlocked,
    selectedLineId,
    selectedSceneNumber,
    storedPlan,
    storedPlanFreshness.isCurrent,
    storedPlanIdentity,
  ]);

  const playableBaseShots = isStalePreviewBlocked ? [] : baseShots;

  useEffect(() => {
    if (isStalePreviewBlocked) {
      setLocalOrder((current) => (current.length ? [] : current));
      return;
    }

    const shouldRestoreSavedOrder = Boolean(
      storedPlan &&
        storedPlanFreshness.isCurrent &&
        !hasUserEdited &&
        selectedSceneNumber === storedPlan.scene_number &&
        selectedLineId === storedPlan.line_id
    );
    if (shouldRestoreSavedOrder && storedPlan) {
      const savedKeys = storedPlan.shots.map((shot) =>
        shotKeyForSavedPlan(shot, storedPlan.scene_number, storedPlan.line_id)
      );
      if (savedKeys.every((key) => baseShots.some((shot) => shot.key === key))) {
        setLocalOrder((current) =>
          current.length === savedKeys.length && current.every((key, index) => key === savedKeys[index])
            ? current
            : savedKeys
        );
        return;
      }
    }

    const availableKeys = playableBaseShots.map((shot) => shot.key);
    setLocalOrder((current) => {
      const next = current.filter((key) => availableKeys.includes(key));
      availableKeys.forEach((key) => {
        if (!next.includes(key)) next.push(key);
      });
      if (next.length === current.length && next.every((key, index) => key === current[index])) return current;
      return next;
    });
  }, [
    baseShots,
    hasUserEdited,
    isStalePreviewBlocked,
    playableBaseShots,
    selectedLineId,
    selectedSceneNumber,
    storedPlan,
    storedPlanFreshness.isCurrent,
  ]);

  const orderedShots = useMemo(() => {
    const byKey = new Map(playableBaseShots.map((shot) => [shot.key, shot]));
    return localOrder.map((key) => byKey.get(key)).filter((shot): shot is ShotPlanMedia => Boolean(shot));
  }, [localOrder, playableBaseShots]);

  const orderKey = orderedShots.map((shot) => `${shot.key}:${shotLineageToken(shot)}`).join("|");
  const previewContextKey = `${selectedSceneNumber ?? "none"}:${selectedLineId}:${orderKey}`;
  const currentShot = orderedShots[currentShotIndex] || null;
  const selectedAudioDuration = getAudioDuration(selectedAudioTake);
  const selectedAudioRunsLong = Boolean(
    selectedAudioDuration !== null && selectedAudioDuration > SOURCE_WINDOW_SECONDS
  );

  useEffect(() => {
    const runId = previewRunRef.current + 1;
    previewRunRef.current = runId;
    continueAfterSourceChangeRef.current = false;
    isPlayingRef.current = false;
    const video = videoRef.current;
    if (video) {
      video.pause();
      try {
        video.currentTime = 0;
      } catch {
        // A browser can reject a seek while a new source is loading.
      }
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

  const handleSceneChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const nextSceneNumber = Number(event.target.value);
    if (!Number.isInteger(nextSceneNumber)) return;
    setHasUserEdited(true);
    setInternalSaveError(null);
    setSelectedSceneNumber(nextSceneNumber);
    onSelectedSceneNumberChange?.(nextSceneNumber);
    setPlaybackError(null);
    setPlaybackNotice(null);
  };

  const handleLineChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setHasUserEdited(true);
    setInternalSaveError(null);
    setSelectedLineId(event.target.value);
    setPlaybackError(null);
    setPlaybackNotice(null);
  };

  const moveShot = (index: number, direction: -1 | 1) => {
    if (isPlaying || index + direction < 0 || index + direction >= orderedShots.length) return;
    const nextOrder = orderedShots.map((shot) => shot.key);
    const targetIndex = index + direction;
    [nextOrder[index], nextOrder[targetIndex]] = [nextOrder[targetIndex], nextOrder[index]];
    setHasUserEdited(true);
    setInternalSaveError(null);
    setLocalOrder(nextOrder);
  };

  const startNewDraftFromCurrentMedia = () => {
    if (!storedPlan || !hasStaleStoredPlan) return;
    const defaultEntry = sceneEntries.find((entry) => entry.lines.length > 0) || sceneEntries[0] || null;
    const defaultLine = defaultEntry?.lines[0] || null;
    setStalePlanDismissedIdentity(storedPlanIdentity);
    hydrationRef.current = { identity: storedPlanIdentity, applied: true };
    setHasUserEdited(true);
    setInternalSaveError(null);
    setSelectedSceneNumber(defaultEntry?.sceneNumber ?? null);
    setSelectedLineId(defaultLine?.line_id || "");
    setLocalOrder([]);
    setPlaybackError(null);
    setPlaybackNotice("Started a new local draft from current media. The stale saved approval remains unchanged.");
  };

  const registerVideoDuration = useCallback((measurementKey: string, duration: number) => {
    if (!measurementKey || !Number.isFinite(duration) || duration <= 0 || duration > 3600) return;
    setMeasuredDurations((current) => {
      if (Math.abs((current[measurementKey] || 0) - duration) < 0.01) return current;
      return { ...current, [measurementKey]: duration };
    });
  }, []);

  const handleVideoMetadata = (event: React.SyntheticEvent<HTMLVideoElement>) => {
    const duration = event.currentTarget.duration;
    const key = currentShot ? durationMeasurementKey(currentShot) : event.currentTarget.currentSrc || "";
    registerVideoDuration(key, duration);
  };

  const stopPreview = useCallback((notice: string | null = null, resetToStart = false) => {
    continueAfterSourceChangeRef.current = false;
    isPlayingRef.current = false;
    const video = videoRef.current;
    video?.pause();
    if (video && resetToStart) {
      try {
        video.currentTime = 0;
      } catch {
        // A browser can reject a seek while metadata is unavailable.
      }
    }
    setIsPlaying(false);
    setPlaybackError(null);
    if (resetToStart) setCurrentShotIndex(0);
    setPlaybackNotice(notice);
  }, []);

  const handlePlay = async () => {
    if (!currentShot || isPlayingRef.current) return;
    const video = videoRef.current;
    if (!video) return;

    const runId = previewRunRef.current;
    setPlaybackError(null);
    setPlaybackNotice(null);
    if (video.ended) {
      try {
        video.currentTime = 0;
      } catch {
        // A browser can reject a seek before metadata is available.
      }
    }
    isPlayingRef.current = true;
    setIsPlaying(true);
    try {
      await video.play();
    } catch {
      if (previewRunRef.current !== runId || !isPlayingRef.current) return;
      isPlayingRef.current = false;
      setIsPlaying(false);
      setPlaybackError(`The saved ${roleLabel(currentShot.role).toLowerCase()} could not play in this browser. The proof stopped without choosing another clip.`);
    }
  };

  const handlePause = () => {
    continueAfterSourceChangeRef.current = false;
    isPlayingRef.current = false;
    videoRef.current?.pause();
    setIsPlaying(false);
    setPlaybackNotice("Paused. Press Play to continue this local shot plan.");
  };

  const handleRestart = () => {
    stopPreview("Restarted at the first available shot. Press Play when ready.", true);
  };

  const handleStop = () => {
    stopPreview("Stopped. This local proof is ready to play again.", true);
  };

  const handleCanPlay = () => {
    if (!continueAfterSourceChangeRef.current || !isPlayingRef.current) return;
    continueAfterSourceChangeRef.current = false;
    const video = videoRef.current;
    const runId = previewRunRef.current;
    if (!video) return;
    void video.play().catch(() => {
      if (previewRunRef.current !== runId || !isPlayingRef.current) return;
      isPlayingRef.current = false;
      setIsPlaying(false);
      setPlaybackError("The next saved shot could not continue in this browser. The proof stopped without substituting another clip.");
    });
  };

  const handleVideoEnded = () => {
    if (!isPlayingRef.current) return;
    if (currentShotIndex < orderedShots.length - 1) {
      continueAfterSourceChangeRef.current = true;
      setCurrentShotIndex((current) => current + 1);
      setPlaybackNotice(`Hard cut to ${roleLabel(orderedShots[currentShotIndex + 1].role)}. The order remains local to this proof.`);
      return;
    }
    continueAfterSourceChangeRef.current = false;
    isPlayingRef.current = false;
    setIsPlaying(false);
    setPlaybackNotice("Shot plan preview complete. Nothing was saved or added to the project timeline.");
  };

  const handleVideoError = () => {
    continueAfterSourceChangeRef.current = false;
    isPlayingRef.current = false;
    setIsPlaying(false);
    setPlaybackError(`The saved ${currentShot ? roleLabel(currentShot.role).toLowerCase() : "shot"} could not load in this browser. The proof stopped and kept its exact media boundary.`);
    setPlaybackNotice(null);
  };

  const getMeasuredDuration = (shot: ShotPlanMedia): number | null => {
    const measured = measuredDurations[durationMeasurementKey(shot)];
    return Number.isFinite(measured) && measured > 0 ? measured : null;
  };

  const renderDuration = (shot: ShotPlanMedia): { value: number; measured: boolean } => {
    const measured = getMeasuredDuration(shot);
    return {
      value: measured || shot.savedDuration,
      measured: measured !== null,
    };
  };

  const rolesAreExact = orderedShots.length === 2 &&
    orderedShots.filter((shot) => shot.role === "master").length === 1 &&
    orderedShots.filter((shot) => shot.role === "reviewed-closeup").length === 1;
  const currentDraftLineageValid = Boolean(
    selectedContext &&
      rolesAreExact &&
      orderedShots.every((shot) => exactCurrentShotMedia(shot, selectedContext))
  );
  const currentDraftIsValid = currentDraftLineageValid;
  const missingMeasuredShots = orderedShots.filter((shot) => getMeasuredDuration(shot) === null);
  const allDurationsMeasured = rolesAreExact && missingMeasuredShots.length === 0;

  const draftPlan = useMemo(
    () =>
      buildApprovedShotPlan({
        manifest,
        context: selectedContext,
        orderedShots,
        measuredDurations,
      }),
    [manifest, measuredDurations, orderedShots, selectedContext]
  );

  const draftMatchesSavedPlan = useMemo(() => {
    if (!storedPlan || !storedPlanFreshness.isCurrent || !selectedContext || !currentDraftLineageValid) return false;
    if (storedPlan.scene_number !== selectedContext.scene.scene_number || storedPlan.line_id !== selectedContext.line.line_id) return false;
    return storedPlan.shots.map((shot) => shot.role).every((role, index) => orderedShots[index]?.role === role);
  }, [currentDraftLineageValid, orderedShots, selectedContext, storedPlan, storedPlanFreshness.isCurrent]);

  const effectiveIsSaving = Boolean(isSavingShotPlan || isSaveRequestActive);
  const draftSaveEligibility = useMemo<DraftSaveEligibility>(() => {
    if (effectiveIsSaving) {
      return { canSave: false, reason: "Saving the approved snapshot…", plan: draftPlan };
    }
    if (isPlaying) {
      return { canSave: false, reason: "Stop the local preview before saving the approved order.", plan: draftPlan };
    }
    if (isStalePreviewBlocked) {
      return { canSave: false, reason: "Start a new draft from current media before saving an order.", plan: null };
    }
    if (!onSaveShotPlan) {
      return { canSave: false, reason: "The project save bridge is not connected in this proof yet.", plan: draftPlan };
    }
    if (!selectedContext || !rolesAreExact || !currentDraftLineageValid) {
      return { canSave: false, reason: "Choose one current strict master and one current reviewed close-up for this line.", plan: null };
    }
    if (!allDurationsMeasured) {
      const missing = missingMeasuredShots.map((shot) => roleShortLabel(shot.role)).join(" and ");
      return {
        canSave: false,
        reason: `Load ${missing || "both shots"} once so both MP4 durations are measured before saving.`,
        plan: null,
      };
    }
    if (!draftPlan) {
      return { canSave: false, reason: "The current exact media lineage could not be normalized into an approved plan.", plan: null };
    }
    return { canSave: true, reason: "Both MP4 durations are measured. Saving records metadata only, never media.", plan: draftPlan };
  }, [
    allDurationsMeasured,
    currentDraftLineageValid,
    draftPlan,
    effectiveIsSaving,
    isPlaying,
    isStalePreviewBlocked,
    missingMeasuredShots,
    onSaveShotPlan,
    rolesAreExact,
    selectedContext,
  ]);

  const currentDirty = Boolean(
    hasUserEdited &&
      (storedPlan ? !draftMatchesSavedPlan : currentDraftIsValid)
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

  const handleSaveShotPlan = async () => {
    const plan = draftSaveEligibility.plan;
    if (!draftSaveEligibility.canSave || !plan || !onSaveShotPlan) return;
    setInternalSaveError(null);
    setIsSaveRequestActive(true);
    try {
      const saved = await onSaveShotPlan(plan);
      if (!saved) {
        setInternalSaveError("The project did not confirm this save. Your local shot order is still here, unchanged.");
        return;
      }
      setHasUserEdited(false);
      hydrationRef.current = { identity: `plan:${objectIdentity(plan)}`, applied: true };
      setPlaybackNotice("Approved shot plan saved. Media and existing mix players were not changed.");
    } catch (error) {
      console.error("Failed to save shot plan:", error);
      setInternalSaveError("The shot plan could not be saved. Your local order is still here, unchanged. Try again when the project is ready.");
    } finally {
      setIsSaveRequestActive(false);
    }
  };

  const saveError = shotPlanSaveError || internalSaveError;
  const hasInvalidStoredPlan = Boolean((rawStoredPlan && !storedPlan) || shotPlanValidationError);
  const savedPlanWasDismissed = Boolean(
    hasStaleStoredPlan && stalePlanDismissedIdentity === storedPlanIdentity
  );
  const statusLabel = effectiveIsSaving
    ? "Saving…"
    : saveError
      ? "Save needs attention"
      : hasStaleStoredPlan && !savedPlanWasDismissed
        ? "Saved plan unavailable/stale"
        : hasInvalidStoredPlan
          ? "Saved plan unavailable/stale"
          : storedPlan && !hasUserEdited && storedPlanFreshness.isCurrent
            ? "Saved"
            : hasUserEdited && (currentDraftIsValid || savedPlanWasDismissed || Boolean(storedPlan))
              ? "Unsaved shot order"
              : "No saved plan";
  const statusMessage = effectiveIsSaving
    ? "The project is validating the exact two-shot approval. Keep this local order open until it finishes."
    : saveError
      ? saveError
      : hasStaleStoredPlan && !savedPlanWasDismissed
        ? `${storedPlanFreshness.reason} The stored snapshot remains untouched. Start a new draft to preview current media.`
        : hasInvalidStoredPlan
          ? shotPlanValidationError || "The stored approval failed structural validation and stays out of the playable order."
          : storedPlan && !hasUserEdited && storedPlanFreshness.isCurrent
            ? "This approved order matches the current screenplay and exact master, close-up, lip-sync, and audio lineage."
            : hasUserEdited
              ? draftSaveEligibility.canSave
                ? "This local order is ready for explicit approval."
                : "This local order is still a draft. The exact current media and both measured durations are required before saving."
              : "This proof starts with a local order. Nothing is saved until you explicitly approve it.";

  const statusTone = statusLabel === "Saved"
    ? "border-emerald-500/25 bg-emerald-950/15"
    : statusLabel === "Saved plan unavailable/stale"
      ? "border-amber-500/35 bg-amber-950/20"
      : statusLabel === "Saving…"
        ? "border-sky-500/25 bg-sky-950/15"
        : statusLabel === "Save needs attention"
          ? "border-red-500/30 bg-red-950/20"
          : "border-[#2d3a54] bg-[#0d131e]";

  const missingMasterReason = selectedEntry
    ? "No strict READY ordinary Luma scene clip is saved for this scene. This proof will not use a stale clip or the close-up as a substitute."
    : "Choose a saved scene first.";
  const missingReviewedReason = describeMissingReviewedShot(
    selectedLine,
    selectedAudioTake,
    hasCloseupRecord,
    hasLipsyncRecord
  );

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-2xl border border-amber-500/[0.35] bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,0.17),transparent_43%),#121926] shadow-xl shadow-black/20">
        <div className="border-b border-amber-500/20 px-4 py-5 sm:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-xs font-mono uppercase tracking-[0.18em] text-amber-300">
                <ListOrdered className="h-4 w-4" aria-hidden="true" /> Shot Plan Proof
                <span className="rounded-md border border-amber-400/[0.35] bg-amber-500/[0.15] px-2 py-1 text-[10px] tracking-wider text-amber-100">
                  Local draft · media unchanged
                </span>
              </div>
              <h2 className="text-2xl font-serif font-bold tracking-tight text-white sm:text-3xl">
                Plan one line before assembly.
              </h2>
              <p className="max-w-2xl text-sm leading-relaxed text-gray-300">
                Review the saved master coverage and the current reviewed close-up as a short hard-cut sequence. This proof uses only exact media already saved for the selected screenplay line, and an explicit save records the approved order without rendering or replacing media.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2 rounded-xl border border-[#33415d] bg-[#0c111b]/80 px-3 py-2.5 text-xs text-gray-300">
              <ShieldCheck className="h-4 w-4 text-emerald-300" /> No media changes
            </div>
          </div>
        </div>

        <div className="grid gap-4 px-4 py-4 sm:px-6 sm:py-5 lg:grid-cols-2">
          <label className="block space-y-1.5 text-xs text-gray-300">
            <span className="font-mono uppercase tracking-wider text-gray-400">Saved scene</span>
            <select
              value={selectedSceneNumber ?? ""}
              onChange={handleSceneChange}
              disabled={!sceneEntries.length}
              className="h-11 w-full rounded-lg border border-[#33415d] bg-[#0c111b] px-3 text-sm text-gray-100 outline-none transition-colors focus:border-amber-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="" disabled>{sceneEntries.length ? "Choose a scene" : "No saved scenes"}</option>
              {sceneEntries.map((entry) => (
                <option key={entry.sceneNumber} value={entry.sceneNumber}>
                  Scene {formatScene(entry.sceneNumber)} · {entry.lines.length ? `${entry.lines.length} dialogue line${entry.lines.length === 1 ? "" : "s"}` : "No dialogue"}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1.5 text-xs text-gray-300">
            <span className="font-mono uppercase tracking-wider text-gray-400">Current dialogue line</span>
            <select
              value={selectedLineId}
              onChange={handleLineChange}
              disabled={!selectedEntry?.lines.length}
              className="h-11 w-full rounded-lg border border-[#33415d] bg-[#0c111b] px-3 text-sm text-gray-100 outline-none transition-colors focus:border-amber-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="" disabled>
                {selectedEntry?.lines.length ? "Choose a dialogue line" : "No dialogue line in this scene"}
              </option>
              {(selectedEntry?.lines || []).map((line) => (
                <option key={line.line_id} value={line.line_id}>
                  Line {String(line.order).padStart(2, "0")} · {normalizeCharacterId(line.character_id)} · {line.text.slice(0, 54)}{line.text.length > 54 ? "…" : ""}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid gap-4 border-t border-amber-500/[0.15] bg-[#0d131e]/75 px-4 py-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(240px,0.75fr)]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono uppercase tracking-[0.18em] text-amber-400">
              <Film className="h-3.5 w-3.5" aria-hidden="true" /> Exact saved line
            </div>
            {selectedLine ? (
              <>
                <p className="mt-2 text-[11px] text-gray-500">Line {String(selectedLine.order).padStart(2, "0")} · {normalizeCharacterId(selectedLine.character_id)} · {selectedLine.line_id}</p>
                <p className="mt-2 max-w-3xl font-serif text-lg italic leading-relaxed text-amber-100/90">“{selectedLine.text}”</p>
              </>
            ) : (
              <p className="mt-2 text-sm leading-relaxed text-gray-500">Select a saved dialogue line to see its exact wording and lineage.</p>
            )}
          </div>
          <div className="rounded-xl border border-[#2b3850] bg-[#0b1019] p-3.5">
            <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-gray-500">Linked audio take</p>
            <p className={`mt-2 text-sm font-medium ${selectedAudioTake ? "text-emerald-200" : "text-amber-200"}`}>
              {audioTakeIdentity(selectedAudioTake, selectedAudioTake?.audio_url || null)}
            </p>
            <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
              {selectedAudioTake
                ? selectedAudioDuration !== null
                  ? `${formatDuration(selectedAudioDuration)} saved duration${selectedAudioRunsLong ? ", longer than the five-second source window" : ", within the five-second source window"}.`
                  : "The exact take is saved, but its duration has not been measured yet."
                : "The reviewed close-up requires this exact READY take. No other audio is substituted."}
            </p>
          </div>
        </div>
      </section>

      {selectedEntry && selectedLine ? (
        <section className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-amber-400">Scene {formatScene(selectedEntry.sceneNumber)} coverage check</p>
              <h3 className="mt-1 text-xl font-serif font-bold text-white">Two roles, exact lineage</h3>
            </div>
            <p className="text-xs text-gray-500">{baseShots.length}/2 coverage roles available for this line</p>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <article className={`rounded-2xl border p-4 ${selectedMasterClip ? "border-emerald-700/[0.35] bg-emerald-950/10" : "border-amber-700/[0.35] bg-amber-950/[0.15]"}`}>
              <div className="flex items-start gap-3">
                <div className={`rounded-lg border p-2 ${selectedMasterClip ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300" : "border-amber-500/25 bg-amber-500/10 text-amber-300"}`}>
                  {selectedMasterClip ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <AlertTriangle className="h-4 w-4" aria-hidden="true" />}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-sm font-semibold text-white">Master / wide</h4>
                    <span className={`rounded-md border px-2 py-1 text-[10px] font-mono uppercase tracking-wider ${selectedMasterClip ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-amber-500/30 bg-amber-500/10 text-amber-200"}`}>
                      {selectedMasterClip ? "Available" : "Missing"}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-gray-400">
                    {selectedMasterClip
                      ? "Newest strict READY ordinary Luma scene clip. It stays muted in this proof."
                      : missingMasterReason}
                  </p>
                </div>
              </div>
            </article>

            <article className={`rounded-2xl border p-4 ${selectedReviewedCandidate ? "border-emerald-700/[0.35] bg-emerald-950/10" : "border-amber-700/[0.35] bg-amber-950/[0.15]"}`}>
              <div className="flex items-start gap-3">
                <div className={`rounded-lg border p-2 ${selectedReviewedCandidate ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300" : "border-amber-500/25 bg-amber-500/10 text-amber-300"}`}>
                  {selectedReviewedCandidate ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <AlertTriangle className="h-4 w-4" aria-hidden="true" />}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-sm font-semibold text-white">Reviewed close-up</h4>
                    <span className={`rounded-md border px-2 py-1 text-[10px] font-mono uppercase tracking-wider ${selectedReviewedCandidate ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-amber-500/30 bg-amber-500/10 text-amber-200"}`}>
                      {selectedReviewedCandidate ? "Available" : "Missing"}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-gray-400">
                    {selectedReviewedCandidate
                      ? "Current close-up source, READY lip-sync result, and exact READY audio take still match."
                      : missingReviewedReason}
                  </p>
                </div>
              </div>
            </article>
          </div>
        </section>
      ) : (
        <section className="rounded-2xl border border-[#28344c] bg-[#101622] p-5 text-sm leading-relaxed text-gray-400">
          Choose a saved scene and current dialogue line. The proof will keep unavailable roles out of the playable order until their exact media lineage is ready.
        </section>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
        <section className="min-w-0 space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-amber-400">Local shot order</p>
              <h3 className="mt-1 text-xl font-serif font-bold text-white">Hard cuts for this line</h3>
            </div>
            <p className="text-xs text-gray-500">{orderedShots.length ? "Reordering changes this proof only" : "No eligible shots to order"}</p>
          </div>

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

            {hasStaleStoredPlan && !savedPlanWasDismissed && storedPlan && (
              <div className="mt-3 flex flex-col gap-3 rounded-xl border border-amber-500/30 bg-amber-950/20 p-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[11px] leading-relaxed text-amber-100/80">
                  The saved approval is retained as history. Current media stays out of the player until you choose a fresh draft.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={startNewDraftFromCurrentMedia}
                  className="h-9 shrink-0 border-amber-400/40 bg-amber-500/10 px-3 text-[11px] text-amber-100 hover:border-amber-300 hover:bg-amber-500/20"
                >
                  Start new draft from current media
                </Button>
              </div>
            )}
          </section>

          {orderedShots.length ? (
            <div className="space-y-3">
              {orderedShots.map((shot, index) => {
                const duration = renderDuration(shot);
                const audioDuration = getAudioDuration(shot.audioTake);
                const audioRunsLong = Boolean(
                  audioDuration !== null && audioDuration > SOURCE_WINDOW_SECONDS
                );
                const isCurrent = currentShot?.key === shot.key;
                return (
                  <article key={`${shot.key}:${shotLineageToken(shot)}`} className={`overflow-hidden rounded-2xl border bg-[#101622] shadow-lg shadow-black/[0.15] ${isCurrent ? "border-amber-500/50 ring-1 ring-amber-300/[0.15]" : "border-[#263149]"}`}>
                    <div className="flex flex-col gap-3 border-b border-[#202b42] px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-amber-500/30 bg-amber-500/10 font-mono text-sm font-bold text-amber-200">
                          {String(index + 1).padStart(2, "0")}
                        </div>
                        <div className="min-w-0 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-amber-200">
                              {roleShortLabel(shot.role)}
                            </span>
                            <span className="flex items-center gap-1.5 text-[10px] text-emerald-300">
                              <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Available
                            </span>
                            {isCurrent && <span className="text-[10px] text-amber-300">Current preview shot</span>}
                          </div>
                          <h4 className="text-base font-semibold text-white">{shot.label}</h4>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5 self-end sm:self-start">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => moveShot(index, -1)}
                          disabled={isPlaying || index === 0 || orderedShots.length < 2}
                          className="h-8 gap-1 border-[#33415d] bg-[#151e2e] px-2 text-[11px] text-gray-200 hover:border-amber-500/50 hover:bg-[#1c2940] disabled:cursor-not-allowed disabled:opacity-40"
                          title="Move this shot earlier in the local proof"
                        >
                          <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" /> Earlier
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => moveShot(index, 1)}
                          disabled={isPlaying || index === orderedShots.length - 1 || orderedShots.length < 2}
                          className="h-8 gap-1 border-[#33415d] bg-[#151e2e] px-2 text-[11px] text-gray-200 hover:border-amber-500/50 hover:bg-[#1c2940] disabled:cursor-not-allowed disabled:opacity-40"
                          title="Move this shot later in the local proof"
                        >
                          Later <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                      </div>
                    </div>

                    <div className="grid gap-3 px-4 py-4 sm:px-5 lg:grid-cols-2">
                      <div className="rounded-xl border border-[#27344d] bg-[#0b1019] p-3">
                        <p className="text-[10px] font-mono uppercase tracking-wider text-gray-500">Source / reference identity</p>
                        <p className="mt-2 text-xs leading-relaxed text-gray-200">{shot.sourceIdentity}</p>
                      </div>
                      <div className="rounded-xl border border-[#27344d] bg-[#0b1019] p-3">
                        <p className="text-[10px] font-mono uppercase tracking-wider text-gray-500">Exact line</p>
                        <p className="mt-2 text-[11px] text-amber-200/80">Line {String(shot.line.order).padStart(2, "0")} · {normalizeCharacterId(shot.line.character_id)}</p>
                        <p className="mt-1 font-serif text-sm italic leading-relaxed text-gray-200">“{shot.line.text}”</p>
                      </div>
                      <div className="rounded-xl border border-[#27344d] bg-[#0b1019] p-3">
                        <p className="text-[10px] font-mono uppercase tracking-wider text-gray-500">Linked audio-take identity</p>
                        <p className={`mt-2 text-xs leading-relaxed ${shot.audioTake || shot.linkedAudioUrl ? "text-gray-200" : "text-amber-200"}`}>
                          {audioTakeIdentity(shot.audioTake, shot.linkedAudioUrl)}
                        </p>
                        <p className="mt-2 text-[10px] leading-relaxed text-gray-500">
                          The MP3 is lineage only. The reviewed MP4 supplies its own embedded audio in the player.
                        </p>
                      </div>
                      <div className="rounded-xl border border-[#27344d] bg-[#0b1019] p-3">
                        <p className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-gray-500"><Clock3 className="h-3 w-3 text-amber-400" aria-hidden="true" /> Duration</p>
                        <p className="mt-2 text-sm text-gray-200">{formatDuration(duration.value)}</p>
                        <p className="mt-1 text-[10px] leading-relaxed text-gray-500">
                          {duration.measured
                            ? "Measured from browser video metadata."
                            : shot.savedApprovalDuration
                              ? "Saved approval duration shown until this exact MP4 is measured again."
                              : shot.role === "reviewed-closeup"
                                ? "Provisional, using the saved five-second source metadata until this video loads."
                                : "Provisional, using the saved master clip duration metadata until this video loads."}
                        </p>
                      </div>
                    </div>

                    {audioRunsLong && (
                      <div className="mx-4 mb-4 flex items-start gap-2 rounded-lg border border-amber-500/[0.35] bg-amber-950/20 px-3 py-2.5 text-[11px] leading-relaxed text-amber-100 sm:mx-5">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" aria-hidden="true" />
                        <span>The exact audio take is {formatDuration(audioDuration || 0)}, longer than the five-second source window. This proof reports the overrun and never truncates it silently.</span>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-[#35425d] bg-[#101622] p-5 text-sm leading-relaxed text-gray-500">
              {isStalePreviewBlocked
                ? "The saved approval is unavailable for current media. Start a new draft from current media before previewing an order."
                : "No eligible saved media is available for this selection. Missing roles remain unavailable instead of being filled with stale or unrelated clips."}
            </div>
          )}
        </section>

        <section className="space-y-3 lg:sticky lg:top-4">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-amber-400">Local hard-cut preview</p>
            <h3 className="mt-1 text-xl font-serif font-bold text-white">Hear the reviewed MP4 in place</h3>
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
                  <p className="text-sm">{isStalePreviewBlocked ? "Start a new draft to preview current media." : "The player waits for an eligible saved shot."}</p>
                </div>
              )}
              {currentShot && (
                <div className="pointer-events-none absolute inset-x-3 top-3 flex items-start justify-between gap-2">
                  <span className="rounded-md border border-black/30 bg-black/75 px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-amber-100 backdrop-blur-sm">
                    {roleLabel(currentShot.role)}
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
              <span className="text-gray-500">{currentShot?.label || "Waiting for saved media"}</span>
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
              <p className="mt-1">Play starts only when you press Play. Master / wide stays muted. The reviewed lip-sync MP4 uses its embedded provider audio, and this proof never layers the linked MP3 underneath. Saving records only the approved order and exact lineage when enabled.</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

type ShotPlanProofMode = "one-line" | "multi-line";

function isV1SavedShotPlan(plan: SavedShotPlanSnapshot | null | undefined): plan is SavedShotPlan {
  return Boolean(plan && plan.version === 1);
}

export const ShotPlanProof: React.FC<ShotPlanProofProps> = ({
  manifest,
  videoClips = [],
  audioAssets = [],
  dialogueShotClips = [],
  lipsyncAssets = [],
  savedShotPlan = null,
  shotPlanValidationError = null,
  isSavingShotPlan = false,
  shotPlanSaveError = null,
  onSaveShotPlan,
  onShotPlanDirtyChange,
  coverageRunState,
  onRunSceneCoverage,
  onCancelSceneCoverage,
  selectedSceneNumber: controlledSelectedSceneNumber,
  onSelectedSceneNumberChange,
}) => {
  const sceneEntries = useMemo<SceneEntry[]>(() => {
    const safeScenes = Array.isArray(manifest?.scenes) ? manifest.scenes : [];
    return [...safeScenes]
      .sort((left, right) => left.scene_number - right.scene_number)
      .map((scene) => {
        let lines: DialogueLine[] = [];
        try {
          lines = deriveDialogueLines(scene);
        } catch {
          lines = [];
        }
        return {
          scene,
          sceneNumber: scene.scene_number,
          lines,
        };
      });
  }, [manifest]);

  const fallbackSceneNumber = useMemo(() => {
    const savedSceneNumber = savedShotPlan?.scene_number;
    if (
      typeof savedSceneNumber === "number" &&
      sceneEntries.some((entry) => entry.sceneNumber === savedSceneNumber)
    ) {
      return savedSceneNumber;
    }
    return sceneEntries.find((entry) => entry.lines.length > 0)?.sceneNumber ?? sceneEntries[0]?.sceneNumber ?? null;
  }, [savedShotPlan, sceneEntries]);

  const [internalSelectedSceneNumber, setInternalSelectedSceneNumber] = useState<number | null>(null);
  const selectedSceneNumber = controlledSelectedSceneNumber !== undefined
    ? controlledSelectedSceneNumber
    : internalSelectedSceneNumber;

  useEffect(() => {
    const hasValidSelection = selectedSceneNumber !== null && sceneEntries.some(
      (entry) => entry.sceneNumber === selectedSceneNumber
    );
    if (hasValidSelection) return;

    if (controlledSelectedSceneNumber !== undefined) {
      if (fallbackSceneNumber !== null && controlledSelectedSceneNumber !== fallbackSceneNumber) {
        onSelectedSceneNumberChange?.(fallbackSceneNumber);
      }
      return;
    }

    if (internalSelectedSceneNumber !== fallbackSceneNumber) {
      setInternalSelectedSceneNumber(fallbackSceneNumber);
      onSelectedSceneNumberChange?.(fallbackSceneNumber);
    }
  }, [
    controlledSelectedSceneNumber,
    fallbackSceneNumber,
    internalSelectedSceneNumber,
    onSelectedSceneNumberChange,
    sceneEntries,
    selectedSceneNumber,
  ]);

  const selectedEntry = useMemo(
    () => sceneEntries.find((entry) => entry.sceneNumber === selectedSceneNumber) || null,
    [sceneEntries, selectedSceneNumber]
  );
  const selectedSceneSupportsMultiLine = Boolean(
    selectedEntry && selectedEntry.lines.length >= 2 && selectedEntry.lines.length <= 3
  );
  const eligibleMultiLineEntries = useMemo(
    () => sceneEntries.filter((entry) => entry.lines.length >= 2 && entry.lines.length <= 3),
    [sceneEntries]
  );
  const firstEligibleMultiLineEntry = eligibleMultiLineEntries[0] || null;
  const hasEligibleMultiLineScene = Boolean(firstEligibleMultiLineEntry);
  const shouldShowMultiLineMode = selectedSceneSupportsMultiLine || hasEligibleMultiLineScene;
  const matchingSavedPlan = savedShotPlan && savedShotPlan.scene_number === selectedSceneNumber
    ? savedShotPlan
    : null;
  const savedPlanModeIdentity = matchingSavedPlan
    ? `${matchingSavedPlan.version}:${matchingSavedPlan.scene_number}:${matchingSavedPlan.approved_at}:${matchingSavedPlan.updated_at}`
    : "none";
  const defaultMode: ShotPlanProofMode = matchingSavedPlan?.version === 1
    ? "one-line"
    : matchingSavedPlan?.version === 2
      ? "multi-line"
      : selectedSceneSupportsMultiLine
        ? "multi-line"
        : "one-line";
  const [proofMode, setProofMode] = useState<ShotPlanProofMode>("one-line");
  const [multiLineModeNotice, setMultiLineModeNotice] = useState<string | null>(null);
  const modeResetRef = useRef<{ sceneNumber: number | null; savedPlanIdentity: string }>({
    sceneNumber: null,
    savedPlanIdentity: "",
  });

  useEffect(() => {
    if (
      modeResetRef.current.sceneNumber !== selectedSceneNumber ||
      modeResetRef.current.savedPlanIdentity !== savedPlanModeIdentity
    ) {
      modeResetRef.current = {
        sceneNumber: selectedSceneNumber,
        savedPlanIdentity: savedPlanModeIdentity,
      };
      setProofMode(defaultMode);
      return;
    }
    if (!selectedSceneSupportsMultiLine && proofMode !== "one-line") {
      setProofMode("one-line");
    }
  }, [
    defaultMode,
    proofMode,
    savedPlanModeIdentity,
    selectedSceneNumber,
    selectedSceneSupportsMultiLine,
  ]);

  const handleSelectedSceneNumberChange = useCallback((sceneNumber: number | null) => {
    if (controlledSelectedSceneNumber === undefined) {
      setInternalSelectedSceneNumber(sceneNumber);
    }
    onSelectedSceneNumberChange?.(sceneNumber);
    setMultiLineModeNotice(null);
  }, [controlledSelectedSceneNumber, onSelectedSceneNumberChange]);

  const handleChooseMultiLine = () => {
    if (!firstEligibleMultiLineEntry) return;
    if (!selectedSceneSupportsMultiLine) {
      handleSelectedSceneNumberChange(firstEligibleMultiLineEntry.sceneNumber);
      setMultiLineModeNotice(
        `Scene ${formatScene(firstEligibleMultiLineEntry.sceneNumber)} selected. It is the first scene in screenplay order with two or three canonical dialogue lines.`
      );
    } else {
      setMultiLineModeNotice(null);
    }
    setProofMode("multi-line");
  };

  const v1SavedPlan = isV1SavedShotPlan(savedShotPlan) ? savedShotPlan : null;

  return (
    <div className="space-y-5">
      {shouldShowMultiLineMode && (
        <section className="rounded-2xl border border-[#293650] bg-[#0d131e] p-4 shadow-lg shadow-black/[0.12] sm:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-amber-400">Shot-plan review mode</p>
              <h3 className="mt-1 text-lg font-serif font-bold text-white">Choose a shot-plan proof.</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-gray-400">
                The screenplay keeps its canonical line order. Single-line proof reviews one line at a time, while multi-line plan approves every current line as one saved scene snapshot.
              </p>
            </div>
            <div className="grid w-full gap-2 sm:grid-cols-2 lg:w-auto" role="radiogroup" aria-label="Shot-plan review mode">
              <button
                type="button"
                role="radio"
                aria-checked={proofMode === "one-line"}
                onClick={() => {
                  setMultiLineModeNotice(null);
                  setProofMode("one-line");
                }}
                className={`rounded-xl border px-4 py-3 text-left transition-colors ${proofMode === "one-line" ? "border-amber-400/60 bg-amber-500/15 text-amber-100" : "border-[#35425d] bg-[#101622] text-gray-400 hover:border-amber-500/40 hover:text-gray-200"}`}
              >
                <span className="block text-xs font-semibold">Single-line proof</span>
                <span className="mt-1 block text-[10px] leading-relaxed">Review and save one dialogue line.</span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={proofMode === "multi-line"}
                aria-label={
                  selectedSceneSupportsMultiLine
                    ? "Open multi-line plan for the selected scene"
                    : firstEligibleMultiLineEntry
                      ? `Select Scene ${formatScene(firstEligibleMultiLineEntry.sceneNumber)} and open the multi-line plan`
                      : "Multi-line plan unavailable"
                }
                aria-describedby="shot-plan-mode-guidance"
                onClick={handleChooseMultiLine}
                className={`rounded-xl border px-4 py-3 text-left transition-colors ${proofMode === "multi-line" ? "border-amber-400/60 bg-amber-500/15 text-amber-100" : "border-[#35425d] bg-[#101622] text-gray-400 hover:border-amber-500/40 hover:text-gray-200"}`}
              >
                <span className="block text-xs font-semibold">Multi-line plan</span>
                <span className="mt-1 block text-[10px] leading-relaxed">
                  {selectedSceneSupportsMultiLine
                    ? "Approve all lines in fixed order."
                    : firstEligibleMultiLineEntry
                      ? `Selects Scene ${formatScene(firstEligibleMultiLineEntry.sceneNumber)} first, then approves its canonical lines.`
                      : "Requires an eligible scene."}
                </span>
              </button>
            </div>
          </div>
          <p id="shot-plan-mode-guidance" className="mt-3 text-[11px] leading-relaxed text-amber-100/70" aria-live="polite">
            {multiLineModeNotice || (
              selectedSceneSupportsMultiLine && selectedEntry
                ? `Scene ${formatScene(selectedEntry.sceneNumber)} has ${selectedEntry.lines.length} canonical lines. Their screenplay order stays fixed.`
                : firstEligibleMultiLineEntry
                  ? `Multi-line plan will select Scene ${formatScene(firstEligibleMultiLineEntry.sceneNumber)} automatically, the first scene in screenplay order with two or three canonical dialogue lines.`
                  : ""
            )}
          </p>
        </section>
      )}

      {!hasEligibleMultiLineScene && (
        <section className="rounded-2xl border border-[#293650] bg-[#0d131e] p-4 shadow-lg shadow-black/[0.12] sm:p-5" role="status">
          <div className="flex items-start gap-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-white">Multi-line review is unavailable for this screenplay.</p>
              <p className="mt-1 text-xs leading-relaxed text-gray-400">
                Multi-line review requires a scene with exactly two or three canonical dialogue lines. Single-line proof remains available for the current screenplay.
              </p>
            </div>
          </div>
        </section>
      )}

      {proofMode === "multi-line" && selectedSceneSupportsMultiLine ? (
        <MultiLineShotPlanProof
          manifest={manifest}
          selectedSceneNumber={selectedSceneNumber}
          onSelectedSceneNumberChange={handleSelectedSceneNumberChange}
          videoClips={videoClips}
          audioAssets={audioAssets}
          dialogueShotClips={dialogueShotClips}
          lipsyncAssets={lipsyncAssets}
          savedShotPlan={savedShotPlan}
          shotPlanValidationError={shotPlanValidationError}
          isSavingShotPlan={isSavingShotPlan}
          shotPlanSaveError={shotPlanSaveError}
          onSaveShotPlan={onSaveShotPlan}
          onShotPlanDirtyChange={onShotPlanDirtyChange}
          coverageRunState={coverageRunState}
          onRunSceneCoverage={onRunSceneCoverage}
          onCancelSceneCoverage={onCancelSceneCoverage}
        />
      ) : (
        <OneLineShotPlanProof
          manifest={manifest}
          selectedSceneNumber={selectedSceneNumber}
          onSelectedSceneNumberChange={handleSelectedSceneNumberChange}
          videoClips={videoClips}
          audioAssets={audioAssets}
          dialogueShotClips={dialogueShotClips}
          lipsyncAssets={lipsyncAssets}
          savedShotPlan={v1SavedPlan}
          shotPlanValidationError={savedShotPlan?.version === 2 ? null : shotPlanValidationError}
          isSavingShotPlan={isSavingShotPlan}
          shotPlanSaveError={shotPlanSaveError}
          onSaveShotPlan={onSaveShotPlan}
          onShotPlanDirtyChange={onShotPlanDirtyChange}
        />
      )}
    </div>
  );
};
