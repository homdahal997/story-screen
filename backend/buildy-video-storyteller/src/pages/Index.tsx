import React, { useState, useEffect, useCallback, useRef } from "react";
import { superdevClient } from "@/lib/superdev/client";
import {
  DramaProjectRecord,
  DramaManifest,
  DialogueShotClip,
  VideoOrientation,
  FrameAsset,
  FrameProgress,
  VideoClip,
  VideoRemoteStatus,
  SilentPreviewMetadata,
  deriveSilentPreviewPlaylist,
  getActiveVideoClip,
  deriveVideoStatus,
  buildMotionPrompt,
  startMotionClip,
  getMotionClipStatus,
  archiveMotionClip,
  upsertVideoClip,
  updateVideoClip,
  fetchUserProjects,
  createDramaProjectRecord,
  updateDramaProjectRecord,
  deleteDramaProjectRecord,
  generateSetupProposal,
  generateDramaScript,
  normalizeOrientation,
  orientationLabel,
  generateRandomSeed,
  generateCharacterReferenceFrame,
  generateSceneStoryboardFrame,
  getExpectedFrameAssetCount,
  getFrameAssetKey,
  validateFrameAssets,
  validateManifest,
  deriveDialogueLines,
  findNewestReadyDialogueAudio,
  findNewestReadyDialogueCloseup,
  findNewestReadyLipsync,
  getLegacyDialogueLineId,
  STYLE_PRESETS,
  ElevenLabsVoice,
  VoiceAssignment,
  DialogueAudioAsset,
  AmbienceAudioAsset,
  LipsyncAsset,
  PixverseLipsyncAsset,
  LipsyncRemoteStatus,
  normalizeVoiceAssignments,
  normalizeDialogueAudioAssets,
  normalizeAmbienceAudioAssets,
  normalizeLipsyncAssets,
  upsertVoiceAssignment,
  replaceLatestDialogueAudioAsset,
  replaceLatestAmbienceAudioAsset,
  upsertLipsyncAsset,
  updateLipsyncAsset,
  normalizePixverseLipsyncAssets,
  upsertPixverseLipsyncAsset,
  updatePixverseLipsyncAsset,
  normalizeDialogueShotClips,
  upsertDialogueShotClip,
  SavedShotPlanSnapshot,
  FinalAssemblyAsset,
  normalizeFinalAssemblyAssets,
  validateSavedShotPlanAgainstCurrent,
  validateSavedMultiLineShotPlanAgainstCurrent,
} from "@/lib/dramaStudio";
import { normalizeSavedShotPlanSnapshot } from "@/lib/savedShotPlan";
import { runSceneCoverage } from "@/lib/sceneCoverageRunner";
import type { CoverageLineProgress, CoveragePhase } from "@/lib/sceneCoverageRunner";
import {
  createVoiceCoverageAdapter,
  createDialogueCloseupCoverageAdapter,
  createLipsyncCoverageAdapter,
} from "@/lib/sceneCoverageAdapters";
import type {
  SceneCoverageLine,
  SceneCoverageSnapshot,
  SceneCoveragePatch,
} from "@/lib/sceneCoverageAdapters";
import { elevenLabsSound, elevenLabsVoice, replicateLipsync, pixverseLipsync } from "@/functions";
import type { LipSyncStartInput, LipSyncStatusInput } from "@/components/LipSyncProof";
import type {
  PixverseLipsyncStartInput,
  PixverseLipsyncStatusInput,
} from "@/components/DialogueCloseupProof";
import { DramaEditor } from "@/components/DramaEditor";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Film,
  Plus,
  Sparkles,
  Search,
  Lock,
  RefreshCw,
  Clock,
  Layers,
  CheckCircle2,
  AlertTriangle,
  LogOut,
  LogIn,
  UserPlus,
  Trash2,
  ShieldCheck,
  Menu,
  X,
  Clapperboard,
  AlertCircle,
} from "lucide-react";

const LOGO_URL =
  "https://ellprnxjjzatijdxcogk.supabase.co/storage/v1/render/image/public/files/chat-generated-images/project-lhlakbkjvk1lfll8lxiz1/f3171572-7c58-4661-9cdc-4bd15a840caa.webp?width=600&resize=contain&quality=75";

const DRAFT_STORAGE_KEY = "frame_studio_composer_draft";
// Keep the creator's prompt below ElevenLabs' 450-character final request limit.
const MAX_AMBIENCE_USER_PROMPT_LENGTH = 330;
const MAX_AMBIENCE_PROVIDER_PROMPT_LENGTH = 450;

type VideoPollTarget = {
  projectId: string;
  sceneNumber: number;
  predictionId: string;
};

type LipsyncLineage = {
  sceneNumber: number;
  lineId: string;
  characterId: string;
  text: string;
  clipPredictionId: string;
  sourceVideoUrl: string;
  sourceAudioUrl: string;
};

type LipsyncTarget = LipsyncLineage & {
  projectId: string;
  predictionId: string | null;
  runId: number;
};

type PixverseLipsyncTarget = LipsyncLineage & {
  projectId: string;
  predictionId: string | null;
  runId: number;
  authEpoch: number;
};

type SceneCoverageRunState = {
  sceneNumber: number | null;
  status: "idle" | "running" | "complete" | "failed" | "canceled";
  progress: readonly CoverageLineProgress[];
  error: string | null;
};

function matchesLipsyncLineage(asset: LipsyncAsset, lineage: LipsyncLineage): boolean {
  return asset.scene_number === lineage.sceneNumber &&
    asset.line_id === lineage.lineId &&
    asset.character_id === lineage.characterId &&
    asset.text === lineage.text &&
    asset.source_clip_prediction_id === lineage.clipPredictionId &&
    asset.source_video_url === lineage.sourceVideoUrl &&
    asset.source_audio_url === lineage.sourceAudioUrl;
}

function matchesPixverseLipsyncLineage(asset: PixverseLipsyncAsset, lineage: LipsyncLineage): boolean {
  return asset.scene_number === lineage.sceneNumber &&
    asset.line_id === lineage.lineId &&
    asset.character_id === lineage.characterId &&
    asset.text === lineage.text &&
    asset.source_clip_prediction_id === lineage.clipPredictionId &&
    asset.source_video_url === lineage.sourceVideoUrl &&
    asset.source_audio_url === lineage.sourceAudioUrl;
}

function stalePreviewMetadata(metadata?: SilentPreviewMetadata | null): SilentPreviewMetadata | null | undefined {
  if (!metadata || metadata.status === "STALE") return metadata;
  return {
    ...metadata,
    status: "STALE",
    updated_at: new Date().toISOString(),
  };
}

function isManagedHttpsAudioUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    return new URL(value.trim()).protocol === "https:";
  } catch {
    return false;
  }
}

function isManagedHttpsVideoUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    return new URL(value.trim()).protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeLipsyncRemoteStatus(value: unknown, fallback: LipsyncRemoteStatus = "processing"): LipsyncRemoteStatus {
  const status = typeof value === "string" ? value.toLowerCase() : "";
  if (status === "starting" || status === "queued") return "starting";
  if (status === "processing" || status === "running") return "processing";
  if (status === "succeeded" || status === "completed") return "succeeded";
  if (status === "failed" || status === "error") return "failed";
  if (status === "canceled" || status === "cancelled") return "canceled";
  return fallback;
}

function normalizeLipsyncPredictionId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9_:-]{0,179}$/.test(trimmed) ? trimmed : null;
}

function normalizeLipsyncLineId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,179}$/.test(trimmed) ? trimmed : null;
}

function readableLipsyncError(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const message = raw.trim();
  const containsSecret = /api[_ -]?key|secret|bearer|authorization/i.test(message);
  const containsProviderUrl = /https?:\/\//i.test(message);
  if (!message || containsSecret || containsProviderUrl) return fallback;
  return message.slice(0, 600);
}

function normalizeLoadedVoices(raw: unknown): ElevenLabsVoice[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const normalized: ElevenLabsVoice[] = [];
  for (const value of raw) {
    if (!value || typeof value !== "object") continue;
    const source = value as Record<string, unknown>;
    const voiceId = typeof source.voice_id === "string" ? source.voice_id.trim() : "";
    const name = typeof source.name === "string" ? source.name.trim() : "";
    if (!voiceId || !/^[A-Za-z0-9_-]{1,180}$/.test(voiceId) || !name || seen.has(voiceId)) continue;
    const labels: Record<string, string> = {};
    if (source.labels && typeof source.labels === "object") {
      Object.entries(source.labels as Record<string, unknown>).forEach(([key, label]) => {
        if (typeof label === "string" && label.trim()) labels[key.slice(0, 80)] = label.trim().slice(0, 120);
      });
    }
    normalized.push({
      voice_id: voiceId,
      name: name.slice(0, 180),
      category: typeof source.category === "string" && source.category.trim() ? source.category.trim().slice(0, 120) : null,
      description: typeof source.description === "string" && source.description.trim() ? source.description.trim().slice(0, 500) : null,
      labels,
    });
    seen.add(voiceId);
  }
  return normalized;
}

