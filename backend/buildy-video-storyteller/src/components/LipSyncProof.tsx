import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  AudioLines,
  CheckCircle2,
  Clock3,
  Film,
  Info,
  Link2,
  Loader2,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Volume2,
  Waves,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DialogueAudioAsset,
  DialogueLine,
  DramaManifest,
  DramaScene,
  FrameAsset,
  LipsyncAsset,
  VideoClip,
  deriveDialogueLines,
  getLegacyDialogueLineId,
} from "@/lib/dramaStudio";

export interface LipSyncStartInput {
  sceneNumber: number;
  lineId: string;
  characterId: string;
  text: string;
  clipPredictionId: string;
  sourceVideoUrl: string;
  sourceAudioUrl: string;
  sourceClipKind?: "dialogue_closeup";
}

export interface LipSyncStatusInput {
  predictionId: string;
}

export interface LipSyncProofProps {
  manifest: DramaManifest;
  orientation?: "vertical" | "horizontal";
  videoClips?: VideoClip[];
  audioAssets?: DialogueAudioAsset[];
  frameAssets?: FrameAsset[];
  lipsyncAssets?: LipsyncAsset[];
  isDirty?: boolean;
  isSaving?: boolean;
  isApproving?: boolean;
  isGeneratingFrames?: boolean;
  isPollingMotion?: boolean;
  isSynthesizingVoice?: boolean;
  isGeneratingAmbience?: boolean;
  authAvailable?: boolean;
  persistedProject?: boolean;
  isStartingLipsync?: boolean;
  lipsyncError?: string | null;
  onStartLipsync?: (input: LipSyncStartInput) => Promise<boolean | void> | boolean | void;
  onCheckLipsync?: (input: LipSyncStatusInput) => Promise<boolean | void> | boolean | void;
}

type LipSyncTake = {
  line: DialogueLine;
  asset: DialogueAudioAsset;
};

type LipSyncScene = {
  scene: DramaScene;
  sceneNumber: number;
  lines: DialogueLine[];
  takes: LipSyncTake[];
  clip: VideoClip | null;
  currentStoryboardUrl: string | null;
  isArchivedFromEarlierStoryboard: boolean;
};

type AttemptStatus = LipsyncAsset["status"];

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

function formatScene(sceneNumber: number): string {
  return String(sceneNumber).padStart(2, "0");
}

function formatDuration(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value <= 0) return "Not measured";
  return `${value.toFixed(value >= 10 ? 1 : 2)}s`;
}

function safeDuration(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function shortId(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 22) return trimmed;
  return `${trimmed.slice(0, 10)}…${trimmed.slice(-8)}`;
}

function attemptLabel(status: AttemptStatus): string {
  if (status === "PROCESSING") return "Rendering";
  if (status === "READY") return "Ready";
  if (status === "CANCELED") return "Canceled";
  return "Failed";
}

function attemptClass(status: AttemptStatus): string {
  if (status === "PROCESSING") return "border-amber-500/35 bg-amber-500/10 text-amber-100";
  if (status === "READY") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-100";
  return "border-red-500/30 bg-red-950/20 text-red-200";
}

function statusDotClass(status: AttemptStatus): string {
  if (status === "PROCESSING") return "bg-amber-300";
  if (status === "READY") return "bg-emerald-300";
  return "bg-red-300";
}

function getLineDisplay(line: DialogueLine): string {
  return `${line.line_id} · ${line.character_id}`;
}

