import { elevenLabsVoice, replicateLipsync, pixverseLipsync, replicateLumaVideo } from "@/functions";
import {
  findDialogueLine,
  findNewestReadyDialogueAudio,
  findNewestReadyDialogueCloseup,
  normalizeDialogueAudioAssets,
  normalizeDialogueShotClips,
  normalizeLipsyncAssets,
  normalizeVoiceAssignments,
  replaceLatestDialogueAudioAsset,
  updateLipsyncAsset,
  upsertDialogueShotClip,
  upsertLipsyncAsset,
  upsertVoiceAssignment,
  validateManifest,
} from "@/lib/dramaStudio";
import type {
  DialogueAudioAsset,
  DialogueLine,
  DialogueShotClip,
  DialogueShotSourceFrameType,
  DramaManifest,
  ElevenLabsVoice,
  FrameAsset,
  LipsyncAsset,
  VoiceAssignment,
} from "@/lib/dramaStudio";

const VOICE_ID_PATTERN = /^[A-Za-z0-9_-]{1,180}$/;
const CANCELED_MESSAGE =
  "Voice coverage canceled because the active scene or run is no longer current.";
const CLOSEUP_CANCELED_MESSAGE =
  "Dialogue close-up coverage canceled because the active scene or run is no longer current.";

/**
 * The stable screenplay identity passed from the sequential coverage runner.
 * The adapter deliberately requires the saved text and speaker so it cannot
 * invent dialogue or silently bind a take to another line.
 */
export interface SceneCoverageLine {
  readonly sceneNumber: number;
  readonly lineId: string;
  readonly characterId: string;
  readonly text: string;
  readonly order?: number;
}

/**
 * A narrow project snapshot keeps this module independent from page state while
 * leaving the later close-up and lip-sync stages a shared handoff shape.
 */
export interface SceneCoverageSnapshot {
  readonly manifest: DramaManifest | null;
  readonly scene_count?: number;
  readonly frame_assets?: FrameAsset[];
  readonly voice_assignments?: VoiceAssignment[];
  readonly audio_assets?: DialogueAudioAsset[];
  readonly dialogue_shot_clips?: DialogueShotClip[];
  readonly lipsync_assets?: LipsyncAsset[];
}

/**
 * Patches use the persisted project field names so a caller can pass them to
 * its existing project update boundary without translating provider data.
 */
export interface SceneCoveragePatch {
  readonly voice_assignments?: VoiceAssignment[];
  readonly audio_assets?: DialogueAudioAsset[];
  readonly dialogue_shot_clips?: DialogueShotClip[];
  readonly lipsync_assets?: LipsyncAsset[];
}

export interface VoiceCoverageAdapterDependencies {
  readonly projectId: string;
  readonly getSnapshot: () => SceneCoverageSnapshot | PromiseLike<SceneCoverageSnapshot>;
  readonly persistPatch: (
    patch: SceneCoveragePatch
  ) => void | PromiseLike<void>;
  readonly getAccountVoices: () =>
    | readonly ElevenLabsVoice[]
    | PromiseLike<readonly ElevenLabsVoice[]>;
  readonly isCurrent: () => boolean | PromiseLike<boolean>;
}

export interface VoiceCoverageAdapter {
  /** Ensure one canonical line has a current READY ElevenLabs MP3. */
  readonly ensureVoiceAsset: (
    line: SceneCoverageLine,
    currentAsset?: DialogueAudioAsset | null
  ) => Promise<DialogueAudioAsset>;
}

/** Raised when a provider result or save finishes after the active run changed. */
export class SceneCoverageCanceledError extends Error {
  readonly code = "SCENE_COVERAGE_CANCELED";

  constructor(message = CANCELED_MESSAGE) {
    super(message);
    this.name = "SceneCoverageCanceledError";
  }
}

function isManagedHttpsAudioUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    return new URL(value.trim()).protocol === "https:";
  } catch {
    return false;
  }
}

function normalizedContentType(value: unknown): string {
  return typeof value === "string"
    ? value.split(";", 1)[0].trim().toLowerCase()
    : "";
}

function normalizeAccountVoice(value: unknown): ElevenLabsVoice | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const voiceId = typeof source.voice_id === "string" ? source.voice_id.trim() : "";
  const name = typeof source.name === "string" ? source.name.trim() : "";
  if (!VOICE_ID_PATTERN.test(voiceId) || !name) return null;

  const labels: Record<string, string> = {};
  if (source.labels && typeof source.labels === "object") {
    Object.entries(source.labels as Record<string, unknown>).forEach(([key, label]) => {
      if (typeof label === "string" && label.trim()) {
        labels[key.slice(0, 80)] = label.trim().slice(0, 120);
      }
    });
  }

  return {
    voice_id: voiceId,
    name: name.slice(0, 180),
    category:
      typeof source.category === "string" && source.category.trim()
        ? source.category.trim().slice(0, 120)
        : null,
    description:
      typeof source.description === "string" && source.description.trim()
        ? source.description.trim().slice(0, 500)
        : null,
    labels,
  };
}

function firstAvailableAccountVoice(raw: unknown): ElevenLabsVoice | null {
  if (!Array.isArray(raw)) return null;
  const seenVoiceIds = new Set<string>();
  for (const value of raw) {
    const voice = normalizeAccountVoice(value);
    if (!voice || seenVoiceIds.has(voice.voice_id)) continue;
    seenVoiceIds.add(voice.voice_id);
    return voice;
  }
  return null;
}

function validatedManifest(snapshot: SceneCoverageSnapshot): DramaManifest {
  const validation = validateManifest(snapshot.manifest, snapshot.scene_count);
  if (!validation.valid || !validation.manifest) {
    throw new Error(validation.error || "The saved screenplay is not valid for voice coverage.");
  }
  return validation.manifest;
}

function resolveCanonicalLine(
  snapshot: SceneCoverageSnapshot,
  input: SceneCoverageLine
): { manifest: DramaManifest; line: DialogueLine } {
  if (!Number.isInteger(input.sceneNumber) || input.sceneNumber < 1) {
    throw new Error("Voice coverage requires a valid saved scene number.");
  }
  if (!input.lineId || !input.characterId || !input.text) {
    throw new Error("Voice coverage requires the saved line ID, speaker, and text.");
  }

  const manifest = validatedManifest(snapshot);
  const scene = manifest.scenes.find(
    (candidate) => candidate.scene_number === input.sceneNumber
  );
  if (!scene) {
    throw new Error(`Scene ${input.sceneNumber} is not in the current saved screenplay.`);
  }

  const canonicalLine = findDialogueLine(scene, input.lineId);
  if (
    !canonicalLine ||
    canonicalLine.line_id !== input.lineId ||
    canonicalLine.character_id !== input.characterId ||
    canonicalLine.text !== input.text ||
    (input.order !== undefined && canonicalLine.order !== input.order)
  ) {
    throw new Error(
      "The saved speaker line changed. Refresh the project and use the current screenplay line."
    );
  }

  return { manifest, line: canonicalLine };
}

function assertResponseLineage(
  response: Awaited<ReturnType<typeof elevenLabsVoice>>,
  input: SceneCoverageLine,
  canonicalLine: DialogueLine,
  assignment: VoiceAssignment
): string {
  if (response.ok === false) {
    throw new Error(response.error || "The voice service rejected this dialogue take.");
  }
  if (response.error) throw new Error(response.error);
  if (!isManagedHttpsAudioUrl(response.audio_url)) {
    throw new Error(
      "The voice service did not return a secure managed audio URL. Your previous take is still safe."
    );
  }
  if (normalizedContentType(response.content_type) !== "audio/mpeg") {
    throw new Error(
      "The voice service returned an unsupported audio format. Your previous take is still safe."
    );
  }
  if (response.scene_number !== input.sceneNumber) {
    throw new Error(
      "The returned voice take did not match the selected scene. Your previous take is still safe."
    );
  }
  if (response.line_id !== canonicalLine.line_id) {
    throw new Error(
      "The returned voice take did not match the selected scene line. Your previous take is still safe."
    );
  }
  if (response.character_id !== canonicalLine.character_id) {
    throw new Error(
      "The returned voice take did not match the selected speaker. Your previous take is still safe."
    );
  }
  if (response.voice_id !== assignment.voice_id) {
    throw new Error(
      "The returned voice take did not match the selected account voice. Your previous take is still safe."
    );
  }
  if (response.voice_name !== assignment.voice_name) {
    throw new Error(
      "The returned voice take did not match the selected voice name. Your previous take is still safe."
    );
  }
  if (
    response.text_length !== undefined &&
    response.text_length !== canonicalLine.text.length
  ) {
    throw new Error(
      "The returned voice take did not match the saved dialogue text. Your previous take is still safe."
    );
  }

  return response.audio_url.trim();
}