export default function Index() {
  // Auth state
  const [isAuth, setIsAuth] = useState<boolean>(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [authChecking, setAuthChecking] = useState<boolean>(true);

  // Projects state
  const [projects, setProjects] = useState<DramaProjectRecord[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [loadingProjects, setLoadingProjects] = useState<boolean>(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Prompt composer state (New story)
  const [composerPrompt, setComposerPrompt] = useState<string>("");
  const [composerSceneCount, setComposerSceneCount] = useState<number>(4);
  const [composerOrientation, setComposerOrientation] = useState<VideoOrientation>("vertical");
  const [composerStyle, setComposerStyle] = useState<string>(STYLE_PRESETS[0].value);
  const [composerSeed, setComposerSeed] = useState<number>(() => generateRandomSeed());
  const [composerTitle, setComposerTitle] = useState<string>("");

  // Editor dirty state tracking
  const [isEditorDirty, setIsEditorDirty] = useState<boolean>(false);
  const [isShotPlanDirty, setIsShotPlanDirty] = useState<boolean>(false);
  const [isSavingShotPlan, setIsSavingShotPlan] = useState<boolean>(false);
  const [shotPlanSaveError, setShotPlanSaveError] = useState<string | null>(null);

  // Orchestration & Generation state
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [generatingProjectId, setGeneratingProjectId] = useState<string | null>(null);
  const [generationStep, setGenerationStep] = useState<number>(1);
  const [generationPhase, setGenerationPhase] = useState<"setup" | "script">("setup");
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isStartingVisualProduction, setIsStartingVisualProduction] = useState<boolean>(false);
  const [visualProductionHandoffProjectId, setVisualProductionHandoffProjectId] = useState<string | null>(null);

  // Hosted frame stage state
  const [isGeneratingFrames, setIsGeneratingFrames] = useState<boolean>(false);
  const [frameProgress, setFrameProgress] = useState<FrameProgress>({
    stage: "idle",
    current: 0,
    total: 0,
    completed: 0,
  });
  const [frameError, setFrameError] = useState<string | null>(null);

  // Single-shot motion stage state
  const [videoStartingScene, setVideoStartingScene] = useState<number | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);

  // Sound proof state. Voices load on demand, while each take remains project-scoped.
  const [voices, setVoices] = useState<ElevenLabsVoice[]>([]);
  const [voiceLoading, setVoiceLoading] = useState<boolean>(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [synthesisBusy, setSynthesisBusy] = useState<boolean>(false);
  const [synthesisError, setSynthesisError] = useState<string | null>(null);
  const [ambienceBusy, setAmbienceBusy] = useState<boolean>(false);
  const [ambienceError, setAmbienceError] = useState<string | null>(null);
  const [isStartingLipsync, setIsStartingLipsync] = useState<boolean>(false);
  const [lipsyncError, setLipsyncError] = useState<string | null>(null);
  const [isStartingPixverseLipsync, setIsStartingPixverseLipsync] = useState<boolean>(false);
  const [pixverseLipsyncError, setPixverseLipsyncError] = useState<string | null>(null);
  const [coverageRunState, setCoverageRunState] = useState<SceneCoverageRunState>({
    sceneNumber: null,
    status: "idle",
    progress: [],
    error: null,
  });

  // Mobile drawer state
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState<boolean>(false);

  // Lock refs to avoid race conditions
  const opLockRef = useRef<boolean>(false);
  const selectedProjectIdRef = useRef<string | null>(null);
  const projectsRef = useRef<DramaProjectRecord[]>([]);
  const shotPlanSaveLockRef = useRef<boolean>(false);
  const shotPlanDirtyRef = useRef<boolean>(false);
  const authSessionRef = useRef<{ authenticated: boolean; epoch: number }>({ authenticated: false, epoch: 0 });
  const videoStartLockRef = useRef<boolean>(false);
  const audioSynthesisLockRef = useRef<boolean>(false);
  const ambienceGenerationLockRef = useRef<boolean>(false);
  const visualProductionHandoffLockRef = useRef<boolean>(false);
  const lipsyncStartLockRef = useRef<boolean>(false);
  const lipsyncTargetRef = useRef<LipsyncTarget | null>(null);
  const lipsyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lipsyncInFlightRef = useRef<boolean>(false);
  const lipsyncRunRef = useRef<number>(0);
  const pixverseLipsyncStartLockRef = useRef<boolean>(false);
  const pixverseLipsyncTargetRef = useRef<PixverseLipsyncTarget | null>(null);
  const pixverseLipsyncInFlightRef = useRef<boolean>(false);
  const pixverseLipsyncRunRef = useRef<number>(0);
  const coverageRunRef = useRef<number>(0);
  const mountedRef = useRef<boolean>(true);
  const voiceCacheRef = useRef<ElevenLabsVoice[] | null>(null);
  const videoPollRef = useRef<{
    projectId: string;
    sceneNumber: number;
    predictionId: string;
  } | null>(null);
  const videoPollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoPollInFlightRef = useRef<boolean>(false);
  const videoPollRunRef = useRef<number>(0);
  const videoPollCallbackRef = useRef<((target: VideoPollTarget, runId: number) => Promise<void>) | null>(null);

  const markAuthSession = (authenticated: boolean) => {
    if (authSessionRef.current.authenticated === authenticated) return;
    authSessionRef.current = {
      authenticated,
      epoch: authSessionRef.current.epoch + 1,
    };
  };

  const handleShotPlanDirtyChange = useCallback((dirty: boolean) => {
    shotPlanDirtyRef.current = dirty;
    setIsShotPlanDirty(dirty);
  }, []);

  const resetShotPlanPersistenceState = () => {
    shotPlanDirtyRef.current = false;
    setIsShotPlanDirty(false);
    setShotPlanSaveError(null);
  };

  const invalidateSceneCoverageRun = useCallback(() => {
    coverageRunRef.current += 1;
  }, []);

  const handleCancelSceneCoverage = useCallback(() => {
    invalidateSceneCoverageRun();
    setCoverageRunState((current) =>
      current.status === "running"
        ? { ...current, status: "canceled", error: "Scene coverage canceled." }
        : current
    );
  }, [invalidateSceneCoverageRun]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      invalidateSceneCoverageRun();
    };
  }, [invalidateSceneCoverageRun]);

  useEffect(() => {
    selectedProjectIdRef.current = selectedProjectId;
  }, [selectedProjectId]);

  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  // Setup Auth links
  const currentPath = typeof window !== "undefined" ? encodeURIComponent(window.location.href) : "";
  const loginUrl = (superdevClient.auth.client.options.loginUrl + "&from_url=" + currentPath).replace("/api", "");
  const signupUrl = loginUrl.includes("app-login") ? loginUrl.replace("app-login", "app-signup") : loginUrl;

  // Restore composer draft from sessionStorage on initial load
  useEffect(() => {
    try {
      const savedDraft = sessionStorage.getItem(DRAFT_STORAGE_KEY);
      if (savedDraft) {
        const parsed = JSON.parse(savedDraft);
        if (parsed.prompt) setComposerPrompt(parsed.prompt);
        if (parsed.title) setComposerTitle(parsed.title);
        if (parsed.sceneCount) setComposerSceneCount(parsed.sceneCount);
        if (parsed.orientation) setComposerOrientation(normalizeOrientation(parsed.orientation));
        if (parsed.style) setComposerStyle(parsed.style);
        if (parsed.seed) setComposerSeed(parsed.seed);
      }
    } catch {
      // ignore storage parsing error
    }
  }, []);

  // Save composer draft to sessionStorage
  useEffect(() => {
    try {
      if (composerPrompt.trim()) {
        sessionStorage.setItem(
          DRAFT_STORAGE_KEY,
          JSON.stringify({
            prompt: composerPrompt,
            title: composerTitle,
            sceneCount: composerSceneCount,
            orientation: composerOrientation,
            style: composerStyle,
            seed: composerSeed,
          })
        );
      }
    } catch {
      // ignore storage error
    }
  }, [composerPrompt, composerTitle, composerSceneCount, composerOrientation, composerStyle, composerSeed]);

  const loadProjects = useCallback(async () => {
    setLoadingProjects(true);
    setLibraryError(null);
    try {
      const list = await fetchUserProjects();
      setProjects(list);
    } catch (err: any) {
      console.error("Failed to load user projects:", err);
      setLibraryError(err?.message || "Could not load saved projects from library.");
    } finally {
      setLoadingProjects(false);
    }
  }, []);

  // Initialize auth
  useEffect(() => {
    let mounted = true;
    setAuthChecking(true);

    superdevClient
      .isAuthenticated()
      .then(async (auth) => {
        if (!mounted) return;
        markAuthSession(auth);
        setIsAuth(auth);
        if (auth) {
          try {
            const me = await superdevClient.auth.me();
            if (mounted && me?.email) setUserEmail(me.email);
          } catch {
            // ignore me profile error
          }
          await loadProjects();
        } else {
          markAuthSession(false);
          invalidateSceneCoverageRun();
          stopLipsyncTracking();
    stopPixverseLipsyncTracking();
          setProjects([]);
          selectedProjectIdRef.current = null;
          setSelectedProjectId(null);
          resetShotPlanPersistenceState();
          setLoadingProjects(false);
        }
      })
      .catch((err) => {
        if (!mounted) return;
        console.error("Auth check failed:", err);
        markAuthSession(false);
        invalidateSceneCoverageRun();
        stopLipsyncTracking();
    stopPixverseLipsyncTracking();
        setIsAuth(false);
        setProjects([]);
        selectedProjectIdRef.current = null;
        setSelectedProjectId(null);
        resetShotPlanPersistenceState();
        setLoadingProjects(false);
      })
      .finally(() => {
        if (mounted) setAuthChecking(false);
      });

    return () => {
      mounted = false;
    };
  }, [loadProjects]);

  // Window beforeunload guard for unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isEditorDirty || isShotPlanDirty || isSavingShotPlan || shotPlanSaveLockRef.current || isGenerating || isGeneratingFrames || isSaving || isStartingVisualProduction || synthesisBusy || ambienceBusy || ambienceGenerationLockRef.current || videoStartingScene !== null || projects.some((project) => Boolean(getActiveVideoClip(project.video_clips || [])))) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [isEditorDirty, isShotPlanDirty, isSavingShotPlan, isGenerating, isGeneratingFrames, isSaving, isStartingVisualProduction, synthesisBusy, ambienceBusy, videoStartingScene, projects]);

  const selectedProject = projects.find((p) => p.id === selectedProjectId);
  const currentSilentPreview = deriveSilentPreviewPlaylist(
    selectedProject?.manifest || null,
    selectedProject?.frame_assets || [],
    selectedProject?.video_clips || []
  );

  const hasActiveVideoOperation = (): boolean =>
    videoStartLockRef.current ||
    projectsRef.current.some((project) => Boolean(getActiveVideoClip(project.video_clips || [])));

  // Safety check before discarding unsaved editor changes
  const confirmDiscardUnsavedChanges = (): boolean => {
    if (isGenerating || isGeneratingFrames || isSaving || isStartingVisualProduction || isSavingShotPlan || shotPlanSaveLockRef.current || audioSynthesisLockRef.current || ambienceGenerationLockRef.current) {
      alert(isSavingShotPlan || shotPlanSaveLockRef.current
        ? "The shot plan is being saved. Keep this browser tab open for a moment."
        : "Please wait for the current operation to finish.");
      return false;
    }
    if (videoStartLockRef.current) {
      alert("The motion prediction is being saved. Keep this browser tab open for a moment.");
      return false;
    }
    if (isShotPlanDirty && !window.confirm("You have an unsaved shot order. Discard local shot-plan changes?")) {
      return false;
    }
    if (isEditorDirty) {
      return window.confirm("You have unsaved changes in your screenplay. Discard unsaved edits?");
    }
    return true;
  };

  const stopVideoPolling = () => {
    videoPollRunRef.current += 1;
    if (videoPollTimerRef.current) {
      clearTimeout(videoPollTimerRef.current);
      videoPollTimerRef.current = null;
    }
    videoPollRef.current = null;
    videoPollInFlightRef.current = false;
  };

  const stopLipsyncTracking = () => {
    lipsyncRunRef.current += 1;
    if (lipsyncTimerRef.current) {
      clearTimeout(lipsyncTimerRef.current);
      lipsyncTimerRef.current = null;
    }
    lipsyncTargetRef.current = null;
    lipsyncInFlightRef.current = false;
    lipsyncStartLockRef.current = false;
    setIsStartingLipsync(false);
    setLipsyncError(null);
  };

  const stopPixverseLipsyncTracking = () => {
    pixverseLipsyncRunRef.current += 1;
    pixverseLipsyncTargetRef.current = null;
    pixverseLipsyncInFlightRef.current = false;
    pixverseLipsyncStartLockRef.current = false;
    setIsStartingPixverseLipsync(false);
    setPixverseLipsyncError(null);
  };

  const isCurrentLipsyncTarget = (projectId: string, predictionId: string | null, runId: number): boolean => {
    const current = lipsyncTargetRef.current;
    return Boolean(
      current &&
      current.projectId === projectId &&
      current.predictionId === predictionId &&
      current.runId === runId &&
      selectedProjectIdRef.current === projectId
    );
  };

  const isCurrentPixverseLipsyncTarget = (
    projectId: string,
    predictionId: string | null,
    runId: number,
    authEpoch: number
  ): boolean => {
    const current = pixverseLipsyncTargetRef.current;
    return Boolean(
      current &&
      current.projectId === projectId &&
      current.predictionId === predictionId &&
      current.runId === runId &&
      current.authEpoch === authEpoch &&
      authSessionRef.current.authenticated &&
      authSessionRef.current.epoch === authEpoch &&
      selectedProjectIdRef.current === projectId
    );
  };

  const isCurrentVideoPoll = (target: VideoPollTarget, runId: number): boolean => {
    const current = videoPollRef.current;
    return Boolean(
      current &&
      current.projectId === target.projectId &&
      current.sceneNumber === target.sceneNumber &&
      current.predictionId === target.predictionId &&
      videoPollRunRef.current === runId &&
      selectedProjectIdRef.current === target.projectId
    );
  };

  const readableVideoError = (error: unknown, fallback: string): string => {
    const raw = error instanceof Error ? error.message : "";
    const message = raw.trim();
    if (!message || /bearer|token|secret|authorization/i.test(message)) return fallback;
    return message.slice(0, 600);
  };

  const persistVideoState = async (
    projectId: string,
    clips: VideoClip[],
    status: DramaProjectRecord["video_status"],
    error: string | null,
    target?: VideoPollTarget,
    runId?: number,
    invalidatePreview = false
  ): Promise<boolean> => {
    if (selectedProjectIdRef.current !== projectId) return false;
    if (target && typeof runId === "number" && !isCurrentVideoPoll(target, runId)) return false;

    const currentProject = projectsRef.current.find((project) => project.id === projectId);
    const nextPreviewMetadata = invalidatePreview ? stalePreviewMetadata(currentProject?.preview_metadata) : undefined;
    const persistencePatch: Partial<DramaProjectRecord> = {
      video_status: status,
      video_clips: clips,
      video_error: error,
    };
    if (nextPreviewMetadata) persistencePatch.preview_metadata = nextPreviewMetadata;

    await updateDramaProjectRecord(projectId, persistencePatch);

    if (target && typeof runId === "number" && !isCurrentVideoPoll(target, runId)) return false;

    // Update the ref before React schedules the render. The first status check can
    // run immediately after this save and must already see the persisted prediction.
    const nextProjects = projectsRef.current.map((project) =>
      project.id === projectId
        ? {
            ...project,
            video_status: status,
            video_clips: clips,
            video_error: error,
            ...(nextPreviewMetadata ? { preview_metadata: nextPreviewMetadata } : {}),
          }
        : project
    );
    projectsRef.current = nextProjects;
    setProjects((prev) => {
      const next = prev.map((project) =>
        project.id === projectId
          ? {
              ...project,
              video_status: status,
              video_clips: clips,
              video_error: error,
              ...(nextPreviewMetadata ? { preview_metadata: nextPreviewMetadata } : {}),
            }
          : project
      );
      projectsRef.current = next;
      return next;
    });
    if (error) setVideoError(error);
    return true;
  };

  const scheduleVideoPoll = (target: VideoPollTarget, runId: number) => {
    if (!isCurrentVideoPoll(target, runId)) return;
    if (videoPollTimerRef.current) clearTimeout(videoPollTimerRef.current);
    videoPollTimerRef.current = setTimeout(() => {
      videoPollTimerRef.current = null;
      if (!isCurrentVideoPoll(target, runId)) return;
      void videoPollCallbackRef.current?.(target, runId);
    }, 4500);
  };

  const markVideoPollFailed = async (
    target: VideoPollTarget,
    runId: number,
    failure: string
  ) => {
    if (!isCurrentVideoPoll(target, runId)) return;
    const project = projectsRef.current.find((item) => item.id === target.projectId);
    const currentClip = project?.video_clips.find((clip) => clip.prediction_id === target.predictionId);
    if (!project || !currentClip) {
      stopVideoPolling();
      return;
    }

    const failedClips = updateVideoClip(project.video_clips, target.predictionId, {
      status: "FAILED",
      remote_status: currentClip.remote_status === "canceled" ? "canceled" : "failed",
      video_url: null,
      error: failure,
      updated_at: new Date().toISOString(),
    });
    try {
      await persistVideoState(
        target.projectId,
        failedClips,
        deriveVideoStatus(failedClips, "FAILED"),
        failure,
        target,
        runId
      );
    } catch (saveError) {
      console.error("Failed to persist motion failure:", saveError);
      setVideoError("The motion test stopped, but its failure note could not be saved. Refresh the project and retry the scene.");
    } finally {
      if (isCurrentVideoPoll(target, runId)) stopVideoPolling();
    }
  };

  const pollVideoTarget = async (target: VideoPollTarget, runId: number): Promise<void> => {
    if (!isCurrentVideoPoll(target, runId) || videoPollInFlightRef.current) return;
    videoPollInFlightRef.current = true;

    try {
      const response = await getMotionClipStatus({
        projectId: target.projectId,
        sceneNumber: target.sceneNumber,
        predictionId: target.predictionId,
      });
      if (!isCurrentVideoPoll(target, runId)) return;

      const project = projectsRef.current.find((item) => item.id === target.projectId);
      const currentClip = project?.video_clips.find((clip) => clip.prediction_id === target.predictionId);
      if (!project || !currentClip) {
        stopVideoPolling();
        return;
      }

      if (response.status === "QUEUED" || response.status === "PROCESSING") {
        const remoteStatus: VideoRemoteStatus = response.remote_status || (
          response.status === "QUEUED" ? "starting" : "processing"
        );
        const nextClips = updateVideoClip(project.video_clips, target.predictionId, {
          status: response.status,
          remote_status: remoteStatus,
          video_url: null,
          error: null,
          updated_at: new Date().toISOString(),
        });
        setVideoError(null);
        const saved = await persistVideoState(
          target.projectId,
          nextClips,
          response.status,
          null,
          target,
          runId
        );
        if (saved) scheduleVideoPoll(target, runId);
        return;
      }

      if (response.status === "SUCCEEDED") {
        const archived = await archiveMotionClip({
          projectId: target.projectId,
          sceneNumber: target.sceneNumber,
          predictionId: target.predictionId,
        });
        if (!isCurrentVideoPoll(target, runId)) return;
        const nextClips = updateVideoClip(project.video_clips, target.predictionId, {
          status: "READY",
          remote_status: "succeeded",
          video_url: archived.video_url,
          error: null,
          updated_at: new Date().toISOString(),
        });
        const saved = await persistVideoState(
          target.projectId,
          nextClips,
          "READY",
          null,
          target,
          runId
        );
        if (saved && isCurrentVideoPoll(target, runId)) stopVideoPolling();
        return;
      }

      await markVideoPollFailed(
        target,
        runId,
        response.error || "Luma could not finish this motion test. The saved storyboard is safe, so you can retry this scene."
      );
    } catch (error) {
      if (!isCurrentVideoPoll(target, runId)) return;
      await markVideoPollFailed(
        target,
        runId,
        readableVideoError(error, "The motion test could not be checked or archived. The saved storyboard is safe, so retry this scene.")
      );
    } finally {
      if (videoPollRunRef.current === runId) videoPollInFlightRef.current = false;
    }
  };

  videoPollCallbackRef.current = pollVideoTarget;

  const beginVideoPolling = (target: VideoPollTarget) => {
    if (videoPollTimerRef.current) {
      clearTimeout(videoPollTimerRef.current);
      videoPollTimerRef.current = null;
    }
    const runId = videoPollRunRef.current + 1;
    videoPollRunRef.current = runId;
    videoPollRef.current = target;
    videoPollInFlightRef.current = false;
    void videoPollCallbackRef.current?.(target, runId);
  };

  useEffect(() => {
    if (!isAuth || !selectedProjectId) return;
    const project = projectsRef.current.find((item) => item.id === selectedProjectId);
    const activeClip = project ? getActiveVideoClip(project.video_clips) : null;
    if (!project || !activeClip) return;

    const target: VideoPollTarget = {
      projectId: selectedProjectId,
      sceneNumber: activeClip.scene_number,
      predictionId: activeClip.prediction_id,
    };
    const currentTarget = videoPollRef.current;
    if (
      currentTarget &&
      currentTarget.projectId === target.projectId &&
      currentTarget.sceneNumber === target.sceneNumber &&
      currentTarget.predictionId === target.predictionId
    ) {
      return;
    }
    beginVideoPolling(target);

    return () => {
      if (videoPollRef.current?.projectId === selectedProjectId) stopVideoPolling();
    };
  }, [isAuth, selectedProjectId]);

  useEffect(() => () => {
    invalidateSceneCoverageRun();
    stopVideoPolling();
    stopLipsyncTracking();
    stopPixverseLipsyncTracking();
  }, [invalidateSceneCoverageRun]);

  // Handler: Start New Story composer
  const handleNewStory = () => {
    if (!confirmDiscardUnsavedChanges()) return;

    invalidateSceneCoverageRun();
    stopVideoPolling();
    stopLipsyncTracking();
    stopPixverseLipsyncTracking();
    setVideoError(null);
    setVoiceError(null);
    setSynthesisError(null);
    selectedProjectIdRef.current = null;
    setSelectedProjectId(null);
    setVisualProductionHandoffProjectId(null);
    setIsStartingVisualProduction(false);
    setIsEditorDirty(false);
    resetShotPlanPersistenceState();
    setComposerPrompt("");
    setComposerTitle("");
    setComposerSceneCount(4);
    setComposerOrientation("vertical");
    setComposerStyle(STYLE_PRESETS[0].value);
    setComposerSeed(generateRandomSeed());
    setGenerationError(null);
    setFrameError(null);
    setFrameProgress({ stage: "idle", current: 0, total: 0, completed: 0 });
    setMobileSidebarOpen(false);
    try {
      sessionStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch {
      // ignore
    }
  };

  // Keep a saved story intact while returning to the pitch controls.
  const handleBackToPitch = (project?: DramaProjectRecord) => {
    if (!confirmDiscardUnsavedChanges()) return;
    const activeProject = project || projectsRef.current.find((item) => item.id === selectedProjectIdRef.current);
    if (activeProject) {
      setComposerPrompt(activeProject.prompt || "");
      setComposerTitle(activeProject.title || "");
      setComposerSceneCount(activeProject.total_episodes || activeProject.scene_count || 4);
      setComposerOrientation(normalizeOrientation(activeProject.orientation));
      setComposerStyle(activeProject.art_style || activeProject.global_style || STYLE_PRESETS[0].value);
      setComposerSeed(activeProject.seed || generateRandomSeed());
    }
    invalidateSceneCoverageRun();
    stopVideoPolling();
    stopLipsyncTracking();
    stopPixverseLipsyncTracking();
    setVideoError(null);
    setVoiceError(null);
    setSynthesisError(null);
    selectedProjectIdRef.current = null;
    setSelectedProjectId(null);
    setVisualProductionHandoffProjectId(null);
    setIsStartingVisualProduction(false);
    setIsEditorDirty(false);
    resetShotPlanPersistenceState();
    setGenerationError(null);
    setFrameError(null);
    setFrameProgress({ stage: "idle", current: 0, total: 0, completed: 0 });
    setMobileSidebarOpen(false);
  };

  // Handler: Select an existing project
  const handleSelectProject = (project: DramaProjectRecord) => {
    if (selectedProjectId === project.id) {
      setMobileSidebarOpen(false);
      return;
    }
    if (!confirmDiscardUnsavedChanges()) return;

    invalidateSceneCoverageRun();
    stopVideoPolling();
    stopLipsyncTracking();
    stopPixverseLipsyncTracking();
    setVideoError(null);
    setVoiceError(null);
    setSynthesisError(null);
    setIsEditorDirty(false);
    resetShotPlanPersistenceState();
    setVisualProductionHandoffProjectId(null);
    setIsStartingVisualProduction(false);
    selectedProjectIdRef.current = project.id || null;
    setSelectedProjectId(project.id || null);
    setGenerationError(null);
    setFrameError(null);
    setFrameProgress({ stage: "idle", current: 0, total: 0, completed: 0 });
    setMobileSidebarOpen(false);
  };

  // Handler: Delete a project
  const handleDeleteProject = async (e: React.MouseEvent, project: DramaProjectRecord) => {
    e.stopPropagation();
    if (isGenerating || isGeneratingFrames || isSaving || isStartingVisualProduction || isSavingShotPlan || shotPlanSaveLockRef.current || hasActiveVideoOperation()) {
      alert("Cannot delete projects while an operation is in progress.");
      return;
    }
    if (!project.id) return;
    if (selectedProjectId === project.id && !confirmDiscardUnsavedChanges()) return;
    const confirm = window.confirm(`Are you sure you want to delete "${project.title}"?`);
    if (!confirm) return;

    if (videoPollRef.current?.projectId === project.id) stopVideoPolling();
    if (selectedProjectId === project.id) {
      invalidateSceneCoverageRun();
      stopLipsyncTracking();
    stopPixverseLipsyncTracking();
    }

    try {
      await deleteDramaProjectRecord(project.id);
      setProjects((prev) => prev.filter((p) => p.id !== project.id));
      if (selectedProjectId === project.id) {
        selectedProjectIdRef.current = null;
        setSelectedProjectId(null);
        setVisualProductionHandoffProjectId(null);
        setIsStartingVisualProduction(false);
        setIsEditorDirty(false);
        resetShotPlanPersistenceState();
      }
    } catch (err: any) {
      console.error("Failed to delete project:", err);
      alert(err?.message || "Could not delete project. Please try again.");
    }
  };

  // Handler: Save draft premise without running LLM
  const handleSaveDraft = async () => {
    if (opLockRef.current || isSaving || isGenerating || isGeneratingFrames || hasActiveVideoOperation()) return;

    if (!isAuth) {
      alert("Please sign in to save stories to your private library.");
      return;
    }

    if (!composerPrompt.trim()) {
      alert("Please enter a dramatic premise before saving a draft.");
      return;
    }

    const title = composerTitle.trim() || composerPrompt.trim().slice(0, 32) + "...";
    const projectUuid = crypto.randomUUID();

    try {
      opLockRef.current = true;
      setIsSaving(true);
      const newRecord = await createDramaProjectRecord({
        uuid: projectUuid,
        title,
        prompt: composerPrompt.trim(),
        orientation: composerOrientation,
        total_episodes: composerSceneCount,
        art_style: composerStyle,
        global_style: composerStyle,
        scene_count: composerSceneCount,
        synopsis: "",
        production_approved: false,
        status: "PENDING",
        seed: composerSeed,
        manifest: null,
      });

      setProjects((prev) => [newRecord, ...prev]);
      selectedProjectIdRef.current = newRecord.id || null;
      setSelectedProjectId(newRecord.id || null);
      resetShotPlanPersistenceState();
      try {
        sessionStorage.removeItem(DRAFT_STORAGE_KEY);
      } catch {
        // ignore
      }
      alert("Premise saved as a draft in your studio library.");
    } catch (err: any) {
      console.error("Failed to save draft:", err);
      alert(err?.message || "Failed to save draft. Please check your connection and try again.");
    } finally {
      setIsSaving(false);
      opLockRef.current = false;
    }
  };

  type ProjectPatch = Partial<Omit<DramaProjectRecord, "shot_plan">> & {
    shot_plan?: SavedShotPlanSnapshot | null;
  };

  const applyProjectPatch = (projectId: string, patch: ProjectPatch) => {
    const nextProjects = projectsRef.current.map((project) =>
      project.id === projectId ? ({ ...project, ...patch } as DramaProjectRecord) : project
    );
    projectsRef.current = nextProjects;
    setProjects(nextProjects);
  };

  const isCurrentSceneCoverageRun = (
    projectId: string,
    runId: number,
    authEpoch: number
  ): boolean => Boolean(
    mountedRef.current &&
    authSessionRef.current.authenticated &&
    authSessionRef.current.epoch === authEpoch &&
    selectedProjectIdRef.current === projectId &&
    coverageRunRef.current === runId
  );

  const getSceneCoverageSnapshot = (projectId: string): SceneCoverageSnapshot => {
    const project = projectsRef.current.find((item) => item.id === projectId);
    if (!project?.id) {
      throw new Error("The selected story is no longer available. Refresh the studio before running scene coverage.");
    }
    if (project.status !== "SCRIPTED" || !project.production_approved || !project.manifest) {
      throw new Error("Approve and save the screenplay before running scene coverage.");
    }

    const manifestValidation = validateManifest(project.manifest, project.scene_count);
    if (!manifestValidation.valid || !manifestValidation.manifest) {
      throw new Error(
        manifestValidation.error ||
          "The approved screenplay is no longer valid. Refresh the project and save the screenplay again."
      );
    }

    return {
      manifest: manifestValidation.manifest,
      scene_count: project.scene_count,
      frame_assets: project.frame_assets || [],
      voice_assignments: project.voice_assignments || [],
      audio_assets: project.audio_assets || [],
      dialogue_shot_clips: project.dialogue_shot_clips || [],
      lipsync_assets: project.lipsync_assets || [],
    };
  };

  const persistSceneCoveragePatch = async (
    projectId: string,
    runId: number,
    authEpoch: number,
    patch: SceneCoveragePatch
  ): Promise<void> => {
    if (!isCurrentSceneCoverageRun(projectId, runId, authEpoch)) {
      throw new Error("Scene coverage is no longer current. No late project update was applied.");
    }

    await updateDramaProjectRecord(projectId, patch as ProjectPatch);

    if (!isCurrentSceneCoverageRun(projectId, runId, authEpoch)) {
      throw new Error("Scene coverage changed while saving. The earlier saved media remains safe.");
    }

    if (isCurrentSceneCoverageRun(projectId, runId, authEpoch)) {
      applyProjectPatch(projectId, patch as ProjectPatch);
    }
  };

  const resolveSceneCoverageSourceFrame = (
    line: SceneCoverageLine,
    snapshot: SceneCoverageSnapshot
  ): { sourceFrameType: "character_reference" | "scene_storyboard"; sourceFrameUrl: string } | null => {
    const manifestValidation = validateManifest(snapshot.manifest, snapshot.scene_count);
    if (!manifestValidation.valid || !manifestValidation.manifest) {
      throw new Error(
        manifestValidation.error ||
          "The approved screenplay is no longer valid for dialogue close-up coverage."
      );
    }

    const frameValidation = validateFrameAssets(
      snapshot.frame_assets || [],
      manifestValidation.manifest
    );
    if (!frameValidation.valid || !frameValidation.assets) {
      throw new Error(
        frameValidation.error ||
          "Saved frame metadata needs to be repaired before close-up coverage can run."
      );
    }

    const isSecureImageUrl = (value: unknown): value is string => {
      if (typeof value !== "string" || !value.trim()) return false;
      try {
        return new URL(value.trim()).protocol === "https:";
      } catch {
        return false;
      }
    };

    const characterReference = frameValidation.assets.find(
      (asset) =>
        asset.asset_type === "character_reference" &&
        asset.character_id === line.characterId &&
        isSecureImageUrl(asset.image_url)
    );
    if (characterReference) {
      return {
        sourceFrameType: "character_reference",
        sourceFrameUrl: characterReference.image_url.trim(),
      };
    }

    const storyboard = frameValidation.assets.find(
      (asset) =>
        asset.asset_type === "scene_storyboard" &&
        asset.scene_number === line.sceneNumber &&
        isSecureImageUrl(asset.image_url)
    );
    if (storyboard) {
      return {
        sourceFrameType: "scene_storyboard",
        sourceFrameUrl: storyboard.image_url.trim(),
      };
    }

    return null;
  };

  const handleRunSceneCoverage = async (sceneNumber: number): Promise<boolean> => {
    const reject = (message: string): boolean => {
      const normalizedSceneNumber = Number.isInteger(sceneNumber) ? sceneNumber : null;
      setCoverageRunState((current) =>
        current.status === "running"
          ? current
          : {
              sceneNumber: normalizedSceneNumber,
              status: "failed",
              progress:
                current.sceneNumber === normalizedSceneNumber
                  ? current.progress
                  : [],
              error: message,
            }
      );
      return false;
    };

    if (coverageRunState.status === "running") return false;

    if (
      opLockRef.current ||
      isGenerating ||
      isGeneratingFrames ||
      isSaving ||
      isStartingVisualProduction ||
      visualProductionHandoffLockRef.current ||
      voiceLoading ||
      synthesisBusy ||
      audioSynthesisLockRef.current ||
      ambienceBusy ||
      ambienceGenerationLockRef.current ||
      videoStartingScene !== null ||
      hasActiveVideoOperation() ||
      isStartingLipsync ||
      lipsyncInFlightRef.current ||
      lipsyncStartLockRef.current ||
      isStartingPixverseLipsync ||
      pixverseLipsyncInFlightRef.current ||
      pixverseLipsyncStartLockRef.current ||
      isSavingShotPlan ||
      shotPlanSaveLockRef.current
    ) {
      return reject("Wait for the current studio operation to finish before starting scene coverage.");
    }

    if (!isAuth || !authSessionRef.current.authenticated) {
      return reject("Sign in before running private scene coverage.");
    }
    if (isEditorDirty) {
      return reject("Save screenplay edits before running coverage from the approved dialogue lines.");
    }

    const projectId = selectedProjectIdRef.current;
    if (!projectId) {
      return reject("Select a saved story before running scene coverage.");
    }

    const project = projectsRef.current.find((item) => item.id === projectId);
    if (!project?.id) {
      return reject("The selected story is no longer available. Refresh the studio and try again.");
    }
    if (project.status !== "SCRIPTED" || !project.production_approved) {
      return reject("Approve and save the screenplay before running scene coverage.");
    }
    if (!project.manifest) {
      return reject("The approved screenplay is missing. Refresh the project and save it before running coverage.");
    }

    const manifestValidation = validateManifest(project.manifest, project.scene_count);
    if (!manifestValidation.valid || !manifestValidation.manifest) {
      return reject(
        manifestValidation.error ||
          "The approved screenplay is no longer valid. Refresh the project and save the screenplay again."
      );
    }

    if (!Number.isInteger(sceneNumber) || sceneNumber < 1) {
      return reject("Choose a valid saved scene before running coverage.");
    }

    const manifest = manifestValidation.manifest;
    const scene = manifest.scenes.find((candidate) => candidate.scene_number === sceneNumber);
    if (!scene) {
      return reject(`Scene ${sceneNumber} is not in the approved screenplay. Refresh the project and try again.`);
    }

    const dialogueLines = deriveDialogueLines(scene);
    if (
      !Array.isArray(scene.dialogue_lines) ||
      scene.dialogue_lines.length !== dialogueLines.length ||
      (dialogueLines.length !== 2 && dialogueLines.length !== 3)
    ) {
      return reject(
        `Scene ${sceneNumber} needs exactly two or three saved speaker lines before automatic coverage can run.`
      );
    }

    const coverageLines: SceneCoverageLine[] = dialogueLines.map((line) => ({
      sceneNumber,
      lineId: line.line_id,
      characterId: line.character_id,
      text: line.text,
      order: line.order,
    }));
    const runId = coverageRunRef.current + 1;
    coverageRunRef.current = runId;
    const authEpoch = authSessionRef.current.epoch;
    const isCurrent = () =>
      isCurrentSceneCoverageRun(projectId, runId, authEpoch);

    setCoverageRunState({
      sceneNumber,
      status: "running",
      progress: [],
      error: null,
    });
    opLockRef.current = true;

    type SceneCoverageAssets = {
      voice: DialogueAudioAsset;
      closeup: DialogueShotClip;
      lipsync: LipsyncAsset;
    };

    const getAccountVoices = async (): Promise<readonly ElevenLabsVoice[]> => {
      const cachedVoices = voiceCacheRef.current;
      if (cachedVoices && cachedVoices.length > 0) return cachedVoices;
      if (!isCurrent()) {
        throw new Error("Scene coverage is no longer current.");
      }

      const response = await elevenLabsVoice({ operation: "list_voices" });
      if (!isCurrent()) {
        throw new Error("Scene coverage is no longer current.");
      }
      if (response.error) throw new Error(response.error);

      const loadedVoices = normalizeLoadedVoices(response.voices);
      if (!loadedVoices.length) {
        throw new Error(
          "No account voices were returned. Load the private ElevenLabs voice library and retry."
        );
      }
      if (!isCurrent()) {
        throw new Error("Scene coverage is no longer current.");
      }

      voiceCacheRef.current = loadedVoices;
      setVoices(loadedVoices);
      return loadedVoices;
    };

    const sharedDependencies = {
      projectId,
      getSnapshot: () => getSceneCoverageSnapshot(projectId),
      persistPatch: (patch: SceneCoveragePatch) =>
        persistSceneCoveragePatch(projectId, runId, authEpoch, patch),
      isCurrent,
    };

    const voiceAdapter = createVoiceCoverageAdapter({
      ...sharedDependencies,
      getAccountVoices,
    });
    const closeupAdapter = createDialogueCloseupCoverageAdapter({
      ...sharedDependencies,
      resolveSourceFrame: resolveSceneCoverageSourceFrame,
    });
    const lipsyncAdapter = createLipsyncCoverageAdapter({
      ...sharedDependencies,
      provider: "pixverse-lipsync",
    });

    const resolveCurrentAsset = async <TPhase extends CoveragePhase>(
      line: SceneCoverageLine,
      phase: TPhase
    ): Promise<SceneCoverageAssets[TPhase] | null> => {
      const snapshot = getSceneCoverageSnapshot(projectId);
      const currentManifest = snapshot.manifest;
      if (!currentManifest) {
        throw new Error("The approved screenplay is unavailable for the current coverage line.");
      }
      const currentScene = currentManifest.scenes.find(
        (candidate) => candidate.scene_number === line.sceneNumber
      );
      if (!currentScene) {
        throw new Error(`Scene ${line.sceneNumber} is no longer in the approved screenplay.`);
      }
      const canonicalLine = deriveDialogueLines(currentScene).find(
        (candidate) =>
          candidate.line_id === line.lineId &&
          candidate.character_id === line.characterId &&
          candidate.text === line.text &&
          candidate.order === line.order
      );
      if (!canonicalLine) {
        throw new Error(
          "A saved dialogue line changed while coverage was running. Refresh the project and retry this scene."
        );
      }

      const audioAssets = normalizeDialogueAudioAssets(
        snapshot.audio_assets || [],
        currentManifest
      );
      const closeupAssets = normalizeDialogueShotClips(
        snapshot.dialogue_shot_clips || [],
        currentManifest
      );
      const lipsyncAssets = normalizeLipsyncAssets(
        snapshot.lipsync_assets || [],
        currentManifest
      );

      if (phase === "voice") {
        return findNewestReadyDialogueAudio(
          currentManifest,
          line.sceneNumber,
          canonicalLine,
          audioAssets
        ) as SceneCoverageAssets[TPhase] | null;
      }

      const currentAudio = findNewestReadyDialogueAudio(
        currentManifest,
        line.sceneNumber,
        canonicalLine,
        audioAssets
      );
      const currentCloseup = findNewestReadyDialogueCloseup(
        line.sceneNumber,
        canonicalLine,
        closeupAssets
      );
      if (phase === "closeup") {
        return currentCloseup as SceneCoverageAssets[TPhase] | null;
      }
      if (!currentAudio || !currentCloseup) return null;

      return findNewestReadyLipsync(
        line.sceneNumber,
        canonicalLine,
        currentCloseup,
        currentAudio,
        lipsyncAssets
      ) as SceneCoverageAssets[TPhase] | null;
    };

    const ensureAsset = async <TPhase extends CoveragePhase>(
      line: SceneCoverageLine,
      phase: TPhase,
      currentAsset: SceneCoverageAssets[TPhase] | null
    ): Promise<SceneCoverageAssets[TPhase]> => {
      if (phase === "voice") {
        return (await voiceAdapter.ensureVoiceAsset(
          line,
          currentAsset as DialogueAudioAsset | null
        )) as SceneCoverageAssets[TPhase];
      }
      if (phase === "closeup") {
        return (await closeupAdapter.ensureCloseupAsset(
          line,
          currentAsset as DialogueShotClip | null
        )) as SceneCoverageAssets[TPhase];
      }

      const snapshot = getSceneCoverageSnapshot(projectId);
      const currentManifest = snapshot.manifest;
      if (!currentManifest) {
        throw new Error("The approved screenplay is unavailable for lip-sync coverage.");
      }
      const currentScene = currentManifest.scenes.find(
        (candidate) => candidate.scene_number === line.sceneNumber
      );
      const canonicalLine = currentScene
        ? deriveDialogueLines(currentScene).find(
            (candidate) =>
              candidate.line_id === line.lineId &&
              candidate.character_id === line.characterId &&
              candidate.text === line.text &&
              candidate.order === line.order
          )
        : null;
      if (!currentScene || !canonicalLine) {
        throw new Error(
          "A saved dialogue line changed before lip-sync coverage could start. Refresh the project and retry this scene."
        );
      }

      const audioAssets = normalizeDialogueAudioAssets(
        snapshot.audio_assets || [],
        currentManifest
      );
      const closeupAssets = normalizeDialogueShotClips(
        snapshot.dialogue_shot_clips || [],
        currentManifest
      );
      const currentAudio = findNewestReadyDialogueAudio(
        currentManifest,
        line.sceneNumber,
        canonicalLine,
        audioAssets
      );
      const currentCloseup = findNewestReadyDialogueCloseup(
        line.sceneNumber,
        canonicalLine,
        closeupAssets
      );
      if (!currentAudio || !currentCloseup) {
        throw new Error(
          "This line needs a current READY dialogue take and five-second close-up before lip-sync coverage can run."
        );
      }

      return (await lipsyncAdapter.ensureLipsyncAsset(
        line,
        currentAudio,
        currentCloseup
      )) as SceneCoverageAssets[TPhase];
    };

    try {
      const result = await runSceneCoverage<SceneCoverageLine, SceneCoverageAssets>(
        coverageLines,
        {
          getLineIdentity: (line) => ({
            sceneNumber: line.sceneNumber,
            lineId: line.lineId,
            order: line.order as number,
            characterId: line.characterId,
          }),
          resolveCurrentAsset,
          ensureAsset,
          isCurrent,
          onProgress: (progress) => {
            if (!isCurrent()) return;
            setCoverageRunState((current) =>
              isCurrent()
                ? {
                    ...current,
                    sceneNumber,
                    status: "running",
                    progress,
                    error: null,
                  }
                : current
            );
          },
        }
      );

      if (isCurrent()) {
        setCoverageRunState((current) =>
          isCurrent()
            ? {
                ...current,
                sceneNumber,
                status: result.status,
                progress: result.progress,
                error: result.error || null,
              }
            : current
        );
      }
      return result.status === "complete" && isCurrent();
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim()
          ? error.message.trim()
          : "Scene coverage stopped before every saved line completed.";
      if (isCurrent()) {
        setCoverageRunState((current) =>
          isCurrent()
            ? {
                ...current,
                sceneNumber,
                status: "failed",
                error: message,
              }
            : current
        );
      }
      return false;
    } finally {
      opLockRef.current = false;
    }
  };

  const handleDialogueShotClipUpdate = async (
    projectId: string,
    clip: DialogueShotClip
  ): Promise<boolean> => {
    const currentProject = projectsRef.current.find((project) => project.id === projectId);
    if (!currentProject) {
      throw new Error("The saved project is no longer available. No close-up record was changed.");
    }
    if (!currentProject.manifest) {
      throw new Error("The approved screenplay is unavailable. No close-up record was changed.");
    }

    const manifestValidation = validateManifest(currentProject.manifest, currentProject.scene_count);
    if (!manifestValidation.valid || !manifestValidation.manifest) {
      throw new Error("The saved screenplay is no longer valid. No close-up record was changed.");
    }

    const safeManifest = manifestValidation.manifest;
    const incomingClip = normalizeDialogueShotClips([clip], safeManifest)[0];
    if (!incomingClip) {
      throw new Error("The close-up service returned invalid saved metadata. No close-up record was changed.");
    }

    const currentClips = normalizeDialogueShotClips(currentProject.dialogue_shot_clips || [], safeManifest);
    const nextClips = upsertDialogueShotClip(currentClips, incomingClip);
    await updateDramaProjectRecord(projectId, { dialogue_shot_clips: nextClips });
    applyProjectPatch(projectId, { dialogue_shot_clips: nextClips });
    return true;
  };

  const requestSetupProposal = async (project: DramaProjectRecord) => {
    if (!project.id) throw new Error("This story is missing its saved project id.");
    const nextPreviewMetadata = stalePreviewMetadata(project.preview_metadata);
    const proposal = await generateSetupProposal({
      prompt: project.prompt,
      sceneCount: project.total_episodes || project.scene_count || 4,
      globalStyle: project.art_style || project.global_style || STYLE_PRESETS[0].value,
      orientation: project.orientation,
      seed: project.seed,
    });
    await updateDramaProjectRecord(project.id, {
      title: proposal.title,
      synopsis: proposal.synopsis,
      orientation: project.orientation,
      total_episodes: project.total_episodes || project.scene_count || 4,
      art_style: project.art_style || project.global_style || STYLE_PRESETS[0].value,
      status: "AWAITING_SETUP_CONFIRM",
      production_approved: false,
      production_approved_at: null,
      last_error: null,
      manifest: null,
      frame_status: "NOT_STARTED",
      frame_assets: [],
      frame_error: null,
      video_status: "NOT_STARTED",
      video_clips: [],
      video_error: null,
      ...(nextPreviewMetadata ? { preview_metadata: nextPreviewMetadata } : {}),
    });
    applyProjectPatch(project.id, {
      title: proposal.title,
      synopsis: proposal.synopsis,
      status: "AWAITING_SETUP_CONFIRM",
      production_approved: false,
      production_approved_at: null,
      last_error: null,
      manifest: null,
      frame_status: "NOT_STARTED",
      frame_assets: [],
      frame_error: null,
      video_status: "NOT_STARTED",
      video_clips: [],
      video_error: null,
      ...(nextPreviewMetadata ? { preview_metadata: nextPreviewMetadata } : {}),
    });
    return proposal;
  };

  const generateScriptForProject = async (project: DramaProjectRecord) => {
    if (!project.id) throw new Error("This story is missing its saved project id.");
    if (!project.prompt.trim()) throw new Error("The original story idea is missing. Return to the pitch and add it again.");
    const targetSceneCount = project.total_episodes || project.scene_count || 4;
    const nextPreviewMetadata = stalePreviewMetadata(project.preview_metadata);
    const projectStyle = project.art_style || project.global_style || STYLE_PRESETS[0].value;
    setGenerationStep(2);
    const manifest = await generateDramaScript({
      prompt: project.prompt,
      synopsis: project.synopsis,
      sceneCount: targetSceneCount,
      globalStyle: projectStyle,
      orientation: project.orientation,
      seed: project.seed,
    });
    setGenerationStep(3);
    const nextPatch: Partial<DramaProjectRecord> = {
      title: project.title.trim() || manifest.project_title,
      global_style: manifest.global_style || projectStyle,
      art_style: project.art_style || projectStyle,
      orientation: project.orientation,
      total_episodes: targetSceneCount,
      scene_count: targetSceneCount,
      status: "AWAITING_SCRIPT_CONFIRM",
      production_approved: false,
      production_approved_at: null,
      manifest,
      last_error: null,
      frame_status: "NOT_STARTED",
      frame_assets: [],
      frame_error: null,
      video_status: "NOT_STARTED",
      video_clips: [],
      video_error: null,
      ...(nextPreviewMetadata ? { preview_metadata: nextPreviewMetadata } : {}),
    };
    setGenerationStep(4);
    await updateDramaProjectRecord(project.id, nextPatch);
    applyProjectPatch(project.id, nextPatch);
    try {
      sessionStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch {
      // ignore storage errors
    }
  };

  // Handler: Create a saved pitch, then stop at setup review.
  const handleCreateStorySetup = async () => {
    if (opLockRef.current || isGenerating || isGeneratingFrames || isSaving || hasActiveVideoOperation()) return;
    if (!isAuth) {
      alert("Please sign in or create an account to save your story setup.");
      return;
    }
    if (!composerPrompt.trim()) {
      setGenerationError("Write a story idea before creating the setup.");
      return;
    }

    const promptText = composerPrompt.trim();
    const lockedSeed = composerSeed;
    const targetSceneCount = composerSceneCount;
    const chosenStyle = composerStyle;
    const chosenOrientation = normalizeOrientation(composerOrientation);
    let persistedRecordId: string | null = null;

    setGenerationError(null);
    setGenerationPhase("setup");
    opLockRef.current = true;
    setIsGenerating(true);
    setGeneratingProjectId(null);
    setGenerationStep(1);

    try {
      const createdRecord = await createDramaProjectRecord({
        uuid: crypto.randomUUID(),
        title: composerTitle.trim() || "Untitled Story Setup",
        prompt: promptText,
        orientation: chosenOrientation,
        total_episodes: targetSceneCount,
        art_style: chosenStyle,
        global_style: chosenStyle,
        scene_count: targetSceneCount,
        synopsis: "",
        production_approved: false,
        status: "PENDING",
        seed: lockedSeed,
        manifest: null,
      });
      if (!createdRecord.id) throw new Error("Could not initialize the private story record.");
      persistedRecordId = createdRecord.id;
      setGeneratingProjectId(createdRecord.id);
      projectsRef.current = [createdRecord, ...projectsRef.current];
      setProjects(projectsRef.current);
      selectedProjectIdRef.current = createdRecord.id;
      setSelectedProjectId(createdRecord.id);
      resetShotPlanPersistenceState();
      setGenerationStep(2);
      await requestSetupProposal(createdRecord);
      try {
        sessionStorage.removeItem(DRAFT_STORAGE_KEY);
      } catch {
        // ignore storage errors
      }
    } catch (err: any) {
      console.error("Story setup generation failed:", err);
      const errorMsg = err?.message || "The story setup could not be created. Keep your pitch and try again.";
      setGenerationError(errorMsg);
      if (persistedRecordId) {
        try {
          await updateDramaProjectRecord(persistedRecordId, { status: "FAILED", last_error: errorMsg });
          applyProjectPatch(persistedRecordId, { status: "FAILED", last_error: errorMsg });
        } catch (updateErr) {
          console.error("Failed to record setup failure:", updateErr);
        }
      }
    } finally {
      setIsGenerating(false);
      setGeneratingProjectId(null);
      opLockRef.current = false;
    }
  };

  const handleSaveSetup = async (title: string, synopsis: string) => {
    if (opLockRef.current || isGeneratingFrames || isSaving || hasActiveVideoOperation()) return;
    const project = projectsRef.current.find((item) => item.id === selectedProjectIdRef.current);
    if (!project?.id) throw new Error("Select a saved story setup before saving edits.");
    if (!title.trim() || synopsis.trim().length < 80) {
      throw new Error("Add a clear title and a detailed synopsis before saving this setup.");
    }
    opLockRef.current = true;
    setIsSaving(true);
    try {
      const patch: Partial<DramaProjectRecord> = {
        title: title.trim(),
        synopsis: synopsis.trim(),
        status: "AWAITING_SETUP_CONFIRM",
        production_approved: false,
        production_approved_at: null,
        last_error: null,
      };
      await updateDramaProjectRecord(project.id, patch);
      applyProjectPatch(project.id, patch);
    } finally {
      setIsSaving(false);
      opLockRef.current = false;
    }
  };

  const handleRegenerateSetup = async (project?: DramaProjectRecord) => {
    const activeProject = project || projectsRef.current.find((item) => item.id === selectedProjectIdRef.current);
    if (opLockRef.current || isGenerating || isGeneratingFrames || isSaving || hasActiveVideoOperation()) return;
    if (!isAuth) {
      setGenerationError("Sign in before regenerating a private story setup.");
      return;
    }
    if (!activeProject?.id) {
      setGenerationError("Select a saved story before regenerating its setup.");
      return;
    }
    setGenerationError(null);
    setGenerationPhase("setup");
    opLockRef.current = true;
    setIsGenerating(true);
    setGeneratingProjectId(activeProject.id);
    setGenerationStep(2);
    try {
      await requestSetupProposal(activeProject);
    } catch (err: any) {
      const errorMsg = err?.message || "The setup could not be regenerated. Your previous checkpoint remains saved.";
      setGenerationError(errorMsg);
      const hasSetupCheckpoint =
        activeProject.status === "AWAITING_SETUP_CONFIRM" &&
        Boolean(activeProject.title?.trim() && activeProject.synopsis?.trim());
      const recoveryStatus = hasSetupCheckpoint ? "AWAITING_SETUP_CONFIRM" : "FAILED";
      try {
        await updateDramaProjectRecord(activeProject.id, { status: recoveryStatus, last_error: errorMsg });
        applyProjectPatch(activeProject.id, { status: recoveryStatus, last_error: errorMsg });
      } catch (updateErr) {
        console.error("Failed to record setup regeneration failure:", updateErr);
      }
    } finally {
      setIsGenerating(false);
      setGeneratingProjectId(null);
      opLockRef.current = false;
    }
  };

  const handleConfirmSetup = async (title: string, synopsis: string) => {
    if (opLockRef.current || isGenerating || isGeneratingFrames || isSaving || hasActiveVideoOperation()) return;
    const current = projectsRef.current.find((item) => item.id === selectedProjectIdRef.current);
    if (!current?.id) {
      setGenerationError("Save this story setup before generating its screenplay.");
      return;
    }
    if (!title.trim() || synopsis.trim().length < 80) {
      setGenerationError("Review the title and synopsis before generating the screenplay.");
      return;
    }
    opLockRef.current = true;
    setIsGenerating(true);
    setGenerationPhase("script");
    setGeneratingProjectId(current.id);
    setGenerationError(null);
    setGenerationStep(1);
    try {
      const approvedSetup: Partial<DramaProjectRecord> = {
        title: title.trim(),
        synopsis: synopsis.trim(),
        status: "AWAITING_SETUP_CONFIRM",
        production_approved: false,
        production_approved_at: null,
        last_error: null,
      };
      await updateDramaProjectRecord(current.id, approvedSetup);
      applyProjectPatch(current.id, approvedSetup);
      await generateScriptForProject({ ...current, ...approvedSetup });
    } catch (err: any) {
      console.error("Screenplay generation failed:", err);
      const errorMsg = err?.message || "The screenplay could not be generated. Your approved setup is still saved.";
      setGenerationError(errorMsg);
      const hasScriptCheckpoint = Boolean(current.manifest);
      const hasSetupCheckpoint = Boolean(current.synopsis?.trim());
      const recoveryStatus = hasScriptCheckpoint
        ? "AWAITING_SCRIPT_CONFIRM"
        : hasSetupCheckpoint
          ? "AWAITING_SETUP_CONFIRM"
          : "FAILED";
      try {
        await updateDramaProjectRecord(current.id, { status: recoveryStatus, last_error: errorMsg });
        applyProjectPatch(current.id, { status: recoveryStatus, last_error: errorMsg });
      } catch (updateErr) {
        console.error("Failed to record screenplay failure:", updateErr);
      }
    } finally {
      setIsGenerating(false);
      setGeneratingProjectId(null);
      opLockRef.current = false;
    }
  };

  const handleRegenerateScript = async (project?: DramaProjectRecord) => {
    const activeProject = project || projectsRef.current.find((item) => item.id === selectedProjectIdRef.current);
    if (opLockRef.current || isGenerating || isGeneratingFrames || isSaving || hasActiveVideoOperation()) return;
    if (!isAuth || !activeProject?.id) {
      setGenerationError("Sign in and select a saved story before regenerating its screenplay.");
      return;
    }
    setGenerationError(null);
    setGenerationPhase("script");
    opLockRef.current = true;
    setIsGenerating(true);
    setGeneratingProjectId(activeProject.id);
    setGenerationStep(1);
    try {
      await generateScriptForProject(activeProject);
    } catch (err: any) {
      const errorMsg = err?.message || "The screenplay could not be regenerated. Your approved setup remains saved.";
      setGenerationError(errorMsg);
      const hasScriptCheckpoint = Boolean(activeProject.manifest);
      const hasSetupCheckpoint = Boolean(activeProject.synopsis?.trim());
      const recoveryStatus = hasScriptCheckpoint
        ? "AWAITING_SCRIPT_CONFIRM"
        : hasSetupCheckpoint
          ? "AWAITING_SETUP_CONFIRM"
          : "FAILED";
      try {
        await updateDramaProjectRecord(activeProject.id, { status: recoveryStatus, last_error: errorMsg });
        applyProjectPatch(activeProject.id, { status: recoveryStatus, last_error: errorMsg });
      } catch (updateErr) {
        console.error("Failed to record screenplay regeneration failure:", updateErr);
      }
    } finally {
      setIsGenerating(false);
      setGeneratingProjectId(null);
      opLockRef.current = false;
    }
  };

  const handleApproveProduction = async (manifest: DramaManifest, title: string) => {
    if (visualProductionHandoffLockRef.current) return;
    if (opLockRef.current || isGenerating || isGeneratingFrames || isSaving || hasActiveVideoOperation()) {
      throw new Error("Wait for the current story operation to finish before starting visual production.");
    }

    const project = projectsRef.current.find((item) => item.id === selectedProjectIdRef.current);
    if (!project?.id) throw new Error("Select a saved story before approving production.");

    const manifestValidation = validateManifest(manifest, project.scene_count);
    if (!manifestValidation.valid || !manifestValidation.manifest) {
      throw new Error(manifestValidation.error || "Approve a valid screenplay before starting visual production.");
    }
    const approvedManifest = manifestValidation.manifest;
    const approvedTitle = title.trim();
    if (!approvedTitle) throw new Error("The approved screenplay needs a title before visual production can start.");

    visualProductionHandoffLockRef.current = true;
    setIsStartingVisualProduction(true);
    setVisualProductionHandoffProjectId(project.id);
    setFrameError(null);
    setFrameProgress({
      stage: "characters",
      current: 0,
      total: getExpectedFrameAssetCount(approvedManifest),
      completed: 0,
      current_label: "Saving screenplay approval and preparing visual production...",
    });

    try {
      // Preserve the existing save checkpoint before changing the workflow to SCRIPTED.
      await handleSaveEditorChanges(approvedManifest, approvedTitle);
      if (selectedProjectIdRef.current !== project.id) {
        throw new Error("The active story changed before visual production could start. Reopen the approved story to continue.");
      }

      const savedProject = projectsRef.current.find((item) => item.id === project.id);
      if (!savedProject) throw new Error("The approved story is no longer available in your private library.");

      const approvedAt = new Date().toISOString();
      const patch: Partial<DramaProjectRecord> = {
        title: approvedTitle,
        manifest: approvedManifest,
        status: "SCRIPTED",
        production_approved: true,
        production_approved_at: approvedAt,
        last_error: null,
      };
      await updateDramaProjectRecord(project.id, patch);
      applyProjectPatch(project.id, patch);

      // Pass the freshly approved snapshot directly. React state has not rendered yet,
      // so resolving selectedProject here would otherwise use the pre-approval manifest.
      const approvedProject: DramaProjectRecord = {
        ...savedProject,
        ...patch,
        id: project.id,
        title: approvedTitle,
        manifest: approvedManifest,
        status: "SCRIPTED",
        production_approved: true,
        production_approved_at: approvedAt,
      };
      await handleGenerateFrames("missing", approvedProject);
    } finally {
      setIsStartingVisualProduction(false);
      setVisualProductionHandoffProjectId(null);
      visualProductionHandoffLockRef.current = false;
    }
  };

  // Handler: Retry the checkpoint that failed, without skipping a gate.
  const handleRetryProject = async (project: DramaProjectRecord) => {
    if (
      project.status === "AWAITING_SETUP_CONFIRM" ||
      (project.status === "PENDING" && !project.manifest && !project.synopsis)
    ) {
      await handleRegenerateSetup(project);
      return;
    }

    // A saved screenplay review, or any saved setup with no manifest,
    // must regenerate the script rather than silently returning to setup.
    if (
      project.status === "AWAITING_SCRIPT_CONFIRM" ||
      Boolean(project.manifest) ||
      ((project.status === "PENDING" || project.status === "FAILED") && Boolean(project.synopsis) && !project.manifest)
    ) {
      await handleRegenerateScript(project);
      return;
    }

    await handleRegenerateSetup(project);
  };

  // Handler: Generate one saved storyboard motion clip
  const handleGenerateVideo = async (sceneNumber: number, regenerate = false) => {
    if (videoStartLockRef.current || opLockRef.current || isGenerating || isGeneratingFrames || isSaving) return;

    if (!isAuth) {
      setVideoError("Sign in before generating private motion clips.");
      return;
    }
    if (isEditorDirty) {
      setVideoError("Save your screenplay edits before starting motion. The clip must use the last saved storyboard.");
      return;
    }

    const project = projectsRef.current.find((item) => item.id === selectedProjectIdRef.current);
    if (!project?.id || project.status !== "SCRIPTED" || !project.production_approved || !project.manifest) {
      setVideoError("Approve the screenplay first, then generate motion from the manual Video stage.");
      return;
    }

    const manifestValidation = validateManifest(project.manifest, project.scene_count);
    if (!manifestValidation.valid || !manifestValidation.manifest) {
      setVideoError(manifestValidation.error || "Save a valid SCRIPTED manifest before generating motion.");
      return;
    }
    const manifest = manifestValidation.manifest;
    const frameValidation = validateFrameAssets(project.frame_assets || [], manifest);
    if (!frameValidation.valid || !frameValidation.assets) {
      setVideoError(frameValidation.error || "Saved storyboard metadata needs to be repaired before starting motion.");
      return;
    }

    const scene = manifest.scenes.find((candidate) => candidate.scene_number === sceneNumber);
    const storyboard = frameValidation.assets.find(
      (asset) => asset.asset_type === "scene_storyboard" && asset.scene_number === sceneNumber
    );
    if (!scene || !storyboard) {
      setVideoError(`Generate and save the Scene ${sceneNumber} storyboard in Frames before requesting motion.`);
      return;
    }
    if (!/^https:\/\//i.test(storyboard.image_url)) {
      setVideoError("This storyboard is not stored on a secure URL yet. Regenerate the scene frame before requesting motion.");
      return;
    }

    const activeProject = projectsRef.current.find((item) => getActiveVideoClip(item.video_clips || []));
    if (activeProject) {
      setVideoError(
        activeProject.id === project.id
          ? "A motion test is already rendering for this project. Keep the tab open while it finishes."
          : "Another project already has a motion test rendering. Wait for it to finish before starting another."
      );
      return;
    }

    const latestClip = project.video_clips.find((clip) => clip.scene_number === sceneNumber) || null;
    if (latestClip?.status === "READY" && !regenerate) {
      setVideoError(`Scene ${sceneNumber} already has an archived clip. Use Regenerate 5s test when you want a fresh take.`);
      return;
    }

    const projectId = project.id;
    const motionPrompt = buildMotionPrompt({
      scene,
      characters: manifest.characters,
      globalStyle: manifest.global_style || project.global_style || STYLE_PRESETS[0].value,
      sourceStoryboardUrl: storyboard.image_url,
      durationSeconds: 5,
      orientation: project.orientation,
    });
    const targetBase = {
      projectId,
      sceneNumber,
    };

    let startedPredictionId: string | null = null;
    let queuedClip: VideoClip | null = null;
    setVideoError(null);
    setVideoStartingScene(sceneNumber);
    videoStartLockRef.current = true;

    try {
      const started = await startMotionClip({
        projectId,
        sceneNumber,
        sourceStoryboardUrl: storyboard.image_url,
        prompt: motionPrompt,
        durationSeconds: 5,
      });
      startedPredictionId = started.prediction_id;

      if (selectedProjectIdRef.current !== projectId) {
        throw new Error("The active story changed before the motion prediction could be saved. Reopen this project to continue.");
      }

      const currentProject = projectsRef.current.find((item) => item.id === projectId);
      if (!currentProject) throw new Error("The selected project is no longer available in your private library.");

      const now = new Date().toISOString();
      queuedClip = {
        provider: "replicate-luma",
        prediction_id: started.prediction_id,
        scene_number: sceneNumber,
        source_storyboard_url: storyboard.image_url,
        prompt: motionPrompt,
        duration_seconds: 5,
        status: started.status,
        remote_status: started.remote_status || (started.status === "QUEUED" ? "starting" : "processing"),
        video_url: null,
        created_at: now,
        updated_at: now,
        error: null,
      };
      const nextClips = upsertVideoClip(currentProject.video_clips || [], queuedClip);
      await persistVideoState(projectId, nextClips, started.status, null, undefined, undefined, true);

      const target: VideoPollTarget = {
        ...targetBase,
        predictionId: started.prediction_id,
      };
      beginVideoPolling(target);
    } catch (error) {
      const message = readableVideoError(
        error,
        startedPredictionId
          ? "The motion prediction started, but its saved progress could not be confirmed. Keep this project open and retry the scene."
          : "The motion test could not start. The saved storyboard is safe, so you can retry this scene."
      );
      setVideoError(message);

      if (selectedProjectIdRef.current === projectId) {
        const currentProject = projectsRef.current.find((item) => item.id === projectId);
        try {
          if (queuedClip && currentProject) {
            const recoveryClip: VideoClip = {
              ...queuedClip,
              status: "FAILED",
              remote_status: "failed",
              video_url: null,
              error: message,
              updated_at: new Date().toISOString(),
            };
            const recoveryClips = upsertVideoClip(currentProject.video_clips || [], recoveryClip);
            await persistVideoState(
              projectId,
              recoveryClips,
              deriveVideoStatus(recoveryClips, "FAILED"),
              message
            );
          } else if (currentProject) {
            await persistVideoState(
              projectId,
              currentProject.video_clips || [],
              deriveVideoStatus(currentProject.video_clips || [], "FAILED"),
              message
            );
          }
        } catch (saveError) {
          console.error("Failed to persist motion start failure:", saveError);
        }
      }
    } finally {
      setVideoStartingScene(null);
      videoStartLockRef.current = false;
    }
  };

  // Handler: Generate hosted character references and scene storyboards
  const handleGenerateFrames = async (
    mode: "missing" | "all" = "missing",
    projectOverride?: DramaProjectRecord
  ) => {
    const automaticHandoff = Boolean(projectOverride);
    if (opLockRef.current || isGenerating || isGeneratingFrames || (isSaving && !automaticHandoff) || hasActiveVideoOperation()) return;

    if (!isAuth) {
      setFrameError("Please sign in before generating private project frames.");
      return;
    }

    if (isEditorDirty && !automaticHandoff) {
      setFrameError("Save your screenplay edits before generating frames. Existing images are tied to the last saved manifest.");
      return;
    }

    const project = projectOverride || projectsRef.current.find((item) => item.id === selectedProjectIdRef.current);
    if (!project?.id || project.status !== "SCRIPTED" || !project.production_approved || !project.manifest) {
      setFrameError("Approve the screenplay first. Frames unlock after production approval.");
      return;
    }
    if (projectOverride && selectedProjectIdRef.current !== project.id) {
      setFrameError("Frame generation paused because the active story changed. Reopen this story to continue.");
      return;
    }

    if (mode === "all") {
      const confirmed = window.confirm(
        "Regenerate every character reference and scene storyboard? Existing frame images will be replaced as new images finish."
      );
      if (!confirmed) return;
    }

    const manifestValidation = validateManifest(project.manifest, project.scene_count);
    if (!manifestValidation.valid || !manifestValidation.manifest) {
      setFrameError(manifestValidation.error || "Save a valid SCRIPTED manifest before generating frames.");
      return;
    }
    const manifest = manifestValidation.manifest;
    const savedValidation = validateFrameAssets(project.frame_assets || [], manifest);
    if (!savedValidation.valid) {
      setFrameError(savedValidation.error || "Saved frame metadata needs to be repaired before retrying.");
      return;
    }

    const projectId = project.id;
    const expectedTotal = getExpectedFrameAssetCount(manifest);
    let workingAssets: FrameAsset[] = mode === "all" ? [] : [...(savedValidation.assets || [])];
    let completed = workingAssets.length;

    const upsertAsset = (assets: FrameAsset[], nextAsset: FrameAsset): FrameAsset[] => {
      const nextKey = getFrameAssetKey(nextAsset);
      return [...assets.filter((asset) => getFrameAssetKey(asset) !== nextKey), nextAsset];
    };

    const persistFrameState = async (
      assets: FrameAsset[],
      status: "GENERATING" | "READY" | "FAILED" | "NOT_STARTED",
      error: string | null,
      invalidatePreview = false
    ) => {
      if (selectedProjectIdRef.current !== projectId) {
        throw new Error("Frame generation paused because the active story changed. Reopen this story to continue.");
      }
      const currentProject = projectsRef.current.find((item) => item.id === projectId);
      const nextPreviewMetadata = invalidatePreview ? stalePreviewMetadata(currentProject?.preview_metadata) : undefined;
      const persistencePatch: Partial<DramaProjectRecord> = {
        frame_status: status,
        frame_assets: assets,
        frame_error: error,
      };
      if (nextPreviewMetadata) persistencePatch.preview_metadata = nextPreviewMetadata;
      await updateDramaProjectRecord(projectId, persistencePatch);

      const nextProjects = projectsRef.current.map((item) =>
        item.id === projectId
          ? {
              ...item,
              frame_status: status,
              frame_assets: assets,
              frame_error: error,
              ...(nextPreviewMetadata ? { preview_metadata: nextPreviewMetadata } : {}),
            }
          : item
      );
      projectsRef.current = nextProjects;
      setProjects(nextProjects);
    };

    opLockRef.current = true;
    setIsGeneratingFrames(true);
    setFrameError(null);
    setFrameProgress({
      stage: "characters",
      current: completed,
      total: expectedTotal,
      completed,
      current_label: "Preparing character references...",
    });

    try {
      // Mark the stage before the first hosted image call. For deliberate regeneration,
      // the cleared list is persisted so a refresh never mistakes old images for new ones.
      await persistFrameState(workingAssets, "GENERATING", null, mode === "all");

      for (const character of manifest.characters) {
        if (selectedProjectIdRef.current !== projectId) {
          throw new Error("Frame generation paused because the active story changed. Reopen this story to continue.");
        }
        const characterKey = `character:${character.id}`;
        const existing = workingAssets.find((asset) => getFrameAssetKey(asset) === characterKey);
        if (existing) {
          setFrameProgress({
            stage: "characters",
            current: completed,
            total: expectedTotal,
            completed,
            current_label: `${character.id} reference already saved`,
          });
          continue;
        }

        setFrameProgress({
          stage: "characters",
          current: completed + 1,
          total: expectedTotal,
          completed,
          current_label: `Generating ${character.id} reference portrait...`,
        });
        const generated = await generateCharacterReferenceFrame({
          character,
          globalStyle: manifest.global_style || project.global_style || STYLE_PRESETS[0].value,
          seed: project.seed,
          orientation: project.orientation,
        });
        const nextAsset: FrameAsset = {
          asset_type: "character_reference",
          character_id: character.id,
          image_url: generated.image_url,
          prompt: generated.prompt,
          created_at: new Date().toISOString(),
        };
        const nextAssets = upsertAsset(workingAssets, nextAsset);
        const nextValidation = validateFrameAssets(nextAssets, manifest);
        if (!nextValidation.valid || !nextValidation.assets) {
          throw new Error(nextValidation.error || `The ${character.id} reference could not be validated.`);
        }
        workingAssets = nextValidation.assets;
        completed = workingAssets.length;
        await persistFrameState(workingAssets, "GENERATING", null);
        setFrameProgress({
          stage: "characters",
          current: completed,
          total: expectedTotal,
          completed,
          current_label: `${character.id} reference saved to this project`,
        });
      }

      for (const scene of manifest.scenes) {
        if (selectedProjectIdRef.current !== projectId) {
          throw new Error("Frame generation paused because the active story changed. Reopen this story to continue.");
        }
        const sceneKey = `scene:${scene.scene_number}`;
        const existing = workingAssets.find((asset) => getFrameAssetKey(asset) === sceneKey);
        if (existing) {
          setFrameProgress({
            stage: "scenes",
            current: completed,
            total: expectedTotal,
            completed,
            current_label: `Scene ${scene.scene_number} storyboard already saved`,
          });
          continue;
        }

        const referenceAssets = scene.character_focus.map((characterId) =>
          workingAssets.find(
            (asset) =>
              asset.asset_type === "character_reference" && asset.character_id === characterId
          )
        );
        if (referenceAssets.some((asset) => !asset)) {
          throw new Error(`Scene ${scene.scene_number} is waiting for all of its saved character references.`);
        }
        const referenceImageUrls = referenceAssets
          .filter((asset): asset is FrameAsset => Boolean(asset))
          .map((asset) => asset.image_url);

        setFrameProgress({
          stage: "scenes",
          current: completed + 1,
          total: expectedTotal,
          completed,
          current_label: `Generating Scene ${scene.scene_number} storyboard...`,
        });
        const generated = await generateSceneStoryboardFrame({
          scene,
          characters: manifest.characters,
          globalStyle: manifest.global_style || project.global_style || STYLE_PRESETS[0].value,
          seed: project.seed,
          referenceImageUrls,
          orientation: project.orientation,
        });
        const nextAsset: FrameAsset = {
          asset_type: "scene_storyboard",
          scene_number: scene.scene_number,
          image_url: generated.image_url,
          prompt: generated.prompt,
          created_at: new Date().toISOString(),
          reference_character_ids: [...scene.character_focus],
          reference_image_urls: [...referenceImageUrls],
        };
        const nextAssets = upsertAsset(workingAssets, nextAsset);
        const nextValidation = validateFrameAssets(nextAssets, manifest);
        if (!nextValidation.valid || !nextValidation.assets) {
          throw new Error(nextValidation.error || `Scene ${scene.scene_number} storyboard could not be validated.`);
        }
        workingAssets = nextValidation.assets;
        completed = workingAssets.length;
        await persistFrameState(workingAssets, "GENERATING", null, true);
        setFrameProgress({
          stage: "scenes",
          current: completed,
          total: expectedTotal,
          completed,
          current_label: `Scene ${scene.scene_number} storyboard saved to this project`,
        });
      }

      const finalValidation = validateFrameAssets(workingAssets, manifest);
      if (!finalValidation.valid || !finalValidation.assets || finalValidation.assets.length < expectedTotal) {
        throw new Error(finalValidation.error || "Some frame assets are still missing. Retry the remaining frames.");
      }
      workingAssets = finalValidation.assets;
      await persistFrameState(workingAssets, "READY", null);
      setFrameProgress({
        stage: "complete",
        current: expectedTotal,
        total: expectedTotal,
        completed: expectedTotal,
        current_label: "Character references and scene storyboards are ready",
      });
    } catch (err: any) {
      console.error("Frame generation failed:", err);
      const errorMsg = err instanceof Error && err.message
        ? err.message
        : "Frame generation stopped before every image was saved. Retry the missing assets.";
      setFrameError(errorMsg);
      setFrameProgress({
        stage: "error",
        current: completed,
        total: expectedTotal,
        completed,
        current_label: "Completed images remain saved. Retry the missing assets.",
      });

      // Keep the original generation error even if this status write fails.
      const failedProjects: DramaProjectRecord[] = projectsRef.current.map((item) =>
        item.id === projectId
          ? { ...item, frame_status: "FAILED", frame_assets: workingAssets, frame_error: errorMsg }
          : item
      );
      projectsRef.current = failedProjects;
      setProjects(failedProjects);
      if (selectedProjectIdRef.current === projectId) {
        try {
          await updateDramaProjectRecord(projectId, {
            frame_status: "FAILED",
            frame_assets: workingAssets,
            frame_error: errorMsg,
          });
        } catch (statusError) {
          console.error("Failed to persist frame failure status:", statusError);
        }
      }
    } finally {
      setIsGeneratingFrames(false);
      opLockRef.current = false;
    }
  };

  // Handler: Save edits from DramaEditor
  const handleSaveEditorChanges = async (manifest: DramaManifest, title: string) => {
    if (opLockRef.current || isSaving || isGeneratingFrames) return;
    if (hasActiveVideoOperation()) {
      throw new Error("Wait for the active motion test to finish before saving screenplay changes.");
    }

    if (!isAuth) {
      throw new Error("Please sign in to save your script modifications.");
    }

    if (!selectedProject || !selectedProject.id) {
      throw new Error("No active database project selected to save.");
    }

    opLockRef.current = true;
    setIsSaving(true);

    // The ref carries the latest archived media snapshot, even when a render has
    // not caused React to paint the newest project object yet.
    const currentProject = projectsRef.current.find((project) => project.id === selectedProject.id) || selectedProject;
    const projectId = selectedProject.id;
    const titleChanged = title.trim() !== currentProject.title;
    const manifestChanged = JSON.stringify(manifest) !== JSON.stringify(currentProject.manifest);
    const retainedFrameValidation = validateFrameAssets(currentProject.frame_assets || [], manifest);
    const retainedFrameAssets = retainedFrameValidation.valid ? (retainedFrameValidation.assets || []) : [];
    const frameNeedsReview = manifestChanged && retainedFrameAssets.length > 0;
    const frameReviewNote = manifestChanged
      ? frameNeedsReview
        ? "The script changed after these frames were created. Review them and use Regenerate all frames when the visuals need to match the new script."
        : null
      : currentProject.frame_error || null;
    const nextFrameStatus = manifestChanged ? "NOT_STARTED" : currentProject.frame_status;
    const nextPreviewMetadata = manifestChanged ? stalePreviewMetadata(currentProject.preview_metadata) : undefined;
    const productionApproved = currentProject.production_approved === true;
    const nextWorkflowStatus = productionApproved ? "SCRIPTED" : "AWAITING_SCRIPT_CONFIRM";
    const nextVideoState: Partial<DramaProjectRecord> = manifestChanged
      ? {
          video_status: "NOT_STARTED",
          video_clips: [],
          video_error: null,
        }
      : {};

    try {
      // An unchanged screenplay save deliberately omits video fields. That keeps
      // the database's archived clips safe even if an older in-memory snapshot was empty.
      const persistencePatch: Partial<DramaProjectRecord> = {
        title: titleChanged ? title : currentProject.title,
        global_style: manifest.global_style,
        manifest,
        status: nextWorkflowStatus,
        production_approved: productionApproved,
        production_approved_at: currentProject.production_approved_at || null,
        frame_status: nextFrameStatus,
        frame_assets: retainedFrameAssets,
        frame_error: frameReviewNote,
        ...nextVideoState,
        ...(nextPreviewMetadata ? { preview_metadata: nextPreviewMetadata } : {}),
      };
      await updateDramaProjectRecord(projectId, persistencePatch);

      const nextProjects = projectsRef.current.map((p) =>
        p.id === projectId
          ? {
              ...p,
              title: titleChanged ? title : p.title,
              global_style: manifest.global_style,
              manifest,
              status: nextWorkflowStatus,
              production_approved: productionApproved,
              production_approved_at: currentProject.production_approved_at || null,
              frame_status: nextFrameStatus,
              frame_assets: retainedFrameAssets,
              frame_error: frameReviewNote,
              ...nextVideoState,
              ...(nextPreviewMetadata ? { preview_metadata: nextPreviewMetadata } : {}),
            }
          : p
      );
      projectsRef.current = nextProjects;
      setProjects(nextProjects);
      setIsEditorDirty(false);
    } catch (err: any) {
      console.error("Save error:", err);
      throw new Error(err?.message || "Failed to update project in database.");
    } finally {
      setIsSaving(false);
      opLockRef.current = false;
    }
  };

  // Handler: Save one explicitly approved shot-plan snapshot without touching media.
  const handleSaveShotPlan = async (plan: SavedShotPlanSnapshot): Promise<boolean> => {
    const projectId = selectedProjectIdRef.current;
    const initiatingAuthEpoch = authSessionRef.current.epoch;
    const isCurrentSaveContext = () => Boolean(
      projectId &&
      selectedProjectIdRef.current === projectId &&
      authSessionRef.current.authenticated &&
      authSessionRef.current.epoch === initiatingAuthEpoch
    );
    const fail = (message: string): never => {
      throw new Error(message);
    };
    let ownsShotPlanSaveLock = false;

    try {
      if (!isAuth || !authSessionRef.current.authenticated) {
        fail("Please sign in before saving an approved shot plan.");
      }
      if (!projectId) {
        fail("Select a saved story before saving its shot plan.");
      }
      if (
        opLockRef.current ||
        isGenerating ||
        isGeneratingFrames ||
        isSaving ||
        isStartingVisualProduction ||
        visualProductionHandoffLockRef.current ||
        isSavingShotPlan ||
        shotPlanSaveLockRef.current ||
        synthesisBusy ||
        ambienceBusy ||
        isStartingLipsync ||
        lipsyncInFlightRef.current ||
        isStartingPixverseLipsync ||
        pixverseLipsyncInFlightRef.current ||
        pixverseLipsyncStartLockRef.current ||
        audioSynthesisLockRef.current ||
        ambienceGenerationLockRef.current ||
        lipsyncStartLockRef.current ||
        videoStartingScene !== null ||
        hasActiveVideoOperation()
      ) {
        fail("Please wait for the current save or generation to finish before saving the shot plan.");
      }
      if (isEditorDirty) {
        fail("Save or discard screenplay edits before saving an approved shot plan.");
      }

      const normalizedSubmittedPlan = normalizeSavedShotPlanSnapshot(plan);
      if (!normalizedSubmittedPlan) {
        fail("The shot plan draft is structurally invalid. Keep the local order open and try again.");
      }
      if (normalizedSubmittedPlan.version !== 1 && normalizedSubmittedPlan.version !== 2) {
        fail("This shot-plan version is not supported. Keep the local order open and try again.");
      }

      shotPlanSaveLockRef.current = true;
      ownsShotPlanSaveLock = true;
      setIsSavingShotPlan(true);
      setShotPlanSaveError(null);

      // Re-read the owned project so the submitted snapshot is checked against
      // the latest canonical screenplay and normalized media lineage.
      const freshProjects = await fetchUserProjects();
      if (!isCurrentSaveContext()) return false;
      const freshProject = freshProjects.find((project) => project.id === projectId);
      if (!freshProject) {
        fail("The saved story is no longer available in your private library. Your local order remains unchanged.");
      }
      if (
        freshProject.status !== "SCRIPTED" ||
        freshProject.production_approved !== true ||
        !freshProject.manifest
      ) {
        fail("Approve and save the screenplay before saving an approved shot plan. Your local order remains unchanged.");
      }

      const freshManifestValidation = validateManifest(freshProject.manifest, freshProject.scene_count);
      if (!freshManifestValidation.valid || !freshManifestValidation.manifest) {
        fail("The approved screenplay is no longer valid. Your local shot order remains unchanged.");
      }

      const validation = normalizedSubmittedPlan.version === 1
        ? validateSavedShotPlanAgainstCurrent({
            plan: normalizedSubmittedPlan,
            manifest: freshManifestValidation.manifest,
            video_clips: Array.isArray(freshProject.video_clips) ? freshProject.video_clips : [],
            audio_assets: Array.isArray(freshProject.audio_assets) ? freshProject.audio_assets : [],
            dialogue_shot_clips: Array.isArray(freshProject.dialogue_shot_clips) ? freshProject.dialogue_shot_clips : [],
            lipsync_assets: Array.isArray(freshProject.lipsync_assets) ? freshProject.lipsync_assets : [],
          })
        : normalizedSubmittedPlan.version === 2
          ? validateSavedMultiLineShotPlanAgainstCurrent({
              plan: normalizedSubmittedPlan,
              manifest: freshManifestValidation.manifest,
              video_clips: Array.isArray(freshProject.video_clips) ? freshProject.video_clips : [],
              audio_assets: Array.isArray(freshProject.audio_assets) ? freshProject.audio_assets : [],
              dialogue_shot_clips: Array.isArray(freshProject.dialogue_shot_clips) ? freshProject.dialogue_shot_clips : [],
              lipsync_assets: Array.isArray(freshProject.lipsync_assets) ? freshProject.lipsync_assets : [],
            })
          : { valid: false, error: "This shot-plan version is not supported. Keep the local order open and try again." };
      if (!validation.valid || !validation.plan) {
        fail(validation.error || "The current screenplay or exact media lineage changed. Start a new shot-plan draft.");
      }
      if (!isCurrentSaveContext()) return false;

      // This is intentionally the only persisted field in this save operation.
      await updateDramaProjectRecord(projectId, { shot_plan: validation.plan });
      if (!isCurrentSaveContext()) return false;

      applyProjectPatch(projectId, { shot_plan: validation.plan });
      shotPlanDirtyRef.current = false;
      setIsShotPlanDirty(false);
      setShotPlanSaveError(null);
      return true;
    } catch (error) {
      console.error("Shot plan save failed:", error);
      if (isCurrentSaveContext()) {
        setShotPlanSaveError(
          readableLipsyncError(
            error,
            "The shot plan could not be saved. Your local order is still here, unchanged. Try again when the project is ready."
          )
        );
      }
      return false;
    } finally {
      if (ownsShotPlanSaveLock) {
        shotPlanSaveLockRef.current = false;
        setIsSavingShotPlan(false);
      }
    }
  };

  // Handler: persist one immutable scene assembly checkpoint without replacing other project media.
  const handleSaveAssemblyAsset = async (asset: FinalAssemblyAsset): Promise<boolean> => {
    const projectId = selectedProjectIdRef.current;
    const initiatingAuthEpoch = authSessionRef.current.epoch;
    const isCurrentSaveContext = () => Boolean(
      mountedRef.current &&
      projectId &&
      selectedProjectIdRef.current === projectId &&
      authSessionRef.current.authenticated &&
      authSessionRef.current.epoch === initiatingAuthEpoch
    );
    const fail = (message: string): never => {
      throw new Error(message);
    };

    try {
      if (!isAuth || !authSessionRef.current.authenticated) {
        fail("Please sign in before saving a scene assembly.");
      }
      if (!projectId) {
        fail("Select a saved story before saving a scene assembly.");
      }
      if (!isCurrentSaveContext()) {
        fail("This scene assembly is no longer current. No project update was applied.");
      }
      if (isEditorDirty || isShotPlanDirty || isSavingShotPlan || shotPlanSaveLockRef.current) {
        fail("Save the screenplay and approved shot plan before saving a scene assembly.");
      }

      const project = projectsRef.current.find((item) => item.id === projectId);
      if (!project) {
        fail("The selected story is no longer available. No project update was applied.");
      }
      if (project.status !== "SCRIPTED" || project.production_approved !== true || !project.manifest) {
        fail("Approve and save the screenplay before saving a scene assembly.");
      }

      const manifestValidation = validateManifest(project.manifest, project.scene_count);
      if (!manifestValidation.valid || !manifestValidation.manifest) {
        fail(
          manifestValidation.error ||
            "The approved screenplay is no longer valid. Refresh the project and save the screenplay again."
        );
      }

      const normalizedAsset = normalizeFinalAssemblyAssets([asset])[0];
      if (!normalizedAsset) {
        fail("The scene assembly checkpoint is invalid and was not saved.");
      }

      const currentAssets = normalizeFinalAssemblyAssets(project.assembly_assets);
      const existingAssetIndex = currentAssets.findIndex(
        (existingAsset) => existingAsset.assembly_id === normalizedAsset.assembly_id
      );
      const nextAssets = existingAssetIndex >= 0
        ? currentAssets.map((existingAsset, index) =>
            index === existingAssetIndex ? normalizedAsset : existingAsset
          )
        : [...currentAssets, normalizedAsset];

      if (!isCurrentSaveContext()) {
        fail("This scene assembly is no longer current. No project update was applied.");
      }

      // Persist only assembly history so archived media and other project fields stay untouched.
      await updateDramaProjectRecord(projectId, { assembly_assets: nextAssets });
      if (!isCurrentSaveContext()) return false;

      applyProjectPatch(projectId, { assembly_assets: nextAssets });
      return true;
    } catch (error) {
      console.error("Final assembly save failed:", error);
      if (!isCurrentSaveContext()) return false;
      throw new Error(
        readableLipsyncError(
          error,
          "The scene assembly checkpoint could not be saved. Earlier attempts remain safe."
        )
      );
    }
  };

  const handleSavePreview = async () => {
    if (opLockRef.current || isSaving) throw new Error("A project save is already in progress. Wait a moment and try again.");
    if (!isAuth) throw new Error("Please sign in to save a private preview checkpoint.");

    const project = projectsRef.current.find((item) => item.id === selectedProjectIdRef.current);
    if (!project?.id) throw new Error("Select a saved story before saving its preview.");
    const playlist = deriveSilentPreviewPlaylist(project.manifest, project.frame_assets, project.video_clips);
    if (!playlist.complete) {
      const missing = playlist.missing_scene_numbers.length
        ? ` Missing scenes: ${playlist.missing_scene_numbers.join(", ")}.`
        : "";
      throw new Error(`Render one current READY clip for every screenplay scene before saving the preview.${missing}`);
    }

    const previewMetadata: SilentPreviewMetadata = {
      version: 1,
      mode: "silent_hard_cut",
      status: "READY",
      scene_numbers: [...playlist.scene_numbers],
      clip_prediction_ids: [...playlist.clip_prediction_ids],
      total_duration_seconds: playlist.total_duration_seconds,
      updated_at: new Date().toISOString(),
    };

    opLockRef.current = true;
    setIsSaving(true);
    try {
      await updateDramaProjectRecord(project.id, { preview_metadata: previewMetadata });
      applyProjectPatch(project.id, { preview_metadata: previewMetadata });
    } catch (error: any) {
      throw new Error(error?.message || "The preview definition could not be saved. Your scene clips are still safe.");
    } finally {
      setIsSaving(false);
      opLockRef.current = false;
    }
  };

  // Handler: Load account voices only when the approved Sound Test asks for them.
  const handleLoadVoices = async () => {
    if (voiceLoading) return;
    if (!isAuth) {
      setVoiceError("Sign in before loading private account voices.");
      return;
    }
    const project = projectsRef.current.find((item) => item.id === selectedProjectIdRef.current);
    if (!project?.id || project.status !== "SCRIPTED" || !project.production_approved || !project.manifest) {
      setVoiceError("Approve and save a screenplay before loading voices for its sound proof.");
      return;
    }
    const manifestValidation = validateManifest(project.manifest, project.scene_count);
    if (!manifestValidation.valid || !manifestValidation.manifest) {
      setVoiceError(manifestValidation.error || "Save a valid approved screenplay before loading voices.");
      return;
    }

    if (voiceCacheRef.current) {
      setVoices(voiceCacheRef.current);
      setVoiceError(null);
      return;
    }

    setVoiceLoading(true);
    setVoiceError(null);
    try {
      const response = await elevenLabsVoice({ operation: "list_voices" });
      if (response.error) throw new Error(response.error);
      const loadedVoices = normalizeLoadedVoices(response.voices);
      if (!loadedVoices.length) {
        throw new Error("No account voices were returned. Check the connected ElevenLabs voice library and try again.");
      }
      voiceCacheRef.current = loadedVoices;
      setVoices(loadedVoices);
    } catch (error) {
      console.error("Failed to load ElevenLabs voices:", error);
      const raw = error instanceof Error ? error.message : "";
      const safeMessage = raw && !/api[_ -]?key|secret|bearer|authorization/i.test(raw)
        ? raw.slice(0, 400)
        : "The account voices could not be loaded.";
      setVoiceError(safeMessage);
    } finally {
      setVoiceLoading(false);
    }
  };

  // Handler: Generate one voice-only take from one exact saved speaker line.
  const handleGenerateVoiceTake = async ({
    sceneNumber,
    lineId,
    characterId,
    text,
    voice,
  }: {
    sceneNumber: number;
    lineId: string;
    characterId: string;
    text: string;
    voice: ElevenLabsVoice;
  }): Promise<boolean> => {
    if (audioSynthesisLockRef.current || opLockRef.current || isGenerating || isGeneratingFrames || isSaving || hasActiveVideoOperation()) {
      setSynthesisError("Wait for the current studio operation to finish before creating a voice take.");
      return false;
    }
    if (!isAuth) {
      setSynthesisError("Sign in before creating a private voice take.");
      return false;
    }
    if (isEditorDirty) {
      setSynthesisError("Save screenplay edits before generating audio from the approved dialogue lines.");
      return false;
    }

    const projectId = selectedProjectIdRef.current;
    const project = projectsRef.current.find((item) => item.id === projectId);
    if (!projectId || !project || project.status !== "SCRIPTED" || !project.production_approved || !project.manifest) {
      setSynthesisError("Approve and save the screenplay before creating a voice take.");
      return false;
    }

    const manifestValidation = validateManifest(project.manifest, project.scene_count);
    if (!manifestValidation.valid || !manifestValidation.manifest) {
      setSynthesisError(manifestValidation.error || "Save a valid approved manifest before creating audio.");
      return false;
    }
    const manifest = manifestValidation.manifest;
    const scene = manifest.scenes.find((candidate) => candidate.scene_number === sceneNumber);
    if (!scene) {
      setSynthesisError("Choose a saved scene before creating audio.");
      return false;
    }
    const savedLine = deriveDialogueLines(scene).find((line) => line.line_id === lineId);
    if (!savedLine || savedLine.character_id !== characterId || savedLine.text !== text) {
      setSynthesisError("This speaker line changed. Refresh the project and use the current saved screenplay.");
      return false;
    }

    const selectedVoice = voices.find((candidate) => candidate.voice_id === voice.voice_id);
    if (!selectedVoice || selectedVoice.voice_id !== voice.voice_id || !selectedVoice.name.trim()) {
      setSynthesisError("Load the current account voices again, then choose a voice for this character.");
      return false;
    }

    const exactDialogue = savedLine.text;
    audioSynthesisLockRef.current = true;
    setSynthesisBusy(true);
    setSynthesisError(null);

    try {
      const response = await elevenLabsVoice({
        operation: "synthesize_dialogue",
        project_id: projectId,
        scene_number: sceneNumber,
        line_id: savedLine.line_id,
        character_id: savedLine.character_id,
        voice_id: selectedVoice.voice_id,
        voice_name: selectedVoice.name,
        dialogue: exactDialogue,
      });

      if (selectedProjectIdRef.current !== projectId) return false;
      if (response.error) throw new Error(response.error);
      if (!isManagedHttpsAudioUrl(response.audio_url)) {
        throw new Error("The voice service did not return a secure managed audio URL. Your previous take is still safe.");
      }
      const responseContentType = typeof response.content_type === "string"
        ? response.content_type.split(";", 1)[0].trim().toLowerCase()
        : "";
      if (responseContentType !== "audio/mpeg") {
        throw new Error("The voice service returned an unsupported audio format. Your previous take is still safe.");
      }
      if (response.scene_number !== sceneNumber || response.line_id !== savedLine.line_id) {
        throw new Error("The returned voice take did not match the selected scene line. Your previous take is still safe.");
      }
      if (response.character_id !== savedLine.character_id) {
        throw new Error("The returned voice take did not match the selected speaker. Your previous take is still safe.");
      }
      if (response.voice_id !== selectedVoice.voice_id) {
        throw new Error("The returned voice take did not match the selected account voice. Your previous take is still safe.");
      }

      const currentProject = projectsRef.current.find((item) => item.id === projectId);
      if (!currentProject || selectedProjectIdRef.current !== projectId) return false;
      const now = new Date().toISOString();
      const currentAssignments = normalizeVoiceAssignments(currentProject.voice_assignments || [], manifest);
      const currentAudioAssets = normalizeDialogueAudioAssets(currentProject.audio_assets || [], manifest);
      const nextAssignment: VoiceAssignment = {
        character_id: savedLine.character_id,
        voice_id: selectedVoice.voice_id,
        voice_name: selectedVoice.name,
        updated_at: now,
      };
      const nextAsset: DialogueAudioAsset = {
        asset_type: "dialogue",
        provider: "elevenlabs",
        scene_number: sceneNumber,
        line_id: savedLine.line_id,
        character_id: savedLine.character_id,
        voice_id: selectedVoice.voice_id,
        voice_name: selectedVoice.name,
        text: exactDialogue,
        audio_url: response.audio_url,
        content_type: "audio/mpeg",
        status: "READY",
        created_at: now,
        updated_at: now,
        error: null,
      };
      const nextAssignments = normalizeVoiceAssignments(
        upsertVoiceAssignment(currentAssignments, nextAssignment),
        manifest
      );
      const nextAudioAssets = normalizeDialogueAudioAssets(
        replaceLatestDialogueAudioAsset(currentAudioAssets, nextAsset),
        manifest
      );
      if (!nextAudioAssets.some((asset) =>
        asset.audio_url === response.audio_url &&
        asset.scene_number === sceneNumber &&
        asset.line_id === savedLine.line_id &&
        asset.character_id === savedLine.character_id
      )) {
        throw new Error("The generated voice take could not be validated against the saved scene line. Your previous take is still safe.");
      }

      // Keep legacy approval compatibility and save this line immediately so partial
      // scene progress survives a later line failure or browser refresh.
      const shouldBackfillProductionApproval =
        currentProject.status === "SCRIPTED" &&
        Boolean(currentProject.manifest) &&
        currentProject.production_approved === true;
      await updateDramaProjectRecord(projectId, {
        ...(shouldBackfillProductionApproval ? { production_approved: true } : {}),
        voice_assignments: nextAssignments,
        audio_assets: nextAudioAssets,
      });
      if (selectedProjectIdRef.current !== projectId) return false;
      applyProjectPatch(projectId, {
        ...(shouldBackfillProductionApproval ? { production_approved: true } : {}),
        voice_assignments: nextAssignments,
        audio_assets: nextAudioAssets,
      });
      setSynthesisError(null);
      return true;
    } catch (error) {
      if (selectedProjectIdRef.current !== projectId) return false;
      console.error("Voice line generation failed:", error);
      const raw = error instanceof Error ? error.message : "";
      const gateProject = projectsRef.current.find((item) => item.id === projectId);
      const knownProductGateError =
        /authentication required/i.test(raw) ||
        /production[_ -]?required/i.test(raw) ||
        /approve the screenplay before opening the private sound test/i.test(raw);

      // The function gateway historically translated this product gate into a generic 403
      // authentication message. Verify the session before translating that one known case.
      if (
        knownProductGateError &&
        isAuth &&
        gateProject?.status === "SCRIPTED" &&
        Boolean(gateProject.manifest)
      ) {
        let sessionStillValid = false;
        try {
          const currentUser = await superdevClient.auth.me();
          sessionStillValid = Boolean(currentUser?.email);
        } catch {
          sessionStillValid = false;
        }
        if (sessionStillValid) {
          setSynthesisError("Approve and save the screenplay before creating a voice take.");
        } else {
          invalidateSceneCoverageRun();
          stopLipsyncTracking();
    stopPixverseLipsyncTracking();
          markAuthSession(false);
          setIsAuth(false);
          setUserEmail(null);
          setProjects([]);
          selectedProjectIdRef.current = null;
          setSelectedProjectId(null);
          setIsEditorDirty(false);
          resetShotPlanPersistenceState();
          setVoices([]);
          voiceCacheRef.current = null;
          setVoiceLoading(false);
          setVoiceError(null);
          setSynthesisError("Your creator session expired. Sign in again before creating a private voice take.");
        }
      } else {
        const safeMessage = raw && !/api[_ -]?key|secret|bearer|authorization/i.test(raw)
          ? raw.slice(0, 600)
          : "The voice take could not be created. Your previous audio remains available, so retry when ready.";
        setSynthesisError(safeMessage);
      }
      return false;
    } finally {
      audioSynthesisLockRef.current = false;
      setSynthesisBusy(false);
    }
  };

  // Handler: Persist only browser-measured duration metadata for an existing take.
  const handleAudioDurationMeasured = async (asset: DialogueAudioAsset, durationSeconds: number) => {
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 3600) return;
    const projectId = selectedProjectIdRef.current;
    if (!projectId || !isAuth) return;
    const project = projectsRef.current.find((item) => item.id === projectId);
    if (!project?.manifest) return;
    const manifestValidation = validateManifest(project.manifest, project.scene_count);
    if (!manifestValidation.valid || !manifestValidation.manifest) return;
    const safeAssets = normalizeDialogueAudioAssets(project.audio_assets || [], manifestValidation.manifest);
    const requestedLineId = asset.line_id?.trim() || getLegacyDialogueLineId(asset.scene_number);
    const matchingAsset = safeAssets.find(
      (candidate) =>
        candidate.scene_number === asset.scene_number &&
        candidate.line_id === requestedLineId &&
        candidate.character_id === asset.character_id &&
        candidate.audio_url === asset.audio_url &&
        candidate.status === "READY"
    );
    if (!matchingAsset || (matchingAsset.duration_seconds !== undefined && Math.abs(matchingAsset.duration_seconds - durationSeconds) < 0.01)) return;

    const nextAssets = normalizeDialogueAudioAssets(
      safeAssets.map((candidate) =>
        candidate.scene_number === matchingAsset.scene_number &&
        candidate.line_id === matchingAsset.line_id &&
        candidate.character_id === matchingAsset.character_id &&
        candidate.audio_url === matchingAsset.audio_url
          ? { ...candidate, duration_seconds: durationSeconds }
          : candidate
      ),
      manifestValidation.manifest
    );
    if (!nextAssets.some((candidate) =>
      candidate.scene_number === matchingAsset.scene_number &&
      candidate.line_id === matchingAsset.line_id &&
      candidate.audio_url === matchingAsset.audio_url &&
      candidate.duration_seconds === durationSeconds
    )) return;

    try {
      await updateDramaProjectRecord(projectId, { audio_assets: nextAssets });
      if (selectedProjectIdRef.current === projectId) {
        applyProjectPatch(projectId, { audio_assets: nextAssets });
      }
    } catch (error) {
      // Playback remains valid even when this optional timing note cannot be saved.
      console.warn("Could not save measured voice duration:", error);
    }
  };

  // Handler: Start one private lip-sync render from the exact saved source lineage.
  const handleStartLipsync = async ({
    sceneNumber,
    lineId,
    characterId,
    text,
    clipPredictionId,
    sourceVideoUrl,
    sourceAudioUrl,
    sourceClipKind,
  }: LipSyncStartInput): Promise<boolean> => {
    const blockedByStudioOperation =
      lipsyncStartLockRef.current ||
      lipsyncInFlightRef.current ||
      pixverseLipsyncStartLockRef.current ||
      pixverseLipsyncInFlightRef.current ||
      opLockRef.current ||
      isGenerating ||
      isGeneratingFrames ||
      isSaving ||
      isStartingVisualProduction ||
      synthesisBusy ||
      audioSynthesisLockRef.current ||
      ambienceBusy ||
      ambienceGenerationLockRef.current ||
      hasActiveVideoOperation();
    if (blockedByStudioOperation) {
      setLipsyncError("Wait for the current studio operation to finish before starting a lip-sync render.");
      return false;
    }
    if (!isAuth) {
      setLipsyncError("Sign in before starting a private lip-sync render.");
      return false;
    }
    if (isEditorDirty) {
      setLipsyncError("Save screenplay edits before rendering from the approved visual and dialogue sources.");
      return false;
    }

    const projectId = selectedProjectIdRef.current;
    const project = projectsRef.current.find((item) => item.id === projectId);
    if (!projectId || !project || project.status !== "SCRIPTED" || !project.production_approved || !project.manifest) {
      setLipsyncError("Approve and save the screenplay before starting a private lip-sync render.");
      return false;
    }
    if (project.orientation !== "vertical") {
      setLipsyncError("Lip-sync proof currently uses the saved vertical 9:16 production path.");
      return false;
    }
    const isDialogueCloseupSource = sourceClipKind === "dialogue_closeup";
    if (sourceClipKind !== undefined && !isDialogueCloseupSource) {
      setLipsyncError("This lip-sync source type is not available for the current proof.");
      return false;
    }
    const lipsyncProvider: LipsyncAsset["provider"] = isDialogueCloseupSource
      ? "pixverse-lipsync"
      : "replicate-lipsync";

    const manifestValidation = validateManifest(project.manifest, project.scene_count);
    if (!manifestValidation.valid || !manifestValidation.manifest) {
      setLipsyncError(manifestValidation.error || "Save a valid approved screenplay before starting lip-sync.");
      return false;
    }
    const manifest = manifestValidation.manifest;
    const normalizedSceneNumber = Number(sceneNumber);
    if (!Number.isInteger(normalizedSceneNumber) || normalizedSceneNumber < 1 || normalizedSceneNumber > 99) {
      setLipsyncError("Choose a valid saved scene before starting lip-sync.");
      return false;
    }
    const scene = manifest.scenes.find((candidate) => candidate.scene_number === normalizedSceneNumber);
    if (!scene) {
      setLipsyncError("The selected scene is no longer in the approved screenplay. Refresh the project and retry.");
      return false;
    }

    const normalizedLineId = normalizeLipsyncLineId(lineId);
    const savedLine = normalizedLineId
      ? deriveDialogueLines(scene).find((line) => line.line_id === normalizedLineId)
      : null;
    if (!savedLine || savedLine.character_id !== characterId || savedLine.text !== text) {
      setLipsyncError("The selected dialogue line changed. Refresh the project and choose the current saved line.");
      return false;
    }

    const normalizedClipPredictionId = normalizeLipsyncPredictionId(clipPredictionId);
    const requestedVideoUrl = typeof sourceVideoUrl === "string" ? sourceVideoUrl.trim() : "";
    const requestedAudioUrl = typeof sourceAudioUrl === "string" ? sourceAudioUrl.trim() : "";
    if (!normalizedClipPredictionId || !isManagedHttpsVideoUrl(requestedVideoUrl) || !isManagedHttpsAudioUrl(requestedAudioUrl)) {
      setLipsyncError("The selected source media is not stored on secure managed URLs. Choose the current READY clip and dialogue take again.");
      return false;
    }

    if (isDialogueCloseupSource) {
      const closeupClip = normalizeDialogueShotClips(project.dialogue_shot_clips || [], manifest).find(
        (clip) =>
          clip.provider === "replicate-luma" &&
          clip.prediction_id === normalizedClipPredictionId &&
          clip.scene_number === normalizedSceneNumber &&
          clip.line_id === savedLine.line_id &&
          clip.character_id === savedLine.character_id &&
          clip.text === savedLine.text &&
          clip.shot_role === "dialogue_closeup" &&
          clip.duration_seconds === 5 &&
          clip.status === "READY" &&
          clip.video_url === requestedVideoUrl &&
          isManagedHttpsVideoUrl(clip.video_url)
      );
      if (!closeupClip) {
        setLipsyncError("That close-up is no longer the saved READY five-second source for this line. Refresh the project and choose the current private shot.");
        return false;
      }
    } else {
      const frameValidation = validateFrameAssets(project.frame_assets || [], manifest);
      if (!frameValidation.valid || !frameValidation.assets) {
        setLipsyncError(frameValidation.error || "Saved storyboard metadata needs to be repaired before starting lip-sync.");
        return false;
      }
      const storyboard = frameValidation.assets.find(
        (asset) => asset.asset_type === "scene_storyboard" && asset.scene_number === normalizedSceneNumber
      );
      if (!storyboard || !isManagedHttpsVideoUrl(storyboard.image_url)) {
        setLipsyncError("The selected scene needs its current secure storyboard before lip-sync can run.");
        return false;
      }

      const currentClip = (project.video_clips || []).find(
        (clip) =>
          clip.provider === "replicate-luma" &&
          clip.prediction_id === normalizedClipPredictionId &&
          clip.scene_number === normalizedSceneNumber &&
          clip.status === "READY" &&
          clip.source_storyboard_url === storyboard.image_url &&
          clip.video_url === requestedVideoUrl &&
          isManagedHttpsVideoUrl(clip.video_url)
      );
      if (!currentClip) {
        setLipsyncError("That motion clip is no longer the current READY clip for this storyboard. Refresh the project and retry.");
        return false;
      }
    }

    const currentAudioAssets = normalizeDialogueAudioAssets(project.audio_assets || [], manifest);
    const currentAudio = currentAudioAssets.find(
      (asset) =>
        asset.scene_number === normalizedSceneNumber &&
        asset.line_id === savedLine.line_id &&
        asset.character_id === savedLine.character_id &&
        asset.text === savedLine.text &&
        asset.audio_url === requestedAudioUrl &&
        asset.content_type === "audio/mpeg" &&
        isManagedHttpsAudioUrl(asset.audio_url)
    );
    if (!currentAudio) {
      setLipsyncError("The selected dialogue take is no longer the current READY MP3 for this line. Refresh the project and retry.");
      return false;
    }

    const lineage: LipsyncLineage = {
      sceneNumber: normalizedSceneNumber,
      lineId: savedLine.line_id,
      characterId: savedLine.character_id,
      text: savedLine.text,
      clipPredictionId: normalizedClipPredictionId,
      sourceVideoUrl: requestedVideoUrl,
      sourceAudioUrl: requestedAudioUrl,
    };
    const currentLipsyncAssets = normalizeLipsyncAssets(project.lipsync_assets || [], manifest);
    if (currentLipsyncAssets.some((asset) => asset.provider === lipsyncProvider && asset.status === "PROCESSING" && matchesLipsyncLineage(asset, lineage))) {
      setLipsyncError("This exact clip and dialogue take already have a lip-sync render in progress. Keep the proof open while it finishes.");
      return false;
    }

    const runId = lipsyncRunRef.current + 1;
    lipsyncRunRef.current = runId;
    lipsyncTargetRef.current = {
      ...lineage,
      projectId,
      predictionId: null,
      runId,
    };
    lipsyncStartLockRef.current = true;
    setIsStartingLipsync(true);
    setLipsyncError(null);

    try {
      const response = isDialogueCloseupSource
        ? await pixverseLipsync({
            operation: "start",
            project_id: projectId,
            scene_number: lineage.sceneNumber,
            line_id: lineage.lineId,
            clip_prediction_id: lineage.clipPredictionId,
            character_id: lineage.characterId,
            text: lineage.text,
            source_video_url: lineage.sourceVideoUrl,
            source_audio_url: lineage.sourceAudioUrl,
          })
        : await replicateLipsync({
            operation: "start",
            project_id: projectId,
            scene_number: lineage.sceneNumber,
            line_id: lineage.lineId,
            clip_prediction_id: lineage.clipPredictionId,
            character_id: lineage.characterId,
            text: lineage.text,
            source_video_url: lineage.sourceVideoUrl,
            source_audio_url: lineage.sourceAudioUrl,
          });
      if (!isCurrentLipsyncTarget(projectId, null, runId)) return false;
      if (response.error) throw new Error(response.error);

      const predictionId = normalizeLipsyncPredictionId(response.prediction_id);
      if (!predictionId || response.status !== "PROCESSING") {
        throw new Error("The lip-sync service did not return a processing prediction. Nothing new was saved, so retry this take.");
      }
      const responseSourcePredictionId = isDialogueCloseupSource
        ? response.clip_prediction_id || response.source_clip_prediction_id
        : response.clip_prediction_id;
      if (
        response.scene_number !== lineage.sceneNumber ||
        response.line_id !== lineage.lineId ||
        response.character_id !== lineage.characterId ||
        responseSourcePredictionId !== lineage.clipPredictionId
      ) {
        throw new Error("The lip-sync service returned a different source lineage. Nothing new was saved, so retry this take.");
      }

      const currentProject = projectsRef.current.find((item) => item.id === projectId);
      if (!currentProject || !isCurrentLipsyncTarget(projectId, null, runId)) return false;
      const now = new Date().toISOString();
      const nextAsset: LipsyncAsset = {
        provider: lipsyncProvider,
        prediction_id: predictionId,
        scene_number: lineage.sceneNumber,
        line_id: lineage.lineId,
        character_id: lineage.characterId,
        text: lineage.text,
        source_clip_prediction_id: lineage.clipPredictionId,
        source_video_url: lineage.sourceVideoUrl,
        source_audio_url: lineage.sourceAudioUrl,
        source_audio_content_type: "audio/mpeg",
        status: "PROCESSING",
        remote_status: normalizeLipsyncRemoteStatus(response.remote_status, "processing"),
        video_url: null,
        created_at: now,
        updated_at: now,
        error: null,
      };
      const latestAssets = normalizeLipsyncAssets(currentProject.lipsync_assets || [], manifest);
      const nextAssets = normalizeLipsyncAssets(upsertLipsyncAsset(latestAssets, nextAsset), manifest);
      if (!nextAssets.some((asset) => asset.prediction_id === predictionId && asset.provider === lipsyncProvider && asset.status === "PROCESSING" && matchesLipsyncLineage(asset, lineage))) {
        throw new Error("The processing lip-sync attempt could not be validated against the saved source lineage. Your earlier proofs remain safe.");
      }

      await updateDramaProjectRecord(projectId, { lipsync_assets: nextAssets });
      if (!isCurrentLipsyncTarget(projectId, null, runId)) return false;
      applyProjectPatch(projectId, { lipsync_assets: nextAssets });
      lipsyncTargetRef.current = {
        ...lineage,
        projectId,
        predictionId,
        runId,
      };
      setLipsyncError(null);
      return true;
    } catch (error) {
      if (!isCurrentLipsyncTarget(projectId, null, runId)) return false;
      console.error("Lip-sync start failed:", error);
      setLipsyncError(
        readableLipsyncError(
          error,
          "The private lip-sync render could not start. Your source clip, dialogue take, and earlier proofs are safe, so retry this take."
        )
      );
      return false;
    } finally {
      if (lipsyncRunRef.current === runId) {
        lipsyncStartLockRef.current = false;
        setIsStartingLipsync(false);
      }
    }
  };

  // Handler: Check one stored PROCESSING lip-sync prediction.
  const handleCheckLipsync = async ({ predictionId }: LipSyncStatusInput): Promise<boolean> => {
    if (!isAuth) {
      setLipsyncError("Your creator session is no longer active. Sign in again before checking lip-sync status.");
      return false;
    }
    const projectId = selectedProjectIdRef.current;
    const project = projectsRef.current.find((item) => item.id === projectId);
    const normalizedPredictionId = normalizeLipsyncPredictionId(predictionId);
    if (!projectId || !project || !normalizedPredictionId) {
      setLipsyncError("Choose a saved project and a valid processing lip-sync prediction before checking status.");
      return false;
    }

    const manifestValidation = project.manifest
      ? validateManifest(project.manifest, project.scene_count)
      : { valid: false, error: "No approved screenplay is saved for this project." };
    if (!manifestValidation.valid || !manifestValidation.manifest) {
      setLipsyncError(manifestValidation.error || "The approved screenplay could not be validated for this lip-sync attempt.");
      return false;
    }
    const manifest = manifestValidation.manifest;
    const currentAssets = normalizeLipsyncAssets(project.lipsync_assets || [], manifest);
    const currentAsset = currentAssets.find((asset) => asset.prediction_id === normalizedPredictionId);
    if (!currentAsset || currentAsset.status !== "PROCESSING") {
      setLipsyncError("This lip-sync prediction is no longer processing. Refresh the project to see its saved result.");
      return false;
    }
    const lipsyncProvider = currentAsset.provider;

    const lineage: LipsyncLineage = {
      sceneNumber: currentAsset.scene_number,
      lineId: currentAsset.line_id,
      characterId: currentAsset.character_id,
      text: currentAsset.text,
      clipPredictionId: currentAsset.source_clip_prediction_id,
      sourceVideoUrl: currentAsset.source_video_url,
      sourceAudioUrl: currentAsset.source_audio_url,
    };
    if (lipsyncInFlightRef.current) return false;
    let runId = lipsyncRunRef.current;
    const existingTarget = lipsyncTargetRef.current;
    if (
      !existingTarget ||
      existingTarget.projectId !== projectId ||
      existingTarget.predictionId !== normalizedPredictionId ||
      !matchesLipsyncLineage(currentAsset, existingTarget)
    ) {
      runId += 1;
      lipsyncRunRef.current = runId;
      lipsyncTargetRef.current = {
        ...lineage,
        projectId,
        predictionId: normalizedPredictionId,
        runId,
      };
    } else {
      runId = existingTarget.runId;
    }
    lipsyncInFlightRef.current = true;

    try {
      const response = lipsyncProvider === "pixverse-lipsync"
        ? await pixverseLipsync({
            operation: "status",
            project_id: projectId,
            prediction_id: normalizedPredictionId,
          })
        : await replicateLipsync({
            operation: "status",
            project_id: projectId,
            prediction_id: normalizedPredictionId,
          });
      if (!isCurrentLipsyncTarget(projectId, normalizedPredictionId, runId)) return false;
      if (response.error && response.status !== "FAILED" && response.status !== "CANCELED") {
        throw new Error(response.error);
      }
      const responsePredictionId = normalizeLipsyncPredictionId(response.prediction_id);
      if (responsePredictionId !== normalizedPredictionId) {
        throw new Error("The lip-sync service returned a different prediction. The saved attempt remains unchanged.");
      }
      const responseSourcePredictionId = lipsyncProvider === "pixverse-lipsync"
        ? response.clip_prediction_id || response.source_clip_prediction_id
        : response.clip_prediction_id;
      if (
        (response.scene_number !== undefined && response.scene_number !== lineage.sceneNumber) ||
        (response.line_id !== undefined && response.line_id !== lineage.lineId) ||
        (response.character_id !== undefined && response.character_id !== lineage.characterId) ||
        (responseSourcePredictionId !== undefined && responseSourcePredictionId !== lineage.clipPredictionId)
      ) {
        throw new Error("The lip-sync service returned a different source lineage. The saved attempt remains unchanged.");
      }

      const latestProject = projectsRef.current.find((item) => item.id === projectId);
      if (!latestProject || !isCurrentLipsyncTarget(projectId, normalizedPredictionId, runId)) return false;
      const latestAssets = normalizeLipsyncAssets(latestProject.lipsync_assets || [], manifest);
      const latestAsset = latestAssets.find(
        (asset) => asset.prediction_id === normalizedPredictionId && asset.provider === lipsyncProvider
      );
      if (!latestAsset || latestAsset.status !== "PROCESSING" || !matchesLipsyncLineage(latestAsset, lineage)) {
        setLipsyncError("The saved lip-sync lineage changed while this status check was running. Refresh the project before checking again.");
        return false;
      }

      let nextStatus: LipsyncAsset["status"];
      let nextRemoteStatus: LipsyncRemoteStatus;
      let nextVideoUrl: string | null = null;
      let nextError: string | null = null;
      if (response.status === "PROCESSING") {
        nextStatus = "PROCESSING";
        nextRemoteStatus = normalizeLipsyncRemoteStatus(response.remote_status, "processing");
      } else if (response.status === "READY") {
        const contentType = typeof response.content_type === "string"
          ? response.content_type.split(";", 1)[0].trim().toLowerCase()
          : "";
        if (!isManagedHttpsVideoUrl(response.file_url) || contentType !== "video/mp4") {
          nextStatus = "FAILED";
          nextRemoteStatus = "failed";
          nextError = "The lip-sync service returned an invalid private MP4. The saved source clip and dialogue take are safe, so retry this take.";
        } else {
          nextStatus = "READY";
          nextRemoteStatus = "succeeded";
          nextVideoUrl = response.file_url.trim();
        }
      } else if (response.status === "FAILED") {
        nextStatus = "FAILED";
        nextRemoteStatus = normalizeLipsyncRemoteStatus(response.remote_status, "failed");
        nextError = readableLipsyncError(
          response.error ? new Error(response.error) : null,
          "The lip-sync provider could not finish this render. Your saved source clip and dialogue take are safe, so retry this take."
        );
      } else if (response.status === "CANCELED") {
        nextStatus = "CANCELED";
        nextRemoteStatus = normalizeLipsyncRemoteStatus(response.remote_status, "canceled");
        nextError = readableLipsyncError(
          response.error ? new Error(response.error) : null,
          "The lip-sync render was canceled before producing a video. Your saved source clip and dialogue take are safe, so retry this take."
        );
      } else {
        throw new Error("The lip-sync service returned an unsupported status. The saved attempt remains unchanged.");
      }

      const nextAssets = normalizeLipsyncAssets(
        updateLipsyncAsset(
          latestAssets,
          normalizedPredictionId,
          {
            status: nextStatus,
            remote_status: nextRemoteStatus,
            video_url: nextVideoUrl,
            error: nextError,
            updated_at: new Date().toISOString(),
          },
          lipsyncProvider
        ),
        manifest
      );
      if (!nextAssets.some((asset) => asset.prediction_id === normalizedPredictionId && asset.provider === lipsyncProvider && asset.status === nextStatus && matchesLipsyncLineage(asset, lineage))) {
        throw new Error("The lip-sync status could not be validated against the saved source lineage. Earlier proofs remain safe.");
      }

      await updateDramaProjectRecord(projectId, { lipsync_assets: nextAssets });
      if (!isCurrentLipsyncTarget(projectId, normalizedPredictionId, runId)) return false;
      applyProjectPatch(projectId, { lipsync_assets: nextAssets });
      setLipsyncError(nextStatus === "PROCESSING" ? null : nextError);
      return true;
    } catch (error) {
      if (!isCurrentLipsyncTarget(projectId, normalizedPredictionId, runId)) return false;
      console.error("Lip-sync status check failed:", error);
      setLipsyncError(
        readableLipsyncError(
          error,
          "The private lip-sync status could not be saved. The processing attempt and earlier proofs are safe, so this proof will try again."
        )
      );
      return false;
    } finally {
      if (lipsyncRunRef.current === runId) lipsyncInFlightRef.current = false;
    }
  };

  // Handler: Start one isolated PixVerse comparison from the exact saved close-up and MP3.
  const handleStartPixverseLipsync = async ({
    sceneNumber,
    lineId,
    characterId,
    text,
    clipPredictionId,
    sourceVideoUrl,
    sourceAudioUrl,
    sourceClipKind,
  }: PixverseLipsyncStartInput): Promise<boolean> => {
    const blockedByStudioOperation =
      pixverseLipsyncStartLockRef.current ||
      pixverseLipsyncInFlightRef.current ||
      lipsyncStartLockRef.current ||
      lipsyncInFlightRef.current ||
      opLockRef.current ||
      isGenerating ||
      isGeneratingFrames ||
      isSaving ||
      isStartingVisualProduction ||
      synthesisBusy ||
      audioSynthesisLockRef.current ||
      ambienceBusy ||
      ambienceGenerationLockRef.current ||
      hasActiveVideoOperation();
    if (blockedByStudioOperation) {
      setPixverseLipsyncError("Wait for the current studio operation to finish before starting the PixVerse comparison.");
      return false;
    }
    const session = authSessionRef.current;
    if (!isAuth || !session.authenticated) {
      setPixverseLipsyncError("Sign in before starting a private PixVerse comparison.");
      return false;
    }
    if (isEditorDirty) {
      setPixverseLipsyncError("Save screenplay edits before rendering from the approved close-up and dialogue take.");
      return false;
    }
    if (sourceClipKind !== "dialogue_closeup") {
      setPixverseLipsyncError("PixVerse comparison accepts the reviewed dialogue close-up source only.");
      return false;
    }

    const projectId = selectedProjectIdRef.current;
    const project = projectsRef.current.find((item) => item.id === projectId);
    if (!projectId || !project || project.status !== "SCRIPTED" || !project.production_approved || !project.manifest) {
      setPixverseLipsyncError("Approve and save the screenplay before starting a private PixVerse comparison.");
      return false;
    }
    if (project.orientation !== "vertical") {
      setPixverseLipsyncError("PixVerse comparison currently uses the saved vertical 9:16 production path.");
      return false;
    }

    const manifestValidation = validateManifest(project.manifest, project.scene_count);
    if (!manifestValidation.valid || !manifestValidation.manifest) {
      setPixverseLipsyncError(manifestValidation.error || "Save a valid approved screenplay before starting PixVerse comparison.");
      return false;
    }
    const manifest = manifestValidation.manifest;
    const normalizedSceneNumber = Number(sceneNumber);
    if (!Number.isInteger(normalizedSceneNumber) || normalizedSceneNumber < 1 || normalizedSceneNumber > 99) {
      setPixverseLipsyncError("Choose a valid saved scene before starting PixVerse comparison.");
      return false;
    }
    const scene = manifest.scenes.find((candidate) => candidate.scene_number === normalizedSceneNumber);
    if (!scene) {
      setPixverseLipsyncError("The selected scene is no longer in the approved screenplay. Refresh the project and retry.");
      return false;
    }

    const normalizedLineId = normalizeLipsyncLineId(lineId);
    const savedLine = normalizedLineId
      ? deriveDialogueLines(scene).find((line) => line.line_id === normalizedLineId)
      : null;
    if (!savedLine || savedLine.character_id !== characterId || savedLine.text !== text) {
      setPixverseLipsyncError("The selected dialogue line changed. Refresh the project and choose the current saved line.");
      return false;
    }

    const normalizedClipPredictionId = normalizeLipsyncPredictionId(clipPredictionId);
    const requestedVideoUrl = typeof sourceVideoUrl === "string" ? sourceVideoUrl.trim() : "";
    const requestedAudioUrl = typeof sourceAudioUrl === "string" ? sourceAudioUrl.trim() : "";
    if (!normalizedClipPredictionId || !isManagedHttpsVideoUrl(requestedVideoUrl) || !isManagedHttpsAudioUrl(requestedAudioUrl)) {
      setPixverseLipsyncError("The selected source media is not stored on secure managed URLs. Choose the current READY close-up and dialogue take again.");
      return false;
    }

    const closeupClip = normalizeDialogueShotClips(project.dialogue_shot_clips || [], manifest).find(
      (clip) =>
        clip.provider === "replicate-luma" &&
        clip.prediction_id === normalizedClipPredictionId &&
        clip.scene_number === normalizedSceneNumber &&
        clip.line_id === savedLine.line_id &&
        clip.character_id === savedLine.character_id &&
        clip.text === savedLine.text &&
        clip.shot_role === "dialogue_closeup" &&
        clip.duration_seconds === 5 &&
        clip.status === "READY" &&
        clip.video_url === requestedVideoUrl &&
        isManagedHttpsVideoUrl(clip.video_url)
    );
    if (!closeupClip) {
      setPixverseLipsyncError("That close-up is no longer the saved READY five-second source for this line. Refresh the project and choose the current private shot.");
      return false;
    }

    const currentAudioAssets = normalizeDialogueAudioAssets(project.audio_assets || [], manifest);
    const currentAudio = currentAudioAssets.find(
      (asset) =>
        asset.asset_type === "dialogue" &&
        asset.provider === "elevenlabs" &&
        asset.status === "READY" &&
        asset.scene_number === normalizedSceneNumber &&
        asset.line_id === savedLine.line_id &&
        asset.character_id === savedLine.character_id &&
        asset.text === savedLine.text &&
        asset.audio_url === requestedAudioUrl &&
        asset.content_type === "audio/mpeg" &&
        isManagedHttpsAudioUrl(asset.audio_url)
    );
    if (!currentAudio) {
      setPixverseLipsyncError("The selected dialogue take is no longer the current READY MP3 for this line. Refresh the project and retry.");
      return false;
    }

    const lineage: LipsyncLineage = {
      sceneNumber: normalizedSceneNumber,
      lineId: savedLine.line_id,
      characterId: savedLine.character_id,
      text: savedLine.text,
      clipPredictionId: normalizedClipPredictionId,
      sourceVideoUrl: requestedVideoUrl,
      sourceAudioUrl: requestedAudioUrl,
    };
    const currentPixverseAssets = normalizePixverseLipsyncAssets(project.pixverse_lipsync_assets || [], manifest);
    if (currentPixverseAssets.some((asset) => asset.status === "PROCESSING" && matchesPixverseLipsyncLineage(asset, lineage))) {
      setPixverseLipsyncError("This exact close-up and dialogue take already have a PixVerse comparison rendering. Keep the comparison open while it finishes.");
      return false;
    }

    const authEpoch = session.epoch;
    const runId = pixverseLipsyncRunRef.current + 1;
    pixverseLipsyncRunRef.current = runId;
    pixverseLipsyncTargetRef.current = {
      ...lineage,
      projectId,
      predictionId: null,
      runId,
      authEpoch,
    };
    pixverseLipsyncStartLockRef.current = true;
    setIsStartingPixverseLipsync(true);
    setPixverseLipsyncError(null);

    try {
      const response = await pixverseLipsync({
        operation: "start",
        project_id: projectId,
        scene_number: lineage.sceneNumber,
        line_id: lineage.lineId,
        clip_prediction_id: lineage.clipPredictionId,
        character_id: lineage.characterId,
        text: lineage.text,
        source_video_url: lineage.sourceVideoUrl,
        source_audio_url: lineage.sourceAudioUrl,
      });
      if (!isCurrentPixverseLipsyncTarget(projectId, null, runId, authEpoch)) return false;
      if (response.error) throw new Error(response.error);

      const predictionId = normalizeLipsyncPredictionId(response.prediction_id);
      if (!predictionId || response.status !== "PROCESSING") {
        throw new Error("PixVerse did not return a processing prediction. Nothing new was saved, so retry this comparison.");
      }
      if (
        response.scene_number !== lineage.sceneNumber ||
        response.line_id !== lineage.lineId ||
        response.character_id !== lineage.characterId ||
        (response.clip_prediction_id || response.source_clip_prediction_id) !== lineage.clipPredictionId
      ) {
        throw new Error("PixVerse returned a different source lineage. Nothing new was saved, so retry this comparison.");
      }

      const currentProject = projectsRef.current.find((item) => item.id === projectId);
      if (!currentProject || !isCurrentPixverseLipsyncTarget(projectId, null, runId, authEpoch)) return false;
      const now = new Date().toISOString();
      const nextAsset: PixverseLipsyncAsset = {
        provider: "pixverse-lipsync",
        prediction_id: predictionId,
        scene_number: lineage.sceneNumber,
        line_id: lineage.lineId,
        character_id: lineage.characterId,
        text: lineage.text,
        source_clip_prediction_id: lineage.clipPredictionId,
        source_video_url: lineage.sourceVideoUrl,
        source_audio_url: lineage.sourceAudioUrl,
        source_audio_content_type: "audio/mpeg",
        status: "PROCESSING",
        remote_status: normalizeLipsyncRemoteStatus(response.remote_status, "processing"),
        video_url: null,
        created_at: now,
        updated_at: now,
        error: null,
      };
      const latestAssets = normalizePixverseLipsyncAssets(currentProject.pixverse_lipsync_assets || [], manifest);
      const nextAssets = normalizePixverseLipsyncAssets(
        upsertPixverseLipsyncAsset(latestAssets, nextAsset),
        manifest
      );
      if (!nextAssets.some((asset) => asset.prediction_id === predictionId && asset.status === "PROCESSING" && matchesPixverseLipsyncLineage(asset, lineage))) {
        throw new Error("The PixVerse processing attempt could not be validated against the saved source lineage. Earlier proofs remain safe.");
      }

      await updateDramaProjectRecord(projectId, { pixverse_lipsync_assets: nextAssets });
      if (!isCurrentPixverseLipsyncTarget(projectId, null, runId, authEpoch)) return false;
      applyProjectPatch(projectId, { pixverse_lipsync_assets: nextAssets });
      pixverseLipsyncTargetRef.current = {
        ...lineage,
        projectId,
        predictionId,
        runId,
        authEpoch,
      };
      setPixverseLipsyncError(null);
      return true;
    } catch (error) {
      if (!isCurrentPixverseLipsyncTarget(projectId, null, runId, authEpoch)) return false;
      console.error("PixVerse lip-sync start failed:", error);
      setPixverseLipsyncError(
        readableLipsyncError(
          error,
          "The PixVerse comparison could not start. Your source clip, dialogue take, and earlier proofs are safe, so retry this take."
        )
      );
      return false;
    } finally {
      if (pixverseLipsyncRunRef.current === runId) {
        pixverseLipsyncStartLockRef.current = false;
        setIsStartingPixverseLipsync(false);
      }
    }
  };

  // Handler: Check one stored PROCESSING PixVerse comparison prediction.
  const handleCheckPixverseLipsync = async ({ predictionId }: PixverseLipsyncStatusInput): Promise<boolean> => {
    const session = authSessionRef.current;
    if (!isAuth || !session.authenticated) {
      setPixverseLipsyncError("Your creator session is no longer active. Sign in again before checking PixVerse status.");
      return false;
    }
    const authEpoch = session.epoch;
    const projectId = selectedProjectIdRef.current;
    const project = projectsRef.current.find((item) => item.id === projectId);
    const normalizedPredictionId = normalizeLipsyncPredictionId(predictionId);
    if (!projectId || !project || !normalizedPredictionId) {
      setPixverseLipsyncError("Choose a saved project and a valid processing PixVerse prediction before checking status.");
      return false;
    }

    const manifestValidation = project.manifest
      ? validateManifest(project.manifest, project.scene_count)
      : { valid: false, error: "No approved screenplay is saved for this project." };
    if (!manifestValidation.valid || !manifestValidation.manifest) {
      setPixverseLipsyncError(manifestValidation.error || "The approved screenplay could not be validated for this PixVerse attempt.");
      return false;
    }
    const manifest = manifestValidation.manifest;
    const currentAssets = normalizePixverseLipsyncAssets(project.pixverse_lipsync_assets || [], manifest);
    const currentAsset = currentAssets.find((asset) => asset.prediction_id === normalizedPredictionId);
    if (!currentAsset || currentAsset.status !== "PROCESSING") {
      setPixverseLipsyncError("This PixVerse prediction is no longer processing. Refresh the project to see its saved result.");
      return false;
    }

    const lineage: LipsyncLineage = {
      sceneNumber: currentAsset.scene_number,
      lineId: currentAsset.line_id,
      characterId: currentAsset.character_id,
      text: currentAsset.text,
      clipPredictionId: currentAsset.source_clip_prediction_id,
      sourceVideoUrl: currentAsset.source_video_url,
      sourceAudioUrl: currentAsset.source_audio_url,
    };
    if (pixverseLipsyncInFlightRef.current) return false;
    let runId = pixverseLipsyncRunRef.current;
    const existingTarget = pixverseLipsyncTargetRef.current;
    if (
      !existingTarget ||
      existingTarget.projectId !== projectId ||
      existingTarget.predictionId !== normalizedPredictionId ||
      existingTarget.authEpoch !== authEpoch ||
      !matchesPixverseLipsyncLineage(currentAsset, existingTarget)
    ) {
      runId += 1;
      pixverseLipsyncRunRef.current = runId;
      pixverseLipsyncTargetRef.current = {
        ...lineage,
        projectId,
        predictionId: normalizedPredictionId,
        runId,
        authEpoch,
      };
    } else {
      runId = existingTarget.runId;
    }
    pixverseLipsyncInFlightRef.current = true;

    try {
      const response = await pixverseLipsync({
        operation: "status",
        project_id: projectId,
        prediction_id: normalizedPredictionId,
      });
      if (!isCurrentPixverseLipsyncTarget(projectId, normalizedPredictionId, runId, authEpoch)) return false;
      if (response.error && response.status !== "FAILED" && response.status !== "CANCELED") {
        throw new Error(response.error);
      }
      const responsePredictionId = normalizeLipsyncPredictionId(response.prediction_id);
      if (responsePredictionId !== normalizedPredictionId) {
        throw new Error("PixVerse returned a different prediction. The saved comparison remains unchanged.");
      }
      if (
        response.scene_number !== lineage.sceneNumber ||
        response.line_id !== lineage.lineId ||
        response.character_id !== lineage.characterId ||
        (response.clip_prediction_id || response.source_clip_prediction_id) !== lineage.clipPredictionId
      ) {
        throw new Error("PixVerse returned a different source lineage. The saved comparison remains unchanged.");
      }

      const latestProject = projectsRef.current.find((item) => item.id === projectId);
      if (!latestProject || !isCurrentPixverseLipsyncTarget(projectId, normalizedPredictionId, runId, authEpoch)) return false;
      const latestAssets = normalizePixverseLipsyncAssets(latestProject.pixverse_lipsync_assets || [], manifest);
      const latestAsset = latestAssets.find((asset) => asset.prediction_id === normalizedPredictionId);
      if (!latestAsset || latestAsset.status !== "PROCESSING" || !matchesPixverseLipsyncLineage(latestAsset, lineage)) {
        setPixverseLipsyncError("The saved PixVerse lineage changed while this status check was running. Refresh the project before checking again.");
        return false;
      }

      let nextStatus: PixverseLipsyncAsset["status"];
      let nextRemoteStatus: LipsyncRemoteStatus;
      let nextVideoUrl: string | null = null;
      let nextError: string | null = null;
      if (response.status === "PROCESSING") {
        nextStatus = "PROCESSING";
        nextRemoteStatus = normalizeLipsyncRemoteStatus(response.remote_status, "processing");
      } else if (response.status === "READY") {
        const contentType = typeof response.content_type === "string"
          ? response.content_type.split(";", 1)[0].trim().toLowerCase()
          : "";
        if (!isManagedHttpsVideoUrl(response.file_url) || contentType !== "video/mp4") {
          nextStatus = "FAILED";
          nextRemoteStatus = "failed";
          nextError = "PixVerse returned an invalid private MP4. The saved source clip and dialogue take are safe, so retry this comparison.";
        } else {
          nextStatus = "READY";
          nextRemoteStatus = "succeeded";
          nextVideoUrl = response.file_url.trim();
        }
      } else if (response.status === "FAILED") {
        nextStatus = "FAILED";
        nextRemoteStatus = normalizeLipsyncRemoteStatus(response.remote_status, "failed");
        nextError = readableLipsyncError(
          response.error ? new Error(response.error) : null,
          "PixVerse could not finish this comparison. Your saved source clip and dialogue take are safe, so retry this take."
        );
      } else if (response.status === "CANCELED") {
        nextStatus = "CANCELED";
        nextRemoteStatus = normalizeLipsyncRemoteStatus(response.remote_status, "canceled");
        nextError = readableLipsyncError(
          response.error ? new Error(response.error) : null,
          "The PixVerse comparison was canceled before producing a video. Your saved source clip and dialogue take are safe, so retry this take."
        );
      } else {
        throw new Error("PixVerse returned an unsupported status. The saved comparison remains unchanged.");
      }

      const nextAssets = normalizePixverseLipsyncAssets(
        updatePixverseLipsyncAsset(latestAssets, normalizedPredictionId, {
          status: nextStatus,
          remote_status: nextRemoteStatus,
          video_url: nextVideoUrl,
          error: nextError,
          updated_at: new Date().toISOString(),
        }),
        manifest
      );
      if (!nextAssets.some((asset) => asset.prediction_id === normalizedPredictionId && asset.status === nextStatus && matchesPixverseLipsyncLineage(asset, lineage))) {
        throw new Error("The PixVerse status could not be validated against the saved source lineage. Earlier proofs remain safe.");
      }

      await updateDramaProjectRecord(projectId, { pixverse_lipsync_assets: nextAssets });
      if (!isCurrentPixverseLipsyncTarget(projectId, normalizedPredictionId, runId, authEpoch)) return false;
      applyProjectPatch(projectId, { pixverse_lipsync_assets: nextAssets });
      setPixverseLipsyncError(nextStatus === "PROCESSING" ? null : nextError);
      return true;
    } catch (error) {
      if (!isCurrentPixverseLipsyncTarget(projectId, normalizedPredictionId, runId, authEpoch)) return false;
      console.error("PixVerse lip-sync status check failed:", error);
      setPixverseLipsyncError(
        readableLipsyncError(
          error,
          "The PixVerse status could not be saved. The processing comparison and earlier proofs are safe, so use Check status again when ready."
        )
      );
      return false;
    } finally {
      if (pixverseLipsyncRunRef.current === runId) pixverseLipsyncInFlightRef.current = false;
    }
  };

  // Handler: Generate and privately save one ambience bed for one exact saved scene.
  const handleGenerateAmbience = async ({
    sceneNumber,
    prompt,
    durationSeconds,
  }: {
    sceneNumber: number;
    prompt: string;
    durationSeconds: number;
  }): Promise<boolean> => {
    if (
      ambienceGenerationLockRef.current ||
      opLockRef.current ||
      isGenerating ||
      isGeneratingFrames ||
      isSaving ||
      isStartingVisualProduction ||
      synthesisBusy ||
      audioSynthesisLockRef.current ||
      hasActiveVideoOperation()
    ) {
      setAmbienceError("Wait for the current studio operation to finish before generating ambience.");
      return false;
    }
    if (!isAuth) {
      setAmbienceError("Sign in before generating a private ambience bed.");
      return false;
    }
    if (isEditorDirty) {
      setAmbienceError("Save screenplay edits before generating ambience from the approved scene.");
      return false;
    }

    const projectId = selectedProjectIdRef.current;
    const project = projectsRef.current.find((item) => item.id === projectId);
    if (!projectId || !project || project.status !== "SCRIPTED" || !project.production_approved || !project.manifest) {
      setAmbienceError("Approve and save the screenplay before generating ambience.");
      return false;
    }

    const manifestValidation = validateManifest(project.manifest, project.scene_count);
    if (!manifestValidation.valid || !manifestValidation.manifest) {
      setAmbienceError(manifestValidation.error || "Save a valid approved screenplay before generating ambience.");
      return false;
    }
    const manifest = manifestValidation.manifest;
    const scene = manifest.scenes.find((candidate) => candidate.scene_number === sceneNumber);
    if (!scene) {
      setAmbienceError("Choose one saved screenplay scene before generating ambience.");
      return false;
    }
    const cleanPrompt = typeof prompt === "string" ? prompt.trim() : "";
    const requestedDuration = Number(durationSeconds);
    const promptInvalid =
      cleanPrompt.length < 3 ||
      cleanPrompt.length > MAX_AMBIENCE_USER_PROMPT_LENGTH ||
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(cleanPrompt);
    const durationInvalid =
      !Number.isFinite(requestedDuration) ||
      requestedDuration < 3 ||
      requestedDuration > 20;
    if (promptInvalid || durationInvalid) {
      setAmbienceError(
        promptInvalid
          ? `Use a room-tone prompt between 3 and ${MAX_AMBIENCE_USER_PROMPT_LENGTH} characters.`
          : "Use an ambience duration from 3 to 20 seconds."
      );
      return false;
    }

    const duration = Math.round(requestedDuration * 10) / 10;
    ambienceGenerationLockRef.current = true;
    setAmbienceBusy(true);
    setAmbienceError(null);

    try {
      const response = await elevenLabsSound({
        operation: "generate_ambience",
        project_id: projectId,
        scene_number: scene.scene_number,
        prompt: cleanPrompt,
        duration_seconds: duration,
      });

      if (selectedProjectIdRef.current !== projectId) return false;
      if (response.error) throw new Error(response.error);
      if (response.scene_number !== scene.scene_number) {
        throw new Error("The ambience service returned a different scene. Your previous ambience remains safe.");
      }
      if (!isManagedHttpsAudioUrl(response.audio_url)) {
        throw new Error("The ambience service did not return a secure managed audio URL. Your previous ambience remains safe.");
      }
      const responseContentType = typeof response.content_type === "string"
        ? response.content_type.split(";", 1)[0].trim().toLowerCase()
        : "";
      if (responseContentType !== "audio/mpeg") {
        throw new Error("The ambience service returned an unsupported audio format. Your previous ambience remains safe.");
      }
      const returnedDuration = Number(response.duration_seconds);
      if (!Number.isFinite(returnedDuration) || returnedDuration < 3 || returnedDuration > 20) {
        throw new Error("The ambience service returned an invalid duration. Your previous ambience remains safe.");
      }
      const returnedPrompt = typeof response.prompt === "string" && response.prompt.trim()
        ? response.prompt.trim()
        : cleanPrompt;
      if (returnedPrompt.length > MAX_AMBIENCE_PROVIDER_PROMPT_LENGTH || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(returnedPrompt)) {
        throw new Error("The ambience service returned invalid prompt metadata. Your previous ambience remains safe.");
      }

      const currentProject = projectsRef.current.find((item) => item.id === projectId);
      if (!currentProject || selectedProjectIdRef.current !== projectId) return false;
      const now = new Date().toISOString();
      const currentAmbienceAssets = normalizeAmbienceAudioAssets(currentProject.ambience_assets || [], manifest);
      const nextAsset: AmbienceAudioAsset = {
        asset_type: "ambience",
        provider: "elevenlabs",
        scene_number: scene.scene_number,
        prompt: returnedPrompt,
        audio_url: response.audio_url,
        content_type: "audio/mpeg",
        duration_seconds: returnedDuration,
        status: "READY",
        created_at: now,
        updated_at: now,
        error: null,
      };
      const nextAmbienceAssets = normalizeAmbienceAudioAssets(
        replaceLatestAmbienceAudioAsset(currentAmbienceAssets, nextAsset),
        manifest
      );
      if (!nextAmbienceAssets.some((asset) =>
        asset.scene_number === scene.scene_number &&
        asset.audio_url === response.audio_url &&
        asset.status === "READY"
      )) {
        throw new Error("The generated ambience could not be validated against the saved scene. Your previous ambience remains safe.");
      }

      await updateDramaProjectRecord(projectId, { ambience_assets: nextAmbienceAssets });
      if (selectedProjectIdRef.current !== projectId) return false;
      applyProjectPatch(projectId, { ambience_assets: nextAmbienceAssets });
      setAmbienceError(null);
      return true;
    } catch (error) {
      if (selectedProjectIdRef.current !== projectId) return false;
      console.error("Ambience generation failed:", error);
      const raw = error instanceof Error ? error.message : "";
      const safeMessage = raw && !/api[_ -]?key|secret|bearer|authorization/i.test(raw)
        ? raw.slice(0, 600)
        : "The ambience bed could not be created. Your previous ambience remains available, so retry this scene.";
      setAmbienceError(safeMessage);
      return false;
    } finally {
      ambienceGenerationLockRef.current = false;
      setAmbienceBusy(false);
    }
  };

  // Handler: Logout safely
  const handleLogout = async () => {
    if (!confirmDiscardUnsavedChanges()) return;
    invalidateSceneCoverageRun();
    stopVideoPolling();
    stopLipsyncTracking();
    stopPixverseLipsyncTracking();
    const wasAuthenticated = authSessionRef.current.authenticated;
    // Invalidate private in-flight saves before the session request completes.
    markAuthSession(false);
    try {
      await superdevClient.auth.logout();
      setIsAuth(false);
      setUserEmail(null);
      setProjects([]);
      selectedProjectIdRef.current = null;
      setSelectedProjectId(null);
      setIsEditorDirty(false);
      resetShotPlanPersistenceState();
      setVoices([]);
      voiceCacheRef.current = null;
      setVoiceLoading(false);
      setVoiceError(null);
      setSynthesisError(null);
      setAmbienceError(null);
      setAmbienceBusy(false);
      ambienceGenerationLockRef.current = false;
      setFrameError(null);
      setFrameProgress({ stage: "idle", current: 0, total: 0, completed: 0 });
    } catch (err) {
      // A failed logout request leaves the existing session usable. Restore it
      // with a new epoch so any operation started before the attempt stays stale.
      if (wasAuthenticated) markAuthSession(true);
      setIsAuth(wasAuthenticated);
      console.error("Logout failed:", err);
    }
  };

  const filteredProjects = projects.filter(
    (p) =>
      (p.title || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.prompt || "").toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Older records can keep a completed manifest while their workflow status still
  // reflects the pre-checkpoint flow. Route from the saved data first so a stale
  // status never strands a creator in the empty composer view.
  const selectedProjectManifestValidation = selectedProject?.manifest
    ? validateManifest(selectedProject.manifest, selectedProject.scene_count)
    : { valid: false, error: "No screenplay manifest is saved for this story." };
  const selectedProjectShotPlanValidationError = selectedProject?.shot_plan && !normalizeSavedShotPlanSnapshot(selectedProject.shot_plan)
    ? "The saved shot plan failed structural validation and stays outside the playable order."
    : null;
  const selectedProjectHasEditorSnapshot = Boolean(
    selectedProject && (
      selectedProject.manifest ||
      selectedProject.production_approved === true ||
      selectedProject.status === "AWAITING_SETUP_CONFIRM" ||
      selectedProject.status === "AWAITING_SCRIPT_CONFIRM"
    )
  );
  const selectedProjectEditorGateStatus = selectedProject
    ? selectedProject.production_approved === true
      ? "SCRIPTED"
      : selectedProject.manifest
        ? "AWAITING_SCRIPT_CONFIRM"
        : selectedProject.status
    : undefined;
  const selectedProjectStatusLabel = !selectedProject
    ? "No story selected"
    : selectedProject.production_approved === true && selectedProject.manifest
      ? "Approved screenplay, visual production available"
      : selectedProject.production_approved === true
        ? "Production approved, screenplay needs recovery"
        : selectedProject.status === "AWAITING_SETUP_CONFIRM"
          ? "Story setup ready for review"
          : selectedProject.status === "AWAITING_SCRIPT_CONFIRM"
            ? "Screenplay ready for review"
            : selectedProject.status === "SCRIPTED"
              ? "Screenplay saved, approval still needed"
              : selectedProject.status === "FAILED"
                ? "The last generation pass needs attention"
                : "Saved pitch, screenplay not available yet";

  return (
    <div className="flex h-screen w-full min-w-0 overflow-hidden bg-[#0a0c10] text-[#f1f5f9] font-sans">
      {/* Mobile Sidebar Overlay */}
      {mobileSidebarOpen && (
        <div
          onClick={() => setMobileSidebarOpen(false)}
          className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm lg:hidden"
        />
      )}

      {/* ===================== SIDEBAR ===================== */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 w-72 sm:w-80 bg-[#0d1017] border-r border-[#1a2130] flex flex-col transition-transform duration-200 ease-in-out ${
          mobileSidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        {/* Brand Header */}
        <div className="p-4 border-b border-[#1a2130] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg overflow-hidden border border-amber-500/30 shrink-0 bg-black">
              <img src={LOGO_URL} alt="Frame Logo" className="w-full h-full object-cover" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-serif font-bold text-base tracking-wider text-white">FRAME</span>
                <span className="text-[10px] font-mono uppercase bg-amber-500/20 text-amber-300 px-1.5 py-0.2 rounded border border-amber-500/30">
                  Studio
                </span>
              </div>
              <p className="text-[11px] text-gray-400">Cinematic Story Orchestration</p>
            </div>
          </div>

          <button
            onClick={() => setMobileSidebarOpen(false)}
            className="lg:hidden text-gray-400 hover:text-white p-1 rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Primary Action: New Story */}
        <div className="p-3">
          <Button
            onClick={handleNewStory}
            disabled={isGenerating || isGeneratingFrames || isSaving}
            className="w-full bg-amber-500 hover:bg-amber-600 text-black font-semibold h-10 gap-2 shadow-sm shadow-amber-500/10 disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            <span>New Story Script</span>
          </Button>
        </div>

        {/* Saved Projects Search & List */}
        <div className="px-3 pb-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-gray-400" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter saved scripts..."
              disabled={!isAuth || isGenerating || isGeneratingFrames || isSaving}
              className="bg-[#121622] border-[#20283c] pl-8 h-8 text-xs text-gray-200 placeholder:text-gray-400 focus-visible:ring-amber-500/40"
            />
          </div>
        </div>

        {/* Projects Scroll Area */}
        <div className="flex-1 overflow-y-auto px-3 py-1 space-y-1.5">
          <div className="flex items-center justify-between px-1 text-[11px] font-mono text-gray-400 uppercase tracking-wider mb-1">
            <span>Saved Stories ({projects.length})</span>
            {isAuth && (
              <button
                onClick={loadProjects}
                disabled={loadingProjects || isGenerating || isGeneratingFrames || isSaving}
                className="hover:text-amber-400 transition-colors p-0.5 disabled:opacity-40"
                title="Refresh project list"
              >
                <RefreshCw className={`w-3 h-3 ${loadingProjects ? "animate-spin" : ""}`} />
              </button>
            )}
          </div>

          {!isAuth ? (
            <div className="p-4 rounded-lg bg-[#121622]/50 border border-dashed border-[#20283c] text-center text-xs text-gray-400 space-y-2">
              <ShieldCheck className="w-5 h-5 mx-auto text-amber-400/80 mb-1" />
              <p className="font-medium text-gray-300">Creator Sign In</p>
              <p className="text-[11px] text-gray-400 leading-relaxed">
                Sign in to view and manage your saved vertical drama screenplays.
              </p>
            </div>
          ) : loadingProjects && projects.length === 0 ? (
            <div className="text-center py-8 text-xs text-gray-400">
              <div className="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              Loading stories from library...
            </div>
          ) : libraryError ? (
            <div className="p-3.5 rounded-lg bg-red-950/30 border border-red-800/40 text-left text-xs text-red-300 space-y-2">
              <div className="flex items-center gap-1.5 font-semibold text-red-300">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                <span>Library Unavailable</span>
              </div>
              <p className="text-[11px] text-red-300/80 leading-relaxed">{libraryError}</p>
              <Button
                onClick={loadProjects}
                size="sm"
                variant="outline"
                className="w-full text-xs h-7 border-red-800/60 bg-red-950/50 hover:bg-red-900/50 text-red-200 gap-1.5"
              >
                <RefreshCw className="w-3 h-3" /> Retry Loading
              </Button>
            </div>
          ) : filteredProjects.length === 0 ? (
            <div className="p-4 rounded-lg bg-[#121622]/50 border border-dashed border-[#20283c] text-center text-xs text-gray-400 space-y-1">
              <Clapperboard className="w-5 h-5 mx-auto text-gray-400 mb-1" />
              <p className="font-medium text-gray-300">No saved scripts yet</p>
              <p className="text-[11px] text-gray-400">
Compose a premise and create your first story setup. You will review it before the screenplay is written.
              </p>
            </div>
          ) : (
            filteredProjects.map((p) => {
              const isSelected = selectedProjectId === p.id;
              return (
                <div
                  key={p.id || p.uuid}
                  onClick={() => handleSelectProject(p)}
                  className={`group relative p-2.5 rounded-lg text-left cursor-pointer transition-all border ${
                    isSelected
                      ? "bg-[#182030] border-amber-500/50 shadow-sm"
                      : "bg-[#111520] border-[#1c2333] hover:bg-[#151b2a] hover:border-[#28334a]"
                  } ${isGenerating || isGeneratingFrames || isSaving ? "pointer-events-none opacity-80" : ""}`}
                >
                  <div className="flex items-start justify-between gap-1.5">
                    <div className="flex-1 min-w-0">
                      <p
                        className={`text-xs font-semibold truncate ${
                          isSelected ? "text-amber-300" : "text-gray-200 group-hover:text-white"
                        }`}
                      >
                        {p.title || "Untitled Drama"}
                      </p>
                      <p className="text-[11px] text-gray-400 line-clamp-1 mt-0.5">
                        {p.prompt || "No premise saved"}
                      </p>
                    </div>

                    <button
                      onClick={(e) => handleDeleteProject(e, p)}
                      disabled={isGenerating || isGeneratingFrames || isSaving}
                      className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-400 rounded hover:bg-red-950/30 transition-all shrink-0"
                      title="Delete script"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-1 mt-2 text-[10px] text-gray-400">
                    <span className="flex items-center gap-1 font-mono">
                      <Lock className="w-2.5 h-2.5 text-amber-400/70" /> #{p.seed}
                    </span>

                    {p.status === "SCRIPTED" && (
                      <span className="bg-emerald-950/50 text-emerald-300 border border-emerald-800/40 px-1.5 py-0.2 rounded text-[10px] font-mono">
                        {p.scene_count || 4} SCENES · READY
                      </span>
                    )}
                    {p.status === "AWAITING_SETUP_CONFIRM" && (
                      <span className="bg-amber-950/50 text-amber-300 border border-amber-800/40 px-1.5 py-0.2 rounded text-[10px] font-mono">
                        SETUP REVIEW
                      </span>
                    )}
                    {p.status === "AWAITING_SCRIPT_CONFIRM" && (
                      <span className="bg-amber-950/50 text-amber-300 border border-amber-800/40 px-1.5 py-0.2 rounded text-[10px] font-mono">
                        SCRIPT REVIEW
                      </span>
                    )}
                    {p.status === "PENDING" && (
                      <span className="bg-slate-950/70 text-slate-300 border border-slate-700/50 px-1.5 py-0.2 rounded text-[10px] font-mono">
                        PITCH SAVED
                      </span>
                    )}
                    {p.status === "FAILED" && (
                      <span className="bg-red-950/50 text-red-300 border border-red-800/40 px-1.5 py-0.2 rounded text-[10px] font-mono">
                        NEEDS RETRY
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Sidebar Footer: Authentication Status */}
        <div className="p-3 border-t border-[#1a2130] bg-[#0c0f16]">
          {authChecking ? (
            <div className="text-center py-2 text-xs text-gray-400">Checking auth...</div>
          ) : isAuth ? (
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-7 h-7 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-300 text-xs font-bold shrink-0">
                  {userEmail ? userEmail[0].toUpperCase() : "U"}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-gray-200 truncate">{userEmail || "Creator"}</p>
                  <p className="text-[10px] text-emerald-400 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Private Library Sync
                  </p>
                </div>
              </div>
              <button
                onClick={handleLogout}
                disabled={isGenerating || isGeneratingFrames || isSaving}
                className="p-1.5 text-gray-400 hover:text-white rounded hover:bg-[#1a2130] disabled:opacity-40"
                title="Log Out"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-[11px] text-gray-400 flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
                <span>Sign in to save and generate:</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <a
                  href={loginUrl}
                  className="inline-flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium rounded-md bg-[#182030] hover:bg-[#202b40] text-gray-200 border border-[#273248]"
                >
                  <LogIn className="w-3 h-3" /> Log In
                </a>
                <a
                  href={signupUrl}
                  className="inline-flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium rounded-md bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40"
                >
                  <UserPlus className="w-3 h-3" /> Sign Up
                </a>
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* ===================== MAIN WORKSPACE ===================== */}
      <main className="min-w-0 min-h-0 flex-1 flex flex-col h-full overflow-hidden bg-[#0a0c10]">
        {/* Mobile Header Bar */}
        <div className="lg:hidden border-b border-[#1c2333] bg-[#0d1017] p-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setMobileSidebarOpen(true)}
              className="p-1.5 rounded-md bg-[#161d2d] text-gray-200"
            >
              <Menu className="w-5 h-5" />
            </button>
            <span className="font-serif font-bold text-sm tracking-wide text-white">FRAME STUDIO</span>
          </div>

          <Button
            onClick={handleNewStory}
            disabled={isGenerating || isGeneratingFrames || isSaving}
            size="sm"
            className="bg-amber-500 text-black font-semibold h-8 text-xs gap-1 disabled:opacity-50"
          >
            <Plus className="w-3 h-3" /> New Story
          </Button>
        </div>

        {/* WORKSPACE VIEW SWITCHER */}
        {isGenerating ? (
          // ================= GENERATING ACTIVE PROGRESS =================
          <div className="flex-1 flex items-center justify-center p-6 studio-grid">
            <div className="max-w-md w-full bg-[#111622] border border-amber-500/30 rounded-2xl p-6 sm:p-8 space-y-6 shadow-2xl shadow-black/80">
              <div className="text-center space-y-2">
                <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center mx-auto">
                  <Sparkles className="w-6 h-6 animate-pulse" />
                </div>
                <h3 className="text-xl font-serif font-bold text-white">
                  {generationPhase === "setup" ? "Building your story setup" : "Structuring your screenplay"}
                </h3>
                <p className="text-xs text-gray-400 leading-relaxed">
                  {generationPhase === "setup"
                    ? `Creating a proposed title and synopsis for ${orientationLabel(selectedProject?.orientation || composerOrientation)} framing. The studio pauses for your review before writing scenes.`
                    : `Turning your approved synopsis into ${selectedProject?.scene_count || composerSceneCount} scenes and character profiles. Frames and motion stay locked until you approve this review.`}
                </p>
              </div>

              {/* Step checklist */}
              <div className="space-y-3 pt-2">
                {/* Step 1 */}
                <div className="flex items-center gap-3 text-xs">
                  <div className="w-6 h-6 rounded-full bg-emerald-950/60 border border-emerald-500/50 text-emerald-400 flex items-center justify-center shrink-0">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-gray-300">
                    Saved pitch & locked continuity seed{" "}
                    <strong className="font-mono text-amber-300">
                      #{selectedProject?.seed || composerSeed}
                    </strong>
                  </span>
                </div>

                {/* Step 2 */}
                <div className="flex items-center gap-3 text-xs">
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                      generationStep >= 2
                        ? "bg-amber-500/20 border border-amber-500 text-amber-400"
                        : "bg-[#161d2d] border border-[#273248] text-gray-400"
                    }`}
                  >
                    {generationStep === 2 ? (
                      <div className="w-3 h-3 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                    ) : generationStep > 2 ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <span className="text-[10px]">2</span>
                    )}
                  </div>
                  <span className={generationStep >= 2 ? "text-amber-200 font-medium" : "text-gray-400"}>
                    {generationPhase === "setup"
                      ? "Drafting the proposed title and story synopsis"
                      : `Reading the approved synopsis for ${selectedProject?.scene_count || composerSceneCount} scenes`}

                  </span>
                </div>

                {/* Step 3 */}
                <div className="flex items-center gap-3 text-xs">
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                      generationStep >= 3
                        ? "bg-amber-500/20 border border-amber-500 text-amber-400"
                        : "bg-[#161d2d] border border-[#273248] text-gray-400"
                    }`}
                  >
                    {generationStep === 3 ? (
                      <div className="w-3 h-3 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                    ) : generationStep > 3 ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <span className="text-[10px]">3</span>
                    )}
                  </div>
                  <span className={generationStep >= 3 ? "text-amber-200 font-medium" : "text-gray-400"}>
                    {generationPhase === "setup"
                      ? "Holding scenes, characters, frames, and motion until you confirm"
                      : "Writing character profiles, scene action, dialogue, and camera direction"}
                  </span>
                </div>

                {/* Step 4 */}
                <div className="flex items-center gap-3 text-xs">
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                      generationStep >= 4
                        ? "bg-amber-500/20 border border-amber-500 text-amber-400"
                        : "bg-[#161d2d] border border-[#273248] text-gray-400"
                    }`}
                  >
                    {generationStep === 4 ? (
                      <div className="w-3 h-3 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <span className="text-[10px]">4</span>
                    )}
                  </div>
                  <span className={generationStep >= 4 ? "text-amber-200 font-medium" : "text-gray-400"}>
                    {generationPhase === "setup"
                      ? "Saving the setup review to your private studio"
                      : "Validating and saving the screenplay review to your private studio"}
                  </span>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-[#0a0d14] border border-[#1d2538] text-[11px] text-amber-300/90 text-center">
                Please keep this browser window open. When this pass finishes, the next confirmation gate will be ready for your review.
              </div>
            </div>
          </div>
        ) : selectedProject && selectedProjectHasEditorSnapshot ? (
          // ================= CONFIRMATION-GATED EDITOR VIEW =================
          <DramaEditor
            key={selectedProject.id}
            initialManifest={selectedProject.manifest}
            initialTitle={selectedProject.title}
            seed={selectedProject.seed}
            expectedSceneCount={selectedProject.scene_count}
            gateStatus={selectedProjectEditorGateStatus}
            synopsis={selectedProject.synopsis}
            orientation={selectedProject.orientation}
            artStyle={selectedProject.art_style || selectedProject.global_style}
            productionApproved={selectedProject.production_approved}
            isGateActionRunning={isGenerating || isSaving || isStartingVisualProduction}
            isStartingVisualProduction={isStartingVisualProduction && visualProductionHandoffProjectId === selectedProject.id}
            autoOpenFrames={visualProductionHandoffProjectId === selectedProject.id}
            generationError={generationError || selectedProject.last_error}
            onSaveSetup={handleSaveSetup}
            onRegenerateSetup={() => handleRegenerateSetup(selectedProject)}
            onConfirmSetup={handleConfirmSetup}
            onBackToPitch={() => handleBackToPitch(selectedProject)}
            onRegenerateScript={() => handleRegenerateScript(selectedProject)}
            onApproveProduction={handleApproveProduction}
            isSaving={isSaving}
            onSave={handleSaveEditorChanges}
            onDirtyChange={setIsEditorDirty}
            shotPlan={selectedProject.shot_plan}
            shotPlanValidationError={selectedProjectShotPlanValidationError}
            isSavingShotPlan={isSavingShotPlan}
            shotPlanSaveError={shotPlanSaveError}
            onSaveShotPlan={handleSaveShotPlan}
            onShotPlanDirtyChange={handleShotPlanDirtyChange}
            projectTitle={selectedProject.title}
            assemblyAssets={selectedProject.assembly_assets || []}
            onSaveAssemblyAsset={handleSaveAssemblyAsset}
            projectId={selectedProject.id || ""}
            dialogueShotClips={selectedProject.dialogue_shot_clips || []}
            onDialogueShotClipUpdate={handleDialogueShotClipUpdate}
            onGenerateFrames={handleGenerateFrames}
            frameStatus={selectedProject.frame_status}
            frameAssets={selectedProject.frame_assets}
            frameProgress={frameProgress}
            frameError={frameError || selectedProject.frame_error}
            isGeneratingFrames={isGeneratingFrames}
            authAvailable={isAuth}
            persistedProject={Boolean(selectedProject.id)}
            videoStatus={selectedProject.video_status}
            videoClips={selectedProject.video_clips}
            videoError={videoError || selectedProject.video_error}
            videoStartingScene={videoStartingScene}
            onGenerateVideo={handleGenerateVideo}
            silentPreviewPlaylist={currentSilentPreview}
            previewMetadata={selectedProject.preview_metadata}
            onSavePreview={handleSavePreview}
            previewLoading={loadingProjects}
            voiceAssignments={selectedProject.voice_assignments}
            audioAssets={selectedProject.audio_assets}
            ambienceAssets={selectedProject.ambience_assets}
            ambienceBusy={ambienceBusy}
            ambienceError={ambienceError}
            onGenerateAmbience={handleGenerateAmbience}
            lipsyncAssets={selectedProject.lipsync_assets}
            isStartingLipsync={isStartingLipsync}
            lipsyncError={lipsyncError}
            onStartLipsync={handleStartLipsync}
            onCheckLipsync={handleCheckLipsync}
            pixverseLipsyncAssets={selectedProject.pixverse_lipsync_assets}
            isStartingPixverseLipsync={isStartingPixverseLipsync}
            pixverseLipsyncError={pixverseLipsyncError}
            onStartPixverseLipsync={handleStartPixverseLipsync}
            onCheckPixverseLipsync={handleCheckPixverseLipsync}
            voices={voices}
            voiceLoading={voiceLoading}
            voiceError={voiceError}
            synthesisBusy={synthesisBusy}
            synthesisError={synthesisError}
            onLoadVoices={handleLoadVoices}
            onGenerateVoiceTake={handleGenerateVoiceTake}
            onDurationMeasured={handleAudioDurationMeasured}
            coverageRunState={coverageRunState}
            onRunSceneCoverage={handleRunSceneCoverage}
            onCancelSceneCoverage={handleCancelSceneCoverage}
          />
        ) : selectedProject && (selectedProject.status === "PENDING" || selectedProject.status === "FAILED") ? (
          // ================= INTERRUPTED / FAILED PROJECT STATE =================
          <div className="flex-1 flex items-center justify-center p-6 studio-grid">
            <div className="max-w-lg w-full bg-[#111622] border border-[#222b3e] rounded-2xl p-6 sm:p-8 space-y-5">
              <div className="flex items-start gap-3">
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 shrink-0">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-serif font-bold text-white">{selectedProject.title}</h3>
                  <p className="text-xs text-gray-400 mt-1">
                    {selectedProject.status === "PENDING"
                      ? "This draft was saved or interrupted before screenplay generation finished."
                      : "Screenplay generation encountered an issue."}
                  </p>
                  {selectedProject.last_error && (
                    <p className="text-xs font-mono text-red-400 mt-2 bg-red-950/40 p-2.5 rounded-lg border border-red-800/40 leading-relaxed">
                      {selectedProject.last_error}
                    </p>
                  )}
                </div>
              </div>

              <div className="p-4 rounded-xl bg-[#0b0e15] border border-[#1c2333] space-y-2">
                <span className="text-xs text-gray-400 font-mono uppercase">Original Premise:</span>
                <p className="text-xs text-gray-200 italic leading-relaxed">
                  "{selectedProject.prompt || "No prompt premise recorded"}"
                </p>
                <div className="flex items-center gap-3 pt-2 text-[11px] text-gray-400">
                  <span>Scene target: {selectedProject.scene_count || 4} scenes</span>
                  <span>•</span>
                  <span>Locked seed: #{selectedProject.seed}</span>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <Button
                  onClick={handleNewStory}
                  disabled={isGenerating || isGeneratingFrames || isSaving}
                  variant="outline"
                  className="border-[#273248] text-gray-300 hover:text-white"
                >
                  Back to Composer
                </Button>
                <Button
                  onClick={() => handleRetryProject(selectedProject)}
                  disabled={isGenerating || isGeneratingFrames || isSaving}
                  className="bg-amber-500 hover:bg-amber-600 text-black font-semibold gap-2 shadow-md shadow-amber-500/20"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>Generate Screenplay Now</span>
                </Button>
              </div>
            </div>
          </div>
        ) : selectedProject ? (
          // ================= SAVED STORY RECOVERY STATE =================
          <div className="flex-1 overflow-y-auto p-4 studio-grid sm:p-8">
            <div className="mx-auto flex min-h-full w-full max-w-2xl items-center py-8">
              <section className="w-full rounded-2xl border border-amber-500/25 bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,0.12),transparent_44%),#111622] p-6 shadow-2xl shadow-black/40 sm:p-8" aria-labelledby="saved-story-recovery-title">
                <div className="flex items-start gap-4">
                  <div className="shrink-0 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-amber-300">
                    <AlertCircle className="h-6 w-6" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-300">Saved story recovery</p>
                    <h1 id="saved-story-recovery-title" className="mt-2 break-words text-2xl font-serif font-bold tracking-tight text-white sm:text-3xl">
                      {selectedProject.title || "Untitled story"}
                    </h1>
                    <p className="mt-2 text-sm leading-relaxed text-gray-300">
                      This saved story is still in your private library, but the studio cannot open its next checkpoint yet. Choose a recovery action below. Your saved premise will stay intact.
                    </p>
                  </div>
                </div>

                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-[#2a354b] bg-[#0c111b]/80 p-4">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-gray-500">Current status</p>
                    <p className="mt-2 text-sm font-semibold text-amber-200">{selectedProjectStatusLabel}</p>
                    <p className="mt-2 text-xs leading-relaxed text-gray-400">
                      {selectedProjectManifestValidation.error || "The saved screenplay data needs a fresh checkpoint."}
                    </p>
                  </div>
                  <div className="rounded-xl border border-[#2a354b] bg-[#0c111b]/80 p-4">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-gray-500">Saved premise</p>
                    <p className="mt-2 break-words text-sm leading-relaxed text-gray-200">
                      {selectedProject.prompt?.trim() || "No saved premise was recorded for this story."}
                    </p>
                  </div>
                </div>

                {selectedProject.last_error && (
                  <div className="mt-4 rounded-xl border border-red-800/45 bg-red-950/25 p-3.5 text-xs leading-relaxed text-red-200" role="alert">
                    <p className="font-semibold text-red-300">Last saved note</p>
                    <p className="mt-1 break-words text-red-200/85">{selectedProject.last_error}</p>
                  </div>
                )}

                <div className="mt-6 flex flex-col gap-2 border-t border-[#242e43] pt-5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleBackToPitch(selectedProject)}
                    disabled={isGenerating || isGeneratingFrames || isSaving || isStartingVisualProduction || hasActiveVideoOperation()}
                    className="h-10 gap-2 border-[#35425d] bg-[#171f30] text-gray-200 hover:border-amber-500/50 hover:bg-[#1d283d] hover:text-white"
                  >
                    <span aria-hidden="true">←</span> Return to composer
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void loadProjects()}
                    disabled={loadingProjects || isGenerating || isGeneratingFrames || isSaving || isStartingVisualProduction}
                    className="h-10 gap-2 border-[#35425d] bg-[#171f30] text-gray-200 hover:border-amber-500/50 hover:bg-[#1d283d] hover:text-white"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 text-amber-400 ${loadingProjects ? "animate-spin" : ""}`} />
                    Refresh saved library
                  </Button>
                  <Button
                    type="button"
                    onClick={() => {
                      if (selectedProject.synopsis?.trim() && selectedProjectEditorGateStatus !== "AWAITING_SETUP_CONFIRM") {
                        void handleRegenerateScript(selectedProject);
                      } else {
                        void handleRegenerateSetup(selectedProject);
                      }
                    }}
                    disabled={isGenerating || isGeneratingFrames || isSaving || isStartingVisualProduction || hasActiveVideoOperation()}
                    className="h-10 gap-2 bg-amber-500 font-semibold text-black shadow-md shadow-amber-500/15 hover:bg-amber-600 disabled:opacity-50"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    {selectedProject.synopsis?.trim() && selectedProjectEditorGateStatus !== "AWAITING_SETUP_CONFIRM" ? "Rebuild screenplay" : "Rebuild story setup"}
                  </Button>
                </div>
              </section>
            </div>
          </div>
        ) : (
          // ================= EMPTY STUDIO / PROMPT COMPOSER =================
          <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-8 studio-glow">
            <div className="max-w-3xl mx-auto space-y-8">
              {/* Studio Intro Eyebrow & Headline */}
              <div className="space-y-3">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/25 text-amber-300 text-xs font-mono uppercase tracking-wider">
                  <Film className="w-3 h-3" />
                  <span>Your next short starts here</span>
                </div>

                <h1 className="text-3xl sm:text-4xl font-serif font-bold tracking-tight text-white leading-tight">
                  Build a story in clear checkpoints
                </h1>

                <p className="text-sm sm:text-base text-gray-300 max-w-2xl leading-relaxed">
                  Start with a raw premise, choose the frame, and review each creative pass before it moves forward. The studio first proposes a title and synopsis, then waits for your approval before writing the screenplay.
                </p>
                <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3.5 py-3 text-xs text-amber-100/80">
                  <Layers className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                  <p className="leading-relaxed">
                    <span className="font-semibold text-amber-300">Your checkpoints:</span> Pitch → setup review → screenplay and cast review → manual Frames and Motion. Nothing renders until you approve the screenplay.
                  </p>
                </div>
              </div>

              {/* Error Alert */}
              {generationError && (
                <div className="p-4 rounded-xl bg-red-950/40 border border-red-800/40 flex items-start gap-3 text-sm text-red-300">
                  <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-red-300">Generation Note</p>
                    <p className="text-red-300/90 text-xs mt-0.5">{generationError}</p>
                  </div>
                </div>
              )}

              {/* Main Composer Box */}
              <div className="rounded-2xl bg-[#111622] border border-[#1f273b] p-5 sm:p-7 space-y-6 shadow-xl shadow-black/50">
                {/* Premise Textarea */}
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <label className="text-xs font-mono uppercase tracking-wider text-amber-400 font-semibold flex items-center gap-1.5">
                      <Clapperboard className="w-3.5 h-3.5" /> Raw Story Idea
                    </label>
                    <span className="text-[11px] text-gray-400">Describe the spark, pressure, or turning point you want to see</span>
                  </div>
                  <Textarea
                    value={composerPrompt}
                    onChange={(e) => setComposerPrompt(e.target.value)}
                    placeholder="e.g. A ruthless biotech heiress discovers her estranged twin sister is the whistleblower leaking classified lab records during an exclusive charity masquerade ball. The truth could cost them both everything."
                    rows={4}
                    className="bg-[#0b0e15] border-[#222b3e] text-sm text-gray-100 placeholder:text-gray-400 focus-visible:ring-amber-500/40 leading-relaxed resize-y"
                  />
                </div>

                {/* Output choices */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Orientation */}
                  <div>
                    <label className="text-xs font-mono uppercase tracking-wider text-gray-300 mb-1.5 block">
                      Video Orientation
                    </label>
                    <div className="grid grid-cols-2 lg:grid-cols-1 gap-2">
                      {([
                        { value: "vertical" as VideoOrientation, label: "Vertical 9:16", detail: "Mobile-first short" },
                        { value: "horizontal" as VideoOrientation, label: "Horizontal 16:9", detail: "Wide-screen frame" },
                      ]).map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setComposerOrientation(option.value)}
                          className={`rounded-lg border px-3 py-2 text-left transition-all ${
                            composerOrientation === option.value
                              ? "border-amber-500/50 bg-amber-500/15 text-amber-200"
                              : "border-[#222b3e] bg-[#0b0e15] text-gray-300 hover:border-gray-600"
                          }`}
                        >
                          <div className="text-xs font-semibold">{option.label}</div>
                          <div className="mt-0.5 text-[10px] text-gray-400">{option.detail}</div>
                        </button>
                      ))}
                    </div>
                    <p className="mt-1.5 text-[10px] leading-relaxed text-gray-500">
                      The selected ratio is saved with the story and carried into future frame prompts.
                    </p>
                  </div>

                  {/* Scene Count */}
                  <div>
                    <label className="text-xs font-mono uppercase tracking-wider text-gray-300 mb-1.5 block">
                      Total Episodes / Scenes (3–6)
                    </label>
                    <div className="grid grid-cols-4 gap-2">
                      {[3, 4, 5, 6].map((num) => (
                        <button
                          key={num}
                          type="button"
                          onClick={() => setComposerSceneCount(num)}
                          className={`py-2 px-1 rounded-lg text-xs font-mono font-medium transition-all text-center border ${
                            composerSceneCount === num
                              ? "bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-sm"
                              : "bg-[#0b0e15] text-gray-300 border-[#222b3e] hover:border-gray-600"
                          }`}
                        >
                          <div>{num} Scenes</div>
                          <div className="text-[10px] text-gray-400 font-normal">~{num * 4}s total</div>
                        </button>
                      ))}
                    </div>
                    <p className="mt-1.5 text-[10px] leading-relaxed text-gray-500">
                      For this slice, episode count maps to the current scene timeline.
                    </p>
                  </div>

                </div>

                {/* Style Presets */}
                <div>
                  <label className="text-xs font-mono uppercase tracking-wider text-gray-300 mb-2 block">
                    Visual Style Preset
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {STYLE_PRESETS.map((preset) => {
                      const isSelected = composerStyle === preset.value;
                      return (
                        <button
                          key={preset.name}
                          type="button"
                          onClick={() => setComposerStyle(preset.value)}
                          className={`p-2.5 rounded-lg text-left transition-all border ${
                            isSelected
                              ? "bg-amber-500/15 border-amber-500/50 text-amber-200"
                              : "bg-[#0b0e15] border-[#222b3e] text-gray-300 hover:border-gray-600"
                          }`}
                        >
                          <div className="text-xs font-semibold text-white">{preset.name}</div>
                          <div className="text-[10px] text-gray-400 line-clamp-1 mt-0.5">
                            {preset.description}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Bottom Action CTAs */}
                <div className="pt-3 border-t border-[#1c2333] flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <span className="w-2 h-2 rounded-full bg-emerald-400" />
                    <span>EpNova-compliant JSON Schema output</span>
                  </div>

                  <div className="flex items-center gap-3">
                    <Button
                      onClick={handleSaveDraft}
                      disabled={isSaving || isGenerating}
                      variant="outline"
                      className="border-[#273248] bg-[#141926] hover:bg-[#1a2132] text-gray-300 h-10 px-4 text-xs"
                    >
                      {isSaving ? "Saving..." : "Save Draft"}
                    </Button>

                    <Button
                      onClick={handleCreateStorySetup}
                      disabled={isGenerating || isGeneratingFrames || isSaving}
                      className="bg-amber-500 hover:bg-amber-600 text-black font-semibold h-10 px-5 gap-2 shadow-md shadow-amber-500/20"
                    >
                      <Sparkles className="w-4 h-4" />
                      <span>Create Story Setup</span>
                    </Button>
                  </div>
                </div>
              </div>

              {/* Orchestration Pipeline Architecture Cards */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-gray-400">
                  <Layers className="w-3.5 h-3.5 text-amber-400" />
                  <span>5-Phase Vertical Orchestration Architecture</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {/* Phase 1 */}
                  <div className="p-4 rounded-xl bg-[#111622] border border-amber-500/40 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] text-amber-400 uppercase font-semibold">
                        Phase 1 • ACTIVE
                      </span>
                      <Badge className="bg-amber-500/20 text-amber-300 border-none text-[10px]">
                        Included
                      </Badge>
                    </div>
                    <h4 className="text-sm font-semibold text-white">Script & Visual Profiles</h4>
                    <p className="text-xs text-gray-400 leading-relaxed">
                      Author structured 9:16 scene cards, camera direction, and locked character visual profiles.
                    </p>
                  </div>

                  {/* Phase 2 */}
                  <div className="p-4 rounded-xl bg-[#111622] border border-amber-500/40 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] text-amber-400 uppercase font-semibold">
                        Phase 2 • ACTIVE
                      </span>
                      <Badge className="bg-amber-500/20 text-amber-300 border-none text-[10px]">
                        Included
                      </Badge>
                    </div>
                    <h4 className="text-sm font-semibold text-white">Hosted Reference Frames</h4>
                    <p className="text-xs text-gray-400 leading-relaxed">
                      Save one character reference and one vertical storyboard image for every approved scene. Images stay private to the project.
                    </p>
                  </div>

                  {/* Phase 3-5 */}
                  <div className="p-4 rounded-xl bg-[#0e121a] border border-[#1b2234] space-y-2 text-gray-400">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] text-amber-300 uppercase font-semibold">
                        Phase 3 • ACTIVE TEST
                      </span>
                      <span className="text-[10px] font-mono text-gray-400">Review now</span>
                    </div>
                    <h4 className="text-sm font-semibold text-gray-200">Single-shot motion review</h4>
                    <p className="text-xs text-gray-400 leading-relaxed">
                      Animate one saved storyboard into a private five-second clip. Audio, multi-scene assembly, and the two-minute render remain future phases.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
