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
  DramaManifest,
  DramaScene,
  FrameAsset,
  VideoClip,
  deriveDialogueLines,
  getLegacyDialogueLineId,
} from "@/lib/dramaStudio";

export interface EpisodeMixProofProps {
  manifest: DramaManifest;
  videoClips?: VideoClip[];
  audioAssets?: DialogueAudioAsset[];
  ambienceAssets?: AmbienceAudioAsset[];
  frameAssets?: FrameAsset[];
  isDirty?: boolean;
  isSaving?: boolean;
  isApproving?: boolean;
  isGeneratingFrames?: boolean;
  isPollingMotion?: boolean;
  isSynthesizingVoice?: boolean;
  isGeneratingAmbience?: boolean;
}

type EpisodeTake = {
  line: DialogueLine;
  asset: DialogueAudioAsset;
};

type EpisodeCoverageStatus = "complete" | "partial" | "silent" | "missing-visual" | "no-take";

type EpisodeScene = {
  scene: DramaScene;
  sceneNumber: number;
  lines: DialogueLine[];
  matchedAudio: Array<DialogueAudioAsset | null>;
  takes: EpisodeTake[];
  clip: VideoClip | null;
  ambienceAsset: AmbienceAudioAsset | null;
  currentStoryboardUrl: string | null;
  isArchivedFromEarlierStoryboard: boolean;
  matchedCount: number;
  coverageStatus: EpisodeCoverageStatus;
};

type MediaReadinessErrorCode = "cancelled" | "media-error" | "timeout";
type MediaReadinessError = Error & { code: MediaReadinessErrorCode };

const MEDIA_READINESS_TIMEOUT_MS = 12000;

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

function isExpectedMediaSource(media: HTMLMediaElement, expectedUrl: string): boolean {
  const expected = expectedUrl.trim();
  if (!expected) return false;
  const sourceAttribute = media.getAttribute("src")?.trim() || "";
  const currentSource = media.currentSrc?.trim() || "";
  return sourceAttribute === expected || currentSource === expected;
}

function createMediaReadinessError(
  code: MediaReadinessErrorCode,
  message: string
): MediaReadinessError {
  const error = new Error(message) as MediaReadinessError;
  error.code = code;
  return error;
}

function waitForMediaReady(
  media: HTMLMediaElement,
  expectedUrl: string,
  signal: AbortSignal,
  mediaLabel: string,
  timeoutMs = MEDIA_READINESS_TIMEOUT_MS
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timeoutId !== null) clearTimeout(timeoutId);
      media.removeEventListener("canplay", handleReady);
      media.removeEventListener("loadeddata", handleReady);
      media.removeEventListener("loadedmetadata", handleReady);
      media.removeEventListener("playing", handleReady);
      media.removeEventListener("error", handleMediaError);
      media.removeEventListener("abort", handleMediaAbort);
      signal.removeEventListener("abort", handleCancelled);
    };

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };

    const resolveIfReady = () => {
      if (!isExpectedMediaSource(media, expectedUrl)) return;
      if (media.readyState >= 3) finish(() => resolve());
    };

    const handleReady = () => resolveIfReady();
    const handleMediaError = () => {
      if (!isExpectedMediaSource(media, expectedUrl)) return;
      finish(() => reject(createMediaReadinessError("media-error", `The saved ${mediaLabel} source reported a media error.`)));
    };
    const handleMediaAbort = () => {
      if (!isExpectedMediaSource(media, expectedUrl)) return;
      finish(() => reject(createMediaReadinessError("media-error", `The saved ${mediaLabel} source was aborted before playback.`)));
    };
    const handleCancelled = () => {
      finish(() => reject(createMediaReadinessError("cancelled", `The ${mediaLabel} transition was cancelled.`)));
    };

    if (signal.aborted) {
      handleCancelled();
      return;
    }

    media.addEventListener("canplay", handleReady);
    media.addEventListener("loadeddata", handleReady);
    media.addEventListener("loadedmetadata", handleReady);
    media.addEventListener("playing", handleReady);
    media.addEventListener("error", handleMediaError);
    media.addEventListener("abort", handleMediaAbort);
    signal.addEventListener("abort", handleCancelled, { once: true });
    timeoutId = setTimeout(() => {
      finish(() => reject(createMediaReadinessError("timeout", `The saved ${mediaLabel} source did not become playable in time.`)));
    }, timeoutMs);

    if (media.error) {
      handleMediaError();
      return;
    }
    resolveIfReady();
  });
}

function isReadinessCancellation(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "cancelled"
  );
}

function formatScene(sceneNumber: number): string {
  return String(sceneNumber).padStart(2, "0");
}

