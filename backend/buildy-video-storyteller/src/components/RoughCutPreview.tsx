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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DialogueAudioAsset,
  DialogueLine,
  DramaManifest,
  DramaScene,
  FrameAsset,
  VideoClip,
  deriveDialogueLines,
  getLegacyDialogueLineId,
} from "@/lib/dramaStudio";

export interface RoughCutPreviewProps {
  manifest: DramaManifest;
  videoClips?: VideoClip[];
  audioAssets?: DialogueAudioAsset[];
  frameAssets?: FrameAsset[];
  isDirty?: boolean;
  isSaving?: boolean;
  isApproving?: boolean;
  isGeneratingFrames?: boolean;
  isPollingMotion?: boolean;
  isSynthesizingVoice?: boolean;
  isGeneratingAmbience?: boolean;
}

type RoughCutTake = {
  line: DialogueLine;
  asset: DialogueAudioAsset;
};

type RoughCutDialogueStatus = "silent" | "complete" | "partial" | "missing";

type RoughCutScene = {
  scene: DramaScene;
  sceneNumber: number;
  lines: DialogueLine[];
  matchedAudio: Array<DialogueAudioAsset | null>;
  takes: RoughCutTake[];
  clip: VideoClip | null;
  currentStoryboardUrl: string | null;
  isArchivedFromEarlierStoryboard: boolean;
  matchedCount: number;
  dialogueStatus: RoughCutDialogueStatus;
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

function formatClock(value: number): string {
  const safeValue = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
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

function dialogueStatusLabel(status: RoughCutDialogueStatus): string {
  if (status === "silent") return "Silent scene";
  if (status === "complete") return "Complete dialogue";
  if (status === "partial") return "Partial dialogue";
  return "Missing dialogue";
}

function dialogueStatusClass(status: RoughCutDialogueStatus): string {
  if (status === "silent") return "border-[#3b4963] bg-[#151d2c] text-gray-300";
  if (status === "complete") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  if (status === "partial") return "border-amber-500/35 bg-amber-500/10 text-amber-200";
  return "border-red-500/30 bg-red-500/10 text-red-200";
}

export const RoughCutPreview: React.FC<RoughCutPreviewProps> = ({
  manifest,
  videoClips = [],
  audioAssets = [],
  frameAssets = [],
  isDirty = false,
  isSaving = false,
  isApproving = false,
  isGeneratingFrames = false,
  isPollingMotion = false,
  isSynthesizingVoice = false,
  isGeneratingAmbience = false,
}) => {
  const roughCutScenes = useMemo<RoughCutScene[]>(() => {
    const safeScenes = Array.isArray(manifest?.scenes) ? manifest.scenes : [];
    const safeClips = Array.isArray(videoClips) ? videoClips : [];
    const safeAudioAssets = Array.isArray(audioAssets) ? audioAssets : [];
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
        const dialogueStatus: RoughCutDialogueStatus =
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
          currentStoryboardUrl,
          isArchivedFromEarlierStoryboard,
          matchedCount,
          dialogueStatus,
          canPlay: Boolean(clip),
        };
      });
  }, [manifest, videoClips, audioAssets, frameAssets]);

  const playableScenes = useMemo(
    () => roughCutScenes.filter((entry) => entry.canPlay),
    [roughCutScenes]
  );
  const missingMotionSceneNumbers = useMemo(
    () => roughCutScenes.filter((entry) => !entry.canPlay).map((entry) => entry.sceneNumber),
    [roughCutScenes]
  );
  const archivedSceneCount = useMemo(
    () => playableScenes.filter((entry) => entry.isArchivedFromEarlierStoryboard).length,
    [playableScenes]
  );
  const completeDialogueCount = useMemo(
    () => roughCutScenes.filter((entry) => entry.dialogueStatus === "complete").length,
    [roughCutScenes]
  );
  const partialDialogueCount = useMemo(
    () => roughCutScenes.filter((entry) => entry.dialogueStatus === "partial").length,
    [roughCutScenes]
  );
  const missingDialogueCount = useMemo(
    () => roughCutScenes.filter((entry) => entry.dialogueStatus === "missing").length,
    [roughCutScenes]
  );
  const silentSceneCount = useMemo(
    () => roughCutScenes.filter((entry) => entry.dialogueStatus === "silent").length,
    [roughCutScenes]
  );
  const roughCutComplete = Boolean(
    roughCutScenes.length > 0 &&
    missingMotionSceneNumbers.length === 0 &&
    partialDialogueCount === 0 &&
    missingDialogueCount === 0
  );
  const totalDuration = useMemo(
    () => playableScenes.reduce((total, entry) => total + getClipDuration(entry.clip), 0),
    [playableScenes]
  );

  const [startSceneNumber, setStartSceneNumber] = useState<number | null>(null);
  const [currentPlayableIndex, setCurrentPlayableIndex] = useState(-1);
  const [currentLineIndex, setCurrentLineIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackComplete, setPlaybackComplete] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [activeVideoDuration, setActiveVideoDuration] = useState(0);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [playbackNotice, setPlaybackNotice] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<RoughCutTake[]>([]);
  const currentLineIndexRef = useRef(0);
  const currentPlayableIndexRef = useRef(-1);
  const isPlayingRef = useRef(false);
  const dialogueFinishedRef = useRef(false);
  const playbackCompleteRef = useRef(false);

  useEffect(() => {
    setStartSceneNumber((current) => {
      if (current !== null && roughCutScenes.some((entry) => entry.sceneNumber === current)) {
        return current;
      }
      return roughCutScenes[0]?.sceneNumber ?? null;
    });
  }, [roughCutScenes]);

  useEffect(() => {
    queueRef.current = playableScenes[currentPlayableIndex]?.takes || [];
  }, [playableScenes, currentPlayableIndex]);

  useEffect(() => {
    if (!playableScenes.length) {
      currentPlayableIndexRef.current = -1;
      setCurrentPlayableIndex(-1);
      return;
    }
    const safeIndex = Math.min(currentPlayableIndexRef.current, playableScenes.length - 1);
    currentPlayableIndexRef.current = safeIndex;
    setCurrentPlayableIndex(safeIndex);
  }, [playableScenes.length]);

  const activeEntry = playableScenes[currentPlayableIndex] || null;
  const activeTake = activeEntry?.takes[currentLineIndex] || null;
  const activeSceneBaseSeconds = useMemo(
    () => playableScenes
      .slice(0, currentPlayableIndex)
      .reduce((total, entry) => total + getClipDuration(entry.clip), 0),
    [playableScenes, currentPlayableIndex]
  );
  const currentSceneElapsed = activeEntry
    ? Math.max(0, Math.min(activeVideoDuration || getClipDuration(activeEntry.clip), elapsedSeconds - activeSceneBaseSeconds))
    : 0;
  const globalProgress = totalDuration > 0
    ? Math.min(100, Math.max(0, (elapsedSeconds / totalDuration) * 100))
    : 0;
  const currentSceneProgress = activeEntry
    ? Math.min(100, Math.max(0, (currentSceneElapsed / getClipDuration(activeEntry.clip)) * 100))
    : 0;
  const selectedScene = roughCutScenes.find((entry) => entry.sceneNumber === startSceneNumber) || null;
  const selectedSceneHasLaterPlayable = Boolean(
    startSceneNumber !== null && playableScenes.some((entry) => entry.sceneNumber >= startSceneNumber)
  );

  const blockingReason = isDirty
    ? "Save screenplay edits before reviewing the saved rough cut."
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
  const playbackBlocked = Boolean(blockingReason);

  const stopMedia = useCallback((clearSources = false) => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (video) {
      video.pause();
      try {
        video.currentTime = 0;
      } catch {
        // The browser can reject a seek while a new source is loading.
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
        // The browser may not expose an audio timeline before metadata loads.
      }
      if (clearSources) {
        audio.removeAttribute("src");
        audio.load();
      }
    }
  }, []);

  const resetPlaybackState = useCallback((notice: string | null = null, clearSources = false) => {
    isPlayingRef.current = false;
    playbackCompleteRef.current = false;
    dialogueFinishedRef.current = false;
    currentLineIndexRef.current = 0;
    stopMedia(clearSources);
    setIsPlaying(false);
    setPlaybackComplete(false);
    setCurrentLineIndex(0);
    setElapsedSeconds(0);
    setActiveVideoDuration(0);
    setPlaybackError(null);
    setPlaybackNotice(notice);
  }, [stopMedia]);

  const resolveStartIndex = useCallback((sceneNumber: number | null): number => {
    if (!playableScenes.length) return -1;
    if (sceneNumber === null) return 0;
    const index = playableScenes.findIndex((entry) => entry.sceneNumber >= sceneNumber);
    return index >= 0 ? index : -1;
  }, [playableScenes]);

  useEffect(() => {
    if (isPlayingRef.current) return;
    const nextIndex = resolveStartIndex(startSceneNumber);
    currentPlayableIndexRef.current = nextIndex;
    setCurrentPlayableIndex(nextIndex);
    currentLineIndexRef.current = 0;
    setCurrentLineIndex(0);
    dialogueFinishedRef.current = false;
    setActiveVideoDuration(0);
    if (nextIndex < 0) stopMedia(true);
  }, [resolveStartIndex, startSceneNumber, stopMedia]);

  const syncMediaSources = useCallback((entry: RoughCutScene | null, takeIndex: number) => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video || !audio) return;

    if (!entry?.clip?.video_url) {
      if (video.getAttribute("src")) {
        video.removeAttribute("src");
        video.load();
      }
      if (audio.getAttribute("src")) {
        audio.removeAttribute("src");
        audio.load();
      }
      return;
    }

    const videoUrl = entry.clip.video_url;
    if (video.getAttribute("src") !== videoUrl) {
      video.setAttribute("src", videoUrl);
      video.load();
    }

    const take = entry.takes[takeIndex] || null;
    const audioUrl = take?.asset.audio_url || null;
    if (audioUrl) {
      if (audio.getAttribute("src") !== audioUrl) {
        audio.setAttribute("src", audioUrl);
        audio.load();
      }
    } else if (audio.getAttribute("src")) {
      audio.removeAttribute("src");
      audio.load();
    }
  }, []);

  const handlePlaybackFailure = useCallback((message: string) => {
    isPlayingRef.current = false;
    setIsPlaying(false);
    videoRef.current?.pause();
    audioRef.current?.pause();
    setPlaybackError(message);
    setPlaybackNotice(null);
  }, []);

  const startCurrentMedia = useCallback(async (
    entry: RoughCutScene | null = activeEntry,
    takeIndex = currentLineIndexRef.current
  ) => {
    if (playbackBlocked || !entry?.clip?.video_url) return;
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video || !audio) return;

    syncMediaSources(entry, takeIndex);
    const currentTake = entry.takes[takeIndex] || null;
    isPlayingRef.current = true;
    setIsPlaying(true);

    const start = async () => {
      if (!isPlayingRef.current || playbackBlocked) return;
      try {
        const starts = [video.play()];
        if (currentTake && !dialogueFinishedRef.current) starts.push(audio.play());
        await Promise.all(starts);
        setPlaybackError(null);
      } catch {
        handlePlaybackFailure("The saved rough cut could not start in this browser. Press Play to retry the saved clip and dialogue.");
      }
    };

    await start();
  }, [activeEntry, handlePlaybackFailure, playbackBlocked, syncMediaSources]);

  useEffect(() => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video || !audio) return;

    queueRef.current = activeEntry?.takes || [];
    syncMediaSources(activeEntry, currentLineIndex);
    setActiveVideoDuration(0);

    if (!activeEntry || !isPlayingRef.current || playbackBlocked) return;

    const startWhenReady = () => {
      if (!isPlayingRef.current || playbackBlocked) return;
      const currentTake = activeEntry.takes[currentLineIndexRef.current] || null;
      const starts = [video.play()];
      if (currentTake && !dialogueFinishedRef.current) starts.push(audio.play());
      void Promise.all(starts)
        .then(() => setPlaybackError(null))
        .catch(() => handlePlaybackFailure("The saved rough cut could not continue in this browser. Press Play to retry the saved media."));
    };

    if (video.readyState >= 2) {
      startWhenReady();
      return;
    }
    video.addEventListener("canplay", startWhenReady, { once: true });
    return () => video.removeEventListener("canplay", startWhenReady);
  }, [activeEntry, currentLineIndex, handlePlaybackFailure, playbackBlocked, syncMediaSources]);

  const roughCutMediaKey = useMemo(
    () => roughCutScenes
      .map((entry) => `${entry.sceneNumber}:${entry.clip?.prediction_id || "missing"}:${entry.clip?.video_url || ""}:${entry.takes.map((take) => `${take.line.line_id}:${take.asset.audio_url}`).join(",")}`)
      .join("|") || "empty",
    [roughCutScenes]
  );

  useEffect(() => {
    resetPlaybackState(null, false);
  }, [roughCutMediaKey, resetPlaybackState]);

  useEffect(() => {
    if (!playbackBlocked) return;
    resetPlaybackState(blockingReason, true);
  }, [blockingReason, playbackBlocked, resetPlaybackState]);

  useEffect(() => {
    return () => {
      isPlayingRef.current = false;
      stopMedia(true);
    };
  }, [stopMedia]);

  const handlePlay = async () => {
    if (playbackBlocked || !playableScenes.length || isPlaying) return;

    setPlaybackError(null);
    setPlaybackNotice(null);

    const wasComplete = playbackCompleteRef.current;
    const startIndexFromSelection = resolveStartIndex(startSceneNumber);
    let targetIndex = wasComplete ? startIndexFromSelection : currentPlayableIndexRef.current;
    let shouldResetLine = wasComplete;

    if (startIndexFromSelection >= 0 && targetIndex !== startIndexFromSelection) {
      targetIndex = startIndexFromSelection;
      shouldResetLine = true;
    }

    if (targetIndex < 0) {
      setPlaybackError(`There is no saved playable clip at or after Scene ${formatScene(startSceneNumber || 1)}.`);
      return;
    }

    const targetEntry = playableScenes[targetIndex] || null;
    if (!targetEntry) {
      setPlaybackError("The rough cut has no saved playable motion clip yet.");
      return;
    }

    const indexChanged = targetIndex !== currentPlayableIndexRef.current;
    const shouldResetDialogue = indexChanged || shouldResetLine || wasComplete;
    const targetLineIndex = shouldResetLine
      ? 0
      : Math.min(currentLineIndexRef.current, Math.max(targetEntry.takes.length - 1, 0));
    const targetBaseSeconds = playableScenes
      .slice(0, targetIndex)
      .reduce((total, entry) => total + getClipDuration(entry.clip), 0);

    currentPlayableIndexRef.current = targetIndex;
    currentLineIndexRef.current = targetLineIndex;
    if (shouldResetDialogue) dialogueFinishedRef.current = false;
    playbackCompleteRef.current = false;
    setCurrentPlayableIndex(targetIndex);
    setCurrentLineIndex(targetLineIndex);
    setPlaybackComplete(false);
    if (indexChanged || shouldResetLine || wasComplete) {
      setElapsedSeconds(targetBaseSeconds);
      setActiveVideoDuration(0);
    }
    if (startSceneNumber !== null && targetEntry.sceneNumber !== startSceneNumber) {
      setPlaybackNotice(`Scene ${formatScene(startSceneNumber)} has no saved motion. Starting at the next playable scene.`);
    }

    await startCurrentMedia(targetEntry, targetLineIndex);
  };

  const handlePause = () => {
    videoRef.current?.pause();
    audioRef.current?.pause();
    isPlayingRef.current = false;
    setIsPlaying(false);
    setPlaybackNotice("Paused. Press Play to continue from this shot.");
  };

  const resetToStart = (notice: string) => {
    const targetIndex = resolveStartIndex(startSceneNumber);
    if (targetIndex < 0) {
      currentPlayableIndexRef.current = -1;
      setCurrentPlayableIndex(-1);
      resetPlaybackState(notice, true);
      return;
    }
    currentPlayableIndexRef.current = targetIndex;
    currentLineIndexRef.current = 0;
    dialogueFinishedRef.current = false;
    playbackCompleteRef.current = false;
    resetPlaybackState(notice, false);
    setCurrentPlayableIndex(targetIndex);
    setPlaybackComplete(false);
    setElapsedSeconds(
      playableScenes
        .slice(0, targetIndex)
        .reduce((total, entry) => total + getClipDuration(entry.clip), 0)
    );
  };

  const handleRestart = () => {
    if (playbackBlocked || !playableScenes.length) return;
    resetToStart("Restarted at the selected starting scene. Press Play when you are ready.");
  };

  const handleStop = () => {
    if (playbackBlocked || !playableScenes.length) return;
    resetToStart("Stopped. The rough cut is ready to play again from the selected starting scene.");
  };

  const handleStartSceneChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const nextSceneNumber = Number(event.target.value);
    if (!Number.isInteger(nextSceneNumber)) return;
    const nextIndex = resolveStartIndex(nextSceneNumber);
    isPlayingRef.current = false;
    playbackCompleteRef.current = false;
    currentLineIndexRef.current = 0;
    dialogueFinishedRef.current = false;
    stopMedia(true);
    setIsPlaying(false);
    setPlaybackComplete(false);
    setStartSceneNumber(nextSceneNumber);
    currentPlayableIndexRef.current = nextIndex;
    setCurrentPlayableIndex(nextIndex);
    setCurrentLineIndex(0);
    setElapsedSeconds(nextIndex >= 0
      ? playableScenes.slice(0, nextIndex).reduce((total, entry) => total + getClipDuration(entry.clip), 0)
      : 0);
    setActiveVideoDuration(0);
    setPlaybackError(null);
    setPlaybackNotice(
      nextIndex < 0
        ? `Scene ${formatScene(nextSceneNumber)} has no saved motion, and no later playable scene is available.`
        : playableScenes[nextIndex]?.sceneNumber !== nextSceneNumber
          ? `Scene ${formatScene(nextSceneNumber)} has no saved motion. Playback will begin at the next playable scene.`
          : null
    );
  };

  const handleAudioEnded = () => {
    if (!isPlayingRef.current) return;
    const queue = queueRef.current;
    const nextIndex = currentLineIndexRef.current + 1;
    if (nextIndex < queue.length) {
      currentLineIndexRef.current = nextIndex;
      setCurrentLineIndex(nextIndex);
      setPlaybackNotice(null);
      return;
    }
    dialogueFinishedRef.current = true;
    setPlaybackNotice("Saved dialogue for this shot is complete. The muted clip will continue to its cut.");
  };

  const handleVideoEnded = () => {
    if (!isPlayingRef.current) return;
    const finishedEntry = activeEntry;
    const dialogueStoppedAtBoundary = Boolean(
      finishedEntry?.takes.length && !dialogueFinishedRef.current
    );
    const nextIndex = currentPlayableIndexRef.current + 1;

    if (nextIndex < playableScenes.length) {
      const continuePlayback = isPlayingRef.current;
      isPlayingRef.current = continuePlayback;
      stopMedia(false);
      currentPlayableIndexRef.current = nextIndex;
      currentLineIndexRef.current = 0;
      dialogueFinishedRef.current = false;
      setCurrentPlayableIndex(nextIndex);
      setCurrentLineIndex(0);
      setElapsedSeconds(activeSceneBaseSeconds + getClipDuration(finishedEntry?.clip || null));
      setActiveVideoDuration(0);
      setPlaybackNotice(
        dialogueStoppedAtBoundary
          ? `Scene ${formatScene(finishedEntry?.sceneNumber || 0)} reached its five-second cut. Rough-cut shot timing stopped the remaining dialogue.`
          : `Scene ${formatScene(finishedEntry?.sceneNumber || 0)} finished. Cutting to the next saved scene.`
      );
      setIsPlaying(continuePlayback);
      return;
    }

    stopMedia(false);
    isPlayingRef.current = false;
    playbackCompleteRef.current = true;
    setIsPlaying(false);
    setPlaybackComplete(true);
    setElapsedSeconds(totalDuration);
    setActiveVideoDuration(0);
    setPlaybackNotice(
      dialogueStoppedAtBoundary
        ? `Scene ${formatScene(finishedEntry?.sceneNumber || 0)} reached its five-second cut. Rough-cut shot timing stopped the remaining dialogue.`
        : roughCutComplete
          ? "Rough cut complete. All saved playable scenes have finished."
          : "Saved playable scenes finished. Coverage remains incomplete, so review the missing motion or dialogue above."
    );
  };

  const handleVideoTimeUpdate = (event: React.SyntheticEvent<HTMLVideoElement>) => {
    const currentTime = event.currentTarget.currentTime;
    if (!Number.isFinite(currentTime)) return;
    const maxCurrent = getClipDuration(activeEntry?.clip || null);
    setElapsedSeconds(Math.min(totalDuration, activeSceneBaseSeconds + Math.max(0, Math.min(currentTime, maxCurrent))));
  };

  const handleVideoMetadata = (event: React.SyntheticEvent<HTMLVideoElement>) => {
    const duration = event.currentTarget.duration;
    if (Number.isFinite(duration) && duration > 0) setActiveVideoDuration(duration);
  };

  const handleVideoError = () => {
    setPlaybackError("The saved motion clip could not load in this browser. Press Play to retry the rough cut.");
    if (isPlayingRef.current) handlePlaybackFailure("The saved motion clip could not play in this browser. Press Play to retry the rough cut.");
  };

  const handleAudioError = () => {
    setPlaybackError("The saved dialogue could not load in this browser. Press Play to retry the rough cut.");
    if (isPlayingRef.current) handlePlaybackFailure("The saved dialogue could not play in this browser. Press Play to retry the rough cut.");
  };

  const activeMissingLines = activeEntry?.lines.filter((_, index) => !activeEntry.matchedAudio[index]) || [];
  const currentLineStatus = playbackComplete
    ? "Rough cut complete"
    : dialogueFinishedRef.current
      ? "Dialogue complete"
      : isPlaying
        ? "Playing saved take"
        : activeTake
          ? "Ready to play"
          : activeEntry?.dialogueStatus === "silent"
            ? "Silent shot"
            : "No saved take selected";
  const currentStatusText = playbackError || playbackNotice || (
    playbackBlocked
      ? blockingReason
      : playableScenes.length
        ? "Press Play to start the muted clip and its saved dialogue from the selected scene."
        : "Save a READY motion clip before starting a rough cut."
  );

  return (
    <section
      className="overflow-hidden rounded-2xl border border-amber-500/35 bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,0.15),transparent_42%),#101722] shadow-xl shadow-black/20"
      aria-labelledby="rough-cut-preview-title"
    >
      <div className="border-b border-amber-500/20 px-4 py-5 sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs font-mono uppercase tracking-[0.18em] text-amber-300">
              <Film className="h-4 w-4" aria-hidden="true" /> Rough Cut / browser review
              <span className="rounded-md border border-[#46536b] bg-[#0c111b] px-2 py-1 text-[10px] tracking-wider text-gray-300">Read only</span>
              <span className="rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2 py-1 text-[10px] tracking-wider text-emerald-200">Saved media only</span>
            </div>
            <h2 id="rough-cut-preview-title" className="text-2xl font-serif font-bold tracking-tight text-white sm:text-3xl">Review the episode as a rough cut.</h2>
            <p className="max-w-2xl text-sm leading-relaxed text-gray-300">
              This temporary browser player cuts saved vertical scene clips together in screenplay order and follows the dialogue takes that exist today. It does not save, export, regenerate, or replace any project media.
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-2 rounded-xl border border-[#33415d] bg-[#0b1019]/85 p-3 text-xs sm:min-w-[230px]">
            <span className={`inline-flex items-center gap-1.5 self-start rounded-md border px-2 py-1 font-mono uppercase tracking-wider ${roughCutComplete ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-amber-500/35 bg-amber-500/10 text-amber-200"}`}>
              {roughCutComplete ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
              {roughCutComplete ? "Coverage complete" : "Coverage incomplete"}
            </span>
            <p className="leading-relaxed text-gray-400">
              {roughCutComplete
                ? "Every screenplay scene has a playable clip and every spoken line has an exact saved take."
                : "Review the gaps below before treating this as a complete episode."}
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 border-b border-[#242f45] bg-[#0d131e]/80 px-4 py-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-6">
        <div className="rounded-xl border border-[#2b3850] bg-[#0b1019] p-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-gray-500">Playable clips</p>
          <p className="mt-1 text-xl font-semibold text-emerald-200">{playableScenes.length}/{roughCutScenes.length}</p>
          <p className="mt-1 text-[10px] leading-relaxed text-gray-500">Scenes in the cut</p>
        </div>
        <div className={`rounded-xl border p-3 ${missingMotionSceneNumbers.length ? "border-red-500/30 bg-red-950/20" : "border-[#2b3850] bg-[#0b1019]"}`}>
          <p className="font-mono text-[10px] uppercase tracking-wider text-gray-500">Motion missing</p>
          <p className={`mt-1 text-xl font-semibold ${missingMotionSceneNumbers.length ? "text-red-200" : "text-gray-300"}`}>{missingMotionSceneNumbers.length}</p>
          <p className="mt-1 text-[10px] leading-relaxed text-gray-500">{missingMotionSceneNumbers.length ? missingMotionSceneNumbers.map(formatScene).join(", ") : "Every scene has a clip"}</p>
        </div>
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-950/10 p-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-gray-500">Dialogue complete</p>
          <p className="mt-1 text-xl font-semibold text-emerald-200">{completeDialogueCount}</p>
          <p className="mt-1 text-[10px] leading-relaxed text-gray-500">Exact saved line takes</p>
        </div>
        <div className="rounded-xl border border-[#2b3850] bg-[#0b1019] p-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-gray-500">Silent scenes</p>
          <p className="mt-1 text-xl font-semibold text-gray-300">{silentSceneCount}</p>
          <p className="mt-1 text-[10px] leading-relaxed text-gray-500">No spoken lines in screenplay</p>
        </div>
        <div className={`rounded-xl border p-3 ${partialDialogueCount || missingDialogueCount ? "border-amber-500/30 bg-amber-950/15" : "border-[#2b3850] bg-[#0b1019]"}`}>
          <p className="font-mono text-[10px] uppercase tracking-wider text-gray-500">Dialogue gaps</p>
          <p className={`mt-1 text-xl font-semibold ${partialDialogueCount || missingDialogueCount ? "text-amber-200" : "text-gray-300"}`}>{partialDialogueCount + missingDialogueCount}</p>
          <p className="mt-1 text-[10px] leading-relaxed text-gray-500">{partialDialogueCount} partial · {missingDialogueCount} missing</p>
        </div>
        <div className="rounded-xl border border-emerald-700/30 bg-emerald-950/10 p-3 sm:col-span-2 lg:col-span-1">
          <p className="font-mono text-[10px] uppercase tracking-wider text-gray-500">Earlier-frame archive</p>
          <p className="mt-1 text-xl font-semibold text-emerald-200">{archivedSceneCount}</p>
          <p className="mt-1 text-[10px] leading-relaxed text-gray-500">Recovered clips retained</p>
        </div>
      </div>

      <div className="grid gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[minmax(0,0.78fr)_minmax(290px,1.22fr)]">
        <div className="space-y-4">
          <div className="rounded-xl border border-[#2b3850] bg-[#0b1019] p-4">
            <div className="flex items-start gap-3">
              <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-2 text-amber-300">
                <Info className="h-4 w-4" aria-hidden="true" />
              </div>
              <div className="space-y-1.5 text-xs leading-relaxed text-gray-400">
                <p className="font-semibold text-gray-200">Temporary hard-cut review</p>
                <p>Each shot runs for its saved five-second motion duration. Dialogue advances line by line and stops at the shot boundary when a take runs long. The player keeps the cut local to this browser session.</p>
              </div>
            </div>
          </div>

          <label htmlFor="rough-cut-start-scene" className="block space-y-1.5 text-xs text-gray-300">
            <span className="font-mono uppercase tracking-wider text-gray-400">Start from scene</span>
            <select
              id="rough-cut-start-scene"
              value={startSceneNumber ?? ""}
              onChange={handleStartSceneChange}
              disabled={!roughCutScenes.length || playbackBlocked || isPlaying}
              className="h-11 w-full rounded-lg border border-[#33415d] bg-[#0b1019] px-3 text-sm text-gray-100 outline-none transition-colors focus:border-amber-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="" disabled>{roughCutScenes.length ? "Choose a screenplay scene" : "No screenplay scenes available"}</option>
              {roughCutScenes.map((entry) => (
                <option key={entry.sceneNumber} value={entry.sceneNumber}>
                  Scene {formatScene(entry.sceneNumber)} · {entry.canPlay ? "Playable" : "Motion missing"}{entry.isArchivedFromEarlierStoryboard ? " · Earlier frame" : ""}
                </option>
              ))}
            </select>
            {selectedScene && !selectedScene.canPlay && (
              <span className="block text-[11px] leading-relaxed text-amber-200/80">
                {selectedSceneHasLaterPlayable
                  ? "This scene stays visible in coverage. Play begins at the next saved playable scene."
                  : "This scene stays visible in coverage, but no later playable scene is saved yet."}
              </span>
            )}
          </label>

          <div className="rounded-xl border border-[#2b3850] bg-[#0b1019] p-4" aria-labelledby="rough-cut-coverage-title">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-amber-300">
                <Film className="h-3.5 w-3.5" aria-hidden="true" /> <span id="rough-cut-coverage-title">Scene coverage</span>
              </div>
              <span className="text-[10px] text-gray-500">{roughCutScenes.length} screenplay scenes</span>
            </div>
            <div className="mt-3 space-y-2">
              {roughCutScenes.length ? roughCutScenes.map((entry) => (
                <div key={entry.sceneNumber} className={`rounded-lg border p-3 ${entry.canPlay ? "border-[#29364e] bg-[#111827]" : "border-red-700/35 bg-red-950/15"}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {entry.canPlay ? <CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden="true" /> : <AlertTriangle className="h-4 w-4 text-red-400" aria-hidden="true" />}
                      <span className="font-mono text-[11px] uppercase tracking-wider text-gray-200">Scene {formatScene(entry.sceneNumber)}</span>
                      {entry.isArchivedFromEarlierStoryboard && <span className="rounded-md border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider text-emerald-200">Earlier frame</span>}
                    </div>
                    <span className={`rounded-md border px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider ${entry.canPlay ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-200" : "border-red-500/30 bg-red-500/10 text-red-200"}`}>
                      {entry.canPlay ? "Clip ready" : "Motion missing"}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-gray-500">
                    <span className={`rounded-md border px-1.5 py-0.5 ${dialogueStatusClass(entry.dialogueStatus)}`}>{dialogueStatusLabel(entry.dialogueStatus)}</span>
                    {entry.dialogueStatus === "partial" && <span>{entry.matchedCount}/{entry.lines.length} lines saved</span>}
                    {entry.dialogueStatus === "missing" && <span>{entry.lines.length} lines need exact takes</span>}
                    {entry.dialogueStatus === "silent" && <span>Muted clip continues without dialogue</span>}
                  </div>
                </div>
              )) : (
                <p className="rounded-lg border border-dashed border-[#33415d] px-3 py-3 text-xs leading-relaxed text-gray-500">The saved screenplay has no scenes to assemble yet.</p>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-amber-400">Muted vertical player</p>
              <p className="mt-1 text-sm font-semibold text-white" aria-live="polite">
                {activeEntry ? `Scene ${formatScene(activeEntry.sceneNumber)} of ${playableScenes.length} playable` : "Choose a saved clip"}
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-md border border-[#33415d] bg-[#0b1019] px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-gray-400"><VolumeX className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" /> Muted video</span>
          </div>

          {activeEntry?.clip?.video_url ? (
            <div className="relative overflow-hidden rounded-2xl border border-[#2b3850] bg-[#080b11] p-2 shadow-lg shadow-black/20">
              <video
                ref={videoRef}
                className="mx-auto aspect-[9/16] max-h-[590px] w-full max-w-[350px] rounded-xl bg-black object-contain"
                src={activeEntry.clip.video_url}
                muted
                playsInline
                preload="metadata"
                onLoadedMetadata={handleVideoMetadata}
                onTimeUpdate={handleVideoTimeUpdate}
                onEnded={handleVideoEnded}
                onError={handleVideoError}
                aria-label={`Muted rough cut Scene ${activeEntry.sceneNumber} motion clip`}
              />
              {activeEntry.isArchivedFromEarlierStoryboard && (
                <span className="absolute left-4 top-4 rounded-md border border-emerald-500/35 bg-emerald-950/85 px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-emerald-200 backdrop-blur-sm">Archived · earlier frame</span>
              )}
            </div>
          ) : (
            <div className="flex aspect-[9/16] min-h-[300px] items-center justify-center rounded-2xl border border-dashed border-[#33415d] bg-[#0b1019] p-6 text-center">
              <div className="max-w-[230px] space-y-3">
                <Film className="mx-auto h-9 w-9 text-gray-600" aria-hidden="true" />
                <p className="text-sm font-semibold text-gray-300">No playable scene selected</p>
                <p className="text-xs leading-relaxed text-gray-500">Choose a scene with a saved READY motion clip. Missing scenes remain listed in coverage.</p>
              </div>
            </div>
          )}

          <audio
            ref={audioRef}
            preload="auto"
            onEnded={handleAudioEnded}
            onError={handleAudioError}
            aria-label="Saved dialogue for the current rough-cut scene"
            className="sr-only"
          />

          {activeEntry && (
            <div className="rounded-xl border border-[#2b3850] bg-[#0b1019] p-3.5" aria-live="polite">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-amber-400">Current line</p>
                <span className={`text-[10px] ${isPlaying ? "text-emerald-300" : activeEntry.dialogueStatus === "missing" ? "text-red-300" : "text-gray-500"}`}>{currentLineStatus}</span>
              </div>
              {activeTake ? (
                <>
                  <p className="mt-2 font-mono text-[11px] uppercase tracking-wider text-gray-300">Line {String(activeTake.line.order).padStart(2, "0")} of {String(activeEntry.lines.length).padStart(2, "0")} · {activeTake.line.character_id}</p>
                  <p className="mt-2 text-sm leading-relaxed text-amber-100/90">“{activeTake.line.text}”</p>
                </>
              ) : activeEntry.dialogueStatus === "silent" ? (
                <p className="mt-2 text-xs leading-relaxed text-gray-500">Silent scene. The muted clip will run without a dialogue track.</p>
              ) : (
                <p className="mt-2 text-xs leading-relaxed text-gray-500">No exact saved dialogue take is available for the current scene. The clip can still play muted.</p>
              )}
              {activeMissingLines.length > 0 && (
                <p className="mt-3 border-t border-[#253047] pt-3 text-[11px] leading-relaxed text-amber-100/70">Missing exact takes: {activeMissingLines.map((line) => `Line ${String(line.order).padStart(2, "0")}`).join(", ")}. The rough cut skips those lines.</p>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-amber-500/20 bg-[#0d131e]/85 px-4 py-4 sm:px-6">
        {playbackBlocked && (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-700/35 bg-amber-950/20 p-3 text-xs text-amber-100/85" role="status">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden="true" />
            <span>{blockingReason}</span>
          </div>
        )}
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-gray-400"><Clock3 className="h-4 w-4 text-amber-400" aria-hidden="true" /><span aria-live="polite">{formatClock(elapsedSeconds)} / {formatClock(totalDuration)}</span></div>
            <span className="text-[11px] text-gray-500">{activeEntry ? `${formatClock(currentSceneElapsed)} / ${formatClock(getClipDuration(activeEntry.clip))} in Scene ${formatScene(activeEntry.sceneNumber)}` : "No shot selected"}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[#202a3d]" aria-label="Rough cut progress" role="progressbar" aria-valuemin={0} aria-valuemax={totalDuration || 0} aria-valuenow={Math.min(elapsedSeconds, totalDuration || elapsedSeconds)}>
            <div className="h-full rounded-full bg-amber-400 transition-[width] duration-150" style={{ width: `${globalProgress}%` }} />
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-[#202a3d]" aria-label="Current scene progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={currentSceneProgress}>
            <div className="h-full rounded-full bg-emerald-400/80 transition-[width] duration-150" style={{ width: `${currentSceneProgress}%` }} />
          </div>
          <div className="flex flex-wrap gap-2" aria-label="Rough cut playback controls">
            <Button type="button" onClick={() => void handlePlay()} disabled={playbackBlocked || !playableScenes.length || isPlaying} className="h-10 gap-2 bg-amber-500 px-4 text-xs font-semibold text-black hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"><Play className="h-3.5 w-3.5" aria-hidden="true" /> Play</Button>
            <Button type="button" onClick={handlePause} disabled={playbackBlocked || !isPlaying} variant="outline" className="h-10 gap-2 border-[#3b4963] bg-[#151e2e] px-4 text-xs text-gray-200 hover:border-amber-500/50 hover:bg-[#1c2940] disabled:cursor-not-allowed disabled:opacity-50"><Pause className="h-3.5 w-3.5" aria-hidden="true" /> Pause</Button>
            <Button type="button" onClick={handleRestart} disabled={playbackBlocked || !playableScenes.length} variant="outline" className="h-10 gap-2 border-[#3b4963] bg-[#151e2e] px-4 text-xs text-gray-200 hover:border-amber-500/50 hover:bg-[#1c2940] disabled:cursor-not-allowed disabled:opacity-50"><RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Restart</Button>
            <Button type="button" onClick={handleStop} disabled={playbackBlocked || !playableScenes.length} variant="outline" className="h-10 gap-2 border-[#3b4963] bg-[#151e2e] px-4 text-xs text-gray-200 hover:border-red-500/50 hover:bg-red-950/20 disabled:cursor-not-allowed disabled:opacity-50"><Square className="h-3.5 w-3.5" aria-hidden="true" /> Stop</Button>
          </div>
          <p className={`text-xs leading-relaxed ${playbackError ? "text-red-300" : playbackNotice || playbackBlocked ? "text-amber-200/85" : "text-gray-500"}`} role={playbackError ? "alert" : "status"} aria-live="polite">{currentStatusText}</p>
        </div>
      </div>

      <div className="border-t border-[#202b40] bg-[#0a0e16]/70 px-4 py-3 text-[11px] leading-relaxed text-gray-500 sm:px-6">
        <div className="flex items-start gap-2"><AudioLines className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400/80" aria-hidden="true" /><p>Audio is paired only when its saved scene number, current line ID or legacy fallback, character, text, and secure MP3 all match. Silent and partial scenes remain visible so this review never implies coverage that does not exist.</p></div>
      </div>
    </section>
  );
};
