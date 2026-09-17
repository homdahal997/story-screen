import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Film,
  ImageIcon,
  Info,
  Loader2,
  MessageCircle,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UserRound,
  Video,
  Volume2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DialogueAudioAsset,
  DialogueLine,
  DialogueShotClip,
  DialogueShotSourceFrameType,
  DramaManifest,
  DramaScene,
  FrameAsset,
  LipsyncAsset,
  PixverseLipsyncAsset,
  deriveDialogueLines,
  getLegacyDialogueLineId,
} from "@/lib/dramaStudio";
import type { LipSyncStartInput, LipSyncStatusInput } from "@/components/LipSyncProof";
import { replicateLumaVideo, ReplicateLumaVideoResponse } from "@/functions";

export interface DialogueCloseupProofProps {
  projectId: string;
  manifest: DramaManifest;
  frameAssets?: FrameAsset[];
  dialogueShotClips?: DialogueShotClip[];
  audioAssets?: DialogueAudioAsset[];
  lipsyncAssets?: LipsyncAsset[];
  isStartingLipsync?: boolean;
  lipsyncError?: string | null;
  onStartLipsync?: (input: LipSyncStartInput) => Promise<boolean | void> | boolean | void;
  onCheckLipsync?: (input: LipSyncStatusInput) => Promise<boolean | void> | boolean | void;
  pixverseLipsyncAssets?: PixverseLipsyncAsset[];
  isStartingPixverseLipsync?: boolean;
  pixverseLipsyncError?: string | null;
  onStartPixverseLipsync?: (input: PixverseLipsyncStartInput) => Promise<boolean | void> | boolean | void;
  onCheckPixverseLipsync?: (input: PixverseLipsyncStatusInput) => Promise<boolean | void> | boolean | void;
  authAvailable?: boolean;
  persistedProject?: boolean;
  isDirty?: boolean;
  isSaving?: boolean;
  isCompetingOperation?: boolean;
  onDialogueShotClipUpdate?: (
    projectId: string,
    clip: DialogueShotClip
  ) => Promise<boolean | void> | boolean | void;
}

export interface PixverseLipsyncStartInput {
  sceneNumber: number;
  lineId: string;
  characterId: string;
  text: string;
  clipPredictionId: string;
  sourceVideoUrl: string;
  sourceAudioUrl: string;
  sourceClipKind: "dialogue_closeup";
}

export interface PixverseLipsyncStatusInput {
  predictionId: string;
}

type SourceType = DialogueShotSourceFrameType;
type OperationKind = "starting" | "checking" | "archiving";
type AttemptStatus = DialogueShotClip["status"];

type CloseupContext = {
  key: string;
  projectId: string;
  sceneNumber: number;
  lineId: string;
  characterId: string;
  text: string;
  sourceFrameType: SourceType;
  sourceFrameUrl: string;
};

type SceneEntry = {
  scene: DramaScene;
  sceneNumber: number;
  lines: DialogueLine[];
};

type StatusCheckArgs = {
  predictionId: string;
  selectionKey: string;
  lifecycleRun: number;
  pollRun: number;
  automatic: boolean;
};

type StatusCheckFunction = (args: StatusCheckArgs) => Promise<boolean>;

function isSecureHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    return new URL(value.trim()).protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeCharacterId(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function formatScene(sceneNumber: number): string {
  return String(sceneNumber).padStart(2, "0");
}

function shortId(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 24) return trimmed;
  return `${trimmed.slice(0, 11)}…${trimmed.slice(-9)}`;
}

function mediaTimestamp(value: { updated_at?: string; created_at?: string }): number {
  const updated = Date.parse(value.updated_at || "");
  if (Number.isFinite(updated)) return updated;
  const created = Date.parse(value.created_at || "");
  return Number.isFinite(created) ? created : 0;
}