function formatClock(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "--:--";
  const safeValue = Math.max(0, Math.floor(value));
  const minutes = Math.floor(safeValue / 60);
  const seconds = safeValue % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function getSceneDuration(scene: DramaScene, clip: VideoClip | null): number {
  const clipDuration = clip ? Number(clip.duration_seconds) : 0;
  if (Number.isFinite(clipDuration) && clipDuration > 0) return clipDuration;
  const screenplayDuration = Number(scene.duration_seconds);
  if (Number.isFinite(screenplayDuration) && screenplayDuration > 0) return screenplayDuration;
  return 5;
}

function coverageLabel(status: EpisodeCoverageStatus): string {
  if (status === "complete") return "Complete";
  if (status === "partial") return "Partial dialogue";
  if (status === "silent") return "Silent";
  if (status === "missing-visual") return "Missing visual";
  return "No saved take";
}

function coverageClass(status: EpisodeCoverageStatus): string {
  if (status === "complete") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  if (status === "partial") return "border-amber-500/[0.35] bg-amber-500/10 text-amber-200";
  if (status === "silent") return "border-[#3b4963] bg-[#151d2c] text-gray-300";
  if (status === "missing-visual") return "border-red-500/[0.35] bg-red-950/20 text-red-200";
  return "border-orange-500/30 bg-orange-950/[0.15] text-orange-200";
}

function getSceneMediaKey(entry: EpisodeScene): string {
  return [
    entry.sceneNumber,
    entry.clip?.prediction_id || "no-clip",
    entry.clip?.video_url || "",
    entry.ambienceAsset?.audio_url || "no-ambience",
    entry.takes.map((take) => `${take.line.line_id}:${take.asset.audio_url}`).join("|") || "no-dialogue",
  ].join(":");
}

export const EpisodeMixProof: React.FC<EpisodeMixProofProps> = ({
  manifest,
  videoClips = [],
  audioAssets = [],
  ambienceAssets = [],
  frameAssets = [],
  isDirty = false,
  isSaving = false,
  isApproving = false,
  isGeneratingFrames = false,
  isPollingMotion = false,
  isSynthesizingVoice = false,
  isGeneratingAmbience = false,
}) => {
  const episodeScenes = useMemo<EpisodeScene[]>(() => {
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
        const coverageStatus: EpisodeCoverageStatus = !clip
          ? "missing-visual"
          : lines.length === 0
            ? "silent"
            : matchedCount === 0
              ? "no-take"
              : matchedCount < lines.length
                ? "partial"
                : "complete";

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
          coverageStatus,
        };
      });
  }, [manifest, videoClips, audioAssets, ambienceAssets, frameAssets]);

  const episodeTimelineKey = useMemo(
    () =>
      episodeScenes
        .map(
          (entry) =>
            `${entry.sceneNumber}:${entry.scene.dialogue}:${entry.lines.map((line) => `${line.line_id}:${line.character_id}:${line.text}`).join("|")}:${getSceneMediaKey(entry)}`
        )
        .join("||"),
    [episodeScenes]
  );

  const [currentSceneIndex, setCurrentSceneIndex] = useState(0);
  const [currentLineIndex, setCurrentLineIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [episodeComplete, setEpisodeComplete] = useState(false);
  const [heardSceneNumbers, setHeardSceneNumbers] = useState<Set<number>>(() => new Set());
  const [sceneElapsedSeconds, setSceneElapsedSeconds] = useState(0);
  const [visualDuration, setVisualDuration] = useState(0);
  const [visualShotEnded, setVisualShotEnded] = useState(false);
  const [dialogueLevel, setDialogueLevel] = useState(0.78);
  const [ambienceLevel, setAmbienceLevel] = useState(0.34);
  const [durationsByUrl, setDurationsByUrl] = useState<Record<string, number>>({});
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [playbackNotice, setPlaybackNotice] = useState<string | null>(null);
  const [gapSceneNumber, setGapSceneNumber] = useState<number | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const dialogueAudioRef = useRef<HTMLAudioElement | null>(null);
  const ambienceAudioRef = useRef<HTMLAudioElement | null>(null);
  const episodeScenesRef = useRef<EpisodeScene[]>(episodeScenes);
  const currentSceneIndexRef = useRef(0);
  const currentLineIndexRef = useRef(0);
  const isPlayingRef = useRef(false);
  const episodeCompleteRef = useRef(false);
  const dialogueFinishedRef = useRef(true);
  const visualShotEndedRef = useRef(false);
  const transitionGenerationRef = useRef(0);
  const transitionAbortRef = useRef<AbortController | null>(null);
  const transitionContextRef = useRef<{ source: string; mediaKey: string } | null>(null);
  const cancelledTransitionRef = useRef<{ source: string; mediaKey: string } | null>(null);
  const currentMediaKeyRef = useRef("no-scene");
  const queueRef = useRef<EpisodeTake[]>([]);
  const heardSceneNumbersRef = useRef<Set<number>>(new Set());
  const dialogueLevelRef = useRef(dialogueLevel);
  const ambienceLevelRef = useRef(ambienceLevel);
  const finishingSceneRef = useRef(false);

  episodeScenesRef.current = episodeScenes;
  queueRef.current = episodeScenes[currentSceneIndex]?.takes || [];
  heardSceneNumbersRef.current = heardSceneNumbers;
  currentSceneIndexRef.current = currentSceneIndex;
  currentLineIndexRef.current = currentLineIndex;
  episodeCompleteRef.current = episodeComplete;

  const currentEntry = episodeScenes[currentSceneIndex] || null;
  const isLateCancelledMediaError = (media: HTMLMediaElement, expectedUrl: string) => {
    const cancelledTransition = cancelledTransitionRef.current;
    return Boolean(
      !isPlayingRef.current &&
        cancelledTransition &&
        cancelledTransition.mediaKey === currentMediaKeyRef.current &&
        isExpectedMediaSource(media, expectedUrl)
    );
  };
  const currentTake = currentEntry?.takes[currentLineIndex] || null;
  const currentDialogueTotal = currentEntry?.takes.reduce((sum, take) => {
    const measured = durationsByUrl[take.asset.audio_url];
    if (Number.isFinite(measured) && measured > 0) return sum + measured;
    const saved = Number(take.asset.duration_seconds);
    return sum + (Number.isFinite(saved) && saved > 0 ? saved : 0);
  }, 0) || 0;
  const currentVisualDuration = visualDuration || (currentEntry ? getSceneDuration(currentEntry.scene, currentEntry.clip) : 0);
  const currentSceneEffectiveDuration = Math.max(currentVisualDuration, currentDialogueTotal, 0.01);
  const episodeTotalDuration = episodeScenes.reduce((sum, entry) => {
    const dialogueTotal = entry.takes.reduce((takeSum, take) => {
      const measured = durationsByUrl[take.asset.audio_url];
      if (Number.isFinite(measured) && measured > 0) return takeSum + measured;
      const saved = Number(take.asset.duration_seconds);
      return takeSum + (Number.isFinite(saved) && saved > 0 ? saved : 0);
    }, 0);
    return sum + Math.max(getSceneDuration(entry.scene, entry.clip), dialogueTotal, 0.01);
  }, 0);
  const priorSceneDuration = episodeScenes.slice(0, currentSceneIndex).reduce((sum, entry) => {
    const dialogueTotal = entry.takes.reduce((takeSum, take) => {
      const measured = durationsByUrl[take.asset.audio_url];
      if (Number.isFinite(measured) && measured > 0) return takeSum + measured;
      const saved = Number(take.asset.duration_seconds);
      return takeSum + (Number.isFinite(saved) && saved > 0 ? saved : 0);
    }, 0);
    return sum + Math.max(getSceneDuration(entry.scene, entry.clip), dialogueTotal, 0.01);
  }, 0);
  const episodeElapsedSeconds = episodeComplete
    ? episodeTotalDuration
    : Math.min(episodeTotalDuration, priorSceneDuration + sceneElapsedSeconds);
  const episodeProgress = episodeTotalDuration
    ? Math.min(100, Math.max(0, (episodeElapsedSeconds / episodeTotalDuration) * 100))
    : 0;
  const sceneProgress = currentSceneEffectiveDuration
    ? Math.min(100, Math.max(0, (sceneElapsedSeconds / currentSceneEffectiveDuration) * 100))
    : 0;

  const visualCount = episodeScenes.filter((entry) => Boolean(entry.clip)).length;
  const ambienceCount = episodeScenes.filter((entry) => Boolean(entry.ambienceAsset)).length;
  const completeCount = episodeScenes.filter((entry) => entry.coverageStatus === "complete").length;
  const partialCount = episodeScenes.filter((entry) => entry.coverageStatus === "partial").length;
  const silentCount = episodeScenes.filter((entry) => entry.coverageStatus === "silent").length;
  const noTakeCount = episodeScenes.filter((entry) => entry.coverageStatus === "no-take").length;
  const missingVisualCount = episodeScenes.filter((entry) => entry.coverageStatus === "missing-visual").length;
  const archivedCount = episodeScenes.filter((entry) => entry.isArchivedFromEarlierStoryboard).length;
  const exactTakeCount = episodeScenes.reduce((sum, entry) => sum + entry.matchedCount, 0);

  const blockingReason = isDirty
    ? "Save screenplay edits before reviewing the saved episode proof."
    : isSaving
      ? "Playback is paused while the project is saving."
      : isApproving
        ? "Playback is unavailable while screenplay approval is being recorded."
        : isGeneratingFrames
          ? "Playback is unavailable while visual references are being generated."
          : isPollingMotion
            ? "Playback is unavailable while a motion clip is being checked."
            : isSynthesizingVoice
              ? "Playback is unavailable while a voice take is being synthesized."
              : isGeneratingAmbience
                ? "Playback is unavailable while an ambience bed is being generated."
                : null;

  const cancelPendingTransition = useCallback(() => {
    if (transitionContextRef.current) {
      cancelledTransitionRef.current = transitionContextRef.current;
    } else if (isPlayingRef.current) {
      cancelledTransitionRef.current = {
        source: "playback-stop",
        mediaKey: currentMediaKeyRef.current,
      };
    }
    transitionGenerationRef.current += 1;
    transitionContextRef.current = null;
    transitionAbortRef.current?.abort();
    transitionAbortRef.current = null;
  }, []);

  const beginTransition = useCallback(
    (source: string, mediaKey: string) => {
      cancelPendingTransition();
      cancelledTransitionRef.current = null;
      const controller = new AbortController();
      transitionAbortRef.current = controller;
      transitionContextRef.current = { source, mediaKey };
      const token = transitionGenerationRef.current + 1;
      transitionGenerationRef.current = token;
      return { controller, token };
    },
    [cancelPendingTransition]
  );

  const stopMedia = useCallback(
    (clearSources = false) => {
      cancelPendingTransition();
      cancelledTransitionRef.current = {
        source: "media-stop",
        mediaKey: currentMediaKeyRef.current,
      };
      const video = videoRef.current;
      const dialogueAudio = dialogueAudioRef.current;
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
      if (dialogueAudio) {
        dialogueAudio.pause();
        try {
          dialogueAudio.currentTime = 0;
        } catch {
          // Audio may not be seekable before metadata loads.
        }
        if (clearSources) {
          dialogueAudio.removeAttribute("src");
          dialogueAudio.load();
        }
      }
      if (ambienceAudio) {
        ambienceAudio.pause();
        try {
          ambienceAudio.currentTime = 0;
        } catch {
          // Ambience may not be seekable before metadata loads.
        }
        if (clearSources) {
          ambienceAudio.removeAttribute("src");
          ambienceAudio.load();
        }
      }
    },
    [cancelPendingTransition]
  );

  const syncMediaSources = useCallback((entry: EpisodeScene | null, takeIndex: number) => {
    const video = videoRef.current;
    const dialogueAudio = dialogueAudioRef.current;
    const ambienceAudio = ambienceAudioRef.current;
    if (!video || !dialogueAudio || !ambienceAudio) return;

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

    const dialogueUrl = entry?.takes[takeIndex]?.asset.audio_url?.trim() || null;
    if (dialogueUrl) {
      if (dialogueAudio.getAttribute("src") !== dialogueUrl) {
        dialogueAudio.setAttribute("src", dialogueUrl);
        dialogueAudio.load();
      }
      dialogueAudio.volume = dialogueLevelRef.current;
    } else if (dialogueAudio.getAttribute("src")) {
      dialogueAudio.removeAttribute("src");
      dialogueAudio.load();
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

  const getDialogueElapsed = useCallback(() => {
    const audio = dialogueAudioRef.current;
    if (!audio) return 0;
    const activeQueue = queueRef.current;
    const activeIndex = currentLineIndexRef.current;
    const previousDuration = activeQueue.slice(0, activeIndex).reduce((sum, take) => {
      const measured = durationsByUrl[take.asset.audio_url];
      if (Number.isFinite(measured) && measured > 0) return sum + measured;
      const saved = Number(take.asset.duration_seconds);
      return sum + (Number.isFinite(saved) && saved > 0 ? saved : 0);
    }, 0);
    return Math.max(0, previousDuration + (Number.isFinite(audio.currentTime) ? audio.currentTime : 0));
  }, [durationsByUrl]);

  const resetScenePlayback = useCallback(
    (sceneIndex: number, notice: string | null = null, clearHeard = false, clearSources = false) => {
      const safeIndex = episodeScenesRef.current.length
        ? Math.min(Math.max(sceneIndex, 0), episodeScenesRef.current.length - 1)
        : 0;
      const entry = episodeScenesRef.current[safeIndex] || null;
      const hasDialogue = Boolean(entry?.takes.length);

      isPlayingRef.current = false;
      episodeCompleteRef.current = false;
      dialogueFinishedRef.current = !hasDialogue;
      visualShotEndedRef.current = false;
      setVisualShotEnded(false);
      finishingSceneRef.current = false;
      currentSceneIndexRef.current = safeIndex;
      currentLineIndexRef.current = 0;
      queueRef.current = entry?.takes || [];
      currentMediaKeyRef.current = entry ? getSceneMediaKey(entry) : "no-scene";
      if (clearHeard) {
        heardSceneNumbersRef.current = new Set();
        setHeardSceneNumbers(new Set());
      }
      stopMedia(clearSources);
      if (!clearSources) syncMediaSources(entry, 0);
      setCurrentSceneIndex(safeIndex);
      setCurrentLineIndex(0);
      setIsPlaying(false);
      setEpisodeComplete(false);
      setSceneElapsedSeconds(0);
      setVisualDuration(0);
      setPlaybackError(null);
      setGapSceneNumber(null);
      setPlaybackNotice(notice);
    },
    [stopMedia, syncMediaSources]
  );

  const handlePlaybackFailure = useCallback(
    (message: string) => {
      const entry = episodeScenesRef.current[currentSceneIndexRef.current] || null;
      isPlayingRef.current = false;
      dialogueFinishedRef.current = !Boolean(entry?.takes.length);
      visualShotEndedRef.current = false;
      setVisualShotEnded(false);
      finishingSceneRef.current = false;
      currentLineIndexRef.current = 0;
      cancelPendingTransition();
      stopMedia(true);
      setIsPlaying(false);
      setCurrentLineIndex(0);
      setSceneElapsedSeconds(0);
      setVisualDuration(0);
      setPlaybackError(message);
      setPlaybackNotice(null);
      setGapSceneNumber(null);
    },
    [cancelPendingTransition, stopMedia]
  );

  const playCurrentScene = useCallback(
    async (waitForReadiness: boolean): Promise<boolean> => {
      const sceneIndex = currentSceneIndexRef.current;
      const entry = episodeScenesRef.current[sceneIndex] || null;
      const video = videoRef.current;
      const dialogueAudio = dialogueAudioRef.current;
      const ambienceAudio = ambienceAudioRef.current;
      if (!entry || !video || !dialogueAudio || !ambienceAudio) return false;

      if (!entry.clip?.video_url) {
        isPlayingRef.current = false;
        cancelPendingTransition();
        stopMedia(true);
        setIsPlaying(false);
        setGapSceneNumber(entry.sceneNumber);
        setPlaybackError(null);
        setPlaybackNotice(`Playback stopped before Scene ${formatScene(entry.sceneNumber)} because no playable READY visual clip is saved. Review the coverage gap, then use Restart after the clip is available.`);
        return false;
      }

      if (currentLineIndexRef.current >= entry.takes.length) {
        currentLineIndexRef.current = 0;
        setCurrentLineIndex(0);
      }
      const activeTake = entry.takes[currentLineIndexRef.current] || null;
      dialogueFinishedRef.current = entry.takes.length === 0 || dialogueFinishedRef.current;
      const mediaKey = getSceneMediaKey(entry);
      currentMediaKeyRef.current = mediaKey;
      syncMediaSources(entry, currentLineIndexRef.current);
      const { controller, token } = beginTransition(
        waitForReadiness ? `scene-${entry.sceneNumber}` : `resume-${entry.sceneNumber}`,
        mediaKey
      );
      const isCurrentTransition = () =>
        transitionGenerationRef.current === token &&
        transitionAbortRef.current === controller &&
        isPlayingRef.current &&
        currentSceneIndexRef.current === sceneIndex &&
        currentMediaKeyRef.current === mediaKey;

      isPlayingRef.current = true;
      setIsPlaying(true);
      setPlaybackError(null);
      setPlaybackNotice(null);
      setGapSceneNumber(null);

      try {
        if (waitForReadiness) {
          const readinessChecks: Promise<void>[] = [];
          if (!visualShotEndedRef.current) {
            readinessChecks.push(
              waitForMediaReady(video, entry.clip.video_url, controller.signal, "visual").then(() => undefined)
            );
          }
          if (!dialogueFinishedRef.current && activeTake) {
            readinessChecks.push(
              waitForMediaReady(dialogueAudio, activeTake.asset.audio_url, controller.signal, "dialogue").then(() => undefined)
            );
          }
          if (entry.ambienceAsset) {
            readinessChecks.push(
              waitForMediaReady(ambienceAudio, entry.ambienceAsset.audio_url, controller.signal, "ambience").then(() => undefined)
            );
          }
          await Promise.all(readinessChecks);
          if (!isCurrentTransition()) return false;
        }

        const starts: Promise<void>[] = [];
        if (!visualShotEndedRef.current) starts.push(video.play());
        if (!dialogueFinishedRef.current && activeTake) {
          dialogueAudio.volume = dialogueLevelRef.current;
          starts.push(dialogueAudio.play());
        }
        if (entry.ambienceAsset) {
          ambienceAudio.loop = true;
          ambienceAudio.volume = ambienceLevelRef.current;
          starts.push(ambienceAudio.play());
        }
        if (starts.length) await Promise.all(starts);
        if (!isCurrentTransition()) {
          if (
            currentSceneIndexRef.current === sceneIndex &&
            currentMediaKeyRef.current === mediaKey
          ) {
            video.pause();
            dialogueAudio.pause();
            ambienceAudio.pause();
          }
          return false;
        }
        return true;
      } catch (error) {
        if (!isCurrentTransition() || isReadinessCancellation(error)) return false;
        handlePlaybackFailure(
          `The saved Scene ${formatScene(entry.sceneNumber)} could not continue in this browser. Press Play to retry this episode proof without changing the saved media.`
        );
        return false;
      } finally {
        if (transitionAbortRef.current === controller) {
          transitionAbortRef.current = null;
          transitionContextRef.current = null;
        }
      }
    },
    [beginTransition, cancelPendingTransition, handlePlaybackFailure, stopMedia, syncMediaSources]
  );

  const startSceneAt = useCallback(
    async (sceneIndex: number): Promise<boolean> => {
      const entry = episodeScenesRef.current[sceneIndex] || null;
      const safeIndex = entry ? sceneIndex : Math.max(0, episodeScenesRef.current.length - 1);
      const safeEntry = episodeScenesRef.current[safeIndex] || null;
      const hasDialogue = Boolean(safeEntry?.takes.length);

      isPlayingRef.current = false;
      episodeCompleteRef.current = false;
      dialogueFinishedRef.current = !hasDialogue;
      visualShotEndedRef.current = false;
      setVisualShotEnded(false);
      currentSceneIndexRef.current = safeIndex;
      currentLineIndexRef.current = 0;
      queueRef.current = safeEntry?.takes || [];
      currentMediaKeyRef.current = safeEntry ? getSceneMediaKey(safeEntry) : "no-scene";
      stopMedia(false);
      setCurrentSceneIndex(safeIndex);
      setCurrentLineIndex(0);
      setIsPlaying(false);
      setEpisodeComplete(false);
      setSceneElapsedSeconds(0);
      setVisualDuration(0);
      setPlaybackError(null);
      setGapSceneNumber(null);
      if (!safeEntry) {
        setPlaybackNotice("No screenplay scenes are available for this episode proof.");
        return false;
      }
      syncMediaSources(safeEntry, 0);
      return playCurrentScene(true);
    },
    [playCurrentScene, stopMedia, syncMediaSources]
  );

  const finishCurrentScene = useCallback(() => {
    const sceneIndex = currentSceneIndexRef.current;
    const entry = episodeScenesRef.current[sceneIndex] || null;
    if (
      !entry ||
      !isPlayingRef.current ||
      finishingSceneRef.current ||
      !visualShotEndedRef.current ||
      !dialogueFinishedRef.current
    ) {
      return;
    }

    finishingSceneRef.current = true;
    ambienceAudioRef.current?.pause();
    setHeardSceneNumbers((current) => {
      const next = new Set(current);
      next.add(entry.sceneNumber);
      heardSceneNumbersRef.current = next;
      return next;
    });

    const nextIndex = sceneIndex + 1;
    if (nextIndex >= episodeScenesRef.current.length) {
      cancelPendingTransition();
      isPlayingRef.current = false;
      episodeCompleteRef.current = true;
      setIsPlaying(false);
      setEpisodeComplete(true);
      setSceneElapsedSeconds(currentSceneEffectiveDuration);
      setGapSceneNumber(null);
      setPlaybackError(null);
      setPlaybackNotice("Episode mix proof complete. Every saved scene played in screenplay order. This remains a local browser proof, not a finished episode.");
      finishingSceneRef.current = false;
      return;
    }

    void startSceneAt(nextIndex).finally(() => {
      finishingSceneRef.current = false;
    });
  }, [cancelPendingTransition, currentSceneEffectiveDuration, startSceneAt]);

  useEffect(() => {
    if (!episodeScenes.length) {
      resetScenePlayback(0, "No screenplay scenes are available for this episode proof.", true, true);
      return;
    }
    resetScenePlayback(0, null, true, false);
  }, [episodeTimelineKey, episodeScenes.length, resetScenePlayback]);

  useEffect(() => {
    if (blockingReason) {
      resetScenePlayback(0, blockingReason, false, true);
    }
  }, [blockingReason, resetScenePlayback]);

  useEffect(() => {
    dialogueLevelRef.current = dialogueLevel;
    if (dialogueAudioRef.current) dialogueAudioRef.current.volume = dialogueLevel;
  }, [dialogueLevel]);

  useEffect(() => {
    ambienceLevelRef.current = ambienceLevel;
    if (ambienceAudioRef.current) ambienceAudioRef.current.volume = ambienceLevel;
  }, [ambienceLevel]);

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

  const handlePlay = () => {
    if (blockingReason || !episodeScenes.length || isPlayingRef.current || episodeCompleteRef.current) return;
    void playCurrentScene(false);
  };

  const handlePause = () => {
    if (!isPlayingRef.current) return;
    cancelPendingTransition();
    videoRef.current?.pause();
    dialogueAudioRef.current?.pause();
    ambienceAudioRef.current?.pause();
    isPlayingRef.current = false;
    setIsPlaying(false);
    setPlaybackNotice(
      visualShotEndedRef.current && !dialogueFinishedRef.current
        ? "Paused while the saved dialogue continues beyond the visual shot. Press Play to resume."
        : "Paused. Press Play to continue from the current scene and line."
    );
  };

  const handleRestart = () => {
    if (blockingReason || !episodeScenes.length) return;
    resetScenePlayback(0, "Restarted at Scene 01. Press Play to run the saved episode sequence.", true, false);
  };

  const handleStop = () => {
    if (blockingReason || !episodeScenes.length) return;
    const entry = episodeScenesRef.current[currentSceneIndexRef.current] || null;
    const sceneNumber = entry?.sceneNumber || currentSceneIndexRef.current + 1;
    resetScenePlayback(
      currentSceneIndexRef.current,
      `Stopped at Scene ${formatScene(sceneNumber)}. Press Play to review this scene again, or Restart for Scene 01.`,
      false,
      false
    );
  };

  const handleReviewScene = (sceneIndex: number) => {
    if (blockingReason || !episodeScenes[sceneIndex]) return;
    resetScenePlayback(
      sceneIndex,
      `Reviewing Scene ${formatScene(episodeScenes[sceneIndex].sceneNumber)}. Press Play to hear this saved scene, then use Restart to return to Scene 01.`,
      false,
      false
    );
  };

  const handleAudioEnded = (event: React.SyntheticEvent<HTMLAudioElement>) => {
    if (!isPlayingRef.current) return;
    const audio = event.currentTarget;
    if (!audio.ended) return;
    const activeQueue = queueRef.current;
    const activeIndex = currentLineIndexRef.current;
    const currentTakeAtEnd = activeQueue[activeIndex];
    if (!currentTakeAtEnd || !isExpectedMediaSource(audio, currentTakeAtEnd.asset.audio_url)) return;

    registerAudioDuration(currentTakeAtEnd.asset.audio_url, audio.duration);
    const nextIndex = activeIndex + 1;
    if (nextIndex < activeQueue.length) {
      const nextTake = activeQueue[nextIndex];
      const nextUrl = nextTake.asset.audio_url.trim();
      const sceneIndexAtStart = currentSceneIndexRef.current;
      const mediaKeyAtStart = currentMediaKeyRef.current;
      const { controller, token } = beginTransition(`dialogue-${nextTake.line.line_id}`, mediaKeyAtStart);
      currentLineIndexRef.current = nextIndex;
      setCurrentLineIndex(nextIndex);
      setPlaybackNotice(null);
      audio.pause();
      audio.setAttribute("src", nextUrl);
      audio.volume = dialogueLevelRef.current;
      audio.load();

      const isCurrentHandoff = () =>
        transitionGenerationRef.current === token &&
        transitionAbortRef.current === controller &&
        isPlayingRef.current &&
        currentSceneIndexRef.current === sceneIndexAtStart &&
        currentMediaKeyRef.current === mediaKeyAtStart &&
        dialogueAudioRef.current === audio &&
        isExpectedMediaSource(audio, nextUrl);

      void (async () => {
        try {
          await waitForMediaReady(audio, nextUrl, controller.signal, "dialogue");
          if (!isCurrentHandoff()) return;
          await audio.play();
          if (
            !isCurrentHandoff() &&
            currentSceneIndexRef.current === sceneIndexAtStart &&
            currentMediaKeyRef.current === mediaKeyAtStart &&
            isExpectedMediaSource(audio, nextUrl)
          ) {
            audio.pause();
          }
        } catch (error) {
          if (!isCurrentHandoff() || isReadinessCancellation(error)) return;
          handlePlaybackFailure("The next saved dialogue take could not continue in this browser. Press Play to retry this episode proof.");
        } finally {
          if (transitionAbortRef.current === controller) {
            transitionAbortRef.current = null;
            transitionContextRef.current = null;
          }
        }
      })();
      return;
    }

    dialogueFinishedRef.current = true;
    setCurrentLineIndex(activeIndex);
    if (visualShotEndedRef.current) {
      setPlaybackNotice("Dialogue is complete and the visual shot has ended. Finishing this scene before the next screenplay scene.");
      finishCurrentScene();
    } else {
      setPlaybackNotice("Saved dialogue is complete. The muted visual reference and ambience continue until the shot ends.");
    }
  };

  const handleVideoEnded = (event: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    if (!video.ended) return;
    const entry = episodeScenesRef.current[currentSceneIndexRef.current] || null;
    if (!entry?.clip?.video_url || !isExpectedMediaSource(video, entry.clip.video_url)) return;
    visualShotEndedRef.current = true;
    setVisualShotEnded(true);
    setVisualDuration((current) => current || video.duration || getSceneDuration(entry.scene, entry.clip));
    setSceneElapsedSeconds((current) => Math.max(current, video.duration || current));
    video.pause();
    if (!isPlayingRef.current) return;
    if (!dialogueFinishedRef.current) {
      setPlaybackNotice("The visual shot ended. The last frame stays on screen while saved dialogue continues beyond this shot.");
      return;
    }
    finishCurrentScene();
  };

  const handleVideoTimeUpdate = (event: React.SyntheticEvent<HTMLVideoElement>) => {
    if (visualShotEndedRef.current) return;
    const currentTime = event.currentTarget.currentTime;
    if (!Number.isFinite(currentTime)) return;
    setSceneElapsedSeconds((current) => Math.max(current, currentTime, getDialogueElapsed()));
  };

  const handleAudioTimeUpdate = (event: React.SyntheticEvent<HTMLAudioElement>) => {
    const currentTime = event.currentTarget.currentTime;
    if (!Number.isFinite(currentTime)) return;
    setSceneElapsedSeconds((current) => Math.max(current, getDialogueElapsed(), currentTime));
  };

  const handleVideoMetadata = (event: React.SyntheticEvent<HTMLVideoElement>) => {
    const entry = episodeScenesRef.current[currentSceneIndexRef.current] || null;
    if (!entry?.clip?.video_url || !isExpectedMediaSource(event.currentTarget, entry.clip.video_url)) return;
    const duration = event.currentTarget.duration;
    if (Number.isFinite(duration) && duration > 0) setVisualDuration(duration);
  };

  const handleDialogueMetadata = (event: React.SyntheticEvent<HTMLAudioElement>) => {
    const take = queueRef.current[currentLineIndexRef.current];
    if (!take || !isExpectedMediaSource(event.currentTarget, take.asset.audio_url)) return;
    registerAudioDuration(take.asset.audio_url, event.currentTarget.duration);
  };

  const handleVideoError = (event: React.SyntheticEvent<HTMLVideoElement>) => {
    const entry = episodeScenesRef.current[currentSceneIndexRef.current] || null;
    if (!entry?.clip?.video_url || !isExpectedMediaSource(event.currentTarget, entry.clip.video_url)) return;
    if (isLateCancelledMediaError(event.currentTarget, entry.clip.video_url)) return;
    if (blockingReason || transitionAbortRef.current) return;
    if (isPlayingRef.current) {
      handlePlaybackFailure("The saved visual clip could not play in this browser. Press Play to retry the episode proof.");
    } else {
      setPlaybackError("The saved visual clip could not load in this browser. Press Play to retry the episode proof.");
    }
  };

  const handleDialogueError = (event: React.SyntheticEvent<HTMLAudioElement>) => {
    const take = queueRef.current[currentLineIndexRef.current];
    if (!take || !isExpectedMediaSource(event.currentTarget, take.asset.audio_url)) return;
    if (isLateCancelledMediaError(event.currentTarget, take.asset.audio_url)) return;
    if (blockingReason || transitionAbortRef.current) return;
    if (isPlayingRef.current) {
      handlePlaybackFailure("The saved dialogue could not play in this browser. Press Play to retry the episode proof.");
    } else {
      setPlaybackError("The saved dialogue could not load in this browser. Press Play to retry the episode proof.");
    }
  };

  const handleAmbienceError = (event: React.SyntheticEvent<HTMLAudioElement>) => {
    const entry = episodeScenesRef.current[currentSceneIndexRef.current] || null;
    if (!entry?.ambienceAsset || !isExpectedMediaSource(event.currentTarget, entry.ambienceAsset.audio_url)) return;
    if (isLateCancelledMediaError(event.currentTarget, entry.ambienceAsset.audio_url)) return;
    if (blockingReason || transitionAbortRef.current) return;
    if (isPlayingRef.current) {
      handlePlaybackFailure("The saved ambience bed could not play in this browser. Press Play to retry the episode proof.");
    } else {
      setPlaybackError("The saved ambience bed could not load in this browser. Press Play to retry the episode proof.");
    }
  };

  const currentStatusText = playbackError || playbackNotice || (
    blockingReason
      ? blockingReason
      : !episodeScenes.length
        ? "Approve and save a valid screenplay before opening the episode mix proof."
        : episodeComplete
          ? "Episode mix proof complete. Use Restart to hear the saved sequence again."
          : gapSceneNumber !== null
            ? `Playback is stopped at Scene ${formatScene(gapSceneNumber)} because its visual coverage is missing.`
            : currentEntry?.clip
              ? currentEntry.takes.length
                ? "Press Play to run saved visual, exact dialogue takes, and optional scene ambience in screenplay order."
                : currentEntry.coverageStatus === "silent"
                  ? "Press Play to run this silent scene with its saved visual and optional ambience."
                  : "Press Play to run this visual without dialogue. The missing saved take remains visible in the ledger."
              : `Scene ${currentEntry ? formatScene(currentEntry.sceneNumber) : "01"} has no playable visual clip. Playback stops here instead of skipping the gap.`
  );

  const currentLineStatus = episodeComplete
    ? "Episode complete"
    : gapSceneNumber !== null
      ? "Coverage gap"
      : isPlaying
        ? dialogueFinishedRef.current
          ? currentTake
            ? "Dialogue complete"
            : currentEntry?.coverageStatus === "silent"
              ? "Playing silent scene"
              : "Playing without saved dialogue"
          : currentTake
            ? "Playing saved take"
            : currentEntry?.coverageStatus === "silent"
              ? "Playing silent scene"
              : "Playing without saved dialogue"
        : dialogueFinishedRef.current && currentTake
          ? "Dialogue complete"
          : currentTake
            ? "Ready to play"
            : currentEntry?.coverageStatus === "silent"
              ? "Silent scene"
              : "No saved take selected";

  return (
    <section
      className="overflow-hidden rounded-2xl border border-amber-500/[0.35] bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,0.16),transparent_42%),#101722] shadow-xl shadow-black/20"
      aria-labelledby="episode-mix-proof-title"
    >
      <div className="border-b border-amber-500/20 px-4 py-5 sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs font-mono uppercase tracking-[0.18em] text-amber-300">
              <AudioLines className="h-4 w-4" aria-hidden="true" /> Episode mix proof
              <span className="rounded-md border border-[#46536b] bg-[#0c111b] px-2 py-1 text-[10px] tracking-wider text-gray-300">Read only</span>
              <span className="rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2 py-1 text-[10px] tracking-wider text-emerald-200">Saved media only</span>
              <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] tracking-wider text-amber-200">Local browser proof</span>
            </div>
            <h2 id="episode-mix-proof-title" className="text-2xl font-serif font-bold tracking-tight text-white sm:text-3xl">
              Hear the saved episode in order.
            </h2>
            <p className="max-w-2xl text-sm leading-relaxed text-gray-300">
              This browser-only checkpoint runs the newest saved visual clip for each scene, exact current dialogue takes, and each scene’s newest ambience bed when one exists. It moves through the screenplay without filling gaps, replacing archived clips, or creating a final episode file.
            </p>
          </div>
          <div className="grid shrink-0 grid-cols-2 gap-2 text-xs sm:min-w-[290px]">
            <div className="rounded-xl border border-[#33415d] bg-[#0b1019]/80 p-3">
              <p className="font-mono uppercase tracking-wider text-gray-500">Visuals ready</p>
              <p className="mt-1 text-lg font-semibold text-emerald-200">{visualCount}/{episodeScenes.length || 0}</p>
              <p className="mt-1 text-[10px] leading-relaxed text-gray-500">Newest READY secure clips</p>
            </div>
            <div className="rounded-xl border border-[#33415d] bg-[#0b1019]/80 p-3">
              <p className="font-mono uppercase tracking-wider text-gray-500">Exact takes</p>
              <p className="mt-1 text-lg font-semibold text-amber-200">{exactTakeCount}</p>
              <p className="mt-1 text-[10px] leading-relaxed text-gray-500">Current lines only</p>
            </div>
            <div className="col-span-2 rounded-xl border border-[#33415d] bg-[#0b1019]/80 p-3 sm:col-span-1">
              <p className="font-mono uppercase tracking-wider text-gray-500">Ambience beds</p>
              <p className="mt-1 text-lg font-semibold text-amber-200">{ambienceCount}</p>
              <p className="mt-1 text-[10px] leading-relaxed text-gray-500">Optional and scene-local</p>
            </div>
            <div className="col-span-2 rounded-xl border border-[#33415d] bg-[#0b1019]/80 p-3 sm:col-span-1">
              <p className="font-mono uppercase tracking-wider text-gray-500">Output</p>
              <p className="mt-1 text-lg font-semibold text-amber-200">No file</p>
              <p className="mt-1 text-[10px] leading-relaxed text-gray-500">Nothing is saved here</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-3 border-b border-[#242f45] bg-[#0d131e]/80 px-4 py-4 sm:grid-cols-2 lg:grid-cols-4 sm:px-6">
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-950/10 p-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-gray-500">Complete dialogue</p>
          <p className="mt-1 text-xl font-semibold text-emerald-200">{completeCount}</p>
          <p className="mt-1 text-[10px] leading-relaxed text-gray-500">Every current line has a take</p>
        </div>
        <div className={`rounded-xl border p-3 ${partialCount ? "border-amber-500/30 bg-amber-950/[0.15]" : "border-[#2b3850] bg-[#0b1019]"}`}>
          <p className="font-mono text-[10px] uppercase tracking-wider text-gray-500">Partial dialogue</p>
          <p className={`mt-1 text-xl font-semibold ${partialCount ? "text-amber-200" : "text-gray-300"}`}>{partialCount}</p>
          <p className="mt-1 text-[10px] leading-relaxed text-gray-500">Saved takes stay exact and incomplete</p>
        </div>
        <div className={`rounded-xl border p-3 ${missingVisualCount ? "border-red-500/30 bg-red-950/[0.15]" : "border-[#2b3850] bg-[#0b1019]"}`}>
          <p className="font-mono text-[10px] uppercase tracking-wider text-gray-500">Visual gaps</p>
          <p className={`mt-1 text-xl font-semibold ${missingVisualCount ? "text-red-200" : "text-gray-300"}`}>{missingVisualCount}</p>
          <p className="mt-1 text-[10px] leading-relaxed text-gray-500">Playback stops before each gap</p>
        </div>
        <div className="rounded-xl border border-[#2b3850] bg-[#0b1019] p-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-gray-500">Silent / no take</p>
          <p className="mt-1 text-xl font-semibold text-gray-300">{silentCount} / {noTakeCount}</p>
          <p className="mt-1 text-[10px] leading-relaxed text-gray-500">Silent scenes play without dialogue</p>
        </div>
      </div>

      <div className="grid gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[minmax(0,0.94fr)_minmax(300px,1.06fr)]">
        <div className="space-y-4">
          <div className="rounded-xl border border-[#2b3850] bg-[#0b1019] p-4" aria-labelledby="episode-coverage-ledger-title">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-amber-300">
                  <Film className="h-3.5 w-3.5" aria-hidden="true" />
                  <span id="episode-coverage-ledger-title">Ordered scene coverage</span>
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-gray-500">The ledger follows screenplay order. Review is explicit, and playback never jumps across a missing visual scene.</p>
              </div>
              <span className="rounded-md border border-[#33415d] bg-[#151d2c] px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-gray-400">{archivedCount} archived frame{archivedCount === 1 ? "" : "s"} retained</span>
            </div>

            <div className="mt-4 space-y-2.5">
              {episodeScenes.length ? episodeScenes.map((entry, index) => {
                const isGap = gapSceneNumber === entry.sceneNumber;
                const isCurrent = currentSceneIndex === index && !isGap;
                const isHeard = heardSceneNumbers.has(entry.sceneNumber);
                const scenePositionLabel = isGap
                  ? "Gap"
                  : isCurrent
                    ? "Current"
                    : isHeard
                      ? "Heard"
                      : "Next";
                const dialogueLabel = entry.lines.length === 0
                  ? "0/0 spoken lines"
                  : `${entry.matchedCount}/${entry.lines.length} exact takes`;
                return (
                  <article
                    key={entry.sceneNumber}
                    className={`rounded-xl border p-3 transition-colors ${isGap ? "border-red-500/[0.45] bg-red-950/20" : isCurrent ? "border-amber-500/[0.45] bg-amber-950/20" : isHeard ? "border-emerald-700/30 bg-emerald-950/10" : "border-[#29364e] bg-[#111827]"}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border font-mono text-xs ${isGap ? "border-red-500/40 bg-red-500/10 text-red-200" : isCurrent ? "border-amber-500/40 bg-amber-500/10 text-amber-100" : isHeard ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-[#3a465d] bg-[#182033] text-gray-300"}`}>
                        {formatScene(entry.sceneNumber)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-gray-100">Scene {formatScene(entry.sceneNumber)}</p>
                          <span className={`rounded-md border px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider ${isGap ? "border-red-500/[0.35] bg-red-500/10 text-red-200" : isCurrent ? "border-amber-500/[0.35] bg-amber-500/10 text-amber-200" : isHeard ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-200" : "border-[#3a465d] bg-[#151d2c] text-gray-400"}`}>
                            {scenePositionLabel}
                          </span>
                          <span className={`rounded-md border px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider ${coverageClass(entry.coverageStatus)}`}>
                            {coverageLabel(entry.coverageStatus)}
                          </span>
                        </div>
                        <div className="mt-2 grid gap-2 text-[10px] sm:grid-cols-2">
                          <div className="rounded-lg border border-[#253149] bg-[#0b1019] px-2.5 py-2">
                            <p className="font-mono uppercase tracking-wider text-gray-500">Visual</p>
                            <p className={`mt-1 ${entry.clip ? "text-emerald-200" : "text-red-200"}`}>{entry.clip ? "READY secure clip" : "Missing visual clip"}</p>
                          </div>
                          <div className="rounded-lg border border-[#253149] bg-[#0b1019] px-2.5 py-2">
                            <p className="font-mono uppercase tracking-wider text-gray-500">Dialogue</p>
                            <p className={`mt-1 ${entry.coverageStatus === "complete" ? "text-emerald-200" : entry.coverageStatus === "partial" ? "text-amber-200" : "text-gray-300"}`}>{dialogueLabel}</p>
                          </div>
                          <div className="rounded-lg border border-[#253149] bg-[#0b1019] px-2.5 py-2">
                            <p className="font-mono uppercase tracking-wider text-gray-500">Ambience</p>
                            <p className="mt-1 text-gray-300">{entry.ambienceAsset ? `Saved bed · ${Number(entry.ambienceAsset.duration_seconds).toFixed(1)}s` : "Optional · none saved"}</p>
                          </div>
                          <div className="rounded-lg border border-[#253149] bg-[#0b1019] px-2.5 py-2">
                            <p className="font-mono uppercase tracking-wider text-gray-500">Frame source</p>
                            <p className={`mt-1 ${entry.isArchivedFromEarlierStoryboard ? "text-emerald-200" : "text-gray-300"}`}>{entry.isArchivedFromEarlierStoryboard ? "Archived earlier frame" : entry.clip ? "Current storyboard match" : "No clip to compare"}</p>
                          </div>
                        </div>
                        {entry.isArchivedFromEarlierStoryboard && (
                          <p className="mt-2 text-[10px] leading-relaxed text-emerald-100/[0.65]">This saved clip stays in the proof because archived earlier-storyboard media is preserved. It is labeled instead of replaced.</p>
                        )}
                        {isGap && (
                          <p className="mt-2 flex items-start gap-1.5 text-[10px] leading-relaxed text-red-100/80"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-red-300" aria-hidden="true" />The episode stops here until this scene has a playable saved visual.</p>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => handleReviewScene(index)}
                        disabled={Boolean(blockingReason) || !episodeScenes.length || (isCurrent && !isPlaying)}
                        className="h-8 shrink-0 border-[#3b4963] bg-[#151e2e] px-2.5 text-[10px] text-gray-200 hover:border-amber-500/50 hover:bg-[#1c2940] disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label={`Review Scene ${entry.sceneNumber} coverage`}
                      >
                        Review
                      </Button>
                    </div>
                  </article>
                );
              }) : (
                <div className="rounded-lg border border-dashed border-[#33415d] p-4 text-xs leading-relaxed text-gray-500">A saved screenplay is required before the ordered coverage ledger can open.</div>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-[#2b3850] bg-[#0b1019] p-4">
            <div className="flex items-start gap-3">
              <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-2 text-amber-300">
                <Info className="h-4 w-4" aria-hidden="true" />
              </div>
              <div className="space-y-1.5 text-xs leading-relaxed">
                <p className="font-semibold text-gray-200">Coverage rules for this proof</p>
                <p className="text-gray-400">Dialogue plays only when the saved asset matches the current scene, line ID or legacy fallback, character, text, and secure MP3 content type. Missing lines remain absent, so partial dialogue stays labeled partial.</p>
                <p className="text-gray-400">Ambience is optional. When present, it loops only during its own scene at a temporary browser level. It never restarts between dialogue takes and is never saved by this panel.</p>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-amber-400">Episode reference player</p>
              <p className="mt-1 text-sm font-semibold text-white" aria-live="polite">{currentEntry ? `Scene ${formatScene(currentEntry.sceneNumber)}` : "No scene selected"}</p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-md border border-[#33415d] bg-[#0b1019] px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-gray-400"><VolumeX className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" /> Muted video</span>
          </div>

          <div className="relative overflow-hidden rounded-2xl border border-[#2b3850] bg-[#080b11] p-2 shadow-lg shadow-black/20">
            <video
              ref={videoRef}
              className="mx-auto aspect-[9/16] max-h-[590px] w-full max-w-[350px] rounded-xl bg-black object-contain"
              muted
              playsInline
              preload="auto"
              onLoadedMetadata={handleVideoMetadata}
              onTimeUpdate={handleVideoTimeUpdate}
              onEnded={handleVideoEnded}
              onError={handleVideoError}
              aria-label={currentEntry ? `Muted Scene ${currentEntry.sceneNumber} motion clip` : "Muted episode visual reference"}
            />
            {!currentEntry?.clip && (
              <div className="absolute inset-2 flex items-center justify-center rounded-xl border border-dashed border-[#33415d] bg-[#0b1019] p-6 text-center">
                <div className="max-w-[240px] space-y-3">
                  <Film className="mx-auto h-9 w-9 text-red-300/70" aria-hidden="true" />
                  <p className="text-sm font-semibold text-gray-200">Visual coverage gap</p>
                  <p className="text-xs leading-relaxed text-gray-500">Playback stops at Scene {currentEntry ? formatScene(currentEntry.sceneNumber) : "01"} until a saved READY visual clip is available.</p>
                </div>
              </div>
            )}
            {currentEntry?.isArchivedFromEarlierStoryboard && (
              <span className="absolute left-4 top-4 rounded-md border border-emerald-500/[0.35] bg-emerald-950/[0.85] px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-emerald-200 backdrop-blur-sm">Archived · earlier frame</span>
            )}
            {visualShotEnded && !episodeComplete && (
              <span className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-md border border-amber-500/[0.35] bg-black/80 px-2.5 py-1.5 text-[10px] font-mono uppercase tracking-wider text-amber-100 backdrop-blur-sm">Visual ended · last frame held</span>
            )}
          </div>

          <audio
            ref={dialogueAudioRef}
            preload="auto"
            onLoadedMetadata={handleDialogueMetadata}
            onTimeUpdate={handleAudioTimeUpdate}
            onEnded={handleAudioEnded}
            onError={handleDialogueError}
            aria-label="Saved dialogue take for the current episode scene"
            className="sr-only"
          />
          <audio
            ref={ambienceAudioRef}
            preload="auto"
            loop
            onError={handleAmbienceError}
            aria-label="Saved ambience bed for the current episode scene"
            className="sr-only"
          />

          <div className="rounded-xl border border-[#2b3850] bg-[#0b1019] p-3.5" aria-live="polite">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-amber-400">Current scene and line</p>
              <span className={`text-[10px] ${isPlaying ? "text-emerald-300" : playbackError ? "text-red-300" : "text-gray-400"}`}>{currentLineStatus}</span>
            </div>
            {currentTake ? (
              <>
                <p className="mt-2 font-mono text-[11px] uppercase tracking-wider text-gray-300">Scene {formatScene(currentEntry?.sceneNumber || 0)} · line {String(currentTake.line.order).padStart(2, "0")} · saved take {currentLineIndex + 1} of {currentEntry?.takes.length || 0} · {currentTake.line.character_id}</p>
                <p className="mt-2 text-sm leading-relaxed text-amber-100/90">“{currentTake.line.text}”</p>
              </>
            ) : currentEntry?.coverageStatus === "silent" ? (
              <p className="mt-2 text-xs leading-relaxed text-gray-500">Silent scene. The visual and optional ambience can play without a dialogue track.</p>
            ) : currentEntry?.coverageStatus === "no-take" ? (
              <p className="mt-2 text-xs leading-relaxed text-orange-100/70">No exact saved take is available for the current lines. The visual can play without dialogue so the coverage gap stays honest.</p>
            ) : currentEntry?.coverageStatus === "missing-visual" ? (
              <p className="mt-2 text-xs leading-relaxed text-red-100/70">This scene cannot enter the episode sequence until its visual clip is saved and playable.</p>
            ) : (
              <p className="mt-2 text-xs leading-relaxed text-gray-500">Press Play to begin at Scene {currentEntry ? formatScene(currentEntry.sceneNumber) : "01"}.</p>
            )}
          </div>

          <div className="rounded-xl border border-[#2b3850] bg-[#0b1019] p-3.5" aria-labelledby="episode-dialogue-track-title">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <AudioLines className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
                <p id="episode-dialogue-track-title" className="text-[10px] font-mono uppercase tracking-[0.16em] text-amber-400">Current scene dialogue</p>
              </div>
              <span className="text-[10px] text-gray-500">Exact takes only</span>
            </div>
            <div className="mt-3 space-y-2">
              {currentEntry?.takes.length ? currentEntry.takes.map((take, index) => (
                <div key={take.line.line_id} className={`flex items-start gap-2 rounded-lg border p-2.5 ${currentLineIndex === index && !dialogueFinishedRef.current && !episodeComplete ? "border-amber-500/[0.45] bg-amber-950/20" : index < currentLineIndex || episodeComplete || dialogueFinishedRef.current ? "border-emerald-700/25 bg-emerald-950/10" : "border-[#29364e] bg-[#111827]"}`}>
                  <span className="mt-0.5 min-w-[1.5rem] rounded-md border border-[#3a465d] bg-[#182033] px-1.5 py-1 text-center font-mono text-[9px] text-gray-300">{String(take.line.order).padStart(2, "0")}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-gray-300">{take.line.character_id}</p>
                    <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-gray-400">{take.line.text}</p>
                  </div>
                  <span className={`shrink-0 text-[10px] ${currentLineIndex === index && !dialogueFinishedRef.current && !episodeComplete ? "text-amber-200" : index < currentLineIndex || episodeComplete || dialogueFinishedRef.current ? "text-emerald-300" : "text-gray-600"}`}>
                    {currentLineIndex === index && !dialogueFinishedRef.current && !episodeComplete ? "Now" : index < currentLineIndex || episodeComplete || dialogueFinishedRef.current ? "Heard" : "Next"}
                  </span>
                </div>
              )) : (
                <p className="rounded-lg border border-dashed border-[#33415d] px-3 py-3 text-xs leading-relaxed text-gray-500">No saved dialogue takes are ready for this scene. The sequence keeps the scene visible and continues with no dialogue track.</p>
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
        {gapSceneNumber !== null && !blockingReason && (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-700/[0.35] bg-red-950/20 p-3 text-xs text-red-100/[0.85]" role="alert">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-300" aria-hidden="true" />
            <div className="space-y-1 leading-relaxed">
              <p className="font-semibold text-red-200">Playback stopped before Scene {formatScene(gapSceneNumber)}</p>
              <p>No playable saved visual clip is available for this scene. The episode stays in screenplay order and does not skip ahead.</p>
              <button type="button" onClick={handleRestart} className="font-semibold text-amber-200 underline decoration-amber-500/50 underline-offset-2 hover:text-amber-100">Restart at Scene 01</button>
            </div>
          </div>
        )}
        {visualShotEnded && !dialogueFinishedRef.current && isPlaying && !blockingReason && (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-500/[0.35] bg-amber-950/20 p-3 text-xs text-amber-100/[0.85]" role="status">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden="true" />
            <span>The visual reference has ended, so its last frame stays on screen while the saved dialogue finishes. This overrun is reported for later assembly and is not presented as final sync.</span>
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(250px,0.62fr)] lg:items-center">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-gray-400">
                <Clock3 className="h-4 w-4 text-amber-400" aria-hidden="true" />
                <span aria-live="polite">{formatClock(episodeElapsedSeconds)} / {formatClock(episodeTotalDuration)}</span>
              </div>
              <span className="text-[11px] text-gray-500">{episodeScenes.length ? `Scene ${Math.min(currentSceneIndex + 1, episodeScenes.length)} of ${episodeScenes.length} · ${formatClock(sceneElapsedSeconds)} in scene` : "No episode timeline"}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[#202a3d]" aria-label="Episode playback progress" role="progressbar" aria-valuemin={0} aria-valuemax={episodeTotalDuration || 0} aria-valuenow={Math.min(episodeElapsedSeconds, episodeTotalDuration || episodeElapsedSeconds)}>
              <div className="h-full rounded-full bg-amber-400 transition-[width] duration-150" style={{ width: `${episodeProgress}%` }} />
            </div>
            <div className="flex items-center justify-between text-[10px] text-gray-500"><span>Scene progress {Math.round(sceneProgress)}%</span><span>{formatClock(currentSceneEffectiveDuration)} estimated current scene</span></div>
            <div className="flex flex-wrap gap-2" aria-label="Episode mix playback controls">
              <Button type="button" onClick={handlePlay} disabled={Boolean(blockingReason) || !episodeScenes.length || isPlaying || episodeComplete} className="h-10 gap-2 bg-amber-500 px-4 text-xs font-semibold text-black hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"><Play className="h-3.5 w-3.5" aria-hidden="true" /> Play</Button>
              <Button type="button" onClick={handlePause} disabled={Boolean(blockingReason) || !isPlaying} variant="outline" className="h-10 gap-2 border-[#3b4963] bg-[#151e2e] px-4 text-xs text-gray-200 hover:border-amber-500/50 hover:bg-[#1c2940] disabled:cursor-not-allowed disabled:opacity-50"><Pause className="h-3.5 w-3.5" aria-hidden="true" /> Pause</Button>
              <Button type="button" onClick={handleRestart} disabled={Boolean(blockingReason) || !episodeScenes.length} variant="outline" className="h-10 gap-2 border-[#3b4963] bg-[#151e2e] px-4 text-xs text-gray-200 hover:border-amber-500/50 hover:bg-[#1c2940] disabled:cursor-not-allowed disabled:opacity-50"><RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Restart</Button>
              <Button type="button" onClick={handleStop} disabled={Boolean(blockingReason) || !isPlaying} variant="outline" className="h-10 gap-2 border-[#3b4963] bg-[#151e2e] px-4 text-xs text-gray-200 hover:border-red-500/50 hover:bg-red-950/20 disabled:cursor-not-allowed disabled:opacity-50"><Square className="h-3.5 w-3.5" aria-hidden="true" /> Stop</Button>
            </div>
            <p className={`text-xs leading-relaxed ${playbackError ? "text-red-300" : playbackNotice || blockingReason ? "text-amber-200/[0.85]" : "text-gray-500"}`} role={playbackError ? "alert" : "status"} aria-live="polite">{currentStatusText}</p>
          </div>

          <div className="space-y-3">
            <div className="rounded-xl border border-[#2b3850] bg-[#0b1019] p-3.5">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="episode-mix-dialogue-level" className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.16em] text-amber-400"><AudioLines className="h-3.5 w-3.5" aria-hidden="true" /> Dialogue level</label>
                <span className="font-mono text-xs text-amber-100">{Math.round(dialogueLevel * 100)}%</span>
              </div>
              <input id="episode-mix-dialogue-level" type="range" min="0" max="1" step="0.01" value={dialogueLevel} onChange={(event) => setDialogueLevel(Number(event.target.value))} disabled={Boolean(blockingReason) || !episodeScenes.length} className="mt-3 h-2 w-full cursor-pointer accent-amber-400 disabled:cursor-not-allowed disabled:opacity-50" aria-describedby="episode-mix-dialogue-level-help" />
              <div className="mt-2 flex items-center justify-between text-[10px] text-gray-500"><span>Quiet</span><span>Reference level</span><span>Full</span></div>
              <p id="episode-mix-dialogue-level-help" className="mt-3 text-[11px] leading-relaxed text-gray-500">Temporary browser control. This level is never saved to the project.</p>
            </div>

            <div className="rounded-xl border border-[#2b3850] bg-[#0b1019] p-3.5">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="episode-mix-ambience-level" className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.16em] text-amber-400"><Waves className="h-3.5 w-3.5" aria-hidden="true" /> Ambience level</label>
                <span className="font-mono text-xs text-amber-100">{Math.round(ambienceLevel * 100)}%</span>
              </div>
              <input id="episode-mix-ambience-level" type="range" min="0" max="1" step="0.01" value={ambienceLevel} onChange={(event) => setAmbienceLevel(Number(event.target.value))} disabled={Boolean(blockingReason) || !currentEntry?.ambienceAsset} className="mt-3 h-2 w-full cursor-pointer accent-amber-400 disabled:cursor-not-allowed disabled:opacity-50" aria-describedby="episode-mix-ambience-level-help" />
              <div className="mt-2 flex items-center justify-between text-[10px] text-gray-500"><span>Quiet</span><span>Room tone</span><span>Full</span></div>
              <p id="episode-mix-ambience-level-help" className="mt-3 text-[11px] leading-relaxed text-gray-500">{currentEntry?.ambienceAsset ? "The bed loops only for its own scene. This temporary level is never saved." : "Ambience is optional. Choose a scene with a saved bed to adjust its temporary level."}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-[#202b40] bg-[#0a0e16]/70 px-4 py-3 text-[11px] leading-relaxed text-gray-500 sm:px-6">
        <div className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400/80" aria-hidden="true" /><p>This is a local browser proof only. It does not mux, mix, master, caption, download, upload, or save playback settings. A missing visual stops the sequence at that scene, while partial dialogue, silent scenes, absent ambience, and archived earlier-frame clips remain labeled in the ledger.</p></div>
      </div>
    </section>
  );
};