function hasExactAssignment(
  assignments: readonly VoiceAssignment[],
  characterId: string,
  voiceId: string
): boolean {
  return assignments.some(
    (assignment) =>
      assignment.character_id === characterId && assignment.voice_id === voiceId
  );
}

/**
 * Build the voice stage used by the sequential scene runner. The adapter reads
 * the current project before each decision, persists a new character assignment
 * before its first synthesis, and saves each READY MP3 as soon as it returns.
 */
export function createVoiceCoverageAdapter(
  dependencies: VoiceCoverageAdapterDependencies
): VoiceCoverageAdapter {
  const projectId = dependencies.projectId.trim();

  const assertCurrent = async (): Promise<void> => {
    if (!(await dependencies.isCurrent())) {
      throw new SceneCoverageCanceledError();
    }
  };

  const readSnapshot = async (): Promise<SceneCoverageSnapshot> => {
    await assertCurrent();
    const snapshot = await dependencies.getSnapshot();
    await assertCurrent();
    if (!snapshot || typeof snapshot !== "object") {
      throw new Error("The current project snapshot is unavailable for voice coverage.");
    }
    return snapshot;
  };

  const currentProviderCall = async <T>(operation: () => T | PromiseLike<T>): Promise<T> => {
    await assertCurrent();
    const result = await operation();
    await assertCurrent();
    return result;
  };

  const persistCurrentPatch = async (patch: SceneCoveragePatch): Promise<void> => {
    await assertCurrent();
    await dependencies.persistPatch(patch);
    await assertCurrent();
  };

  const ensureVoiceAsset = async (
    input: SceneCoverageLine,
    _currentAsset?: DialogueAudioAsset | null
  ): Promise<DialogueAudioAsset> => {
    if (!projectId) throw new Error("Voice coverage requires a saved project ID.");

    let snapshot = await readSnapshot();
    let resolved = resolveCanonicalLine(snapshot, input);
    let manifest = resolved.manifest;
    let canonicalLine = resolved.line;
    let assignments = normalizeVoiceAssignments(
      snapshot.voice_assignments || [],
      manifest
    );
    let assignment = assignments.find(
      (candidate) => candidate.character_id === canonicalLine.character_id
    );

    if (!assignment) {
      const accountVoices = await currentProviderCall(() =>
        dependencies.getAccountVoices()
      );
      const selectedVoice = firstAvailableAccountVoice(accountVoices);
      if (!selectedVoice) {
        throw new Error(
          "No usable account voice is available. Load the private ElevenLabs voice library and retry."
        );
      }

      // Re-read after the account lookup so a concurrent assignment wins over
      // the fallback voice and cannot be overwritten by this run.
      snapshot = await readSnapshot();
      resolved = resolveCanonicalLine(snapshot, input);
      manifest = resolved.manifest;
      canonicalLine = resolved.line;
      assignments = normalizeVoiceAssignments(
        snapshot.voice_assignments || [],
        manifest
      );
      assignment = assignments.find(
        (candidate) => candidate.character_id === canonicalLine.character_id
      );

      if (!assignment) {
        const nextAssignment: VoiceAssignment = {
          character_id: canonicalLine.character_id,
          voice_id: selectedVoice.voice_id,
          voice_name: selectedVoice.name,
          updated_at: new Date().toISOString(),
        };
        const nextAssignments = normalizeVoiceAssignments(
          upsertVoiceAssignment(assignments, nextAssignment),
          manifest
        );
        if (
          !hasExactAssignment(
            nextAssignments,
            canonicalLine.character_id,
            selectedVoice.voice_id
          )
        ) {
          throw new Error(
            "The fallback account voice could not be validated against the saved character."
          );
        }
        await persistCurrentPatch({ voice_assignments: nextAssignments });
        assignment = nextAssignment;
      }
    }

    if (!assignment) {
      throw new Error("A saved voice assignment could not be resolved for this speaker.");
    }

    // Confirm the current screenplay still points at the same canonical line
    // after assignment persistence and immediately before synthesis.
    snapshot = await readSnapshot();
    resolved = resolveCanonicalLine(snapshot, input);
    manifest = resolved.manifest;
    canonicalLine = resolved.line;
    const latestAssignments = normalizeVoiceAssignments(
      snapshot.voice_assignments || [],
      manifest
    );
    const latestAssignment = latestAssignments.find(
      (candidate) => candidate.character_id === canonicalLine.character_id
    );
    if (latestAssignment) assignment = latestAssignment;

    const response = await currentProviderCall(() =>
      elevenLabsVoice({
        operation: "synthesize_dialogue",
        project_id: projectId,
        scene_number: input.sceneNumber,
        line_id: canonicalLine.line_id,
        character_id: canonicalLine.character_id,
        voice_id: assignment.voice_id,
        voice_name: assignment.voice_name,
        dialogue: canonicalLine.text,
      })
    );
    const audioUrl = assertResponseLineage(
      response,
      input,
      canonicalLine,
      assignment
    );

    // Build the patch from the newest normalized array so an earlier line's
    // READY take remains intact when this line is saved.
    snapshot = await readSnapshot();
    resolved = resolveCanonicalLine(snapshot, input);
    manifest = resolved.manifest;
    canonicalLine = resolved.line;
    const currentAssignments = normalizeVoiceAssignments(
      snapshot.voice_assignments || [],
      manifest
    );
    const currentAssignment = currentAssignments.find(
      (candidate) => candidate.character_id === canonicalLine.character_id
    );
    if (
      currentAssignment &&
      (currentAssignment.voice_id !== assignment.voice_id ||
        currentAssignment.voice_name !== assignment.voice_name)
    ) {
      throw new Error(
        "The saved character voice changed while this take was rendering. Your previous take is still safe."
      );
    }
    const currentAudioAssets = normalizeDialogueAudioAssets(
      snapshot.audio_assets || [],
      manifest
    );
    const now = new Date().toISOString();
    const nextAsset: DialogueAudioAsset = {
      asset_type: "dialogue",
      provider: "elevenlabs",
      scene_number: input.sceneNumber,
      line_id: canonicalLine.line_id,
      character_id: canonicalLine.character_id,
      voice_id: assignment.voice_id,
      voice_name: assignment.voice_name,
      text: canonicalLine.text,
      audio_url: audioUrl,
      content_type: "audio/mpeg",
      status: "READY",
      created_at: now,
      updated_at: now,
      error: null,
    };
    const nextAudioAssets = normalizeDialogueAudioAssets(
      replaceLatestDialogueAudioAsset(currentAudioAssets, nextAsset),
      manifest
    );
    const authoritative = nextAudioAssets.find(
      (asset) =>
        asset.scene_number === input.sceneNumber &&
        asset.line_id === canonicalLine.line_id &&
        asset.character_id === canonicalLine.character_id &&
        asset.text === canonicalLine.text &&
        asset.audio_url === audioUrl &&
        asset.content_type === "audio/mpeg" &&
        asset.status === "READY"
    );
    if (!authoritative) {
      throw new Error(
        "The generated voice take could not be validated against the saved scene line. Your previous take is still safe."
      );
    }

    await persistCurrentPatch({ audio_assets: nextAudioAssets });
    return authoritative;
  };

  return { ensureVoiceAsset };
}

/**
 * The source frame is resolved by the page connection, not guessed inside the
 * provider adapter. The later connection can therefore keep the approved
 * speaker-reference-first, scene-storyboard-second rule in one place.
 */
