import React, { useCallback, useState, useEffect, useMemo, useRef } from "react";
import {
  DramaManifest,
  DramaScene,
  CharacterProfile,
  FrameAsset,
  FrameProgress,
  FrameStatus,
  VideoStatus,
  VideoClip,
  SilentPreviewMetadata,
  SilentPreviewPlaylist,
  getLatestVideoClip,
  validateManifest,
  downloadManifestFile,
  STYLE_PRESETS,
  DialogueAudioAsset,
  AmbienceAudioAsset,
  DialogueLine,
  deriveDialogueLines,
  ElevenLabsVoice,
  LipsyncAsset,
  SavedShotPlanSnapshot,
  FinalAssemblyAsset,
  VoiceAssignment,
} from "@/lib/dramaStudio";
import type { CoverageLineProgress } from "@/lib/sceneCoverageRunner";
import { SilentPreview } from "@/components/SilentPreview";
import { AudioTestPanel, AudioTestPanelProps } from "@/components/AudioTestPanel";
import { SceneTimingProof } from "@/components/SceneTimingProof";
import { RoughCutPreview } from "@/components/RoughCutPreview";
import { SceneMixProof } from "@/components/SceneMixProof";
import { EpisodeMixProof } from "@/components/EpisodeMixProof";
import { LipSyncProof, LipSyncProofProps } from "@/components/LipSyncProof";
import { DialogueCloseupProof, DialogueCloseupProofProps } from "@/components/DialogueCloseupProof";
import { ShotPlanProof, ShotPlanProofProps } from "@/components/ShotPlanProof";
import { SceneAssemblyProof } from "@/components/SceneAssemblyProof";
import { SceneAmbiencePanel } from "@/components/SceneAmbiencePanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Film,
  Users,
  Code2,
  Save,
  Download,
  Copy,
  Check,
  Plus,
  Trash2,
  Clock,
  Camera,
  Eye,
  MessageSquare,
  Lock,
  Sparkles,
  Info,
  Layers,
  AlertCircle,
  ImageIcon,
  ExternalLink,
  RefreshCw,
  Loader2,
  CircleCheck,
  CircleX,
  Video as VideoIcon,
  Play,
  AudioLines,
  Waves,
  ListOrdered,
} from "lucide-react";

