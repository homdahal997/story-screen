import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleX,
  Clock3,
  Film,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Save,
  VolumeX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  SilentPreviewMetadata,
  SilentPreviewPlaylist,
  isSilentPreviewMetadataCurrent,
} from "@/lib/dramaStudio";

interface SilentPreviewProps {
  playlist: SilentPreviewPlaylist;
  metadata?: SilentPreviewMetadata | null;
  onSavePreview?: () => Promise<void>;
  onOpenMotion?: () => void;
  isSaving?: boolean;
  isLoading?: boolean;
  error?: string | null;
}

function formatDuration(seconds: number): string {
  const totalSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function formatSavedTime(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export const SilentPreview: React.FC<SilentPreviewProps> = ({
  playlist,
  metadata = null,
  onSavePreview,
  onOpenMotion,
  isSaving = false,
  isLoading = false,
  error = null,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [shouldAutoplay, setShouldAutoplay] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState(false);

  const playlistKey = useMemo(
    () => `${playlist.scene_numbers.join(",")}:${playlist.clip_prediction_ids.join(",")}:${playlist.total_duration_seconds}`,
    [playlist.scene_numbers, playlist.clip_prediction_ids, playlist.total_duration_seconds]
  );

  useEffect(() => {
    setCurrentIndex(0);
    setShouldAutoplay(false);
    setIsPlaying(false);
    setPlayerError(null);
    setSaveError(null);
    setSaveNotice(false);
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  }, [playlistKey]);

  const currentItem = playlist.items[currentIndex] || null;
  const savedPreviewIsCurrent = isSilentPreviewMetadataCurrent(metadata, playlist);
  const previewIsStale = Boolean(
    metadata &&
    (metadata.status === "STALE" || (metadata.status === "READY" && !savedPreviewIsCurrent))
  );
  const savedTime = formatSavedTime(metadata?.updated_at);

  useEffect(() => {
    if (!shouldAutoplay || !currentItem) return;
    const player = videoRef.current;
    if (!player) return;

    const playWhenReady = () => {
      void player
        .play()
        .then(() => {
          setIsPlaying(true);
          setPlayerError(null);
        })
        .catch(() => {
          setIsPlaying(false);
          setPlayerError("This clip could not start in the browser. Use Play to retry the current scene.");
        });
      setShouldAutoplay(false);
    };

    if (player.readyState >= 2) {
      playWhenReady();
      return;
    }
    player.addEventListener("canplay", playWhenReady, { once: true });
    return () => player.removeEventListener("canplay", playWhenReady);
  }, [currentIndex, currentItem, shouldAutoplay]);

  const handlePlay = async () => {
    if (!videoRef.current || !currentItem) return;
    setPlayerError(null);
    try {
      await videoRef.current.play();
      setIsPlaying(true);
    } catch {
      setIsPlaying(false);
      setPlayerError("This clip could not start in the browser. Use Play to retry the current scene.");
    }
  };

  const handlePause = () => {
    videoRef.current?.pause();
    setIsPlaying(false);
    setShouldAutoplay(false);
  };

  const handleRestart = () => {
    setPlayerError(null);
    setCurrentIndex(0);
    setShouldAutoplay(true);
    if (videoRef.current && currentIndex === 0) {
      videoRef.current.currentTime = 0;
    }
  };

  const handleEnded = () => {
    if (currentIndex < playlist.items.length - 1) {
      setShouldAutoplay(true);
      setCurrentIndex((index) => index + 1);
      return;
    }
    setIsPlaying(false);
    setShouldAutoplay(false);
  };

  const handleSave = async () => {
    if (!onSavePreview || !playlist.complete || isSaving) return;
    setSaveError(null);
    setSaveNotice(false);
    try {
      await onSavePreview();
      setSaveNotice(true);
    } catch (saveFailure) {
      setSaveError(saveFailure instanceof Error ? saveFailure.message : "The preview definition could not be saved. Try again.");
    }
  };

  if (isLoading) {
    return (
      <section className="rounded-xl border border-[#252f45] bg-[#101622] p-6" aria-busy="true">
        <div className="flex items-center gap-3 text-sm text-gray-300">
          <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
          Loading the saved preview state...
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-5" aria-label="Silent preview">
      <div className="rounded-xl border border-amber-500/30 bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,0.13),transparent_44%),#121926] p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs font-mono uppercase tracking-wider text-amber-400">
              <Film className="h-4 w-4" />
              <span>Review assembly</span>
              <span className="rounded-md border border-[#37445e] bg-[#0e131d] px-2 py-1 text-[10px] text-gray-300">
                Silent hard cut
              </span>
            </div>
            <h2 className="text-xl font-serif font-bold text-white">Watch the scenes in order</h2>
            <p className="text-sm leading-relaxed text-gray-300">
              This browser preview plays the saved scene clips one at a time, following the screenplay order. It stays muted so you can check pacing and coverage before the audio film stages begin.
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-start gap-2 rounded-lg border border-[#2a354b] bg-[#0e131d] p-3 text-xs text-gray-300 sm:min-w-[210px]">
            <div className="flex items-center gap-2 font-mono uppercase tracking-wider text-gray-400">
              <VolumeX className="h-3.5 w-3.5 text-amber-400" /> Audio off by design
            </div>
            <p className="leading-relaxed text-gray-400">Dialogue audio, lip-sync, captions, music, and final assembly are later phases.</p>
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-red-800/50 bg-red-950/30 p-4 text-sm text-red-200" role="alert">
          <CircleX className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
          <div>
            <p className="font-semibold text-red-300">Preview state could not load</p>
            <p className="mt-1 text-xs leading-relaxed text-red-200/85">{error}</p>
          </div>
        </div>
      )}

      {!playlist.complete ? (
        <div className="space-y-4 rounded-xl border border-[#2a354b] bg-[#0e131d] p-4 sm:p-5">
          {previewIsStale && metadata && (
            <div className="flex flex-col gap-3 rounded-lg border border-amber-500/35 bg-amber-950/20 p-3 sm:flex-row sm:items-start sm:justify-between" role="status">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <div>
                  <p className="font-semibold text-amber-100">Saved preview is out of date</p>
                  <p className="mt-1 text-xs leading-relaxed text-amber-100/75">
                    This checkpoint no longer matches the current screenplay or scene clips. Render the missing scenes, then save a new preview definition.
                  </p>
                </div>
              </div>
              <span className="shrink-0 self-start rounded-md border border-amber-700/40 bg-amber-950/30 px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-amber-200">
                Stale
              </span>
            </div>
          )}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-amber-300">
                <AlertTriangle className="h-4 w-4" />
              </div>
              <div>
                <p className="font-semibold text-white">Render every scene before saving the preview</p>
                <p className="mt-1 text-xs leading-relaxed text-gray-400">
                  {playlist.items.length} of {playlist.scene_numbers.length} scenes have a current archived motion clip tied to their saved storyboard.
                </p>
              </div>
            </div>
            <span className="shrink-0 rounded-md border border-amber-700/40 bg-amber-950/30 px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-amber-200">
              Incomplete
            </span>
          </div>

          {playlist.missing_scene_numbers.length > 0 ? (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
              <p className="text-[10px] font-mono uppercase tracking-wider text-amber-300">Missing current clips</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {playlist.missing_scene_numbers.map((sceneNumber) => (
                  <span key={sceneNumber} className="rounded-md border border-[#394660] bg-[#171f30] px-2 py-1 text-xs text-gray-200">
                    Scene {sceneNumber}
                  </span>
                ))}
              </div>
              <p className="mt-3 text-xs leading-relaxed text-gray-400">
                Open Video &amp; Motion, choose each missing storyboard, and run its manual five-second motion test. A clip from an older storyboard will not count toward this preview.
              </p>
            </div>
          ) : (
            <p className="text-xs leading-relaxed text-gray-400">Save the screenplay and storyboard frames first, then render each scene from Video &amp; Motion.</p>
          )}

          {onOpenMotion && (
            <Button
              type="button"
              onClick={onOpenMotion}
              className="h-9 gap-2 bg-amber-500 text-xs font-semibold text-black hover:bg-amber-600"
            >
              Open Video &amp; Motion <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      ) : (
        <>
          {previewIsStale && (
            <div className="flex flex-col gap-3 rounded-xl border border-amber-500/35 bg-amber-950/20 p-4 sm:flex-row sm:items-start sm:justify-between" role="status">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <div>
                  <p className="font-semibold text-amber-100">Saved preview needs a fresh save</p>
                  <p className="mt-1 text-xs leading-relaxed text-amber-100/75">
                    The screenplay, storyboard, or selected scene clip changed after this playlist was saved. Review the sequence below, then save the current preview definition.
                  </p>
                </div>
              </div>
              <span className="shrink-0 rounded-md border border-amber-700/40 bg-amber-950/30 px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-amber-200">
                Stale
              </span>
            </div>
          )}

          {!savedPreviewIsCurrent && !previewIsStale && (
            <div className="flex flex-col gap-3 rounded-xl border border-[#2a354b] bg-[#0e131d] p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <div>
                  <p className="font-semibold text-gray-200">Current clips are ready to review</p>
                  <p className="mt-1 text-xs leading-relaxed text-gray-400">Save this scene order and clip selection so the review checkpoint survives refresh.</p>
                </div>
              </div>
              <span className="shrink-0 rounded-md border border-[#394660] bg-[#171f30] px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-gray-300">
                Unsaved
              </span>
            </div>
          )}

          {savedPreviewIsCurrent && (
            <div className="flex flex-col gap-3 rounded-xl border border-emerald-700/40 bg-emerald-950/20 p-4 sm:flex-row sm:items-center sm:justify-between" role="status">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                <div>
                  <p className="font-semibold text-emerald-100">Preview definition saved</p>
                  <p className="mt-1 text-xs leading-relaxed text-emerald-100/70">
                    {savedTime ? `Saved ${savedTime}.` : "Saved to this private story."} The browser will use these scene clips in order.
                  </p>
                </div>
              </div>
              <span className="shrink-0 rounded-md border border-emerald-700/50 bg-emerald-950/30 px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-emerald-200">
                Ready
              </span>
            </div>
          )}

          <div className="grid gap-5 lg:grid-cols-[minmax(0,0.8fr)_minmax(320px,1.2fr)]">
            <div className="overflow-hidden rounded-xl border border-[#252f45] bg-[#090c12] shadow-lg shadow-black/20">
              <div className="relative aspect-[9/16] max-h-[680px] w-full bg-black">
                {currentItem ? (
                  <video
                    key={currentItem.prediction_id}
                    ref={videoRef}
                    src={currentItem.video_url}
                    muted
                    playsInline
                    preload="metadata"
                    className="h-full w-full object-contain"
                    aria-label={`Silent preview Scene ${currentItem.scene_number}`}
                    onEnded={handleEnded}
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                    onError={() => {
                      setIsPlaying(false);
                      setPlayerError("This archived clip could not be loaded in the browser. Open Video & Motion to inspect the saved clip.");
                    }}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center px-6 text-center text-sm text-gray-400">No playable scene is selected.</div>
                )}
                <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between bg-gradient-to-b from-black/75 to-transparent p-3">
                  <span className="rounded-md border border-white/15 bg-black/50 px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-amber-200">
                    Scene {currentItem?.scene_number ?? "–"} / {playlist.items.length}
                  </span>
                  <span className="flex items-center gap-1 rounded-md border border-white/15 bg-black/50 px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-gray-200">
                    <VolumeX className="h-3 w-3 text-amber-300" /> Muted
                  </span>
                </div>
              </div>
              <div className="space-y-3 border-t border-[#1d2638] bg-[#101622] p-3.5">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="font-mono uppercase tracking-wider text-gray-400">Hard-cut playback</span>
                  <span className="text-gray-300">{formatDuration(playlist.total_duration_seconds)} total</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    onClick={isPlaying ? handlePause : () => void handlePlay()}
                    disabled={!currentItem}
                    className="h-9 gap-2 bg-amber-500 px-3 text-xs font-semibold text-black hover:bg-amber-600 disabled:opacity-50"
                  >
                    {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                    {isPlaying ? "Pause" : "Play preview"}
                  </Button>
                  <Button
                    type="button"
                    onClick={handleRestart}
                    disabled={!currentItem}
                    variant="outline"
                    className="h-9 gap-2 border-[#35425d] bg-[#171f30] text-xs text-gray-200 hover:border-amber-500/50 hover:bg-[#1d283d] hover:text-white disabled:opacity-50"
                  >
                    <RotateCcw className="h-3.5 w-3.5 text-amber-400" /> Restart
                  </Button>
                </div>
                {playerError && <p className="text-xs leading-relaxed text-red-300" role="alert">{playerError}</p>}
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-xl border border-[#252f45] bg-[#101622] p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-mono uppercase tracking-wider text-amber-400">Scene order</p>
                    <h3 className="mt-1 text-lg font-serif font-bold text-white">{playlist.items.length} clips, {formatDuration(playlist.total_duration_seconds)}</h3>
                  </div>
                  <Clock3 className="h-5 w-5 text-amber-400/80" />
                </div>
                <div className="mt-4 space-y-2">
                  {playlist.items.map((item, index) => (
                    <button
                      key={item.prediction_id}
                      type="button"
                      onClick={() => {
                        setCurrentIndex(index);
                        setShouldAutoplay(false);
                        setIsPlaying(false);
                        setPlayerError(null);
                      }}
                      className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                        index === currentIndex
                          ? "border-amber-500/50 bg-amber-500/10"
                          : "border-[#263149] bg-[#0e131d] hover:border-[#3a4968]"
                      }`}
                      aria-label={`Play Scene ${item.scene_number}`}
                    >
                      <span className="flex items-center gap-2.5">
                        <span className={`flex h-6 w-6 items-center justify-center rounded-md text-[10px] font-mono ${index === currentIndex ? "bg-amber-500 text-black" : "bg-[#202a3e] text-gray-300"}`}>
                          {String(item.scene_number).padStart(2, "0")}
                        </span>
                        <span className="text-xs font-medium text-gray-200">Scene {item.scene_number}</span>
                      </span>
                      <span className="text-[11px] font-mono text-gray-400">{formatDuration(item.duration_seconds)}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-[#252f45] bg-[#0e131d] p-4 sm:p-5">
                <div className="flex items-start gap-3">
                  <Save className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                  <div className="flex-1">
                    <p className="font-semibold text-gray-200">Save this review checkpoint</p>
                    <p className="mt-1 text-xs leading-relaxed text-gray-400">
                      Save stores the ordered scene numbers and motion prediction IDs in this private project. It does not create, stitch, or upload another video file.
                    </p>
                    <Button
                      type="button"
                      onClick={() => void handleSave()}
                      disabled={!onSavePreview || !playlist.complete || isSaving}
                      className="mt-4 h-9 gap-2 bg-amber-500 text-xs font-semibold text-black hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                      {isSaving ? "Saving preview..." : previewIsStale ? "Save current preview" : "Save Preview"}
                    </Button>
                    {saveNotice && !previewIsStale && (
                      <p className="mt-2 text-xs text-emerald-300" role="status">Preview definition saved to this story.</p>
                    )}
                    {saveError && <p className="mt-2 text-xs leading-relaxed text-red-300" role="alert">{saveError}</p>}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
};
