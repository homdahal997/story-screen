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

export interface SceneTimingProofProps {
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

type TimingTake = {
  line: DialogueLine;
  asset: DialogueAudioAsset;
};

type TimingScene = {
  scene: DramaScene;
  sceneNumber: number;
  lines: DialogueLine[];
  matchedAudio: Array<DialogueAudioAsset | null>;
  takes: TimingTake[];
  clip: VideoClip | null;
  currentStoryboardUrl: string | null;
  isArchivedFromEarlierStoryboard: boolean;
  matchedCount: number;
  hasCompleteCoverage: boolean;
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

function lineCountLabel(value: number): string {
  return `${value} ${value === 1 ? "line" : "lines"}`;
}

export const SceneTimingProof: React.FC<SceneTimingProofProps> = ({
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
  const timingScenes = useMemo<TimingScene[]>(() => {
    const safeScenes = Array.isArray(manifest?.scenes) ? manifest.scenes : [];
    const safeClips = Array.isArray(videoClips) ? videoClips : [];
    const safeAudioAssets = Array.isArray(audioAssets) ? audioAssets : [];
    const safeFrameAssets = Array.isArray(frameAssets) ? frameAssets : [];

    return safeScenes.map((scene) => {
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
      const hasCompleteCoverage = lines.length > 0 && matchedCount === lines.length;

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
        hasCompleteCoverage,
        canPlay: Boolean(clip && matchedCount > 0),
      };
    });
  }, [manifest, videoClips, audioAssets, frameAssets]);

  const playableSceneCount = timingScenes.filter((entry) => entry.canPlay).length;
  const [selectedSceneNumber, setSelectedSceneNumber] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentLineIndex, setCurrentLineIndex] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [playbackNotice, setPlaybackNotice] = useState<string | null>(null);
  const [dialogueFinished, setDialogueFinished] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<TimingTake[]>([]);
  const currentLineIndexRef = useRef(0);
  const isPlayingRef = useRef(false);
  const dialogueFinishedRef = useRef(false);

  useEffect(() => {
    setSelectedSceneNumber((current) => {
      if (current !== null && timingScenes.some((entry) => entry.sceneNumber === current)) {
        return current;
      }
      return timingScenes.find((entry) => entry.canPlay)?.sceneNumber ?? timingScenes[0]?.sceneNumber ?? null;
    });
  }, [timingScenes]);

  const selectedEntry = useMemo(
    () => timingScenes.find((entry) => entry.sceneNumber === selectedSceneNumber) || null,
    [timingScenes, selectedSceneNumber]
  );
  const playbackQueue = useMemo<TimingTake[]>(
    () => selectedEntry?.takes || [],
    [selectedEntry]
  );
  const currentTake = playbackQueue[currentLineIndex] || null;
  const totalSeconds = Number.isFinite(videoDuration) && videoDuration > 0
    ? videoDuration
    : selectedEntry?.clip?.duration_seconds || 0;
  const playbackProgress = totalSeconds > 0
    ? Math.min(100, Math.max(0, (elapsedSeconds / totalSeconds) * 100))
    : 0;
  const selectedMediaKey = selectedEntry
    ? `${selectedEntry.sceneNumber}:${selectedEntry.clip?.prediction_id || "no-clip"}:${selectedEntry.clip?.video_url || ""}:${playbackQueue.map((take) => `${take.line.line_id}:${take.asset.audio_url}`).join("|")}`
    : "no-scene";

  const blockingReason = isDirty
    ? "Save screenplay edits before testing the saved media."
    : isSaving
      ? "Playback is paused while the project is saving."
      : isApproving
        ? "Playback is unavailable while approval is being recorded."
        : isGeneratingFrames
          ? "Playback is unavailable while Visual Production is generating frames."
          : isPollingMotion
            ? "Playback is unavailable while a motion test is being checked."
            : isSynthesizingVoice
              ? "Playback is unavailable while a voice take is being synthesized."
              : isGeneratingAmbience
                ? "Playback is unavailable while the selected ambience bed is being generated."
                : null;
  const sceneMediaReady = Boolean(selectedEntry?.canPlay);
  const playbackDisabled = Boolean(blockingReason || !sceneMediaReady);
  const currentAudioAsset = currentTake?.asset || null;

  useEffect(() => {
    queueRef.current = playbackQueue;
  }, [playbackQueue]);

  const resetMedia = useCallback(() => {
    const video = videoRef.current;
    const audio = audioRef.current;
    const firstTake = queueRef.current[0] || null;

    isPlayingRef.current = false;
    dialogueFinishedRef.current = false;
    currentLineIndexRef.current = 0;

    if (video) {
      video.pause();
      try {
        video.currentTime = 0;
      } catch {
        // A media source can briefly reject a seek while it is being replaced.
      }
    }
    if (audio) {
      audio.pause();
      if (firstTake && audio.currentSrc !== firstTake.asset.audio_url) {
        audio.src = firstTake.asset.audio_url;
        audio.load();
      }
      try {
        audio.currentTime = 0;
      } catch {
        // The browser may not expose a seekable audio timeline before metadata loads.
      }
    }

    setIsPlaying(false);
    setCurrentLineIndex(0);
    setElapsedSeconds(0);
    setVideoDuration(0);
    setPlaybackError(null);
    setPlaybackNotice(null);
    setDialogueFinished(false);
  }, []);

  useEffect(() => {
    resetMedia();
  }, [resetMedia, selectedMediaKey]);

  useEffect(() => {
    if (blockingReason) {
      resetMedia();
    }
  }, [blockingReason, resetMedia]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentAudioAsset) return;
    audio.load();
    if (isPlayingRef.current && !dialogueFinishedRef.current) {
      void audio.play().catch(() => {
        isPlayingRef.current = false;
        setIsPlaying(false);
        videoRef.current?.pause();
        audio.pause();
        setPlaybackError("The saved dialogue could not continue in this browser. Press Play to retry.");
      });
    }
  }, [currentAudioAsset?.audio_url]);

  const handlePlaybackFailure = (message: string) => {
    isPlayingRef.current = false;
    setIsPlaying(false);
    videoRef.current?.pause();
    audioRef.current?.pause();
    setPlaybackError(message);
  };

  const handlePlay = async () => {
    if (playbackDisabled || !selectedEntry?.clip || !videoRef.current || !audioRef.current) return;

    const video = videoRef.current;
    const audio = audioRef.current;
    const queue = queueRef.current.length ? queueRef.current : playbackQueue;
    if (!queue.length) return;
    queueRef.current = queue;

    setPlaybackError(null);
    setPlaybackNotice(null);

    if (video.ended) {
      resetMedia();
      const firstTake = queue[0];
      if (firstTake) {
        audio.src = firstTake.asset.audio_url;
        audio.load();
      }
    }

    const activeTake = queue[currentLineIndexRef.current] || queue[0];
    if (!activeTake) return;
    if (!audio.currentSrc || audio.currentSrc !== activeTake.asset.audio_url) {
      audio.src = activeTake.asset.audio_url;
      audio.load();
    }

    isPlayingRef.current = true;
    setIsPlaying(true);

    try {
      const videoStart = video.play();
      const audioStart = dialogueFinishedRef.current ? Promise.resolve() : audio.play();
      await Promise.all([videoStart, audioStart]);
    } catch {
      handlePlaybackFailure("This scene could not start in the browser. Press Play to retry the saved clip and dialogue.");
    }
  };

  const handlePause = () => {
    videoRef.current?.pause();
    audioRef.current?.pause();
    isPlayingRef.current = false;
    setIsPlaying(false);
    setPlaybackNotice("Paused. Press Play to continue from this point.");
  };

  const handleRestart = () => {
    resetMedia();
    setPlaybackNotice("Restarted at the beginning of the scene.");
  };

  const handleStop = () => {
    resetMedia();
    setPlaybackNotice("Stopped. Press Play to run the timing proof again.");
  };

  const handleVideoEnded = () => {
    resetMedia();
    setPlaybackNotice("Scene finished. Press Play to hear the saved timing proof again.");
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
    setDialogueFinished(true);
    setPlaybackNotice("All saved dialogue takes have finished. The muted clip will continue to its end.");
  };

  const handleSceneChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const nextSceneNumber = Number(event.target.value);
    if (!Number.isInteger(nextSceneNumber)) return;
    resetMedia();
    setSelectedSceneNumber(nextSceneNumber);
  };

  const handleVideoTimeUpdate = (event: React.SyntheticEvent<HTMLVideoElement>) => {
    const currentTime = event.currentTarget.currentTime;
    if (Number.isFinite(currentTime)) setElapsedSeconds(Math.max(0, currentTime));
  };

  const handleVideoMetadata = (event: React.SyntheticEvent<HTMLVideoElement>) => {
    const duration = event.currentTarget.duration;
    if (Number.isFinite(duration) && duration > 0) {
      setVideoDuration(duration);
    }
  };

  const handleVideoError = () => {
    if (isPlayingRef.current) {
      handlePlaybackFailure("The saved motion clip could not play in this browser. Press Play to retry or open it in Video & Motion.");
    } else {
      setPlaybackError("The saved motion clip could not load in this browser. Press Play to retry or open it in Video & Motion.");
    }
  };

  const handleAudioError = () => {
    if (isPlayingRef.current) {
      handlePlaybackFailure("The saved dialogue could not load in this browser. Press Play to retry the timing proof.");
    } else {
      setPlaybackError("The saved dialogue could not load in this browser. Press Play to retry the timing proof.");
    }
  };

  const selectedLines = selectedEntry?.lines || [];
  const selectedMatchedCount = selectedEntry?.matchedCount || 0;
  const missingLines = selectedEntry?.lines.filter((_, index) => !selectedEntry.matchedAudio[index]) || [];
  const selectedCoverageLabel = selectedEntry
    ? selectedEntry.hasCompleteCoverage
      ? `Complete coverage · ${lineCountLabel(selectedMatchedCount)}`
      : selectedMatchedCount > 0
        ? `Partial coverage · ${selectedMatchedCount}/${selectedEntry.lines.length} lines`
        : "No exact saved takes"
    : "Choose a scene";
  const currentLineStatus = dialogueFinished
    ? "Dialogue takes complete"
    : isPlaying
      ? "Playing saved take"
      : currentTake
        ? "Ready to play"
        : "No saved take selected";

  return (
    <section
      className="overflow-hidden rounded-2xl border border-[#d6a84a]/35 bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,0.13),transparent_42%),#101722] shadow-xl shadow-black/20"
      aria-labelledby="scene-timing-proof-title"
    >
      <div className="border-b border-amber-500/20 px-4 py-5 sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs font-mono uppercase tracking-[0.18em] text-amber-300">
              <Film className="h-4 w-4" aria-hidden="true" /> Scene timing proof
              <span className="rounded-md border border-[#46536b] bg-[#0c111b] px-2 py-1 text-[10px] tracking-wider text-gray-300">
                Read only
              </span>
              <span className="rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2 py-1 text-[10px] tracking-wider text-emerald-200">
                Saved media only
              </span>
            </div>
            <h2 id="scene-timing-proof-title" className="text-2xl font-serif font-bold tracking-tight text-white sm:text-3xl">
              Hear one scene against its motion.
            </h2>
            <p className="max-w-2xl text-sm leading-relaxed text-gray-300">
              This local proof pairs one saved vertical clip with the exact saved dialogue takes for that scene. It checks order and pacing before any multi-scene assembly. Nothing here regenerates, uploads, or changes the screenplay.
            </p>
          </div>
          <div className="grid shrink-0 grid-cols-2 gap-2 text-xs sm:min-w-[230px]">
            <div className="rounded-xl border border-[#33415d] bg-[#0b1019]/80 p-3">
              <p className="font-mono uppercase tracking-wider text-gray-500">Ready scenes</p>
              <p className="mt-1 text-lg font-semibold text-emerald-200">{playableSceneCount}</p>
              <p className="mt-1 text-[10px] leading-relaxed text-gray-500">Clip plus one saved take</p>
            </div>
            <div className="rounded-xl border border-[#33415d] bg-[#0b1019]/80 p-3">
              <p className="font-mono uppercase tracking-wider text-gray-500">Output</p>
              <p className="mt-1 text-lg font-semibold text-amber-200">Local</p>
              <p className="mt-1 text-[10px] leading-relaxed text-gray-500">No new project record</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[minmax(0,0.88fr)_minmax(260px,0.72fr)]">
        <div className="space-y-4">
          <label htmlFor="scene-timing-proof-scene" className="block space-y-1.5 text-xs text-gray-300">
            <span className="font-mono uppercase tracking-wider text-gray-400">Scene to test</span>
            <select
              id="scene-timing-proof-scene"
              value={selectedSceneNumber ?? ""}
              onChange={handleSceneChange}
              disabled={!timingScenes.length}
              className="h-11 w-full rounded-lg border border-[#33415d] bg-[#0b1019] px-3 text-sm text-gray-100 outline-none transition-colors focus:border-amber-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="" disabled>
                {timingScenes.length ? "Choose a screenplay scene" : "No screenplay scenes available"}
              </option>
              {timingScenes.map((entry) => {
                const status = entry.canPlay
                  ? entry.hasCompleteCoverage
                    ? "Complete"
                    : `Partial ${entry.matchedCount}/${entry.lines.length}`
                  : entry.lines.length === 0
                    ? "No spoken lines"
                    : !entry.clip
                      ? "Motion clip needed"
                      : "Voice take needed";
                return (
                  <option key={entry.sceneNumber} value={entry.sceneNumber}>
                    Scene {entry.sceneNumber} · {status}
                  </option>
                );
              })}
            </select>
          </label>

          <div className="rounded-xl border border-[#2b3850] bg-[#0b1019] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-amber-300">
                <AudioLines className="h-3.5 w-3.5" aria-hidden="true" /> Dialogue coverage
              </div>
              <span className={`rounded-md border px-2 py-1 text-[10px] font-mono uppercase tracking-wider ${
                selectedEntry?.hasCompleteCoverage
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                  : selectedEntry?.matchedCount
                    ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
                    : "border-[#33415d] bg-[#151d2c] text-gray-400"
              }`}>
                {selectedCoverageLabel}
              </span>
            </div>
            <div className="mt-3 space-y-2">
              {selectedLines.length ? selectedLines.map((line, index) => {
                const saved = Boolean(selectedEntry?.matchedAudio[index]);
                return (
                  <div
                    key={line.line_id}
                    className={`flex items-start gap-3 rounded-lg border p-3 ${saved ? "border-emerald-700/30 bg-emerald-950/15" : "border-[#29364e] bg-[#111827]"}`}
                  >
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
                    </div>
                    {saved ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-label="Saved take available" />
                    ) : (
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-label="Saved take missing" />
                    )}
                  </div>
                );
              }) : (
                <p className="text-xs leading-relaxed text-gray-500">
                  This screenplay scene has no speaker lines. A dialogue timing proof needs at least one saved line.
                </p>
              )}
            </div>
          </div>

          {selectedEntry && selectedEntry.matchedCount > 0 && !selectedEntry.hasCompleteCoverage && (
            <div className="flex items-start gap-3 rounded-xl border border-amber-700/35 bg-amber-950/20 p-4 text-xs text-amber-100/85" role="status">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
              <div className="space-y-1.5 leading-relaxed">
                <p className="font-semibold text-amber-200">Partial dialogue coverage</p>
                <p>
                  The proof will play the saved takes in screenplay order and skip missing lines. It is a timing check, not a complete mix.
                </p>
                {missingLines.length > 0 && (
                  <p className="text-amber-100/70">
                    Missing: {missingLines.map((line) => `Line ${String(line.order).padStart(2, "0")}`).join(", ")}.
                  </p>
                )}
              </div>
            </div>
          )}

          {selectedEntry?.isArchivedFromEarlierStoryboard && selectedEntry.clip && (
            <div className="flex items-start gap-3 rounded-xl border border-emerald-700/35 bg-emerald-950/15 p-4 text-xs text-emerald-100/85" role="status">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
              <div className="space-y-1 leading-relaxed">
                <p className="font-semibold text-emerald-200">Archived clip from an earlier frame</p>
                <p>This proof uses the saved earlier-frame clip. The current storyboard and saved clip remain unchanged.</p>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-amber-400">Muted motion reference</p>
              <p className="mt-1 text-sm font-semibold text-white">
                {selectedEntry ? `Scene ${selectedEntry.sceneNumber}` : "Choose a scene"}
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-md border border-[#33415d] bg-[#0b1019] px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-gray-400">
              <VolumeX className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" /> Muted
            </span>
          </div>

          {selectedEntry?.clip ? (
            <div className="overflow-hidden rounded-2xl border border-[#2b3850] bg-[#080b11] p-2 shadow-lg shadow-black/20">
              <video
                ref={videoRef}
                key={selectedEntry.clip.video_url}
                className="mx-auto aspect-[9/16] max-h-[540px] w-full max-w-[330px] rounded-xl bg-black object-contain"
                src={selectedEntry.clip.video_url || undefined}
                muted
                playsInline
                preload="metadata"
                onLoadedMetadata={handleVideoMetadata}
                onTimeUpdate={handleVideoTimeUpdate}
                onEnded={handleVideoEnded}
                onError={handleVideoError}
                aria-label={`Muted Scene ${selectedEntry.sceneNumber} motion clip`}
              />
            </div>
          ) : (
            <div className="flex aspect-[9/16] min-h-[300px] items-center justify-center rounded-2xl border border-dashed border-[#33415d] bg-[#0b1019] p-6 text-center">
              <div className="max-w-[220px] space-y-3">
                <Film className="mx-auto h-9 w-9 text-gray-600" aria-hidden="true" />
                <p className="text-sm font-semibold text-gray-300">No playable motion clip for this scene</p>
                <p className="text-xs leading-relaxed text-gray-500">Select a scene with a saved READY five-second clip to open the timing proof.</p>
              </div>
            </div>
          )}

          <audio
            ref={audioRef}
            key={`${selectedEntry?.sceneNumber || "none"}-${currentAudioAsset?.audio_url || "none"}`}
            src={currentAudioAsset?.audio_url || undefined}
            preload="auto"
            onEnded={handleAudioEnded}
            onError={handleAudioError}
            aria-label="Saved dialogue take for the selected scene"
            className="sr-only"
          />

          {selectedEntry && !selectedEntry.canPlay && (
            <div className="flex items-start gap-3 rounded-xl border border-[#33415d] bg-[#0b1019] p-4 text-xs text-gray-300" role="status">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
              <div className="space-y-1.5 leading-relaxed">
                <p className="font-semibold text-gray-200">This scene is not ready for a timing proof.</p>
                <p>
                  {!selectedEntry.clip
                    ? "Save a READY motion clip with a secure hosted video URL first."
                    : selectedEntry.lines.length === 0
                      ? "Add at least one saved screenplay dialogue line before testing audio."
                      : "Save an exact READY ElevenLabs take for at least one current line before testing this scene."}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-amber-500/20 bg-[#0d131e]/80 px-4 py-4 sm:px-6">
        {blockingReason && (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-700/35 bg-amber-950/20 p-3 text-xs text-amber-100/85" role="status">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden="true" />
            <span>{blockingReason}</span>
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(210px,0.6fr)] lg:items-center">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-gray-400">
                <Clock3 className="h-4 w-4 text-amber-400" aria-hidden="true" />
                <span aria-live="polite">{formatClock(elapsedSeconds)} / {formatClock(totalSeconds)}</span>
              </div>
              <span className="text-[11px] text-gray-500">{selectedEntry?.clip ? "Five-second motion target" : "No clip selected"}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[#202a3d]" aria-label="Scene playback progress" role="progressbar" aria-valuemin={0} aria-valuemax={totalSeconds || 0} aria-valuenow={Math.min(elapsedSeconds, totalSeconds || elapsedSeconds)}>
              <div className="h-full rounded-full bg-amber-400 transition-[width] duration-150" style={{ width: `${playbackProgress}%` }} />
            </div>
            <div className="flex flex-wrap gap-2" aria-label="Scene timing controls">
              <Button
                type="button"
                onClick={() => void handlePlay()}
                disabled={playbackDisabled || isPlaying}
                className="h-10 gap-2 bg-amber-500 px-4 text-xs font-semibold text-black hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Play className="h-3.5 w-3.5" aria-hidden="true" /> Play
              </Button>
              <Button
                type="button"
                onClick={handlePause}
                disabled={playbackDisabled || !isPlaying}
                variant="outline"
                className="h-10 gap-2 border-[#3b4963] bg-[#151e2e] px-4 text-xs text-gray-200 hover:border-amber-500/50 hover:bg-[#1c2940] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Pause className="h-3.5 w-3.5" aria-hidden="true" /> Pause
              </Button>
              <Button
                type="button"
                onClick={handleRestart}
                disabled={playbackDisabled}
                variant="outline"
                className="h-10 gap-2 border-[#3b4963] bg-[#151e2e] px-4 text-xs text-gray-200 hover:border-amber-500/50 hover:bg-[#1c2940] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Restart
              </Button>
              <Button
                type="button"
                onClick={handleStop}
                disabled={playbackDisabled}
                variant="outline"
                className="h-10 gap-2 border-[#3b4963] bg-[#151e2e] px-4 text-xs text-gray-200 hover:border-red-500/50 hover:bg-red-950/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Square className="h-3.5 w-3.5" aria-hidden="true" /> Stop
              </Button>
            </div>
            <p className={`text-xs leading-relaxed ${playbackError ? "text-red-300" : playbackNotice ? "text-amber-200/85" : "text-gray-500"}`} role={playbackError ? "alert" : "status"} aria-live="polite">
              {playbackError || playbackNotice || (sceneMediaReady ? "Press Play to start the muted clip and its first saved dialogue take together." : "Playback controls will open when this scene has a playable clip and saved take.")}
            </p>
          </div>

          <div className="rounded-xl border border-[#2b3850] bg-[#0b1019] p-3.5" aria-live="polite">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-amber-400">Current dialogue line</p>
              <span className={`text-[10px] ${isPlaying ? "text-emerald-300" : dialogueFinished ? "text-gray-400" : "text-gray-500"}`}>
                {currentLineStatus}
              </span>
            </div>
            {currentTake ? (
              <>
                <p className="mt-2 font-mono text-[11px] uppercase tracking-wider text-gray-300">
                  Line {String(currentTake.line.order).padStart(2, "0")} of {String(selectedLines.length).padStart(2, "0")} · {currentTake.line.character_id}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-amber-100/90">“{currentTake.line.text}”</p>
              </>
            ) : (
              <p className="mt-2 text-xs leading-relaxed text-gray-500">
                Select a scene with at least one exact saved dialogue take.
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