export interface DialogueCloseupSourceFrame {
  readonly sourceFrameType: DialogueShotSourceFrameType;
  readonly sourceFrameUrl: string;
}

export type DialogueCloseupSourceFrameResolverResult =
  | DialogueCloseupSourceFrame
  | null
  | undefined;

export interface DialogueCloseupCoverageAdapterDependencies {
  readonly projectId: string;
  readonly getSnapshot: () => SceneCoverageSnapshot | PromiseLike<SceneCoverageSnapshot>;
  readonly persistPatch: (
    patch: SceneCoveragePatch
  ) => void | PromiseLike<void>;
  readonly resolveSourceFrame: (
    line: SceneCoverageLine,
    snapshot: SceneCoverageSnapshot
  ) =>
    | DialogueCloseupSourceFrameResolverResult
    | PromiseLike<DialogueCloseupSourceFrameResolverResult>;
  readonly isCurrent: () => boolean | PromiseLike<boolean>;
}

export interface DialogueCloseupCoverageAdapter {
  /** Ensure one canonical line has a current READY five-second source shot. */
  readonly ensureCloseupAsset: (
    line: SceneCoverageLine,
    currentAsset?: DialogueShotClip | null
  ) => Promise<DialogueShotClip>;
}

const CLOSEUP_DURATION_SECONDS = 5;
const CLOSEUP_POLL_DELAY_MS = 4500;
const CLOSEUP_MAX_STATUS_POLLS = 80;

interface DialogueCloseupContext {
  readonly manifest: DramaManifest;
  readonly sceneNumber: number;
  readonly lineId: string;
  readonly characterId: string;
  readonly text: string;
  readonly sourceFrameType: DialogueShotSourceFrameType;
  readonly sourceFrameUrl: string;
}

function isSecureHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    return new URL(value.trim()).protocol === "https:";
  } catch {
    return false;
  }
}

function validatedCloseupManifest(snapshot: SceneCoverageSnapshot): DramaManifest {
  const validation = validateManifest(snapshot.manifest, snapshot.scene_count);
  if (!validation.valid || !validation.manifest) {
    throw new Error(
      validation.error ||
        "The saved screenplay is not valid for dialogue close-up coverage."
    );
  }
  return validation.manifest;
}

function resolveCloseupCanonicalLine(
  snapshot: SceneCoverageSnapshot,
  input: SceneCoverageLine
): { manifest: DramaManifest; line: DialogueLine } {
  if (!Number.isInteger(input.sceneNumber) || input.sceneNumber < 1) {
    throw new Error("Dialogue close-up coverage requires a valid saved scene number.");
  }
  if (!input.lineId || !input.characterId || !input.text) {
    throw new Error(
      "Dialogue close-up coverage requires the saved line ID, speaker, and text."
    );
  }

  const manifest = validatedCloseupManifest(snapshot);
  const scene = manifest.scenes.find(
    (candidate) => candidate.scene_number === input.sceneNumber
  );
  if (!scene) {
    throw new Error(
      `Scene ${input.sceneNumber} is not in the current saved screenplay.`
    );
  }

  const canonicalLine = findDialogueLine(scene, input.lineId);
  if (
    !canonicalLine ||
    canonicalLine.line_id !== input.lineId ||
    canonicalLine.character_id !== input.characterId ||
    canonicalLine.text !== input.text ||
    (input.order !== undefined && canonicalLine.order !== input.order)
  ) {
    throw new Error(
      "The saved speaker line changed. Refresh the project and use the current screenplay line."
    );
  }

  return { manifest, line: canonicalLine };
}

function normalizeCloseupSourceFrame(
  value: DialogueCloseupSourceFrameResolverResult
): DialogueCloseupSourceFrame {
  if (!value || typeof value !== "object") {
    throw new Error(
      "No secure saved source frame is available for this dialogue line. Save the speaker's current character reference or scene storyboard before running close-up coverage."
    );
  }

  // Accept the persisted snake_case names as a narrow bridge as well as the
  // adapter's camelCase result shape. Both paths still require exact types and
  // an HTTPS source URL before a provider call can begin.
  const source = value as unknown as Record<string, unknown>;
  const sourceFrameType =
    source.sourceFrameType ?? source.source_frame_type;
  const sourceFrameUrl =
    typeof (source.sourceFrameUrl ?? source.source_frame_url) === "string"
      ? String(source.sourceFrameUrl ?? source.source_frame_url).trim()
      : "";

  if (
    sourceFrameType !== "scene_storyboard" &&
    sourceFrameType !== "character_reference"
  ) {
    throw new Error(
      "The close-up source frame type is not a current saved storyboard or character reference. Refresh the project and retry."
    );
  }
  if (!isSecureHttpsUrl(sourceFrameUrl)) {
    throw new Error(
      "The close-up source frame is not a secure saved image. Refresh the project and choose the current storyboard or speaker reference."
    );
  }

  return {
    sourceFrameType,
    sourceFrameUrl,
  };
}

function closeupContextMatches(
  left: DialogueCloseupContext,
  right: DialogueCloseupContext
): boolean {
  return (
    left.sceneNumber === right.sceneNumber &&
    left.lineId === right.lineId &&
    left.characterId === right.characterId &&
    left.text === right.text &&
    left.sourceFrameType === right.sourceFrameType &&
    left.sourceFrameUrl === right.sourceFrameUrl
  );
}

function closeupClipMatchesContext(
  clip: DialogueShotClip,
  context: DialogueCloseupContext
): boolean {
  return (
    clip.provider === "replicate-luma" &&
    clip.shot_role === "dialogue_closeup" &&
    clip.scene_number === context.sceneNumber &&
    clip.line_id === context.lineId &&
    clip.character_id === context.characterId &&
    clip.text === context.text &&
    clip.source_frame_type === context.sourceFrameType &&
    clip.source_frame_url === context.sourceFrameUrl &&
    clip.duration_seconds === CLOSEUP_DURATION_SECONDS
  );
}

function responsePredictionId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const raw = (value as Record<string, unknown>).prediction_id;
  if (typeof raw !== "string" || !raw.trim()) return null;
  return raw.trim();
}

