import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AudioLines,
  CheckCircle2,
  CircleX,
  Clock3,
  ExternalLink,
  Info,
  Loader2,
  Mic2,
  RefreshCw,
  RotateCcw,
  Volume2,
  WandSparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DialogueAudioAsset,
  DialogueLine,
  DramaManifest,
  ElevenLabsVoice,
  VoiceAssignment,
  deriveDialogueLines,
  getLegacyDialogueLineId,
} from "@/lib/dramaStudio";

export interface AudioTestPanelProps {
  manifest: DramaManifest;
  voiceAssignments?: VoiceAssignment[];
  audioAssets?: DialogueAudioAsset[];
  voices?: ElevenLabsVoice[];
  voiceLoading?: boolean;
  voiceError?: string | null;
  synthesisBusy?: boolean;
  synthesisError?: string | null;
  onLoadVoices: () => void | Promise<void>;
  onGenerateVoiceTake: (input: {
    sceneNumber: number;
    lineId: string;
    characterId: string;
    text: string;
    voice: ElevenLabsVoice;
  }) => boolean | Promise<boolean>;
  onDurationMeasured: (asset: DialogueAudioAsset, durationSeconds: number) => void | Promise<void>;
  authAvailable?: boolean;
  persistedProject?: boolean;
  isDirty?: boolean;
  isCompetingOperation?: boolean;
}

type LineRenderState = "idle" | "rendering" | "saved" | "failed";

const formatSeconds = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) return "Not measured";
  return `${value.toFixed(value >= 10 ? 1 : 2)}s`;
};

const formatLabels = (labels: Record<string, string>): string[] =>
  Object.entries(labels)
    .filter(([, value]) => typeof value === "string" && value.trim())
    .slice(0, 4)
    .map(([key, value]) => `${key.replace(/_/g, " ")}: ${value.trim()}`);

const getAssetLineId = (asset: DialogueAudioAsset): string =>
  asset.line_id?.trim() || getLegacyDialogueLineId(asset.scene_number);

