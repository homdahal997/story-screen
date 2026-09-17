import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  AudioLines,
  CheckCircle2,
  Clock3,
  Film,
  Info,
  Pause,
  Play,
  RotateCcw,
  Square,
  VolumeX,
  Waves,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AmbienceAudioAsset,
  DialogueAudioAsset,
  DialogueLine,
  DialogueShotClip,
  DramaManifest,
  DramaScene,
  FrameAsset,
  LipsyncAsset,
  ReviewedShotCandidate,
  VideoClip,
  deriveDialogueLines,
  deriveReviewedShotCandidates,
  getLegacyDialogueLineId,
} from "@/lib/dramaStudio";

export interface SceneMixProofProps {
  manifest: DramaManifest;
  videoClips?: VideoClip[];
  audioAssets?: DialogueAudioAsset[];
  ambienceAssets?: AmbienceAudioAsset[];
  frameAssets?: FrameAsset[];
  dialogueShotClips?: DialogueShotClip[];
  lipsyncAssets?: LipsyncAsset[];
  isDirty?: boolean;
  isSaving?: boolean;
  isApproving?: boolean;
  isGeneratingFrames?: boolean;
  isPollingMotion?: boolean;
  isSynthesizingVoice?: boolean;
  isGeneratingAmbience?: boolean;
}

type MixTake = {
  line: DialogueLine;
  asset: DialogueAudioAsset;
};

type MixDialogueStatus = "silent" | "complete" | "partial" | "missing";

type MixScene = {
  scene: DramaScene;
  sceneNumber: number;
  lines: DialogueLine[];
  matchedAudio: Array<DialogueAudioAsset | null>;
  takes: MixTake[];
  clip: VideoClip | null;
  ambienceAsset: AmbienceAudioAsset | null;
  currentStoryboardUrl: string | null;
  isArchivedFromEarlierStoryboard: boolean;
  matchedCount: number;
  dialogueStatus: MixDialogueStatus;
  canPlay: boolean;
};

function isSecureHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    return new URL(value.trim()).protocol === "https:";
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

function findNewestPlayableClip(clips: VideoClip[], sceneNumber: number): VideoClip | null {
  return [...clips]
    .filter(
      (clip) =>
        clip.provider === "replicate-luma" &&
        clip.scene_number === sceneNumber &&
        clip.status === "READY" &&
        typeof clip.prediction_id === "string" &&
        Boolean(clip.prediction_id.trim()) &&
        isSecureHttpsUrl(clip.video_url)
    )
    .sort((left, right) => mediaTimestamp(right) - mediaTimestamp(left))[0] || null;
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

function findNewestAmbience(
  assets: AmbienceAudioAsset[],
  sceneNumber: number
): AmbienceAudioAsset | null {
  return [...assets]
    .filter(
      (asset) =>
        asset.asset_type === "ambience" &&
        asset.provider === "elevenlabs" &&
        asset.status === "READY" &&
        asset.scene_number === sceneNumber &&
        asset.content_type === "audio/mpeg" &&
        isSecureHttpsUrl(asset.audio_url)
    )
    .sort((left, right) => mediaTimestamp(right) - mediaTimestamp(left))[0] || null;
}

function formatClock(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "--:--";
  const safeValue = Math.max(0, Math.floor(value));
  const minutes = Math.floor(safeValue / 60);
  const seconds = safeValue % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatScene(sceneNumber: number): string {
  return String(sceneNumber).padStart(2, "0");
}

function getClipDuration(clip: VideoClip | null): number {
  const duration = clip ? Number(clip.duration_seconds) : 0;
  return Number.isFinite(duration) && duration > 0 ? duration : 5;
}

function dialogueStatusLabel(status: MixDialogueStatus): string {
  if (status === "silent") return "Silent scene";
  if (status === "complete") return "Complete dialogue";
  if (status === "partial") return "Partial dialogue";
  return "Missing dialogue";
}

function dialogueStatusClass(status: MixDialogueStatus): string {
  if (status === "silent") return "border-[#3b4963] bg-[#151d2c] text-gray-300";
  if (status === "complete") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  if (status === "partial") return "border-amber-500/[0.35] bg-amber-500/10 text-amber-200";
  return "border-red-500/30 bg-red-500/10 text-red-200";
}

function reviewedShotCandidateKey(candidate: ReviewedShotCandidate): string {
  return JSON.stringify([
    candidate.scene_number,
    candidate.line_id,
    candidate.closeup_prediction_id,
    candidate.lipsync_prediction_id,
  ]);
}

type AudioReadinessErrorCode = "cancelled" | "media-error" | "timeout";
type AudioReadinessError = Error & { code: AudioReadinessErrorCode };

const AUDIO_READINESS_TIMEOUT_MS = 12000;

function isExpectedAudioSource(audio: HTMLAudioElement, expectedUrl: string): boolean {
  const expected = expectedUrl.trim();
  if (!expected) return false;
  const sourceAttribute = audio.getAttribute("src")?.trim() || "";
  const currentSource = audio.currentSrc?.trim() || "";
  return sourceAttribute === expected || currentSource === expected;
}

function createAudioReadinessError(
  code: AudioReadinessErrorCode,
  message: string
): AudioReadinessError {
  const error = new Error(message) as AudioReadinessError;
  error.code = code;
  return error;
}

function waitForAudioReady(
  audio: HTMLAudioElement,
  expectedUrl: string,
  signal: AbortSignal,
  timeoutMs = AUDIO_READINESS_TIMEOUT_MS
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timeoutId !== null) clearTimeout(timeoutId);
      audio.removeEventListener("canplay", handleReady);
      audio.removeEventListener("loadeddata", handleReady);
      audio.removeEventListener("loadedmetadata", handleReady);
      audio.removeEventListener("playing", handleReady);
      audio.removeEventListener("error", handleMediaError);
      audio.removeEventListener("abort", handleMediaAbort);
      signal.removeEventListener("abort", handleCancelled);
    };

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };

    const resolveIfReady = () => {
      if (!isExpectedAudioSource(audio, expectedUrl)) return;
      if (audio.readyState >= 3) {
        finish(() => resolve());
      }
    };

    const handleReady = () => resolveIfReady();
    const handleMediaError = () => {
      if (!isExpectedAudioSource(audio, expectedUrl)) return;
      finish(() => reject(createAudioReadinessError("media-error", "The saved dialogue source reported a media error.")));
    };
    const handleMediaAbort = () => {
      if (!isExpectedAudioSource(audio, expectedUrl)) return;
      finish(() => reject(createAudioReadinessError("media-error", "The saved dialogue source was aborted before playback.")));
    };
    const handleCancelled = () => {
      finish(() => reject(createAudioReadinessError("cancelled", "The dialogue transition was cancelled.")));
    };

    if (signal.aborted) {
      handleCancelled();
      return;
    }

    audio.addEventListener("canplay", handleReady);
    audio.addEventListener("loadeddata", handleReady);
    audio.addEventListener("loadedmetadata", handleReady);
    audio.addEventListener("playing", handleReady);
    audio.addEventListener("error", handleMediaError);
    audio.addEventListener("abort", handleMediaAbort);
    signal.addEventListener("abort", handleCancelled, { once: true });
    timeoutId = setTimeout(() => {
      finish(() => reject(createAudioReadinessError("timeout", "The saved dialogue source did not become playable in time.")));
    }, timeoutMs);

    if (audio.error) {
      handleMediaError();
      return;
    }
    resolveIfReady();
  });
}

function isAudioReadinessCancellation(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "cancelled"
  );
}