function formatAttemptDate(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Saved attempt";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

function attemptLabel(status: AttemptStatus): string {
  if (status === "QUEUED") return "Queued";
  if (status === "PROCESSING") return "Rendering";
  if (status === "READY") return "Ready";
  if (status === "CANCELED") return "Canceled";
  return "Failed";
}

function attemptClass(status: AttemptStatus): string {
  if (status === "READY") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-100";
  if (status === "QUEUED" || status === "PROCESSING") return "border-amber-500/35 bg-amber-500/10 text-amber-100";
  return "border-red-500/30 bg-red-950/20 text-red-200";
}

function statusDotClass(status: AttemptStatus): string {
  if (status === "READY") return "bg-emerald-300";
  if (status === "QUEUED" || status === "PROCESSING") return "bg-amber-300";
  return "bg-red-300";
}

function sourceLabel(sourceType: SourceType): string {
  return sourceType === "character_reference" ? "Character reference" : "Scene storyboard";
}

function sourceShortLabel(sourceType: SourceType): string {
  return sourceType === "character_reference" ? "Character" : "Storyboard";
}

function readableError(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const message = raw.trim();
  if (!message || /api[_ -]?key|secret|bearer|authorization|token/i.test(message) || /https?:\/\//i.test(message)) {
    return fallback;
  }
  return message.slice(0, 600);
}

function clipMatchesContext(clip: DialogueShotClip, context: CloseupContext): boolean {
  return (
    clip.shot_role === "dialogue_closeup" &&
    clip.scene_number === context.sceneNumber &&
    clip.line_id === context.lineId &&
    clip.character_id === context.characterId &&
    clip.text === context.text &&
    clip.source_frame_type === context.sourceFrameType &&
    clip.source_frame_url === context.sourceFrameUrl &&
    clip.duration_seconds === 5
  );
}

function isActiveStatus(status: AttemptStatus | undefined): boolean {
  return status === "QUEUED" || status === "PROCESSING";
}

function getAudioLineId(asset: DialogueAudioAsset): string {
  return asset.line_id?.trim() || getLegacyDialogueLineId(asset.scene_number);
}

function lipsyncAttemptLabel(status: LipsyncAsset["status"]): string {
  if (status === "PROCESSING") return "Rendering";
  if (status === "READY") return "Ready";
  if (status === "CANCELED") return "Canceled";
  return "Failed";
}

function lipsyncAttemptClass(status: LipsyncAsset["status"]): string {
  if (status === "PROCESSING") return "border-amber-500/35 bg-amber-500/10 text-amber-100";
  if (status === "READY") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-100";
  return "border-red-500/30 bg-red-950/20 text-red-200";
}

function lipsyncStatusDotClass(status: LipsyncAsset["status"]): string {
  if (status === "PROCESSING") return "bg-amber-300";
  if (status === "READY") return "bg-emerald-300";
  return "bg-red-300";
}

function validateAuthoritativeClip(
  value: unknown,
  context: CloseupContext,
  expectedPredictionId?: string
): DialogueShotClip {
  if (!value || typeof value !== "object") {
    throw new Error("The close-up service returned no saved attempt. Earlier source media remains safe.");
  }
  const candidate = value as Partial<DialogueShotClip>;
  const predictionId = typeof candidate.prediction_id === "string" ? candidate.prediction_id.trim() : "";
  if (!predictionId || (expectedPredictionId && predictionId !== expectedPredictionId)) {
    throw new Error("The close-up service returned a different prediction. The saved attempt remains unchanged.");
  }
  if (
    typeof candidate.provider !== "string" ||
    candidate.provider.trim() !== "replicate-luma" ||
    candidate.shot_role !== "dialogue_closeup" ||
    candidate.scene_number !== context.sceneNumber ||
    candidate.line_id !== context.lineId ||
    candidate.character_id !== context.characterId ||
    candidate.text !== context.text ||
    candidate.source_frame_type !== context.sourceFrameType ||
    candidate.source_frame_url !== context.sourceFrameUrl ||
    candidate.duration_seconds !== 5 ||
    !["QUEUED", "PROCESSING", "READY", "FAILED", "CANCELED"].includes(candidate.status as string) ||
    typeof candidate.created_at !== "string" ||
    typeof candidate.updated_at !== "string"
  ) {
    throw new Error("The close-up service returned a different saved lineage. The existing proof history remains safe.");
  }
  if (candidate.status === "READY" && !isSecureHttpsUrl(candidate.video_url)) {
    throw new Error("The close-up service marked an attempt ready without a secure private video. The attempt remains unchanged.");
  }
  if (candidate.status !== "READY" && candidate.video_url) {
    throw new Error("The close-up service returned a video before private archiving completed. The attempt remains unchanged.");
  }
  return candidate as DialogueShotClip;
}

function responsePredictionId(response: ReplicateLumaVideoResponse): string | null {
  if (typeof response.prediction_id !== "string" || !response.prediction_id.trim()) return null;
  return response.prediction_id.trim();
}

const ImagePreview: React.FC<{
  url: string | null;
  alt: string;
  className?: string;
}> = ({ url, alt, className = "" }) => {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setFailed(false);
    setLoaded(false);
  }, [url]);

  if (!url || !isSecureHttpsUrl(url)) {
    return (
      <div className={`flex items-center justify-center bg-[#090c12] text-gray-600 ${className}`}>
        <ImageIcon className="h-7 w-7" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden bg-[#090c12] ${className}`}>
      {!failed ? (
        <img
          src={url}
          alt={alt}
          loading="lazy"
          className={`h-full w-full object-cover transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="flex h-full items-center justify-center px-4 text-center text-[11px] leading-relaxed text-gray-500">
          The saved image is unavailable in this tab.
        </div>
      )}
      {!failed && !loaded && (
        <div className="absolute inset-0 flex items-center justify-center text-[10px] text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin text-amber-400" aria-label="Loading saved image" />
        </div>
      )}
    </div>
  );
};

export const DialogueCloseupProof: React.FC<DialogueCloseupProofProps> = ({
  projectId,
  manifest,
  frameAssets = [],
  dialogueShotClips = [],
  audioAssets = [],
  lipsyncAssets = [],
  isStartingLipsync = false,
  lipsyncError = null,
  onStartLipsync,
  onCheckLipsync,
  pixverseLipsyncAssets = [],
  isStartingPixverseLipsync = false,
  pixverseLipsyncError = null,
  onStartPixverseLipsync,
  onCheckPixverseLipsync,
  authAvailable = false,
  persistedProject = false,
  isDirty = false,
  isSaving = false,
  isCompetingOperation = false,
  onDialogueShotClipUpdate,
}) => {
  const [selectedSceneNumber, setSelectedSceneNumber] = useState<number | null>(null);
  const [selectedLineId, setSelectedLineId] = useState("");
  const [sourceFrameType, setSourceFrameType] = useState<SourceType>("character_reference");
  const [activePredictionId, setActivePredictionId] = useState<string | null>(null);
  const [pausedPredictionId, setPausedPredictionId] = useState<string | null>(null);
  const [operation, setOperation] = useState<OperationKind | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [selectedLipsyncAudioUrl, setSelectedLipsyncAudioUrl] = useState("");
  const [lipsyncPollError, setLipsyncPollError] = useState<string | null>(null);
  const [manualLipsyncCheckId, setManualLipsyncCheckId] = useState<string | null>(null);
  const [pausedLipsyncPredictionIds, setPausedLipsyncPredictionIds] = useState<string[]>([]);
  const [pixversePollError, setPixversePollError] = useState<string | null>(null);
  const [manualPixverseCheckId, setManualPixverseCheckId] = useState<string | null>(null);
  const [pausedPixversePredictionIds, setPausedPixversePredictionIds] = useState<string[]>([]);

  const mountedRef = useRef(true);
  const lifecycleRunRef = useRef(0);
  const operationLockRef = useRef(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRunRef = useRef(0);
  const pollTargetRef = useRef<{ predictionId: string; selectionKey: string; lifecycleRun: number; pollRun: number } | null>(null);
  const activePredictionRef = useRef<string | null>(null);
  const selectionKeyRef = useRef("");
  const contextRef = useRef<CloseupContext | null>(null);
  const attemptsRef = useRef<DialogueShotClip[]>([]);
  const updateClipRef = useRef(onDialogueShotClipUpdate);
  const statusCheckRef = useRef<StatusCheckFunction | null>(null);
  const lipsyncCheckRef = useRef(onCheckLipsync);
  const lipsyncPollTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const lipsyncPollRunsRef = useRef<Record<string, number>>({});
  const lipsyncPollInFlightRef = useRef<Set<string>>(new Set());
  const lipsyncSelectionKeyRef = useRef("");
  const lipsyncAssetsRef = useRef<LipsyncAsset[]>([]);
  const pixverseCheckRef = useRef(onCheckPixverseLipsync);
  const pixversePollTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pixversePollRunsRef = useRef<Record<string, number>>({});
  const pixversePollInFlightRef = useRef<Set<string>>(new Set());
  const pixverseSelectionKeyRef = useRef("");
  const pixverseAssetsRef = useRef<PixverseLipsyncAsset[]>([]);

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

  const safeFrameAssets = useMemo(
    () => (Array.isArray(frameAssets) ? frameAssets : []).filter((asset) => isSecureHttpsUrl(asset.image_url)),
    [frameAssets]
  );

  const allAttempts = useMemo(
    () =>
      (Array.isArray(dialogueShotClips) ? dialogueShotClips : [])
        .filter((clip) => clip && clip.shot_role === "dialogue_closeup")
        .sort((left, right) => mediaTimestamp(right) - mediaTimestamp(left)),
    [dialogueShotClips]
  );

  useEffect(() => {
    updateClipRef.current = onDialogueShotClipUpdate;
  }, [onDialogueShotClipUpdate]);

  useEffect(() => {
    lipsyncCheckRef.current = onCheckLipsync;
  }, [onCheckLipsync]);

  useEffect(() => {
    pixverseCheckRef.current = onCheckPixverseLipsync;
  }, [onCheckPixverseLipsync]);

  useEffect(() => {
    attemptsRef.current = allAttempts;
  }, [allAttempts]);

  useEffect(() => {
    lipsyncAssetsRef.current = Array.isArray(lipsyncAssets) ? lipsyncAssets : [];
  }, [lipsyncAssets]);

  useEffect(() => {
    pixverseAssetsRef.current = Array.isArray(pixverseLipsyncAssets) ? pixverseLipsyncAssets : [];
  }, [pixverseLipsyncAssets]);

  useEffect(() => {
    return () => {
      Object.values(lipsyncPollTimersRef.current).forEach((timer) => clearTimeout(timer));
      lipsyncPollTimersRef.current = {};
      lipsyncPollRunsRef.current = {};
      lipsyncPollInFlightRef.current.clear();
      Object.values(pixversePollTimersRef.current).forEach((timer) => clearTimeout(timer));
      pixversePollTimersRef.current = {};
      pixversePollRunsRef.current = {};
      pixversePollInFlightRef.current.clear();
    };
  }, []);

  useEffect(() => {
    setSelectedSceneNumber((current) => {
      const currentEntry = sceneEntries.find((entry) => entry.sceneNumber === current);
      if (currentEntry && currentEntry.lines.length > 0) return current;
      return sceneEntries.find((entry) => entry.lines.length > 0)?.sceneNumber ?? sceneEntries[0]?.sceneNumber ?? null;
    });
  }, [sceneEntries]);

  const selectedEntry = useMemo(
    () => sceneEntries.find((entry) => entry.sceneNumber === selectedSceneNumber) || null,
    [sceneEntries, selectedSceneNumber]
  );

  useEffect(() => {
    const lines = selectedEntry?.lines || [];
    setSelectedLineId((current) => (current && lines.some((line) => line.line_id === current) ? current : lines[0]?.line_id || ""));
  }, [selectedEntry]);

  useEffect(() => {
    setSourceFrameType("character_reference");
  }, [selectedSceneNumber, selectedLineId]);

  const selectedLine = selectedEntry?.lines.find((line) => line.line_id === selectedLineId) || null;
  const selectedCharacterId = normalizeCharacterId(selectedLine?.character_id);
  const selectedStoryboard = selectedEntry
    ? safeFrameAssets.find(
        (asset) =>
          asset.asset_type === "scene_storyboard" &&
          asset.scene_number === selectedEntry.sceneNumber
      ) || null
    : null;
  const selectedCharacterReference = selectedCharacterId
    ? safeFrameAssets.find(
        (asset) =>
          asset.asset_type === "character_reference" &&
          normalizeCharacterId(asset.character_id) === selectedCharacterId
      ) || null
    : null;

  const selectedSourceAsset = sourceFrameType === "character_reference" ? selectedCharacterReference : selectedStoryboard;
  const fallbackSourceAsset = sourceFrameType === "character_reference" ? selectedStoryboard : selectedCharacterReference;
  const effectiveSourceType = selectedSourceAsset
    ? sourceFrameType
    : fallbackSourceAsset
      ? sourceFrameType === "character_reference" ? "scene_storyboard" : "character_reference"
      : null;
  const effectiveSourceAsset = selectedSourceAsset || fallbackSourceAsset;

  const selectionKey = JSON.stringify([
    projectId,
    selectedEntry?.sceneNumber ?? null,
    selectedLine?.line_id ?? "",
    selectedLine?.character_id ?? "",
    selectedLine?.text ?? "",
    effectiveSourceType || "",
    effectiveSourceAsset?.image_url || "",
  ]);

  const selectedContext: CloseupContext | null =
    projectId &&
    selectedEntry &&
    selectedLine &&
    effectiveSourceType &&
    effectiveSourceAsset &&
    isSecureHttpsUrl(effectiveSourceAsset.image_url)
      ? {
          key: selectionKey,
          projectId,
          sceneNumber: selectedEntry.sceneNumber,
          lineId: selectedLine.line_id,
          characterId: selectedLine.character_id,
          text: selectedLine.text,
          sourceFrameType: effectiveSourceType,
          sourceFrameUrl: effectiveSourceAsset.image_url.trim(),
        }
      : null;

  selectionKeyRef.current = selectionKey;
  contextRef.current = selectedContext;

  useEffect(() => {
    lifecycleRunRef.current += 1;
    activePredictionRef.current = null;
    setActivePredictionId(null);
    setPausedPredictionId(null);
    setPollError(null);
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    pollRunRef.current += 1;
    pollTargetRef.current = null;
  }, [selectionKey]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      lifecycleRunRef.current += 1;
      pollRunRef.current += 1;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
      pollTargetRef.current = null;
      activePredictionRef.current = null;
      operationLockRef.current = false;
    };
  }, []);

  const matchingAttempts = useMemo(
    () => (selectedContext ? allAttempts.filter((clip) => clipMatchesContext(clip, selectedContext)) : []),
    [allAttempts, selectedContext]
  );
  const latestMatchingAttempt = matchingAttempts[0] || null;
  const pendingMatchingAttempt = matchingAttempts.find((clip) => isActiveStatus(clip.status)) || null;
  const currentTargetId = activePredictionId || pendingMatchingAttempt?.prediction_id || null;
  const currentTargetAttempt = currentTargetId
    ? allAttempts.find((clip) => clip.prediction_id === currentTargetId) || null
    : null;
  const lineActiveAttempt = selectedContext
    ? allAttempts.find(
        (clip) =>
          isActiveStatus(clip.status) &&
          clip.scene_number === selectedContext.sceneNumber &&
          clip.line_id === selectedContext.lineId &&
          clip.character_id === selectedContext.characterId &&
          clip.text === selectedContext.text
      ) || null
    : null;
  const readyAttempts = allAttempts.filter(
    (clip) => clip.status === "READY" && isSecureHttpsUrl(clip.video_url)
  );
  const readyMatchingAttempts = matchingAttempts.filter(
    (clip) => clip.status === "READY" && isSecureHttpsUrl(clip.video_url)
  );
  const selectedReadyCloseup = readyMatchingAttempts[0] || null;
  const matchingAudioTakes = useMemo(() => {
    if (!selectedContext) return [];
    return [...(Array.isArray(audioAssets) ? audioAssets : [])]
      .filter(
        (asset) =>
          asset.asset_type === "dialogue" &&
          asset.provider === "elevenlabs" &&
          asset.status === "READY" &&
          asset.scene_number === selectedContext.sceneNumber &&
          getAudioLineId(asset) === selectedContext.lineId &&
          asset.character_id === selectedContext.characterId &&
          asset.text === selectedContext.text &&
          asset.content_type === "audio/mpeg" &&
          isSecureHttpsUrl(asset.audio_url)
      )
      .sort((left, right) => mediaTimestamp(right) - mediaTimestamp(left));
  }, [audioAssets, selectedContext]);

  const closeupLipsyncSelectionKey = JSON.stringify([
    selectedReadyCloseup?.prediction_id || "",
    selectedReadyCloseup?.video_url || "",
    selectedContext?.sceneNumber ?? null,
    selectedContext?.lineId || "",
    selectedContext?.characterId || "",
    selectedContext?.text || "",
    selectedLipsyncAudioUrl,
  ]);
  lipsyncSelectionKeyRef.current = closeupLipsyncSelectionKey;
  pixverseSelectionKeyRef.current = closeupLipsyncSelectionKey;

  const matchingCloseupLipsyncAttempts = useMemo(() => {
    if (!selectedContext || !selectedReadyCloseup || !selectedLipsyncAudioUrl || !isSecureHttpsUrl(selectedReadyCloseup.video_url)) return [];
    return [...(Array.isArray(lipsyncAssets) ? lipsyncAssets : [])]
      .filter(
        (asset) =>
          (asset.provider === "replicate-lipsync" || asset.provider === "pixverse-lipsync") &&
          asset.scene_number === selectedContext.sceneNumber &&
          asset.line_id === selectedContext.lineId &&
          asset.character_id === selectedContext.characterId &&
          asset.text === selectedContext.text &&
          asset.source_clip_prediction_id === selectedReadyCloseup.prediction_id &&
          asset.source_video_url === selectedReadyCloseup.video_url &&
          asset.source_audio_url === selectedLipsyncAudioUrl &&
          asset.source_audio_content_type === "audio/mpeg"
      )
      .sort((left, right) => mediaTimestamp(right) - mediaTimestamp(left));
  }, [lipsyncAssets, selectedContext, selectedReadyCloseup, selectedLipsyncAudioUrl]);
  const processingCloseupLipsyncAttempts = matchingCloseupLipsyncAttempts.filter((asset) => asset.status === "PROCESSING");
  const selectedLipsyncAudio = matchingAudioTakes.find((asset) => asset.audio_url === selectedLipsyncAudioUrl) || null;
  const matchingPixverseLipsyncAttempts = useMemo(() => {
    if (!selectedContext || !selectedReadyCloseup || !selectedLipsyncAudioUrl || !isSecureHttpsUrl(selectedReadyCloseup.video_url)) return [];
    return [...(Array.isArray(pixverseLipsyncAssets) ? pixverseLipsyncAssets : [])]
      .filter(
        (asset) =>
          asset.provider === "pixverse-lipsync" &&
          asset.scene_number === selectedContext.sceneNumber &&
          asset.line_id === selectedContext.lineId &&
          asset.character_id === selectedContext.characterId &&
          asset.text === selectedContext.text &&
          asset.source_clip_prediction_id === selectedReadyCloseup.prediction_id &&
          asset.source_video_url === selectedReadyCloseup.video_url &&
          asset.source_audio_url === selectedLipsyncAudioUrl &&
          asset.source_audio_content_type === "audio/mpeg"
      )
      .sort((left, right) => mediaTimestamp(right) - mediaTimestamp(left));
  }, [pixverseLipsyncAssets, selectedContext, selectedReadyCloseup, selectedLipsyncAudioUrl]);
  const processingPixverseLipsyncAttempts = matchingPixverseLipsyncAttempts.filter((asset) => asset.status === "PROCESSING");
  const selectedSyncReadyAttempt = matchingCloseupLipsyncAttempts.find(
    (asset) => asset.provider === "replicate-lipsync" && asset.status === "READY" && isSecureHttpsUrl(asset.video_url)
  ) || null;
  const selectedPixverseReadyAttempt = matchingPixverseLipsyncAttempts.find(
    (asset) => asset.status === "READY" && isSecureHttpsUrl(asset.video_url)
  ) || null;

  useEffect(() => {
    setPixversePollError(null);
    setManualPixverseCheckId(null);
    setPausedPixversePredictionIds([]);
    Object.values(pixversePollTimersRef.current).forEach((timer) => clearTimeout(timer));
    pixversePollTimersRef.current = {};
    pixversePollRunsRef.current = {};
    pixversePollInFlightRef.current.clear();
  }, [closeupLipsyncSelectionKey]);

  useEffect(() => {
    setSelectedLipsyncAudioUrl("");
    setLipsyncPollError(null);
    setPausedLipsyncPredictionIds([]);
  }, [selectionKey, selectedReadyCloseup?.prediction_id]);

  useEffect(() => {
    setLipsyncPollError(null);
    setPausedLipsyncPredictionIds([]);
  }, [selectedLipsyncAudioUrl]);

  const blockingReason = !authAvailable
    ? "Sign in before creating a private dialogue close-up."
    : !persistedProject || !projectId
      ? "Save this approved project before creating a private close-up."
      : isDirty
        ? "Save screenplay edits before using the approved scene and dialogue."
        : isSaving
          ? "The proof is paused while the project is saving."
          : isCompetingOperation
            ? "The proof is paused while another studio operation is running."
            : !selectedEntry
              ? "Choose a saved screenplay scene to continue."
              : !selectedLine
                ? "This scene has no approved dialogue line to select."
                : !effectiveSourceAsset || !effectiveSourceType
                  ? "Save a scene storyboard or the selected speaker's character reference first."
                  : null;

  const startReason = lineActiveAttempt
    ? lineActiveAttempt.source_frame_url === selectedContext?.sourceFrameUrl
      ? "This exact scene and line already have a close-up rendering. Check its saved status instead."
      : "Another close-up is rendering for this line. Return to its original source selection before checking it."
    : blockingReason;

  const canStart = Boolean(
    onDialogueShotClipUpdate &&
    selectedContext &&
    !blockingReason &&
    !lineActiveAttempt &&
    !operation
  );

  const closeupLipsyncPendingAttempt = matchingCloseupLipsyncAttempts.find((asset) => asset.status === "PROCESSING") || null;
  const closeupLipsyncBlockingReason = !authAvailable
    ? "Sign in before lip-syncing a private close-up."
    : !persistedProject || !projectId
      ? "Save this approved project before lip-syncing the close-up."
      : isDirty
        ? "Save screenplay edits before using the saved close-up and dialogue take."
        : isSaving
          ? "The close-up lip-sync proof is paused while the project is saving."
          : isCompetingOperation
            ? "The close-up lip-sync proof is paused while another studio operation is running."
            : isStartingLipsync
              ? "The close-up lip-sync render is being started."
              : !selectedReadyCloseup
                ? "Create and review a READY close-up before lip-syncing it."
                : !matchingAudioTakes.length
                  ? "Save an exact READY ElevenLabs MP3 for this approved line first."
                  : !selectedLipsyncAudio
                    ? "Choose the exact saved MP3 take that will drive this close-up."
                    : closeupLipsyncPendingAttempt
                      ? "This close-up and exact audio take are already rendering. Check its saved status instead."
                      : null;
  const canStartCloseupLipsync = Boolean(
    onStartLipsync &&
    selectedContext &&
    selectedReadyCloseup &&
    selectedLipsyncAudio &&
    isSecureHttpsUrl(selectedReadyCloseup.video_url) &&
    !closeupLipsyncBlockingReason
  );

  const pixversePendingAttempt = matchingPixverseLipsyncAttempts.find((asset) => asset.status === "PROCESSING") || null;
  const pixverseBlockingReason = !onStartPixverseLipsync || !onCheckPixverseLipsync
    ? "PixVerse comparison is unavailable in this studio session."
    : !authAvailable
    ? "Sign in before rendering a private PixVerse comparison."
    : !persistedProject || !projectId
      ? "Save this approved project before rendering the comparison."
      : isDirty
        ? "Save screenplay edits before rendering from the approved close-up and dialogue take."
        : isSaving
          ? "The PixVerse comparison is paused while the project is saving."
          : isCompetingOperation
            ? "The PixVerse comparison is paused while another studio operation is running."
            : operation !== null
              ? "Finish the current source-shot operation before starting a PixVerse comparison."
              : isStartingPixverseLipsync
              ? "The PixVerse comparison is being started."
              : !selectedReadyCloseup
                ? "Create and review a READY close-up before comparing providers."
                : !selectedLipsyncAudio
                  ? matchingAudioTakes.length
                    ? "Choose the exact saved MP3 take for this comparison."
                    : "Save an exact READY ElevenLabs MP3 for this approved line first."
                  : pixversePendingAttempt
                    ? "This exact close-up and MP3 are already rendering in PixVerse. Check its saved status instead."
                    : null;
  const canStartPixverseLipsync = Boolean(
    onStartPixverseLipsync &&
    selectedContext &&
    selectedReadyCloseup &&
    selectedLipsyncAudio &&
    isSecureHttpsUrl(selectedReadyCloseup.video_url) &&
    !pixverseBlockingReason
  );

  const clearPixversePollTimer = (predictionId: string) => {
    const timer = pixversePollTimersRef.current[predictionId];
    if (timer) clearTimeout(timer);
    delete pixversePollTimersRef.current[predictionId];
  };

  const isCurrentPixversePoll = (predictionId: string, selectionKey: string, runId: number): boolean =>
    mountedRef.current &&
    pixverseSelectionKeyRef.current === selectionKey &&
    pixversePollRunsRef.current[predictionId] === runId;

  const markPixversePaused = (predictionId: string) => {
    setPausedPixversePredictionIds((current) => current.includes(predictionId) ? current : [...current, predictionId]);
  };

  const clearPixversePaused = (predictionId: string) => {
    setPausedPixversePredictionIds((current) => current.filter((id) => id !== predictionId));
  };

  const runPixverseStatusCheck = async (
    predictionId: string,
    selectionKey: string,
    runId: number,
    automatic: boolean
  ): Promise<boolean> => {
    if (!isCurrentPixversePoll(predictionId, selectionKey, runId)) return false;
    if (pixversePollInFlightRef.current.has(predictionId)) return false;
    const currentAsset = pixverseAssetsRef.current.find(
      (asset) => asset.provider === "pixverse-lipsync" && asset.prediction_id === predictionId
    );
    if (!currentAsset || currentAsset.status !== "PROCESSING") return false;
    const check = pixverseCheckRef.current;
    if (!check) return false;
    if (!authAvailable || !persistedProject || isDirty || isSaving || isCompetingOperation || operation !== null) {
      if (!automatic && isCurrentPixversePoll(predictionId, selectionKey, runId)) {
        setPixversePollError("Wait for the current studio operation to finish, then use Check status again.");
      }
      return false;
    }

    pixversePollInFlightRef.current.add(predictionId);
    if (!automatic) setManualPixverseCheckId(predictionId);
    try {
      const result = await check({ predictionId });
      if (!isCurrentPixversePoll(predictionId, selectionKey, runId)) return false;
      if (result === false) {
        clearPixversePollTimer(predictionId);
        markPixversePaused(predictionId);
        setPixversePollError("The latest PixVerse status could not be checked. The saved comparison is safe. Use Check status to recover without starting another render.");
        return false;
      }
      clearPixversePaused(predictionId);
      setPixversePollError(null);
      return true;
    } catch {
      if (isCurrentPixversePoll(predictionId, selectionKey, runId)) {
        clearPixversePollTimer(predictionId);
        markPixversePaused(predictionId);
        setPixversePollError("The latest PixVerse status could not be checked. The saved comparison is safe. Use Check status to recover without starting another render.");
      }
      return false;
    } finally {
      pixversePollInFlightRef.current.delete(predictionId);
      if (!automatic && mountedRef.current) setManualPixverseCheckId(null);
    }
  };

  const handleManualPixverseCheck = async (predictionId: string) => {
    if (!onCheckPixverseLipsync || !selectedReadyCloseup || !selectedLipsyncAudio) return;
    clearPixversePollTimer(predictionId);
    clearPixversePaused(predictionId);
    const runId = (pixversePollRunsRef.current[predictionId] || 0) + 1;
    pixversePollRunsRef.current[predictionId] = runId;
    setPixversePollError(null);
    await runPixverseStatusCheck(predictionId, closeupLipsyncSelectionKey, runId, false);
  };

  const handleStartPixverseComparison = async () => {
    if (!canStartPixverseLipsync || !selectedContext || !selectedReadyCloseup || !selectedLipsyncAudio || !onStartPixverseLipsync) return;
    setPixversePollError(null);
    const result = await onStartPixverseLipsync({
      sceneNumber: selectedContext.sceneNumber,
      lineId: selectedContext.lineId,
      characterId: selectedContext.characterId,
      text: selectedContext.text,
      clipPredictionId: selectedReadyCloseup.prediction_id,
      sourceVideoUrl: selectedReadyCloseup.video_url as string,
      sourceAudioUrl: selectedLipsyncAudio.audio_url,
      sourceClipKind: "dialogue_closeup",
    });
    if (result === false) {
      setPixversePollError("The PixVerse comparison did not start. The READY source and exact audio take remain safe, so review the message and try again when ready.");
    }
  };

  useEffect(() => {
    const processingIds = new Set(processingPixverseLipsyncAttempts.map((asset) => asset.prediction_id));
    Object.keys(pixversePollTimersRef.current).forEach((predictionId) => {
      if (!processingIds.has(predictionId)) clearPixversePollTimer(predictionId);
    });

    const pollBlocked = Boolean(
      !onCheckPixverseLipsync ||
      !selectedReadyCloseup ||
      !selectedLipsyncAudio ||
      !authAvailable ||
      !persistedProject ||
      isDirty ||
      isSaving ||
      isCompetingOperation ||
      operation !== null
    );
    if (pollBlocked) return;

    processingPixverseLipsyncAttempts.forEach((attempt) => {
      if (pausedPixversePredictionIds.includes(attempt.prediction_id)) return;
      const predictionId = attempt.prediction_id;
      const runId = (pixversePollRunsRef.current[predictionId] || 0) + 1;
      pixversePollRunsRef.current[predictionId] = runId;
      clearPixversePollTimer(predictionId);
      pixversePollTimersRef.current[predictionId] = setTimeout(() => {
        delete pixversePollTimersRef.current[predictionId];
        void runPixverseStatusCheck(predictionId, closeupLipsyncSelectionKey, runId, true);
      }, 900);
    });

    return () => {
      processingIds.forEach((predictionId) => {
        clearPixversePollTimer(predictionId);
        pixversePollRunsRef.current[predictionId] = (pixversePollRunsRef.current[predictionId] || 0) + 1;
      });
    };
  }, [
    authAvailable,
    closeupLipsyncSelectionKey,
    isCompetingOperation,
    isDirty,
    isSaving,
    onCheckPixverseLipsync,
    operation,
    pausedPixversePredictionIds,
    persistedProject,
    processingPixverseLipsyncAttempts.map((asset) => asset.prediction_id).join(","),
    selectedLipsyncAudioUrl,
    selectedReadyCloseup?.prediction_id,
  ]);

  const clearCloseupLipsyncTimer = (predictionId: string) => {
    const timer = lipsyncPollTimersRef.current[predictionId];
    if (timer) clearTimeout(timer);
    delete lipsyncPollTimersRef.current[predictionId];
  };

  const isCurrentCloseupLipsyncPoll = (predictionId: string, selectionKey: string, runId: number): boolean =>
    mountedRef.current &&
    lipsyncSelectionKeyRef.current === selectionKey &&
    lipsyncPollRunsRef.current[predictionId] === runId;

  const markCloseupLipsyncPaused = (predictionId: string) => {
    setPausedLipsyncPredictionIds((current) => current.includes(predictionId) ? current : [...current, predictionId]);
  };

  const clearCloseupLipsyncPaused = (predictionId: string) => {
    setPausedLipsyncPredictionIds((current) => current.filter((id) => id !== predictionId));
  };

  const runCloseupLipsyncStatusCheck = async (
    predictionId: string,
    selectionKey: string,
    runId: number,
    automatic: boolean
  ): Promise<boolean> => {
    if (!isCurrentCloseupLipsyncPoll(predictionId, selectionKey, runId)) return false;
    if (lipsyncPollInFlightRef.current.has(predictionId)) return false;
    const currentAsset = lipsyncAssetsRef.current.find((asset) => asset.prediction_id === predictionId);
    if (!currentAsset || currentAsset.status !== "PROCESSING") return false;
    const check = lipsyncCheckRef.current;
    if (!check) return false;

    lipsyncPollInFlightRef.current.add(predictionId);
    if (!automatic) setManualLipsyncCheckId(predictionId);
    try {
      const result = await check({ predictionId });
      if (!isCurrentCloseupLipsyncPoll(predictionId, selectionKey, runId)) return false;
      if (result === false) {
        clearCloseupLipsyncTimer(predictionId);
        markCloseupLipsyncPaused(predictionId);
        setLipsyncPollError("The latest close-up lip-sync status could not be checked. The saved attempt is safe. Use Check status to recover without starting another render.");
        return false;
      }
      clearCloseupLipsyncPaused(predictionId);
      setLipsyncPollError(null);
      return true;
    } catch {
      if (isCurrentCloseupLipsyncPoll(predictionId, selectionKey, runId)) {
        clearCloseupLipsyncTimer(predictionId);
        markCloseupLipsyncPaused(predictionId);
        setLipsyncPollError("The latest close-up lip-sync status could not be checked. The saved attempt is safe. Use Check status to recover without starting another render.");
      }
      return false;
    } finally {
      lipsyncPollInFlightRef.current.delete(predictionId);
      if (!automatic && mountedRef.current) setManualLipsyncCheckId(null);
    }
  };

  useEffect(() => {
    const processingIds = new Set(processingCloseupLipsyncAttempts.map((asset) => asset.prediction_id));
    Object.keys(lipsyncPollTimersRef.current).forEach((predictionId) => {
      if (!processingIds.has(predictionId)) clearCloseupLipsyncTimer(predictionId);
    });

    const pollBlocked = Boolean(
      !onCheckLipsync ||
      !selectedReadyCloseup ||
      !selectedLipsyncAudio ||
      !authAvailable ||
      !persistedProject ||
      isDirty ||
      isSaving ||
      isCompetingOperation
    );
    if (pollBlocked) return;

    processingCloseupLipsyncAttempts.forEach((attempt) => {
      if (pausedLipsyncPredictionIds.includes(attempt.prediction_id)) return;
      const predictionId = attempt.prediction_id;
      const runId = (lipsyncPollRunsRef.current[predictionId] || 0) + 1;
      lipsyncPollRunsRef.current[predictionId] = runId;
      clearCloseupLipsyncTimer(predictionId);
      lipsyncPollTimersRef.current[predictionId] = setTimeout(() => {
        delete lipsyncPollTimersRef.current[predictionId];
        void runCloseupLipsyncStatusCheck(predictionId, closeupLipsyncSelectionKey, runId, true);
      }, 900);
    });

    return () => {
      processingIds.forEach((predictionId) => {
        clearCloseupLipsyncTimer(predictionId);
        lipsyncPollRunsRef.current[predictionId] = (lipsyncPollRunsRef.current[predictionId] || 0) + 1;
      });
    };
  }, [
    authAvailable,
    closeupLipsyncSelectionKey,
    isCompetingOperation,
    isDirty,
    isSaving,
    onCheckLipsync,
    pausedLipsyncPredictionIds,
    persistedProject,
    processingCloseupLipsyncAttempts.map((asset) => asset.prediction_id).join(","),
    selectedLipsyncAudioUrl,
    selectedReadyCloseup?.prediction_id,
  ]);

  const handleManualCloseupLipsyncCheck = async (predictionId: string) => {
    if (!onCheckLipsync || !selectedReadyCloseup || !selectedLipsyncAudio) return;
    clearCloseupLipsyncTimer(predictionId);
    clearCloseupLipsyncPaused(predictionId);
    const runId = (lipsyncPollRunsRef.current[predictionId] || 0) + 1;
    lipsyncPollRunsRef.current[predictionId] = runId;
    setLipsyncPollError(null);
    await runCloseupLipsyncStatusCheck(predictionId, closeupLipsyncSelectionKey, runId, false);
  };

  const handleStartCloseupLipsync = async () => {
    if (!canStartCloseupLipsync || !selectedContext || !selectedReadyCloseup || !selectedLipsyncAudio || !onStartLipsync) return;
    setLipsyncPollError(null);
    const result = await onStartLipsync({
      sceneNumber: selectedContext.sceneNumber,
      lineId: selectedContext.lineId,
      characterId: selectedContext.characterId,
      text: selectedContext.text,
      clipPredictionId: selectedReadyCloseup.prediction_id,
      sourceVideoUrl: selectedReadyCloseup.video_url as string,
      sourceAudioUrl: selectedLipsyncAudio.audio_url,
      sourceClipKind: "dialogue_closeup",
    });
    if (result === false) {
      setLipsyncPollError("The close-up lip-sync render did not start. The READY source and exact audio take remain safe, so review the message and try again when ready.");
    }
  };

  const clearPollTimer = () => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  const isLive = (lifecycleRun: number, key: string, predictionId?: string): boolean => {
    if (!mountedRef.current || lifecycleRunRef.current !== lifecycleRun || selectionKeyRef.current !== key) return false;
    if (predictionId && activePredictionRef.current && activePredictionRef.current !== predictionId) return false;
    return true;
  };

  const isCurrentPoll = (args: StatusCheckArgs): boolean => {
    const target = pollTargetRef.current;
    return Boolean(
      target &&
      target.predictionId === args.predictionId &&
      target.selectionKey === args.selectionKey &&
      target.lifecycleRun === args.lifecycleRun &&
      target.pollRun === args.pollRun &&
      pollRunRef.current === args.pollRun &&
      isLive(args.lifecycleRun, args.selectionKey, args.predictionId)
    );
  };

  const scheduleNextPoll = (args: StatusCheckArgs) => {
    if (!mountedRef.current || !isCurrentPoll(args) || pausedPredictionId === args.predictionId) return;
    clearPollTimer();
    pollTimerRef.current = setTimeout(() => {
      pollTimerRef.current = null;
      if (!isCurrentPoll(args)) return;
      void statusCheckRef.current?.({ ...args, automatic: true });
    }, 4500);
  };

  const persistClip = async (
    clip: DialogueShotClip,
    lifecycleRun: number,
    key: string,
    predictionId: string
  ): Promise<boolean> => {
    if (!isLive(lifecycleRun, key, predictionId)) return false;
    const update = updateClipRef.current;
    if (!update) throw new Error("The saved project bridge is unavailable. No new close-up was started.");
    const result = await update(projectId, clip);
    if (!isLive(lifecycleRun, key, predictionId)) return false;
    if (result === false) {
      throw new Error("The close-up attempt was returned, but the private project could not save it. Check status again without starting another render.");
    }
    return true;
  };

  const performStatusCheck: StatusCheckFunction = async ({
    predictionId,
    selectionKey: key,
    lifecycleRun,
    pollRun,
    automatic,
  }) => {
    if (!isLive(lifecycleRun, key, predictionId)) return false;
    if (automatic && !isCurrentPoll({ predictionId, selectionKey: key, lifecycleRun, pollRun, automatic })) return false;
    if (operationLockRef.current) return false;
    if (!authAvailable) {
      if (isLive(lifecycleRun, key, predictionId)) {
        setPausedPredictionId(predictionId);
        setPollError("Your creator session is no longer active. Sign in again, then use Check status. No new render will start.");
      }
      return false;
    }
    if (isSaving || isCompetingOperation) {
      if (automatic) return false;
      setPollError("Wait for the current studio operation to finish, then use Check status again.");
      return false;
    }

    const context = contextRef.current;
    const currentAttempt = attemptsRef.current.find(
      (clip) => clip.prediction_id === predictionId && context && clipMatchesContext(clip, context) && isActiveStatus(clip.status)
    );
    if (!context || context.key !== key || !currentAttempt) {
      if (!automatic && isLive(lifecycleRun, key, predictionId)) {
        setPollError("This saved attempt is no longer processing for the selected source. Refresh the project to see its current result.");
      }
      return false;
    }

    operationLockRef.current = true;
    setOperation("checking");
    setPollError(null);
    let phase: "status" | "archive" = "status";

    try {
      const response = await replicateLumaVideo({
        operation: "status",
        project_id: context.projectId,
        scene_number: context.sceneNumber,
        clip_kind: "dialogue_closeup",
        prediction_id: predictionId,
      });
      if (!isLive(lifecycleRun, key, predictionId)) return false;
      const responseId = responsePredictionId(response);
      if (responseId && responseId !== predictionId) {
        throw new Error("The close-up service returned a different prediction. The saved attempt remains unchanged.");
      }
      const authoritative = validateAuthoritativeClip(response.dialogue_shot_clip, context, predictionId);
      const persisted = await persistClip(authoritative, lifecycleRun, key, predictionId);
      if (!persisted || !isLive(lifecycleRun, key, predictionId)) return false;

      activePredictionRef.current = predictionId;
      setPausedPredictionId(null);

      if (authoritative.status === "FAILED" || authoritative.status === "CANCELED") {
        activePredictionRef.current = null;
        setActivePredictionId(null);
        setPollError(null);
        setActionError(
          authoritative.error ||
            (authoritative.status === "CANCELED"
              ? "The dialogue close-up was canceled before it produced a source shot."
              : "The dialogue close-up provider could not finish this source shot. Earlier attempts remain available.")
        );
        return true;
      }

      if (authoritative.status === "READY") {
        activePredictionRef.current = null;
        setActivePredictionId(null);
        setPollError(null);
        setActionError(null);
        return true;
      }

      const responseStatus = typeof response.status === "string" ? response.status.toUpperCase() : "";
      const remoteStatus = typeof response.remote_status === "string" ? response.remote_status.toLowerCase() : "";
      const readyToArchive = response.ready_to_archive === true || responseStatus === "SUCCEEDED" || remoteStatus === "SUCCEEDED";
      if (!readyToArchive) {
        if (authoritative.status !== "QUEUED" && authoritative.status !== "PROCESSING") {
          throw new Error("The close-up service returned an unsupported processing state. The saved attempt remains unchanged.");
        }
        setActivePredictionId(predictionId);
        if (isCurrentPoll({ predictionId, selectionKey: key, lifecycleRun, pollRun, automatic })) {
          scheduleNextPoll({ predictionId, selectionKey: key, lifecycleRun, pollRun, automatic: true });
        }
        return true;
      }

      phase = "archive";
      setOperation("archiving");
      const archiveResponse = await replicateLumaVideo({
        operation: "archive",
        project_id: context.projectId,
        scene_number: context.sceneNumber,
        clip_kind: "dialogue_closeup",
        prediction_id: predictionId,
      });
      if (!isLive(lifecycleRun, key, predictionId)) return false;
      const archiveResponseId = responsePredictionId(archiveResponse);
      if (archiveResponseId && archiveResponseId !== predictionId) {
        throw new Error("The archive service returned a different prediction. The saved attempt remains unchanged.");
      }
      const archived = validateAuthoritativeClip(archiveResponse.dialogue_shot_clip, context, predictionId);
      const archivePersisted = await persistClip(archived, lifecycleRun, key, predictionId);
      if (!archivePersisted || !isLive(lifecycleRun, key, predictionId)) return false;

      if (archived.status === "READY") {
        activePredictionRef.current = null;
        setActivePredictionId(null);
        setPausedPredictionId(null);
        setPollError(null);
        setActionError(null);
        return true;
      }
      if (archived.status === "FAILED" || archived.status === "CANCELED") {
        activePredictionRef.current = null;
        setActivePredictionId(null);
        setPausedPredictionId(null);
        setPollError(null);
        setActionError(
          archived.error ||
            "Private archiving did not produce a playable source shot. This attempt is saved, and earlier ready attempts remain available."
        );
        return true;
      }
      throw new Error("The archive service did not return a terminal close-up record. The saved attempt remains unchanged.");
    } catch (error) {
      if (!isLive(lifecycleRun, key, predictionId)) return false;
      setPausedPredictionId(predictionId);
      setPollError(
        readableError(
          error,
          phase === "archive"
            ? "Private archiving could not be completed. The processing attempt is saved. Use Check status to recover without starting another render."
            : "The latest close-up status could not be checked. The saved attempt is safe. Use Check status to recover without starting another render."
        )
      );
      return false;
    } finally {
      operationLockRef.current = false;
      if (mountedRef.current) setOperation(null);
    }
  };

  statusCheckRef.current = performStatusCheck;

  const handleStart = async () => {
    const context = contextRef.current;
    if (!context || !canStart || !onDialogueShotClipUpdate) {
      setActionError(startReason || "Choose a saved scene, line, and source frame before creating a close-up.");
      return;
    }
    if (operationLockRef.current) return;

    const lifecycleRun = lifecycleRunRef.current;
    const key = context.key;
    operationLockRef.current = true;
    setOperation("starting");
    setActionError(null);
    setPollError(null);

    try {
      const response = await replicateLumaVideo({
        operation: "start",
        project_id: context.projectId,
        scene_number: context.sceneNumber,
        clip_kind: "dialogue_closeup",
        line_id: context.lineId,
        character_id: context.characterId,
        text: context.text,
        source_frame_type: context.sourceFrameType,
        source_frame_url: context.sourceFrameUrl,
        duration_seconds: 5,
      });
      if (!isLive(lifecycleRun, key)) return;
      if (response.error && !response.dialogue_shot_clip) throw new Error(response.error);
      const predictionId = responsePredictionId(response);
      const authoritative = validateAuthoritativeClip(response.dialogue_shot_clip, context, predictionId || undefined);
      if (!predictionId || authoritative.prediction_id !== predictionId) {
        throw new Error("The close-up service did not return a usable prediction. No new proof was saved.");
      }
      if (!isActiveStatus(authoritative.status) && authoritative.status !== "FAILED" && authoritative.status !== "CANCELED" && authoritative.status !== "READY") {
        throw new Error("The close-up service returned an unsupported start state. No new proof was saved.");
      }
      const persisted = await persistClip(authoritative, lifecycleRun, key, predictionId);
      if (!persisted || !isLive(lifecycleRun, key, predictionId)) return;

      if (isActiveStatus(authoritative.status)) {
        activePredictionRef.current = predictionId;
        setActivePredictionId(predictionId);
        setPausedPredictionId(null);
        setActionError(null);
      } else if (authoritative.status === "READY") {
        setActionError(null);
      } else {
        setActionError(
          authoritative.error ||
            "The dialogue close-up could not begin. Earlier attempts remain available, and no automatic retry was started."
        );
      }
    } catch (error) {
      if (!isLive(lifecycleRun, key)) return;
      setActionError(
        readableError(
          error,
          "The dialogue close-up could not start. Your saved frame and approved dialogue remain safe, so review the message and choose when to try again."
        )
      );
    } finally {
      operationLockRef.current = false;
      if (mountedRef.current) setOperation(null);
    }
  };

  const handleManualCheck = async () => {
    const context = contextRef.current;
    const predictionId = currentTargetId || pendingMatchingAttempt?.prediction_id;
    if (!context || !predictionId) return;
    if (operationLockRef.current) return;
    clearPollTimer();
    const pollRun = pollRunRef.current + 1;
    pollRunRef.current = pollRun;
    const lifecycleRun = lifecycleRunRef.current;
    pollTargetRef.current = {
      predictionId,
      selectionKey: context.key,
      lifecycleRun,
      pollRun,
    };
    activePredictionRef.current = predictionId;
    setPausedPredictionId(null);
    setPollError(null);
    await statusCheckRef.current?.({
      predictionId,
      selectionKey: context.key,
      lifecycleRun,
      pollRun,
      automatic: false,
    });
  };

  useEffect(() => {
    clearPollTimer();
    pollRunRef.current += 1;
    pollTargetRef.current = null;
    const lifecycleRun = lifecycleRunRef.current;
    const targetId = activePredictionId || pendingMatchingAttempt?.prediction_id || null;
    const targetAttempt = targetId ? allAttempts.find((clip) => clip.prediction_id === targetId) || null : null;
    const context = contextRef.current;

    if (
      !context ||
      !targetId ||
      !targetAttempt ||
      !isActiveStatus(targetAttempt.status) ||
      pausedPredictionId === targetId ||
      operation !== null ||
      !authAvailable ||
      !persistedProject ||
      isDirty ||
      isSaving ||
      isCompetingOperation
    ) return;

    const pollRun = pollRunRef.current + 1;
    pollRunRef.current = pollRun;
    const args: StatusCheckArgs = {
      predictionId: targetId,
      selectionKey: context.key,
      lifecycleRun,
      pollRun,
      automatic: true,
    };
    pollTargetRef.current = {
      predictionId: targetId,
      selectionKey: context.key,
      lifecycleRun,
      pollRun,
    };
    const timerDelay = activePredictionId ? 900 : 300;
    pollTimerRef.current = setTimeout(() => {
      pollTimerRef.current = null;
      if (!isCurrentPoll(args)) return;
      void statusCheckRef.current?.(args);
    }, timerDelay);

    return () => {
      if (pollRunRef.current === pollRun) pollRunRef.current += 1;
      clearPollTimer();
      pollTargetRef.current = null;
    };
  }, [
    activePredictionId,
    allAttempts,
    authAvailable,
    isCompetingOperation,
    isDirty,
    isSaving,
    operation,
    pausedPredictionId,
    pendingMatchingAttempt?.prediction_id,
    pendingMatchingAttempt?.status,
    selectionKey,
    persistedProject,
  ]);

  const selectionSourceMissing = Boolean(selectedLine && !effectiveSourceAsset);
  const showStatusRecovery = Boolean(
    currentTargetAttempt &&
    isActiveStatus(currentTargetAttempt.status) &&
    currentTargetAttempt.prediction_id === currentTargetId
  );
  const displayedError = pollError || actionError;
  const historyAttempts = allAttempts;

  return (
    <section
      className="min-w-0 overflow-hidden rounded-2xl border border-[#2b3549] bg-[#101622] shadow-xl shadow-black/20"
      aria-labelledby="dialogue-closeup-proof-heading"
    >
      <div className="border-b border-[#222d43] bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,0.16),transparent_54%),#141b28] px-4 py-5 sm:px-6 sm:py-6">
        <div className="flex min-w-0 flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/35 bg-amber-500/10 px-2 py-1 text-[10px] font-mono uppercase tracking-[0.18em] text-amber-200">
                <Camera className="h-3 w-3" aria-hidden="true" /> Source-shot review
              </span>
              <span className="rounded-md border border-[#39465f] bg-[#182235] px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-gray-300">
                Fixed 5 seconds
              </span>
            </div>
            <h2 id="dialogue-closeup-proof-heading" className="mt-3 text-2xl font-serif font-bold tracking-tight text-white sm:text-3xl">
              Dialogue Close-up Source
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-gray-300">
              Create one tight, silent speaking shot from an approved scene line and one saved visual source. Review the face and continuity here before any later lip-sync work.
            </p>
            <div className="mt-4 grid gap-2 text-[11px] leading-relaxed text-gray-300 sm:grid-cols-3">
              <div className="flex items-start gap-2 rounded-lg border border-[#29364d] bg-black/20 px-3 py-2.5">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" aria-hidden="true" />
                <span>Private archiving keeps each returned MP4 inside this project.</span>
              </div>
              <div className="flex items-start gap-2 rounded-lg border border-[#29364d] bg-black/20 px-3 py-2.5">
                <MessageCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" aria-hidden="true" />
                <span>The saved speaker, line, source frame, and five-second duration stay linked.</span>
              </div>
              <div className="flex items-start gap-2 rounded-lg border border-[#29364d] bg-black/20 px-3 py-2.5">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-300" aria-hidden="true" />
                <span>This is a silent source review. It does not run lip-sync or change Episode Mix.</span>
              </div>
            </div>
          </div>
          <div className="grid min-w-0 grid-cols-3 gap-2 lg:min-w-[270px] lg:max-w-[320px]">
            <div className="rounded-xl border border-[#303d55] bg-[#0d131f]/80 p-3">
              <Film className="h-4 w-4 text-amber-300" aria-hidden="true" />
              <p className="mt-3 text-lg font-semibold text-white">{sceneEntries.length}</p>
              <p className="text-[10px] font-mono uppercase tracking-wider text-gray-500">Scenes</p>
            </div>
            <div className="rounded-xl border border-[#303d55] bg-[#0d131f]/80 p-3">
              <MessageCircle className="h-4 w-4 text-sky-300" aria-hidden="true" />
              <p className="mt-3 text-lg font-semibold text-white">{sceneEntries.reduce((total, entry) => total + entry.lines.length, 0)}</p>
              <p className="text-[10px] font-mono uppercase tracking-wider text-gray-500">Approved lines</p>
            </div>
            <div className="rounded-xl border border-[#303d55] bg-[#0d131f]/80 p-3">
              <CheckCircle2 className="h-4 w-4 text-emerald-300" aria-hidden="true" />
              <p className="mt-3 text-lg font-semibold text-white">{readyAttempts.length}</p>
              <p className="text-[10px] font-mono uppercase tracking-wider text-gray-500">Ready shots</p>
            </div>
          </div>
        </div>
      </div>

      {displayedError && (
        <div className="border-b border-red-500/20 bg-red-950/20 px-4 py-3 sm:px-6" role="alert">
          <div className="flex items-start gap-2 text-xs leading-relaxed text-red-100">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" aria-hidden="true" />
            <span>{displayedError}</span>
          </div>
        </div>
      )}

      <div className="grid min-w-0 gap-5 p-4 sm:p-6 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <div className="min-w-0 space-y-5">
          <div className="rounded-2xl border border-[#2a364e] bg-[#121a28] p-4 sm:p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-300">01 / Lock the approved line</p>
                <h3 className="mt-1.5 text-lg font-semibold text-white">Choose one saved performance target</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-gray-400">
                  The close-up reads from the saved screenplay only. Scene and speaker changes keep older attempts in the history below.
                </p>
              </div>
              <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-2.5 text-amber-300">
                <MessageCircle className="h-5 w-5" aria-hidden="true" />
              </div>
            </div>

            <div className="mt-5 space-y-4">
              <label className="block text-xs font-semibold text-gray-200" htmlFor="dialogue-closeup-scene-select">
                Approved scene
                <select
                  id="dialogue-closeup-scene-select"
                  value={selectedSceneNumber ?? ""}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    setSelectedSceneNumber(Number.isInteger(next) ? next : null);
                    setSelectedLineId("");
                    setActionError(null);
                    setPollError(null);
                  }}
                  className="mt-2 block h-11 w-full min-w-0 rounded-lg border border-[#34415b] bg-[#0b111b] px-3 text-sm font-medium text-gray-100 outline-none transition-colors focus:border-amber-400 focus:ring-2 focus:ring-amber-500/20"
                >
                  <option value="" disabled>Choose a scene</option>
                  {sceneEntries.map((entry) => (
                    <option key={entry.sceneNumber} value={entry.sceneNumber}>
                      Scene {formatScene(entry.sceneNumber)} · {entry.lines.length} approved line{entry.lines.length === 1 ? "" : "s"}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-xs font-semibold text-gray-200" htmlFor="dialogue-closeup-line-select">
                Exact dialogue line
                <select
                  id="dialogue-closeup-line-select"
                  value={selectedLineId}
                  onChange={(event) => {
                    setSelectedLineId(event.target.value);
                    setActionError(null);
                    setPollError(null);
                  }}
                  disabled={!selectedEntry || selectedEntry.lines.length === 0}
                  className="mt-2 block h-11 w-full min-w-0 rounded-lg border border-[#34415b] bg-[#0b111b] px-3 text-sm font-medium text-gray-100 outline-none transition-colors focus:border-amber-400 focus:ring-2 focus:ring-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="" disabled>Choose a dialogue line</option>
                  {selectedEntry?.lines.map((line) => (
                    <option key={line.line_id} value={line.line_id}>
                      {line.line_id} · {line.character_id}
                    </option>
                  ))}
                </select>
              </label>

              {selectedLine ? (
                <div className="rounded-xl border border-[#303d55] bg-[#0d131f] p-3.5">
                  <div className="flex items-start gap-2">
                    <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-amber-300">{selectedLine.character_id} · {selectedLine.line_id}</p>
                      <p className="mt-2 break-words text-sm leading-relaxed text-gray-100">“{selectedLine.text}”</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-[#34415b] bg-[#0d131f] p-4 text-xs leading-relaxed text-gray-400">
                  This approved scene has no usable dialogue line yet. Choose another saved scene.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-[#2a364e] bg-[#121a28] p-4 sm:p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-300">02 / Choose the first frame</p>
                <h3 className="mt-1.5 text-lg font-semibold text-white">Use the source that holds continuity</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-gray-400">
                  A storyboard protects the setting. A character reference protects a readable face. Choose the frame that gives the close-up the strongest starting point.
                </p>
              </div>
              <div className="rounded-xl border border-sky-500/25 bg-sky-500/10 p-2.5 text-sky-300">
                <Camera className="h-5 w-5" aria-hidden="true" />
              </div>
            </div>

            <div className="mt-5 grid min-w-0 gap-3 sm:grid-cols-2">
              {([
                {
                  type: "scene_storyboard" as SourceType,
                  asset: selectedStoryboard,
                  title: "Scene storyboard",
                  guidance: "Keeps location, lighting, and wardrobe context. A wide or group storyboard may leave the face too small for a reliable close-up.",
                  icon: Film,
                },
                {
                  type: "character_reference" as SourceType,
                  asset: selectedCharacterReference,
                  title: "Character reference",
                  guidance: "Use this when the storyboard face is small, turned away, or obscured. Review the setting and wardrobe against the scene after the render.",
                  icon: UserRound,
                },
              ]).map(({ type, asset, title, guidance, icon: SourceIcon }) => {
                const isSelected = effectiveSourceType === type;
                const isAvailable = Boolean(asset?.image_url);
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => {
                      if (!isAvailable) return;
                      setSourceFrameType(type);
                      setActionError(null);
                      setPollError(null);
                    }}
                    disabled={!isAvailable}
                    className={`group min-w-0 overflow-hidden rounded-xl border text-left transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500/40 ${
                      isSelected
                        ? "border-amber-400/70 bg-amber-500/10"
                        : "border-[#303d55] bg-[#0d131f] hover:border-amber-500/45"
                    } ${!isAvailable ? "cursor-not-allowed opacity-45" : ""}`}
                    aria-pressed={isSelected}
                  >
                    <ImagePreview
                      url={asset?.image_url || null}
                      alt={asset ? `${title} for Scene ${formatScene(selectedEntry?.sceneNumber || 0)}` : `${title} unavailable`}
                      className="aspect-[16/10] w-full"
                    />
                    <div className="space-y-2 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${isSelected ? "text-amber-100" : "text-gray-200"}`}>
                          <SourceIcon className="h-3.5 w-3.5 text-amber-300" aria-hidden="true" />
                          {title}
                        </span>
                        {isSelected && <CheckCircle2 className="h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />}
                      </div>
                      <p className="text-[11px] leading-relaxed text-gray-400">{isAvailable ? guidance : "This saved source is not available for the selected speaker or scene."}</p>
                      {asset && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-emerald-300">
                          <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Saved source
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            {selectedLine && selectionSourceMissing && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-950/20 px-3 py-2.5 text-[11px] leading-relaxed text-amber-100/85">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" aria-hidden="true" />
                <span>Save the selected speaker's character reference or the current scene storyboard before creating this source shot.</span>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-amber-500/30 bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,0.11),transparent_58%),#171a20] p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <div className="rounded-xl border border-amber-400/35 bg-amber-500/15 p-2.5 text-amber-200">
                <Sparkles className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-300">03 / Create one source shot</p>
                <h3 className="mt-1.5 text-lg font-semibold text-white">A single paid five-second render</h3>
                <p className="mt-2 text-xs leading-relaxed text-gray-300">
                  The button starts exactly one provider render for the saved scene, speaker, line, and source frame. The panel never starts a render on selection change, and it never retries automatically.
                </p>
                <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-400/25 bg-black/20 px-3 py-2.5 text-[11px] leading-relaxed text-amber-100/90">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" aria-hidden="true" />
                  <span>This source shot is silent. It does not consume a dialogue take, run lip-sync, replace normal motion, or alter Episode Mix.</span>
                </div>
                {lineActiveAttempt && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg border border-sky-500/25 bg-sky-950/20 px-3 py-2.5 text-[11px] leading-relaxed text-sky-100/85">
                    <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-300" aria-hidden="true" />
                    <span>{lineActiveAttempt.source_frame_url === selectedContext?.sourceFrameUrl ? "This exact line is already rendering. The saved attempt will be checked here." : "This line already has another source shot rendering. Keep the selected source unchanged until it reaches a terminal state."}</span>
                  </div>
                )}
                <Button
                  type="button"
                  onClick={() => void handleStart()}
                  disabled={!canStart}
                  className="mt-4 h-11 w-full gap-2 bg-amber-500 font-semibold text-black shadow-lg shadow-amber-950/25 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {operation === "starting" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
                  {operation === "starting" ? "Starting one close-up..." : "Create 5-second dialogue close-up"}
                </Button>
                <p className="mt-2 text-center text-[10px] leading-relaxed text-gray-500">
                  {startReason || "Choose a saved line and source frame to enable this one-render action."}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="min-w-0 space-y-5">
          <div className="rounded-2xl border border-[#2a364e] bg-[#121a28] p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-300">Review status</p>
                <h3 className="mt-1.5 text-lg font-semibold text-white">Silent source-shot playback</h3>
                <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-gray-400">
                  A ready shot is available only after the private archive completes. This player is a source review, separate from dialogue audio and the episode assembly.
                </p>
              </div>
              {showStatusRecovery && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleManualCheck()}
                  disabled={Boolean(operation) || isSaving || isCompetingOperation || !authAvailable}
                  className="h-9 shrink-0 gap-2 border-amber-500/35 bg-amber-500/10 px-3 text-xs font-semibold text-amber-100 hover:bg-amber-500/20 disabled:opacity-45"
                  title="Check the same saved prediction without starting another render"
                >
                  {operation === "checking" || operation === "archiving" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
                  Check status
                </Button>
              )}
            </div>

            {currentTargetAttempt && isActiveStatus(currentTargetAttempt.status) && (
              <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-950/20 p-3.5">
                <div className="flex items-start gap-2">
                  <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-amber-300" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-amber-100">
                      {currentTargetAttempt.status === "QUEUED" ? "Close-up queued" : "Close-up rendering"}
                    </p>
                    <p className="mt-1 text-[11px] leading-relaxed text-amber-100/75">
                      Prediction {shortId(currentTargetAttempt.prediction_id)} is linked to Scene {formatScene(currentTargetAttempt.scene_number)}, {currentTargetAttempt.line_id}, and the {sourceShortLabel(currentTargetAttempt.source_frame_type).toLowerCase()} source. The panel will check this saved attempt without starting another render.
                    </p>
                  </div>
                </div>
                {pausedPredictionId === currentTargetAttempt.prediction_id && (
                  <div className="mt-3 rounded-lg border border-red-500/25 bg-red-950/25 px-3 py-2.5 text-[11px] leading-relaxed text-red-100/90">
                    Automatic checks are paused after the latest transport or save problem. Use Check status when you are ready.
                  </div>
                )}
              </div>
            )}

            {latestMatchingAttempt && !isActiveStatus(latestMatchingAttempt.status) && (
              <div className={`mt-4 flex items-start gap-2 rounded-xl border px-3.5 py-3 text-xs leading-relaxed ${attemptClass(latestMatchingAttempt.status)}`}>
                {latestMatchingAttempt.status === "READY" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
                <span>
                  {latestMatchingAttempt.status === "READY"
                    ? "The selected source has a privately archived close-up below."
                    : latestMatchingAttempt.error || "The selected source attempt reached a terminal state. Earlier ready shots remain available."}
                </span>
              </div>
            )}

            {!latestMatchingAttempt && selectedContext && (
              <div className="mt-4 rounded-xl border border-dashed border-[#34415b] bg-[#0d131f] p-4 text-xs leading-relaxed text-gray-400">
                No close-up attempt exists for this exact scene, line, speaker, and source frame. Starting one will create a new history entry and leave all earlier shots untouched.
              </div>
            )}

            {!selectedContext && (
              <div className="mt-4 rounded-xl border border-dashed border-[#34415b] bg-[#0d131f] p-4 text-xs leading-relaxed text-gray-400">
                Select an approved dialogue line and one saved source frame to review its close-up status.
              </div>
            )}
          </div>

          {selectedReadyCloseup && (
            <div className="rounded-2xl border border-sky-500/30 bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.12),transparent_58%),#111b2a] p-4 sm:p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-sky-300">03 / Use the saved source</p>
                  <h3 className="mt-1.5 text-lg font-semibold text-white">Lip-sync this close-up</h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-gray-300">
                    Pair this READY silent source with one exact saved ElevenLabs MP3. The action starts one private lip-sync proof and keeps the source shot, audio take, and result linked by their saved records.
                  </p>
                </div>
                <div className="rounded-xl border border-sky-400/30 bg-sky-500/10 p-2.5 text-sky-200">
                  <Volume2 className="h-5 w-5" aria-hidden="true" />
                </div>
              </div>

              <div className="mt-4 rounded-xl border border-sky-500/20 bg-black/20 px-3 py-2.5 text-[11px] leading-relaxed text-sky-100/85">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono uppercase tracking-wider text-sky-200/90">
                  <span>Scene {formatScene(selectedReadyCloseup.scene_number)}</span>
                  <span>{selectedReadyCloseup.character_id}</span>
                  <span>Source #{shortId(selectedReadyCloseup.prediction_id)}</span>
                </div>
                <p className="mt-1.5">The source stays silent until you click the explicit action below. No different take is substituted automatically.</p>
              </div>

              <label className="mt-4 block text-xs font-semibold text-gray-200" htmlFor="dialogue-closeup-lipsync-audio-select">
                Exact saved dialogue take
                <select
                  id="dialogue-closeup-lipsync-audio-select"
                  value={selectedLipsyncAudioUrl}
                  onChange={(event) => setSelectedLipsyncAudioUrl(event.target.value)}
                  disabled={matchingAudioTakes.length === 0 || isStartingLipsync}
                  className="mt-2 block h-11 w-full min-w-0 rounded-lg border border-[#34415b] bg-[#0b111b] px-3 text-sm font-medium text-gray-100 outline-none transition-colors focus:border-sky-400 focus:ring-2 focus:ring-sky-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <option value="" disabled>
                    {matchingAudioTakes.length ? "Choose a saved MP3 take" : "No exact READY ElevenLabs MP3 saved"}
                  </option>
                  {matchingAudioTakes.map((take) => (
                    <option key={take.audio_url} value={take.audio_url}>
                      {take.voice_name} · {formatAttemptDate(take.updated_at || take.created_at)}{take.duration_seconds ? ` · ${take.duration_seconds.toFixed(1)}s` : ""}
                    </option>
                  ))}
                </select>
              </label>

              {selectedLipsyncAudio ? (
                <div className="mt-3 rounded-xl border border-[#2d405a] bg-[#0d1724] p-3">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-sky-500/25 bg-sky-500/10 text-sky-300">
                      <Volume2 className="h-4 w-4" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-xs font-semibold text-gray-100">This is the take that will be used</p>
                        <span className="rounded border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider text-emerald-200">READY MP3</span>
                      </div>
                      <p className="mt-1 text-[11px] leading-relaxed text-gray-400">
                        {selectedLipsyncAudio.voice_name} · saved {formatAttemptDate(selectedLipsyncAudio.updated_at || selectedLipsyncAudio.created_at)}
                      </p>
                    </div>
                  </div>
                  <audio
                    key={selectedLipsyncAudio.audio_url}
                    src={selectedLipsyncAudio.audio_url}
                    controls
                    preload="metadata"
                    className="mt-3 w-full"
                    aria-label={`Saved dialogue take for Scene ${formatScene(selectedLipsyncAudio.scene_number)}, ${selectedLipsyncAudio.character_id}`}
                  />
                </div>
              ) : matchingAudioTakes.length === 0 ? (
                <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-950/20 px-3 py-2.5 text-[11px] leading-relaxed text-amber-100/85" role="status">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" aria-hidden="true" />
                  <span>No exact READY MP3 matches this scene, line, character, and text. Create and save the approved dialogue take before starting this proof.</span>
                </div>
              ) : (
                <p className="mt-3 text-[11px] leading-relaxed text-gray-500">Choose the exact saved take above to preview the audio and enable this proof.</p>
              )}

              <Button
                type="button"
                onClick={() => void handleStartCloseupLipsync()}
                disabled={!canStartCloseupLipsync}
                className="mt-4 h-11 w-full gap-2 bg-sky-400 font-semibold text-slate-950 shadow-lg shadow-sky-950/25 hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {isStartingLipsync ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
                {isStartingLipsync ? "Starting close-up lip-sync..." : "Lip-sync this close-up"}
              </Button>
              <p className="mt-2 text-center text-[10px] leading-relaxed text-gray-500">
                {closeupLipsyncBlockingReason || "This exact READY close-up and saved MP3 are ready for one explicit lip-sync render."}
              </p>

              {(lipsyncError || lipsyncPollError) && (
                <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-500/25 bg-red-950/25 px-3 py-2.5 text-[11px] leading-relaxed text-red-100/90" role="alert">
                  <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-300" aria-hidden="true" />
                  <span>{lipsyncPollError || lipsyncError}</span>
                </div>
              )}

              {selectedLipsyncAudio && (
                <div className="mt-5 border-t border-[#26364b] pt-4">
                  <div className="flex flex-wrap items-end justify-between gap-2">
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-sky-300">Saved lip-sync attempts</p>
                      <h4 className="mt-1 text-sm font-semibold text-white">Results for this source and take</h4>
                    </div>
                    <span className="rounded-md border border-[#344760] bg-[#162235] px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-gray-400">
                      {matchingCloseupLipsyncAttempts.length} saved
                    </span>
                  </div>

                  {matchingCloseupLipsyncAttempts.length > 0 ? (
                    <div className="mt-3 space-y-3">
                      {matchingCloseupLipsyncAttempts.map((attempt) => {
                        const isPlayable = attempt.status === "READY" && isSecureHttpsUrl(attempt.video_url);
                        const isManualCheck = manualLipsyncCheckId === attempt.prediction_id;
                        const isPaused = pausedLipsyncPredictionIds.includes(attempt.prediction_id);
                        return (
                          <article key={attempt.prediction_id} className="overflow-hidden rounded-xl border border-[#2d405a] bg-[#0b1420]">
                            <div className="flex min-w-0 flex-col gap-3 p-3 sm:flex-row sm:items-start sm:justify-between">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-mono uppercase tracking-wider ${lipsyncAttemptClass(attempt.status)}`}>
                                    <span className={`h-1.5 w-1.5 rounded-full ${lipsyncStatusDotClass(attempt.status)}`} aria-hidden="true" />
                                    {lipsyncAttemptLabel(attempt.status)}
                                  </span>
                                  <span className="rounded-md border border-sky-500/20 bg-sky-500/5 px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-sky-200/80">
                                    {attempt.provider === "pixverse-lipsync" ? "PixVerse · default coverage" : "Sync · fallback"}
                                  </span>
                                </div>
                                <p className="mt-2 break-words text-xs font-semibold text-gray-200">
                                  Prediction {shortId(attempt.prediction_id)}
                                </p>
                                <p className="mt-1 text-[10px] font-mono uppercase tracking-wider text-gray-500">
                                  {formatAttemptDate(attempt.updated_at || attempt.created_at)} · Close-up source #{shortId(attempt.source_clip_prediction_id)}
                                </p>
                              </div>
                              {attempt.status === "PROCESSING" && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={() => void handleManualCloseupLipsyncCheck(attempt.prediction_id)}
                                  disabled={isManualCheck || isStartingLipsync || isSaving || isCompetingOperation || !authAvailable || !onCheckLipsync}
                                  className="h-9 shrink-0 gap-2 border-sky-500/30 bg-sky-500/10 px-3 text-xs font-semibold text-sky-100 hover:bg-sky-500/20 disabled:opacity-45"
                                  title="Check this saved prediction without starting another render"
                                >
                                  {isManualCheck ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
                                  {isManualCheck ? "Checking..." : "Check status"}
                                </Button>
                              )}
                            </div>

                            {attempt.status === "PROCESSING" && (
                              <div className="border-t border-[#26364b] bg-amber-950/15 px-3 py-2.5 text-[11px] leading-relaxed text-amber-100/80">
                                <div className="flex items-start gap-2">
                                  <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-amber-300" aria-hidden="true" />
                                  <span>
                                    This exact source and take are still rendering. {isPaused ? "Automatic checks are paused after a transport problem. Use Check status when ready." : "The panel will check the saved prediction without starting another render."}
                                  </span>
                                </div>
                              </div>
                            )}

                            {isPlayable && (
                              <div className="border-t border-[#26364b] bg-black/20 p-3">
                                <video
                                  key={attempt.video_url}
                                  src={attempt.video_url as string}
                                  className="aspect-video w-full rounded-lg bg-black object-contain"
                                  controls
                                  playsInline
                                  preload="metadata"
                                  aria-label={`Private lip-sync close-up for Scene ${formatScene(attempt.scene_number)}, ${attempt.character_id}`}
                                />
                                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-gray-500">
                                  <span className="inline-flex items-center gap-1.5">
                                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" aria-hidden="true" /> Private MP4 ready for review
                                  </span>
                                  <a
                                    href={attempt.video_url as string}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1 text-gray-400 transition-colors hover:text-sky-200"
                                  >
                                    <ExternalLink className="h-3 w-3" aria-hidden="true" /> Open player
                                  </a>
                                </div>
                              </div>
                            )}

                            {attempt.status === "READY" && !isPlayable && (
                              <div className="border-t border-red-500/20 bg-red-950/20 px-3 py-2.5 text-[11px] leading-relaxed text-red-100/80">
                                The saved READY attempt has no playable private MP4 in this tab. Its source and audio lineage remain saved.
                              </div>
                            )}

                            {(attempt.status === "FAILED" || attempt.status === "CANCELED") && (
                              <div className="border-t border-[#26364b] px-3 py-2.5 text-[11px] leading-relaxed text-gray-400">
                                {attempt.error || (attempt.status === "CANCELED" ? "This render was canceled before producing a video. Earlier READY outputs remain available." : "This render failed before producing a video. Earlier READY outputs remain available.")}
                              </div>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="mt-3 rounded-xl border border-dashed border-[#344760] bg-[#0b1420] p-4 text-xs leading-relaxed text-gray-500">
                      No lip-sync attempt exists for this exact close-up prediction and audio URL yet. Click the explicit action above to start one.
                    </div>
                  )}

                  <p className="mt-3 text-[10px] leading-relaxed text-gray-500">
                    Attempts are matched to this close-up prediction, exact MP3 URL, scene, line, character, and text. Older READY outputs stay saved when a later attempt fails. Choose another saved take to review that take's own history.
                  </p>
                </div>
              )}

              <section className="mt-5 border-t border-[#26364b] pt-5" aria-labelledby="pixverse-ab-heading">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-fuchsia-300">Provider comparison</p>
                    <h4 id="pixverse-ab-heading" className="mt-1 text-base font-semibold text-white">PixVerse A/B comparison</h4>
                    <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-gray-400">
                      Send this same READY close-up and exact saved MP3 to PixVerse for a separate manual review. PixVerse is the default provider for new dialogue close-up production coverage, while this comparison stays isolated from automatic coverage.
                    </p>
                  </div>
                  <div className="shrink-0 rounded-xl border border-fuchsia-500/25 bg-fuchsia-500/10 p-2.5 text-fuchsia-200">
                    <Sparkles className="h-5 w-5" aria-hidden="true" />
                  </div>
                </div>

                <div className="mt-4 rounded-xl border border-fuchsia-500/20 bg-fuchsia-950/15 px-3 py-3 text-[11px] leading-relaxed text-fuchsia-100/85">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono uppercase tracking-wider text-fuchsia-200/90">
                    <span>Scene {formatScene(selectedReadyCloseup.scene_number)}</span>
                    <span>Source #{shortId(selectedReadyCloseup.prediction_id)}</span>
                    <span>{selectedLipsyncAudio ? `MP3 #${shortId(selectedLipsyncAudio.audio_url)}` : "MP3 not selected"}</span>
                  </div>
                  <p className="mt-1.5">Both providers use the exact source prediction and audio URL shown above. The production resolver prefers a READY PixVerse result for this exact lineage, then falls back to READY Sync when PixVerse is unavailable. This section remains manual comparison history.</p>
                </div>

                <div className="mt-3 rounded-xl border border-[#34415b] bg-[#0d131f] px-3 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-md border border-amber-500/25 bg-amber-500/10 px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-amber-200">Manual review</span>
                    <span className="text-[11px] text-gray-400">Compare mouth timing, identity consistency, flicker or warping, and audio behavior.</span>
                  </div>
                </div>

                <Button
                  type="button"
                  onClick={() => void handleStartPixverseComparison()}
                  disabled={!canStartPixverseLipsync}
                  className="mt-4 h-11 w-full gap-2 bg-fuchsia-400 font-semibold text-slate-950 shadow-lg shadow-fuchsia-950/25 hover:bg-fuchsia-300 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {isStartingPixverseLipsync ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
                  {isStartingPixverseLipsync ? "Starting PixVerse comparison..." : "Render PixVerse comparison"}
                </Button>
                <p className="mt-2 text-center text-[10px] leading-relaxed text-gray-500">
                  {pixverseBlockingReason || "This exact READY close-up and saved MP3 are ready for one explicit PixVerse comparison."}
                </p>

                {(pixverseLipsyncError || pixversePollError) && (
                  <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-500/25 bg-red-950/25 px-3 py-2.5 text-[11px] leading-relaxed text-red-100/90" role="alert">
                    <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-300" aria-hidden="true" />
                    <span>{pixversePollError || pixverseLipsyncError}</span>
                  </div>
                )}

                {selectedSyncReadyAttempt && selectedPixverseReadyAttempt && (
                  <div className="mt-5 rounded-xl border border-emerald-500/25 bg-emerald-950/10 p-3 sm:p-4">
                    <div className="flex flex-wrap items-end justify-between gap-2">
                      <div>
                        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-emerald-300">Same source, two providers</p>
                        <h5 className="mt-1 text-sm font-semibold text-white">Review the outputs side by side</h5>
                      </div>
                      <span className="text-[10px] text-gray-500">Playback is manual</span>
                    </div>
                    <div className="mt-3 grid min-w-0 gap-3 md:grid-cols-2">
                      <article className="min-w-0 overflow-hidden rounded-xl border border-sky-500/25 bg-[#0b1420]">
                        <div className="border-b border-sky-500/15 px-3 py-2.5">
                          <p className="text-xs font-semibold text-sky-100">Sync · fallback result</p>
                          <p className="mt-1 break-all text-[10px] font-mono uppercase tracking-wider text-gray-500">Prediction #{shortId(selectedSyncReadyAttempt.prediction_id)}</p>
                          <p className="mt-1 break-all text-[10px] font-mono uppercase tracking-wider text-gray-500">Source #{shortId(selectedSyncReadyAttempt.source_clip_prediction_id)} · MP3 #{shortId(selectedSyncReadyAttempt.source_audio_url)}</p>
                        </div>
                        <div className="p-3">
                          <video
                            key={selectedSyncReadyAttempt.video_url}
                            src={selectedSyncReadyAttempt.video_url as string}
                            className="aspect-video w-full rounded-lg bg-black object-contain"
                            controls
                            playsInline
                            preload="metadata"
                            aria-label={`Sync fallback result for Scene ${formatScene(selectedSyncReadyAttempt.scene_number)}, ${selectedSyncReadyAttempt.character_id}`}
                          />
                        </div>
                      </article>
                      <article className="min-w-0 overflow-hidden rounded-xl border border-fuchsia-500/25 bg-[#0b1420]">
                        <div className="border-b border-fuchsia-500/15 px-3 py-2.5">
                          <p className="text-xs font-semibold text-fuchsia-100">PixVerse · comparison result</p>
                          <p className="mt-1 break-all text-[10px] font-mono uppercase tracking-wider text-gray-500">Prediction #{shortId(selectedPixverseReadyAttempt.prediction_id)}</p>
                          <p className="mt-1 break-all text-[10px] font-mono uppercase tracking-wider text-gray-500">Source #{shortId(selectedPixverseReadyAttempt.source_clip_prediction_id)} · MP3 #{shortId(selectedPixverseReadyAttempt.source_audio_url)}</p>
                        </div>
                        <div className="p-3">
                          <video
                            key={selectedPixverseReadyAttempt.video_url}
                            src={selectedPixverseReadyAttempt.video_url as string}
                            className="aspect-video w-full rounded-lg bg-black object-contain"
                            controls
                            playsInline
                            preload="metadata"
                            aria-label={`PixVerse comparison result for Scene ${formatScene(selectedPixverseReadyAttempt.scene_number)}, ${selectedPixverseReadyAttempt.character_id}`}
                          />
                        </div>
                      </article>
                    </div>
                    <p className="mt-3 text-[10px] leading-relaxed text-gray-500">Use the same headphones and playback size for both videos. Judge the evidence yourself, especially mouth timing, identity consistency, flicker or warping, and whether the returned audio behaves as expected.</p>
                  </div>
                )}

                {selectedLipsyncAudio ? (
                  matchingPixverseLipsyncAttempts.length > 0 ? (
                    <div className="mt-5 space-y-3">
                      <div className="flex flex-wrap items-end justify-between gap-2">
                        <div>
                          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-fuchsia-300">Saved PixVerse attempts</p>
                          <h5 className="mt-1 text-sm font-semibold text-white">Comparison history for this source and take</h5>
                        </div>
                        <span className="rounded-md border border-fuchsia-500/20 bg-fuchsia-500/5 px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-fuchsia-200/80">
                          {matchingPixverseLipsyncAttempts.length} saved
                        </span>
                      </div>
                      {matchingPixverseLipsyncAttempts.map((attempt) => {
                        const isPlayable = attempt.status === "READY" && isSecureHttpsUrl(attempt.video_url);
                        const isManualCheck = manualPixverseCheckId === attempt.prediction_id;
                        const isPaused = pausedPixversePredictionIds.includes(attempt.prediction_id);
                        const shownInComparison = attempt.prediction_id === selectedPixverseReadyAttempt?.prediction_id && Boolean(selectedSyncReadyAttempt);
                        return (
                          <article key={attempt.prediction_id} className="overflow-hidden rounded-xl border border-fuchsia-500/20 bg-[#0b1420]">
                            <div className="flex min-w-0 flex-col gap-3 p-3 sm:flex-row sm:items-start sm:justify-between">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-mono uppercase tracking-wider ${lipsyncAttemptClass(attempt.status)}`}>
                                    <span className={`h-1.5 w-1.5 rounded-full ${lipsyncStatusDotClass(attempt.status)}`} aria-hidden="true" />
                                    {lipsyncAttemptLabel(attempt.status)}
                                  </span>
                                  <span className="rounded-md border border-fuchsia-500/20 bg-fuchsia-500/5 px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-fuchsia-200/80">PixVerse</span>
                                </div>
                                <p className="mt-2 break-words text-xs font-semibold text-gray-200">Prediction {shortId(attempt.prediction_id)}</p>
                                <p className="mt-1 break-words text-[10px] font-mono uppercase tracking-wider text-gray-500">{formatAttemptDate(attempt.updated_at || attempt.created_at)} · Source #{shortId(attempt.source_clip_prediction_id)} · MP3 #{shortId(attempt.source_audio_url)}</p>
                              </div>
                              {attempt.status === "PROCESSING" && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={() => void handleManualPixverseCheck(attempt.prediction_id)}
                                  disabled={isManualCheck || isStartingPixverseLipsync || isSaving || isCompetingOperation || operation !== null || !authAvailable || !onCheckPixverseLipsync}
                                  className="h-9 shrink-0 gap-2 border-fuchsia-500/30 bg-fuchsia-500/10 px-3 text-xs font-semibold text-fuchsia-100 hover:bg-fuchsia-500/20 disabled:opacity-45"
                                  title="Check this saved PixVerse prediction without starting another render"
                                >
                                  {isManualCheck ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
                                  {isManualCheck ? "Checking..." : "Check status"}
                                </Button>
                              )}
                            </div>

                            {attempt.status === "PROCESSING" && (
                              <div className="border-t border-fuchsia-500/15 bg-fuchsia-950/10 px-3 py-2.5 text-[11px] leading-relaxed text-fuchsia-100/80">
                                <div className="flex items-start gap-2">
                                  <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-fuchsia-300" aria-hidden="true" />
                                  <span>This exact source and MP3 are still rendering. {isPaused ? "Automatic checks are paused after a transport problem. Use Check status when ready." : "The panel will check the saved PixVerse prediction without starting another render."}</span>
                                </div>
                              </div>
                            )}

                            {isPlayable && !shownInComparison && (
                              <div className="border-t border-fuchsia-500/15 bg-black/20 p-3">
                                <video
                                  key={attempt.video_url}
                                  src={attempt.video_url as string}
                                  className="aspect-video w-full rounded-lg bg-black object-contain"
                                  controls
                                  playsInline
                                  preload="metadata"
                                  aria-label={`PixVerse comparison for Scene ${formatScene(attempt.scene_number)}, ${attempt.character_id}`}
                                />
                                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-gray-500">
                                  <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" aria-hidden="true" /> Private MP4 ready for review</span>
                                  <a href={attempt.video_url as string} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-gray-400 transition-colors hover:text-fuchsia-200"><ExternalLink className="h-3 w-3" aria-hidden="true" /> Open player</a>
                                </div>
                              </div>
                            )}

                            {attempt.status === "READY" && !isPlayable && (
                              <div className="border-t border-red-500/20 bg-red-950/20 px-3 py-2.5 text-[11px] leading-relaxed text-red-100/80">The saved READY PixVerse attempt has no playable private MP4 in this tab. Its source and audio lineage remain saved.</div>
                            )}
                            {(attempt.status === "FAILED" || attempt.status === "CANCELED") && (
                              <div className="border-t border-[#26364b] px-3 py-2.5 text-[11px] leading-relaxed text-gray-400">{attempt.error || (attempt.status === "CANCELED" ? "This PixVerse comparison was canceled before producing a video. Earlier READY outputs remain available." : "This PixVerse comparison failed before producing a video. Earlier READY outputs remain available.")}</div>
                            )}
                          </article>
                        );
                      })}
                      <p className="text-[10px] leading-relaxed text-gray-500">These PixVerse attempts stay in their separate manual comparison history. Production-default PixVerse attempts are saved in the shared history above; comparison attempts stay outside automatic coverage, shot-plan validation, and assembly.</p>
                    </div>
                  ) : (
                    <div className="mt-5 rounded-xl border border-dashed border-fuchsia-500/25 bg-fuchsia-950/10 p-4 text-xs leading-relaxed text-gray-500">No PixVerse comparison exists for this exact close-up prediction and MP3 yet. Click Render PixVerse comparison to create one explicit, separate attempt.</div>
                  )
                ) : (
                  <div className="mt-5 rounded-xl border border-dashed border-[#344760] bg-[#0b1420] p-4 text-xs leading-relaxed text-gray-500">Choose the exact saved MP3 above before rendering a PixVerse comparison. The provider will receive the same source and take shown in this panel.</div>
                )}
              </section>
            </div>
          )}

          <div className="rounded-2xl border border-[#2a364e] bg-[#121a28] p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-300">Saved source frames</p>
                <h3 className="mt-1.5 text-lg font-semibold text-white">What the render started from</h3>
              </div>
              <Video className="h-5 w-5 text-sky-300" aria-hidden="true" />
            </div>
            <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2">
              <div className="overflow-hidden rounded-xl border border-[#303d55] bg-[#0d131f]">
                <ImagePreview
                  url={selectedStoryboard?.image_url || null}
                  alt={selectedStoryboard ? `Scene ${formatScene(selectedEntry?.sceneNumber || 0)} storyboard` : "Scene storyboard unavailable"}
                  className="aspect-[16/10] w-full"
                />
                <div className="p-3">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-gray-500">Scene continuity</p>
                  <p className="mt-1 text-xs font-semibold text-gray-200">{selectedStoryboard ? "Saved scene storyboard" : "No saved storyboard"}</p>
                </div>
              </div>
              <div className="overflow-hidden rounded-xl border border-[#303d55] bg-[#0d131f]">
                <ImagePreview
                  url={selectedCharacterReference?.image_url || null}
                  alt={selectedCharacterReference ? `${selectedCharacterId} character reference` : "Character reference unavailable"}
                  className="aspect-[16/10] w-full"
                />
                <div className="p-3">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-gray-500">Speaker continuity</p>
                  <p className="mt-1 text-xs font-semibold text-gray-200">{selectedCharacterReference ? `Saved ${selectedCharacterId} reference` : "No saved speaker reference"}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-[#2a364e] bg-[#121a28] p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-300">Attempt history</p>
                <h3 className="mt-1.5 text-lg font-semibold text-white">Earlier shots stay reviewable</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-gray-400">
                  History stays intact across new source choices. A failed render never replaces a ready shot from an earlier attempt.
                </p>
              </div>
              <span className="rounded-md border border-[#39465f] bg-[#182235] px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-gray-400">
                {historyAttempts.length} saved
              </span>
            </div>

            {historyAttempts.length > 0 ? (
              <div className="mt-4 space-y-3">
                {historyAttempts.map((attempt) => {
                  const isCurrent = Boolean(selectedContext && clipMatchesContext(attempt, selectedContext));
                  const isPlayable = attempt.status === "READY" && isSecureHttpsUrl(attempt.video_url);
                  return (
                    <article key={attempt.prediction_id} className={`overflow-hidden rounded-xl border ${isCurrent ? "border-amber-500/45 bg-amber-500/5" : "border-[#303d55] bg-[#0d131f]"}`}>
                      <div className="flex min-w-0 flex-col gap-3 p-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-mono uppercase tracking-wider ${attemptClass(attempt.status)}`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${statusDotClass(attempt.status)}`} aria-hidden="true" />
                              {attemptLabel(attempt.status)}
                            </span>
                            {isCurrent && <span className="rounded-md border border-amber-500/25 bg-amber-500/10 px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-amber-200">Selected source</span>}
                          </div>
                          <p className="mt-2 break-words text-xs font-semibold text-gray-200">
                            Scene {formatScene(attempt.scene_number)} · {attempt.line_id} · {attempt.character_id}
                          </p>
                          <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-gray-400">“{attempt.text}”</p>
                          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-mono uppercase tracking-wider text-gray-500">
                            <span>{sourceLabel(attempt.source_frame_type)}</span>
                            <span>{formatAttemptDate(attempt.updated_at || attempt.created_at)}</span>
                            <span title={attempt.prediction_id}>#{shortId(attempt.prediction_id)}</span>
                          </div>
                        </div>
                        {attempt.status === "QUEUED" || attempt.status === "PROCESSING" ? (
                          <span className="inline-flex shrink-0 items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-amber-200">
                            <Clock3 className="h-3.5 w-3.5" aria-hidden="true" /> Saved in progress
                          </span>
                        ) : null}
                      </div>
                      {isPlayable && (
                        <div className="border-t border-[#263249] bg-black/20 p-3">
                          <video
                            className="aspect-video w-full rounded-lg bg-black object-contain"
                            src={attempt.video_url as string}
                            controls
                            playsInline
                            preload="metadata"
                            aria-label={`Silent dialogue close-up for Scene ${formatScene(attempt.scene_number)}, ${attempt.character_id}`}
                          />
                          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-gray-500">
                            <span className="inline-flex items-center gap-1.5">
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" aria-hidden="true" /> Private MP4 ready for review
                            </span>
                            <a
                              href={attempt.video_url as string}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-gray-400 transition-colors hover:text-amber-200"
                            >
                              <ExternalLink className="h-3 w-3" aria-hidden="true" /> Open player
                            </a>
                          </div>
                        </div>
                      )}
                      {attempt.status === "FAILED" || attempt.status === "CANCELED" ? (
                        <div className="border-t border-[#263249] px-3 py-2.5 text-[11px] leading-relaxed text-gray-500">
                          {attempt.error || (attempt.status === "CANCELED" ? "Canceled before a playable source shot was archived." : "Provider could not finish this attempt.")}
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-dashed border-[#34415b] bg-[#0d131f] p-5 text-center">
                <Video className="mx-auto h-7 w-7 text-gray-600" aria-hidden="true" />
                <p className="mt-3 text-sm font-semibold text-gray-300">No source shots saved yet</p>
                <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-gray-500">Choose the approved line and saved source above, then create one five-second close-up for review.</p>
              </div>
            )}
          </div>

          <div className="flex items-start gap-2 rounded-xl border border-sky-500/20 bg-sky-950/15 px-3.5 py-3 text-[11px] leading-relaxed text-sky-100/75">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" aria-hidden="true" />
            <span>These clips stay in the separate dialogue close-up collection. Lip-sync, normal scene motion, voice takes, rough cut, scene mix, and Episode Mix continue to use their existing saved records.</span>
          </div>
        </div>
      </div>
    </section>
  );
};