function responseError(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const raw = (value as Record<string, unknown>).error;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function hasCloseupResponseClip(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const clip = (value as Record<string, unknown>).dialogue_shot_clip;
  return Boolean(clip && typeof clip === "object");
}

function isActiveCloseupStatus(
  status: DialogueShotClip["status"] | undefined
): boolean {
  return status === "QUEUED" || status === "PROCESSING";
}

function closeupTerminalError(
  clip: DialogueShotClip,
  providerResponse: unknown
): string {
  if (typeof clip.error === "string" && clip.error.trim()) {
    return clip.error.trim();
  }
  const providerMessage = responseError(providerResponse);
  if (providerMessage) return providerMessage;
  return clip.status === "CANCELED"
    ? "The dialogue close-up was canceled before it produced a source shot."
    : "Luma could not finish this dialogue close-up. The saved source frame and earlier attempts remain safe.";
}

/**
 * Match the manual close-up proof's authoritative response checks before a
 * provider record can enter the shared project collection. Normalization is
 * deliberately applied after those exact lineage checks so lower-level record
 * rules cannot make a mismatched response look current.
 */
function validateAuthoritativeCloseupClip(
  value: unknown,
  context: DialogueCloseupContext,
  expectedPredictionId?: string
): DialogueShotClip {
  if (!value || typeof value !== "object") {
    throw new Error(
      "The close-up service returned no saved attempt. Earlier source media remains safe."
    );
  }

  const candidate = value as Partial<DialogueShotClip>;
  const predictionId =
    typeof candidate.prediction_id === "string"
      ? candidate.prediction_id.trim()
      : "";
  if (!predictionId || (expectedPredictionId && predictionId !== expectedPredictionId)) {
    throw new Error(
      "The close-up service returned a different prediction. The saved attempt remains unchanged."
    );
  }

  if (
    typeof candidate.provider !== "string" ||
    candidate.provider.trim() !== "replicate-luma" ||
    candidate.shot_role !== "dialogue_closeup" ||
    candidate.scene_number !== context.sceneNumber ||
    candidate.line_id !== context.lineId ||
    candidate.character_id !== context.characterId ||
    candidate.text !== context.text ||
    candidate.source_frame_type !== context.sourceFrameType ||
    candidate.source_frame_url !== context.sourceFrameUrl ||
    candidate.duration_seconds !== CLOSEUP_DURATION_SECONDS ||
    !["QUEUED", "PROCESSING", "READY", "FAILED", "CANCELED"].includes(
      candidate.status as string
    ) ||
    typeof candidate.created_at !== "string" ||
    typeof candidate.updated_at !== "string"
  ) {
    throw new Error(
      "The close-up service returned a different saved lineage. The existing proof history remains safe."
    );
  }

  if (candidate.status === "READY" && !isSecureHttpsUrl(candidate.video_url)) {
    throw new Error(
      "The close-up service marked an attempt ready without a secure private video. The attempt remains unchanged."
    );
  }
  if (candidate.status !== "READY" && candidate.video_url) {
    throw new Error(
      "The close-up service returned a video before private archiving completed. The attempt remains unchanged."
    );
  }

  const normalized = normalizeDialogueShotClips([candidate]);
  const clip = normalized[0];
  if (!clip || !closeupClipMatchesContext(clip, context)) {
    throw new Error(
      "The close-up service returned an invalid saved attempt. The existing proof history remains safe."
    );
  }
  if (clip.prediction_id !== predictionId) {
    throw new Error(
      "The close-up service returned a different normalized prediction. The saved attempt remains unchanged."
    );
  }
  return clip;
}

export function createDialogueCloseupCoverageAdapter(
  dependencies: DialogueCloseupCoverageAdapterDependencies
): DialogueCloseupCoverageAdapter {
  const projectId = dependencies.projectId.trim();

  const assertCurrent = async (): Promise<void> => {
    if (!(await dependencies.isCurrent())) {
      throw new SceneCoverageCanceledError(CLOSEUP_CANCELED_MESSAGE);
    }
  };

  /**
   * Provider, resolver, snapshot, persistence, and timer boundaries all pass
   * through this guard. The post-call check also runs when an operation rejects,
   * so a stale failure cannot replace the cancellation result.
   */
  const currentOperation = async <T>(
    operation: () => T | PromiseLike<T>
  ): Promise<T> => {
    await assertCurrent();
    try {
      const result = await operation();
      await assertCurrent();
      return result;
    } catch (error) {
      await assertCurrent();
      throw error;
    }
  };

  const readSnapshot = async (): Promise<SceneCoverageSnapshot> => {
    const snapshot = await currentOperation(() => dependencies.getSnapshot());
    if (!snapshot || typeof snapshot !== "object") {
      throw new Error(
        "The current project snapshot is unavailable for dialogue close-up coverage."
      );
    }
    return snapshot;
  };

  const readCurrentContext = async (
    input: SceneCoverageLine
  ): Promise<DialogueCloseupContext> => {
    const snapshot = await readSnapshot();
    const resolved = resolveCloseupCanonicalLine(snapshot, input);
    const sourceFrame = normalizeCloseupSourceFrame(
      await currentOperation(() => dependencies.resolveSourceFrame(input, snapshot))
    );

    return {
      manifest: resolved.manifest,
      sceneNumber: input.sceneNumber,
      lineId: resolved.line.line_id,
      characterId: resolved.line.character_id,
      text: resolved.line.text,
      sourceFrameType: sourceFrame.sourceFrameType,
      sourceFrameUrl: sourceFrame.sourceFrameUrl,
    };
  };

  const persistCurrentPatch = async (
    patch: SceneCoveragePatch
  ): Promise<void> => {
    await currentOperation(() => dependencies.persistPatch(patch));
  };

  const persistAuthoritativeClip = async (
    input: SceneCoverageLine,
    expectedContext: DialogueCloseupContext,
    clip: DialogueShotClip
  ): Promise<DialogueShotClip> => {
    const latestContext = await readCurrentContext(input);
    if (!closeupContextMatches(latestContext, expectedContext)) {
      throw new Error(
        "The saved dialogue line or source frame changed while this close-up was rendering. Refresh the project before continuing."
      );
    }
    if (!closeupClipMatchesContext(clip, latestContext)) {
      throw new Error(
        "The returned close-up no longer matches the current saved line and source frame. The existing proof history remains safe."
      );
    }

    const snapshot = await readSnapshot();
    const currentClips = normalizeDialogueShotClips(
      snapshot.dialogue_shot_clips || [],
      latestContext.manifest
    );
    const nextClips = normalizeDialogueShotClips(
      upsertDialogueShotClip(currentClips, clip),
      latestContext.manifest
    );
    const authoritative = nextClips.find(
      (candidate) =>
        candidate.prediction_id === clip.prediction_id &&
        candidate.status === clip.status &&
        closeupClipMatchesContext(candidate, latestContext) &&
        candidate.video_url === clip.video_url
    );
    if (!authoritative) {
      throw new Error(
        "The generated close-up could not be validated against the saved scene line. Earlier attempts remain safe."
      );
    }

    await persistCurrentPatch({ dialogue_shot_clips: nextClips });
    return authoritative;
  };

  const archiveCloseupAttempt = async (
    input: SceneCoverageLine,
    expectedContext: DialogueCloseupContext,
    predictionId: string
  ): Promise<{ clip: DialogueShotClip; response: unknown }> => {
    const beforeArchive = await readCurrentContext(input);
    if (!closeupContextMatches(beforeArchive, expectedContext)) {
      throw new Error(
        "The saved dialogue line or source frame changed before private archiving. Refresh the project before continuing."
      );
    }

    const response = await currentOperation(() =>
      replicateLumaVideo({
        operation: "archive",
        project_id: projectId,
        scene_number: expectedContext.sceneNumber,
        clip_kind: "dialogue_closeup",
        prediction_id: predictionId,
      })
    );
    if (!hasCloseupResponseClip(response)) {
      throw new Error(
        responseError(response) ||
          "Private archiving returned no saved close-up attempt. Keep this prediction and retry its status without starting another render."
      );
    }

    const responseId = responsePredictionId(response);
    if (responseId && responseId !== predictionId) {
      throw new Error(
        "The archive service returned a different prediction. The saved attempt remains unchanged."
      );
    }
    const archived = validateAuthoritativeCloseupClip(
      (response as { dialogue_shot_clip?: unknown }).dialogue_shot_clip,
      expectedContext,
      predictionId
    );
    const clip = await persistAuthoritativeClip(input, expectedContext, archived);
    return { clip, response };
  };

  const pollUntilReady = async (
    input: SceneCoverageLine,
    expectedContext: DialogueCloseupContext,
    predictionId: string
  ): Promise<DialogueShotClip> => {
    for (let pollIndex = 0; pollIndex < CLOSEUP_MAX_STATUS_POLLS; pollIndex += 1) {
      await currentOperation(
        () =>
          new Promise<void>((resolve) => {
            setTimeout(resolve, CLOSEUP_POLL_DELAY_MS);
          })
      );

      const beforeStatus = await readCurrentContext(input);
      if (!closeupContextMatches(beforeStatus, expectedContext)) {
        throw new Error(
          "The saved dialogue line or source frame changed while this close-up was rendering. Refresh the project before continuing."
        );
      }

      const response = await currentOperation(() =>
        replicateLumaVideo({
          operation: "status",
          project_id: projectId,
          scene_number: expectedContext.sceneNumber,
          clip_kind: "dialogue_closeup",
          prediction_id: predictionId,
        })
      );
      if (!hasCloseupResponseClip(response)) {
        throw new Error(
          responseError(response) ||
            "The latest close-up status returned no saved attempt. Keep this prediction and retry its status without starting another render."
        );
      }

      const responseId = responsePredictionId(response);
      if (responseId && responseId !== predictionId) {
        throw new Error(
          "The close-up service returned a different prediction. The saved attempt remains unchanged."
        );
      }
      const statusClip = validateAuthoritativeCloseupClip(
        (response as { dialogue_shot_clip?: unknown }).dialogue_shot_clip,
        expectedContext,
        predictionId
      );
      const persistedStatusClip = await persistAuthoritativeClip(
        input,
        expectedContext,
        statusClip
      );

      if (
        persistedStatusClip.status === "FAILED" ||
        persistedStatusClip.status === "CANCELED"
      ) {
        throw new Error(closeupTerminalError(persistedStatusClip, response));
      }
      if (persistedStatusClip.status === "READY") {
        return persistedStatusClip;
      }
      if (!isActiveCloseupStatus(persistedStatusClip.status)) {
        throw new Error(
          "The close-up service returned an unsupported processing state. The saved attempt remains unchanged."
        );
      }

      const responseStatus =
        typeof (response as { status?: unknown }).status === "string"
          ? String((response as { status?: unknown }).status).toUpperCase()
          : "";
      const remoteStatus =
        typeof (response as { remote_status?: unknown }).remote_status === "string"
          ? String((response as { remote_status?: unknown }).remote_status).toLowerCase()
          : "";
      const readyToArchive =
        (response as { ready_to_archive?: unknown }).ready_to_archive === true ||
        responseStatus === "SUCCEEDED" ||
        remoteStatus === "SUCCEEDED";

      if (readyToArchive) {
        const archived = await archiveCloseupAttempt(
          input,
          expectedContext,
          predictionId
        );
        if (archived.clip.status === "READY") return archived.clip;
        if (
          archived.clip.status === "FAILED" ||
          archived.clip.status === "CANCELED"
        ) {
          throw new Error(closeupTerminalError(archived.clip, archived.response));
        }
        if (!isActiveCloseupStatus(archived.clip.status)) {
          throw new Error(
            "Private archiving returned an unsupported close-up state. The saved attempt remains unchanged."
          );
        }
      }
    }

    throw new Error(
      "The dialogue close-up is still processing after the status window. The saved attempt is safe. Retry status from this prediction before starting another render."
    );
  };

  const ensureCloseupAsset = async (
    input: SceneCoverageLine,
    _currentAsset?: DialogueShotClip | null
  ): Promise<DialogueShotClip> => {
    if (!projectId) {
      throw new Error("Dialogue close-up coverage requires a saved project ID.");
    }

    const initialContext = await readCurrentContext(input);
    const response = await currentOperation(() =>
      replicateLumaVideo({
        operation: "start",
        project_id: projectId,
        scene_number: initialContext.sceneNumber,
        clip_kind: "dialogue_closeup",
        line_id: initialContext.lineId,
        character_id: initialContext.characterId,
        text: initialContext.text,
        source_frame_type: initialContext.sourceFrameType,
        source_frame_url: initialContext.sourceFrameUrl,
        duration_seconds: CLOSEUP_DURATION_SECONDS,
      })
    );
    if (!hasCloseupResponseClip(response)) {
      throw new Error(
        responseError(response) ||
          "The dialogue close-up could not start. The saved source frame and approved line remain safe."
      );
    }

    const predictionId = responsePredictionId(response);
    const started = validateAuthoritativeCloseupClip(
      (response as { dialogue_shot_clip?: unknown }).dialogue_shot_clip,
      initialContext,
      predictionId || undefined
    );
    if (!predictionId || started.prediction_id !== predictionId) {
      throw new Error(
        "The close-up service did not return a usable prediction. No new proof was saved."
      );
    }

    const persistedStart = await persistAuthoritativeClip(
      input,
      initialContext,
      started
    );
    if (persistedStart.status === "READY") return persistedStart;
    if (
      persistedStart.status === "FAILED" ||
      persistedStart.status === "CANCELED"
    ) {
      throw new Error(closeupTerminalError(persistedStart, response));
    }
    if (!isActiveCloseupStatus(persistedStart.status)) {
      throw new Error(
        "The close-up service returned an unsupported start state. The saved attempt remains unchanged."
      );
    }

    return pollUntilReady(input, initialContext, predictionId);
  };

  return { ensureCloseupAsset };
}

export interface LipsyncCoverageAdapterDependencies {
  /** Defaults to Sync so existing callers remain on the legacy motion-safe path. */
  readonly provider?: LipsyncAsset["provider"];
  readonly projectId: string;
  readonly getSnapshot: () => SceneCoverageSnapshot | PromiseLike<SceneCoverageSnapshot>;
  readonly persistPatch: (
    patch: SceneCoveragePatch
  ) => void | PromiseLike<void>;
  readonly isCurrent: () => boolean | PromiseLike<boolean>;
}

export interface LipsyncCoverageAdapter {
  /** Ensure one canonical line has a current READY private lip-sync MP4. */
  readonly ensureLipsyncAsset: (
    line: SceneCoverageLine,
    audio: DialogueAudioAsset,
    closeup: DialogueShotClip
  ) => Promise<LipsyncAsset>;
}

const LIPSYNC_CANCELED_MESSAGE =
  "Lip-sync coverage canceled because the active scene or run is no longer current.";
const LIPSYNC_POLL_DELAY_MS = 4500;
const LIPSYNC_MAX_STATUS_POLLS = 80;
const LIPSYNC_PREDICTION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_:-]{0,179}$/;