export const SceneMixProof: React.FC<SceneMixProofProps> = ({
  manifest,
  videoClips = [],
  audioAssets = [],
  ambienceAssets = [],
  frameAssets = [],
  dialogueShotClips = [],
  lipsyncAssets = [],
  isDirty = false,
  isSaving = false,
  isApproving = false,
  isGeneratingFrames = false,
  isPollingMotion = false,
  isSynthesizingVoice = false,
  isGeneratingAmbience = false,
}) => {
  const mixScenes = useMemo<MixScene[]>(() => {
    const safeScenes = Array.isArray(manifest?.scenes) ? manifest.scenes : [];
    const safeClips = Array.isArray(videoClips) ? videoClips : [];
    const safeAudioAssets = Array.isArray(audioAssets) ? audioAssets : [];
    const safeAmbienceAssets = Array.isArray(ambienceAssets) ? ambienceAssets : [];
    const safeFrameAssets = Array.isArray(frameAssets) ? frameAssets : [];

    return [...safeScenes]
      .sort((left, right) => left.scene_number - right.scene_number)
      .map((scene) => {
        const lines = deriveDialogueLines(scene);
        const matchedAudio = lines.map((line) =>
          findNewestMatchingAudio(safeAudioAssets, scene.scene_number, line)
        );
        const takes = lines.flatMap((line, index) => {
          const asset = matchedAudio[index];
          return asset ? [{ line, asset }] : [];
        });
        const clip = findNewestPlayableClip(safeClips, scene.scene_number);
        const ambienceAsset = findNewestAmbience(safeAmbienceAssets, scene.scene_number);
        const storyboard = safeFrameAssets.find(
          (asset) =>
            asset.asset_type === "scene_storyboard" &&
            asset.scene_number === scene.scene_number &&
            typeof asset.image_url === "string" &&
            asset.image_url.trim()
        );
        const currentStoryboardUrl = storyboard?.image_url.trim() || null;
        const isArchivedFromEarlierStoryboard = Boolean(
          clip && (!currentStoryboardUrl || clip.source_storyboard_url !== currentStoryboardUrl)
        );
        const matchedCount = takes.length;
        const dialogueStatus: MixDialogueStatus =
          lines.length === 0
            ? "silent"
            : matchedCount === lines.length
              ? "complete"
              : matchedCount > 0
                ? "partial"
                : "missing";

        return {
          scene,
          sceneNumber: scene.scene_number,
          lines,
          matchedAudio,
          takes,
          clip,
          ambienceAsset,
          currentStoryboardUrl,
          isArchivedFromEarlierStoryboard,
          matchedCount,
          dialogueStatus,
          canPlay: Boolean(clip && matchedCount > 0),
        };
      });
  }, [manifest, videoClips, audioAssets, ambienceAssets, frameAssets]);

  const reviewedShotCandidates = useMemo<ReviewedShotCandidate[]>(
    () => deriveReviewedShotCandidates(manifest, dialogueShotClips, lipsyncAssets, audioAssets),
    [manifest, dialogueShotClips, lipsyncAssets, audioAssets]
  );

  const playableSceneCount = mixScenes.filter((entry) => entry.canPlay).length;
  const completeDialogueCount = mixScenes.filter((entry) => entry.dialogueStatus === "complete").length;
  const partialDialogueCount = mixScenes.filter((entry) => entry.dialogueStatus === "partial").length;
  const missingDialogueCount = mixScenes.filter((entry) => entry.dialogueStatus === "missing").length;
  const silentSceneCount = mixScenes.filter((entry) => entry.dialogueStatus === "silent").length;
  const archivedSceneCount = mixScenes.filter((entry) => entry.isArchivedFromEarlierStoryboard).length;
  const ambienceSceneCount = mixScenes.filter((entry) => Boolean(entry.ambienceAsset)).length;

  const [selectedSceneNumber, setSelectedSceneNumber] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentLineIndex, setCurrentLineIndex] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [visualDuration, setVisualDuration] = useState(0);
  const [dialogueFinished, setDialogueFinished] = useState(false);
  const [visualShotEnded, setVisualShotEnded] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [playbackNotice, setPlaybackNotice] = useState<string | null>(null);
  const [dialogueLevel, setDialogueLevel] = useState(0.78);
  const [ambienceLevel, setAmbienceLevel] = useState(0.34);
  const [durationsByUrl, setDurationsByUrl] = useState<Record<string, number>>({});
  const [selectedReviewedShotKey, setSelectedReviewedShotKey] = useState<string | null>(null);
  const [reviewedShotPlaybackError, setReviewedShotPlaybackError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const reviewedShotVideoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ambienceAudioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<MixTake[]>([]);
  const currentLineIndexRef = useRef(0);
  const isPlayingRef = useRef(false);
  const dialogueFinishedRef = useRef(false);
  const visualShotEndedRef = useRef(false);
  const dialogueLevelRef = useRef(dialogueLevel);
  const ambienceLevelRef = useRef(ambienceLevel);

  useEffect(() => {
    setSelectedSceneNumber((current) => {
      if (current !== null && mixScenes.some((entry) => entry.sceneNumber === current)) {
        return current;
      }
      return mixScenes.find((entry) => entry.canPlay)?.sceneNumber ?? mixScenes[0]?.sceneNumber ?? null;
    });
  }, [mixScenes]);

  const selectedEntry = useMemo(
    () => mixScenes.find((entry) => entry.sceneNumber === selectedSceneNumber) || null,
    [mixScenes, selectedSceneNumber]
  );
  const selectedReviewedShotCandidates = useMemo(
    () => reviewedShotCandidates.filter((candidate) => candidate.scene_number === selectedSceneNumber),
    [reviewedShotCandidates, selectedSceneNumber]
  );
  const selectedReviewedShotRecordCount = useMemo(() => {
    if (selectedSceneNumber === null) return 0;
    const hasCloseupRecord = Array.isArray(dialogueShotClips) && dialogueShotClips.some(
      (clip) => Boolean(clip && typeof clip === "object" && clip.scene_number === selectedSceneNumber)
    );
    const hasLipsyncRecord = Array.isArray(lipsyncAssets) && lipsyncAssets.some(
      (asset) => Boolean(asset && typeof asset === "object" && asset.scene_number === selectedSceneNumber)
    );
    const hasAudioRecord = Array.isArray(audioAssets) && audioAssets.some(
      (asset) => Boolean(asset && typeof asset === "object" && asset.scene_number === selectedSceneNumber)
    );
    return Number(hasCloseupRecord || hasLipsyncRecord || hasAudioRecord);
  }, [audioAssets, dialogueShotClips, lipsyncAssets, selectedSceneNumber]);
  const selectedReviewedShot = selectedReviewedShotCandidates.find(
    (candidate) => reviewedShotCandidateKey(candidate) === selectedReviewedShotKey
  ) || null;

  useEffect(() => {
    if (
      selectedReviewedShotKey &&
      !selectedReviewedShotCandidates.some((candidate) => reviewedShotCandidateKey(candidate) === selectedReviewedShotKey)
    ) {
      setSelectedReviewedShotKey(null);
    }
  }, [selectedReviewedShotCandidates, selectedReviewedShotKey]);

  useEffect(() => {
    setReviewedShotPlaybackError(null);
    const player = reviewedShotVideoRef.current;
    if (player) {
      player.pause();
      try {
        player.currentTime = 0;
      } catch {
        // A browser can reject a seek while a reviewed shot is loading.
      }
    }
  }, [selectedReviewedShotKey, selectedSceneNumber]);

  const playbackQueue = useMemo<MixTake[]>(
    () => selectedEntry?.takes || [],
    [selectedEntry]
  );
  const currentTake = playbackQueue[currentLineIndex] || null;
  const currentAudioAsset = currentTake?.asset || null;
  const selectedAmbienceAsset = selectedEntry?.ambienceAsset || null;

  const getTakeDuration = useCallback(
    (take: MixTake): number => {
      const measured = durationsByUrl[take.asset.audio_url];
      if (Number.isFinite(measured) && measured > 0) return measured;
      const saved = Number(take.asset.duration_seconds);
      return Number.isFinite(saved) && saved > 0 ? saved : 0;
    },
    [durationsByUrl]
  );

  const dialogueTotalSeconds = useMemo(() => {
    const total = playbackQueue.reduce((sum, take) => sum + getTakeDuration(take), 0);
    return total > 0 ? total : null;
  }, [getTakeDuration, playbackQueue]);

  const selectedMediaKey = selectedEntry
    ? `${selectedEntry.sceneNumber}:${selectedEntry.clip?.prediction_id || "no-clip"}:${selectedEntry.clip?.video_url || ""}:${selectedAmbienceAsset?.audio_url || "no-ambience"}:${playbackQueue.map((take) => `${take.line.line_id}:${take.asset.audio_url}`).join("|")}`
    : "no-scene";

  const selectedMediaKeyRef = useRef("no-scene");
  const selectedSceneNumberRef = useRef<number | null>(null);
  const handoffGenerationRef = useRef(0);
  const handoffAbortRef = useRef<AbortController | null>(null);
  const handoffContextRef = useRef<{ source: string; mediaKey: string } | null>(null);
  const cancelledHandoffRef = useRef<{ source: string; mediaKey: string } | null>(null);
  selectedMediaKeyRef.current = selectedMediaKey;
  selectedSceneNumberRef.current = selectedSceneNumber;

  const cancelPendingHandoff = useCallback(() => {
    handoffGenerationRef.current += 1;
    if (handoffAbortRef.current && handoffContextRef.current) {
      cancelledHandoffRef.current = handoffContextRef.current;
    }
    handoffContextRef.current = null;
    handoffAbortRef.current?.abort();
    handoffAbortRef.current = null;
  }, []);

  const beginHandoff = useCallback(
    (source: string, mediaKey: string) => {
      cancelPendingHandoff();
      const controller = new AbortController();
      handoffAbortRef.current = controller;
      handoffContextRef.current = { source, mediaKey };
      const token = handoffGenerationRef.current + 1;
      handoffGenerationRef.current = token;
      return { controller, token };
    },
    [cancelPendingHandoff]
  );

  const blockingReason = isDirty
    ? "Save screenplay edits before reviewing the saved scene mix."
    : isSaving
      ? "Playback is paused while the project is saving."
      : isApproving
        ? "Playback is unavailable while screenplay approval is being recorded."
        : isGeneratingFrames
          ? "Playback is unavailable while visual references are being generated."
          : isPollingMotion
            ? "Playback is unavailable while a motion test is being checked."
            : isSynthesizingVoice
              ? "Playback is unavailable while a voice take is being synthesized."
              : isGeneratingAmbience
                ? "Playback is unavailable while the selected ambience bed is being generated."
                : null;
  const sceneMediaReady = Boolean(selectedEntry?.canPlay);
  const playbackDisabled = Boolean(blockingReason || !sceneMediaReady);
  const playbackProgress = dialogueTotalSeconds
    ? Math.min(100, Math.max(0, (elapsedSeconds / dialogueTotalSeconds) * 100))
    : 0;
  const visualShotDuration = visualDuration || getClipDuration(selectedEntry?.clip || null);

  useEffect(() => {
    queueRef.current = playbackQueue;
  }, [playbackQueue]);

  useEffect(() => {
    dialogueLevelRef.current = dialogueLevel;
    if (audioRef.current) audioRef.current.volume = dialogueLevel;
  }, [dialogueLevel]);

  useEffect(() => {
    ambienceLevelRef.current = ambienceLevel;
    if (ambienceAudioRef.current) ambienceAudioRef.current.volume = ambienceLevel;
  }, [ambienceLevel]);

  const stopMedia = useCallback((clearSources = false) => {
    cancelPendingHandoff();
    const video = videoRef.current;
    const audio = audioRef.current;
    const ambienceAudio = ambienceAudioRef.current;
    if (video) {
      video.pause();
      try {
        video.currentTime = 0;
      } catch {
        // A browser can reject a seek while a source is loading.
      }
      if (clearSources) {
        video.removeAttribute("src");
        video.load();
      }
    }
    if (audio) {
      audio.pause();
      try {
        audio.currentTime = 0;
      } catch {
        // An audio timeline may not be seekable before metadata loads.
      }
      if (clearSources) {
        audio.removeAttribute("src");
        audio.load();
      }
    }
    if (ambienceAudio) {
      ambienceAudio.pause();
      try {
        ambienceAudio.currentTime = 0;
      } catch {
        // An ambience timeline may not be seekable before metadata loads.
      }
      if (clearSources) {
        ambienceAudio.removeAttribute("src");
        ambienceAudio.load();
      }
    }
  }, [cancelPendingHandoff]);

  const resetPlaybackState = useCallback(
    (notice: string | null = null, clearSources = false) => {
      isPlayingRef.current = false;
      dialogueFinishedRef.current = false;
      visualShotEndedRef.current = false;
      currentLineIndexRef.current = 0;
      stopMedia(clearSources);
      setIsPlaying(false);
      setCurrentLineIndex(0);
      setElapsedSeconds(0);
      setVisualDuration(0);
      setDialogueFinished(false);
      setVisualShotEnded(false);
      setPlaybackError(null);
      setPlaybackNotice(notice);
    },
    [stopMedia]
  );

  const syncMediaSources = useCallback((entry: MixScene | null, takeIndex: number) => {
    const video = videoRef.current;
    const audio = audioRef.current;
    const ambienceAudio = ambienceAudioRef.current;
    if (!video || !audio || !ambienceAudio) return;

    const videoUrl = entry?.clip?.video_url?.trim() || null;
    if (videoUrl) {
      if (video.getAttribute("src") !== videoUrl) {
        video.setAttribute("src", videoUrl);
        video.load();
      }
    } else if (video.getAttribute("src")) {
      video.removeAttribute("src");
      video.load();
    }

    const audioUrl = entry?.takes[takeIndex]?.asset.audio_url?.trim() || null;
    if (audioUrl) {
      if (audio.getAttribute("src") !== audioUrl) {
        audio.setAttribute("src", audioUrl);
        audio.load();
      }
      audio.volume = dialogueLevelRef.current;
    } else if (audio.getAttribute("src")) {
      audio.removeAttribute("src");
      audio.load();
    }

    const ambienceUrl = entry?.ambienceAsset?.audio_url?.trim() || null;
    if (ambienceUrl) {
      if (ambienceAudio.getAttribute("src") !== ambienceUrl) {
        ambienceAudio.setAttribute("src", ambienceUrl);
        ambienceAudio.load();
      }
      ambienceAudio.loop = true;
      ambienceAudio.volume = ambienceLevelRef.current;
    } else if (ambienceAudio.getAttribute("src")) {
      ambienceAudio.removeAttribute("src");
      ambienceAudio.load();
    }
  }, []);

  const handlePlaybackFailure = useCallback((message: string) => {
    isPlayingRef.current = false;
    dialogueFinishedRef.current = false;
    visualShotEndedRef.current = false;
    currentLineIndexRef.current = 0;
    stopMedia(true);
    setIsPlaying(false);
    setCurrentLineIndex(0);
    setElapsedSeconds(0);
    setDialogueFinished(false);
    setVisualShotEnded(false);
    setPlaybackError(message);
    setPlaybackNotice(null);
  }, [stopMedia]);

  useEffect(() => {
    resetPlaybackState(null, false);
  }, [resetPlaybackState, selectedMediaKey]);

  useEffect(() => {
    if (blockingReason) resetPlaybackState(blockingReason, true);
  }, [blockingReason, resetPlaybackState]);

  useEffect(() => {
    return () => {
      isPlayingRef.current = false;
      stopMedia(true);
    };
  }, [stopMedia]);

  const registerAudioDuration = useCallback((url: string, duration: number) => {
    if (!url || !Number.isFinite(duration) || duration <= 0 || duration > 3600) return;
    setDurationsByUrl((current) => {
      if (Math.abs((current[url] || 0) - duration) < 0.01) return current;
      return { ...current, [url]: duration };
    });
  }, []);

  const handleAudioMetadata = (event: React.SyntheticEvent<HTMLAudioElement>) => {
    const duration = event.currentTarget.duration;
    const url = event.currentTarget.currentSrc || currentAudioAsset?.audio_url || "";
    registerAudioDuration(url, duration);
  };

  const handlePlay = async () => {
    if (playbackDisabled || !selectedEntry?.clip?.video_url || !playbackQueue.length || isPlayingRef.current) return;

    const video = videoRef.current;
    const audio = audioRef.current;
    const ambienceAudio = ambienceAudioRef.current;
    if (!video || !audio) return;

    cancelledHandoffRef.current = null;
    setPlaybackError(null);
    setPlaybackNotice(null);

    if (dialogueFinishedRef.current && (visualShotEndedRef.current || video.ended)) {
      dialogueFinishedRef.current = false;
      visualShotEndedRef.current = false;
      currentLineIndexRef.current = 0;
      setCurrentLineIndex(0);
      setElapsedSeconds(0);
      setDialogueFinished(false);
      setVisualShotEnded(false);
      stopMedia(false);
    } else if (video.ended || visualShotEndedRef.current) {
      // Keep the current dialogue position while the visual holds its last frame.
      visualShotEndedRef.current = true;
      setVisualShotEnded(true);
      video.pause();
    }

    if (currentLineIndexRef.current >= playbackQueue.length) {
      currentLineIndexRef.current = 0;
      setCurrentLineIndex(0);
    }
    const activeTake = playbackQueue[currentLineIndexRef.current];
    if (!activeTake) return;

    syncMediaSources(selectedEntry, currentLineIndexRef.current);
    audio.volume = dialogueLevelRef.current;
    isPlayingRef.current = true;
    setIsPlaying(true);

    try {
      const starts: Promise<void>[] = [];
      if (!visualShotEndedRef.current) starts.push(video.play());
      if (!dialogueFinishedRef.current) starts.push(audio.play());
      if (selectedAmbienceAsset && ambienceAudio) {
        ambienceAudio.loop = true;
        ambienceAudio.volume = ambienceLevelRef.current;
        starts.push(ambienceAudio.play());
      }
      if (starts.length) await Promise.all(starts);
    } catch {
      if (isPlayingRef.current) {
        handlePlaybackFailure("This scene mix could not start in the browser. Press Play to retry the saved clip and dialogue.");
      }
    }
  };

  const handlePause = () => {
    cancelPendingHandoff();
    videoRef.current?.pause();
    audioRef.current?.pause();
    ambienceAudioRef.current?.pause();
    isPlayingRef.current = false;
    setIsPlaying(false);
    setPlaybackNotice(visualShotEndedRef.current ? "Paused after the visual shot. Press Play to continue the saved dialogue." : "Paused. Press Play to continue from this point.");
  };

  const handleRestart = () => {
    if (playbackDisabled) return;
    resetPlaybackState("Restarted at the beginning of the selected scene.");
  };

  const handleStop = () => {
    if (playbackDisabled) return;
    resetPlaybackState("Stopped. The scene mix proof is ready to play again.");
  };

  const handleSceneChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const nextSceneNumber = Number(event.target.value);
    if (!Number.isInteger(nextSceneNumber)) return;
    resetPlaybackState();
    setSelectedReviewedShotKey(null);
    setReviewedShotPlaybackError(null);
    setSelectedSceneNumber(nextSceneNumber);
  };

  const handleAudioEnded = (event: React.SyntheticEvent<HTMLAudioElement>) => {
    if (!isPlayingRef.current) return;

    const audio = event.currentTarget;
    const currentTakeAtEnd = queueRef.current[currentLineIndexRef.current];
    if (currentTakeAtEnd) {
      registerAudioDuration(currentTakeAtEnd.asset.audio_url, audio.duration);
    }

    const queue = queueRef.current;
    const nextIndex = currentLineIndexRef.current + 1;
    if (nextIndex < queue.length) {
      const nextTake = queue[nextIndex];
      const nextAudioUrl = nextTake.asset.audio_url.trim();
      const mediaKeyAtStart = selectedMediaKeyRef.current;
      const sceneNumberAtStart = selectedSceneNumberRef.current;
      const { controller, token } = beginHandoff(nextAudioUrl, mediaKeyAtStart);
      const isCurrentHandoff = () =>
        handoffGenerationRef.current === token &&
        handoffAbortRef.current === controller &&
        isPlayingRef.current &&
        selectedMediaKeyRef.current === mediaKeyAtStart &&
        selectedSceneNumberRef.current === sceneNumberAtStart &&
        audioRef.current === audio &&
        isExpectedAudioSource(audio, nextAudioUrl);

      currentLineIndexRef.current = nextIndex;
      setCurrentLineIndex(nextIndex);
      setPlaybackNotice(null);
      audio.pause();
      audio.src = nextAudioUrl;
      audio.volume = dialogueLevelRef.current;

      void (async () => {
        try {
          audio.load();
          await waitForAudioReady(audio, nextAudioUrl, controller.signal);
          if (!isCurrentHandoff()) return;
          await audio.play();
          if (!isCurrentHandoff()) {
            audio.pause();
          }
        } catch (error) {
          if (!isCurrentHandoff() || isAudioReadinessCancellation(error)) return;
          handlePlaybackFailure("The next saved dialogue take could not continue in this browser. Press Play to retry the scene mix.");
        } finally {
          if (handoffAbortRef.current === controller) {
            handoffAbortRef.current = null;
            handoffContextRef.current = null;
          }
        }
      })();
      return;
    }

    dialogueFinishedRef.current = true;
    setDialogueFinished(true);
    if (visualShotEndedRef.current) {
      ambienceAudioRef.current?.pause();
      isPlayingRef.current = false;
      setIsPlaying(false);
      setElapsedSeconds(dialogueTotalSeconds || elapsedSeconds);
      setPlaybackNotice("Dialogue continues beyond the visual shot, then finishes here. Ambience stops with this local proof.");
    } else {
      setPlaybackNotice("Saved dialogue is complete. The muted visual reference and ambience continue until the shot ends.");
    }
  };

  const handleVideoEnded = () => {
    visualShotEndedRef.current = true;
    setVisualShotEnded(true);
    videoRef.current?.pause();

    if (!isPlayingRef.current) return;
    if (!dialogueFinishedRef.current) {
      setPlaybackNotice("The five-second visual shot ended. Saved dialogue continues beyond this shot for later multi-shot assembly.");
      return;
    }

    ambienceAudioRef.current?.pause();
    isPlayingRef.current = false;
    setIsPlaying(false);
    setElapsedSeconds(dialogueTotalSeconds || elapsedSeconds);
    setPlaybackNotice("Scene mix proof complete. Saved dialogue and ambience were reviewed locally under the muted visual reference.");
  };

  const handleVideoTimeUpdate = (event: React.SyntheticEvent<HTMLVideoElement>) => {
    const currentTime = event.currentTarget.currentTime;
    if (!Number.isFinite(currentTime) || visualShotEndedRef.current) return;
    if (!audioRef.current || !currentAudioAsset) setElapsedSeconds(Math.max(0, currentTime));
  };

  const handleAudioTimeUpdate = (event: React.SyntheticEvent<HTMLAudioElement>) => {
    const currentTime = event.currentTarget.currentTime;
    if (!Number.isFinite(currentTime)) return;
    const currentIndex = currentLineIndexRef.current;
    const previousDuration = queueRef.current
      .slice(0, currentIndex)
      .reduce((sum, take) => sum + getTakeDuration(take), 0);
    setElapsedSeconds(Math.max(0, previousDuration + currentTime));
  };

  const handleVideoMetadata = (event: React.SyntheticEvent<HTMLVideoElement>) => {
    const duration = event.currentTarget.duration;
    if (Number.isFinite(duration) && duration > 0) setVisualDuration(duration);
  };

  const handleVideoError = () => {
    if (isPlayingRef.current) {
      handlePlaybackFailure("The saved motion clip could not play in this browser. Press Play to retry or review it in Video & Motion.");
    } else {
      setPlaybackError("The saved motion clip could not load in this browser. Press Play to retry or review it in Video & Motion.");
    }
  };

  const handleAudioError = (event: React.SyntheticEvent<HTMLAudioElement>) => {
    const cancelledHandoff = cancelledHandoffRef.current;
    const sourceAttribute = event.currentTarget.getAttribute("src")?.trim() || "";
    const currentSource = event.currentTarget.currentSrc?.trim() || "";
    const cancelledSourceMatches = Boolean(
      cancelledHandoff &&
        ((!sourceAttribute && !currentSource) ||
          sourceAttribute === cancelledHandoff.source ||
          currentSource === cancelledHandoff.source)
    );
    const isLateCancelledError = Boolean(
      !isPlayingRef.current &&
        (blockingReason ||
          (cancelledHandoff &&
            cancelledSourceMatches &&
            (cancelledHandoff.mediaKey === selectedMediaKeyRef.current ||
              currentSource === cancelledHandoff.source)))
    );
    if (isLateCancelledError) return;
    if (isPlayingRef.current) {
      handlePlaybackFailure("The saved dialogue could not play in this browser. Press Play to retry the scene mix.");
    } else {
      setPlaybackError("The saved dialogue could not load in this browser. Press Play to retry the scene mix.");
    }
  };

  const handleAmbienceError = () => {
    if (!selectedAmbienceAsset) return;
    if (isPlayingRef.current) {
      handlePlaybackFailure("The saved ambience could not play in this browser. Press Play to retry the scene mix.");
    } else {
      setPlaybackError("The saved ambience could not load in this browser. Press Play to retry the scene mix.");
    }
  };

  const selectedLines = selectedEntry?.lines || [];
  const missingLines = selectedEntry?.lines.filter((_, index) => !selectedEntry.matchedAudio[index]) || [];
  const selectedCoverageLabel = selectedEntry
    ? selectedEntry.dialogueStatus === "silent"
      ? "Silent scene"
      : selectedEntry.dialogueStatus === "complete"
        ? `Complete coverage · ${selectedEntry.matchedCount} ${selectedEntry.matchedCount === 1 ? "line" : "lines"}`
        : selectedEntry.dialogueStatus === "partial"
          ? `Partial coverage · ${selectedEntry.matchedCount}/${selectedEntry.lines.length} lines`
          : "Missing saved takes"
    : "Choose a scene";
  const selectedAmbienceLabel = selectedAmbienceAsset
    ? `Saved bed · ${selectedAmbienceAsset.duration_seconds.toFixed(1)}s`
    : "No ambience bed";
  const currentLineStatus = dialogueFinished
    ? "Dialogue sequence complete"
    : visualShotEnded
      ? "Dialogue continues beyond shot"
      : isPlaying
        ? "Playing saved take"
        : currentTake
          ? "Ready to play"
          : "No saved take selected";
  const currentStatusText = playbackError || playbackNotice || (
    blockingReason
      ? blockingReason
      : sceneMediaReady
        ? selectedAmbienceAsset
          ? "Press Play to start the muted visual, saved dialogue, and looping ambience together."
          : "Press Play to start the muted visual and the first saved dialogue take together. This scene currently has no ambience bed."
        : "Choose a scene with one playable clip and at least one exact saved take."
  );

  return (
    <section
      className="overflow-hidden rounded-2xl border border-amber-500/[0.35] bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,0.16),transparent_42%),#101722] shadow-xl shadow-black/20"
      aria-labelledby="scene-mix-proof-title"
    >
      <div className="border-b border-amber-500/20 px-4 py-5 sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs font-mono uppercase tracking-[0.18em] text-amber-300">
              <AudioLines className="h-4 w-4" aria-hidden="true" /> Scene mix proof
              <span className="rounded-md border border-[#46536b] bg-[#0c111b] px-2 py-1 text-[10px] tracking-wider text-gray-300">Read only</span>
              <span className="rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2 py-1 text-[10px] tracking-wider text-emerald-200">Saved media only</span>
            </div>
            <h2 id="scene-mix-proof-title" className="text-2xl font-serif font-bold tracking-tight text-white sm:text-3xl">
              Balance one scene before assembly.
            </h2>
            <p className="max-w-2xl text-sm leading-relaxed text-gray-300">
              Pair one saved vertical motion clip with the exact ElevenLabs takes that still match the current screenplay, plus one saved room-tone bed when available. The browser advances each take in order and loops ambience locally, so you can hear the handoff between lines before a full episode mix exists. Nothing here saves, replaces, uploads, or exports media.
            </p>
          </div>
          <div className="grid shrink-0 grid-cols-2 gap-2 text-xs sm:min-w-[250px]">
            <div className="rounded-xl border border-[#33415d] bg-[#0b1019]/80 p-3">
              <p className="font-mono uppercase tracking-wider text-gray-500">Playable scenes</p>
              <p className="mt-1 text-lg font-semibold text-emerald-200">{playableSceneCount}</p>
              <p className="mt-1 text-[10px] leading-relaxed text-gray-500">Clip plus one saved take</p>
            </div>
            <div className="rounded-xl border border-[#33415d] bg-[#0b1019]/80 p-3">
              <p className="font-mono uppercase tracking-wider text-gray-500">Ambience beds</p>
              <p className="mt-1 text-lg font-semibold text-amber-200">{ambienceSceneCount}</p>
              <p className="mt-1 text-[10px] leading-relaxed text-gray-500">Latest valid bed per scene</p>
            </div>
            <div className="col-span-2 rounded-xl border border-[#33415d] bg-[#0b1019]/80 p-3 sm:col-span-1">
              <p className="font-mono uppercase tracking-wider text-gray-500">Output</p>
              <p className="mt-1 text-lg font-semibold text-amber-200">Browser</p>
              <p className="mt-1 text-[10px] leading-relaxed text-gray-500">Temporary playback only</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-3 border-b border-[#242f45] bg-[#0d131e]/80 px-4 py-4 sm:grid-cols-2 lg:grid-cols-5 sm:px-6">
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-950/10 p-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-gray-500">Complete</p>
          <p className="mt-1 text-xl font-semibold text-emerald-200">{completeDialogueCount}</p>
          <p className="mt-1 text-[10px] leading-relaxed text-gray-500">Every line has a take</p>
        </div>
        <div className={`rounded-xl border p-3 ${partialDialogueCount ? "border-amber-500/30 bg-amber-950/[0.15]" : "border-[#2b3850] bg-[#0b1019]"}`}>
          <p className="font-mono text-[10px] uppercase tracking-wider text-gray-500">Partial</p>
          <p className={`mt-1 text-xl font-semibold ${partialDialogueCount ? "text-amber-200" : "text-gray-300"}`}>{partialDialogueCount}</p>
          <p className="mt-1 text-[10px] leading-relaxed text-gray-500">Some lines are missing</p>
        </div>
        <div className={`rounded-xl border p-3 ${missingDialogueCount ? "border-red-500/30 bg-red-950/[0.15]" : "border-[#2b3850] bg-[#0b1019]"}`}>
          <p className="font-mono text-[10px] uppercase tracking-wider text-gray-500">Missing</p>
          <p className={`mt-1 text-xl font-semibold ${missingDialogueCount ? "text-red-200" : "text-gray-300"}`}>{missingDialogueCount}</p>
          <p className="mt-1 text-[10px] leading-relaxed text-gray-500">No exact take saved</p>
        </div>
        <div className="rounded-xl border border-[#2b3850] bg-[#0b1019] p-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-gray-500">Silent scenes</p>
          <p className="mt-1 text-xl font-semibold text-gray-300">{silentSceneCount}</p>
          <p className="mt-1 text-[10px] leading-relaxed text-gray-500">No spoken lines</p>
        </div>
        <div className="rounded-xl border border-emerald-700/30 bg-emerald-950/10 p-3 sm:col-span-2 lg:col-span-1">
          <p className="font-mono text-[10px] uppercase tracking-wider text-gray-500">Earlier-frame archive</p>
          <p className="mt-1 text-xl font-semibold text-emerald-200">{archivedSceneCount}</p>
          <p className="mt-1 text-[10px] leading-relaxed text-gray-500">Retained clips available</p>
        </div>
      </div>

      <div className="grid gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(290px,1.1fr)]">
        <div className="space-y-4">
          <label htmlFor="scene-mix-proof-scene" className="block space-y-1.5 text-xs text-gray-300">
            <span className="font-mono uppercase tracking-wider text-gray-400">Scene to mix</span>
            <select
              id="scene-mix-proof-scene"
              value={selectedSceneNumber ?? ""}
              onChange={handleSceneChange}
              disabled={!mixScenes.length || Boolean(blockingReason)}
              className="h-11 w-full rounded-lg border border-[#33415d] bg-[#0b1019] px-3 text-sm text-gray-100 outline-none transition-colors focus:border-amber-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="" disabled>{mixScenes.length ? "Choose a screenplay scene" : "No screenplay scenes available"}</option>
              {mixScenes.map((entry) => {
                const status = entry.canPlay
                  ? entry.dialogueStatus === "complete"
                    ? "Complete"
                    : `Partial ${entry.matchedCount}/${entry.lines.length}`
                  : entry.dialogueStatus === "silent"
                    ? "Silent"
                    : !entry.clip
                      ? "Motion clip needed"
                      : "Voice take needed";
                return (
                  <option key={entry.sceneNumber} value={entry.sceneNumber}>
                    Scene {formatScene(entry.sceneNumber)} · {status}{entry.isArchivedFromEarlierStoryboard ? " · Earlier frame" : ""}
                  </option>
                );
              })}
            </select>
          </label>

          <div className="rounded-xl border border-[#2b3850] bg-[#0b1019] p-4" aria-labelledby="scene-mix-coverage-title">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-amber-300">
                <AudioLines className="h-3.5 w-3.5" aria-hidden="true" /> <span id="scene-mix-coverage-title">Scene coverage</span>
              </div>
              <span className={`rounded-md border px-2 py-1 text-[10px] font-mono uppercase tracking-wider ${selectedEntry ? dialogueStatusClass(selectedEntry.dialogueStatus) : "border-[#33415d] bg-[#151d2c] text-gray-400"}`}>
                {selectedCoverageLabel}
              </span>
            </div>

            <div className="mt-3 space-y-2">
              {selectedLines.length ? selectedLines.map((line, index) => {
                const saved = Boolean(selectedEntry?.matchedAudio[index]);
                const savedAsset = selectedEntry?.matchedAudio[index];
                return (
                  <div
                    key={line.line_id}
                    className={`rounded-lg border p-3 ${saved ? "border-emerald-700/30 bg-emerald-950/[0.15]" : "border-[#29364e] bg-[#111827]"}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border font-mono text-[10px] ${saved ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-[#3a465d] bg-[#182033] text-gray-400"}`}>
                        {String(line.order).padStart(2, "0")}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[10px] uppercase tracking-wider text-gray-300">{line.character_id}</span>
                          <span className={`text-[10px] ${saved ? "text-emerald-300" : "text-gray-500"}`}>
                            {saved ? "Exact saved take" : "Missing exact take"}
                          </span>
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-gray-300">“{line.text}”</p>
                        {savedAsset && (
                          <p className="mt-2 text-[10px] leading-relaxed text-emerald-100/60">
                            {savedAsset.voice_name} · {getTakeDuration({ line, asset: savedAsset }) > 0 ? `${getTakeDuration({ line, asset: savedAsset }).toFixed(1)}s` : "Duration loading"}
                          </p>
                        )}
                      </div>
                      {saved ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-label="Saved take available" />
                      ) : (
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-label="Saved take missing" />
                      )}
                    </div>
                  </div>
                );
              }) : (
                <div className="rounded-lg border border-dashed border-[#33415d] p-3">
                  <p className="text-xs leading-relaxed text-gray-500">This screenplay scene has no spoken lines. It remains visible as a silent scene and cannot open a dialogue mix proof.</p>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-[#2b3850] bg-[#0b1019] p-4">
            <div className="flex items-start gap-3">
              <div className={`rounded-lg border p-2 ${selectedEntry?.clip ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300" : "border-amber-500/25 bg-amber-500/10 text-amber-300"}`}>
                <Film className="h-4 w-4" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1 space-y-1.5 text-xs leading-relaxed">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-gray-200">Ordinary scene visual</p>
                  <span className={`rounded-md border px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider ${selectedEntry?.clip ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-200" : "border-red-500/30 bg-red-500/10 text-red-200"}`}>
                    {selectedEntry?.clip ? "Saved READY clip" : "Motion missing"}
                  </span>
                </div>
                {selectedEntry?.clip ? (
                  selectedEntry.isArchivedFromEarlierStoryboard ? (
                    <p className="text-emerald-100/70">Archived earlier-frame clip retained. Its source storyboard differs from the current frame, so this proof leaves both assets unchanged. Reviewed close-ups stay separate from this ordinary scene visual.</p>
                  ) : (
                    <p className="text-gray-400">Newest playable clip for this scene, paired with the current storyboard reference. A reviewed close-up, when available, is shown separately as a shot-level proof.</p>
                  )
                ) : (
                  <p className="text-amber-100/70">Save a READY HTTPS motion clip before testing this scene. Missing clips stay visible in the coverage view.</p>
                )}
              </div>
            </div>
          </div>

          <section className="rounded-xl border border-cyan-500/25 bg-[#0b111a] p-4" aria-labelledby="scene-mix-reviewed-shot-title">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 p-2 text-cyan-300">
                  <Film className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p id="scene-mix-reviewed-shot-title" className="font-semibold text-gray-100">Reviewed shot coverage</p>
                    <span className="rounded-md border border-cyan-500/25 bg-cyan-500/10 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider text-cyan-200">
                      {selectedReviewedShotCandidates.length
                        ? `${selectedReviewedShotCandidates.length} READY ${selectedReviewedShotCandidates.length === 1 ? "shot" : "shots"}`
                        : "No READY shot"}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-gray-400">These are separate shot-level proofs for the selected scene. They do not replace the ordinary scene visual, enter the dialogue queue, or change the main Scene Mix playback.</p>
                </div>
              </div>
            </div>

            {selectedReviewedShotCandidates.length ? (
              <div className="mt-4 space-y-2.5">
                {selectedReviewedShotCandidates.map((candidate) => {
                  const candidateKey = reviewedShotCandidateKey(candidate);
                  const isSelected = candidateKey === selectedReviewedShotKey;
                  return (
                    <button
                      key={candidateKey}
                      type="button"
                      onClick={() => {
                        setSelectedReviewedShotKey(candidateKey);
                        setReviewedShotPlaybackError(null);
                      }}
                      aria-pressed={isSelected}
                      aria-label={`Review Scene ${formatScene(candidate.scene_number)} ${candidate.line_id} close-up`}
                      className={`w-full rounded-lg border p-3 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400/70 ${isSelected ? "border-cyan-400/60 bg-cyan-950/30" : "border-[#29364e] bg-[#111827] hover:border-cyan-500/40 hover:bg-[#142030]"}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border font-mono text-[10px] ${isSelected ? "border-cyan-400/40 bg-cyan-500/15 text-cyan-200" : "border-[#3a465d] bg-[#182033] text-gray-400"}`}>
                          {isSelected ? <Play className="h-3.5 w-3.5" aria-hidden="true" /> : <span>SHOT</span>}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-[10px] uppercase tracking-wider text-cyan-200">Scene {formatScene(candidate.scene_number)} · {candidate.line_id}</span>
                            <span className="rounded-md border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider text-emerald-200">Reviewed close-up</span>
                            {isSelected && <span className="rounded-md border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider text-cyan-100">Selected below</span>}
                          </div>
                          <p className="mt-2 text-[11px] font-mono uppercase tracking-wider text-gray-400">{candidate.character_name ? `${candidate.character_name} · ` : ""}{candidate.character_id}</p>
                          <p className="mt-1 text-sm leading-relaxed text-gray-200">“{candidate.text}”</p>
                          <span className="mt-2 inline-flex items-center gap-1.5 text-[10px] text-emerald-200/85"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" /> Exact READY audio take linked</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : selectedReviewedShotRecordCount > 0 ? (
              <div className="mt-4 flex items-start gap-3 rounded-lg border border-amber-700/35 bg-amber-950/20 p-3 text-xs text-amber-100/85" role="status">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
                <div className="space-y-1.5 leading-relaxed">
                  <p className="font-semibold text-amber-200">Reviewed shot unavailable or stale</p>
                  <p>Saved close-up, lip-sync, or audio records exist for this scene, but none still share the current line, source video, result URL, and exact READY MP3 take. Ordinary scene playback remains available.</p>
                </div>
              </div>
            ) : (
              <div className="mt-4 flex items-start gap-3 rounded-lg border border-dashed border-[#33415d] bg-[#0d1420] p-3 text-xs text-gray-400" role="status">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-cyan-400" aria-hidden="true" />
                <div className="space-y-1.5 leading-relaxed">
                  <p className="font-semibold text-gray-300">No reviewed shot for this scene yet</p>
                  <p>Complete the close-up and exact audio lip-sync review in Lip-sync Proof. This Scene Mix keeps the ordinary visual and dialogue playback unchanged until a valid shot-level proof exists.</p>
                </div>
              </div>
            )}
          </section>

          <div className="rounded-xl border border-[#2b3850] bg-[#0b1019] p-4">
            <div className="flex items-start gap-3">
              <div className={`rounded-lg border p-2 ${selectedAmbienceAsset ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300" : "border-[#33415d] bg-[#151d2c] text-gray-400"}`}>
                <Waves className="h-4 w-4" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1 space-y-1.5 text-xs leading-relaxed">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-gray-200">Ambience bed</p>
                  <span className={`rounded-md border px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider ${selectedAmbienceAsset ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-200" : "border-[#33415d] bg-[#151d2c] text-gray-400"}`}>
                    {selectedAmbienceLabel}
                  </span>
                </div>
                {selectedAmbienceAsset ? (
                  <p className="text-emerald-100/70">The saved MP3 will loop locally under the dialogue when the conversation runs longer than this bed. Its level remains temporary.</p>
                ) : (
                  <p className="text-gray-500">No ambience is saved for this scene. The proof stays dialogue-only. Create one from the Ambience tab when you want room tone.</p>
                )}
              </div>
            </div>
          </div>

          {selectedEntry && selectedEntry.matchedCount > 0 && selectedEntry.dialogueStatus === "partial" && (
            <div className="flex items-start gap-3 rounded-xl border border-amber-700/[0.35] bg-amber-950/20 p-4 text-xs text-amber-100/[0.85]" role="status">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
              <div className="space-y-1.5 leading-relaxed">
                <p className="font-semibold text-amber-200">Partial dialogue coverage</p>
                <p>The proof plays the saved takes in screenplay order and skips missing lines. This is a sound check, not a complete mix.</p>
                {missingLines.length > 0 && <p className="text-amber-100/70">Missing: {missingLines.map((line) => `Line ${String(line.order).padStart(2, "0")}`).join(", ")}.</p>}
              </div>
            </div>
          )}

          {selectedEntry && selectedEntry.dialogueStatus === "missing" && (
            <div className="flex items-start gap-3 rounded-xl border border-red-700/[0.35] bg-red-950/20 p-4 text-xs text-red-100/[0.85]" role="status">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" aria-hidden="true" />
              <div className="space-y-1.5 leading-relaxed">
                <p className="font-semibold text-red-200">No exact saved dialogue takes</p>
                <p>Every current line needs a READY ElevenLabs asset with the same scene, line ID or legacy fallback, character, text, and secure MP3 URL.</p>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-amber-400">Ordinary scene visual · muted</p>
              <p className="mt-1 text-sm font-semibold text-white" aria-live="polite">{selectedEntry ? `Scene ${formatScene(selectedEntry.sceneNumber)}` : "Choose a scene"}</p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-md border border-[#33415d] bg-[#0b1019] px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-gray-400"><VolumeX className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" /> Muted</span>
          </div>

          {selectedEntry?.clip?.video_url ? (
            <div className="relative overflow-hidden rounded-2xl border border-[#2b3850] bg-[#080b11] p-2 shadow-lg shadow-black/20">
              <video
                ref={videoRef}
                className="mx-auto aspect-[9/16] max-h-[590px] w-full max-w-[350px] rounded-xl bg-black object-contain"
                src={selectedEntry.clip.video_url}
                muted
                playsInline
                preload="metadata"
                onLoadedMetadata={handleVideoMetadata}
                onTimeUpdate={handleVideoTimeUpdate}
                onEnded={handleVideoEnded}
                onError={handleVideoError}
                aria-label={`Muted Scene ${selectedEntry.sceneNumber} motion clip`}
              />
              {selectedEntry.isArchivedFromEarlierStoryboard && <span className="absolute left-4 top-4 rounded-md border border-emerald-500/[0.35] bg-emerald-950/[0.85] px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-emerald-200 backdrop-blur-sm">Archived · earlier frame</span>}
              {visualShotEnded && <span className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-md border border-amber-500/[0.35] bg-black/80 px-2.5 py-1.5 text-[10px] font-mono uppercase tracking-wider text-amber-100 backdrop-blur-sm">Visual shot ended · last frame held</span>}
            </div>
          ) : (
            <div className="flex aspect-[9/16] min-h-[300px] items-center justify-center rounded-2xl border border-dashed border-[#33415d] bg-[#0b1019] p-6 text-center">
              <div className="max-w-[230px] space-y-3">
                <Film className="mx-auto h-9 w-9 text-gray-600" aria-hidden="true" />
                <p className="text-sm font-semibold text-gray-300">No playable visual reference</p>
                <p className="text-xs leading-relaxed text-gray-500">Choose a scene with a saved READY vertical clip. The dialogue coverage remains available for review.</p>
              </div>
            </div>
          )}

          <section className="rounded-xl border border-cyan-500/25 bg-[#0b111a] p-3.5" aria-labelledby="scene-mix-reviewed-shot-player-title">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p id="scene-mix-reviewed-shot-player-title" className="text-[10px] font-mono uppercase tracking-[0.18em] text-cyan-300">Reviewed close-up player</p>
                <p className="mt-1 text-sm font-semibold text-white">{selectedReviewedShot ? `Scene ${formatScene(selectedReviewedShot.scene_number)} · ${selectedReviewedShot.line_id}` : "Select a reviewed shot"}</p>
              </div>
              <span className="rounded-md border border-cyan-500/25 bg-cyan-500/10 px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-cyan-200">Shot-level proof</span>
            </div>

            {selectedReviewedShot ? (
              <>
                <div className="mt-3 overflow-hidden rounded-xl border border-cyan-500/20 bg-black p-2 shadow-lg shadow-black/20">
                  <video
                    key={selectedReviewedShot.lipsync_video_url}
                    ref={reviewedShotVideoRef}
                    className="mx-auto aspect-[9/16] max-h-[430px] w-full max-w-[300px] rounded-lg bg-black object-contain"
                    src={selectedReviewedShot.lipsync_video_url}
                    controls
                    playsInline
                    preload="metadata"
                    onLoadedData={() => setReviewedShotPlaybackError(null)}
                    onError={() => setReviewedShotPlaybackError("The saved reviewed-shot MP4 could not load in this browser. Press play to retry the private proof.")}
                    aria-label={`Reviewed close-up for Scene ${selectedReviewedShot.scene_number}, ${selectedReviewedShot.line_id}`}
                  />
                </div>
                <p className="mt-3 text-[11px] leading-relaxed text-gray-400">This saved lip-sync MP4 carries the exact linked audio take. Play it here as a separate shot-level proof. It does not replace the muted ordinary scene visual or enter the scene dialogue queue.</p>
                {reviewedShotPlaybackError && <p className="mt-2 text-xs leading-relaxed text-red-300" role="alert">{reviewedShotPlaybackError}</p>}
              </>
            ) : (
              <div className="mt-3 rounded-lg border border-dashed border-[#33415d] bg-[#0d1420] p-3 text-xs leading-relaxed text-gray-500">Select a valid reviewed close-up above to reveal its saved MP4. Nothing starts automatically, and ordinary Scene Mix playback stays unchanged.</div>
            )}
          </section>

          <audio
            ref={audioRef}
            src={currentAudioAsset?.audio_url || undefined}
            preload="auto"
            onLoadedMetadata={handleAudioMetadata}
            onTimeUpdate={handleAudioTimeUpdate}
            onEnded={handleAudioEnded}
            onError={handleAudioError}
            aria-label="Saved dialogue take for the selected scene"
            className="sr-only"
          />
          <audio
            ref={ambienceAudioRef}
            src={selectedAmbienceAsset?.audio_url || undefined}
            preload="auto"
            loop={Boolean(selectedAmbienceAsset)}
            onError={handleAmbienceError}
            aria-label="Saved ambience bed for the selected scene"
            className="sr-only"
          />

          <div className="rounded-xl border border-[#2b3850] bg-[#0b1019] p-3.5" aria-live="polite">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-amber-400">Current dialogue line</p>
              <span className={`text-[10px] ${isPlaying ? "text-emerald-300" : dialogueFinished ? "text-gray-400" : visualShotEnded ? "text-amber-200" : "text-gray-500"}`}>{currentLineStatus}</span>
            </div>
            {currentTake ? (
              <>
                <p className="mt-2 font-mono text-[11px] uppercase tracking-wider text-gray-300">Line {String(currentTake.line.order).padStart(2, "0")} of {String(selectedLines.length).padStart(2, "0")} · {currentTake.line.character_id}</p>
                <p className="mt-2 text-sm leading-relaxed text-amber-100/90">“{currentTake.line.text}”</p>
              </>
            ) : selectedEntry?.dialogueStatus === "silent" ? (
              <p className="mt-2 text-xs leading-relaxed text-gray-500">Silent scene. There is no dialogue track to balance.</p>
            ) : (
              <p className="mt-2 text-xs leading-relaxed text-gray-500">Select a scene with at least one exact saved dialogue take.</p>
            )}
          </div>

          <div className="rounded-xl border border-[#2b3850] bg-[#0b1019] p-3.5" aria-labelledby="scene-mix-track-title">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <AudioLines className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
                <p id="scene-mix-track-title" className="text-[10px] font-mono uppercase tracking-[0.16em] text-amber-400">Sequential dialogue track</p>
              </div>
              <span className="text-[10px] text-gray-500">Saved takes only</span>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-gray-500">The track follows screenplay order. Missing lines remain marked in coverage and are never filled automatically.</p>
            <div className="mt-3 space-y-2">
              {playbackQueue.length ? playbackQueue.map((take, index) => (
                <div key={take.line.line_id} className={`flex items-start gap-2 rounded-lg border p-2.5 ${currentLineIndex === index && !dialogueFinished ? "border-amber-500/[0.45] bg-amber-950/20" : index < currentLineIndex || dialogueFinished ? "border-emerald-700/25 bg-emerald-950/10" : "border-[#29364e] bg-[#111827]"}`}>
                  <span className="mt-0.5 min-w-[1.5rem] rounded-md border border-[#3a465d] bg-[#182033] px-1.5 py-1 text-center font-mono text-[9px] text-gray-300">{String(take.line.order).padStart(2, "0")}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-gray-300">{take.line.character_id}</p>
                    <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-gray-400">{take.line.text}</p>
                  </div>
                  <span className={`shrink-0 text-[10px] ${currentLineIndex === index && !dialogueFinished ? "text-amber-200" : index < currentLineIndex || dialogueFinished ? "text-emerald-300" : "text-gray-600"}`}>
                    {currentLineIndex === index && !dialogueFinished ? "Now" : index < currentLineIndex || dialogueFinished ? "Heard" : "Next"}
                  </span>
                </div>
              )) : (
                <p className="rounded-lg border border-dashed border-[#33415d] px-3 py-3 text-xs leading-relaxed text-gray-500">No saved takes are ready for this scene.</p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-amber-500/20 bg-[#0d131e]/[0.85] px-4 py-4 sm:px-6">
        {blockingReason && (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-700/[0.35] bg-amber-950/20 p-3 text-xs text-amber-100/[0.85]" role="status">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden="true" />
            <span>{blockingReason}</span>
          </div>
        )}
        {visualShotEnded && !dialogueFinished && (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-500/[0.35] bg-amber-950/20 p-3 text-xs text-amber-100/[0.85]" role="status">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden="true" />
            <span>The visual shot has ended, so the last frame stays on screen while the saved dialogue continues. This overrun is reported for later multi-shot assembly and is not treated as final sync.</span>
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(240px,0.62fr)] lg:items-center">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-gray-400">
                <Clock3 className="h-4 w-4 text-amber-400" aria-hidden="true" />
                <span aria-live="polite">{formatClock(elapsedSeconds)} / {formatClock(dialogueTotalSeconds)}</span>
              </div>
              <span className="text-[11px] text-gray-500">{selectedEntry?.clip ? `${formatClock(visualShotDuration)} visual reference` : "No visual shot selected"}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[#202a3d]" aria-label="Dialogue playback progress" role="progressbar" aria-valuemin={0} aria-valuemax={dialogueTotalSeconds || 0} aria-valuenow={Math.min(elapsedSeconds, dialogueTotalSeconds || elapsedSeconds)}>
              <div className="h-full rounded-full bg-amber-400 transition-[width] duration-150" style={{ width: `${playbackProgress}%` }} />
            </div>
            <div className="flex flex-wrap gap-2" aria-label="Scene mix playback controls">
              <Button type="button" onClick={() => void handlePlay()} disabled={playbackDisabled || isPlaying} className="h-10 gap-2 bg-amber-500 px-4 text-xs font-semibold text-black hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"><Play className="h-3.5 w-3.5" aria-hidden="true" /> Play</Button>
              <Button type="button" onClick={handlePause} disabled={playbackDisabled || !isPlaying} variant="outline" className="h-10 gap-2 border-[#3b4963] bg-[#151e2e] px-4 text-xs text-gray-200 hover:border-amber-500/50 hover:bg-[#1c2940] disabled:cursor-not-allowed disabled:opacity-50"><Pause className="h-3.5 w-3.5" aria-hidden="true" /> Pause</Button>
              <Button type="button" onClick={handleRestart} disabled={playbackDisabled} variant="outline" className="h-10 gap-2 border-[#3b4963] bg-[#151e2e] px-4 text-xs text-gray-200 hover:border-amber-500/50 hover:bg-[#1c2940] disabled:cursor-not-allowed disabled:opacity-50"><RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Restart</Button>
              <Button type="button" onClick={handleStop} disabled={playbackDisabled} variant="outline" className="h-10 gap-2 border-[#3b4963] bg-[#151e2e] px-4 text-xs text-gray-200 hover:border-red-500/50 hover:bg-red-950/20 disabled:cursor-not-allowed disabled:opacity-50"><Square className="h-3.5 w-3.5" aria-hidden="true" /> Stop</Button>
            </div>
            <p className={`text-xs leading-relaxed ${playbackError ? "text-red-300" : playbackNotice || blockingReason ? "text-amber-200/[0.85]" : "text-gray-500"}`} role={playbackError ? "alert" : "status"} aria-live="polite">{currentStatusText}</p>
          </div>

          <div className="space-y-3">
            <div className="rounded-xl border border-[#2b3850] bg-[#0b1019] p-3.5">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="scene-mix-dialogue-level" className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.16em] text-amber-400"><AudioLines className="h-3.5 w-3.5" aria-hidden="true" /> Dialogue level</label>
                <span className="font-mono text-xs text-amber-100">{Math.round(dialogueLevel * 100)}%</span>
              </div>
              <input
                id="scene-mix-dialogue-level"
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={dialogueLevel}
                onChange={(event) => setDialogueLevel(Number(event.target.value))}
                disabled={playbackDisabled}
                className="mt-3 h-2 w-full cursor-pointer accent-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
                aria-describedby="scene-mix-dialogue-level-help"
              />
              <div className="mt-2 flex items-center justify-between text-[10px] text-gray-500"><span>Quiet</span><span>Reference level</span><span>Full</span></div>
              <p id="scene-mix-dialogue-level-help" className="mt-3 text-[11px] leading-relaxed text-gray-500">Temporary browser playback control. The level applies to this proof only and is never saved to the project.</p>
            </div>

            <div className="rounded-xl border border-[#2b3850] bg-[#0b1019] p-3.5">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="scene-mix-ambience-level" className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.16em] text-amber-400"><Waves className="h-3.5 w-3.5" aria-hidden="true" /> Ambience level</label>
                <span className="font-mono text-xs text-amber-100">{Math.round(ambienceLevel * 100)}%</span>
              </div>
              <input
                id="scene-mix-ambience-level"
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={ambienceLevel}
                onChange={(event) => setAmbienceLevel(Number(event.target.value))}
                disabled={playbackDisabled || !selectedAmbienceAsset}
                className="mt-3 h-2 w-full cursor-pointer accent-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
                aria-describedby="scene-mix-ambience-level-help"
              />
              <div className="mt-2 flex items-center justify-between text-[10px] text-gray-500"><span>Quiet</span><span>Room tone</span><span>Full</span></div>
              <p id="scene-mix-ambience-level-help" className="mt-3 text-[11px] leading-relaxed text-gray-500">{selectedAmbienceAsset ? "Temporary browser level. The bed loops locally when dialogue outlasts it, and this setting is never saved." : "Generate a saved bed in Ambience before adjusting its temporary level."}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-[#202b40] bg-[#0a0e16]/70 px-4 py-3 text-[11px] leading-relaxed text-gray-500 sm:px-6">
        <div className="flex items-start gap-2"><AudioLines className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400/80" aria-hidden="true" /><p>Dialogue is paired only when its saved scene number, current line ID or legacy fallback, character, text, and secure MP3 all match. A saved ambience bed stays separate, loops only in this browser proof, and uses a temporary level. Partial, missing, silent, and earlier-frame scenes remain visible so this surface never implies a finished mix.</p></div>
      </div>
    </section>
  );
};
