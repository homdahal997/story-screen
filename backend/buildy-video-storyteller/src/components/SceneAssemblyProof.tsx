import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Download,
  ExternalLink,
  Info,
  ListOrdered,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  Square,
  UploadCloud,
  VolumeX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { uploadFile } from "@/integrations/core";
import { renderBrowserSceneAssembly } from "@/lib/sceneAssembly";
import type {
  BrowserSceneAssemblyProgress,
  BrowserSceneAssemblyShot,
} from "@/lib/sceneAssembly";
import { validateSavedMultiLineShotPlanAgainstCurrent } from "@/lib/dramaStudio";
import type {
  DialogueAudioAsset,
  DialogueShotClip,
  DramaManifest,
  FinalAssemblyAsset,
  LipsyncAsset,
  SavedMultiLineShotPlan,
  SavedShotPlanReviewedCloseupShot,
  SavedShotPlanShot,
  SavedShotPlanSnapshot,
  VideoClip,
} from "@/lib/dramaStudio";
import { normalizeSavedMultiLineShotPlan } from "@/lib/savedShotPlan";

export interface SceneAssemblyProofProps {
  manifest: DramaManifest;
  projectTitle?: string;
  savedShotPlan: SavedShotPlanSnapshot | null;
  videoClips: VideoClip[];
  audioAssets: DialogueAudioAsset[];
  dialogueShotClips: DialogueShotClip[];
  lipsyncAssets: LipsyncAsset[];
  assemblyAssets?: FinalAssemblyAsset[];
  onSaveAssemblyAsset?: (asset: FinalAssemblyAsset) => Promise<boolean>;
}

type SavedAssemblyShot = {
  key: string;
  lineId: string;
  lineNumber: number;
  characterId: string;
  text: string;
  role: SavedShotPlanShot["role"];
  shotNumber: number;
  videoUrl: string;
  durationSeconds: number;
  masterClipId: string | null;
  closeupClipId: string | null;
  lipsyncId: string | null;
  audioUrl: string | null;
};

type AssemblyEvaluation =
  | {
      valid: true;
      plan: SavedMultiLineShotPlan;
      shots: SavedAssemblyShot[];
    }
  | {
      valid: false;
      plan: null;
      shots: [];
      reason: string;
    };

type AssemblyPhase =
  | "idle"
  | "saving-processing"
  | "rendering"
  | "uploading"
  | "saving-ready"
  | "saving-failed";

const DURATION_TOLERANCE_SECONDS = 0.001;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatDuration(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "Unavailable";
  return `${value.toFixed(value >= 10 ? 1 : 2)}s`;
}

function formatScene(value: number): string {
  return String(value).padStart(2, "0");
}

