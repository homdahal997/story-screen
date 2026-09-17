import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Info,
  Loader2,
  LockKeyhole,
  RefreshCw,
  Sparkles,
  Volume2,
  Waves,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  AmbienceAudioAsset,
  DramaManifest,
  DramaScene,
} from "@/lib/dramaStudio";

const MIN_DURATION_SECONDS = 3;
const MAX_DURATION_SECONDS = 20;
const DEFAULT_DURATION_SECONDS = 10;
// ElevenLabs allows 450 final characters, so leave room for server-side room-tone guidance.
const MAX_AMBIENCE_USER_PROMPT_LENGTH = 330;

export interface SceneAmbiencePanelProps {
  manifest: DramaManifest;
  globalStyle?: string;
  ambienceAssets?: AmbienceAudioAsset[];
  ambienceBusy?: boolean;
  ambienceError?: string | null;
  onGenerateAmbience?: (request: {
    sceneNumber: number;
    prompt: string;
    durationSeconds: number;
  }) => Promise<boolean | void> | boolean | void;
  authAvailable?: boolean;
  persistedProject?: boolean;
  isDirty?: boolean;
  isSaving?: boolean;
  isApproving?: boolean;
  isGeneratingFrames?: boolean;
  isPollingMotion?: boolean;
  isSynthesizingVoice?: boolean;
}

function mediaTimestamp(value: { updated_at?: string; created_at?: string }): number {
  const updated = Date.parse(value.updated_at || "");
  if (Number.isFinite(updated)) return updated;
  const created = Date.parse(value.created_at || "");
  return Number.isFinite(created) ? created : 0;
}

function formatScene(sceneNumber: number): string {
  return String(sceneNumber).padStart(2, "0");
}

function trimPromptAtWordBoundary(value: string, maxLength: number): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxLength) return normalized;

  const ellipsis = "…";
  const candidate = normalized.slice(0, Math.max(1, maxLength - ellipsis.length)).trimEnd();
  const boundary = candidate.lastIndexOf(" ");
  const minimumBoundary = Math.max(3, Math.floor(maxLength * 0.55));
  const safePrefix = boundary >= minimumBoundary ? candidate.slice(0, boundary) : candidate;
  return `${safePrefix.trimEnd()}${ellipsis}`.slice(0, maxLength);
}

function buildSuggestedPrompt(scene: DramaScene, globalStyle: string): string {
  const visualPrompt = scene.visual_prompt.trim().replace(/\s+/g, " ");
  const style = globalStyle.trim().replace(/\s+/g, " ");
  const setting = visualPrompt || "the saved screenplay setting";
  const styleContext = style ? ` Visual style context: ${style}.` : "";
  const prompt = `Room tone and environmental ambience for Scene ${formatScene(scene.scene_number)}: ${setting}.${styleContext} Subtle, continuous atmosphere that supports the scene without drawing focus.`;
  return trimPromptAtWordBoundary(prompt, MAX_AMBIENCE_USER_PROMPT_LENGTH);
}

function findLatestAmbience(assets: AmbienceAudioAsset[], sceneNumber: number): AmbienceAudioAsset | null {
  return [...assets]
    .filter((asset) =>
      asset.asset_type === "ambience" &&
      asset.provider === "elevenlabs" &&
      asset.status === "READY" &&
      asset.scene_number === sceneNumber &&
      asset.content_type === "audio/mpeg" &&
      typeof asset.audio_url === "string" &&
      asset.audio_url.startsWith("https://")
    )
    .sort((left, right) => mediaTimestamp(right) - mediaTimestamp(left))[0] || null;
}