type LipsyncCoverageRemoteStatus =
  | "starting"
  | "processing"
  | "succeeded"
  | "failed"
  | "canceled";

interface LipsyncCoverageContext {
  readonly manifest: DramaManifest;
  readonly sceneNumber: number;
  readonly lineId: string;
  readonly characterId: string;
  readonly text: string;
  readonly audioUrl: string;
  readonly closeupPredictionId: string;
  readonly closeupVideoUrl: string;
  readonly closeupSourceFrameType: DialogueShotSourceFrameType;
  readonly closeupSourceFrameUrl: string;
}

interface CurrentLipsyncContext {
  readonly snapshot: SceneCoverageSnapshot;
  readonly context: LipsyncCoverageContext;
}

interface LipsyncStatusUpdate {
  readonly status: LipsyncAsset["status"];
  readonly remoteStatus: LipsyncCoverageRemoteStatus;
  readonly videoUrl: string | null;
  readonly error: string | null;
}

function normalizeLipsyncCoveragePredictionId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return LIPSYNC_PREDICTION_ID_PATTERN.test(trimmed) ? trimmed : null;
}

function normalizeLipsyncCoverageRemoteStatus(
  value: unknown,
  fallback: LipsyncCoverageRemoteStatus
): LipsyncCoverageRemoteStatus {
  const status = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (status === "starting" || status === "queued") return "starting";
  if (status === "processing" || status === "running") return "processing";
  if (status === "succeeded" || status === "completed") return "succeeded";
  if (status === "failed" || status === "error") return "failed";
  if (status === "canceled" || status === "cancelled") return "canceled";
  return fallback;
}

function lipsyncContextMatches(
  left: LipsyncCoverageContext,
  right: LipsyncCoverageContext
): boolean {
  return (
    left.sceneNumber === right.sceneNumber &&
    left.lineId === right.lineId &&
    left.characterId === right.characterId &&
    left.text === right.text &&
    left.audioUrl === right.audioUrl &&
    left.closeupPredictionId === right.closeupPredictionId &&
    left.closeupVideoUrl === right.closeupVideoUrl &&
    left.closeupSourceFrameType === right.closeupSourceFrameType &&
    left.closeupSourceFrameUrl === right.closeupSourceFrameUrl
  );
}

function suppliedAudioMatchesCurrent(
  supplied: DialogueAudioAsset,
  current: DialogueAudioAsset,
  context: LipsyncCoverageContext
): boolean {
  return (
    supplied.asset_type === "dialogue" &&
    supplied.provider === "elevenlabs" &&
    supplied.status === "READY" &&
    supplied.scene_number === context.sceneNumber &&
    supplied.line_id === context.lineId &&
    supplied.character_id === context.characterId &&
    supplied.text === context.text &&
    supplied.content_type === "audio/mpeg" &&
    isSecureHttpsUrl(supplied.audio_url) &&
    supplied.audio_url === current.audio_url &&
    supplied.audio_url === context.audioUrl
  );
}