function shortId(value: string, maxLength = 23): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, Math.max(8, Math.floor(maxLength / 2)))}…${trimmed.slice(-7)}`;
}

function mediaToken(value: string): string {
  try {
    const parsed = new URL(value);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const lastPart = parts[parts.length - 1] || "saved-audio";
    return shortId(lastPart.replace(/\.[a-z0-9]+$/i, ""), 23);
  } catch {
    return "saved-audio";
  }
}

function roleLabel(role: SavedShotPlanShot["role"]): string {
  return role === "master" ? "Master / wide" : "Reviewed close-up";
}

function roleShortLabel(role: SavedShotPlanShot["role"]): string {
  return role === "master" ? "Master" : "Close-up";
}

function isPositiveDuration(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function hasExactSavedStructure(plan: SavedMultiLineShotPlan): boolean {
  if (
    plan.version !== 2 ||
    plan.mode !== "multi_line_hard_cut" ||
    plan.status !== "APPROVED" ||
    plan.lines.length < 2 ||
    plan.lines.length > 3 ||
    !isPositiveDuration(plan.total_duration_seconds)
  ) {
    return false;
  }

  const lineTotal = plan.lines.reduce((sum, line, index) => {
    if (
      line.order !== index + 1 ||
      line.shots.length !== 2 ||
      !isPositiveDuration(line.total_duration_seconds)
    ) {
      return Number.NaN;
    }

    const roleCount = line.shots.reduce(
      (counts, shot) => {
        counts[shot.role] += 1;
        return counts;
      },
      { master: 0, "reviewed-closeup": 0 }
    );
    if (roleCount.master !== 1 || roleCount["reviewed-closeup"] !== 1) {
      return Number.NaN;
    }

    const shotTotal = line.shots.reduce((shotSum, shot) => {
      if (!isPositiveDuration(shot.duration_seconds)) return Number.NaN;
      return shotSum + shot.duration_seconds;
    }, 0);
    if (!Number.isFinite(shotTotal) || Math.abs(shotTotal - line.total_duration_seconds) > DURATION_TOLERANCE_SECONDS) {
      return Number.NaN;
    }
    return sum + line.total_duration_seconds;
  }, 0);

  return Number.isFinite(lineTotal) &&
    Math.abs(lineTotal - plan.total_duration_seconds) <= DURATION_TOLERANCE_SECONDS;
}

function savedAssemblyShot(
  line: SavedMultiLineShotPlan["lines"][number],
  shot: SavedShotPlanShot,
  shotNumber: number
): SavedAssemblyShot {
  if (shot.role === "master") {
    return {
      key: `${line.line_id}:${shotNumber}:${shot.role}:${shot.clip_prediction_id}`,
      lineId: line.line_id,
      lineNumber: line.order,
      characterId: line.character_id,
      text: line.text,
      role: shot.role,
      shotNumber,
      videoUrl: shot.video_url,
      durationSeconds: shot.duration_seconds,
      masterClipId: shot.clip_prediction_id,
      closeupClipId: null,
      lipsyncId: null,
      audioUrl: null,
    };
  }

  const reviewed = shot as SavedShotPlanReviewedCloseupShot;
  return {
    key: `${line.line_id}:${shotNumber}:${shot.role}:${reviewed.lipsync_prediction_id}`,
    lineId: line.line_id,
    lineNumber: line.order,
    characterId: line.character_id,
    text: line.text,
    role: shot.role,
    shotNumber,
    videoUrl: reviewed.lipsync_video_url,
    durationSeconds: reviewed.duration_seconds,
    masterClipId: null,
    closeupClipId: reviewed.closeup_prediction_id,
    lipsyncId: reviewed.lipsync_prediction_id,
    audioUrl: reviewed.audio_url,
  };
}

function blockedEvaluation(reason: string): AssemblyEvaluation {
  return { valid: false, plan: null, shots: [], reason };
}

function isSecureHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "https:" && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

function assemblyPredictionIds(shots: SavedAssemblyShot[]): string[] {
  return shots
    .map((shot) => shot.role === "master" ? shot.masterClipId : shot.lipsyncId)
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
}

function hasExactAssemblyIdentity(
  asset: FinalAssemblyAsset,
  plan: SavedMultiLineShotPlan,
  shots: SavedAssemblyShot[]
): boolean {
  const predictionIds = assemblyPredictionIds(shots);
  return asset.status === "READY" &&
    asset.scene_number === plan.scene_number &&
    asset.shot_plan_source_signature === plan.source_signature &&
    asset.shot_plan_updated_at === plan.updated_at &&
    asset.shot_count === shots.length &&
    asset.total_duration_seconds === plan.total_duration_seconds &&
    asset.shot_prediction_ids.length === predictionIds.length &&
    asset.shot_prediction_ids.every((value, index) => value === predictionIds[index]) &&
    isSecureHttpsUrl(asset.video_url);
}

function safeAssemblyId(): string {
  const randomPart = Math.random().toString(36).slice(2, 12);
  return `scene-assembly-${Date.now()}-${randomPart}`;
}

function safeAssemblyFileName(title: string, sceneNumber: number): string {
  const safeTitle = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "drama";
  return `${safeTitle}-scene-${String(sceneNumber).padStart(2, "0")}-assembly.webm`;
}

function boundedAssemblyError(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const message = raw.trim();
  if (!message || /bearer|token|secret|authorization|https?:\/\//i.test(message)) return fallback;
  return message.slice(0, 240);
}

function isAssemblyCancellation(error: unknown): boolean {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return /cancel/i.test(raw);
}

function phaseLabel(phase: AssemblyPhase): string {
  switch (phase) {
    case "saving-processing":
      return "Saving assembly checkpoint";
    case "rendering":
      return "Recording the scene in this browser";
    case "uploading":
      return "Uploading the WebM";
    case "saving-ready":
      return "Saving the managed output";
    case "saving-failed":
      return "Saving the failure checkpoint";
    default:
      return "Ready to assemble";
  }
}

function historyDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Saved time unavailable";
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export const SceneAssemblyProof: React.FC<SceneAssemblyProofProps> = ({
  manifest,
  projectTitle,
  savedShotPlan,
  videoClips,
  audioAssets,
  dialogueShotClips,
  lipsyncAssets,
  assemblyAssets = [],
  onSaveAssemblyAsset,
}) => {
  const evaluation = useMemo<AssemblyEvaluation>(() => {
    if (!savedShotPlan) {
      return blockedEvaluation(
        "No approved version-two multi-line shot plan is saved for this project."
      );
    }

    const raw = savedShotPlan as unknown;
    const rawRecord = isRecord(raw) ? raw : null;
    if (rawRecord?.version === 1) {
      return blockedEvaluation(
        "The saved plan is a version-one one-line approval. Save a fresh version-two multi-line plan before opening this proof."
      );
    }

    const normalized = normalizeSavedMultiLineShotPlan(raw);
    if (!normalized) {
      return blockedEvaluation(
        rawRecord?.version === 2
          ? "The saved version-two plan is malformed or incomplete. This proof will not repair its line order or timing."
          : "The saved plan is not an approved version-two multi-line snapshot."
      );
    }

    if (!hasExactSavedStructure(normalized)) {
      return blockedEvaluation(
        "The saved version-two plan does not contain two exact shot roles per line with matching saved timing."
      );
    }

    const validation = validateSavedMultiLineShotPlanAgainstCurrent({
      plan: normalized,
      manifest,
      video_clips: Array.isArray(videoClips) ? videoClips : [],
      audio_assets: Array.isArray(audioAssets) ? audioAssets : [],
      dialogue_shot_clips: Array.isArray(dialogueShotClips) ? dialogueShotClips : [],
      lipsync_assets: Array.isArray(lipsyncAssets) ? lipsyncAssets : [],
    });
    if (!validation.valid || !validation.plan) {
      return blockedEvaluation(
        validation.error ||
          "The saved approval is stale or its exact current media lineage is unavailable."
      );
    }

    const plan = validation.plan;
    const shots = plan.lines.flatMap((line) =>
      line.shots.map((shot, index) => savedAssemblyShot(line, shot, index + 1))
    );
    if (!shots.length || shots.length !== plan.lines.length * 2) {
      return blockedEvaluation(
        "The saved approval did not produce the exact two-shot order for every canonical line."
      );
    }

    return { valid: true, plan, shots };
  }, [audioAssets, dialogueShotClips, lipsyncAssets, manifest, savedShotPlan, videoClips]);

  const [currentShotIndex, setCurrentShotIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [playbackNotice, setPlaybackNotice] = useState<string | null>(null);
  const [isAssembling, setIsAssembling] = useState(false);
  const [assemblyProgress, setAssemblyProgress] = useState<BrowserSceneAssemblyProgress | null>(null);
  const [assemblyPhase, setAssemblyPhase] = useState<AssemblyPhase>("idle");
  const [assemblyError, setAssemblyError] = useState<string | null>(null);
  const [assemblyNotice, setAssemblyNotice] = useState<string | null>(null);
  const [assemblyAttemptId, setAssemblyAttemptId] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const isPlayingRef = useRef(false);
  const continueAfterSourceChangeRef = useRef(false);
  const assemblyAbortControllerRef = useRef<AbortController | null>(null);
  const assemblyCancelRequestedRef = useRef(false);
  const assemblyFinalPersistenceRef = useRef(false);
  const assemblyAttemptIdentityRef = useRef<string | null>(null);
  const assemblyIdentityRef = useRef<string>("");
  const evaluationRef = useRef<AssemblyEvaluation>(evaluation);
  const mountedRef = useRef(true);

  const assemblyIdentity = useMemo(() => {
    if (!evaluation.valid) return `blocked:${evaluation.reason}`;
    return JSON.stringify({
      version: evaluation.plan.version,
      scene_number: evaluation.plan.scene_number,
      source_signature: evaluation.plan.source_signature,
      updated_at: evaluation.plan.updated_at,
      total_duration_seconds: evaluation.plan.total_duration_seconds,
      lines: evaluation.plan.lines.map((line) => ({
        line_id: line.line_id,
        order: line.order,
        shots: line.shots.map((shot) => ({
          role: shot.role,
          duration_seconds: shot.duration_seconds,
          clip_prediction_id: shot.role === "master" ? shot.clip_prediction_id : null,
          closeup_prediction_id: shot.role === "reviewed-closeup" ? shot.closeup_prediction_id : null,
          lipsync_prediction_id: shot.role === "reviewed-closeup" ? shot.lipsync_prediction_id : null,
          video_url: shot.role === "master" ? shot.video_url : shot.lipsync_video_url,
        })),
      })),
    });
  }, [evaluation]);

  // These refs let the asynchronous browser render compare itself with the latest
  // approved snapshot, even if a parent project refreshes while the recorder runs.
  assemblyIdentityRef.current = assemblyIdentity;
  evaluationRef.current = evaluation;

  const currentShot = evaluation.valid ? evaluation.shots[currentShotIndex] || null : null;
  const scene = evaluation.valid
    ? manifest.scenes.find((candidate) => candidate.scene_number === evaluation.plan.scene_number) || null
    : null;

  const currentReadyAsset = useMemo(() => {
    if (!evaluation.valid || !Array.isArray(assemblyAssets)) return null;
    for (let index = assemblyAssets.length - 1; index >= 0; index -= 1) {
      const asset = assemblyAssets[index];
      if (hasExactAssemblyIdentity(asset, evaluation.plan, evaluation.shots)) return asset;
    }
    return null;
  }, [assemblyAssets, evaluation]);

  const retainedAssemblyAssets = useMemo(() => {
    if (!Array.isArray(assemblyAssets)) return [];
    return assemblyAssets.filter((asset) => asset.assembly_id !== currentReadyAsset?.assembly_id);
  }, [assemblyAssets, currentReadyAsset?.assembly_id]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      assemblyCancelRequestedRef.current = true;
      assemblyAbortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    continueAfterSourceChangeRef.current = false;
    isPlayingRef.current = false;
    video?.pause();
    if (video) {
      try {
        video.currentTime = 0;
      } catch {
        // A browser can reject a seek while the saved source is changing.
      }
      if (!currentShot) {
        video.removeAttribute("src");
        video.load();
      }
    }
    setCurrentShotIndex(0);
    setIsPlaying(false);
    setPlaybackError(null);
    setPlaybackNotice(null);
  }, [assemblyIdentity]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !currentShot) return;
    video.pause();
    try {
      video.currentTime = 0;
    } catch {
      // A browser can reject a seek before saved metadata is ready.
    }
    video.load();
  }, [currentShot?.key]);

  const stopPreview = (notice: string, resetToStart = true) => {
    continueAfterSourceChangeRef.current = false;
    isPlayingRef.current = false;
    videoRef.current?.pause();
    if (resetToStart && videoRef.current) {
      try {
        videoRef.current.currentTime = 0;
      } catch {
        // The saved source may not have metadata yet.
      }
    }
    setIsPlaying(false);
    setPlaybackError(null);
    if (resetToStart) setCurrentShotIndex(0);
    setPlaybackNotice(notice);
  };

  const handlePlay = async () => {
    const video = videoRef.current;
    if (!currentShot || !video || isPlayingRef.current) return;
    setPlaybackError(null);
    setPlaybackNotice(null);
    if (video.ended) {
      try {
        video.currentTime = 0;
      } catch {
        // The browser can reject a seek before metadata is ready.
      }
    }
    isPlayingRef.current = true;
    setIsPlaying(true);
    try {
      await video.play();
    } catch {
      if (!isPlayingRef.current) return;
      isPlayingRef.current = false;
      setIsPlaying(false);
      setPlaybackError(
        `The saved ${roleLabel(currentShot.role).toLowerCase()} on line ${currentShot.lineNumber} could not play in this browser. The proof stopped without substituting another clip.`
      );
    }
  };

  const handlePause = () => {
    continueAfterSourceChangeRef.current = false;
    isPlayingRef.current = false;
    videoRef.current?.pause();
    setIsPlaying(false);
    setPlaybackNotice("Paused at the current saved shot. Press Play to continue this local proof.");
  };

  const handleRestart = () => {
    stopPreview("Restarted at line 1. Press Play when ready.");
  };

  const handleStop = () => {
    stopPreview("Stopped. The saved scene assembly proof is ready to play again.");
  };

  const handleCanPlay = () => {
    const video = videoRef.current;
    if (!continueAfterSourceChangeRef.current || !isPlayingRef.current || !video) return;
    continueAfterSourceChangeRef.current = false;
    void video.play().catch(() => {
      if (!isPlayingRef.current) return;
      isPlayingRef.current = false;
      setIsPlaying(false);
      setPlaybackError(
        `The saved ${currentShot ? roleLabel(currentShot.role).toLowerCase() : "shot"} could not continue in this browser. The proof stopped without substituting another clip.`
      );
    });
  };

  const handleVideoEnded = () => {
    if (!isPlayingRef.current || !evaluation.valid) return;
    if (currentShotIndex < evaluation.shots.length - 1) {
      continueAfterSourceChangeRef.current = true;
      const nextShot = evaluation.shots[currentShotIndex + 1];
      setCurrentShotIndex((current) => current + 1);
      setPlaybackNotice(
        `Hard cut to ${roleShortLabel(nextShot.role)} on line ${nextShot.lineNumber}. The saved screenplay order stays fixed.`
      );
      return;
    }
    continueAfterSourceChangeRef.current = false;
    isPlayingRef.current = false;
    setIsPlaying(false);
    setPlaybackNotice(
      "Saved scene assembly proof complete. Nothing changed in the shot plan, media, or project timeline."
    );
  };

  const handleVideoError = () => {
    continueAfterSourceChangeRef.current = false;
    isPlayingRef.current = false;
    setIsPlaying(false);
    setPlaybackError(
      `The saved ${currentShot ? roleLabel(currentShot.role).toLowerCase() : "shot"} on line ${currentShot?.lineNumber || "?"} could not load in this browser. The proof stopped and kept the exact saved order.`
    );
    setPlaybackNotice(null);
  };

  const persistFailedAssembly = async (
    baseAsset: FinalAssemblyAsset,
    errorMessage: string
  ): Promise<void> => {
    if (!onSaveAssemblyAsset) return;
    const failedAsset: FinalAssemblyAsset = {
      ...baseAsset,
      status: "FAILED",
      updated_at: new Date().toISOString(),
      error: boundedAssemblyError(errorMessage, "The scene assembly did not finish. The earlier attempts remain safe."),
    };
    try {
      await onSaveAssemblyAsset(failedAsset);
    } catch (error) {
      console.error("Could not save failed scene assembly checkpoint:", error);
    }
  };

  const handleAssemble = async () => {
    if (isAssembling || !evaluation.valid || !onSaveAssemblyAsset) return;

    const capturedEvaluation = evaluation;
    const capturedIdentity = assemblyIdentity;
    const assemblyId = safeAssemblyId();
    const fileName = safeAssemblyFileName(
      projectTitle || manifest.project_title || "drama",
      capturedEvaluation.plan.scene_number
    );
    const predictionIds = assemblyPredictionIds(capturedEvaluation.shots);
    if (predictionIds.length !== capturedEvaluation.shots.length || new Set(predictionIds).size !== predictionIds.length) {
      setAssemblyError("The approved shot plan is missing a unique media ID for every ordered shot. Save a fresh coverage plan before assembling.");
      setAssemblyNotice(null);
      return;
    }

    const createdAt = new Date().toISOString();
    const processingAsset: FinalAssemblyAsset = {
      assembly_id: assemblyId,
      version: 1,
      mode: "browser_webm_hard_cut",
      status: "PROCESSING",
      scene_number: capturedEvaluation.plan.scene_number,
      shot_plan_source_signature: capturedEvaluation.plan.source_signature,
      shot_plan_updated_at: capturedEvaluation.plan.updated_at,
      shot_prediction_ids: predictionIds,
      shot_count: capturedEvaluation.shots.length,
      total_duration_seconds: capturedEvaluation.plan.total_duration_seconds,
      file_name: fileName,
      content_type: "video/webm",
      created_at: createdAt,
      updated_at: createdAt,
      error: null,
    };
    const browserShots: BrowserSceneAssemblyShot[] = capturedEvaluation.shots.map((shot) => ({
      videoUrl: shot.videoUrl,
      durationSeconds: shot.durationSeconds,
      role: shot.role,
      lineNumber: shot.lineNumber,
      shotNumber: shot.shotNumber,
    }));
    const abortController = new AbortController();
    assemblyAbortControllerRef.current = abortController;
    assemblyCancelRequestedRef.current = false;
    assemblyFinalPersistenceRef.current = false;
    assemblyAttemptIdentityRef.current = capturedIdentity;
    setAssemblyAttemptId(assemblyId);
    setAssemblyProgress(null);
    setAssemblyError(null);
    setAssemblyNotice("The browser will record the approved shots in their saved order. Keep this tab open until the managed file is saved.");
    setAssemblyPhase("saving-processing");
    setIsAssembling(true);

    let processingSaved = false;
    try {
      const processingAccepted = await onSaveAssemblyAsset(processingAsset);
      if (!processingAccepted) {
        throw new Error("The processing checkpoint could not be saved to this story.");
      }
      processingSaved = true;
      if (assemblyCancelRequestedRef.current || abortController.signal.aborted) {
        throw new Error("Scene assembly was canceled.");
      }

      setAssemblyPhase("rendering");
      const renderResult = await renderBrowserSceneAssembly(
        browserShots,
        (progress) => {
          if (!mountedRef.current) return;
          setAssemblyProgress(progress);
        },
        abortController.signal
      );
      if (assemblyCancelRequestedRef.current || abortController.signal.aborted) {
        throw new Error("Scene assembly was canceled.");
      }
      if (
        renderResult.contentType !== "video/webm" ||
        renderResult.shotCount !== capturedEvaluation.shots.length ||
        Math.abs(renderResult.totalDurationSeconds - capturedEvaluation.plan.total_duration_seconds) > DURATION_TOLERANCE_SECONDS
      ) {
        throw new Error("The browser recorder returned a file that does not match the approved shot plan.");
      }

      setAssemblyPhase("uploading");
      const uploadResult = await uploadFile({
        file: new File([renderResult.blob], fileName, { type: "video/webm" }),
      });
      if (assemblyCancelRequestedRef.current || abortController.signal.aborted) {
        throw new Error("Scene assembly was canceled.");
      }
      if (!isSecureHttpsUrl(uploadResult?.file_url)) {
        throw new Error("The managed upload did not return a secure WebM URL.");
      }
      if (
        !evaluationRef.current.valid ||
        assemblyIdentityRef.current !== capturedIdentity
      ) {
        throw new Error("The approved shot plan changed while this scene was being assembled. Start a fresh assembly from the current approval.");
      }

      const readyAsset: FinalAssemblyAsset = {
        ...processingAsset,
        status: "READY",
        updated_at: new Date().toISOString(),
        video_url: uploadResult.file_url.trim(),
        error: null,
      };
      setAssemblyPhase("saving-ready");
      assemblyFinalPersistenceRef.current = true;
      const readyAccepted = await onSaveAssemblyAsset(readyAsset);
      assemblyFinalPersistenceRef.current = false;
      if (!readyAccepted) {
        throw new Error("The finished WebM could not be saved to this story. The earlier assembly attempts remain safe.");
      }

      if (mountedRef.current) {
        setAssemblyNotice("Scene assembly saved as a managed WebM. You can play it here or open the saved file in a new tab.");
        setAssemblyError(null);
        setAssemblyProgress((current) => current || {
          phase: "complete",
          shotIndex: capturedEvaluation.shots.length,
          shotCount: capturedEvaluation.shots.length,
          lineNumber: capturedEvaluation.shots[capturedEvaluation.shots.length - 1].lineNumber,
          shotNumber: capturedEvaluation.shots[capturedEvaluation.shots.length - 1].shotNumber,
          role: capturedEvaluation.shots[capturedEvaluation.shots.length - 1].role,
          elapsedSeconds: capturedEvaluation.plan.total_duration_seconds,
          totalDurationSeconds: capturedEvaluation.plan.total_duration_seconds,
        });
      }
    } catch (error) {
      assemblyFinalPersistenceRef.current = false;
      const canceled = assemblyCancelRequestedRef.current || abortController.signal.aborted || isAssemblyCancellation(error);
      const friendlyError = canceled
        ? "Assembly canceled before a finished output was saved. The processing attempt remains in history, and no READY file was created."
        : boundedAssemblyError(
            error,
            "The scene could not be assembled in this browser. The earlier assembly attempts remain safe."
          );
      setAssemblyPhase(processingSaved ? "saving-failed" : "saving-failed");
      await persistFailedAssembly(processingAsset, friendlyError);
      if (mountedRef.current) {
        setAssemblyError(canceled ? null : friendlyError);
        setAssemblyNotice(canceled ? friendlyError : "The attempt was retained as failed. You can start a fresh assembly without changing the approved shots.");
      }
    } finally {
      assemblyFinalPersistenceRef.current = false;
      assemblyAbortControllerRef.current = null;
      assemblyAttemptIdentityRef.current = null;
      if (mountedRef.current) {
        setIsAssembling(false);
        setAssemblyPhase("idle");
      }
    }
  };

  const handleCancelAssembly = () => {
    if (!isAssembling || assemblyFinalPersistenceRef.current) return;
    assemblyCancelRequestedRef.current = true;
    assemblyAbortControllerRef.current?.abort();
    if (mountedRef.current) {
      setAssemblyError(null);
      setAssemblyNotice("Canceling the browser recording. The attempt will be retained as failed, without creating a READY file.");
    }
  };

  if (!evaluation.valid) {
    return (
      <section className="space-y-5">
        <section className="overflow-hidden rounded-2xl border border-amber-500/[0.35] bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,0.16),transparent_44%),#121926] shadow-xl shadow-black/20">
          <div className="border-b border-amber-500/20 px-4 py-5 sm:px-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="max-w-3xl space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-xs font-mono uppercase tracking-[0.18em] text-amber-300">
                  <ListOrdered className="h-4 w-4" aria-hidden="true" /> Final scene assembly
                  <span className="rounded-md border border-amber-400/[0.35] bg-amber-500/[0.15] px-2 py-1 text-[10px] tracking-wider text-amber-100">
                    Fresh version 2 approval required
                  </span>
                </div>
                <h2 className="text-2xl font-serif font-bold tracking-tight text-white sm:text-3xl">
                  The saved scene is unavailable.
                </h2>
                <p className="max-w-2xl text-sm leading-relaxed text-gray-300">
                  Final assembly accepts one fresh approved multi-line snapshot. It never rebuilds an order from current media or substitutes a newer take.
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2 rounded-xl border border-[#33415d] bg-[#0c111b]/80 px-3 py-2.5 text-xs text-gray-300">
                <ShieldCheck className="h-4 w-4 text-amber-300" /> Assembly locked
              </div>
            </div>
          </div>
          <div className="flex items-start gap-3 px-4 py-5 sm:px-6">
            <div className="mt-0.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-amber-200">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white">Assembly blocked</p>
              <p className="mt-1.5 text-sm leading-relaxed text-amber-100/85">{evaluation.reason}</p>
              <p className="mt-2 text-xs leading-relaxed text-gray-500">
                No output is created. Open Shot Plan Proof to complete or confirm the current two- or three-line approval.
              </p>
            </div>
          </div>
        </section>
      </section>
    );
  }

  const { plan, shots } = evaluation;
  const totalShots = shots.length;
  const savedPosition = currentShot ? currentShotIndex + 1 : 0;
  const currentLine = currentShot?.lineNumber || 0;
  const currentSceneNumber = plan.scene_number;
  const progressPercent = assemblyProgress
    ? Math.min(100, Math.round((assemblyProgress.elapsedSeconds / Math.max(0.001, assemblyProgress.totalDurationSeconds)) * 100))
    : 0;
  const assemblyButtonDisabled = isAssembling || !onSaveAssemblyAsset;

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-2xl border border-amber-500/[0.35] bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,0.17),transparent_43%),#121926] shadow-xl shadow-black/20">
        <div className="border-b border-amber-500/20 px-4 py-5 sm:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-xs font-mono uppercase tracking-[0.18em] text-amber-300">
                <ListOrdered className="h-4 w-4" aria-hidden="true" /> Final scene assembly
                <span className="rounded-md border border-emerald-400/[0.35] bg-emerald-500/[0.12] px-2 py-1 text-[10px] tracking-wider text-emerald-100">
                  Fresh approved snapshot · one scene
                </span>
              </div>
              <h2 className="text-2xl font-serif font-bold tracking-tight text-white sm:text-3xl">
                Assemble one scene as WebM.
              </h2>
              <p className="max-w-2xl text-sm leading-relaxed text-gray-300">
                The saved shot order is ready for a browser-recorded hard cut. Masters stay muted, reviewed close-ups carry their embedded audio, and the managed WebM is saved as a new immutable attempt.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2 rounded-xl border border-[#33415d] bg-[#0c111b]/80 px-3 py-2.5 text-xs text-gray-300">
              <CheckCircle2 className="h-4 w-4 text-emerald-300" /> Current exact lineage
            </div>
          </div>
        </div>

        <div className="grid gap-3 px-4 py-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
          <div className="rounded-xl border border-[#2b3850] bg-[#0b1019] p-3.5">
            <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-gray-500">Scene</p>
            <p className="mt-1.5 text-lg font-semibold text-white">{formatScene(currentSceneNumber)}</p>
            <p className="mt-1 text-[11px] text-gray-500">{scene ? `${scene.character_focus.length} featured character${scene.character_focus.length === 1 ? "" : "s"}` : "Saved canonical scene"}</p>
          </div>
          <div className="rounded-xl border border-[#2b3850] bg-[#0b1019] p-3.5">
            <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-gray-500">Saved coverage</p>
            <p className="mt-1.5 text-lg font-semibold text-white">{plan.lines.length} lines · {totalShots} shots</p>
            <p className="mt-1 text-[11px] text-gray-500">Two exact roles per line</p>
          </div>
          <div className="rounded-xl border border-amber-500/25 bg-amber-950/15 p-3.5">
            <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-amber-300/75">Total scene duration</p>
            <p className="mt-1.5 text-lg font-semibold text-amber-100">{formatDuration(plan.total_duration_seconds)}</p>
            <p className="mt-1 text-[11px] text-amber-100/60">Saved timing authority</p>
          </div>
          <div className="rounded-xl border border-[#2b3850] bg-[#0b1019] p-3.5">
            <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-gray-500">Current position</p>
            <p className="mt-1.5 text-lg font-semibold text-white">{savedPosition ? `${savedPosition} / ${totalShots}` : "Ready"}</p>
            <p className="mt-1 text-[11px] text-gray-500">{currentLine ? `Line ${String(currentLine).padStart(2, "0")}` : "Press Play to begin"}</p>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-emerald-500/25 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.12),transparent_46%),#0d151d] shadow-xl shadow-black/[0.12]">
        <div className="flex flex-col gap-4 border-b border-emerald-500/15 px-4 py-5 sm:px-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono uppercase tracking-[0.18em] text-emerald-300">
              <UploadCloud className="h-4 w-4" aria-hidden="true" /> One scene saved as WebM
              <span className="rounded-md border border-emerald-300/25 bg-emerald-400/10 px-2 py-1 text-emerald-100">Browser session</span>
            </div>
            <h3 className="mt-2 text-xl font-serif font-bold text-white sm:text-2xl">Create the managed scene output.</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-gray-300">
              Press the button when the approved order is ready. The studio records each saved shot in this tab, uploads one WebM, and keeps every older attempt in the project history.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => void handleAssemble()}
              disabled={assemblyButtonDisabled}
              className="h-10 gap-2 bg-emerald-400 px-4 text-xs font-semibold text-[#06110d] hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {isAssembling ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <UploadCloud className="h-3.5 w-3.5" aria-hidden="true" />}
              {isAssembling ? phaseLabel(assemblyPhase) : "Assemble and save scene"}
            </Button>
            {isAssembling && (
              <Button
                type="button"
                onClick={handleCancelAssembly}
                disabled={assemblyFinalPersistenceRef.current || assemblyPhase === "saving-ready"}
                variant="outline"
                className="h-10 gap-2 border-red-400/35 bg-red-950/20 px-4 text-xs text-red-100 hover:border-red-300/60 hover:bg-red-950/40 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Square className="h-3.5 w-3.5" aria-hidden="true" /> Cancel
              </Button>
            )}
          </div>
        </div>

        <div className="space-y-4 px-4 py-4 sm:px-6">
          <div className="flex flex-col gap-3 rounded-xl border border-[#2b3a50] bg-[#0a1119]/80 p-3.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div className={`mt-0.5 rounded-lg border p-2 ${isAssembling ? "border-amber-400/30 bg-amber-400/10 text-amber-200" : currentReadyAsset ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "border-[#35435c] bg-[#151e2c] text-gray-300"}`}>
                {isAssembling ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : currentReadyAsset ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <Clock3 className="h-4 w-4" aria-hidden="true" />}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white">{isAssembling ? phaseLabel(assemblyPhase) : currentReadyAsset ? "Current scene WebM is ready" : "No current scene WebM yet"}</p>
                <p className="mt-1 text-xs leading-relaxed text-gray-400">
                  {isAssembling
                    ? "Keep this browser tab open while recording, uploading, and saving the attempt."
                    : currentReadyAsset
                      ? `Saved ${historyDate(currentReadyAsset.updated_at)} · ${formatDuration(currentReadyAsset.total_duration_seconds)} · ${currentReadyAsset.file_name}`
                      : "The approved shot plan stays available until you start an intentional assembly."}
                </p>
              </div>
            </div>
            {assemblyAttemptId && isAssembling && (
              <span className="shrink-0 rounded-md border border-[#35435c] bg-[#151e2c] px-2 py-1 text-[10px] font-mono text-gray-400" title={assemblyAttemptId}>
                Attempt {shortId(assemblyAttemptId, 20)}
              </span>
            )}
          </div>

          {isAssembling && assemblyProgress && (
            <div className="rounded-xl border border-amber-400/25 bg-amber-950/15 p-3.5" aria-live="polite">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-amber-300">Shot-by-shot progress</p>
                  <p className="mt-1 text-sm font-semibold text-white">Line {String(assemblyProgress.lineNumber).padStart(2, "0")} · {roleLabel(assemblyProgress.role)} · shot {assemblyProgress.shotNumber}</p>
                </div>
                <p className="text-xs text-amber-100/75">{formatDuration(assemblyProgress.elapsedSeconds)} of {formatDuration(assemblyProgress.totalDurationSeconds)} · {assemblyProgress.shotIndex} / {assemblyProgress.shotCount} shots</p>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#1a2635]" aria-label={`Assembly progress ${progressPercent}%`}>
                <div className="h-full rounded-full bg-amber-400 transition-[width] duration-300" style={{ width: `${progressPercent}%` }} />
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {shots.map((shot, index) => {
                  const isComplete = assemblyProgress.phase === "complete" || index < assemblyProgress.shotIndex - 1;
                  const isCurrent = assemblyProgress.phase === "recording" && index === assemblyProgress.shotIndex - 1;
                  return (
                    <div key={`assembly-progress-${shot.key}`} className={`rounded-lg border px-2.5 py-2 text-[10px] ${isCurrent ? "border-amber-300/45 bg-amber-400/10 text-amber-100" : isComplete ? "border-emerald-400/25 bg-emerald-400/[0.08] text-emerald-100" : "border-[#2b3a50] bg-[#0c141e] text-gray-500"}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono uppercase tracking-wider">{isComplete ? "Done" : isCurrent ? "Recording" : "Queued"}</span>
                        <span>{index + 1}/{shots.length}</span>
                      </div>
                      <p className="mt-1 truncate">Line {String(shot.lineNumber).padStart(2, "0")} · {roleShortLabel(shot.role)}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {assemblyError && (
            <div className="flex items-start gap-2 rounded-xl border border-red-700/[0.45] bg-red-950/25 px-3.5 py-3 text-xs leading-relaxed text-red-200" role="alert">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" aria-hidden="true" />
              <span>{assemblyError}</span>
            </div>
          )}
          {assemblyNotice && !assemblyError && (
            <p className="flex items-start gap-2 text-xs leading-relaxed text-emerald-100/75" aria-live="polite">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" aria-hidden="true" />
              <span>{assemblyNotice}</span>
            </p>
          )}

          {!onSaveAssemblyAsset && (
            <p className="text-xs leading-relaxed text-amber-100/70">Project persistence is not connected for this workspace yet. The approved shot plan remains read-only.</p>
          )}
          <p className="rounded-lg border border-[#27374d] bg-[#0a1119]/70 px-3 py-2.5 text-[11px] leading-relaxed text-gray-400">
            Keep this tab open for the full browser session. The next phase is episode-wide assembly and finishing layers, including captions, music, effects, ambience mixing, loudness mastering, and downloadable episode export.
          </p>
        </div>
      </section>

      {currentReadyAsset && (
        <section className="overflow-hidden rounded-2xl border border-emerald-400/30 bg-[#0d151d] shadow-xl shadow-black/[0.12]">
          <div className="flex flex-col gap-3 border-b border-emerald-400/15 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-emerald-300">Current saved output</p>
              <h3 className="mt-1 text-xl font-serif font-bold text-white">Play the managed scene WebM.</h3>
              <p className="mt-1 text-xs leading-relaxed text-gray-400">This player uses the exact managed URL saved with the current shot-plan identity.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <a
                href={currentReadyAsset.video_url || undefined}
                download={currentReadyAsset.file_name}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-emerald-300/30 bg-emerald-400/10 px-3 text-xs font-semibold text-emerald-100 transition-colors hover:border-emerald-200/60 hover:bg-emerald-400/20"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" /> Download
              </a>
              <a
                href={currentReadyAsset.video_url || undefined}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-9 items-center gap-2 rounded-md border border-[#3b4c65] bg-[#151f2d] px-3 text-xs font-semibold text-gray-200 transition-colors hover:border-emerald-300/50 hover:bg-[#1b2b3c]"
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> Open
              </a>
            </div>
          </div>
          <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
            <video
              src={currentReadyAsset.video_url || undefined}
              controls
              playsInline
              preload="metadata"
              className="aspect-[9/16] w-full max-w-[260px] rounded-xl border border-[#34445b] bg-black object-contain"
            />
            <div className="grid content-start gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-[#293950] bg-[#0a1119] p-3">
                <p className="text-[10px] font-mono uppercase tracking-wider text-gray-500">Saved file</p>
                <p className="mt-1.5 break-all text-xs font-semibold text-white">{currentReadyAsset.file_name}</p>
                <p className="mt-1 text-[10px] text-gray-500">{currentReadyAsset.content_type}</p>
              </div>
              <div className="rounded-xl border border-[#293950] bg-[#0a1119] p-3">
                <p className="text-[10px] font-mono uppercase tracking-wider text-gray-500">Saved timing</p>
                <p className="mt-1.5 text-base font-semibold text-emerald-100">{formatDuration(currentReadyAsset.total_duration_seconds)}</p>
                <p className="mt-1 text-[10px] text-gray-500">{currentReadyAsset.shot_count} ordered shots</p>
              </div>
              <div className="rounded-xl border border-[#293950] bg-[#0a1119] p-3 sm:col-span-2">
                <p className="text-[10px] font-mono uppercase tracking-wider text-gray-500">Output identity</p>
                <p className="mt-1.5 text-xs text-gray-200">Scene {formatScene(currentReadyAsset.scene_number)} · {shortId(currentReadyAsset.shot_plan_source_signature, 34)}</p>
                <p className="mt-1 text-[10px] text-gray-500">Shot-plan checkpoint updated {historyDate(currentReadyAsset.shot_plan_updated_at)}</p>
              </div>
            </div>
          </div>
        </section>
      )}

      {retainedAssemblyAssets.length > 0 && (
        <section className="rounded-2xl border border-[#293650] bg-[#0d131e] p-4 shadow-lg shadow-black/[0.12] sm:p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-gray-500">Retained assembly history</p>
              <h3 className="mt-1 text-xl font-serif font-bold text-white">Older attempts stay available.</h3>
            </div>
            <p className="text-xs text-gray-500">Only a READY output matching the current plan is playable above.</p>
          </div>
          <div className="mt-4 space-y-2">
            {retainedAssemblyAssets.map((asset) => {
              const isCurrentPlanReady = evaluation.valid && hasExactAssemblyIdentity(asset, plan, shots);
              const statusLabel = asset.status === "FAILED"
                ? "Failed attempt retained"
                : asset.status === "PROCESSING"
                  ? "Processing attempt retained"
                  : isCurrentPlanReady
                    ? "Current output"
                    : "Older output · stale for this plan";
              return (
                <div key={asset.assembly_id} className="flex flex-col gap-3 rounded-xl border border-[#293950] bg-[#0a1119] p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-md border px-2 py-1 text-[10px] font-mono uppercase tracking-wider ${asset.status === "READY" && !isCurrentPlanReady ? "border-amber-400/25 bg-amber-400/10 text-amber-100" : asset.status === "FAILED" ? "border-red-400/25 bg-red-400/10 text-red-100" : "border-[#3a4b64] bg-[#151f2d] text-gray-300"}`}>
                        {statusLabel}
                      </span>
                      <span className="text-[10px] text-gray-500">{historyDate(asset.updated_at)}</span>
                    </div>
                    <p className="mt-1.5 truncate text-xs font-semibold text-gray-200">{asset.file_name}</p>
                    <p className="mt-1 text-[10px] text-gray-500">Scene {formatScene(asset.scene_number)} · {asset.shot_count} shots · {formatDuration(asset.total_duration_seconds)} · Attempt {shortId(asset.assembly_id, 22)}</p>
                    {asset.status === "FAILED" && asset.error && <p className="mt-1 text-[10px] leading-relaxed text-red-200/75">{asset.error}</p>}
                    {asset.status === "READY" && !isCurrentPlanReady && <p className="mt-1 text-[10px] leading-relaxed text-amber-100/65">The saved link stays available for review, but this output cannot replace the current plan.</p>}
                  </div>
                  {asset.status === "READY" && isSecureHttpsUrl(asset.video_url) && (
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <a href={asset.video_url} download={asset.file_name} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#3a4b64] bg-[#151f2d] px-2.5 text-[11px] font-semibold text-gray-200 hover:border-amber-300/50 hover:bg-[#1b2b3c">
                        <Download className="h-3.5 w-3.5" aria-hidden="true" /> Download
                      </a>
                      <a href={asset.video_url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#3a4b64] bg-[#151f2d] px-2.5 text-[11px] font-semibold text-gray-200 hover:border-amber-300/50 hover:bg-[#1b2b3c">
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> Open
                      </a>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-amber-400">Persisted order ledger</p>
              <h3 className="mt-1 text-xl font-serif font-bold text-white">Every saved shot, in sequence</h3>
            </div>
            <p className="text-xs text-gray-500">Line order locked · shot order loaded from approval</p>
          </div>

          <div className="space-y-3">
            {shots.map((shot, index) => {
              const isCurrent = currentShot?.key === shot.key;
              const savedLineage = shot.role === "master"
                ? `Master clip · ${shot.masterClipId || "missing ID"}`
                : `Close-up · ${shot.closeupClipId || "missing ID"}`;
              return (
                <article
                  key={shot.key}
                  aria-current={isCurrent ? "step" : undefined}
                  className={`overflow-hidden rounded-2xl border bg-[#101622] shadow-lg shadow-black/[0.15] transition-colors ${isCurrent ? "border-amber-500/55 ring-1 ring-amber-300/[0.18]" : "border-[#293650]"}`}
                >
                  <div className="border-b border-[#202b42] px-4 py-3.5 sm:px-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border font-mono text-xs font-bold ${isCurrent ? "border-amber-400/45 bg-amber-500/15 text-amber-100" : "border-[#35425d] bg-[#151e2e] text-gray-300"}`}>
                          {String(index + 1).padStart(2, "0")}
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[10px] font-mono uppercase tracking-wider text-amber-300">Line {String(shot.lineNumber).padStart(2, "0")}</span>
                            <span className="rounded-md border border-[#35425d] bg-[#151e2e] px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-gray-300">{shot.characterId}</span>
                            <span className={`rounded-md border px-2 py-1 text-[10px] font-mono uppercase tracking-wider ${isCurrent ? "border-amber-400/35 bg-amber-500/10 text-amber-100" : "border-[#35425d] bg-[#151e2e] text-gray-400"}`}>
                              {isCurrent ? "Current saved shot" : `Shot ${shot.shotNumber} in line`}
                            </span>
                          </div>
                          <p className="mt-2 text-sm leading-relaxed text-gray-100">“{shot.text}”</p>
                        </div>
                      </div>
                      <span className="shrink-0 rounded-md border border-amber-500/25 bg-amber-500/10 px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-amber-200">
                        {roleLabel(shot.role)}
                      </span>
                    </div>
                  </div>

                  <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
                    <div className="rounded-xl border border-[#27344d] bg-[#0b1019] p-3">
                      <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-gray-500">
                        <Clock3 className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" /> Saved duration
                      </div>
                      <p className="mt-1.5 text-base font-semibold text-amber-100">{formatDuration(shot.durationSeconds)}</p>
                      <p className="mt-1 text-[10px] leading-relaxed text-gray-500">Displayed from the approved snapshot and used by the browser recorder.</p>
                    </div>
                    <div className="rounded-xl border border-[#27344d] bg-[#0b1019] p-3">
                      <p className="text-[10px] font-mono uppercase tracking-wider text-gray-500">Saved playback source</p>
                      <p className="mt-1.5 text-sm font-semibold text-white">{shot.role === "master" ? "Master video" : "Reviewed lip-sync video"}</p>
                      <p className="mt-1 text-[10px] leading-relaxed text-gray-500">{shot.role === "master" ? "Muted in this proof and final scene recording." : "Embedded audio is retained in the recorded close-up."}</p>
                    </div>
                    <div className="rounded-xl border border-[#27344d] bg-[#0b1019] p-3 sm:col-span-2">
                      <p className="text-[10px] font-mono uppercase tracking-wider text-gray-500">Persisted lineage IDs</p>
                      <div className="mt-2 grid gap-2 text-[10px] text-gray-300 sm:grid-cols-2 xl:grid-cols-4">
                        <p title={shot.masterClipId || undefined}><span className="text-gray-500">{savedLineage.split(" · ")[0]}:</span> {shortId(shot.masterClipId || "not applicable")}</p>
                        {shot.role === "reviewed-closeup" ? (
                          <>
                            <p title={shot.closeupClipId || undefined}><span className="text-gray-500">Close-up:</span> {shortId(shot.closeupClipId || "missing ID")}</p>
                            <p title={shot.lipsyncId || undefined}><span className="text-gray-500">Lip-sync:</span> {shortId(shot.lipsyncId || "missing ID")}</p>
                            <p title={shot.audioUrl || undefined}><span className="text-gray-500">Audio take:</span> {mediaToken(shot.audioUrl || "")}</p>
                          </>
                        ) : (
                          <p className="text-gray-500">Reviewed close-up, lip-sync, and audio IDs do not apply to this master.</p>
                        )}
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        <section className="space-y-3 lg:sticky lg:top-4">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-amber-400">Saved hard-cut proof</p>
            <h3 className="mt-1 text-xl font-serif font-bold text-white">Review the approved sequence</h3>
          </div>
          <div className="rounded-2xl border border-[#293650] bg-[#0d131e] p-3 shadow-xl shadow-black/[0.15] sm:p-4">
            <div className="relative mx-auto aspect-[9/16] w-full max-w-[320px] overflow-hidden rounded-xl border border-[#34415c] bg-black">
              <video
                ref={videoRef}
                src={currentShot?.videoUrl}
                muted={currentShot?.role === "master"}
                playsInline
                preload="metadata"
                className="h-full w-full bg-black object-contain"
                onCanPlay={handleCanPlay}
                onEnded={handleVideoEnded}
                onError={handleVideoError}
              />
              {currentShot && (
                <div className="pointer-events-none absolute inset-x-3 top-3 flex items-start justify-between gap-2">
                  <span className="rounded-md border border-black/30 bg-black/75 px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-amber-100 backdrop-blur-sm">
                    Line {String(currentShot.lineNumber).padStart(2, "0")} · {roleLabel(currentShot.role)}
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
                {currentShot ? `Shot ${savedPosition} of ${totalShots}` : "No shot selected"}
              </span>
              <span className="text-gray-500">{currentShot ? `Line ${currentLine}` : "Saved order unavailable"}</span>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() => void handlePlay()}
                disabled={!currentShot || isPlaying}
                className="h-10 gap-2 bg-amber-500 px-3 text-xs font-semibold text-black hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
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
              <p className="font-semibold text-amber-100">Audio boundary</p>
              <p className="mt-1">Masters stay muted. Reviewed lip-sync videos supply their embedded audio. The saved audio URL remains lineage metadata and never becomes a second player.</p>
            </div>
          </div>
        </section>
      </section>

      <section className="rounded-2xl border border-[#293650] bg-[#0d131e] p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-2 text-emerald-300">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Final scene assembly boundary</p>
              <p className="mt-1 text-xs leading-relaxed text-gray-400">This phase saves one approved multi-line scene as WebM. It does not assemble multiple screenplay scenes or add captions, music, effects, ambience mixing, loudness mastering, or episode-wide export.</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-emerald-300">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Plan unchanged
          </div>
        </div>
      </section>
    </div>
  );
};