export const SceneAmbiencePanel: React.FC<SceneAmbiencePanelProps> = ({
  manifest,
  globalStyle = "",
  ambienceAssets = [],
  ambienceBusy = false,
  ambienceError = null,
  onGenerateAmbience,
  authAvailable = false,
  persistedProject = false,
  isDirty = false,
  isSaving = false,
  isApproving = false,
  isGeneratingFrames = false,
  isPollingMotion = false,
  isSynthesizingVoice = false,
}) => {
  const scenes = useMemo(
    () => (Array.isArray(manifest?.scenes) ? [...manifest.scenes].sort((left, right) => left.scene_number - right.scene_number) : []),
    [manifest]
  );
  const safeAssets = useMemo(() => (Array.isArray(ambienceAssets) ? ambienceAssets : []), [ambienceAssets]);
  const [selectedSceneNumber, setSelectedSceneNumber] = useState<number | null>(null);
  const [prompt, setPrompt] = useState("");
  const [durationSeconds, setDurationSeconds] = useState(DEFAULT_DURATION_SECONDS);
  const [localError, setLocalError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    setSelectedSceneNumber((current) => {
      if (current !== null && scenes.some((scene) => scene.scene_number === current)) return current;
      return scenes[0]?.scene_number ?? null;
    });
  }, [scenes]);

  const selectedScene = scenes.find((scene) => scene.scene_number === selectedSceneNumber) || null;
  const suggestedPrompt = selectedScene ? buildSuggestedPrompt(selectedScene, globalStyle || manifest?.global_style || "") : "";
  const selectedAsset = selectedSceneNumber === null ? null : findLatestAmbience(safeAssets, selectedSceneNumber);

  useEffect(() => {
    if (!selectedScene) {
      setPrompt("");
      return;
    }
    setPrompt(suggestedPrompt);
    setLocalError(null);
  }, [selectedScene?.scene_number, selectedScene?.visual_prompt, globalStyle, manifest?.global_style]);

  const blockingReason = isDirty
    ? "Save screenplay edits before generating or reviewing ambience."
    : isSaving
      ? "Ambience controls are paused while the project is saving."
      : isApproving
        ? "Ambience controls are paused while screenplay approval is being recorded."
        : isGeneratingFrames
          ? "Ambience controls are paused while visual references are being generated."
          : isPollingMotion
            ? "Ambience controls are paused while a motion test is being checked."
            : isSynthesizingVoice
              ? "Ambience controls are paused while a voice take is being synthesized."
              : ambienceBusy
                ? "Generating one ambience bed for the selected scene."
                : !authAvailable
                  ? "Sign in to generate a private ambience bed."
                  : !persistedProject
                    ? "Save this project before generating a private ambience bed."
                    : null;
  const controlsDisabled = Boolean(blockingReason);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    try {
      audio.currentTime = 0;
    } catch {
      // The browser may not expose a seekable timeline before metadata loads.
    }
  }, [selectedSceneNumber, blockingReason, selectedAsset?.audio_url]);

  const handleDurationChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = Number(event.target.value);
    if (!Number.isFinite(next)) return;
    setDurationSeconds(Math.min(MAX_DURATION_SECONDS, Math.max(MIN_DURATION_SECONDS, Math.round(next))));
  };

  const handleGenerate = async () => {
    if (controlsDisabled || !selectedScene || !onGenerateAmbience) return;
    const cleanPrompt = prompt.trim();
    if (cleanPrompt.length < 3 || cleanPrompt.length > MAX_AMBIENCE_USER_PROMPT_LENGTH) {
      setLocalError(`Keep the ambience prompt between 3 and ${MAX_AMBIENCE_USER_PROMPT_LENGTH} characters.`);
      return;
    }
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(cleanPrompt)) {
      setLocalError("Remove unsupported control characters from the ambience prompt.");
      return;
    }
    setLocalError(null);
    await onGenerateAmbience({
      sceneNumber: selectedScene.scene_number,
      prompt: cleanPrompt,
      durationSeconds,
    });
  };

  const selectedStatus = selectedAsset ? "Saved ambience" : "No ambience saved";

  return (
    <section
      className="overflow-hidden rounded-2xl border border-amber-500/[0.35] bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,0.16),transparent_42%),#101722] shadow-xl shadow-black/20"
      aria-labelledby="scene-ambience-title"
    >
      <div className="border-b border-amber-500/20 px-4 py-5 sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs font-mono uppercase tracking-[0.18em] text-amber-300">
              <Waves className="h-4 w-4" aria-hidden="true" /> Ambience bed
              <span className="rounded-md border border-[#46536b] bg-[#0c111b] px-2 py-1 text-[10px] tracking-wider text-gray-300">One scene at a time</span>
              <span className="rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2 py-1 text-[10px] tracking-wider text-emerald-200">Private archive</span>
            </div>
            <h2 id="scene-ambience-title" className="text-2xl font-serif font-bold tracking-tight text-white sm:text-3xl">
              Give one scene a place to breathe.
            </h2>
            <p className="max-w-2xl text-sm leading-relaxed text-gray-300">
              Generate a short room-tone or environmental bed from the saved screenplay scene, then hear it under the dialogue in Scene Mix Proof. The render stays separate from voice takes and never changes the screenplay or visual media.
            </p>
          </div>
          <div className="grid shrink-0 grid-cols-2 gap-2 text-xs sm:min-w-[250px]">
            <div className="rounded-xl border border-[#33415d] bg-[#0b1019]/80 p-3">
              <p className="font-mono uppercase tracking-wider text-gray-500">Saved beds</p>
              <p className="mt-1 text-lg font-semibold text-emerald-200">{safeAssets.length}</p>
              <p className="mt-1 text-[10px] leading-relaxed text-gray-500">Latest valid bed per scene</p>
            </div>
            <div className="rounded-xl border border-[#33415d] bg-[#0b1019]/80 p-3">
              <p className="font-mono uppercase tracking-wider text-gray-500">Default bed</p>
              <p className="mt-1 text-lg font-semibold text-amber-200">{DEFAULT_DURATION_SECONDS}s</p>
              <p className="mt-1 text-[10px] leading-relaxed text-gray-500">Temporary browser mix</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[minmax(0,0.82fr)_minmax(320px,1.18fr)]">
        <div className="space-y-4">
          <label htmlFor="scene-ambience-scene" className="block space-y-1.5 text-xs text-gray-300">
            <span className="font-mono uppercase tracking-wider text-gray-400">Scene to generate</span>
            <select
              id="scene-ambience-scene"
              value={selectedSceneNumber ?? ""}
              onChange={(event) => setSelectedSceneNumber(Number(event.target.value))}
              disabled={!scenes.length || controlsDisabled}
              className="h-11 w-full rounded-lg border border-[#33415d] bg-[#0b1019] px-3 text-sm text-gray-100 outline-none transition-colors focus:border-amber-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="" disabled>{scenes.length ? "Choose a screenplay scene" : "No screenplay scenes available"}</option>
              {scenes.map((scene) => {
                const saved = findLatestAmbience(safeAssets, scene.scene_number);
                return (
                  <option key={scene.scene_number} value={scene.scene_number}>
                    Scene {formatScene(scene.scene_number)} · {saved ? "Saved ambience" : "No ambience"}
                  </option>
                );
              })}
            </select>
          </label>

          <div className="rounded-xl border border-[#2b3850] bg-[#0b1019] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-amber-300">
                <Volume2 className="h-3.5 w-3.5" aria-hidden="true" /> Scene {selectedScene ? formatScene(selectedScene.scene_number) : "--"}
              </div>
              <span className={`rounded-md border px-2 py-1 text-[10px] font-mono uppercase tracking-wider ${selectedAsset ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-[#33415d] bg-[#151d2c] text-gray-400"}`}>
                {selectedStatus}
              </span>
            </div>
            {selectedScene ? (
              <p className="mt-3 text-xs leading-relaxed text-gray-400">{selectedScene.visual_prompt || "The saved scene has no visual setting prompt yet."}</p>
            ) : (
              <p className="mt-3 text-xs leading-relaxed text-gray-500">Choose a saved screenplay scene to prepare its room tone.</p>
            )}
          </div>

          <div className="rounded-xl border border-amber-500/25 bg-amber-950/15 p-4">
            <div className="flex items-start gap-3">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
              <div className="space-y-1.5 text-xs leading-relaxed text-amber-100/80">
                <p className="font-semibold text-amber-200">Room tone and ambience only</p>
                <p>The prompt is guided toward subtle environmental sound. This pass excludes speech, dialogue, vocals, music, melody, lyrics, and singing.</p>
                <p>Generate affects only the selected scene. Open another scene and click Generate again when you want a separate bed. There is no batch action.</p>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-[#2b3850] bg-[#0b1019] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-amber-400">Generation brief</p>
                <p className="mt-1 text-xs leading-relaxed text-gray-500">Edit the suggested setting before creating this scene’s single ambience bed.</p>
              </div>
              <Sparkles className="h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
            </div>
            <label htmlFor="scene-ambience-prompt" className="mt-4 block text-xs font-medium text-gray-300">
              Ambience prompt
              <Textarea
                id="scene-ambience-prompt"
                value={prompt}
                maxLength={MAX_AMBIENCE_USER_PROMPT_LENGTH}
                onChange={(event) => setPrompt(event.target.value)}
                disabled={controlsDisabled || !selectedScene}
                rows={7}
                className="mt-2 resize-y border-[#33415d] bg-[#101622] text-sm leading-relaxed text-gray-100 focus-visible:ring-amber-500/40 disabled:cursor-not-allowed disabled:opacity-60"
                placeholder="Describe the room tone or environmental bed for this scene"
              />
            </label>
            <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-gray-500">
              <span>Up to {MAX_AMBIENCE_USER_PROMPT_LENGTH} characters; room-tone guidance is added automatically</span>
              <span>{prompt.length}/{MAX_AMBIENCE_USER_PROMPT_LENGTH}</span>
            </div>

            <label htmlFor="scene-ambience-duration" className="mt-4 block text-xs font-medium text-gray-300">
              Bed duration
              <div className="mt-2 flex items-center gap-3">
                <input
                  id="scene-ambience-duration"
                  type="number"
                  min={MIN_DURATION_SECONDS}
                  max={MAX_DURATION_SECONDS}
                  step="1"
                  value={durationSeconds}
                  onChange={handleDurationChange}
                  disabled={controlsDisabled || !selectedScene}
                  className="h-10 w-24 rounded-lg border border-[#33415d] bg-[#101622] px-3 text-sm text-gray-100 outline-none transition-colors focus:border-amber-500 disabled:cursor-not-allowed disabled:opacity-60"
                />
                <span className="text-xs text-gray-500">seconds, from {MIN_DURATION_SECONDS} to {MAX_DURATION_SECONDS}</span>
              </div>
            </label>

            {(localError || ambienceError) && (
              <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-700/35 bg-red-950/20 p-3 text-xs leading-relaxed text-red-100/90" role="alert">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-300" aria-hidden="true" />
                <span>{localError || ambienceError}</span>
              </div>
            )}

            {blockingReason && (
              <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-700/35 bg-amber-950/20 p-3 text-xs leading-relaxed text-amber-100/85" role="status">
                {ambienceBusy ? <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-amber-300" aria-hidden="true" /> : <LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" aria-hidden="true" />}
                <span>{blockingReason}</span>
              </div>
            )}

            <Button
              type="button"
              onClick={() => void handleGenerate()}
              disabled={controlsDisabled || !selectedScene || !prompt.trim() || !onGenerateAmbience}
              className="mt-4 h-11 w-full gap-2 bg-amber-500 text-xs font-semibold text-black hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {ambienceBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : selectedAsset ? <RefreshCw className="h-4 w-4" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
              {ambienceBusy ? `Generating Scene ${selectedScene ? formatScene(selectedScene.scene_number) : ""} ambience...` : selectedAsset ? "Regenerate this scene" : "Generate this scene"}
            </Button>
          </div>

          {selectedAsset ? (
            <div className="rounded-xl border border-emerald-500/25 bg-emerald-950/10 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-emerald-200">
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Saved ambience bed
                </div>
                <span className="rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-emerald-200">READY</span>
              </div>
              <audio
                ref={audioRef}
                src={selectedAsset.audio_url}
                controls
                preload="metadata"
                className="mt-4 w-full accent-amber-400"
                aria-label={`Saved ambience bed for Scene ${formatScene(selectedAsset.scene_number)}`}
              />
              <div className="mt-3 grid gap-2 text-[11px] text-gray-400 sm:grid-cols-2">
                <p className="flex items-center gap-2"><Clock3 className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" /> {selectedAsset.duration_seconds.toFixed(1)} seconds requested</p>
                <p className="flex items-center gap-2"><LockKeyhole className="h-3.5 w-3.5 text-emerald-300" aria-hidden="true" /> Managed private MP3 archive</p>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-gray-500">This player is read-only. Scene Mix Proof can loop this bed under saved dialogue without saving a volume or playback setting.</p>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-[#33415d] bg-[#0b1019] p-4">
              <p className="text-xs font-semibold text-gray-300">No ambience saved for this scene</p>
              <p className="mt-1.5 text-xs leading-relaxed text-gray-500">The scene mix will remain dialogue-only until you generate and save a bed here.</p>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-[#202b40] bg-[#0a0e16]/70 px-4 py-3 text-[11px] leading-relaxed text-gray-500 sm:px-6">
        <div className="flex items-start gap-2"><Waves className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400/80" aria-hidden="true" /><p>Only the generated MP3 URL and ambience metadata are saved. Local volume, playback position, and mix settings remain temporary browser controls.</p></div>
      </div>
    </section>
  );
};