function suppliedCloseupMatchesCurrent(
  supplied: DialogueShotClip,
  current: DialogueShotClip,
  context: LipsyncCoverageContext
): boolean {
  return (
    supplied.provider === "replicate-luma" &&
    supplied.shot_role === "dialogue_closeup" &&
    supplied.status === "READY" &&
    supplied.scene_number === context.sceneNumber &&
    supplied.line_id === context.lineId &&
    supplied.character_id === context.characterId &&
    supplied.text === context.text &&
    supplied.duration_seconds === 5 &&
    Boolean(normalizeLipsyncCoveragePredictionId(supplied.prediction_id)) &&
    supplied.prediction_id === current.prediction_id &&
    supplied.prediction_id === context.closeupPredictionId &&
    isSecureHttpsUrl(supplied.video_url) &&
    supplied.video_url === current.video_url &&
    supplied.video_url === context.closeupVideoUrl &&
    supplied.source_frame_type === context.closeupSourceFrameType &&
    supplied.source_frame_url === context.closeupSourceFrameUrl
  );
}

function assertLipsyncAssetLineage(
  value: unknown,
  context: LipsyncCoverageContext,
  expectedPredictionId?: string,
  expectedProvider: LipsyncAsset["provider"] = "replicate-lipsync"
): LipsyncAsset {
  if (!value || typeof value !== "object") {
    throw new Error(
      "The lip-sync service returned no saved attempt. Earlier source media remains safe."
    );
  }

  const asset = value as LipsyncAsset;
  const predictionId = normalizeLipsyncCoveragePredictionId(asset.prediction_id);
  if (
    asset.provider !== expectedProvider ||
    !predictionId ||
    (expectedPredictionId !== undefined && predictionId !== expectedPredictionId) ||
    asset.scene_number !== context.sceneNumber ||
    asset.line_id !== context.lineId ||
    asset.character_id !== context.characterId ||
    asset.text !== context.text ||
    asset.source_clip_prediction_id !== context.closeupPredictionId ||
    asset.source_video_url !== context.closeupVideoUrl ||
    asset.source_audio_url !== context.audioUrl ||
    asset.source_audio_content_type !== "audio/mpeg" ||
    !isSecureHttpsUrl(asset.source_video_url) ||
    !isSecureHttpsUrl(asset.source_audio_url) ||
    !["PROCESSING", "READY", "FAILED", "CANCELED"].includes(asset.status)
  ) {
    throw new Error(
      "The lip-sync service returned a different saved lineage. The existing proof history remains safe."
    );
  }

  if (asset.status === "READY" && !isSecureHttpsUrl(asset.video_url)) {
    throw new Error(
      "The lip-sync service marked an attempt ready without a secure private video. The attempt remains unchanged."
    );
  }
  if (asset.status !== "READY" && asset.video_url !== null) {
    throw new Error(
      "The lip-sync service returned a video before private archiving completed. The attempt remains unchanged."
    );
  }

  return {
    ...asset,
    prediction_id: predictionId,
  };
}

/**
 * Find the newest exact processing attempt for this provider and source lineage.
 * New attempts append to the shared history, so a later exact attempt supersedes
 * an older duplicate without ever crossing lines, speakers, audio, or source shots.
 */
function findMatchingProcessingLipsyncAsset(
  assets: readonly LipsyncAsset[],
  context: LipsyncCoverageContext,
  expectedProvider: LipsyncAsset["provider"]
): LipsyncAsset | null {
  let match: LipsyncAsset | null = null;

  for (const asset of assets) {
    const predictionId = normalizeLipsyncCoveragePredictionId(asset.prediction_id);
    if (
      asset.provider !== expectedProvider ||
      asset.status !== "PROCESSING" ||
      !predictionId ||
      asset.scene_number !== context.sceneNumber ||
      asset.line_id !== context.lineId ||
      asset.character_id !== context.characterId ||
      asset.text !== context.text ||
      asset.source_clip_prediction_id !== context.closeupPredictionId ||
      asset.source_video_url !== context.closeupVideoUrl ||
      asset.source_audio_url !== context.audioUrl
    ) {
      continue;
    }

    // Keep the existing strict lineage assertion as the authority before a
    // saved prediction is allowed back into provider polling.
    match = assertLipsyncAssetLineage(
      asset,
      context,
      predictionId,
      expectedProvider
    );
  }

  return match;
}

function assertLipsyncProviderLineage(
  value: unknown,
  context: LipsyncCoverageContext,
  expectedPredictionId?: string
): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    throw new Error(
      "The lip-sync service returned no authoritative response. Your saved source media remains safe."
    );
  }
  const response = value as Record<string, unknown>;
  if (response.ok === false) {
    throw new Error(responseError(response) || "The lip-sync service rejected this render.");
  }

  const responsePredictionId = normalizeLipsyncCoveragePredictionId(
    response.prediction_id
  );
  if (!responsePredictionId || (expectedPredictionId && responsePredictionId !== expectedPredictionId)) {
    throw new Error(
      "The lip-sync service returned a different prediction. The saved attempt remains unchanged."
    );
  }
  if (
    response.scene_number !== undefined &&
    response.scene_number !== context.sceneNumber
  ) {
    throw new Error(
      "The lip-sync service returned a different scene. The saved attempt remains unchanged."
    );
  }
  if (response.line_id !== undefined && response.line_id !== context.lineId) {
    throw new Error(
      "The lip-sync service returned a different dialogue line. The saved attempt remains unchanged."
    );
  }
  if (
    response.character_id !== undefined &&
    response.character_id !== context.characterId
  ) {
    throw new Error(
      "The lip-sync service returned a different speaker. The saved attempt remains unchanged."
    );
  }
  if (
    response.clip_prediction_id !== undefined &&
    response.clip_prediction_id !== context.closeupPredictionId
  ) {
    throw new Error(
      "The lip-sync service returned a different source close-up. The saved attempt remains unchanged."
    );
  }
  if (
    response.source_clip_prediction_id !== undefined &&
    response.source_clip_prediction_id !== context.closeupPredictionId
  ) {
    throw new Error(
      "The lip-sync service returned a different source close-up. The saved attempt remains unchanged."
    );
  }
  if (
    response.source_clip_kind !== undefined &&
    response.source_clip_kind !== "dialogue_closeup"
  ) {
    throw new Error(
      "The lip-sync service returned an unsupported source clip. The saved attempt remains unchanged."
    );
  }

  const responseText = response.text !== undefined ? response.text : response.dialogue;
  if (responseText !== undefined && responseText !== context.text) {
    throw new Error(
      "The lip-sync service returned different dialogue text. The saved attempt remains unchanged."
    );
  }

  return response;
}

function validateLipsyncStartResponse(
  value: unknown,
  context: LipsyncCoverageContext
): string {
  const response = assertLipsyncProviderLineage(value, context);
  const predictionId = normalizeLipsyncCoveragePredictionId(response.prediction_id);
  if (!predictionId) {
    throw new Error(
      "The lip-sync service did not return a usable prediction. Nothing new was saved, so retry this take."
    );
  }
  if (response.status !== "PROCESSING") {
    throw new Error(
      "The lip-sync service did not return a processing prediction. Nothing new was saved, so retry this take."
    );
  }
  const responseSourcePredictionId =
    response.clip_prediction_id ?? response.source_clip_prediction_id;
  if (
    response.scene_number !== context.sceneNumber ||
    response.line_id !== context.lineId ||
    response.character_id !== context.characterId ||
    responseSourcePredictionId !== context.closeupPredictionId
  ) {
    throw new Error(
      "The lip-sync service returned a different source lineage. Nothing new was saved, so retry this take."
    );
  }
  return predictionId;
}