const FrameImageCard: React.FC<{
  asset: FrameAsset;
  label: string;
  title: string;
  detail: string;
}> = ({ asset, label, title, detail }) => {
  const [imageFailed, setImageFailed] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

  useEffect(() => {
    setImageFailed(false);
    setImageLoaded(false);
  }, [asset.image_url]);

  return (
    <article className="overflow-hidden rounded-xl border border-[#252f45] bg-[#101622] shadow-lg shadow-black/20">
      <div className="relative aspect-[9/16] min-h-[260px] bg-[#090c12]">
        {!imageFailed ? (
          <img
            src={asset.image_url}
            alt={`${title} ${label}`}
            className={`h-full w-full object-cover transition-opacity duration-300 ${imageLoaded ? "opacity-100" : "opacity-0"}`}
            loading="lazy"
            onLoad={() => setImageLoaded(true)}
            onError={() => setImageFailed(true)}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-5 text-center text-xs text-gray-400">
            <ImageIcon className="h-7 w-7 text-amber-400/70" />
            <p className="font-medium text-gray-300">Image unavailable in this tab</p>
            <p className="leading-relaxed">The saved URL is still attached to this asset. Open it to check the hosted image.</p>
          </div>
        )}
        {!imageFailed && !imageLoaded && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#090c12]/80 text-center text-xs text-gray-400">
            <span className="flex items-center gap-2 rounded-md border border-[#2a354b] bg-black/40 px-3 py-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" /> Loading hosted image...
            </span>
          </div>
        )}
        <div className="absolute left-3 top-3 rounded-md border border-black/30 bg-black/70 px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-amber-200 backdrop-blur-sm">
          {label}
        </div>
      </div>
      <div className="space-y-3 p-3.5">
        <div>
          <h4 className="truncate text-sm font-semibold text-white">{title}</h4>
          <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-gray-400">{detail}</p>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-[#1d2638] pt-3">
          <span className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-emerald-300">
            <CircleCheck className="h-3.5 w-3.5" /> Saved
          </span>
          <div className="flex items-center gap-1.5">
            <a
              href={asset.image_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-[#2b3850] bg-[#171f30] px-2 py-1.5 text-[11px] text-gray-200 transition-colors hover:border-amber-500/50 hover:text-white"
            >
              <ExternalLink className="h-3 w-3 text-amber-400" /> Open
            </a>
            <a
              href={asset.image_url}
              download
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-200 transition-colors hover:bg-amber-500/20"
            >
              <Download className="h-3 w-3" /> Save
            </a>
          </div>
        </div>
      </div>
    </article>
  );
};

type ProductionStageCardTone = "done" | "current" | "later" | "attention";

const ProductionStageCard: React.FC<{
  number: string;
  title: string;
  status: string;
  description: string;
  icon: React.ElementType;
  tone: ProductionStageCardTone;
  current?: boolean;
  actionLabel?: string;
  actionIcon?: React.ElementType;
  onAction?: () => void;
  actionTitle?: string;
}> = ({
  number,
  title,
  status,
  description,
  icon: Icon,
  tone,
  current = false,
  actionLabel,
  actionIcon: ActionIcon,
  onAction,
  actionTitle,
}) => {
  const palette: Record<ProductionStageCardTone, {
    card: string;
    number: string;
    icon: string;
    status: string;
    action: string;
  }> = {
    done: {
      card: "border-emerald-500/25 bg-[linear-gradient(145deg,rgba(16,185,129,0.08),rgba(17,24,36,0.96))]",
      number: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
      icon: "text-emerald-300",
      status: "border-emerald-500/25 bg-emerald-500/10 text-emerald-200",
      action: "border-emerald-500/25 bg-emerald-500/5 text-emerald-100 hover:border-emerald-400/50 hover:bg-emerald-500/10",
    },
    current: {
      card: "border-amber-500/45 bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,0.16),transparent_58%),#171a20] shadow-lg shadow-amber-950/20",
      number: "border-amber-400/40 bg-amber-500/15 text-amber-100",
      icon: "text-amber-300",
      status: "border-amber-400/35 bg-amber-500/15 text-amber-100",
      action: "border-amber-400/35 bg-amber-500 text-black hover:bg-amber-400",
    },
    attention: {
      card: "border-red-500/35 bg-[linear-gradient(145deg,rgba(127,29,29,0.18),rgba(17,24,36,0.96))]",
      number: "border-red-500/35 bg-red-500/10 text-red-200",
      icon: "text-red-300",
      status: "border-red-500/30 bg-red-500/10 text-red-200",
      action: "border-red-500/35 bg-red-500/10 text-red-100 hover:border-red-400/50 hover:bg-red-500/15",
    },
    later: {
      card: "border-[#273248] bg-[#111722]",
      number: "border-[#33415d] bg-[#151d2c] text-gray-400",
      icon: "text-gray-500",
      status: "border-[#33415d] bg-[#151d2c] text-gray-400",
      action: "border-[#33415d] bg-[#151d2c] text-gray-200 hover:border-amber-500/45 hover:bg-[#1a2538] hover:text-white",
    },
  };
  const colors = palette[tone];

  return (
    <article
      className={`flex min-w-0 flex-col justify-between rounded-2xl border p-4 transition-colors sm:p-5 ${colors.card} ${current ? "ring-1 ring-amber-300/20" : ""}`}
      aria-current={current ? "step" : undefined}
    >
      <div className="flex min-w-0 items-start gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border font-mono text-sm font-bold ${colors.number}`}>
          {number}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <Icon className={`h-4 w-4 shrink-0 ${colors.icon}`} aria-hidden="true" />
              <h3 className="break-words text-sm font-semibold text-white sm:text-base">{title}</h3>
            </div>
            <span className={`inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-mono uppercase tracking-wider ${colors.status}`}>
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone === "done" ? "bg-emerald-300" : tone === "attention" ? "bg-red-300" : tone === "current" ? "bg-amber-300" : "bg-gray-500"}`} aria-hidden="true" />
              <span className="break-words leading-tight">{status}</span>
            </span>
          </div>
          {current && (
            <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-amber-300">Current focus</p>
          )}
          <p className="mt-2 text-xs leading-relaxed text-gray-300 sm:text-sm">{description}</p>
        </div>
      </div>

      {onAction && actionLabel && (
        <Button
          type="button"
          variant="outline"
          onClick={onAction}
          title={actionTitle}
          className={`mt-4 h-auto min-h-9 w-full justify-between gap-3 px-3 py-2 text-left text-xs font-semibold leading-tight !whitespace-normal ${colors.action}`}
        >
          <span className="min-w-0 break-words">{actionLabel}</span>
          {ActionIcon ? <ActionIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <span aria-hidden="true">→</span>}
        </Button>
      )}
    </article>
  );
};

const EMPTY_SILENT_PREVIEW: SilentPreviewPlaylist = {
  mode: "silent_hard_cut",
  scene_numbers: [],
  clip_prediction_ids: [],
  items: [],
  missing_scene_numbers: [],
  total_duration_seconds: 0,
  complete: false,
};

interface DramaEditorProps {
  initialManifest: DramaManifest | null;
  initialTitle: string;
  synopsis?: string;
  orientation?: "vertical" | "horizontal";
  artStyle?: string;
  gateStatus?: "PENDING" | "AWAITING_SETUP_CONFIRM" | "AWAITING_SCRIPT_CONFIRM" | "SCRIPTED" | "FAILED";
  productionApproved?: boolean;
  isGateActionRunning?: boolean;
  isStartingVisualProduction?: boolean;
  autoOpenFrames?: boolean;
  generationError?: string | null;
  onSaveSetup?: (title: string, synopsis: string) => Promise<void>;
  onRegenerateSetup?: () => void | Promise<void>;
  onConfirmSetup?: (title: string, synopsis: string) => void | Promise<void>;
  onBackToPitch?: () => void;
  onRegenerateScript?: () => void | Promise<void>;
  onApproveProduction?: (manifest: DramaManifest, title: string) => Promise<void>;
  seed: number;
  expectedSceneCount?: number;
  isSaving: boolean;
  onSave: (manifest: DramaManifest, title: string) => Promise<void>;
  onDirtyChange?: (isDirty: boolean) => void;
  onExport?: (manifest: DramaManifest) => void;
  onGenerateFrames?: (mode?: "missing" | "all") => void | Promise<void>;
  frameStatus?: FrameStatus;
  frameAssets?: FrameAsset[];
  frameProgress?: FrameProgress;
  frameError?: string | null;
  isGeneratingFrames?: boolean;
  authAvailable?: boolean;
  persistedProject?: boolean;
  videoStatus?: VideoStatus;
  videoClips?: VideoClip[];
  videoError?: string | null;
  videoStartingScene?: number | null;
  onGenerateVideo?: (sceneNumber: number, regenerate?: boolean) => void | Promise<void>;
  silentPreviewPlaylist?: SilentPreviewPlaylist;
  previewMetadata?: SilentPreviewMetadata | null;
  onSavePreview?: () => Promise<void>;
  previewLoading?: boolean;
  previewError?: string | null;
  voiceAssignments?: VoiceAssignment[];
  audioAssets?: DialogueAudioAsset[];
  ambienceAssets?: AmbienceAudioAsset[];
  ambienceBusy?: boolean;
  ambienceError?: string | null;
  onGenerateAmbience?: (request: {
    sceneNumber: number;
    prompt: string;
    durationSeconds: number;
  }) => Promise<boolean | void> | boolean | void;
  voices?: ElevenLabsVoice[];
  voiceLoading?: boolean;
  voiceError?: string | null;
  synthesisBusy?: boolean;
  synthesisError?: string | null;
  onLoadVoices?: AudioTestPanelProps["onLoadVoices"];
  onGenerateVoiceTake?: AudioTestPanelProps["onGenerateVoiceTake"];
  onDurationMeasured?: AudioTestPanelProps["onDurationMeasured"];
  lipsyncAssets?: LipsyncAsset[];
  isStartingLipsync?: boolean;
  lipsyncError?: string | null;
  onStartLipsync?: LipSyncProofProps["onStartLipsync"];
  onCheckLipsync?: LipSyncProofProps["onCheckLipsync"];
  pixverseLipsyncAssets?: DialogueCloseupProofProps["pixverseLipsyncAssets"];
  isStartingPixverseLipsync?: DialogueCloseupProofProps["isStartingPixverseLipsync"];
  pixverseLipsyncError?: DialogueCloseupProofProps["pixverseLipsyncError"];
  onStartPixverseLipsync?: DialogueCloseupProofProps["onStartPixverseLipsync"];
  onCheckPixverseLipsync?: DialogueCloseupProofProps["onCheckPixverseLipsync"];
  projectId: string;
  dialogueShotClips?: DialogueCloseupProofProps["dialogueShotClips"];
  onDialogueShotClipUpdate?: DialogueCloseupProofProps["onDialogueShotClipUpdate"];
  shotPlan?: SavedShotPlanSnapshot | null;
  assemblyAssets?: FinalAssemblyAsset[];
  onSaveAssemblyAsset?: (asset: FinalAssemblyAsset) => Promise<boolean>;
  shotPlanValidationError?: string | null;
  isSavingShotPlan?: boolean;
  shotPlanSaveError?: string | null;
  onSaveShotPlan?: ShotPlanProofProps["onSaveShotPlan"];
  onShotPlanDirtyChange?: ShotPlanProofProps["onShotPlanDirtyChange"];
  coverageRunState?: {
    sceneNumber: number | null;
    status: "idle" | "running" | "complete" | "failed" | "canceled";
    progress: readonly CoverageLineProgress[];
    error?: string | null;
  };
  onRunSceneCoverage?: (sceneNumber: number) => Promise<boolean>;
  onCancelSceneCoverage?: () => void;
}

export const DramaEditor: React.FC<DramaEditorProps> = ({
  initialManifest,
  initialTitle,
  synopsis = "",
  orientation = "vertical",
  artStyle = "",
  gateStatus,
  productionApproved = false,
  isGateActionRunning = false,
  isStartingVisualProduction = false,
  autoOpenFrames = false,
  generationError = null,
  onRegenerateSetup,
  onConfirmSetup,
  onBackToPitch,
  onRegenerateScript,
  onApproveProduction,
  seed,
  expectedSceneCount,
  isSaving,
  onSave,
  onDirtyChange,
  onExport,
  onGenerateFrames,
  frameStatus = "NOT_STARTED",
  frameAssets = [],
  frameProgress = { stage: "idle", current: 0, total: 0, completed: 0 },
  frameError = null,
  isGeneratingFrames = false,
  authAvailable = false,
  persistedProject = false,
  videoStatus = "NOT_STARTED",
  videoClips = [],
  videoError = null,
  videoStartingScene = null,
  onGenerateVideo,
  silentPreviewPlaylist = EMPTY_SILENT_PREVIEW,
  previewMetadata = null,
  onSavePreview,
  previewLoading = false,
  previewError = null,
  voiceAssignments = [],
  audioAssets = [],
  ambienceAssets = [],
  ambienceBusy = false,
  ambienceError = null,
  onGenerateAmbience,
  voices = [],
  voiceLoading = false,
  voiceError = null,
  synthesisBusy = false,
  synthesisError = null,
  onLoadVoices,
  onGenerateVoiceTake,
  onDurationMeasured,
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
  projectId,
  dialogueShotClips = [],
  onDialogueShotClipUpdate,
  shotPlan = null,
  assemblyAssets = [],
  onSaveAssemblyAsset,
  shotPlanValidationError = null,
  isSavingShotPlan = false,
  shotPlanSaveError = null,
  onSaveShotPlan,
  onShotPlanDirtyChange,
  coverageRunState,
  onRunSceneCoverage,
  onCancelSceneCoverage,
}) => {
  const activeGateStatus = gateStatus || (initialManifest ? "SCRIPTED" : "AWAITING_SETUP_CONFIRM");
  const productionUnlocked = activeGateStatus === "SCRIPTED" && productionApproved;
  const isSetupReview = !initialManifest && activeGateStatus === "AWAITING_SETUP_CONFIRM";
  const isScriptReviewGate = Boolean(initialManifest) && !productionUnlocked && activeGateStatus !== "AWAITING_SETUP_CONFIRM";
  const safeInitialTitle = typeof initialTitle === "string" && initialTitle.trim()
    ? initialTitle
    : initialManifest && typeof initialManifest.project_title === "string" && initialManifest.project_title.trim()
      ? initialManifest.project_title
      : "Untitled Drama";
  const safeInitialGlobalStyle = initialManifest && typeof initialManifest.global_style === "string"
    ? initialManifest.global_style
    : "";
  const [title, setTitle] = useState(safeInitialTitle);
  const [globalStyle, setGlobalStyle] = useState(safeInitialGlobalStyle);
  const [characters, setCharacters] = useState<CharacterProfile[]>(
    Array.isArray(initialManifest?.characters) ? JSON.parse(JSON.stringify(initialManifest.characters)) : []
  );
  const [scenes, setScenes] = useState<DramaScene[]>(
    Array.isArray(initialManifest?.scenes) ? JSON.parse(JSON.stringify(initialManifest.scenes)) : []
  );

  const [activeTab, setActiveTab] = useState<string>("scenes");
  const wasProductionUnlockedRef = useRef(productionUnlocked);
  const [copiedJson, setCopiedJson] = useState(false);
  const [saveSuccessNotice, setSaveSuccessNotice] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [frameActionNotice, setFrameActionNotice] = useState<string | null>(null);
  const [frameActionError, setFrameActionError] = useState<string | null>(null);
  const [savedShotPlanSnapshot, setSavedShotPlanSnapshot] = useState<SavedShotPlanSnapshot | null>(shotPlan ?? null);
  const incomingShotPlanIdentity = useMemo(() => {
    try {
      return JSON.stringify(shotPlan ?? null) || "null";
    } catch {
      return String(shotPlan ?? null);
    }
  }, [shotPlan]);

  // Keep the proof tabs on one persisted snapshot. A semantic prop identity prevents
  // unrelated editor renders from replacing a freshly confirmed local snapshot.
  useEffect(() => {
    setSavedShotPlanSnapshot(shotPlan ?? null);
  }, [incomingShotPlanIdentity, projectId]);

  const sharedOnSaveShotPlan = useCallback(async (plan: SavedShotPlanSnapshot): Promise<boolean> => {
    if (!onSaveShotPlan) return false;
    const saved = await onSaveShotPlan(plan);
    if (saved === true) {
      setSavedShotPlanSnapshot(plan);
    }
    return saved;
  }, [onSaveShotPlan]);

  // Sync local review fields only when the persisted project or gate snapshot changes.
  // Busy-flag transitions must not overwrite edits that failed to save.
  useEffect(() => {
    setTitle(safeInitialTitle);
    setGlobalStyle(safeInitialGlobalStyle);
    setCharacters(Array.isArray(initialManifest?.characters) ? JSON.parse(JSON.stringify(initialManifest.characters)) : []);
    setScenes(Array.isArray(initialManifest?.scenes) ? JSON.parse(JSON.stringify(initialManifest.scenes)) : []);
    setValidationError(null);
    setFrameActionNotice(null);
    setFrameActionError(null);
  }, [initialManifest, initialTitle, gateStatus]);

  // Check if current state has unsaved changes compared to initial
  const isDirty = useMemo(() => {
    if (!initialManifest) return false;
    if (title !== initialTitle && title !== initialManifest.project_title) return true;
    if (globalStyle !== initialManifest.global_style) return true;
    if (JSON.stringify(characters) !== JSON.stringify(initialManifest.characters)) return true;
    if (JSON.stringify(scenes) !== JSON.stringify(initialManifest.scenes)) return true;
    return false;
  }, [title, globalStyle, characters, scenes, initialManifest, initialTitle]);

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  useEffect(() => {
    if (!productionUnlocked && ["frames", "video", "preview", "roughcut", "sound", "lipsync", "shot-plan", "scene-assembly", "ambience", "mix", "episode-mix", "json"].includes(activeTab)) {
      setActiveTab("scenes");
    }
  }, [activeTab, productionUnlocked]);

  useEffect(() => {
    const becameUnlocked = productionUnlocked && !wasProductionUnlockedRef.current;
    if (productionUnlocked && (becameUnlocked || autoOpenFrames)) {
      setActiveTab("frames");
    }
    wasProductionUnlockedRef.current = productionUnlocked;
  }, [productionUnlocked, autoOpenFrames]);

  // Current compiled manifest
  const currentManifest: DramaManifest = useMemo(() => {
    return {
      project_title: title.trim(),
      global_style: globalStyle.trim(),
      characters,
      scenes,
    };
  }, [title, globalStyle, characters, scenes]);

  const totalRuntimeSeconds = useMemo(() => {
    return scenes.reduce((sum, scene) => {
      const duration = typeof scene?.duration_seconds === "number" && Number.isFinite(scene.duration_seconds)
        ? scene.duration_seconds
        : 4;
      return sum + duration;
    }, 0);
  }, [scenes]);

  const characterFrameAssets = useMemo(
    () => frameAssets.filter((asset) => asset.asset_type === "character_reference"),
    [frameAssets]
  );
  const sceneFrameAssets = useMemo(
    () => frameAssets.filter((asset) => asset.asset_type === "scene_storyboard"),
    [frameAssets]
  );
  const expectedFrameCount = characters.length + scenes.length;
  const savedFrameCount = characterFrameAssets.length + sceneFrameAssets.length;
  const allFramesReady = expectedFrameCount > 0 && savedFrameCount >= expectedFrameCount;
  const frameRunInProgress = isGeneratingFrames || isStartingVisualProduction;
  const frameActionIsRecovery = frameStatus === "FAILED" || savedFrameCount > 0;
  const persistedManifestValidation = useMemo(
    () => initialManifest
      ? validateManifest(initialManifest, expectedSceneCount)
      : { valid: false, error: "A screenplay is not available at this checkpoint." },
    [initialManifest, expectedSceneCount]
  );
  const manifestNeedsRecovery = !initialManifest || !persistedManifestValidation.valid || scenes.length === 0;
  const canGenerateFrames = Boolean(
    productionUnlocked &&
    onGenerateFrames &&
    authAvailable &&
    persistedProject &&
    persistedManifestValidation.valid
  );
  const orientationLabelText = orientation === "horizontal" ? "Horizontal 16:9" : "Vertical 9:16";
  const frameProgressPercent = frameProgress.total > 0
    ? Math.min(100, Math.round((frameProgress.completed / frameProgress.total) * 100))
    : expectedFrameCount > 0
      ? Math.round((savedFrameCount / expectedFrameCount) * 100)
      : 0;
  const frameActionLabel = !authAvailable
    ? "Sign in first"
    : !persistedProject || isDirty || !persistedManifestValidation.valid
      ? "Save script first"
      : isGeneratingFrames
        ? "Generating frames..."
        : frameStatus === "FAILED"
          ? "Retry Missing Frames"
          : allFramesReady
            ? "Frames ready"
            : savedFrameCount > 0
              ? "Generate Missing Frames"
              : "Generate Frames";
  const framePrimaryActionLabel = !authAvailable
    ? "Sign in first"
    : !persistedProject || isDirty || !persistedManifestValidation.valid
      ? "Save script first"
      : isGeneratingFrames
        ? "Generating frames..."
        : frameStatus === "FAILED"
          ? "Retry Missing Frames"
          : allFramesReady
            ? "Regenerate All"
            : savedFrameCount > 0
              ? "Generate Missing Frames"
              : "Generate Frames";
  const frameActionDescription = !authAvailable
    ? "Sign in before generating private project images"
    : !persistedProject || isDirty || !persistedManifestValidation.valid
      ? "Save a valid screenplay before generating visual references"
      : isGeneratingFrames
        ? "Frame generation is active. Keep this browser tab open"
        : frameStatus === "FAILED"
          ? "Retry only the missing character references and scene storyboards"
          : allFramesReady
            ? "Open the saved character references and scene storyboards, or request a fresh pass"
            : "Open Frames and create the next missing visual references";

  const activeVideoClip = videoClips.find(
    (clip) => clip.status === "QUEUED" || clip.status === "PROCESSING"
  ) || null;
  const canGenerateMotion = Boolean(
    productionUnlocked &&
    onGenerateVideo &&
    authAvailable &&
    persistedProject &&
    !isDirty &&
    persistedManifestValidation.valid &&
    !isSaving &&
    !isGeneratingFrames
  );
  const videoStatusLabel = videoStatus === "READY"
    ? "Motion ready"
    : videoStatus === "FAILED"
      ? "Needs review"
      : videoStatus === "PROCESSING"
        ? "Rendering"
        : videoStatus === "QUEUED"
          ? "Queued"
          : "Not started";
  const dialogueLineCount = useMemo(
    () => scenes.reduce((total, scene) => {
      try {
        return total + deriveDialogueLines(scene).length;
      } catch {
        return total;
      }
    }, 0),
    [scenes]
  );
  const readyAudioCount = audioAssets.filter((asset) => asset.status === "READY" && Boolean(asset.audio_url)).length;
  const audioStageReady = dialogueLineCount === 0 || readyAudioCount >= dialogueLineCount;
  const previewSceneTargetCount = scenes.length || expectedSceneCount || 0;
  const nextRoadmapStage = !productionUnlocked
    ? "script"
    : !allFramesReady
      ? "frames"
      : videoStatus !== "READY"
        ? "video"
        : !audioStageReady
          ? "audio"
          : "final";
  const frameRoadmapStatus = !productionUnlocked
    ? "Locked until approval"
    : frameRunInProgress
      ? `Saving ${frameProgress.completed} of ${frameProgress.total || expectedFrameCount}`
      : frameStatus === "FAILED"
        ? `${savedFrameCount} saved, needs retry`
        : allFramesReady
          ? `${savedFrameCount} assets ready`
          : `${savedFrameCount} of ${expectedFrameCount} saved`;
  const audioRoadmapStatus = !productionUnlocked
    ? "Locked until approval"
    : synthesisBusy
      ? "Creating voice takes"
      : dialogueLineCount === 0
        ? "No spoken lines"
        : audioStageReady
          ? "Voice takes ready"
          : readyAudioCount > 0
            ? `${readyAudioCount} of ${dialogueLineCount} takes saved`
            : "Ready to test";
  const finalRoadmapStatus = !productionUnlocked
    ? "Locked until approval"
    : silentPreviewPlaylist.complete
      ? "Ready to watch"
      : silentPreviewPlaylist.items.length > 0
        ? `${silentPreviewPlaylist.items.length} of ${previewSceneTargetCount} scenes ready`
        : "Waiting for motion";

  const handleSave = async () => {
    if (isGateActionRunning || isSaving || isGeneratingFrames) return;
    setValidationError(null);
    const targetCount = expectedSceneCount || scenes.length;
    const validation = validateManifest(currentManifest, targetCount);
    if (!validation.valid || !validation.manifest) {
      setValidationError(validation.error || "Please check your script entries for errors.");
      return;
    }

    try {
      await onSave(validation.manifest, title.trim());
      setSaveSuccessNotice(true);
      setTimeout(() => setSaveSuccessNotice(false), 3000);
    } catch (err: any) {
      setValidationError(err?.message || "Failed to save project changes.");
    }
  };

  const handleFrameAction = async (mode: "missing" | "all" = "missing") => {
    if (!productionUnlocked) {
      setActiveTab("scenes");
      setFrameActionNotice("Approve the screenplay first. Frames and Motion open after this checkpoint.");
      return;
    }
    setActiveTab("frames");
    setFrameActionNotice(null);
    setFrameActionError(null);

    if (isGeneratingFrames) {
      setFrameActionNotice("Frame generation is already in progress. Keep this browser tab open while each image is saved.");
      return;
    }
    if (isSaving) {
      setFrameActionNotice("Your screenplay is still saving. Frames can start after the save finishes.");
      return;
    }
    if (isDirty || !persistedProject || !persistedManifestValidation.valid) {
      return;
    }
    if (!authAvailable) {
      return;
    }

    const generateFrames = onGenerateFrames;
    if (!generateFrames) {
      setFrameActionNotice("The Frames stage is not available for this project yet.");
      return;
    }

    // A ready stage opens its shelf instead of unexpectedly regenerating images.
    if (mode === "missing" && allFramesReady) {
      return;
    }

    try {
      await generateFrames(mode);
    } catch (err: any) {
      setFrameActionError(err?.message || "Frame generation could not start. Review the frame status below.");
    }
  };

  const handleVideoAction = (sceneNumber: number, clip: VideoClip | null) => {
    setActiveTab("video");
    if (!onGenerateVideo) return;
    if (clip?.status === "READY") {
      const confirmed = window.confirm(
        `Generate a new five-second motion test for Scene ${sceneNumber}? The saved clip will remain available for review.`
      );
      if (!confirmed) return;
      void onGenerateVideo(sceneNumber, true);
      return;
    }
    void onGenerateVideo(sceneNumber, clip?.status === "FAILED");
  };

  const handleExportJson = () => {
    setValidationError(null);
    try {
      downloadManifestFile(currentManifest, title, expectedSceneCount || scenes.length);
    } catch (err: any) {
      setValidationError(err?.message || "Cannot export invalid manifest.");
    }
  };

  const handleCopyJson = () => {
    setValidationError(null);
    const validation = validateManifest(currentManifest, expectedSceneCount || scenes.length);
    if (!validation.valid || !validation.manifest) {
      setValidationError(validation.error || "Cannot copy invalid manifest JSON.");
      return;
    }
    navigator.clipboard.writeText(JSON.stringify(validation.manifest, null, 2));
    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 2000);
  };

  // Character modifications
  const handleUpdateCharacter = (index: number, updated: Partial<CharacterProfile>) => {
    setCharacters((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], ...updated };
      return copy;
    });
  };

  const handleAddCharacter = () => {
    const nextCharIndex = characters.length;
    const nextCharId = `CHARACTER_${String.fromCharCode(65 + nextCharIndex)}`;
    setCharacters((prev) => [
      ...prev,
      {
        id: nextCharId,
        detailed_visual_profile: "",
      },
    ]);
  };

  const getEditableDialogueLines = (scene: DramaScene): DialogueLine[] => {
    if (Array.isArray(scene.dialogue_lines) && scene.dialogue_lines.length > 0) {
      return scene.dialogue_lines.map((line, index) => ({
        ...line,
        line_id: line.line_id || `scene-${scene.scene_number}-line-${index + 1}`,
        character_id: line.character_id || scene.character_focus[0] || characters[0]?.id || "CHARACTER_A",
        text: typeof line.text === "string" ? line.text : "",
        order: index + 1,
      }));
    }
    return deriveDialogueLines(scene);
  };

  const syncDialogueLines = (scene: DramaScene, lines: DialogueLine[]): DramaScene => {
    const normalizedLines = lines.map((line, index) => ({
      ...line,
      line_id: line.line_id || `scene-${scene.scene_number}-line-${index + 1}`,
      character_id: line.character_id || scene.character_focus[0] || characters[0]?.id || "CHARACTER_A",
      text: typeof line.text === "string" ? line.text : "",
      order: index + 1,
    }));
    const compatibilityDialogue = normalizedLines.map((line) => line.text.trim()).filter(Boolean).join(" ");
    return {
      ...scene,
      dialogue: compatibilityDialogue,
      dialogue_lines: normalizedLines,
    };
  };

  const updateSceneDialogueLines = (
    sceneIndex: number,
    update: (lines: DialogueLine[], scene: DramaScene) => DialogueLine[]
  ) => {
    setScenes((prev) => {
      const scene = prev[sceneIndex];
      if (!scene) return prev;
      const nextLines = update(getEditableDialogueLines(scene), scene);
      const copy = [...prev];
      copy[sceneIndex] = syncDialogueLines(scene, nextLines);
      return copy;
    });
  };

  const handleUpdateDialogueLine = (
    sceneIndex: number,
    lineId: string,
    updated: Partial<DialogueLine>
  ) => {
    updateSceneDialogueLines(sceneIndex, (lines) => lines.map((line) =>
      line.line_id === lineId ? { ...line, ...updated } : line
    ));
  };

  const handleAddDialogueLine = (sceneIndex: number) => {
    const scene = scenes[sceneIndex];
    if (!scene) return;
    const lines = getEditableDialogueLines(scene);
    if (lines.length >= 3) {
      setValidationError("Each scene can contain up to three speaker lines.");
      return;
    }
    const usedIds = new Set(lines.map((line) => line.line_id));
    let nextNumber = lines.length + 1;
    let lineId = `scene-${scene.scene_number}-line-${nextNumber}`;
    while (usedIds.has(lineId)) {
      nextNumber += 1;
      lineId = `scene-${scene.scene_number}-line-${nextNumber}`;
    }
    const defaultCharacter = scene.character_focus[0] || characters[0]?.id || "CHARACTER_A";
    updateSceneDialogueLines(sceneIndex, (currentLines) => [
      ...currentLines,
      { line_id: lineId, character_id: defaultCharacter, text: "", order: currentLines.length + 1 },
    ]);
  };

  const handleRemoveDialogueLine = (sceneIndex: number, lineId: string) => {
    const scene = scenes[sceneIndex];
    if (!scene) return;
    updateSceneDialogueLines(sceneIndex, (currentLines) => currentLines.filter((line) => line.line_id !== lineId));
  };

  const handleDeleteCharacter = (index: number) => {
    if (characters.length <= 1) return;
    const removedId = characters[index].id;
    const remainingCharacters = characters.filter((_, characterIndex) => characterIndex !== index);
    const fallbackCharacter = remainingCharacters[0]?.id || "";
    setCharacters((prev) => prev.filter((_, i) => i !== index));
    setScenes((prev) => prev.map((scene) => {
      const nextFocus = scene.character_focus.filter((id) => id !== removedId);
      const repairedFocus = nextFocus.length > 0 ? nextFocus : (fallbackCharacter ? [fallbackCharacter] : []);
      const lines = getEditableDialogueLines(scene).map((line) =>
        line.character_id === removedId && fallbackCharacter
          ? { ...line, character_id: fallbackCharacter }
          : line
      );
      return syncDialogueLines(
        { ...scene, character_focus: repairedFocus },
        lines.filter((line) => repairedFocus.includes(line.character_id))
      );
    }));
  };

  // Scene modifications
  const handleUpdateScene = (index: number, updated: Partial<DramaScene>) => {
    setScenes((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], ...updated };
      return copy;
    });
  };

  const handleToggleSceneFocus = (sceneIndex: number, charId: string) => {
    setScenes((prev) => {
      const copy = [...prev];
      const scene = copy[sceneIndex];
      if (!scene) return prev;
      const hasFocus = scene.character_focus.includes(charId);
      const nextFocus = hasFocus
        ? scene.character_focus.filter((id) => id !== charId)
        : [...scene.character_focus, charId];
      if (hasFocus && nextFocus.length === 0) return prev;
      const fallbackCharacter = nextFocus[0] || charId;
      const lines = getEditableDialogueLines(scene).map((line) =>
        hasFocus && line.character_id === charId
          ? { ...line, character_id: fallbackCharacter }
          : line
      );
      copy[sceneIndex] = syncDialogueLines(
        { ...scene, character_focus: nextFocus },
        lines
      );
      return copy;
    });
  };

  const handleAddScene = () => {
    if (scenes.length >= 6) {
      setValidationError("A vertical drama script cannot exceed 6 scenes.");
      return;
    }
    const nextNumber = scenes.length + 1;
    const defaultFocus = characters.length > 0 ? [characters[0].id] : ["CHARACTER_A"];
    setScenes((prev) => [
      ...prev,
      {
        scene_number: nextNumber,
        character_focus: defaultFocus,
        visual_prompt: "",
        camera_movement: "Slow cinematic zoom-in on face",
        dialogue: "",
        dialogue_lines: [],
        duration_seconds: 4,
      },
    ]);
  };

  const handleDeleteScene = (index: number) => {
    if (scenes.length <= 3) {
      setValidationError("A vertical drama script requires a minimum of 3 scenes.");
      return;
    }
    setScenes((prev) => {
      const filtered = prev.filter((_, i) => i !== index);
      return filtered.map((s, idx) => ({ ...s, scene_number: idx + 1 }));
    });
  };

  const handleSetupRegenerate = async () => {
    setValidationError(null);
    if (isGateActionRunning || isSaving || !onRegenerateSetup) return;
    try {
      await onRegenerateSetup();
    } catch (err: any) {
      setValidationError(err?.message || "The setup could not be regenerated. Your current review remains saved.");
    }
  };

  const handleSetupConfirm = async () => {
    setValidationError(null);
    if (isGateActionRunning || isSaving) return;
    const proposedTitle = initialTitle.trim();
    const proposedSynopsis = synopsis.trim();
    if (!proposedTitle) {
      setValidationError("The generated title is missing. Return to the pitch and regenerate the setup.");
      return;
    }
    if (proposedSynopsis.length < 80) {
      setValidationError("The generated synopsis is too short to guide a screenplay. Regenerate the setup and try again.");
      return;
    }
    if (!onConfirmSetup) {
      setValidationError("Screenplay generation is unavailable for this project. Return to the pitch and try again.");
      return;
    }

    try {
      await onConfirmSetup(proposedTitle, proposedSynopsis);
    } catch (err: any) {
      setValidationError(err?.message || "The screenplay could not be generated. Your setup remains saved.");
    }
  };

  const handleScriptRegenerate = async () => {
    setValidationError(null);
    if (isGateActionRunning || isSaving || !onRegenerateScript) return;
    try {
      await onRegenerateScript();
    } catch (err: any) {
      setValidationError(err?.message || "The screenplay could not be regenerated. Your current review remains saved.");
    }
  };

  const handleApproveProduction = async () => {
    setValidationError(null);
    if (isGateActionRunning || isSaving) return;
    if (!initialManifest || !onApproveProduction) {
      setValidationError("Approve a complete screenplay before starting visual production.");
      return;
    }

    const validation = validateManifest(currentManifest, expectedSceneCount || scenes.length);
    if (!validation.valid || !validation.manifest) {
      setValidationError(validation.error || "Review the screenplay fields before approving production.");
      return;
    }

    try {
      await onApproveProduction(validation.manifest, title.trim());
      setSaveSuccessNotice(true);
      setTimeout(() => setSaveSuccessNotice(false), 3000);
    } catch (err: any) {
      setValidationError(err?.message || "Approval could not be saved. Your screenplay remains available to review.");
    }
  };

  if (isSetupReview) {
    const setupBusy = isGateActionRunning || isSaving;
    const setupStatusMessage = generationError || validationError;

    return (
      <div className="flex h-full flex-col overflow-y-auto bg-[#0d1017] text-[#e2e8f0]">
        <header className="border-b border-[#1e2638] bg-[#111520]/95 px-4 py-4 backdrop-blur-md sm:px-6">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-3">
              <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-2.5 text-amber-400 shadow-inner shadow-amber-500/5">
                <Film className="h-5 w-5" />
              </div>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber-300/80">Frame Studio / checkpoint 02</p>
                <h1 className="mt-1 text-xl font-serif font-bold tracking-tight text-white sm:text-2xl">Review the story foundation</h1>
                <p className="mt-1 max-w-2xl text-xs leading-relaxed text-gray-400 sm:text-sm">
                  The studio has shaped your raw idea into a title and synopsis. Read the proposal, then decide when the screenplay should be written.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 self-start lg:self-auto">
              <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider text-amber-200">Setup review</span>
              <span className="rounded-md border border-[#2a354b] bg-[#171f30] px-2.5 py-1.5 text-[10px] font-mono uppercase tracking-wider text-gray-400">Seed #{seed}</span>
            </div>
          </div>
        </header>

        <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-5 px-4 py-5 sm:px-6 sm:py-7">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            {[
              ["01", "Pitch", "Complete"],
              ["02", "Setup review", "Your decision"],
              ["03", "Screenplay", "After confirmation"],
              ["04", "Visual production", "After approval"],
            ].map(([number, label, status], index) => (
              <div
                key={number}
                className={`rounded-xl border p-3 ${
                  index === 1
                    ? "border-amber-500/40 bg-amber-950/25"
                    : index === 0
                      ? "border-emerald-700/40 bg-emerald-950/15"
                      : "border-[#222d42] bg-[#111722]"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[10px] tracking-wider text-gray-500">{number}</span>
                  {index === 0 ? <CircleCheck className="h-3.5 w-3.5 text-emerald-400" /> : index === 1 ? <Clock className="h-3.5 w-3.5 text-amber-400" /> : <Lock className="h-3.5 w-3.5 text-gray-600" />}
                </div>
                <p className={`mt-2 text-xs font-semibold ${index === 1 ? "text-amber-200" : index === 0 ? "text-emerald-200" : "text-gray-500"}`}>{label}</p>
                <p className="mt-1 text-[11px] text-gray-500">{status}</p>
              </div>
            ))}
          </div>

          <section className="overflow-hidden rounded-2xl border border-[#2a354b] bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,0.12),transparent_42%),#121926] shadow-2xl shadow-black/20">
            <div className="border-b border-[#202b40] px-5 py-5 sm:px-7">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="max-w-2xl">
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-400">Proposed setup</p>
                  <h2 className="mt-2 text-2xl font-serif font-bold tracking-tight text-white sm:text-3xl">Give the screenplay a direction worth following.</h2>
                  <p className="mt-2 text-sm leading-relaxed text-gray-300">
                    This checkpoint controls what the next model pass will build. A clear synopsis gives every scene, character, and visual prompt a shared dramatic spine.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:min-w-[260px]">
                  <div className="rounded-lg border border-[#2b3850] bg-[#0e131d]/80 p-3">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-gray-500">Format</p>
                    <p className="mt-1 text-xs font-semibold text-gray-200">{orientationLabelText}</p>
                  </div>
                  <div className="rounded-lg border border-[#2b3850] bg-[#0e131d]/80 p-3">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-gray-500">Timeline</p>
                    <p className="mt-1 text-xs font-semibold text-gray-200">{expectedSceneCount || 4} scenes</p>
                  </div>
                  <div className="col-span-2 rounded-lg border border-[#2b3850] bg-[#0e131d]/80 p-3">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-gray-500">Art direction</p>
                    <p className="mt-1 break-words text-xs leading-relaxed text-gray-300">{artStyle || "Cinematic drama"}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-5 px-5 py-5 sm:px-7 sm:py-7">
              <div className="rounded-xl border border-[#303e57] bg-[#0d121c] p-4 shadow-inner shadow-black/10">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-300">Proposed movie title</p>
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-700/40 bg-emerald-950/30 px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-emerald-300">
                    <CircleCheck className="h-3 w-3" /> Generated for review
                  </span>
                </div>
                <p className="mt-3 break-words text-2xl font-serif font-bold leading-tight text-white sm:text-3xl">
                  {initialTitle.trim() || "The studio could not name this story yet."}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-gray-500">The title is generated from your raw idea and saved with this checkpoint.</p>
              </div>

              <div className="rounded-xl border border-[#303e57] bg-[#0d121c] p-4 shadow-inner shadow-black/10">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-300">Story synopsis</p>
                  <span className="font-normal text-[10px] font-mono uppercase tracking-wider text-gray-500">{synopsis.trim().length} characters</span>
                </div>
                <p className="mt-3 whitespace-pre-line break-words text-sm leading-7 text-gray-200">
                  {synopsis.trim() || "The studio did not return a synopsis for this checkpoint."}
                </p>
                <div className="mt-4 flex items-start gap-2 border-t border-[#202b40] pt-3 text-[11px] leading-relaxed text-gray-500">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400/80" />
                  <p>This proposal is read-only. Regenerate it for a different direction, or confirm it to have the studio write the screenplay.</p>
                </div>
              </div>
            </div>
          </section>

          {setupStatusMessage && (
            <div className="flex items-start gap-3 rounded-xl border border-red-800/50 bg-red-950/30 p-4 text-sm text-red-200" role="alert">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              <div>
                <p className="font-semibold text-red-300">The checkpoint needs attention</p>
                <p className="mt-1 text-xs leading-relaxed text-red-200/85">{setupStatusMessage}</p>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-3 rounded-2xl border border-[#222d42] bg-[#111722] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <div className="flex items-start gap-3">
              <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-2 text-amber-300">
                <Layers className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">Your story stays here until you choose the next pass.</p>
                <p className="mt-1 max-w-xl text-xs leading-relaxed text-gray-400">Saving keeps this setup private. Confirming it writes the screenplay review, but it will not generate frames or motion.</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={onBackToPitch}
                disabled={setupBusy}
                className="h-10 gap-2 text-gray-300 hover:bg-[#1a2232] hover:text-white"
              >
                <span aria-hidden="true">←</span> Back to pitch
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleSetupRegenerate()}
                disabled={setupBusy || !onRegenerateSetup}
                className="h-10 gap-2 border-[#35425d] bg-[#171f30] text-gray-200 hover:border-amber-500/50 hover:bg-[#1d283d] hover:text-white disabled:opacity-50"
              >
                {setupBusy && !isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 text-amber-400" />}
                Regenerate setup
              </Button>
              <Button
                type="button"
                onClick={() => void handleSetupConfirm()}
                disabled={setupBusy}
                className="h-10 gap-2 bg-amber-500 px-4 font-semibold text-black shadow-lg shadow-amber-500/10 hover:bg-amber-600 disabled:opacity-50"
              >
                {setupBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {setupBusy ? "Preparing screenplay..." : "Confirm & Generate Script"}
              </Button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (manifestNeedsRecovery) {
    const recoveryBusy = isGateActionRunning || isSaving;
    const canRebuildScreenplay = Boolean(onRegenerateScript && synopsis.trim());
    const canRebuildSetup = Boolean(onRegenerateSetup);
    const recoveryAction = canRebuildScreenplay ? "screenplay" : canRebuildSetup ? "setup" : null;
    const recoveryStatus = productionApproved
      ? "Approval saved, screenplay needs recovery"
      : initialManifest
        ? "Saved screenplay needs recovery"
        : "Screenplay checkpoint missing";
    const recoveryReason = persistedManifestValidation.error || "The saved screenplay has no usable scenes yet.";

    return (
      <div className="flex h-full flex-col overflow-y-auto bg-[#0d1017] text-[#e2e8f0]">
        <header className="border-b border-[#1e2638] bg-[#111520]/95 px-4 py-5 backdrop-blur-md sm:px-6">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div className="shrink-0 rounded-xl border border-red-500/30 bg-red-500/10 p-2.5 text-red-300 shadow-inner shadow-red-500/5">
                <AlertCircle className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber-300/80">Frame Studio / saved story recovery</p>
                <h1 className="mt-1 break-words text-xl font-serif font-bold tracking-tight text-white sm:text-2xl">Restore this story before production continues</h1>
                <p className="mt-1 max-w-3xl text-xs leading-relaxed text-gray-400 sm:text-sm">
                  The saved library entry is still safe. One screenplay checkpoint is incomplete, so the studio is pausing the movie stages instead of opening a blank workspace.
                </p>
              </div>
            </div>
            <span className="shrink-0 self-start rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider text-red-200">Recovery needed</span>
          </div>
        </header>

        <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 px-4 py-5 sm:px-6 sm:py-8">
          <section className="rounded-2xl border border-[#2a354b] bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,0.12),transparent_42%),#121926] p-5 shadow-2xl shadow-black/20 sm:p-7">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-400">Saved story</p>
                <h2 className="mt-2 break-words text-2xl font-serif font-bold tracking-tight text-white sm:text-3xl">{safeInitialTitle}</h2>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-gray-300">
                  {productionApproved
                    ? "Your screenplay approval is still recorded. Recover the screenplay checkpoint before opening Frames, Motion, Preview, or Sound."
                    : "The studio needs a complete screenplay checkpoint before it can show scenes or open production stages."}
                </p>
              </div>
              <div className="grid shrink-0 gap-2 sm:grid-cols-2 lg:w-[290px] lg:grid-cols-1">
                <div className="rounded-xl border border-[#2b3850] bg-[#0e131d]/80 p-3">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-gray-500">Current checkpoint</p>
                  <p className="mt-1 text-sm font-semibold text-amber-200">{recoveryStatus}</p>
                </div>
                <div className="rounded-xl border border-[#2b3850] bg-[#0e131d]/80 p-3">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-gray-500">Saved premise</p>
                  <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-gray-300">{synopsis.trim() || "The original synopsis is not available at this checkpoint."}</p>
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-red-500/25 bg-[linear-gradient(145deg,rgba(127,29,29,0.16),rgba(17,24,36,0.96))] p-5 sm:p-7" aria-labelledby="recovery-problem-title">
            <div className="flex items-start gap-3">
              <div className="shrink-0 rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-red-300">
                <Lock className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <h2 id="recovery-problem-title" className="text-lg font-semibold text-white">The movie stages are paused</h2>
                <p className="mt-1 text-sm leading-relaxed text-gray-300">
                  {productionApproved
                    ? "The approval flag stays untouched, but the saved screenplay cannot be trusted until it is rebuilt. No visual or audio job will start from this screen."
                    : "The saved story can return to the composer or rebuild its next checkpoint. No visual or audio job will start until a valid screenplay is saved."}
                </p>
              </div>
            </div>

            <div className="mt-5 rounded-xl border border-red-500/25 bg-[#0d121c]/80 p-4">
              <p className="font-mono text-[10px] uppercase tracking-wider text-red-300/80">What needs attention</p>
              <p className="mt-2 break-words text-sm leading-relaxed text-red-100">{recoveryReason}</p>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-[#2b3850] bg-[#101622]/80 p-4">
                <p className="font-mono text-[10px] text-gray-500">01 / Choose a recovery action</p>
                <p className="mt-2 text-xs leading-relaxed text-gray-300">Rebuild the screenplay when a synopsis is saved, or return to the story setup when the foundation is missing.</p>
              </div>
              <div className="rounded-xl border border-[#2b3850] bg-[#101622]/80 p-4">
                <p className="font-mono text-[10px] text-gray-500">02 / Review the new checkpoint</p>
                <p className="mt-2 text-xs leading-relaxed text-gray-300">The studio will stop again for your review. It will not replace this story without your action.</p>
              </div>
              <div className="rounded-xl border border-[#2b3850] bg-[#101622]/80 p-4">
                <p className="font-mono text-[10px] text-gray-500">03 / Continue the movie</p>
                <p className="mt-2 text-xs leading-relaxed text-gray-300">Once the screenplay validates, its scenes and the approved production stages will become visible again.</p>
              </div>
            </div>
          </section>

          {(generationError || validationError) && (
            <div className="flex items-start gap-3 rounded-xl border border-red-800/50 bg-red-950/30 p-4 text-sm text-red-200" role="alert">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              <div>
                <p className="font-semibold text-red-300">The last recovery attempt needs attention</p>
                <p className="mt-1 break-words text-xs leading-relaxed text-red-200/85">{generationError || validationError}</p>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-3 rounded-2xl border border-[#222d42] bg-[#111722] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <div className="flex items-start gap-3">
              <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-2 text-amber-300">
                <Info className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">Your saved story stays in the library.</p>
                <p className="mt-1 max-w-xl text-xs leading-relaxed text-gray-400">Choose one action. The recovery pass starts only after you click, and you can review the result before production resumes.</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {onBackToPitch && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={onBackToPitch}
                  disabled={recoveryBusy}
                  className="h-10 gap-2 text-gray-300 hover:bg-[#1a2232] hover:text-white"
                >
                  <span aria-hidden="true">←</span> Return to composer
                </Button>
              )}
              {recoveryAction && (
                <Button
                  type="button"
                  onClick={() => {
                    if (canRebuildScreenplay) {
                      void handleScriptRegenerate();
                    } else {
                      void handleSetupRegenerate();
                    }
                  }}
                  disabled={recoveryBusy}
                  className="h-10 gap-2 bg-amber-500 px-4 font-semibold text-black shadow-lg shadow-amber-500/10 hover:bg-amber-600 disabled:opacity-50"
                >
                  {recoveryBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  {recoveryBusy ? "Rebuilding checkpoint..." : recoveryAction === "screenplay" ? "Rebuild screenplay" : "Rebuild story setup"}
                </Button>
              )}
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (isScriptReviewGate) {
    const scriptBusy = isGateActionRunning || isSaving;
    const scriptStatusMessage = generationError || validationError;
    const reviewTitle = initialTitle.trim() || title.trim() || "Untitled story";
    const reviewSynopsis = synopsis.trim();

    return (
      <div className="flex h-full flex-col overflow-y-auto bg-[#0d1017] text-[#e2e8f0]">
        <header className="border-b border-[#1e2638] bg-[#111520]/95 px-4 py-4 backdrop-blur-md sm:px-6">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-3">
              <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-2.5 text-amber-400 shadow-inner shadow-amber-500/5">
                <Film className="h-5 w-5" />
              </div>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber-300/80">Frame Studio / checkpoint 03</p>
                <h1 className="mt-1 text-xl font-serif font-bold tracking-tight text-white sm:text-2xl">Review the generated screenplay</h1>
                <p className="mt-1 max-w-3xl text-xs leading-relaxed text-gray-400 sm:text-sm">
                  The studio has written the cast, scenes, dialogue, and shot direction from your confirmed synopsis. Read this pass before production stages become available.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 self-start lg:self-auto">
              <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider text-amber-200">Script review</span>
              <span className="rounded-md border border-[#2a354b] bg-[#171f30] px-2.5 py-1.5 text-[10px] font-mono uppercase tracking-wider text-gray-400">Awaiting approval</span>
            </div>
          </div>
        </header>

        <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-5 px-4 py-5 sm:px-6 sm:py-7">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            {[
              ["01", "Pitch", "Complete"],
              ["02", "Setup", "Confirmed"],
              ["03", "Screenplay", "Your decision"],
              ["04", "Production", "After approval"],
            ].map(([number, label, status], index) => (
              <div
                key={number}
                className={`rounded-xl border p-3 ${
                  index === 2
                    ? "border-amber-500/40 bg-amber-950/25"
                    : index < 2
                      ? "border-emerald-700/40 bg-emerald-950/15"
                      : "border-[#222d42] bg-[#111722]"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[10px] tracking-wider text-gray-500">{number}</span>
                  {index < 2 ? <CircleCheck className="h-3.5 w-3.5 text-emerald-400" /> : index === 2 ? <Clock className="h-3.5 w-3.5 text-amber-400" /> : <Lock className="h-3.5 w-3.5 text-gray-600" />}
                </div>
                <p className={`mt-2 text-xs font-semibold ${index === 2 ? "text-amber-200" : index < 2 ? "text-emerald-200" : "text-gray-500"}`}>{label}</p>
                <p className="mt-1 text-[11px] text-gray-500">{status}</p>
              </div>
            ))}
          </div>

          <section className="overflow-hidden rounded-2xl border border-[#2a354b] bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,0.12),transparent_42%),#121926] shadow-2xl shadow-black/20">
            <div className="border-b border-[#202b40] px-5 py-5 sm:px-7">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 max-w-3xl">
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-400">Generated story plan</p>
                  <h2 className="mt-2 break-words text-2xl font-serif font-bold tracking-tight text-white sm:text-3xl">{reviewTitle}</h2>
                  <p className="mt-3 text-sm leading-relaxed text-gray-300">
                    This screenplay is a complete generated pass. Use the review below to judge the story direction, character continuity, and shot plan as one piece.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:min-w-[280px]">
                  <div className="rounded-lg border border-[#2b3850] bg-[#0e131d]/80 p-3">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-gray-500">Format</p>
                    <p className="mt-1 text-xs font-semibold text-gray-200">{orientationLabelText}</p>
                  </div>
                  <div className="rounded-lg border border-[#2b3850] bg-[#0e131d]/80 p-3">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-gray-500">Timeline</p>
                    <p className="mt-1 text-xs font-semibold text-gray-200">{scenes.length || expectedSceneCount || 0} scenes · ~{totalRuntimeSeconds}s</p>
                  </div>
                  <div className="col-span-2 rounded-lg border border-[#2b3850] bg-[#0e131d]/80 p-3">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-gray-500">Art direction</p>
                    <p className="mt-1 break-words text-xs leading-relaxed text-gray-300">{globalStyle.trim() || artStyle || "Generated cinematic direction"}</p>
                  </div>
                </div>
              </div>
            </div>
            <div className="px-5 py-5 sm:px-7 sm:py-6">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-300">Story synopsis</p>
                <span className="font-mono text-[10px] uppercase tracking-wider text-gray-500">{reviewSynopsis.length} characters</span>
              </div>
              <p className="mt-3 whitespace-pre-line break-words text-sm leading-7 text-gray-200">
                {reviewSynopsis || "The saved setup did not include a synopsis for this screenplay."}
              </p>
            </div>
          </section>

          {scriptStatusMessage && (
            <div className="flex items-start gap-3 rounded-xl border border-red-800/50 bg-red-950/30 p-4 text-sm text-red-200" role="alert">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              <div>
                <p className="font-semibold text-red-300">The review needs attention</p>
                <p className="mt-1 text-xs leading-relaxed text-red-200/85">{scriptStatusMessage}</p>
                <p className="mt-2 text-[11px] leading-relaxed text-red-200/70">Your saved screenplay remains visible below. Regenerate only when you want a new generated pass.</p>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-3 rounded-2xl border border-[#222d42] bg-[#111722] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <div className="flex items-start gap-3">
              <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-2 text-amber-300">
                <Layers className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">Everything here was generated for you.</p>
                <p className="mt-1 max-w-xl text-xs leading-relaxed text-gray-400">Go back to change the raw pitch, regenerate this screenplay for a fresh direction, or approve it to start visual production. Approval saves the screenplay, generates character references first, then creates scene storyboards and saves each image privately. Motion and sound remain separate review stages.</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => onBackToPitch?.()}
                disabled={scriptBusy}
                className="h-10 gap-2 text-gray-300 hover:bg-[#1a2232] hover:text-white"
              >
                <span aria-hidden="true">←</span> Back to pitch
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleScriptRegenerate()}
                disabled={scriptBusy || !onRegenerateScript}
                className="h-10 gap-2 border-[#35425d] bg-[#171f30] text-gray-200 hover:border-amber-500/50 hover:bg-[#1d283d] hover:text-white disabled:opacity-50"
              >
                {scriptBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 text-amber-400" />}
                {scriptBusy ? "Regenerating script..." : "Regenerate script"}
              </Button>
              <Button
                type="button"
                onClick={() => void handleApproveProduction()}
                disabled={scriptBusy || !onApproveProduction}
                className="h-10 gap-2 bg-amber-500 px-4 font-semibold text-black shadow-lg shadow-amber-500/10 hover:bg-amber-600 disabled:opacity-50"
              >
                {scriptBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CircleCheck className="h-3.5 w-3.5" />}
                {isStartingVisualProduction ? "Starting visual production..." : scriptBusy ? "Saving approval..." : "Approve & Start Visual Production"}
              </Button>
            </div>
          </div>

          <section className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-400">Generated screenplay</p>
                <h2 className="mt-1 text-2xl font-serif font-bold text-white">Scenes, dialogue, and shot direction</h2>
                <p className="mt-1 max-w-3xl text-sm leading-relaxed text-gray-400">Each card is the exact material that will guide later frame, motion, and sound stages.</p>
              </div>
              <span className="rounded-md border border-[#2a354b] bg-[#171f30] px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider text-gray-400">{scenes.length} generated scenes</span>
            </div>

            <div className="space-y-4">
              {scenes.map((scene, sceneIndex) => {
                const dialogueLines = deriveDialogueLines(scene);
                const cast = scene.character_focus.length > 0 ? scene.character_focus : ["No cast assigned"];
                return (
                  <article key={`${scene.scene_number}-${sceneIndex}`} className="overflow-hidden rounded-2xl border border-[#273248] bg-[#111824] shadow-lg shadow-black/10">
                    <div className="border-b border-[#202b40] bg-[#171f30] px-4 py-4 sm:px-5">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div className="flex flex-wrap items-center gap-2.5">
                          <span className="rounded-md border border-amber-500/35 bg-amber-500/15 px-2.5 py-1 font-mono text-xs font-bold uppercase tracking-wider text-amber-200">Scene {String(scene.scene_number).padStart(2, "0")}</span>
                          <span className="inline-flex items-center gap-1.5 rounded-md border border-[#33415d] bg-[#101622] px-2.5 py-1 text-xs text-gray-300">
                            <Clock className="h-3.5 w-3.5 text-amber-400" /> {scene.duration_seconds}s
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="mr-1 text-[10px] font-mono uppercase tracking-wider text-gray-500">Cast</span>
                          {cast.map((characterId) => (
                            <span key={characterId} className="rounded-md border border-[#33415d] bg-[#101622] px-2 py-1 font-mono text-[10px] text-gray-300">{characterId}</span>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-4 p-4 sm:p-5 md:grid-cols-2">
                      <div className="rounded-xl border border-[#263149] bg-[#0d131e] p-4 md:col-span-2">
                        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-300">
                          <Eye className="h-3.5 w-3.5 text-amber-400" /> Visual setting and action
                        </div>
                        <p className="mt-2 whitespace-pre-line break-words text-sm leading-6 text-gray-200">{scene.visual_prompt || "No visual action direction was saved for this scene."}</p>
                      </div>

                      <div className="rounded-xl border border-[#263149] bg-[#0d131e] p-4">
                        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-300">
                          <Camera className="h-3.5 w-3.5 text-amber-400" /> Camera direction
                        </div>
                        <p className="mt-2 whitespace-pre-line break-words text-sm leading-6 text-gray-200">{scene.camera_movement || "No camera direction was saved for this scene."}</p>
                        <p className="mt-3 text-[10px] font-mono uppercase tracking-wider text-gray-600">{orientationLabelText}</p>
                      </div>

                      <div className="rounded-xl border border-[#263149] bg-[#0d131e] p-4">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-300">
                            <MessageSquare className="h-3.5 w-3.5 text-amber-400" /> Dialogue
                          </div>
                          <span className="font-mono text-[10px] uppercase tracking-wider text-gray-500">{dialogueLines.length} {dialogueLines.length === 1 ? "line" : "lines"}</span>
                        </div>
                        {dialogueLines.length > 0 ? (
                          <div className="mt-3 space-y-2.5">
                            {dialogueLines.map((line, lineIndex) => (
                              <div key={`${line.line_id}-${lineIndex}`} className="rounded-lg border border-[#33415d] bg-[#101622] p-3">
                                <div className="flex items-center gap-2">
                                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-amber-500/30 bg-amber-500/10 font-mono text-[10px] text-amber-300">{String(lineIndex + 1).padStart(2, "0")}</span>
                                  <span className="font-mono text-[10px] uppercase tracking-wider text-amber-200">{line.character_id}</span>
                                </div>
                                <p className="mt-2 whitespace-pre-line break-words font-serif text-sm italic leading-relaxed text-gray-200">“{line.text}”</p>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-3 rounded-lg border border-dashed border-[#33415d] px-3 py-3 text-xs leading-relaxed text-gray-500">Silent scene. No spoken lines were generated here.</p>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-400">Generated cast</p>
                <h2 className="mt-1 text-2xl font-serif font-bold text-white">Character visual profiles</h2>
                <p className="mt-1 max-w-3xl text-sm leading-relaxed text-gray-400">These profiles anchor identity across future reference frames and scene prompts.</p>
              </div>
              <span className="rounded-md border border-[#2a354b] bg-[#171f30] px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider text-gray-400">{characters.length} generated characters</span>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {characters.map((character, characterIndex) => {
                const appearances = scenes.filter((scene) => scene.character_focus.includes(character.id));
                return (
                  <article key={`${character.id}-${characterIndex}`} className="rounded-2xl border border-[#273248] bg-[#111824] p-4 shadow-lg shadow-black/10 sm:p-5">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#202b40] pb-3">
                      <span className="rounded-md border border-amber-500/35 bg-amber-500/15 px-2.5 py-1 font-mono text-xs font-bold uppercase tracking-wider text-amber-200">{character.id}</span>
                      <span className="text-xs text-gray-500">Appears in {appearances.length} {appearances.length === 1 ? "scene" : "scenes"}</span>
                    </div>
                    <div className="mt-4">
                      <p className="text-xs font-semibold uppercase tracking-wider text-gray-300">Detailed visual profile</p>
                      <p className="mt-2 whitespace-pre-line break-words text-sm leading-6 text-gray-200">{character.detailed_visual_profile || "No visual profile was saved for this character."}</p>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-[#202b40] pt-3">
                      <span className="mr-1 text-[10px] font-mono uppercase tracking-wider text-gray-600">Scenes</span>
                      {appearances.length > 0 ? appearances.map((scene) => (
                        <span key={scene.scene_number} className="rounded-md border border-[#33415d] bg-[#101622] px-2 py-1 font-mono text-[10px] text-gray-300">{scene.scene_number}</span>
                      )) : <span className="text-[11px] italic text-gray-500">No scene appearance was saved.</span>}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <div className="flex items-start gap-3 rounded-xl border border-amber-800/30 bg-amber-950/20 p-4 text-xs text-amber-100/80">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <p className="leading-relaxed">Approve only when the generated story plan feels ready. The next phase keeps the existing Frames, Video and Motion, Silent Preview, and Sound Test stages behind this saved approval.</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div
      className="flex min-w-0 min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto bg-[#0d1017] text-[#e2e8f0]"
      tabIndex={0}
      role="region"
      aria-label="Approved story workspace"
    >
      {/* Top Action Header */}
      <div className="shrink-0 border-b border-[#1e2638] bg-[#111520]/90 backdrop-blur-md px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-3 sticky top-0 z-20">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 shrink-0">
            <Film className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Script Project Title"
              className="bg-transparent border-none focus-visible:ring-1 focus-visible:ring-amber-500/50 text-base sm:text-lg font-serif font-bold text-white px-1.5 h-8 w-full max-w-md placeholder:text-gray-500"
            />
            <div className="flex flex-wrap items-center gap-2 mt-0.5 text-xs text-gray-400">
              <span className="flex items-center gap-1 font-mono text-[11px] text-amber-300/80 bg-amber-950/40 border border-amber-800/30 px-1.5 py-0.5 rounded">
                <Lock className="w-2.5 h-2.5" /> Seed #{seed}
              </span>
              <span>•</span>
              <span>{scenes.length} Scenes</span>
              <span>•</span>
              <span>~{totalRuntimeSeconds}s Total Runtime</span>
              <span>•</span>
              <span>{orientationLabelText}</span>
            </div>
          </div>
        </div>

        {/* Right action controls */}
        <div className="flex max-w-full flex-wrap items-center gap-2 shrink-0">
          {isDirty ? (
            <span className="hidden sm:flex items-center gap-1 text-xs text-amber-400 bg-amber-950/40 border border-amber-800/40 px-2 py-1 rounded-md">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" /> Unsaved changes
            </span>
          ) : saveSuccessNotice ? (
            <span className="hidden sm:flex items-center gap-1 text-xs text-emerald-400 bg-emerald-950/40 border border-emerald-800/40 px-2 py-1 rounded-md">
              <Check className="w-3 h-3" /> Saved to library
            </span>
          ) : (
            <span className="hidden sm:flex items-center gap-1 text-xs text-gray-400 bg-[#161d2d] px-2 py-1 rounded-md">
              <Check className="w-3 h-3 text-emerald-400" /> Up to date
            </span>
          )}

          {productionUnlocked && (
            <Button
              type="button"
              onClick={() => void handleFrameAction()}
              variant="outline"
              size="sm"
              className={`h-9 gap-1.5 border-amber-500/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20 hover:text-amber-100 ${
                activeTab === "frames" ? "ring-1 ring-amber-400/50" : ""
              }`}
              title={frameActionDescription}
              aria-label={`${frameActionLabel}. ${frameActionDescription}`}
            >
              {isGeneratingFrames ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : allFramesReady ? (
                <CircleCheck className="w-3.5 h-3.5" />
              ) : (
                <ImageIcon className="w-3.5 h-3.5" />
              )}
              <span>{frameActionLabel}</span>
            </Button>
          )}

          <Button
            onClick={handleExportJson}
            variant="outline"
            size="sm"
            className="border-[#273248] bg-[#161d2d] hover:bg-[#1f293d] text-gray-200 hover:text-white h-9 gap-1.5"
            title="Download manifest.json formatted schema"
          >
            <Download className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden sm:inline">Export</span> JSON
          </Button>

          <Button
            onClick={handleSave}
            disabled={isGateActionRunning || isSaving || isGeneratingFrames}
            size="sm"
            className="bg-amber-500 hover:bg-amber-600 text-black font-semibold h-9 gap-1.5 shadow-sm shadow-amber-500/10"
          >
            {isSaving ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-black border-t-transparent rounded-full animate-spin" />
                <span>Saving...</span>
              </>
            ) : (
              <>
                <Save className="w-3.5 h-3.5" />
                <span>{isScriptReviewGate ? "Save Screenplay" : "Save Script"}</span>
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Validation Error Alert */}
      {validationError && (
        <div className="mx-4 sm:mx-6 mt-4 p-3 rounded-lg bg-red-950/40 border border-red-800/40 flex items-center gap-2 text-sm text-red-300" role="alert">
          <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
          <span>{validationError}</span>
        </div>
      )}

      {isScriptReviewGate && (
        <section className="mx-4 mt-4 overflow-hidden rounded-2xl border border-amber-500/35 bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,0.14),transparent_42%),#151a26] shadow-lg shadow-black/10 sm:mx-6">
          <div className="flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-xl border border-amber-500/35 bg-amber-500/10 p-2.5 text-amber-300">
                <CircleCheck className="h-5 w-5" />
              </div>
              <div className="max-w-2xl">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-300">Checkpoint 03 / screenplay review</p>
                  <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-amber-200">Awaiting approval</span>
                </div>
                <h2 className="mt-1.5 text-xl font-serif font-bold text-white">Read the scenes and cast before production opens.</h2>
                <p className="mt-1.5 text-xs leading-relaxed text-amber-100/75 sm:text-sm">
                  Save any edits, regenerate the screenplay if the direction misses, or approve this pass. Approval starts Visual Production automatically. The studio generates character references first, then scene storyboards, saving each private image as it finishes. Motion and sound remain separate stages.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 lg:max-w-md">
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleSave()}
                disabled={isGateActionRunning || isSaving || isGeneratingFrames}
                className="h-9 gap-2 border-[#35425d] bg-[#171f30] text-gray-200 hover:border-amber-500/50 hover:bg-[#1d283d] hover:text-white disabled:opacity-50"
              >
                {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5 text-amber-400" />}
                {isSaving ? "Saving screenplay..." : "Save screenplay"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleScriptRegenerate()}
                disabled={isGateActionRunning || isSaving || !onRegenerateScript}
                className="h-9 gap-2 border-[#35425d] bg-[#171f30] text-gray-200 hover:border-amber-500/50 hover:bg-[#1d283d] hover:text-white disabled:opacity-50"
              >
                {isGateActionRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 text-amber-400" />}
                Regenerate script
              </Button>
              <Button
                type="button"
                onClick={() => void handleApproveProduction()}
                disabled={isGateActionRunning || isSaving || isGeneratingFrames}
                className="h-9 gap-2 bg-amber-500 px-3.5 font-semibold text-black shadow-md shadow-amber-500/10 hover:bg-amber-600 disabled:opacity-50"
              >
                {isGateActionRunning || isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {isStartingVisualProduction ? "Starting visual production..." : isGateActionRunning || isSaving ? "Saving approval..." : "Approve & Start Visual Production"}
              </Button>
            </div>
          </div>
          {generationError && (
            <div className="flex items-start gap-2 border-t border-red-800/40 bg-red-950/25 px-4 py-3 text-xs text-red-200 sm:px-5" role="alert">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
              <span>{generationError}</span>
            </div>
          )}
        </section>
      )}

      {productionUnlocked && (
        <section
          className={`mx-4 mt-4 min-w-0 overflow-hidden rounded-2xl border shadow-lg shadow-black/10 sm:mx-6 ${
            allFramesReady
              ? "border-emerald-500/30 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.14),transparent_42%),#111b1b]"
              : frameRunInProgress
                ? "border-amber-500/35 bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,0.16),transparent_44%),#151a26]"
                : "border-amber-500/35 bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,0.14),transparent_44%),#151a26]"
          }`}
          aria-live={frameRunInProgress ? "polite" : undefined}
        >
          <div className="grid gap-4 p-4 sm:p-5 md:grid-cols-[minmax(0,1fr)_minmax(205px,240px)] md:items-center">
            <div className="flex min-w-0 items-start gap-3">
              <div
                className={`mt-0.5 rounded-xl border p-2.5 ${
                  allFramesReady
                    ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-300"
                    : "border-amber-500/35 bg-amber-500/10 text-amber-300"
                }`}
              >
                {allFramesReady ? (
                  <CircleCheck className="h-5 w-5" />
                ) : frameRunInProgress ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <ImageIcon className="h-5 w-5" />
                )}
              </div>
              <div className="min-w-0 max-w-2xl">
                <div className="flex flex-wrap items-center gap-2">
                  <p className={`font-mono text-[10px] uppercase tracking-[0.2em] ${allFramesReady ? "text-emerald-300" : "text-amber-300"}`}>
                    Visual production
                  </p>
                  <span
                    className={`rounded-md border px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider ${
                      allFramesReady
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                        : frameRunInProgress
                          ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
                          : "border-amber-500/30 bg-amber-500/10 text-amber-200"
                    }`}
                  >
                    {allFramesReady ? "Ready for motion" : frameRunInProgress ? "In progress" : "Waiting to continue"}
                  </span>
                </div>
                <h2 className="mt-1.5 text-xl font-serif font-bold text-white sm:text-2xl">
                  {allFramesReady
                    ? "Your visual shelf is ready"
                    : frameRunInProgress
                      ? "Saving the visual reference shelf"
                      : "Continue visual production"}
                </h2>
                <p className="mt-1.5 text-xs leading-relaxed text-gray-300 sm:text-sm">
                  {allFramesReady
                    ? `All ${expectedFrameCount} visual assets are saved. Review Frames, then choose a scene in Video & Motion.`
                    : frameRunInProgress
                      ? "Character references and scene storyboards are being saved to this project. Keep this tab open while the current pass finishes."
                      : `This approved screenplay has ${savedFrameCount} of ${expectedFrameCount} visual assets. Continue from the last saved image. Completed assets stay safe, and only missing frames will run.`}
                </p>
                {frameRunInProgress && (
                  <div className="mt-3 max-w-xl space-y-2 rounded-xl border border-amber-500/20 bg-black/20 p-3">
                    <div className="flex items-center justify-between gap-3 text-[11px]">
                      <span className="font-semibold text-amber-100">
                        {frameProgress.stage === "characters"
                          ? "Character references"
                          : frameProgress.stage === "scenes"
                            ? "Scene storyboards"
                            : "Visual assets"}
                      </span>
                      <span className="shrink-0 font-mono text-amber-300">
                        {frameProgress.completed} / {frameProgress.total || expectedFrameCount}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-[#242b39]">
                      <div
                        className="h-full rounded-full bg-amber-400 transition-all duration-500"
                        style={{ width: `${frameProgressPercent}%` }}
                      />
                    </div>
                    <p className="text-[11px] leading-relaxed text-amber-100/75">
                      {frameProgress.current_label || "Preparing the next visual asset..."}
                    </p>
                  </div>
                )}
                {!frameRunInProgress && frameError && !allFramesReady && (
                  <p className="mt-3 flex items-start gap-2 text-[11px] leading-relaxed text-red-200/85" role="alert">
                    <CircleX className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
                    <span> The last visual pass stopped. Continue to retry only the missing assets.</span>
                  </p>
                )}
              </div>
            </div>

            <div className="flex w-full min-w-0 shrink-0 flex-col items-stretch gap-2 md:max-w-[240px]">
              {allFramesReady ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setActiveTab("video")}
                  className="h-auto min-h-10 w-full gap-2 !whitespace-normal px-3 py-2 leading-tight border-emerald-500/35 bg-emerald-500/10 text-emerald-100 hover:border-emerald-400/50 hover:bg-emerald-500/15 hover:text-white"
                >
                  <VideoIcon className="h-4 w-4 text-emerald-300" />
                  Open Video & Motion
                </Button>
              ) : frameRunInProgress ? (
                <div className="flex h-10 items-center justify-center gap-2 rounded-md border border-amber-500/25 bg-amber-500/10 px-3 text-xs font-semibold text-amber-200" role="status">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving visual assets...
                </div>
              ) : (
                <Button
                  type="button"
                  onClick={() => void handleFrameAction("missing")}
                  disabled={!canGenerateFrames || isSaving || isGeneratingFrames || isStartingVisualProduction || isDirty}
                  className="h-auto min-h-10 w-full gap-2 !whitespace-normal px-3 py-2 leading-tight bg-amber-500 font-semibold text-black shadow-md shadow-amber-500/15 hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
                  title={frameActionDescription}
                >
                  <ImageIcon className="h-4 w-4" />
                  Continue Visual Production
                </Button>
              )}
              {allFramesReady ? (
                <p className="text-center text-[11px] leading-relaxed text-emerald-100/65">The next stage is ready when you are.</p>
              ) : frameRunInProgress ? (
                <p className="text-center text-[11px] leading-relaxed text-amber-100/65">No second click is needed.</p>
              ) : !canGenerateFrames ? (
                <p className="text-center text-[11px] leading-relaxed text-amber-100/70">{frameActionDescription}.</p>
              ) : (
                <p className="text-center text-[11px] leading-relaxed text-amber-100/65">Only missing images will be requested.</p>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Production Roadmap */}
      <section
        className="mx-4 mt-5 min-w-0 overflow-hidden rounded-2xl border border-[#273248] bg-[#0f1420] shadow-lg shadow-black/10 sm:mx-6"
        aria-labelledby="production-roadmap-heading"
      >
        <div className="border-b border-[#202b40] px-4 py-5 sm:px-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Layers className="h-4 w-4 text-amber-400" aria-hidden="true" />
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-300">Production roadmap</p>
                <span className="rounded-md border border-[#33415d] bg-[#151d2c] px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-gray-400">
                  {productionUnlocked ? "Approved workspace" : "Approval required"}
                </span>
              </div>
              <h2 id="production-roadmap-heading" className="mt-2 text-xl font-serif font-bold tracking-tight text-white sm:text-2xl">
                See the next step at a glance.
              </h2>
              <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-gray-400 sm:text-sm">
                Each stage has one clear job. The highlighted card shows where your project needs attention now, while later shelves stay visible without competing for focus.
              </p>
            </div>
            <p className="shrink-0 rounded-md border border-[#273248] bg-[#111824] px-2.5 py-1.5 text-[10px] font-mono uppercase tracking-wider text-gray-500">
              {productionUnlocked ? "One stage at a time" : "Start with screenplay review"}
            </p>
          </div>
        </div>

        <div className="grid min-w-0 grid-cols-1 gap-3 p-3 sm:p-4 md:grid-cols-2 xl:grid-cols-3">
          <ProductionStageCard
            number="01"
            title="Script & cast"
            status={productionUnlocked ? "Approved" : "Review required"}
            description={productionUnlocked
              ? "The screenplay and cast are saved. Reopen them whenever you need to make an edit."
              : "Review the generated scenes and cast before production opens."}
            icon={Film}
            tone={productionUnlocked ? "done" : "current"}
            current={nextRoadmapStage === "script"}
            actionLabel={productionUnlocked ? "Open screenplay" : "Review screenplay"}
            actionIcon={Film}
            onAction={() => setActiveTab("scenes")}
          />

          <ProductionStageCard
            number="02"
            title="Visual frames"
            status={frameRoadmapStatus}
            description={!productionUnlocked
              ? "Approve the screenplay to open the saved character references and scene storyboards."
              : frameRunInProgress
                ? "Character references and scene storyboards are being saved as the visual pass completes."
                : allFramesReady
                  ? "Review the saved references and storyboards before choosing a scene for motion."
                  : "Continue from the last saved image. Completed assets stay safe while missing frames are added."}
            icon={ImageIcon}
            tone={!productionUnlocked
              ? "later"
              : frameStatus === "FAILED"
                ? "attention"
                : nextRoadmapStage === "frames"
                  ? "current"
                  : allFramesReady
                    ? "done"
                    : "later"}
            current={nextRoadmapStage === "frames"}
            actionLabel={!productionUnlocked
              ? undefined
              : frameRunInProgress
                ? "View frame progress"
                : allFramesReady
                  ? "Review frames"
                  : frameStatus === "FAILED"
                    ? "Retry missing frames"
                    : "Continue visual production"}
            actionIcon={frameRunInProgress ? Loader2 : allFramesReady ? Eye : frameStatus === "FAILED" ? RefreshCw : ImageIcon}
            onAction={productionUnlocked ? () => void handleFrameAction("missing") : undefined}
            actionTitle={productionUnlocked ? `${frameRoadmapStatus}. ${frameActionDescription}` : "Approve the screenplay to open visual frames."}
          />

          <ProductionStageCard
            number="03"
            title="Video & motion"
            status={!productionUnlocked ? "Locked until approval" : videoStatusLabel}
            description={!productionUnlocked
              ? "Approve the screenplay before testing motion from a saved visual frame."
              : videoStatus === "READY"
                ? "A motion test is saved for review. Compare it with the source frame in this shelf."
                : "Review or render a five-second motion test from a saved visual frame."}
            icon={VideoIcon}
            tone={!productionUnlocked
              ? "later"
              : nextRoadmapStage === "video"
                ? "current"
                : videoStatus === "READY"
                  ? "done"
                  : "later"}
            current={nextRoadmapStage === "video"}
            actionLabel={productionUnlocked ? "Open Video & Motion" : undefined}
            actionIcon={VideoIcon}
            onAction={productionUnlocked ? () => setActiveTab("video") : undefined}
            actionTitle="Open the motion shelf to review or render a scene test."
          />

          <ProductionStageCard
            number="04"
            title="Audio"
            status={audioRoadmapStatus}
            description={!productionUnlocked
              ? "Approve the screenplay before creating voice takes from saved dialogue."
              : dialogueLineCount === 0
                ? "This cut has no spoken lines. Sound Test remains available for later audio work."
                : "Choose voices and create one saved voice take at a time from the screenplay."}
            icon={AudioLines}
            tone={!productionUnlocked
              ? "later"
              : nextRoadmapStage === "audio"
                ? "current"
                : audioStageReady
                  ? "done"
                  : "later"}
            current={nextRoadmapStage === "audio"}
            actionLabel={productionUnlocked ? "Open Sound Test" : undefined}
            actionIcon={AudioLines}
            onAction={productionUnlocked ? () => setActiveTab("sound") : undefined}
            actionTitle="Open Sound Test to create and review a voice take."
          />

          <ProductionStageCard
            number="05"
            title="Final screening"
            status={finalRoadmapStatus}
            description={!productionUnlocked
              ? "Approve the screenplay before opening the screening shelf."
              : silentPreviewPlaylist.complete
                ? "Watch the saved silent cut and check scene order before final assembly."
                : "The silent cut fills in as motion clips are saved. Review it when scenes are ready."}
            icon={Play}
            tone={!productionUnlocked
              ? "later"
              : nextRoadmapStage === "final"
                ? "current"
                : silentPreviewPlaylist.complete
                  ? "done"
                  : "later"}
            current={nextRoadmapStage === "final"}
            actionLabel={productionUnlocked ? "Open Silent Preview" : undefined}
            actionIcon={Play}
            onAction={productionUnlocked ? () => setActiveTab("preview") : undefined}
            actionTitle="Open Silent Preview to review the saved scene order."
          />
        </div>
      </section>

      {/* Main Workspace Tabs */}
      <div className="min-w-0 flex-none px-4 py-5 sm:px-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full min-w-0">
          <div className="flex min-w-0 flex-col gap-3 border-b border-[#1c2333] pb-4 mb-6">
            <TabsList className="!grid h-auto w-full min-w-0 grid-cols-2 gap-1.5 rounded-xl border border-[#222b3e] bg-[#141926] p-1.5 sm:grid-cols-3 xl:grid-cols-4">
              <TabsTrigger
                value="scenes"
                className="min-w-0 justify-start gap-2 !whitespace-normal rounded-lg px-2 py-2 text-left text-[11px] leading-tight sm:justify-center sm:px-3 sm:text-xs data-[state=active]:bg-amber-500/20 data-[state=active]:text-amber-300 data-[state=active]:border-amber-500/40"
              >
                <Film className="w-3.5 h-3.5" />
                <span className="min-w-0 break-words">Screenplay & Scenes ({scenes.length})</span>
              </TabsTrigger>
              <TabsTrigger
                value="characters"
                className="min-w-0 justify-start gap-2 !whitespace-normal rounded-lg px-2 py-2 text-left text-[11px] leading-tight sm:justify-center sm:px-3 sm:text-xs data-[state=active]:bg-amber-500/20 data-[state=active]:text-amber-300 data-[state=active]:border-amber-500/40"
              >
                <Users className="w-3.5 h-3.5" />
                <span className="min-w-0 break-words">Cast & Visual Profiles ({characters.length})</span>
              </TabsTrigger>
              {productionUnlocked && (
                <>
                  <TabsTrigger
                    value="frames"
                    className="min-w-0 justify-start gap-2 !whitespace-normal rounded-lg px-2 py-2 text-left text-[11px] leading-tight sm:justify-center sm:px-3 sm:text-xs data-[state=active]:bg-amber-500/20 data-[state=active]:text-amber-300 data-[state=active]:border-amber-500/40"
                  >
                    <ImageIcon className="w-3.5 h-3.5" />
                    <span className="min-w-0 break-words">Frames ({savedFrameCount}/{expectedFrameCount})</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="video"
                    className="min-w-0 justify-start gap-2 !whitespace-normal rounded-lg px-2 py-2 text-left text-[11px] leading-tight sm:justify-center sm:px-3 sm:text-xs data-[state=active]:bg-amber-500/20 data-[state=active]:text-amber-300 data-[state=active]:border-amber-500/40"
                  >
                    <VideoIcon className="w-3.5 h-3.5" />
                    <span className="min-w-0 break-words">Video & Motion</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="preview"
                    className="min-w-0 justify-start gap-2 !whitespace-normal rounded-lg px-2 py-2 text-left text-[11px] leading-tight sm:justify-center sm:px-3 sm:text-xs data-[state=active]:bg-amber-500/20 data-[state=active]:text-amber-300 data-[state=active]:border-amber-500/40"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span className="min-w-0 break-words">Silent Preview</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="roughcut"
                    className="min-w-0 justify-start gap-2 !whitespace-normal rounded-lg px-2 py-2 text-left text-[11px] leading-tight sm:justify-center sm:px-3 sm:text-xs data-[state=active]:bg-amber-500/20 data-[state=active]:text-amber-300 data-[state=active]:border-amber-500/40"
                  >
                    <Film className="w-3.5 h-3.5" />
                    <span className="min-w-0 break-words">Rough Cut</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="sound"
                    className="min-w-0 justify-start gap-2 !whitespace-normal rounded-lg px-2 py-2 text-left text-[11px] leading-tight sm:justify-center sm:px-3 sm:text-xs data-[state=active]:bg-amber-500/20 data-[state=active]:text-amber-300 data-[state=active]:border-amber-500/40"
                  >
                    <AudioLines className="w-3.5 h-3.5" />
                    <span className="min-w-0 break-words">Sound Test</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="lipsync"
                    className="min-w-0 justify-start gap-2 !whitespace-normal rounded-lg px-2 py-2 text-left text-[11px] leading-tight sm:justify-center sm:px-3 sm:text-xs data-[state=active]:bg-amber-500/20 data-[state=active]:text-amber-300 data-[state=active]:border-amber-500/40"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span className="min-w-0 break-words">Lip-sync Proof</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="shot-plan"
                    className="min-w-0 justify-start gap-2 !whitespace-normal rounded-lg px-2 py-2 text-left text-[11px] leading-tight sm:justify-center sm:px-3 sm:text-xs data-[state=active]:bg-amber-500/20 data-[state=active]:text-amber-300 data-[state=active]:border-amber-500/40"
                  >
                    <ListOrdered className="w-3.5 h-3.5" />
                    <span className="min-w-0 break-words">Shot Plan Proof</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="scene-assembly"
                    className="min-w-0 justify-start gap-2 !whitespace-normal rounded-lg px-2 py-2 text-left text-[11px] leading-tight sm:justify-center sm:px-3 sm:text-xs data-[state=active]:bg-amber-500/20 data-[state=active]:text-amber-300 data-[state=active]:border-amber-500/40"
                  >
                    <ListOrdered className="w-3.5 h-3.5" />
                    <span className="min-w-0 break-words">Final Scene Assembly</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="ambience"
                    className="min-w-0 justify-start gap-2 !whitespace-normal rounded-lg px-2 py-2 text-left text-[11px] leading-tight sm:justify-center sm:px-3 sm:text-xs data-[state=active]:bg-amber-500/20 data-[state=active]:text-amber-300 data-[state=active]:border-amber-500/40"
                  >
                    <Waves className="w-3.5 h-3.5" />
                    <span className="min-w-0 break-words">Ambience</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="mix"
                    className="min-w-0 justify-start gap-2 !whitespace-normal rounded-lg px-2 py-2 text-left text-[11px] leading-tight sm:justify-center sm:px-3 sm:text-xs data-[state=active]:bg-amber-500/20 data-[state=active]:text-amber-300 data-[state=active]:border-amber-500/40"
                  >
                    <AudioLines className="w-3.5 h-3.5" />
                    <span className="min-w-0 break-words">Scene Mix Proof</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="episode-mix"
                    className="min-w-0 justify-start gap-2 !whitespace-normal rounded-lg px-2 py-2 text-left text-[11px] leading-tight sm:justify-center sm:px-3 sm:text-xs data-[state=active]:bg-amber-500/20 data-[state=active]:text-amber-300 data-[state=active]:border-amber-500/40"
                  >
                    <AudioLines className="w-3.5 h-3.5" />
                    <span className="min-w-0 break-words">Episode Mix Proof</span>
                  </TabsTrigger>
                </>
              )}
              <TabsTrigger
                value="json"
                className="min-w-0 justify-start gap-2 !whitespace-normal rounded-lg px-2 py-2 text-left text-[11px] leading-tight font-mono sm:justify-center sm:px-3 sm:text-xs data-[state=active]:bg-amber-500/20 data-[state=active]:text-amber-300 data-[state=active]:border-amber-500/40"
              >
                <Code2 className="w-3.5 h-3.5" />
                <span className="min-w-0 break-words">Manifest Schema</span>
              </TabsTrigger>
            </TabsList>

            {activeTab === "scenes" && (
              <Button
                onClick={handleAddScene}
                size="sm"
                variant="outline"
                className="self-start border-[#273248] bg-[#161d2d] hover:bg-[#1f293d] text-gray-200 h-9 gap-1.5 text-xs sm:self-end"
              >
                <Plus className="w-3.5 h-3.5 text-amber-400" /> Add Scene
              </Button>
            )}

            {activeTab === "characters" && (
              <Button
                onClick={handleAddCharacter}
                size="sm"
                variant="outline"
                className="self-start border-[#273248] bg-[#161d2d] hover:bg-[#1f293d] text-gray-200 h-9 gap-1.5 text-xs sm:self-end"
              >
                <Plus className="w-3.5 h-3.5 text-amber-400" /> Add Character
              </Button>
            )}
          </div>

          {/* TAB 1: SCENES & SCREENPLAY */}
          <TabsContent value="scenes" className="space-y-6 mt-0">
            {productionUnlocked && persistedProject && persistedManifestValidation.valid && !isGeneratingFrames && (
              <div className="flex flex-col gap-3 rounded-xl border border-amber-500/30 bg-amber-950/20 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-amber-300">
                    <ImageIcon className="h-4 w-4" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-mono uppercase tracking-wider text-amber-300">Next: visual reference frames</p>
                    <p className="max-w-2xl text-xs leading-relaxed text-amber-100/75">
                      {allFramesReady
                        ? "Your character references and scene storyboards are saved. Open Frames to review the visual shelf."
                        : "Visual Production starts automatically after approval. If a run needs recovery, open Frames to retry only the missing assets from the last saved screenplay."}
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  onClick={() => void handleFrameAction()}
                  className="h-9 shrink-0 gap-2 bg-amber-500 px-3 text-xs font-semibold text-black hover:bg-amber-600"
                  title={frameActionDescription}
                >
                  {allFramesReady ? <Eye className="h-3.5 w-3.5" /> : <ImageIcon className="h-3.5 w-3.5" />}
                  {allFramesReady ? "Review Frames" : frameActionLabel}
                </Button>
              </div>
            )}

            {/* Global Style Banner */}
            <div className="p-4 rounded-xl bg-[#131824] border border-[#1f273b] space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-amber-400 font-semibold">
                  <Sparkles className="w-3.5 h-3.5" /> Global Visual Style
                </div>
                <div className="flex items-center gap-1.5 text-xs text-gray-400">
                  <span>Preset:</span>
                  <select
                    onChange={(e) => {
                      if (e.target.value) setGlobalStyle(e.target.value);
                    }}
                    value=""
                    aria-label="Choose preset style"
                    className="bg-[#1b2234] border border-[#2a354e] text-xs text-gray-200 rounded px-2 py-1 focus:outline-none focus:border-amber-500"
                  >
                    <option value="" disabled>
                      Choose preset style...
                    </option>
                    {STYLE_PRESETS.map((p) => (
                      <option key={p.name} value={p.value}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <Input
                value={globalStyle}
                onChange={(e) => setGlobalStyle(e.target.value)}
                placeholder="Cinematic drama, high fidelity, 35mm film texture, photorealistic, moody lighting..."
                className="bg-[#0e121a] border-[#222b3e] text-sm text-gray-200 focus-visible:ring-amber-500/40"
              />
            </div>

            {/* Scene Cards List */}
            <div className="space-y-5">
              {scenes.map((scene, idx) => (
                <div
                  key={scene.scene_number || idx}
                  className="rounded-xl bg-[#121622] border border-[#1f273b] overflow-hidden shadow-sm transition-all hover:border-[#2b3650]"
                >
                  {/* Scene Card Header */}
                  <div className="bg-[#171c2b] px-4 py-3 border-b border-[#1f273b] flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span className="font-mono font-bold text-xs uppercase px-2 py-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                        SCENE {String(scene.scene_number).padStart(2, "0")}
                      </span>
                      <span className="text-xs text-gray-400 flex items-center gap-1">
                        <Clock className="w-3 h-3 text-amber-400/80" />
                        <select
                          value={scene.duration_seconds}
                          onChange={(e) =>
                            handleUpdateScene(idx, {
                              duration_seconds: parseInt(e.target.value, 10),
                            })
                          }
                          aria-label={`Scene ${scene.scene_number} duration`}
                          className="bg-[#111520] border border-[#273248] rounded px-1.5 py-0.5 text-xs text-gray-200 focus:outline-none focus:border-amber-500"
                        >
                          <option value={3}>3 Seconds</option>
                          <option value={4}>4 Seconds</option>
                        </select>
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Character focus chips */}
                      <div className="flex items-center gap-1 flex-wrap">
                        <span className="text-[11px] text-gray-400 mr-1">Cast in frame:</span>
                        {characters.map((char) => {
                          const isFocused = scene.character_focus.includes(char.id);
                          return (
                            <button
                              key={char.id}
                              type="button"
                              onClick={() => handleToggleSceneFocus(idx, char.id)}
                              className={`text-[11px] font-mono px-2 py-0.5 rounded transition-colors ${
                                isFocused
                                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                                  : "bg-[#10141f] text-gray-400 border border-[#222b3e] hover:text-gray-300"
                              }`}
                            >
                              {char.id}
                            </button>
                          );
                        })}
                      </div>

                      {scenes.length > 3 && (
                        <button
                          type="button"
                          onClick={() => handleDeleteScene(idx)}
                          className="text-gray-400 hover:text-red-400 p-1 rounded hover:bg-red-950/20 transition-colors ml-1"
                          title="Delete scene"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Scene Card Body */}
                  <div className="p-4 space-y-4">
                    {/* Visual Prompt */}
                    <div>
                      <label className="flex items-center gap-1.5 text-xs font-medium text-gray-300 mb-1.5">
                        <Eye className="w-3.5 h-3.5 text-amber-400" />
                        <span>Visual Setting & Action Prompt</span>
                        <span className="text-[11px] text-gray-400 font-normal">
                          (Describes character action, lighting, and physical setting)
                        </span>
                      </label>
                      <Textarea
                        value={scene.visual_prompt}
                        onChange={(e) => handleUpdateScene(idx, { visual_prompt: e.target.value })}
                        placeholder="e.g. CHARACTER_A sitting behind an expansive mahogany desk looking out a rainy glass window, brooding moody lighting..."
                        rows={2}
                        className="bg-[#0d1017] border-[#20283c] text-sm text-gray-200 focus-visible:ring-amber-500/40 resize-y"
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Camera Movement */}
                      <div>
                        <label className="flex items-center gap-1.5 text-xs font-medium text-gray-300 mb-1.5">
                          <Camera className="w-3.5 h-3.5 text-amber-400" />
                          <span>Camera Movement ({orientationLabelText})</span>
                        </label>
                        <Input
                          value={scene.camera_movement}
                          onChange={(e) => handleUpdateScene(idx, { camera_movement: e.target.value })}
                          placeholder="e.g. Slow cinematic zoom-in on character face"
                          className="bg-[#0d1017] border-[#20283c] text-sm text-gray-200 focus-visible:ring-amber-500/40"
                        />
                      </div>

                      {/* Speaker-tagged dialogue lines */}
                      <div className="md:col-span-2 rounded-xl border border-amber-500/20 bg-[#0d111a] p-3.5">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <label className="flex items-center gap-1.5 text-xs font-medium text-gray-200">
                            <MessageSquare className="h-3.5 w-3.5 text-amber-400" />
                            <span>Speaker lines</span>
                            <span className="text-[11px] font-normal text-gray-500">Up to 3 lines, rendered separately. Remove the final line to make this scene silent.</span>
                          </label>
                          <span className="font-mono text-[10px] uppercase tracking-wider text-amber-300/80">
                            {getEditableDialogueLines(scene).length}/3 lines
                          </span>
                        </div>

                        <div className="mt-3 space-y-2.5">
                          {getEditableDialogueLines(scene).map((line, lineIndex) => (
                            <div key={`${line.line_id}-${lineIndex}`} className="rounded-lg border border-[#263149] bg-[#101622] p-2.5">
                              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                                <div className="flex items-center gap-2 sm:w-[230px] sm:shrink-0">
                                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-amber-500/30 bg-amber-500/10 font-mono text-[10px] text-amber-300">
                                    {String(lineIndex + 1).padStart(2, "0")}
                                  </span>
                                  <select
                                    value={line.character_id}
                                    onChange={(event) => handleUpdateDialogueLine(idx, line.line_id, { character_id: event.target.value })}
                                    aria-label={`Scene ${scene.scene_number} line ${lineIndex + 1} speaker`}
                                    className="h-9 min-w-0 flex-1 rounded-md border border-[#33415d] bg-[#0b1019] px-2 text-xs font-mono text-gray-100 outline-none transition-colors focus:border-amber-500"
                                  >
                                    {scene.character_focus.map((characterId) => (
                                      <option key={characterId} value={characterId}>{characterId}</option>
                                    ))}
                                  </select>
                                </div>
                                <Input
                                  value={line.text}
                                  onChange={(event) => handleUpdateDialogueLine(idx, line.line_id, { text: event.target.value })}
                                  aria-label={`Scene ${scene.scene_number} line ${lineIndex + 1} text`}
                                  placeholder="Short spoken line for this character"
                                  className="h-9 min-w-0 flex-1 border-[#33415d] bg-[#0b1019] font-serif text-sm italic text-amber-100 focus-visible:ring-amber-500/40"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleRemoveDialogueLine(idx, line.line_id)}
                                  aria-label={getEditableDialogueLines(scene).length <= 1
                                    ? `Remove final Scene ${scene.scene_number} line and make the scene silent`
                                    : `Remove Scene ${scene.scene_number} line ${lineIndex + 1}`}
                                  title={getEditableDialogueLines(scene).length <= 1 ? "Remove the final line and make this scene silent" : "Remove speaker line"}
                                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[#33415d] text-gray-400 transition-colors hover:border-red-500/50 hover:bg-red-950/20 hover:text-red-300"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                              <p className="mt-1.5 pl-8 font-mono text-[9px] uppercase tracking-wider text-gray-600">{line.line_id}</p>
                            </div>
                          ))}
                          {getEditableDialogueLines(scene).length === 0 && (
                            <p className="rounded-lg border border-dashed border-[#33415d] px-3 py-3 text-xs text-gray-500">
                              Add a speaker line when this scene needs dialogue.
                            </p>
                          )}
                        </div>

                        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <button
                            type="button"
                            onClick={() => handleAddDialogueLine(idx)}
                            disabled={getEditableDialogueLines(scene).length >= 3 || scene.character_focus.length === 0}
                            className="inline-flex items-center justify-center gap-1.5 self-start rounded-md border border-dashed border-amber-500/35 bg-amber-500/5 px-3 py-2 text-[11px] font-medium text-amber-200 transition-colors hover:border-amber-400/60 hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <Plus className="h-3.5 w-3.5" /> Add speaker line
                          </button>
                          <span className="text-[10px] text-gray-500">New lines use the first focused character by default.</span>
                        </div>

                        <div className="mt-3 rounded-lg border border-[#1d2638] bg-[#090d14] px-3 py-2.5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-mono text-[10px] uppercase tracking-wider text-gray-500">Compatibility dialogue</span>
                            <span className="font-mono text-[10px] text-gray-600">
                              {scene.dialogue.split(/\s+/).filter(Boolean).length} words
                            </span>
                          </div>
                          <p className="mt-1.5 font-serif text-sm italic leading-relaxed text-gray-300">
                            {scene.dialogue ? `“${scene.dialogue}”` : "No dialogue text yet"}
                          </p>
                          <p className="mt-1 text-[10px] leading-relaxed text-gray-600">This joined text stays available to the visual and motion stages while each voice line remains separate.</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Bottom Add Scene Button */}
            {scenes.length < 6 && (
              <div className="text-center pt-2">
                <Button
                  onClick={handleAddScene}
                  variant="outline"
                  className="border-dashed border-[#2b3750] hover:border-amber-500/60 bg-[#121622]/50 hover:bg-[#161d2d] text-gray-300 hover:text-white px-6 py-4 h-auto gap-2"
                >
                  <Plus className="w-4 h-4 text-amber-400" /> Add Next Scene to Timeline (Max 6)
                </Button>
              </div>
            )}
          </TabsContent>

          {/* TAB 2: CHARACTERS & VISUAL PROFILES */}
          <TabsContent value="characters" className="space-y-5 mt-0">
            {/* Informational Callout */}
            <div className="p-4 rounded-xl bg-amber-950/25 border border-amber-800/30 flex items-start gap-3 text-xs text-amber-200/90">
              <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold text-amber-300">
                  Character Visual Consistency Guidance
                </p>
                <p className="text-amber-200/80 leading-relaxed">
                  Shared visual profiles and locked random seeds provide foundational prompt grounding, but prompt text and seeds alone do not guarantee visual identity across AI image generations. Precise character consistency in downstream phases will require reference-image-conditioned diffusion models (such as IP-Adapter / LoRA pipelines).
                </p>
              </div>
            </div>

            {/* Character Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {characters.map((char, idx) => {
                const appearances = scenes.filter((s) => s.character_focus.includes(char.id));
                return (
                  <div
                    key={char.id || idx}
                    className="rounded-xl bg-[#121622] border border-[#1f273b] p-4 space-y-3.5 shadow-sm hover:border-[#2a354e] transition-all"
                  >
                    <div className="flex items-center justify-between gap-2 border-b border-[#1c2333] pb-2.5">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-xs uppercase px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                          {char.id}
                        </span>
                        <span className="text-xs text-gray-400">
                          Appears in {appearances.length} {appearances.length === 1 ? "scene" : "scenes"}
                        </span>
                      </div>

                      {characters.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleDeleteCharacter(idx)}
                          className="text-gray-400 hover:text-red-400 p-1 rounded hover:bg-red-950/20 transition-colors"
                          title="Delete character"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    <div>
                      <label className="text-xs font-medium text-gray-300 mb-1.5 block">
                        Detailed Visual & Physical Profile
                      </label>
                      <Textarea
                        value={char.detailed_visual_profile}
                        onChange={(e) =>
                          handleUpdateCharacter(idx, { detailed_visual_profile: e.target.value })
                        }
                        placeholder="e.g. A 28-year-old CEO, sharp jawline, intense green eyes, sleek black hair, wearing a pristine tailored charcoal suit..."
                        rows={4}
                        className="bg-[#0d1017] border-[#20283c] text-sm text-gray-200 focus-visible:ring-amber-500/40 resize-y leading-relaxed"
                      />
                    </div>

                    {/* Featured Scenes Badges */}
                    <div className="text-xs text-gray-400 pt-1 flex items-center gap-1.5 flex-wrap">
                      <span className="text-[11px] text-gray-400">Scenes:</span>
                      {appearances.length > 0 ? (
                        appearances.map((s) => (
                          <span
                            key={s.scene_number}
                            className="bg-[#181f2f] text-gray-300 font-mono text-[10px] px-1.5 py-0.5 rounded border border-[#27334a]"
                          >
                            Scene {s.scene_number}
                          </span>
                        ))
                      ) : (
                        <span className="text-[11px] text-gray-400 italic">Not in any scenes yet</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="pt-2 text-center">
              <Button
                onClick={handleAddCharacter}
                variant="outline"
                className="border-dashed border-[#2b3750] hover:border-amber-500/60 bg-[#121622]/50 hover:bg-[#161d2d] text-gray-300 hover:text-white px-6 py-4 h-auto gap-2"
              >
                <Plus className="w-4 h-4 text-amber-400" /> Add Another Character
              </Button>
            </div>
          </TabsContent>

          {productionUnlocked && (
            <>
              {/* TAB 3: FRAMES */}
              <TabsContent value="frames" className="space-y-6 mt-0">
            <div className="rounded-xl border border-[#2a354c] bg-[#121926] p-4 sm:p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="max-w-2xl space-y-2">
                  <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-amber-400">
                    <ImageIcon className="h-4 w-4" /> Hosted frame stage
                  </div>
                  <h3 className="text-xl font-serif font-bold text-white">
                    {isGeneratingFrames
                      ? "Building the visual reference shelf"
                      : frameStatus === "FAILED"
                        ? "Recover the visual reference shelf"
                        : allFramesReady
                          ? "Review the saved visual shelf"
                          : "Give the script a visual starting point"}
                  </h3>
                  <p className="text-sm leading-relaxed text-gray-300">
                    Visual Production starts here after screenplay approval. The studio creates one private reference image per character first, then one storyboard image per scene, saving each result as soon as it finishes. Motion and sound stay separate until you choose those stages.
                  </p>
                </div>
                <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:min-w-[220px]">
                  <Button
                    onClick={() => void handleFrameAction(allFramesReady ? "all" : "missing")}
                    disabled={
                      !canGenerateFrames ||
                      isSaving ||
                      isGeneratingFrames ||
                      isDirty
                    }
                    className={`h-10 gap-2 px-4 font-semibold shadow-md disabled:cursor-not-allowed disabled:opacity-50 ${
                      frameActionIsRecovery && !isGeneratingFrames
                        ? "border border-[#35425d] bg-[#171f30] text-gray-200 shadow-black/10 hover:border-amber-500/50 hover:bg-[#1d283d] hover:text-white"
                        : "bg-amber-500 text-black shadow-amber-500/15 hover:bg-amber-600"
                    }`}
                  >
                    {isGeneratingFrames ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" /> Generating frames...
                      </>
                    ) : allFramesReady ? (
                      <>
                        <RefreshCw className="h-4 w-4" /> {framePrimaryActionLabel}
                      </>
                    ) : savedFrameCount > 0 ? (
                      <>
                        <RefreshCw className="h-4 w-4" /> {framePrimaryActionLabel}
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4" /> {framePrimaryActionLabel}
                      </>
                    )}
                  </Button>
                  {frameActionIsRecovery && !isGeneratingFrames && (
                    <p className="text-center text-[11px] leading-relaxed text-gray-500">
                      {frameStatus === "FAILED"
                        ? "Recovery action: retry only the missing images."
                        : allFramesReady
                          ? "Advanced action: request a fresh visual pass when you need one."
                          : "Recovery action: create the remaining missing images."}
                    </p>
                  )}
                  {savedFrameCount > 0 && !allFramesReady && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void handleFrameAction("all")}
                      disabled={!canGenerateFrames || isSaving || isGeneratingFrames || isDirty}
                      className="h-9 gap-2 border-[#35425d] bg-[#171f30] text-gray-200 hover:border-amber-500/50 hover:bg-[#1d283d] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <RefreshCw className="h-3.5 w-3.5 text-amber-400" /> Regenerate All
                    </Button>
                  )}
                  {!authAvailable && (
                    <p className="text-center text-[11px] text-amber-200/80">Sign in first to generate private project images.</p>
                  )}
                  {authAvailable && !persistedProject && (
                    <p className="text-center text-[11px] text-amber-200/80">Save script first. Frames only run from a saved SCRIPTED project.</p>
                  )}
                  {persistedProject && isDirty && (
                    <p className="text-center text-[11px] text-amber-200/80">Save script edits before generating frames.</p>
                  )}
                  {persistedProject && !persistedManifestValidation.valid && (
                    <p className="text-center text-[11px] text-red-200/80">Save a valid approved manifest before generating frames.</p>
                  )}
                  {frameActionNotice && (
                    <p className="text-center text-[11px] text-amber-200/80" role="status">{frameActionNotice}</p>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#1f2a3f] bg-[#0e131d] px-3.5 py-3">
              <div className="flex items-center gap-2 text-xs text-gray-300">
                {frameStatus === "GENERATING" ? (
                  <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
                ) : frameStatus === "READY" ? (
                  <CircleCheck className="h-4 w-4 text-emerald-400" />
                ) : frameStatus === "FAILED" ? (
                  <CircleX className="h-4 w-4 text-red-400" />
                ) : (
                  <ImageIcon className="h-4 w-4 text-gray-400" />
                )}
                <span>
                  {savedFrameCount} of {expectedFrameCount} assets saved
                </span>
              </div>
              <span className={`rounded-md border px-2 py-1 text-[10px] font-mono uppercase tracking-wider ${
                frameStatus === "READY"
                  ? "border-emerald-700/50 bg-emerald-950/40 text-emerald-300"
                  : frameStatus === "FAILED"
                    ? "border-red-700/50 bg-red-950/40 text-red-300"
                    : frameStatus === "GENERATING"
                      ? "border-amber-700/50 bg-amber-950/40 text-amber-300"
                      : "border-[#2a354b] bg-[#171f2e] text-gray-400"
              }`}>
                {frameStatus === "READY"
                  ? "Frames ready"
                  : frameStatus === "FAILED"
                    ? "Needs retry"
                    : frameStatus === "GENERATING"
                      ? "Generating"
                      : "Not started"}
              </span>
            </div>

            {isGeneratingFrames && (
              <div className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-950/20 p-4">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="font-semibold text-amber-200">Saving private visual assets as they complete</span>
                  <span className="font-mono text-amber-300">{frameProgressPercent}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[#1e2635]">
                  <div
                    className="h-full rounded-full bg-amber-400 transition-all duration-500"
                    style={{ width: `${frameProgressPercent}%` }}
                  />
                </div>
                <p className="text-[11px] leading-relaxed text-amber-100/75">
                  {frameProgress.current_label || "Preparing the next frame..."} Keep this tab open while the hosted image service works.
                </p>
              </div>
            )}

            {(frameError || frameActionError) && (
              <div className={`flex items-start gap-3 rounded-xl p-4 text-sm ${
                frameStatus === "FAILED"
                  ? "border border-red-800/50 bg-red-950/30 text-red-200"
                  : "border border-amber-800/40 bg-amber-950/20 text-amber-100/85"
              }`}>
                {frameStatus === "FAILED" ? (
                  <CircleX className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                ) : (
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                )}
                <div>
                  <p className={`font-semibold ${frameStatus === "FAILED" ? "text-red-300" : "text-amber-200"}`}>
                    {frameStatus === "FAILED" ? "Frame generation stopped" : "Frames need review"}
                  </p>
                  <p className={`mt-1 text-xs leading-relaxed ${frameStatus === "FAILED" ? "text-red-200/85" : "text-amber-100/75"}`}>
                    {frameError || frameActionError}
                  </p>
                  {frameStatus === "FAILED" && (
                    <p className="mt-2 text-[11px] text-red-200/70">Completed images remain saved. Retry will request only the missing assets.</p>
                  )}
                </div>
              </div>
            )}

            <div className="flex items-start gap-3 rounded-xl border border-amber-800/30 bg-amber-950/20 p-4 text-xs text-amber-100/80">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <p className="leading-relaxed">
                Shared profiles, reference images, and the saved seed guide the prompts. The seed is a textual anchor, so it does not guarantee identical identity. Open Video & Motion after a saved storyboard to review one five-second motion test.
              </p>
            </div>

            <section className="space-y-3">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <p className="text-xs font-mono uppercase tracking-wider text-amber-400">Character references</p>
                  <h3 className="mt-1 text-lg font-serif font-bold text-white">The cast reference shelf</h3>
                </div>
                <span className="text-xs text-gray-400">{characterFrameAssets.length} saved of {characters.length}</span>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {characters.map((character) => {
                  const asset = characterFrameAssets.find((candidate) => candidate.character_id === character.id);
                  return asset ? (
                    <FrameImageCard
                      key={character.id}
                      asset={asset}
                      label="Character reference"
                      title={character.id}
                      detail={character.detailed_visual_profile}
                    />
                  ) : (
                    <div key={character.id} className="flex min-h-[260px] flex-col justify-between rounded-xl border border-dashed border-[#2a354b] bg-[#0e131d] p-4">
                      <div className="flex aspect-[9/16] min-h-[190px] flex-col items-center justify-center gap-2 rounded-lg border border-[#202a3d] bg-[#090c12] text-center text-xs text-gray-500">
                        <ImageIcon className="h-7 w-7 text-gray-600" />
                        <span>Reference not generated</span>
                      </div>
                      <div className="pt-3">
                        <p className="font-mono text-xs font-semibold text-gray-300">{character.id}</p>
                        <p className="mt-1 text-[11px] text-gray-500">This character will be processed before scene storyboards.</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="space-y-3">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <p className="text-xs font-mono uppercase tracking-wider text-amber-400">Scene storyboards</p>
                  <h3 className="mt-1 text-lg font-serif font-bold text-white">The vertical shot shelf</h3>
                </div>
                <span className="text-xs text-gray-400">{sceneFrameAssets.length} saved of {scenes.length}</span>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {scenes.map((scene) => {
                  const asset = sceneFrameAssets.find((candidate) => candidate.scene_number === scene.scene_number);
                  return asset ? (
                    <FrameImageCard
                      key={scene.scene_number}
                      asset={asset}
                      label={`Scene ${String(scene.scene_number).padStart(2, "0")}`}
                      title={`Scene ${scene.scene_number} storyboard`}
                      detail={`${scene.character_focus.join(", ")} · ${scene.visual_prompt}`}
                    />
                  ) : (
                    <div key={scene.scene_number} className="flex min-h-[260px] flex-col justify-between rounded-xl border border-dashed border-[#2a354b] bg-[#0e131d] p-4">
                      <div className="flex aspect-[9/16] min-h-[190px] flex-col items-center justify-center gap-2 rounded-lg border border-[#202a3d] bg-[#090c12] text-center text-xs text-gray-500">
                        <Film className="h-7 w-7 text-gray-600" />
                        <span>Storyboard not generated</span>
                      </div>
                      <div className="pt-3">
                        <p className="font-mono text-xs font-semibold text-gray-300">Scene {String(scene.scene_number).padStart(2, "0")}</p>
                        <p className="mt-1 text-[11px] text-gray-500">{scene.character_focus.join(", ")} · Waiting for the frame stage.</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </TabsContent>

              {/* TAB 4: VIDEO & MOTION */}
              <TabsContent value="video" className="space-y-6 mt-0">
            <section className="rounded-xl border border-amber-500/30 bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,0.12),transparent_45%),#121926] p-4 sm:p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="max-w-2xl space-y-2">
                  <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-amber-400">
                    <VideoIcon className="h-4 w-4" /> Single-shot motion test
                  </div>
                  <h3 className="text-xl font-serif font-bold text-white">Give one saved frame a little life</h3>
                  <p className="text-sm leading-relaxed text-gray-300">
                    Luma through Replicate will animate one approved storyboard into a five-second vertical clip. The exact saved frame stays first, while the model adds restrained camera and character motion.
                  </p>
                  <div className="flex flex-wrap gap-2 pt-1 text-[11px] text-gray-400">
                    <span className="rounded-md border border-[#2a354b] bg-[#0e131d] px-2 py-1">9:16 vertical</span>
                    <span className="rounded-md border border-[#2a354b] bg-[#0e131d] px-2 py-1">5 seconds</span>
                    <span className="rounded-md border border-[#2a354b] bg-[#0e131d] px-2 py-1">No audio</span>
                    <span className="rounded-md border border-[#2a354b] bg-[#0e131d] px-2 py-1">Private archive</span>
                  </div>
                </div>
                <div className="w-full rounded-lg border border-[#2a354b] bg-[#0e131d] p-3 sm:w-auto sm:min-w-[210px]">
                  <div className="flex items-center justify-between gap-2 text-xs text-gray-300">
                    <span className="font-mono uppercase tracking-wider text-gray-400">Motion stage</span>
                    <span className={`rounded-md border px-2 py-1 text-[10px] font-mono uppercase tracking-wider ${
                      videoStatus === "READY"
                        ? "border-emerald-700/50 bg-emerald-950/40 text-emerald-300"
                        : videoStatus === "FAILED"
                          ? "border-red-700/50 bg-red-950/40 text-red-300"
                          : videoStatus === "QUEUED" || videoStatus === "PROCESSING"
                            ? "border-amber-700/50 bg-amber-950/40 text-amber-300"
                            : "border-[#2a354b] bg-[#171f2e] text-gray-400"
                    }`}>{videoStatusLabel}</span>
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-gray-400">
                    {activeVideoClip
                      ? "One render is active. Keep this browser tab open while Replicate finishes."
                      : "Choose one saved storyboard below to run the first motion pass."}
                  </p>
                </div>
              </div>
            </section>

            {videoError && (
              <div className="flex items-start gap-3 rounded-xl border border-red-800/50 bg-red-950/30 p-4 text-sm text-red-200" role="alert">
                <CircleX className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                <div>
                  <p className="font-semibold text-red-300">Motion test stopped</p>
                  <p className="mt-1 text-xs leading-relaxed text-red-200/85">{videoError}</p>
                </div>
              </div>
            )}

            <div className="flex items-start gap-3 rounded-xl border border-[#2a354b] bg-[#0e131d] p-4 text-xs text-gray-300">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <div className="space-y-1.5 leading-relaxed">
                <p className="font-semibold text-gray-200">This is a deliberate one-scene test.</p>
                <p className="text-gray-400">
                  Save the screenplay and storyboard first. Audio, dialogue tracks, multi-scene assembly, and the two-minute render are later stages. A completed card below is the durable clip you can review now.
                </p>
                {(!persistedProject || isDirty || !persistedManifestValidation.valid) && (
                  <p className="text-amber-200/85">Save a valid SCRIPTED project before starting motion.</p>
                )}
                {authAvailable && persistedProject && !isDirty && persistedManifestValidation.valid && !sceneFrameAssets.length && (
                  <p className="text-amber-200/85">Open Frames and generate at least one saved scene storyboard first.</p>
                )}
                {!authAvailable && <p className="text-amber-200/85">Sign in before generating private motion clips.</p>}
              </div>
            </div>

            <section className="space-y-3">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <p className="text-xs font-mono uppercase tracking-wider text-amber-400">Saved storyboard frames</p>
                  <h3 className="mt-1 text-lg font-serif font-bold text-white">Pick one scene to animate</h3>
                </div>
                <span className="text-xs text-gray-400">{sceneFrameAssets.length} saved of {scenes.length}</span>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {scenes.map((scene) => {
                  const storyboard = sceneFrameAssets.find((asset) => asset.scene_number === scene.scene_number);
                  const latestClip = getLatestVideoClip(videoClips, scene.scene_number);
                  const clipIsActive = latestClip?.status === "QUEUED" || latestClip?.status === "PROCESSING";
                  const clipIsReady = latestClip?.status === "READY" && Boolean(latestClip.video_url);
                  const clipIsArchivedFromEarlierStoryboard = Boolean(
                    clipIsReady && latestClip && (!storyboard || latestClip.source_storyboard_url !== storyboard.image_url)
                  );
                  const anotherClipIsActive = Boolean(
                    activeVideoClip && activeVideoClip.prediction_id !== latestClip?.prediction_id
                  );
                  const actionDisabled = Boolean(
                    !onGenerateVideo ||
                    !canGenerateMotion ||
                    !storyboard ||
                    clipIsActive ||
                    anotherClipIsActive ||
                    videoStartingScene !== null
                  );
                  const actionLabel = !authAvailable
                    ? "Sign in to generate"
                    : !persistedProject || isDirty || !persistedManifestValidation.valid
                      ? "Save script first"
                      : !storyboard
                        ? "Storyboard needed"
                        : clipIsActive
                          ? "Rendering 5s clip..."
                          : clipIsReady
                            ? "Regenerate 5s test"
                            : latestClip?.status === "FAILED"
                              ? "Retry motion test"
                              : "Generate 5s motion clip";

                  return (
                    <article key={scene.scene_number} className="overflow-hidden rounded-xl border border-[#252f45] bg-[#101622] shadow-lg shadow-black/20">
                      <div className="relative aspect-[9/16] min-h-[260px] bg-[#090c12]">
                        {storyboard ? (
                          <img
                            src={storyboard.image_url}
                            alt={`Scene ${scene.scene_number} saved storyboard`}
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex h-full flex-col items-center justify-center gap-2 px-5 text-center text-xs text-gray-500">
                            <ImageIcon className="h-8 w-8 text-gray-600" />
                            <span>Storyboard not generated</span>
                            <span className="leading-relaxed">Generate and save this scene in Frames before requesting motion.</span>
                          </div>
                        )}
                        <div className="absolute left-3 top-3 rounded-md border border-black/30 bg-black/75 px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-amber-200 backdrop-blur-sm">
                          Scene {String(scene.scene_number).padStart(2, "0")}
                        </div>
                        {clipIsReady && (
                          <div className="absolute right-3 top-3 flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-950/80 px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-emerald-200 backdrop-blur-sm">
                            <CircleCheck className="h-3 w-3" /> {clipIsArchivedFromEarlierStoryboard ? "Archived · earlier frame" : "Archived"}
                          </div>
                        )}
                      </div>

                      <div className="space-y-3 p-3.5">
                        <div>
                          <h4 className="text-sm font-semibold text-white">Scene {scene.scene_number} motion test</h4>
                          <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-gray-400">{scene.camera_movement} · {scene.visual_prompt}</p>
                        </div>

                        {clipIsReady && latestClip?.video_url ? (
                          <div className="space-y-2 rounded-lg border border-emerald-700/30 bg-emerald-950/15 p-2.5">
                            <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-emerald-300">
                              <Play className="h-3 w-3" /> Saved playable clip
                            </div>
                            {clipIsArchivedFromEarlierStoryboard && (
                              <p className="text-[11px] leading-relaxed text-emerald-100/70">
                                This clip was saved from an earlier storyboard and remains available to watch.
                              </p>
                            )}
                            <video
                              className="aspect-[9/16] w-full rounded-md bg-black object-contain"
                              src={latestClip.video_url}
                              controls
                              preload="metadata"
                              playsInline
                            />
                            <div className="flex items-center justify-between gap-2 pt-0.5">
                              <span className="text-[10px] text-gray-400">5 seconds · {latestClip.provider}</span>
                              <div className="flex items-center gap-1.5">
                                <a
                                  href={latestClip.video_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 rounded-md border border-[#2b3850] bg-[#171f30] px-2 py-1.5 text-[11px] text-gray-200 transition-colors hover:border-amber-500/50 hover:text-white"
                                >
                                  <ExternalLink className="h-3 w-3 text-amber-400" /> Open
                                </a>
                                <a
                                  href={latestClip.video_url}
                                  download
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-200 transition-colors hover:bg-amber-500/20"
                                >
                                  <Download className="h-3 w-3" /> Save
                                </a>
                              </div>
                            </div>
                          </div>
                        ) : latestClip && (clipIsActive || latestClip.status === "FAILED") ? (
                          <div className={`rounded-lg border p-3 text-xs ${
                            latestClip.status === "FAILED"
                              ? "border-red-800/50 bg-red-950/25 text-red-200"
                              : "border-amber-700/40 bg-amber-950/20 text-amber-100/85"
                          }`}>
                            <div className="flex items-center gap-2 font-semibold">
                              {latestClip.status === "FAILED" ? (
                                <CircleX className="h-3.5 w-3.5 text-red-400" />
                              ) : (
                                <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />
                              )}
                              <span>{latestClip.status === "FAILED" ? "Motion test failed" : latestClip.status === "QUEUED" ? "Queued with Replicate" : "Rendering with Luma"}</span>
                            </div>
                            <p className="mt-1.5 leading-relaxed text-[11px] opacity-80">
                              {latestClip.status === "FAILED"
                                ? latestClip.error || "The saved storyboard is safe. Retry this scene when you are ready."
                                : "Keep this browser tab open. The prediction is saved and this card will update as it progresses."}
                            </p>
                          </div>
                        ) : null}

                        <div className="border-t border-[#1d2638] pt-3">
                          <Button
                            type="button"
                            onClick={() => handleVideoAction(scene.scene_number, latestClip)}
                            disabled={actionDisabled}
                            className={`h-9 w-full gap-2 text-xs font-semibold ${
                              clipIsReady
                                ? "border border-amber-500/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20"
                                : latestClip?.status === "FAILED"
                                  ? "border border-red-700/40 bg-red-950/30 text-red-200 hover:bg-red-950/50"
                                  : "bg-amber-500 text-black hover:bg-amber-600"
                            } disabled:cursor-not-allowed disabled:opacity-50`}
                            title={
                              !storyboard
                                ? "Generate and save this scene storyboard first"
                                : anotherClipIsActive
                                  ? "Wait for the active scene motion test to finish"
                                  : latestClip?.status === "READY"
                                    ? "Generate a new clip while preserving the archived result"
                                    : "Start one five-second motion test for this saved storyboard"
                            }
                          >
                            {clipIsActive ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : clipIsReady ? <RefreshCw className="h-3.5 w-3.5" /> : latestClip?.status === "FAILED" ? <RefreshCw className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                            {actionLabel}
                          </Button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-amber-500/25 bg-amber-950/15 p-4">
                <p className="text-[10px] font-mono uppercase tracking-wider text-amber-400">Now</p>
                <p className="mt-1 text-sm font-semibold text-white">One five-second clip</p>
                <p className="mt-1 text-xs leading-relaxed text-gray-400">Review motion on the scene you choose, with the source frame preserved.</p>
              </div>
              <div className="rounded-xl border border-amber-500/25 bg-amber-950/15 p-4">
                <p className="text-[10px] font-mono uppercase tracking-wider text-amber-400">Next checkpoint</p>
                <p className="mt-1 text-sm font-semibold text-gray-200">Final scene assembly</p>
                <p className="mt-1 text-xs leading-relaxed text-gray-400">Open Final Scene Assembly after approved multi-line coverage to save one scene as a WebM with muted masters and embedded close-up audio.</p>
              </div>
              <div className="rounded-xl border border-[#1f2a3f] bg-[#0e131d] p-4">
                <p className="text-[10px] font-mono uppercase tracking-wider text-gray-500">Later</p>
                <p className="mt-1 text-sm font-semibold text-gray-300">Episode-wide finishing</p>
                <p className="mt-1 text-xs leading-relaxed text-gray-500">Multi-scene timeline, captions, music, effects, ambience mixing, loudness mastering, and downloadable export remain later.</p>
              </div>
            </div>
          </TabsContent>

          {/* TAB 5: SILENT PREVIEW */}
          <TabsContent value="preview" className="mt-0 space-y-6">
            <SilentPreview
              playlist={silentPreviewPlaylist}
              metadata={previewMetadata}
              onSavePreview={onSavePreview}
              onOpenMotion={() => setActiveTab("video")}
              isSaving={isSaving}
              isLoading={previewLoading}
              error={previewError}
            />
          </TabsContent>

          {/* TAB 6: ROUGH CUT */}
          <TabsContent value="roughcut" className="mt-0 space-y-6">
            {initialManifest && persistedManifestValidation.valid ? (
              <RoughCutPreview
                manifest={currentManifest}
                videoClips={videoClips}
                audioAssets={audioAssets}
                frameAssets={frameAssets}
                isDirty={isDirty}
                isSaving={isSaving}
                isApproving={isGateActionRunning || isStartingVisualProduction}
                isGeneratingFrames={isGeneratingFrames || isStartingVisualProduction}
                isPollingMotion={Boolean(activeVideoClip) || videoStartingScene !== null}
                isSynthesizingVoice={synthesisBusy}
                isGeneratingAmbience={ambienceBusy}
              />
            ) : (
              <div className="rounded-xl border border-amber-700/35 bg-amber-950/20 p-5 text-sm text-amber-100/85">
                Approve and save a valid screenplay before opening the browser rough cut.
              </div>
            )}
          </TabsContent>

          {/* TAB 7: SOUND TEST */}
          <TabsContent value="sound" className="mt-0 space-y-6">
            {initialManifest && persistedManifestValidation.valid && onLoadVoices && onGenerateVoiceTake && onDurationMeasured ? (
              <AudioTestPanel
                manifest={persistedManifestValidation.manifest || initialManifest}
                voiceAssignments={voiceAssignments}
                audioAssets={audioAssets}
                voices={voices}
                voiceLoading={voiceLoading}
                voiceError={voiceError}
                synthesisBusy={synthesisBusy}
                synthesisError={synthesisError}
                onLoadVoices={onLoadVoices}
                onGenerateVoiceTake={onGenerateVoiceTake}
                onDurationMeasured={onDurationMeasured}
                authAvailable={authAvailable}
                persistedProject={persistedProject}
                isDirty={isDirty}
                isCompetingOperation={isGateActionRunning || isGeneratingFrames || isSaving || ambienceBusy || Boolean(activeVideoClip)}
              />
            ) : (
              <div className="rounded-xl border border-amber-700/35 bg-amber-950/20 p-5 text-sm text-amber-100/85">
                Approve and save a valid screenplay before opening the voice-only sound proof.
              </div>
            )}

            {initialManifest && persistedManifestValidation.valid && (
              <SceneTimingProof
                manifest={currentManifest}
                videoClips={videoClips}
                audioAssets={audioAssets}
                frameAssets={frameAssets}
                isDirty={isDirty}
                isSaving={isSaving}
                isApproving={isGateActionRunning}
                isGeneratingFrames={isGeneratingFrames || isStartingVisualProduction}
                isPollingMotion={Boolean(activeVideoClip)}
                isSynthesizingVoice={synthesisBusy}
                isGeneratingAmbience={ambienceBusy}
              />
            )}
          </TabsContent>

          {/* TAB 8: LIP-SYNC PROOF */}
          <TabsContent value="lipsync" className="mt-0 space-y-6">
            {initialManifest && persistedManifestValidation.valid && (
              <DialogueCloseupProof
                projectId={projectId}
                manifest={persistedManifestValidation.manifest || initialManifest}
                frameAssets={frameAssets}
                dialogueShotClips={dialogueShotClips}
                audioAssets={audioAssets}
                lipsyncAssets={lipsyncAssets}
                isStartingLipsync={isStartingLipsync}
                lipsyncError={lipsyncError}
                onStartLipsync={onStartLipsync}
                onCheckLipsync={onCheckLipsync}
                authAvailable={authAvailable}
                persistedProject={persistedProject}
                isDirty={isDirty}
                isSaving={isSaving}
                isCompetingOperation={
                  isGateActionRunning ||
                  isStartingVisualProduction ||
                  isGeneratingFrames ||
                  isSaving ||
                  ambienceBusy ||
                  synthesisBusy ||
                  Boolean(activeVideoClip) ||
                  videoStartingScene !== null ||
                  isStartingLipsync ||
                  isStartingPixverseLipsync
                }
                pixverseLipsyncAssets={pixverseLipsyncAssets}
                isStartingPixverseLipsync={isStartingPixverseLipsync}
                pixverseLipsyncError={pixverseLipsyncError}
                onStartPixverseLipsync={onStartPixverseLipsync}
                onCheckPixverseLipsync={onCheckPixverseLipsync}
                onDialogueShotClipUpdate={onDialogueShotClipUpdate}
              />
            )}
            {initialManifest && persistedManifestValidation.valid ? (
              <LipSyncProof
                manifest={persistedManifestValidation.manifest || initialManifest}
                orientation={orientation}
                videoClips={videoClips}
                audioAssets={audioAssets}
                frameAssets={frameAssets}
                lipsyncAssets={lipsyncAssets}
                isDirty={isDirty}
                isSaving={isSaving}
                isApproving={isGateActionRunning || isStartingVisualProduction}
                isGeneratingFrames={isGeneratingFrames || isStartingVisualProduction}
                isPollingMotion={Boolean(activeVideoClip) || videoStartingScene !== null}
                isSynthesizingVoice={synthesisBusy}
                isGeneratingAmbience={ambienceBusy}
                authAvailable={authAvailable}
                persistedProject={persistedProject}
                isStartingLipsync={isStartingLipsync}
                lipsyncError={lipsyncError}
                onStartLipsync={onStartLipsync}
                onCheckLipsync={onCheckLipsync}
              />
            ) : (
              <div className="rounded-xl border border-amber-700/35 bg-amber-950/20 p-5 text-sm text-amber-100/85">
                Approve and save a valid screenplay before opening the one-shot lip-sync proof.
              </div>
            )}
          </TabsContent>

          {/* TAB 9: SHOT PLAN PROOF */}
          <TabsContent value="shot-plan" className="mt-0 space-y-6">
            {initialManifest && persistedManifestValidation.valid ? (
              <ShotPlanProof
                manifest={persistedManifestValidation.manifest || initialManifest}
                videoClips={videoClips}
                audioAssets={audioAssets}
                dialogueShotClips={dialogueShotClips}
                lipsyncAssets={lipsyncAssets}
                savedShotPlan={savedShotPlanSnapshot}
                shotPlanValidationError={shotPlanValidationError}
                isSavingShotPlan={isSavingShotPlan}
                shotPlanSaveError={shotPlanSaveError}
                onSaveShotPlan={onSaveShotPlan ? sharedOnSaveShotPlan : undefined}
                onShotPlanDirtyChange={onShotPlanDirtyChange}
                coverageRunState={coverageRunState}
                onRunSceneCoverage={onRunSceneCoverage}
                onCancelSceneCoverage={onCancelSceneCoverage}
              />
            ) : (
              <div className="rounded-xl border border-amber-700/35 bg-amber-950/20 p-5 text-sm text-amber-100/85">
                Approve and save a valid screenplay before opening the read-only shot plan proof.
              </div>
            )}
          </TabsContent>

          {/* TAB 10: FINAL SCENE ASSEMBLY */}
          <TabsContent value="scene-assembly" className="mt-0 space-y-6">
            {initialManifest && persistedManifestValidation.valid ? (
              <SceneAssemblyProof
                manifest={persistedManifestValidation.manifest || initialManifest}
                savedShotPlan={savedShotPlanSnapshot}
                projectTitle={initialTitle}
                videoClips={videoClips}
                audioAssets={audioAssets}
                dialogueShotClips={dialogueShotClips}
                lipsyncAssets={lipsyncAssets}
                assemblyAssets={assemblyAssets}
                onSaveAssemblyAsset={onSaveAssemblyAsset}
              />
            ) : (
              <div className="rounded-xl border border-amber-700/35 bg-amber-950/20 p-5 text-sm text-amber-100/85">
                Approve and save a valid screenplay before opening Final Scene Assembly. This pass saves one approved scene as WebM; episode-wide assembly and finishing layers remain later.
              </div>
            )}
          </TabsContent>

          {/* TAB 11: AMBIENCE */}
          <TabsContent value="ambience" className="mt-0 space-y-6">
            {initialManifest && persistedManifestValidation.valid ? (
              <SceneAmbiencePanel
                manifest={persistedManifestValidation.manifest || initialManifest}
                globalStyle={(persistedManifestValidation.manifest || initialManifest).global_style}
                ambienceAssets={ambienceAssets}
                ambienceBusy={ambienceBusy}
                ambienceError={ambienceError}
                onGenerateAmbience={onGenerateAmbience}
                authAvailable={authAvailable}
                persistedProject={persistedProject}
                isDirty={isDirty}
                isSaving={isSaving}
                isApproving={isGateActionRunning || isStartingVisualProduction}
                isGeneratingFrames={isGeneratingFrames || isStartingVisualProduction}
                isPollingMotion={Boolean(activeVideoClip) || videoStartingScene !== null}
                isSynthesizingVoice={synthesisBusy}
              />
            ) : (
              <div className="rounded-xl border border-amber-700/35 bg-amber-950/20 p-5 text-sm text-amber-100/85">
                Approve and save a valid screenplay before creating a one-scene ambience bed.
              </div>
            )}
          </TabsContent>

          {/* TAB 9: SCENE MIX PROOF */}
          <TabsContent value="mix" className="mt-0 space-y-6">
            {initialManifest && persistedManifestValidation.valid ? (
              <SceneMixProof
                manifest={persistedManifestValidation.manifest || initialManifest}
                videoClips={videoClips}
                audioAssets={audioAssets}
                ambienceAssets={ambienceAssets}
                frameAssets={frameAssets}
                dialogueShotClips={dialogueShotClips}
                lipsyncAssets={lipsyncAssets}
                isDirty={isDirty}
                isSaving={isSaving}
                isApproving={isGateActionRunning}
                isGeneratingFrames={isGeneratingFrames || isStartingVisualProduction}
                isPollingMotion={Boolean(activeVideoClip) || videoStartingScene !== null}
                isSynthesizingVoice={synthesisBusy}
                isGeneratingAmbience={ambienceBusy}
              />
            ) : (
              <div className="rounded-xl border border-amber-700/35 bg-amber-950/20 p-5 text-sm text-amber-100/85">
                Approve and save a valid screenplay before opening the scene mix proof.
              </div>
            )}
          </TabsContent>

          {/* TAB 10: EPISODE MIX PROOF */}
          <TabsContent value="episode-mix" className="mt-0 space-y-6">
            {initialManifest && persistedManifestValidation.valid ? (
              <EpisodeMixProof
                manifest={currentManifest}
                videoClips={videoClips}
                audioAssets={audioAssets}
                ambienceAssets={ambienceAssets}
                frameAssets={frameAssets}
                isDirty={isDirty}
                isSaving={isSaving}
                isApproving={isGateActionRunning || isStartingVisualProduction}
                isGeneratingFrames={isGeneratingFrames || isStartingVisualProduction}
                isPollingMotion={Boolean(activeVideoClip) || videoStartingScene !== null}
                isSynthesizingVoice={synthesisBusy}
                isGeneratingAmbience={ambienceBusy}
              />
            ) : (
              <div className="rounded-xl border border-amber-700/35 bg-amber-950/20 p-5 text-sm text-amber-100/85">
                Approve and save a valid screenplay before opening the episode mix proof.
              </div>
            )}
          </TabsContent>
            </>
          )}

          {/* TAB 9: MANIFEST SCHEMA (JSON) */}
          <TabsContent value="json" className="space-y-4 mt-0">
            <div className="flex items-center justify-between gap-2 p-3 rounded-xl bg-[#131824] border border-[#1f273b]">
              <div className="flex items-center gap-2 text-xs text-gray-300">
                <Code2 className="w-4 h-4 text-amber-400" />
                <span>Production Manifest JSON Schema (EpNova-compatible)</span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  onClick={handleCopyJson}
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs border-[#273248] bg-[#161d2d] text-gray-200 gap-1"
                >
                  {copiedJson ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-400" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3 text-amber-400" /> Copy JSON
                    </>
                  )}
                </Button>
                <Button
                  onClick={handleExportJson}
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs border-[#273248] bg-[#161d2d] text-gray-200 gap-1"
                >
                  <Download className="w-3 h-3 text-amber-400" /> Download .json
                </Button>
              </div>
            </div>

            <pre className="p-4 rounded-xl bg-[#090c12] border border-[#1c2333] text-xs font-mono text-amber-200/90 overflow-x-auto leading-relaxed max-h-[600px]">
              {JSON.stringify(currentManifest, null, 2)}
            </pre>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};