export const AudioTestPanel: React.FC<AudioTestPanelProps> = ({
  manifest,
  voiceAssignments = [],
  audioAssets = [],
  voices = [],
  voiceLoading = false,
  voiceError = null,
  synthesisBusy = false,
  synthesisError = null,
  onLoadVoices,
  onGenerateVoiceTake,
  onDurationMeasured,
  authAvailable = false,
  persistedProject = false,
  isDirty = false,
  isCompetingOperation = false,
}) => {
  const dialogueScenes = useMemo(
    () => manifest.scenes.filter((scene) => deriveDialogueLines(scene).length > 0),
    [manifest.scenes]
  );
  const [selectedSceneNumber, setSelectedSceneNumber] = useState<number | null>(
    dialogueScenes[0]?.scene_number ?? null
  );
  const [voiceSelections, setVoiceSelections] = useState<Record<string, string>>({});
  const [lineStates, setLineStates] = useState<Record<string, LineRenderState>>({});
  const [renderingLineId, setRenderingLineId] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [measuredDurations, setMeasuredDurations] = useState<Record<string, number>>({});
  const durationSentRef = useRef<Record<string, number>>({});

  useEffect(() => {
    const firstScene = dialogueScenes[0];
    setSelectedSceneNumber((current) =>
      current !== null && dialogueScenes.some((scene) => scene.scene_number === current)
        ? current
        : firstScene?.scene_number ?? null
    );
  }, [dialogueScenes]);

  const selectedScene = dialogueScenes.find((scene) => scene.scene_number === selectedSceneNumber) || null;
  const selectedLines = useMemo<DialogueLine[]>(
    () => (selectedScene ? deriveDialogueLines(selectedScene) : []),
    [selectedScene]
  );
  const speakingCharacterIds = useMemo(
    () => Array.from(new Set(selectedLines.map((line) => line.character_id))),
    [selectedLines]
  );

  useEffect(() => {
    const savedByCharacter = new Map(
      voiceAssignments.map((assignment) => [assignment.character_id, assignment.voice_id])
    );
    setVoiceSelections((current) => {
      const next: Record<string, string> = {};
      speakingCharacterIds.forEach((characterId) => {
        next[characterId] = savedByCharacter.get(characterId) || current[characterId] || "";
      });
      return next;
    });
  }, [selectedSceneNumber, speakingCharacterIds, voiceAssignments]);

  const findSavedAsset = (line: DialogueLine): DialogueAudioAsset | null =>
    audioAssets.find((asset) =>
      asset.scene_number === selectedScene?.scene_number &&
      getAssetLineId(asset) === line.line_id &&
      asset.character_id === line.character_id &&
      asset.text === line.text
    ) || null;

  useEffect(() => {
    setLineStates((current) => {
      const next: Record<string, LineRenderState> = {};
      selectedLines.forEach((line) => {
        const saved = findSavedAsset(line);
        next[line.line_id] = saved ? "saved" : current[line.line_id] || "idle";
      });
      return next;
    });
  }, [selectedSceneNumber, selectedLines, audioAssets]);

  const savedCount = selectedLines.filter((line) => Boolean(findSavedAsset(line))).length;
  const selectedVoiceFor = (characterId: string): ElevenLabsVoice | null => {
    const voiceId = voiceSelections[characterId];
    return voices.find((voice) => voice.voice_id === voiceId) || null;
  };
  const allVoicesChosen = Boolean(
    speakingCharacterIds.length > 0 && speakingCharacterIds.every((characterId) => selectedVoiceFor(characterId))
  );
  const basePrerequisitesReady = Boolean(
    authAvailable &&
    persistedProject &&
    !isDirty &&
    !isCompetingOperation &&
    !synthesisBusy &&
    selectedScene &&
    selectedLines.length > 0 &&
    voices.length > 0 &&
    allVoicesChosen
  );
  const renderableLines = selectedLines.filter((line) => !findSavedAsset(line) || lineStates[line.line_id] === "failed");
  const canRenderScene = Boolean(basePrerequisitesReady && renderableLines.length > 0 && !renderingLineId);

  const handleSceneChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const nextSceneNumber = Number(event.target.value);
    setSelectedSceneNumber(Number.isInteger(nextSceneNumber) ? nextSceneNumber : null);
    setRenderError(null);
  };

  const handleVoiceChange = (characterId: string, voiceId: string) => {
    setVoiceSelections((current) => ({ ...current, [characterId]: voiceId }));
    setRenderError(null);
  };

  const handleDurationLoaded = (
    event: React.SyntheticEvent<HTMLAudioElement>,
    asset: DialogueAudioAsset
  ) => {
    const duration = event.currentTarget.duration;
    if (!Number.isFinite(duration) || duration <= 0 || duration > 3600) return;
    const key = asset.audio_url;
    setMeasuredDurations((current) => ({ ...current, [key]: duration }));
    if (Math.abs((durationSentRef.current[key] || 0) - duration) < 0.01) return;
    durationSentRef.current[key] = duration;
    void onDurationMeasured(asset, duration);
  };

  const renderLine = async (line: DialogueLine): Promise<boolean> => {
    const voice = selectedVoiceFor(line.character_id);
    if (!selectedScene || !voice) {
      setRenderError(`Choose an account voice for ${line.character_id} before rendering this line.`);
      return false;
    }
    setRenderError(null);
    setRenderingLineId(line.line_id);
    setLineStates((current) => ({ ...current, [line.line_id]: "rendering" }));
    try {
      const success = await onGenerateVoiceTake({
        sceneNumber: selectedScene.scene_number,
        lineId: line.line_id,
        characterId: line.character_id,
        text: line.text,
        voice,
      });
      if (success) {
        setLineStates((current) => ({ ...current, [line.line_id]: "saved" }));
        return true;
      }
      setLineStates((current) => ({ ...current, [line.line_id]: "failed" }));
      return false;
    } catch (error) {
      console.error("Dialogue line render failed:", error);
      setLineStates((current) => ({ ...current, [line.line_id]: "failed" }));
      setRenderError(`Scene ${selectedScene.scene_number}, line ${line.order} could not be rendered. Retry that line when ready.`);
      return false;
    } finally {
      setRenderingLineId(null);
    }
  };

  const handleRenderScene = async () => {
    if (!canRenderScene) return;
    setRenderError(null);
    for (const line of renderableLines) {
      const success = await renderLine(line);
      if (!success) {
        setRenderError(`Rendering paused at line ${line.order}. Completed lines remain saved, and this line is ready to retry.`);
        break;
      }
    }
  };

  const voiceLabelsByCharacter = useMemo(() => {
    const result: Record<string, string> = {};
    speakingCharacterIds.forEach((characterId) => {
      const voice = selectedVoiceFor(characterId);
      result[characterId] = voice?.name || "No voice selected";
    });
    return result;
  }, [speakingCharacterIds, voiceSelections, voices]);

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-2xl border border-amber-500/35 bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,0.16),transparent_42%),#121926] shadow-xl shadow-black/20">
        <div className="border-b border-amber-500/20 px-4 py-5 sm:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-xs font-mono uppercase tracking-[0.18em] text-amber-300">
                <AudioLines className="h-4 w-4" /> Sound Test / cast pass
                <span className="rounded-md border border-amber-400/35 bg-amber-500/15 px-2 py-1 text-[10px] tracking-wider text-amber-100">
                  Voice only
                </span>
              </div>
              <h2 className="text-2xl font-serif font-bold tracking-tight text-white sm:text-3xl">
                Cast the selected scene, line by line.
              </h2>
              <p className="max-w-2xl text-sm leading-relaxed text-gray-300">
                Assign one account voice to each speaking character, then render only this scene. Every line becomes its own private MP3 as soon as it succeeds, so a later failure never erases completed work.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2 rounded-xl border border-[#33415d] bg-[#0c111b]/80 px-3 py-2.5 text-xs text-gray-300">
              <Mic2 className="h-4 w-4 text-amber-400" /> {savedCount}/{selectedLines.length || 0} lines archived
            </div>
          </div>
        </div>

        <div className="grid gap-4 px-4 py-4 sm:px-6 sm:py-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="space-y-4">
            <label className="block space-y-1.5 text-xs text-gray-300">
              <span className="font-mono uppercase tracking-wider text-gray-400">Scene with saved dialogue</span>
              <select
                value={selectedSceneNumber ?? ""}
                onChange={handleSceneChange}
                disabled={!dialogueScenes.length || synthesisBusy || Boolean(renderingLineId)}
                className="h-10 w-full rounded-lg border border-[#33415d] bg-[#0c111b] px-3 text-sm text-gray-100 outline-none transition-colors focus:border-amber-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="" disabled>{dialogueScenes.length ? "Choose a scene" : "No saved dialogue scenes"}</option>
                {dialogueScenes.map((scene) => (
                  <option key={scene.scene_number} value={scene.scene_number}>
                    Scene {scene.scene_number} · {deriveDialogueLines(scene).length} speaker lines · {scene.duration_seconds}s target
                  </option>
                ))}
              </select>
            </label>

            <div className="rounded-xl border border-[#2a354b] bg-[#0b1019] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-amber-300">
                  <Volume2 className="h-3.5 w-3.5" /> Saved screenplay lines
                </div>
                {selectedScene && (
                  <span className="flex items-center gap-1.5 text-[11px] text-gray-400">
                    <Clock3 className="h-3.5 w-3.5 text-amber-400" /> {selectedScene.duration_seconds}s scene target
                  </span>
                )}
              </div>
              <div className="mt-3 space-y-2">
                {selectedLines.length ? selectedLines.map((line) => (
                  <div key={line.line_id} className="rounded-lg border border-[#27344d] bg-[#111827] p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-[10px] uppercase tracking-wider text-amber-300">
                        Line {String(line.order).padStart(2, "0")} · {line.character_id}
                      </span>
                      <span className="text-[10px] text-gray-600">{line.line_id}</span>
                    </div>
                    <p className="mt-2 font-serif text-base italic leading-relaxed text-amber-100/90">“{line.text}”</p>
                  </div>
                )) : (
                  <p className="text-xs leading-relaxed text-gray-500">Choose a saved screenplay scene to review its speaker lines.</p>
                )}
              </div>
              {selectedScene && selectedLines.length > 1 && (
                <p className="mt-3 flex items-start gap-2 text-[11px] leading-relaxed text-amber-100/70">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                  The compatibility dialogue remains joined for visual and motion stages. Sound Test renders each speaker line separately.
                </p>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-[#2a354b] bg-[#0b1019] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-mono uppercase tracking-wider text-gray-400">Voice casting</p>
                  <p className="mt-1 text-sm font-semibold text-white">One saved voice per speaking character</p>
                </div>
                <WandSparkles className="h-5 w-5 text-amber-400" />
              </div>

              {!voices.length ? (
                <div className="mt-4 rounded-lg border border-dashed border-[#35425d] bg-[#111827] p-3.5">
                  <p className="text-xs leading-relaxed text-gray-400">
                    Load the voices available to this connected ElevenLabs account. The studio keeps the API key on the server.
                  </p>
                  <Button
                    type="button"
                    onClick={() => void onLoadVoices()}
                    disabled={voiceLoading || synthesisBusy || Boolean(renderingLineId)}
                    className="mt-3 h-9 gap-2 bg-amber-500 px-3 text-xs font-semibold text-black hover:bg-amber-600 disabled:opacity-60"
                  >
                    {voiceLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    {voiceLoading ? "Loading account voices..." : "Load account voices"}
                  </Button>
                  {voiceError && (
                    <div className="mt-3 flex items-start gap-2 rounded-md border border-red-800/50 bg-red-950/30 p-2.5 text-[11px] leading-relaxed text-red-200" role="alert">
                      <RotateCcw className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
                      <span>{voiceError} Try loading the account voices again.</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  {speakingCharacterIds.map((characterId) => {
                    const selectedVoice = selectedVoiceFor(characterId);
                    const assignment = voiceAssignments.find((candidate) => candidate.character_id === characterId);
                    const labels = selectedVoice ? formatLabels(selectedVoice.labels || {}) : [];
                    return (
                      <div key={characterId} className="rounded-lg border border-[#2d3a54] bg-[#101622] p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <label htmlFor={`voice-${characterId}`} className="font-mono text-[11px] uppercase tracking-wider text-amber-200">
                            {characterId}
                          </label>
                          <span className={`text-[10px] ${assignment ? "text-emerald-300" : "text-gray-500"}`}>
                            {assignment ? `Saved: ${assignment.voice_name}` : "Choice saves with the next successful line"}
                          </span>
                        </div>
                        <select
                          id={`voice-${characterId}`}
                          value={voiceSelections[characterId] || ""}
                          onChange={(event) => handleVoiceChange(characterId, event.target.value)}
                          disabled={synthesisBusy || Boolean(renderingLineId)}
                          className="mt-2 h-10 w-full rounded-lg border border-[#33415d] bg-[#0c111b] px-3 text-sm text-gray-100 outline-none transition-colors focus:border-amber-500 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <option value="">Choose an account voice</option>
                          {voices.map((voice) => (
                            <option key={voice.voice_id} value={voice.voice_id}>
                              {voice.name}{voice.category ? ` · ${voice.category}` : ""}
                            </option>
                          ))}
                        </select>
                        {selectedVoice && (
                          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-amber-100/70">
                            <span>{selectedVoice.name}</span>
                            {selectedVoice.category && <span>{selectedVoice.category}</span>}
                            {labels.slice(0, 2).map((label) => <span key={label}>{label}</span>)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {voiceError && voices.length > 0 && <p className="mt-3 text-[11px] leading-relaxed text-red-300" role="alert">{voiceError}</p>}
            </div>

            <div className="rounded-xl border border-[#2a354b] bg-[#0b1019] p-4">
              <div className="flex items-start gap-3">
                <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-2 text-amber-300">
                  <Info className="h-4 w-4" />
                </div>
                <div className="space-y-1.5 text-xs leading-relaxed text-gray-400">
                  <p className="font-semibold text-gray-200">Render only when you ask.</p>
                  <p>Sound Test creates one MP3 per saved line. It does not mix tracks or start other scenes. Lip-sync, ambience, Foley, music, captions, and final assembly remain later production phases.</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-amber-500/20 bg-[#0d131e]/80 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="space-y-1 text-xs">
            {!authAvailable ? (
              <p className="text-amber-200/80">Sign in to create private voice lines.</p>
            ) : !persistedProject ? (
              <p className="text-amber-200/80">Save this approved project before creating voice lines.</p>
            ) : isDirty ? (
              <p className="text-amber-200/80">Save screenplay edits before generating audio from the approved lines.</p>
            ) : isCompetingOperation ? (
              <p className="text-amber-200/80">Wait for the current studio operation to finish before creating audio.</p>
            ) : !voices.length ? (
              <p className="text-gray-400">Load account voices to cast the selected scene.</p>
            ) : !allVoicesChosen ? (
              <p className="text-amber-200/80">Choose a voice for every speaking character before rendering the scene.</p>
            ) : (
              <p className="text-gray-400">Completed lines save immediately. A failed line can be retried on its own.</p>
            )}
            {(synthesisError || renderError) && <p className="text-red-300" role="alert">{synthesisError || renderError}</p>}
            <span className="sr-only" aria-live="polite">
              {renderingLineId ? `Rendering line ${renderingLineId}.` : `${savedCount} of ${selectedLines.length} lines saved.`}
            </span>
          </div>
          <Button
            type="button"
            onClick={() => void handleRenderScene()}
            disabled={!canRenderScene}
            className="h-11 w-full gap-2 bg-amber-500 px-5 text-sm font-semibold text-black shadow-md shadow-amber-500/15 hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            {renderingLineId ? <Loader2 className="h-4 w-4 animate-spin" /> : <WandSparkles className="h-4 w-4" />}
            {renderingLineId ? "Rendering selected scene..." : savedCount > 0 ? "Continue scene cast" : "Render selected scene cast"}
          </Button>
        </div>
      </section>

      {selectedScene && selectedLines.length > 0 && (
        <section className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-amber-400">Scene {selectedScene.scene_number} archive</p>
              <h3 className="mt-1 text-xl font-serif font-bold text-white">Private line takes</h3>
            </div>
            <p className="text-xs text-gray-500">{savedCount} of {selectedLines.length} lines have managed MP3s</p>
          </div>

          <div className="grid gap-3">
            {selectedLines.map((line) => {
              const asset = findSavedAsset(line);
              const state = lineStates[line.line_id] || (asset ? "saved" : "idle");
              const measuredDuration = asset
                ? measuredDurations[asset.audio_url] ?? asset.duration_seconds
                : undefined;
              const selectedVoice = selectedVoiceFor(line.character_id);
              const lineError = state === "failed";
              const voiceLabels = selectedVoice ? formatLabels(selectedVoice.labels || {}) : [];
              return (
                <article key={line.line_id} className={`overflow-hidden rounded-2xl border bg-[#101622] shadow-lg shadow-black/15 ${lineError ? "border-red-700/50" : asset ? "border-emerald-700/35" : "border-[#263149]"}`}>
                  <div className="flex flex-col gap-3 border-b border-[#202b42] px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-amber-200">
                          Line {String(line.order).padStart(2, "0")}
                        </span>
                        <span className="font-mono text-[11px] text-gray-300">{line.character_id}</span>
                        {state === "rendering" && <span className="flex items-center gap-1 text-[10px] text-amber-300"><Loader2 className="h-3 w-3 animate-spin" /> Rendering</span>}
                        {state === "saved" && <span className="flex items-center gap-1 text-[10px] text-emerald-300"><CheckCircle2 className="h-3 w-3" /> Saved privately</span>}
                        {lineError && <span className="flex items-center gap-1 text-[10px] text-red-300"><CircleX className="h-3 w-3" /> Retry available</span>}
                      </div>
                      <p className="max-w-3xl font-serif text-base italic leading-relaxed text-amber-100/90">“{line.text}”</p>
                      <p className="font-mono text-[9px] uppercase tracking-wider text-gray-600">{line.line_id}</p>
                    </div>
                    <Button
                      type="button"
                      onClick={() => void renderLine(line)}
                      disabled={!basePrerequisitesReady || Boolean(renderingLineId) || !selectedVoice}
                      className={`h-9 shrink-0 gap-1.5 px-3 text-xs font-semibold ${asset ? "border border-amber-500/35 bg-amber-500/10 text-amber-100 hover:bg-amber-500/20" : "bg-amber-500 text-black hover:bg-amber-600"} disabled:cursor-not-allowed disabled:opacity-45`}
                    >
                      {state === "rendering" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : asset ? <RotateCcw className="h-3.5 w-3.5" /> : <WandSparkles className="h-3.5 w-3.5" />}
                      {state === "rendering" ? "Rendering" : asset ? "Retry line" : "Render line"}
                    </Button>
                  </div>

                  <div className="grid gap-3 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,1fr)_190px]">
                    <div className="rounded-xl border border-[#263149] bg-[#0b1019] p-3">
                      {asset ? (
                        <>
                          <audio
                            key={asset.audio_url}
                            className="w-full"
                            src={asset.audio_url}
                            controls
                            preload="metadata"
                            onLoadedMetadata={(event) => handleDurationLoaded(event, asset)}
                          >
                            Your browser can play this managed audio asset.
                          </audio>
                          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-400">
                            <span>Voice: {asset.voice_name}</span>
                            <span>Format: {asset.content_type}</span>
                            <span>Duration: {formatSeconds(measuredDuration || 0)}</span>
                          </div>
                          <a
                            href={asset.audio_url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-emerald-200 transition-colors hover:text-white"
                          >
                            <ExternalLink className="h-3 w-3" /> Open managed MP3
                          </a>
                        </>
                      ) : (
                        <p className="text-xs leading-relaxed text-gray-500">This line has no archived take yet. Choose its character voice, then render it or render the selected scene.</p>
                      )}
                    </div>
                    <div className="rounded-xl border border-[#263149] bg-[#0d131e] p-3">
                      <p className="text-[10px] font-mono uppercase tracking-wider text-gray-500">Assigned voice</p>
                      <p className="mt-2 text-sm font-semibold text-gray-200">{asset?.voice_name || voiceLabelsByCharacter[line.character_id]}</p>
                      {voiceLabels.length > 0 && <p className="mt-1 text-[10px] leading-relaxed text-gray-500">{voiceLabels.slice(0, 2).join(" · ")}</p>}
                      {asset && <p className="mt-3 border-t border-[#253047] pt-3 text-xs text-gray-400">Browser-measured duration: <span className="font-mono text-gray-200">{formatSeconds(measuredDuration || 0)}</span></p>}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {!dialogueScenes.length && (
        <div className="rounded-xl border border-amber-700/35 bg-amber-950/20 p-4 text-sm text-amber-100/85">
          Add and save at least one speaker line in the approved screenplay before opening a voice test.
        </div>
      )}
    </div>
  );
};