export const LipSyncProof: React.FC<LipSyncProofProps> = ({
  manifest,
  orientation = "vertical",
  videoClips = [],
  audioAssets = [],
  frameAssets = [],
  lipsyncAssets = [],
  isDirty = false,
  isSaving = false,
  isApproving = false,
  isGeneratingFrames = false,
  isPollingMotion = false,
  isSynthesizingVoice = false,
  isGeneratingAmbience = false,
  authAvailable = false,
  persistedProject = false,
  isStartingLipsync = false,
  lipsyncError = null,
  onStartLipsync,
  onCheckLipsync,
}) => {
  const sceneEntries = useMemo<LipSyncScene[]>(() => {
    const safeScenes = Array.isArray(manifest?.scenes) ? manifest.scenes : [];
    const safeClips = Array.isArray(videoClips) ? videoClips : [];
    const safeAudio = Array.isArray(audioAssets) ? audioAssets : [];
    const safeFrames = Array.isArray(frameAssets) ? frameAssets : [];

    return [...safeScenes]
      .sort((left, right) => left.scene_number - right.scene_number)
      .map((scene) => {
        const lines = deriveDialogueLines(scene);
        const takes = lines.flatMap((line) => {
          const asset = findNewestMatchingAudio(safeAudio, scene.scene_number, line);
          return asset ? [{ line, asset }] : [];
        });
        const clip = findNewestPlayableClip(safeClips, scene.scene_number);
        const storyboard = safeFrames.find(
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

        return {
          scene,
          sceneNumber: scene.scene_number,
          lines,
          takes,
          clip,
          currentStoryboardUrl,
          isArchivedFromEarlierStoryboard,
        };
      });
  }, [manifest, videoClips, audioAssets, frameAssets]);

  const [selectedSceneNumber, setSelectedSceneNumber] = useState<number | null>(null);
  const [selectedLineId, setSelectedLineId] = useState("");
  const [measuredDurations, setMeasuredDurations] = useState<Record<string, number>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollInFlightRef = useRef(false);
  const pollRunRef = useRef(0);
  const pollKeyRef = useRef<string | null>(null);
  const checkLipsyncRef = useRef(onCheckLipsync);

  useEffect(() => {
    checkLipsyncRef.current = onCheckLipsync;
  }, [onCheckLipsync]);

  useEffect(() => {
    setSelectedSceneNumber((current) => {
      if (current !== null && sceneEntries.some((entry) => entry.sceneNumber === current)) return current;
      return sceneEntries.find((entry) => Boolean(entry.clip))?.sceneNumber ?? sceneEntries[0]?.sceneNumber ?? null;
    });
  }, [sceneEntries]);

  const selectedEntry = useMemo(
    () => sceneEntries.find((entry) => entry.sceneNumber === selectedSceneNumber) || null,
    [sceneEntries, selectedSceneNumber]
  );

  useEffect(() => {
    setSelectedLineId((current) => {
      if (current && selectedEntry?.takes.some((take) => take.line.line_id === current)) return current;
      return selectedEntry?.takes[0]?.line.line_id || "";
    });
    setActionError(null);
    setPollError(null);
  }, [selectedEntry]);

  const selectedTake = useMemo(
    () => selectedEntry?.takes.find((take) => take.line.line_id === selectedLineId) || null,
    [selectedEntry, selectedLineId]
  );

  const selectedClip = selectedEntry?.clip || null;
  const selectedLine = selectedTake?.line || null;
  const selectedAudio = selectedTake?.asset || null;
  const measuredVisualDuration = selectedClip?.video_url ? measuredDurations[selectedClip.video_url] : undefined;
  const measuredVoiceDuration = selectedAudio?.audio_url ? measuredDurations[selectedAudio.audio_url] : undefined;
  const visualDuration = measuredVisualDuration || safeDuration(selectedClip?.duration_seconds);
  const voiceDuration = measuredVoiceDuration || safeDuration(selectedAudio?.duration_seconds);
  const dialogueRunsLong = Boolean(
    voiceDuration !== null && visualDuration !== null && voiceDuration > visualDuration + 0.05
  );

  const matchingAttempts = useMemo(() => {
    if (!selectedEntry || !selectedTake || !selectedClip) return [];
    return [...(Array.isArray(lipsyncAssets) ? lipsyncAssets : [])]
      .filter(
        (asset) =>
          asset.provider === "replicate-lipsync" &&
          asset.scene_number === selectedEntry.sceneNumber &&
          asset.line_id === selectedTake.line.line_id &&
          asset.character_id === selectedTake.line.character_id &&
          asset.text === selectedTake.line.text &&
          asset.source_clip_prediction_id === selectedClip.prediction_id &&
          asset.source_video_url === selectedClip.video_url &&
          asset.source_audio_url === selectedTake.asset.audio_url
      )
      .sort((left, right) => mediaTimestamp(right) - mediaTimestamp(left));
  }, [lipsyncAssets, selectedEntry, selectedTake, selectedClip]);

  const latestAttempt = matchingAttempts[0] || null;
  const pendingAttempt = latestAttempt?.status === "PROCESSING" ? latestAttempt : null;
  const readyAttempts = matchingAttempts.filter(
    (asset) => asset.status === "READY" && isSecureHttpsUrl(asset.video_url)
  );
  const currentPollKey = pendingAttempt
    ? [
        pendingAttempt.prediction_id,
        pendingAttempt.scene_number,
        pendingAttempt.line_id,
        pendingAttempt.source_clip_prediction_id,
        pendingAttempt.source_audio_url,
      ].join(":")
    : null;
  pollKeyRef.current = currentPollKey;

  const blockingReason = !authAvailable
    ? "Sign in before running a private Sync motion-clip proof."
    : !persistedProject
      ? "Save this story before running a private Sync motion-clip proof."
      : isDirty
        ? "Save screenplay edits before using the saved source media."
        : isSaving
          ? "The proof is paused while the project is saving."
          : isApproving
            ? "The proof is unavailable while screenplay approval is being recorded."
            : isGeneratingFrames
              ? "The proof is unavailable while visual references are being generated."
              : isPollingMotion
                ? "The proof is unavailable while a motion clip is being checked."
                : isSynthesizingVoice
                  ? "The proof is unavailable while a voice take is being synthesized."
                  : isGeneratingAmbience
                    ? "The proof is unavailable while an ambience bed is being generated."
                    : isStartingLipsync
                      ? "The lip-sync render is being started."
                      : null;

  const eligibilityReason = orientation !== "vertical"
    ? "This proof uses the studio's saved vertical 9:16 production path."
    : !selectedEntry
      ? "Choose a screenplay scene to continue."
      : !selectedClip
        ? "This scene needs a READY private motion clip before lip-sync can run."
        : selectedEntry.isArchivedFromEarlierStoryboard
          ? "The saved motion clip belongs to an earlier storyboard. Generate a current READY clip first."
          : !selectedTake
            ? selectedEntry.lines.length > 0
              ? "Save an exact READY ElevenLabs take for one dialogue line in this scene."
              : "This scene has no dialogue line to lip-sync."
            : null;

  const canGenerate = Boolean(
    onStartLipsync &&
    !blockingReason &&
    !eligibilityReason &&
    !pendingAttempt &&
    selectedEntry &&
    selectedClip &&
    selectedTake &&
    isSecureHttpsUrl(selectedClip.video_url) &&
    isSecureHttpsUrl(selectedTake.asset.audio_url)
  );

  useEffect(() => {
    pollRunRef.current += 1;
    const runId = pollRunRef.current;
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    pollInFlightRef.current = false;
    setPollError(null);

    if (!currentPollKey || !pendingAttempt || !onCheckLipsync || blockingReason || !authAvailable) {
      return () => {
        if (pollRunRef.current === runId) pollRunRef.current += 1;
      };
    }

    const predictionId = pendingAttempt.prediction_id;
    const poll = async () => {
      if (
        pollRunRef.current !== runId ||
        pollKeyRef.current !== currentPollKey ||
        pollInFlightRef.current ||
        blockingReason ||
        !authAvailable
      ) return;

      pollInFlightRef.current = true;
      try {
        const result = await checkLipsyncRef.current?.({ predictionId });
        if (pollRunRef.current !== runId || pollKeyRef.current !== currentPollKey) return;
        if (result === false) {
          setPollError("The latest render status could not be checked. The saved attempt is still safe, so this proof will try again.");
        } else {
          setPollError(null);
        }
      } catch {
        if (pollRunRef.current === runId && pollKeyRef.current === currentPollKey) {
          setPollError("The latest render status could not be checked. The saved attempt is still safe, so this proof will try again.");
        }
      } finally {
        if (pollRunRef.current !== runId) return;
        pollInFlightRef.current = false;
        if (
          pollKeyRef.current === currentPollKey &&
          !blockingReason &&
          authAvailable
        ) {
          pollTimerRef.current = setTimeout(() => {
            pollTimerRef.current = null;
            void poll();
          }, 4500);
        }
      }
    };

    void poll();

    return () => {
      if (pollRunRef.current === runId) pollRunRef.current += 1;
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      pollInFlightRef.current = false;
    };
  }, [currentPollKey, pendingAttempt?.prediction_id, Boolean(blockingReason), authAvailable]);

  const handleDurationMeasured = (url: string, value: number) => {
    if (!url || !Number.isFinite(value) || value <= 0 || value > 3600) return;
    setMeasuredDurations((current) => {
      if (Math.abs((current[url] || 0) - value) < 0.01) return current;
      return { ...current, [url]: value };
    });
  };

  const handleGenerate = async () => {
    if (!canGenerate || !selectedEntry || !selectedTake || !selectedClip || !onStartLipsync) return;
    setActionError(null);
    const result = await onStartLipsync({
      sceneNumber: selectedEntry.sceneNumber,
      lineId: selectedTake.line.line_id,
      characterId: selectedTake.line.character_id,
      text: selectedTake.line.text,
      clipPredictionId: selectedClip.prediction_id,
      sourceVideoUrl: selectedClip.video_url as string,
      sourceAudioUrl: selectedTake.asset.audio_url,
    });
    if (result === false) {
      setActionError("The render did not start. Your source clip and dialogue take are still safe, so review the message above and retry.");
    }
  };

  const selectedLineIsMissingTake = Boolean(
    selectedEntry && selectedLine && !selectedTake && selectedEntry.lines.some((line) => line.line_id === selectedLine.line_id)
  );
  const previousReadyAttempts = readyAttempts.filter(
    (asset) => asset.prediction_id !== latestAttempt?.prediction_id
  );

  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-[#2b3549] bg-[#101622] shadow-xl shadow-black/20" aria-labelledby="lipsync-proof-heading">
      <div className="border-b border-[#222d43] bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,0.15),transparent_52%),#141b28] px-4 py-5 sm:px-6 sm:py-6">
        <div className="flex min-w-0 flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/35 bg-amber-500/10 px-2 py-1 text-[10px] font-mono uppercase tracking-[0.18em] text-amber-200">
                <Sparkles className="h-3 w-3" /> One-shot proof
              </span>
              <span className="rounded-md border border-[#39465f] bg-[#182235] px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-gray-300">
                {orientation === "vertical" ? "Vertical 9:16" : "Horizontal 16:9"}
              </span>
            </div>
            <h2 id="lipsync-proof-heading" className="mt-3 text-2xl font-serif font-bold tracking-tight text-white sm:text-3xl">
              Sync Motion-Clip Proof
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-gray-300">
              Choose one saved motion clip and one exact voice take to test mouth movement through the Sync motion-clip path before the studio builds any larger assembly. Dialogue close-ups use the PixVerse production path in their own proof.
            </p>
            <div className="mt-4 grid gap-2 text-[11px] leading-relaxed text-gray-300 sm:grid-cols-3">
              <div className="flex items-start gap-2 rounded-lg border border-[#29364d] bg-black/20 px-3 py-2.5">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" />
                <span>Private MP4 archiving keeps the provider output inside this project.</span>
              </div>
              <div className="flex items-start gap-2 rounded-lg border border-[#29364d] bg-black/20 px-3 py-2.5">
                <Link2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
                <span>The source clip, dialogue take, and ambience bed remain unchanged.</span>
              </div>
              <div className="flex items-start gap-2 rounded-lg border border-[#29364d] bg-black/20 px-3 py-2.5">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-300" />
                <span>This output is a review proof. It is not used in Episode Mix yet.</span>
              </div>
            </div>
          </div>
          <div className="grid min-w-0 grid-cols-3 gap-2 lg:min-w-[270px] lg:max-w-[320px]">
            <div className="rounded-xl border border-[#303d55] bg-[#0d131f]/80 p-3">
              <Film className="h-4 w-4 text-amber-300" />
              <p className="mt-3 text-lg font-semibold text-white">{sceneEntries.length}</p>
              <p className="text-[10px] font-mono uppercase tracking-wider text-gray-500">Scenes</p>
            </div>
            <div className="rounded-xl border border-[#303d55] bg-[#0d131f]/80 p-3">
              <AudioLines className="h-4 w-4 text-sky-300" />
              <p className="mt-3 text-lg font-semibold text-white">{sceneEntries.reduce((count, entry) => count + entry.takes.length, 0)}</p>
              <p className="text-[10px] font-mono uppercase tracking-wider text-gray-500">Takes</p>
            </div>
            <div className="rounded-xl border border-[#303d55] bg-[#0d131f]/80 p-3">
              <CheckCircle2 className="h-4 w-4 text-emerald-300" />
              <p className="mt-3 text-lg font-semibold text-white">{readyAttempts.length}</p>
              <p className="text-[10px] font-mono uppercase tracking-wider text-gray-500">Ready here</p>
            </div>
          </div>
        </div>
      </div>

      {(lipsyncError || actionError || pollError) && (
        <div className="border-b border-red-500/20 bg-red-950/20 px-4 py-3 sm:px-6" role="alert">
          <div className="flex items-start gap-2 text-xs leading-relaxed text-red-100">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
            <span>{lipsyncError || actionError || pollError}</span>
          </div>
        </div>
      )}

      <div className="grid min-w-0 gap-5 p-4 sm:p-6 xl:grid-cols-[minmax(0,0.86fr)_minmax(0,1.14fr)]">
        <div className="min-w-0 space-y-5">
          <div className="rounded-2xl border border-[#2a364e] bg-[#121a28] p-4 sm:p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-300">01 / Select the shot</p>
                <h3 className="mt-1.5 text-lg font-semibold text-white">Lock the exact saved lineage</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-gray-400">
                  Scenes stay in screenplay order. The proof only accepts archived motion and dialogue that still match the current approved scene.
                </p>
              </div>
              <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-2.5 text-amber-300">
                <Film className="h-5 w-5" />
              </div>
            </div>

            <div className="mt-5 space-y-4">
              <label className="block text-xs font-semibold text-gray-200" htmlFor="lipsync-scene-select">
                Screenplay scene
                <select
                  id="lipsync-scene-select"
                  value={selectedSceneNumber ?? ""}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    setSelectedSceneNumber(Number.isInteger(next) ? next : null);
                    setSelectedLineId("");
                    setActionError(null);
                  }}
                  className="mt-2 block h-11 w-full min-w-0 rounded-lg border border-[#34415b] bg-[#0b111b] px-3 text-sm font-medium text-gray-100 outline-none transition-colors focus:border-amber-400 focus:ring-2 focus:ring-amber-500/20"
                >
                  <option value="" disabled>Choose a scene</option>
                  {sceneEntries.map((entry) => {
                    const sceneReady = Boolean(entry.clip) && orientation === "vertical" && !entry.isArchivedFromEarlierStoryboard;
                    return (
                      <option key={entry.sceneNumber} value={entry.sceneNumber} disabled={!sceneReady}>
                        Scene {formatScene(entry.sceneNumber)} · {sceneReady ? `${entry.takes.length} exact take${entry.takes.length === 1 ? "" : "s"}` : entry.clip ? "needs current clip" : "needs READY clip"}
                      </option>
                    );
                  })}
                </select>
              </label>

              <label className="block text-xs font-semibold text-gray-200" htmlFor="lipsync-take-select">
                Saved dialogue take
                <select
                  id="lipsync-take-select"
                  value={selectedLineId}
                  onChange={(event) => {
                    setSelectedLineId(event.target.value);
                    setActionError(null);
                  }}
                  disabled={!selectedEntry || selectedEntry.takes.length === 0}
                  className="mt-2 block h-11 w-full min-w-0 rounded-lg border border-[#34415b] bg-[#0b111b] px-3 text-sm font-medium text-gray-100 outline-none transition-colors focus:border-amber-400 focus:ring-2 focus:ring-amber-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {selectedEntry?.takes.length ? (
                    selectedEntry.takes.map((take) => (
                      <option key={take.line.line_id} value={take.line.line_id}>
                        {getLineDisplay(take.line)}
                      </option>
                    ))
                  ) : (
                    <option value="">No exact READY takes saved</option>
                  )}
                </select>
                {selectedEntry && selectedEntry.lines.length > selectedEntry.takes.length && (
                  <span className="mt-1.5 block text-[11px] font-normal text-amber-200/75">
                    {selectedEntry.lines.length - selectedEntry.takes.length} current dialogue line{selectedEntry.lines.length - selectedEntry.takes.length === 1 ? " is" : "s are"} missing an exact READY take.
                  </span>
                )}
              </label>
            </div>
          </div>

          <div className="rounded-2xl border border-[#2a364e] bg-[#0f1724] p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-sky-300">02 / Source check</p>
                <h3 className="mt-1.5 text-lg font-semibold text-white">What will be rendered</h3>
              </div>
              <span className={`rounded-md border px-2 py-1 text-[10px] font-mono uppercase tracking-wider ${selectedClip ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-[#33415d] bg-[#151d2c] text-gray-400"}`}>
                {selectedClip ? "READY" : "WAITING"}
              </span>
            </div>

            {!selectedEntry ? (
              <p className="mt-4 rounded-xl border border-dashed border-[#33415d] bg-[#0b111b] p-4 text-xs leading-relaxed text-gray-400">
                Select a screenplay scene to inspect its saved visual and voice lineage.
              </p>
            ) : (
              <div className="mt-4 space-y-3">
                <div className="flex min-w-0 items-start gap-3 rounded-xl border border-[#2b3850] bg-[#0a101a] p-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-amber-500/25 bg-amber-500/10 text-amber-300">
                    <Film className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xs font-semibold text-gray-100">Scene {formatScene(selectedEntry.sceneNumber)} motion clip</p>
                      <span className="rounded border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-mono text-emerald-200">
                        {selectedClip ? "READY" : "MISSING"}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-gray-400">
                      {selectedClip ? `Prediction ${shortId(selectedClip.prediction_id)} · ${formatDuration(visualDuration)}` : "A secure archived motion clip is required."}
                    </p>
                  </div>
                </div>

                <div className="flex min-w-0 items-start gap-3 rounded-xl border border-[#2b3850] bg-[#0a101a] p-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-sky-500/25 bg-sky-500/10 text-sky-300">
                    <Volume2 className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xs font-semibold text-gray-100">Dialogue take</p>
                      <span className={`rounded border px-1.5 py-0.5 text-[10px] font-mono ${selectedTake ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-200" : "border-amber-500/25 bg-amber-500/10 text-amber-200"}`}>
                        {selectedTake ? "READY" : "MISSING"}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-gray-400">
                      {selectedTake ? `${selectedTake.asset.voice_name} · ${formatDuration(voiceDuration)}` : "Choose a saved exact dialogue take."}
                    </p>
                  </div>
                </div>

                {selectedLine && (
                  <div className="rounded-xl border border-[#2b3850] bg-[#0a101a] p-3.5">
                    <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-gray-500">
                      <span>{selectedLine.line_id}</span>
                      <span className="text-[#52627e]">•</span>
                      <span className="text-amber-300">{selectedLine.character_id}</span>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-gray-100">“{selectedLine.text}”</p>
                  </div>
                )}

                {selectedClip && selectedEntry.isArchivedFromEarlierStoryboard && (
                  <div className="flex items-start gap-2 rounded-xl border border-amber-500/35 bg-amber-950/20 p-3 text-xs leading-relaxed text-amber-100" role="status">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                    <span>This READY clip was archived from an earlier storyboard. The current storyboard is kept safe, but this proof will not send a stale visual to lip-sync.</span>
                  </div>
                )}

                {dialogueRunsLong && (
                  <div className="flex items-start gap-2 rounded-xl border border-amber-500/35 bg-amber-950/20 p-3 text-xs leading-relaxed text-amber-100" role="status">
                    <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                    <span>The voice take is longer than the visual clip by {(voiceDuration! - visualDuration!).toFixed(2)}s. The provider will use its saved cut-off behavior, so review the result carefully.</span>
                  </div>
                )}

                {selectedClip && selectedTake && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="rounded-lg border border-[#26334a] bg-[#111a29] p-3">
                      <p className="text-[10px] font-mono uppercase tracking-wider text-gray-500">Visual duration</p>
                      <p className="mt-1 text-sm font-semibold text-gray-100">{formatDuration(visualDuration)}</p>
                      <p className="mt-1 text-[10px] text-gray-500">Saved clip timing, then browser measurement</p>
                    </div>
                    <div className="rounded-lg border border-[#26334a] bg-[#111a29] p-3">
                      <p className="text-[10px] font-mono uppercase tracking-wider text-gray-500">Voice duration</p>
                      <p className="mt-1 text-sm font-semibold text-gray-100">{formatDuration(voiceDuration)}</p>
                      <p className="mt-1 text-[10px] text-gray-500">Saved take timing, then browser measurement</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {selectedClip && (
              <video
                key={selectedClip.video_url}
                src={selectedClip.video_url || undefined}
                className="mt-4 aspect-[9/16] max-h-[360px] w-full rounded-xl border border-[#2c3950] bg-black object-contain sm:max-h-[430px]"
                controls
                muted
                playsInline
                preload="metadata"
                onLoadedMetadata={(event) => handleDurationMeasured(selectedClip.video_url || "", event.currentTarget.duration)}
                onError={() => setActionError("The saved source clip could not be previewed in this browser. Its archived lineage is still protected.")}
                aria-label={`Source motion clip for scene ${selectedEntry?.sceneNumber || ""}`}
              />
            )}
            {selectedTake && (
              <audio
                key={selectedTake.asset.audio_url}
                src={selectedTake.asset.audio_url}
                preload="metadata"
                className="pointer-events-none absolute h-px w-px overflow-hidden opacity-0"
                onLoadedMetadata={(event) => handleDurationMeasured(selectedTake.asset.audio_url, event.currentTarget.duration)}
                aria-hidden="true"
              />
            )}
          </div>

          <div className="rounded-2xl border border-[#2a364e] bg-[#141b28] p-4 sm:p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="min-w-0">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-300">03 / Start one render</p>
                <h3 className="mt-1.5 text-lg font-semibold text-white">Generate one lip-sync shot</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-gray-400">
                  This action sends only the selected saved clip and exact dialogue take. It never accepts a manual URL and never starts a batch.
                </p>
              </div>
              <Button
                type="button"
                onClick={() => void handleGenerate()}
                disabled={!canGenerate}
                className="h-auto min-h-11 w-full gap-2 bg-amber-500 px-4 py-2.5 text-sm font-semibold text-black shadow-lg shadow-amber-950/20 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-45 sm:w-auto sm:min-w-[230px]"
              >
                {isStartingLipsync ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                {isStartingLipsync ? "Starting private render..." : "Generate one lip-sync shot"}
              </Button>
            </div>
            <div className="mt-4 rounded-xl border border-[#2c3950] bg-[#0b111b] p-3 text-xs leading-relaxed text-gray-300">
              {blockingReason ? (
                <span className="text-amber-200">{blockingReason}</span>
              ) : eligibilityReason ? (
                <span className="text-amber-200">{eligibilityReason}</span>
              ) : pendingAttempt ? (
                <span className="flex items-start gap-2 text-amber-100"><Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-amber-300" /> This exact shot is already rendering. Status checks continue every few seconds and survive a refresh.</span>
              ) : (
                <span className="flex items-start gap-2 text-emerald-100"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" /> The selected current clip and saved dialogue take are ready for one private proof render.</span>
              )}
            </div>
          </div>
        </div>

        <div className="min-w-0 space-y-5">
          <div className="rounded-2xl border border-[#2a364e] bg-[#101824] p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-emerald-300">04 / Follow the attempt</p>
                <h3 className="mt-1.5 text-lg font-semibold text-white">Private render status</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-gray-400">
                  This history is scoped to Scene {selectedEntry ? formatScene(selectedEntry.sceneNumber) : "--"}, {selectedLine?.line_id || "the chosen line"}, and the selected motion clip.
                </p>
              </div>
              {pendingAttempt && <Loader2 className="mt-1 h-5 w-5 shrink-0 animate-spin text-amber-300" />}
            </div>

            {!latestAttempt ? (
              <div className="mt-5 rounded-xl border border-dashed border-[#36445e] bg-[#0b111b] p-5 text-center">
                <Waves className="mx-auto h-7 w-7 text-gray-500" />
                <p className="mt-3 text-sm font-semibold text-gray-200">No render for this exact pair yet</p>
                <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-gray-500">
                  Start one shot above. Earlier attempts for another source take stay separate and will never be mixed into this proof.
                </p>
              </div>
            ) : (
              <div className="mt-5 space-y-4">
                <div className={`rounded-xl border p-4 ${attemptClass(latestAttempt.status)}`}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${statusDotClass(latestAttempt.status)} ${latestAttempt.status === "PROCESSING" ? "animate-pulse" : ""}`} />
                      <span className="text-xs font-mono uppercase tracking-[0.16em]">Latest attempt · {attemptLabel(latestAttempt.status)}</span>
                    </div>
                    <span className="text-[10px] font-mono text-current/70">{new Date(latestAttempt.updated_at).toLocaleString()}</span>
                  </div>
                  <div className="mt-4 grid gap-2 text-[11px] sm:grid-cols-2">
                    <div className="rounded-lg border border-current/10 bg-black/15 p-2.5">
                      <span className="text-current/60">Prediction</span>
                      <code className="mt-1 block break-all font-mono text-current">{shortId(latestAttempt.prediction_id)}</code>
                    </div>
                    <div className="rounded-lg border border-current/10 bg-black/15 p-2.5">
                      <span className="text-current/60">Source clip</span>
                      <code className="mt-1 block break-all font-mono text-current">{shortId(latestAttempt.source_clip_prediction_id)}</code>
                    </div>
                  </div>
                  {latestAttempt.status === "PROCESSING" && (
                    <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-current/80">
                      <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> The provider is rendering this one shot. The panel checks the saved prediction without touching source media.
                    </p>
                  )}
                  {(latestAttempt.status === "FAILED" || latestAttempt.status === "CANCELED") && latestAttempt.error && (
                    <p className="mt-3 text-xs leading-relaxed text-current/90">{latestAttempt.error}</p>
                  )}
                  {latestAttempt.status === "READY" && isSecureHttpsUrl(latestAttempt.video_url) && (
                    <div className="mt-4 overflow-hidden rounded-xl border border-emerald-400/20 bg-black">
                      <video
                        key={latestAttempt.video_url}
                        src={latestAttempt.video_url}
                        className="aspect-[9/16] max-h-[560px] w-full object-contain"
                        controls
                        playsInline
                        preload="metadata"
                        onError={() => setActionError("The private lip-sync MP4 could not be played in this browser. The saved attempt remains available.")}
                        aria-label={`Lip-sync proof output for scene ${latestAttempt.scene_number}`}
                      />
                    </div>
                  )}
                </div>

                {latestAttempt.status === "READY" && (
                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/10 p-3 text-xs leading-relaxed text-emerald-100/85">
                    <div className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                      <span>This managed MP4 is ready for review. It remains a private proof asset and has not been added to Episode Mix.</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {previousReadyAttempts.length > 0 && (
            <div className="rounded-2xl border border-[#2a364e] bg-[#101824] p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-sky-300">Attempt history</p>
                  <h3 className="mt-1.5 text-lg font-semibold text-white">Earlier ready outputs stay safe</h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-gray-400">
                    A new processing or failed attempt never removes a successful proof from this exact source lineage.
                  </p>
                </div>
                <RefreshCw className="mt-1 h-4 w-4 shrink-0 text-sky-300" />
              </div>
              <div className="mt-4 space-y-3">
                {previousReadyAttempts.map((attempt) => (
                  <div key={attempt.prediction_id} className="rounded-xl border border-[#2e4b43] bg-[#0d1b1a] p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-emerald-200">
                        <CheckCircle2 className="h-3 w-3" /> Ready
                      </span>
                      <span className="text-[10px] font-mono text-gray-500">{new Date(attempt.updated_at).toLocaleString()}</span>
                    </div>
                    <p className="mt-2 text-[11px] text-gray-400">Prediction <code className="font-mono text-gray-300">{shortId(attempt.prediction_id)}</code></p>
                    {isSecureHttpsUrl(attempt.video_url) && (
                      <video
                        key={attempt.video_url}
                        src={attempt.video_url}
                        className="mt-3 aspect-[9/16] max-h-[300px] w-full rounded-lg border border-[#29433f] bg-black object-contain"
                        controls
                        playsInline
                        preload="metadata"
                        aria-label={`Earlier lip-sync proof output for scene ${attempt.scene_number}`}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-[#2a364e] bg-[linear-gradient(145deg,rgba(14,116,144,0.10),rgba(15,23,36,0.96))] p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <div className="rounded-xl border border-sky-500/25 bg-sky-500/10 p-2.5 text-sky-300">
                <Info className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-sky-300">Proof boundary</p>
                <h3 className="mt-1.5 text-base font-semibold text-white">Review before assembly</h3>
                <p className="mt-2 text-xs leading-relaxed text-gray-300">
                  The source motion clip, voice take, and ambience bed remain exactly where they are. This panel only archives and plays the managed lip-synced MP4 for the selected shot. Episode Mix continues to use its existing visual and audio sources until a later assembly decision.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