function validateLipsyncStatusResponse(
  value: unknown,
  context: LipsyncCoverageContext,
  expectedPredictionId: string
): LipsyncStatusUpdate {
  const response = assertLipsyncProviderLineage(
    value,
    context,
    expectedPredictionId
  );
  const status = response.status;
  if (
    response.error &&
    status !== "FAILED" &&
    status !== "CANCELED"
  ) {
    throw new Error(responseError(response) || "The lip-sync status check failed.");
  }

  if (status === "PROCESSING") {
    const returnedFileUrl =
      typeof response.file_url === "string" ? response.file_url.trim() : "";
    if (returnedFileUrl) {
      throw new Error(
        "The lip-sync service returned a video before private archiving completed. The attempt remains unchanged."
      );
    }
    return {
      status: "PROCESSING",
      remoteStatus: normalizeLipsyncCoverageRemoteStatus(
        response.remote_status,
        "processing"
      ),
      videoUrl: null,
      error: null,
    };
  }

  if (status === "READY") {
    const videoUrl =
      typeof response.file_url === "string" ? response.file_url.trim() : "";
    const contentType = normalizedContentType(response.content_type);
    if (!isSecureHttpsUrl(videoUrl) || contentType !== "video/mp4") {
      return {
        status: "FAILED",
        remoteStatus: "failed",
        videoUrl: null,
        error:
          "The lip-sync service returned an invalid private MP4. The saved source clip and dialogue take are safe, so retry this take.",
      };
    }
    return {
      status: "READY",
      remoteStatus: "succeeded",
      videoUrl,
      error: null,
    };
  }

  if (status === "FAILED") {
    return {
      status: "FAILED",
      remoteStatus: normalizeLipsyncCoverageRemoteStatus(
        response.remote_status,
        "failed"
      ),
      videoUrl: null,
      error:
        responseError(response) ||
        "The lip-sync provider could not finish this render. The saved source clip and dialogue take are safe, so retry this take.",
    };
  }

  if (status === "CANCELED") {
    return {
      status: "CANCELED",
      remoteStatus: normalizeLipsyncCoverageRemoteStatus(
        response.remote_status,
        "canceled"
      ),
      videoUrl: null,
      error:
        responseError(response) ||
        "The lip-sync render was canceled before producing a video. The saved source clip and dialogue take are safe, so retry this take.",
    };
  }

  throw new Error(
    "The lip-sync service returned an unsupported status. The saved attempt remains unchanged."
  );
}

function lipsyncTerminalError(
  asset: LipsyncAsset,
  providerResponse: unknown
): string {
  if (typeof asset.error === "string" && asset.error.trim()) {
    return asset.error.trim();
  }
  const providerMessage = responseError(providerResponse);
  if (providerMessage) return providerMessage;
  return asset.status === "CANCELED"
    ? "The lip-sync render was canceled before producing a private video. Your saved source clip and dialogue take are safe."
    : "The lip-sync provider could not finish this render. Your saved source clip and dialogue take are safe, so retry this take.";
}

export function createLipsyncCoverageAdapter(
  dependencies: LipsyncCoverageAdapterDependencies
): LipsyncCoverageAdapter {
  const projectId = dependencies.projectId.trim();
  const provider: LipsyncAsset["provider"] = dependencies.provider || "replicate-lipsync";

  const assertCurrent = async (): Promise<void> => {
    if (!(await dependencies.isCurrent())) {
      throw new SceneCoverageCanceledError(LIPSYNC_CANCELED_MESSAGE);
    }
  };

  /** Provider, snapshot, persistence, and timer boundaries all guard against stale runs. */
  const currentOperation = async <T>(
    operation: () => T | PromiseLike<T>
  ): Promise<T> => {
    await assertCurrent();
    try {
      const result = await operation();
      await assertCurrent();
      return result;
    } catch (error) {
      await assertCurrent();
      throw error;
    }
  };

  const readSnapshot = async (): Promise<SceneCoverageSnapshot> => {
    const snapshot = await currentOperation(() => dependencies.getSnapshot());
    if (!snapshot || typeof snapshot !== "object") {
      throw new Error(
        "The current project snapshot is unavailable for lip-sync coverage."
      );
    }
    return snapshot;
  };

  const persistCurrentPatch = async (
    patch: SceneCoveragePatch
  ): Promise<void> => {
    await currentOperation(() => dependencies.persistPatch(patch));
  };

  const readCurrentContext = async (
    input: SceneCoverageLine,
    suppliedAudio: DialogueAudioAsset,
    suppliedCloseup: DialogueShotClip
  ): Promise<CurrentLipsyncContext> => {
    const snapshot = await readSnapshot();
    const resolved = resolveCanonicalLine(snapshot, input);
    const currentAudioAssets = normalizeDialogueAudioAssets(
      snapshot.audio_assets || [],
      resolved.manifest
    );
    const currentAudio = findNewestReadyDialogueAudio(
      resolved.manifest,
      input.sceneNumber,
      resolved.line,
      currentAudioAssets
    );
    if (!currentAudio || !isSecureHttpsUrl(currentAudio.audio_url)) {
      throw new Error(
        "This line has no current READY secure ElevenLabs MP3. Generate the exact dialogue take before running lip-sync."
      );
    }

    const currentCloseups = normalizeDialogueShotClips(
      snapshot.dialogue_shot_clips || [],
      resolved.manifest
    );
    const currentCloseup = findNewestReadyDialogueCloseup(
      input.sceneNumber,
      resolved.line,
      currentCloseups
    );
    if (
      !currentCloseup ||
      !isSecureHttpsUrl(currentCloseup.video_url) ||
      currentCloseup.duration_seconds !== 5
    ) {
      throw new Error(
        "This line has no current READY five-second dialogue close-up. Generate the exact source shot before running lip-sync."
      );
    }

    const context: LipsyncCoverageContext = {
      manifest: resolved.manifest,
      sceneNumber: input.sceneNumber,
      lineId: resolved.line.line_id,
      characterId: resolved.line.character_id,
      text: resolved.line.text,
      audioUrl: currentAudio.audio_url,
      closeupPredictionId: currentCloseup.prediction_id,
      closeupVideoUrl: currentCloseup.video_url as string,
      closeupSourceFrameType: currentCloseup.source_frame_type,
      closeupSourceFrameUrl: currentCloseup.source_frame_url,
    };

    if (!suppliedAudioMatchesCurrent(suppliedAudio, currentAudio, context)) {
      throw new Error(
        "The supplied dialogue take is stale or does not match the current READY MP3 for this line. Refresh the project and retry."
      );
    }
    if (!suppliedCloseupMatchesCurrent(suppliedCloseup, currentCloseup, context)) {
      throw new Error(
        "The supplied dialogue close-up is stale or does not match the current READY five-second source. Refresh the project and retry."
      );
    }

    return { snapshot, context };
  };

  const persistStartedAsset = async (
    input: SceneCoverageLine,
    suppliedAudio: DialogueAudioAsset,
    suppliedCloseup: DialogueShotClip,
    expectedContext: LipsyncCoverageContext,
    asset: LipsyncAsset
  ): Promise<LipsyncAsset> => {
    const current = await readCurrentContext(input, suppliedAudio, suppliedCloseup);
    if (!lipsyncContextMatches(current.context, expectedContext)) {
      throw new Error(
        "The saved dialogue line, close-up, or audio take changed while lip-sync was starting. Refresh the project before continuing."
      );
    }

    const validated = assertLipsyncAssetLineage(
      asset,
      current.context,
      asset.prediction_id,
      provider
    );
    const currentAssets = normalizeLipsyncAssets(
      current.snapshot.lipsync_assets || [],
      current.context.manifest
    );
    const nextAssets = normalizeLipsyncAssets(
      upsertLipsyncAsset(currentAssets, validated),
      current.context.manifest
    );
    const authoritative = nextAssets.find(
      (candidate) =>
        candidate.provider === provider &&
        candidate.prediction_id === validated.prediction_id &&
        candidate.status === validated.status &&
        candidate.video_url === validated.video_url &&
        candidate.source_clip_prediction_id === current.context.closeupPredictionId &&
        candidate.source_video_url === current.context.closeupVideoUrl &&
        candidate.source_audio_url === current.context.audioUrl &&
        candidate.line_id === current.context.lineId &&
        candidate.character_id === current.context.characterId &&
        candidate.text === current.context.text
    );
    if (!authoritative) {
      throw new Error(
        "The processing lip-sync attempt could not be validated against the saved source lineage. Earlier proofs remain safe."
      );
    }

    await persistCurrentPatch({ lipsync_assets: nextAssets });
    return authoritative;
  };

  const persistStatusAsset = async (
    input: SceneCoverageLine,
    suppliedAudio: DialogueAudioAsset,
    suppliedCloseup: DialogueShotClip,
    expectedContext: LipsyncCoverageContext,
    predictionId: string,
    update: LipsyncStatusUpdate
  ): Promise<LipsyncAsset> => {
    const current = await readCurrentContext(input, suppliedAudio, suppliedCloseup);
    if (!lipsyncContextMatches(current.context, expectedContext)) {
      throw new Error(
        "The saved dialogue line, close-up, or audio take changed while lip-sync was rendering. Refresh the project before continuing."
      );
    }

    const currentAssets = normalizeLipsyncAssets(
      current.snapshot.lipsync_assets || [],
      current.context.manifest
    );
    const currentAsset = currentAssets.find(
      (candidate) => candidate.prediction_id === predictionId && candidate.provider === provider
    );
    if (!currentAsset || currentAsset.status !== "PROCESSING") {
      throw new Error(
        "The saved lip-sync lineage changed while this status was rendering. Refresh the project before checking again."
      );
    }
    assertLipsyncAssetLineage(currentAsset, current.context, predictionId, provider);

    const nextAssets = normalizeLipsyncAssets(
      updateLipsyncAsset(
        currentAssets,
        predictionId,
        {
          status: update.status,
          remote_status: update.remoteStatus,
          video_url: update.videoUrl,
          error: update.error,
          updated_at: new Date().toISOString(),
        },
        provider
      ),
      current.context.manifest
    );
    const authoritative = nextAssets.find(
      (candidate) =>
        candidate.provider === provider &&
        candidate.prediction_id === predictionId &&
        candidate.status === update.status &&
        candidate.video_url === update.videoUrl &&
        candidate.source_clip_prediction_id === current.context.closeupPredictionId &&
        candidate.source_video_url === current.context.closeupVideoUrl &&
        candidate.source_audio_url === current.context.audioUrl &&
        candidate.line_id === current.context.lineId &&
        candidate.character_id === current.context.characterId &&
        candidate.text === current.context.text
    );
    if (!authoritative) {
      throw new Error(
        "The lip-sync status could not be validated against the saved source lineage. Earlier proofs remain safe."
      );
    }
    assertLipsyncAssetLineage(authoritative, current.context, predictionId, provider);

    await persistCurrentPatch({ lipsync_assets: nextAssets });
    return authoritative;
  };

  const waitForNextStatus = async (): Promise<void> => {
    await currentOperation(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, LIPSYNC_POLL_DELAY_MS);
        })
    );
  };

  const pollUntilReady = async (
    input: SceneCoverageLine,
    suppliedAudio: DialogueAudioAsset,
    suppliedCloseup: DialogueShotClip,
    expectedContext: LipsyncCoverageContext,
    predictionId: string
  ): Promise<LipsyncAsset> => {
    for (let pollIndex = 0; pollIndex < LIPSYNC_MAX_STATUS_POLLS; pollIndex += 1) {
      await waitForNextStatus();
      const beforeStatus = await readCurrentContext(
        input,
        suppliedAudio,
        suppliedCloseup
      );
      if (!lipsyncContextMatches(beforeStatus.context, expectedContext)) {
        throw new Error(
          "The saved dialogue line, close-up, or audio take changed while lip-sync was rendering. Refresh the project before continuing."
        );
      }

      const response = await currentOperation(() =>
        provider === "pixverse-lipsync"
          ? pixverseLipsync({
              operation: "status",
              project_id: projectId,
              prediction_id: predictionId,
            })
          : replicateLipsync({
              operation: "status",
              project_id: projectId,
              prediction_id: predictionId,
            })
      );
      const update = validateLipsyncStatusResponse(
        response,
        expectedContext,
        predictionId
      );
      const persisted = await persistStatusAsset(
        input,
        suppliedAudio,
        suppliedCloseup,
        expectedContext,
        predictionId,
        update
      );

      if (persisted.status === "FAILED" || persisted.status === "CANCELED") {
        throw new Error(lipsyncTerminalError(persisted, response));
      }
      if (persisted.status === "READY") return persisted;
      if (persisted.status !== "PROCESSING") {
        throw new Error(
          "The lip-sync service returned an unsupported processing state. The saved attempt remains unchanged."
        );
      }
    }

    throw new Error(
      "The lip-sync render is still processing after the status window. The saved attempt is safe. Retry status from this prediction before starting another render."
    );
  };

  const ensureLipsyncAsset = async (
    input: SceneCoverageLine,
    suppliedAudio: DialogueAudioAsset,
    suppliedCloseup: DialogueShotClip
  ): Promise<LipsyncAsset> => {
    if (!projectId) {
      throw new Error("Lip-sync coverage requires a saved project ID.");
    }

    const initial = await readCurrentContext(input, suppliedAudio, suppliedCloseup);
    const currentAssets = normalizeLipsyncAssets(
      initial.snapshot.lipsync_assets || [],
      initial.context.manifest
    );
    const resumableAsset = findMatchingProcessingLipsyncAsset(
      currentAssets,
      initial.context,
      provider
    );
    if (resumableAsset) {
      return pollUntilReady(
        input,
        suppliedAudio,
        suppliedCloseup,
        initial.context,
        resumableAsset.prediction_id
      );
    }

    const response = await currentOperation(() =>
      provider === "pixverse-lipsync"
        ? pixverseLipsync({
            operation: "start",
            project_id: projectId,
            scene_number: initial.context.sceneNumber,
            line_id: initial.context.lineId,
            clip_prediction_id: initial.context.closeupPredictionId,
            character_id: initial.context.characterId,
            text: initial.context.text,
            source_video_url: initial.context.closeupVideoUrl,
            source_audio_url: initial.context.audioUrl,
          })
        : replicateLipsync({
            operation: "start",
            project_id: projectId,
            scene_number: initial.context.sceneNumber,
            line_id: initial.context.lineId,
            clip_prediction_id: initial.context.closeupPredictionId,
            character_id: initial.context.characterId,
            text: initial.context.text,
            source_video_url: initial.context.closeupVideoUrl,
            source_audio_url: initial.context.audioUrl,
            source_clip_kind: "dialogue_closeup",
          })
    );
    const predictionId = validateLipsyncStartResponse(
      response,
      initial.context
    );
    const now = new Date().toISOString();
    const startedAsset = normalizeLipsyncAssets(
      [
        {
          provider,
          prediction_id: predictionId,
          scene_number: initial.context.sceneNumber,
          line_id: initial.context.lineId,
          character_id: initial.context.characterId,
          text: initial.context.text,
          source_clip_prediction_id: initial.context.closeupPredictionId,
          source_video_url: initial.context.closeupVideoUrl,
          source_audio_url: initial.context.audioUrl,
          source_audio_content_type: "audio/mpeg",
          status: "PROCESSING",
          remote_status: normalizeLipsyncCoverageRemoteStatus(
            (response as { remote_status?: unknown }).remote_status,
            "processing"
          ),
          video_url: null,
          created_at: now,
          updated_at: now,
          error: null,
        },
      ],
      initial.context.manifest
    )[0];
    if (!startedAsset) {
      throw new Error(
        "The processing lip-sync attempt could not be normalized safely. Nothing new was saved, so retry this take."
      );
    }
    const validatedStartedAsset = assertLipsyncAssetLineage(
      startedAsset,
      initial.context,
      predictionId,
      provider
    );
    const persistedStart = await persistStartedAsset(
      input,
      suppliedAudio,
      suppliedCloseup,
      initial.context,
      validatedStartedAsset
    );
    if (persistedStart.status !== "PROCESSING") {
      throw new Error(
        "The lip-sync service returned an unsupported start state. The saved attempt remains unchanged."
      );
    }

    return pollUntilReady(
      input,
      suppliedAudio,
      suppliedCloseup,
      initial.context,
      predictionId
    );
  };

  return { ensureLipsyncAsset };
}
