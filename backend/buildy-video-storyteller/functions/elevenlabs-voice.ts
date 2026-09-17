import { createSuperdevClient } from "npm:@superdevhq/client@0.1.56";

const ELEVENLABS_VOICES_URL = "https://api.elevenlabs.io/v2/voices?page_size=100";
const ELEVENLABS_TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech";
const MAX_DIALOGUE_LENGTH = 20000;
const MAX_DIALOGUE_LINE_ID = 180;
const DIALOGUE_LINE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,179}$/;
const MAX_AUDIO_BYTES = 24 * 1024 * 1024;
const MAX_VOICES = 100;

 type VoiceOperation = "list_voices" | "synthesize_dialogue";

type RequestContext = {
  authorization: string;
  integrationHeaders: Record<string, string>;
};

const superdev = createSuperdevClient({
  appId: Deno.env.get("SUPERDEV_APP_ID"),
});

class RequestError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "RequestError";
    this.status = status;
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeText(value: unknown, max = 700): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function hasUnsupportedDialogueControlCharacter(value: string): boolean {
  return /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value);
}

function exactDialogue(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !value.length ||
    value.length > MAX_DIALOGUE_LENGTH ||
    hasUnsupportedDialogueControlCharacter(value)
  ) return null;
  return value;
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    return new URL(value.trim()).protocol === "https:";
  } catch {
    return false;
  }
}

function responseHeaders(request: Request): Headers {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  });
  const origin = request.headers.get("Origin");
  if (origin) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}

function jsonResponse(request: Request, payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: responseHeaders(request),
  });
}

function errorResponse(request: Request, status: number, message: string, code?: string): Response {
  return jsonResponse(request, {
    ok: false,
    error: message,
    ...(code ? { code } : {}),
  }, status);
}

function requireApiKey(): string {
  const key = Deno.env.get("ELEVENLABS_API_KEY")?.trim();
  if (!key) {
    throw new RequestError(
      500,
      "The ElevenLabs connection is not configured yet. Add the project connection, then retry the sound test.",
      "ELEVENLABS_NOT_CONFIGURED"
    );
  }
  return key;
}

async function authenticate(request: Request): Promise<RequestContext> {
  const authorization = request.headers.get("Authorization")?.trim();
  if (!authorization || !/^Bearer\s+\S+/i.test(authorization)) {
    throw new RequestError(401, "Sign in to use the private sound test.", "AUTH_REQUIRED");
  }

  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  superdev.auth.setToken(token);
  try {
    const user = await superdev.auth.me();
    if (!user || typeof user.email !== "string" || !user.email.trim()) throw new Error("missing user");
  } catch {
    throw new RequestError(401, "Your creator session expired. Sign in again before running a sound test.", "AUTH_REQUIRED");
  }

  const origin = request.headers.get("Origin");
  return {
    authorization,
    integrationHeaders: {
      Authorization: authorization,
      ...(origin ? { Origin: origin } : {}),
    },
  };
}

async function getOwnedProject(projectIdValue: unknown): Promise<Record<string, unknown>> {
  const projectId = safeText(projectIdValue, 180);
  if (!projectId) throw new RequestError(400, "A saved project is required for the sound test.", "PROJECT_REQUIRED");

  let project: unknown;
  try {
    project = await superdev.entities.DramaProject.get(projectId);
  } catch {
    throw new RequestError(404, "That saved project could not be found in your private library.", "PROJECT_NOT_FOUND");
  }
  if (!isRecord(project)) {
    throw new RequestError(404, "That saved project could not be found in your private library.", "PROJECT_NOT_FOUND");
  }

  let user: { email?: string };
  try {
    user = await superdev.auth.me();
  } catch {
    throw new RequestError(401, "Your creator session expired. Sign in again before running a sound test.", "AUTH_REQUIRED");
  }
  if (typeof user.email !== "string" || project.created_by !== user.email) {
    throw new RequestError(403, "This sound test belongs to another private project.", "PROJECT_FORBIDDEN");
  }
  return project;
}

function readSceneNumber(value: unknown): number {
  const sceneNumber = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(sceneNumber) || sceneNumber < 1 || sceneNumber > 99) {
    throw new RequestError(400, "Choose a valid saved scene for the sound test.", "SCENE_REQUIRED");
  }
  return sceneNumber;
}

function isSafeDialogueLineId(value: unknown): value is string {
  return typeof value === "string" && DIALOGUE_LINE_ID_PATTERN.test(value.trim());
}

function getLegacyDialogueLineId(sceneNumber: number): string {
  return `scene-${sceneNumber}-line-1`;
}

function requireSavedDialogue(
  project: Record<string, unknown>,
  sceneNumber: number,
  characterId: string,
  submittedDialogue: unknown,
  submittedLineId: unknown
): {
  scene: Record<string, unknown>;
  dialogue: string;
  line_id: string;
} {
  const manifest = isRecord(project.manifest) ? project.manifest : null;
  const legacyApproval = project.production_approved === undefined || project.production_approved === null;
  const savedScreenplayApproved =
    project.status === "SCRIPTED" &&
    Boolean(manifest) &&
    (project.production_approved === true || legacyApproval);
  if (!savedScreenplayApproved || !manifest) {
    throw new RequestError(400, "Approve the screenplay before opening the private sound test.", "PRODUCTION_REQUIRED");
  }

  const scenes = Array.isArray(manifest.scenes) ? manifest.scenes : [];
  const scene = scenes.find((candidate) => isRecord(candidate) && Number(candidate.scene_number) === sceneNumber);
  if (!isRecord(scene)) {
    throw new RequestError(400, `Scene ${sceneNumber} is not in the current saved screenplay.`, "SCENE_NOT_FOUND");
  }

  const savedDialogue = exactDialogue(scene.dialogue) || "";
  if (!savedDialogue.trim()) {
    throw new RequestError(400, `Scene ${sceneNumber} has no saved dialogue to synthesize yet.`, "DIALOGUE_REQUIRED");
  }
  const focusedCharacters = Array.isArray(scene.character_focus)
    ? scene.character_focus.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean)
    : [];
  if (!focusedCharacters.includes(characterId)) {
    throw new RequestError(400, "Choose a character who is focused in this saved scene.", "CHARACTER_NOT_IN_SCENE");
  }

  if (submittedLineId !== undefined && submittedLineId !== null && typeof submittedLineId !== "string") {
    throw new RequestError(400, "The saved speaker line ID is invalid. Refresh the project and retry.", "LINE_ID_INVALID");
  }
  const requestedLineId = typeof submittedLineId === "string" ? submittedLineId.trim() : "";
  if (requestedLineId && !isSafeDialogueLineId(requestedLineId)) {
    throw new RequestError(400, "The saved speaker line ID is invalid. Refresh the project and retry.", "LINE_ID_INVALID");
  }

  const exactSubmitted = exactDialogue(submittedDialogue);
  if (exactSubmitted === null) {
    throw new RequestError(409, "The saved scene dialogue changed. Refresh the project and use the current screenplay text.", "DIALOGUE_CHANGED");
  }

  const rawDialogueLines = scene.dialogue_lines;
  if (Array.isArray(rawDialogueLines) && rawDialogueLines.length > 0) {
    if (rawDialogueLines.length > 3) {
      throw new RequestError(409, "The saved scene contains too many speaker lines. Refresh the project and save the screenplay again.", "LINES_INVALID");
    }
    const seenLineIds = new Set<string>();
    const savedLines: Array<{ line_id: string; character_id: string; text: string }> = [];
    for (let index = 0; index < rawDialogueLines.length; index += 1) {
      const value = rawDialogueLines[index];
      if (!isRecord(value)) {
        throw new RequestError(409, "The saved speaker lines are invalid. Refresh the project and save the screenplay again.", "LINES_INVALID");
      }
      const lineId = typeof value.line_id === "string" ? value.line_id.trim() : "";
      const lineCharacterId = typeof value.character_id === "string" ? value.character_id.trim() : "";
      const lineText = exactDialogue(value.text);
      if (
        !isSafeDialogueLineId(lineId) ||
        seenLineIds.has(lineId) ||
        !lineCharacterId ||
        !focusedCharacters.includes(lineCharacterId) ||
        lineText === null ||
        typeof value.order !== "number" ||
        !Number.isInteger(value.order) ||
        value.order !== index + 1
      ) {
        throw new RequestError(409, "The saved speaker lines are invalid. Refresh the project and save the screenplay again.", "LINES_INVALID");
      }
      seenLineIds.add(lineId);
      savedLines.push({ line_id: lineId, character_id: lineCharacterId, text: lineText });
    }

    const savedLine = savedLines.find((line) => line.line_id === requestedLineId);
    if (!requestedLineId || !savedLine) {
      throw new RequestError(409, "The saved speaker line changed. Refresh the project and use the current screenplay lines.", "LINE_CHANGED");
    }
    if (savedLine.character_id !== characterId) {
      throw new RequestError(409, "The saved speaker for this line changed. Refresh the project and retry.", "SPEAKER_CHANGED");
    }
    if (savedLine.text !== exactSubmitted) {
      throw new RequestError(409, "The saved speaker line text changed. Refresh the project and retry.", "DIALOGUE_CHANGED");
    }
    const joinedDialogue = savedLines.map((line) => line.text).join(" ");
    if (joinedDialogue !== savedDialogue) {
      throw new RequestError(409, "The saved dialogue lines are out of sync. Refresh the project and save the screenplay again.", "LINES_INVALID");
    }
    return { scene, dialogue: savedLine.text, line_id: savedLine.line_id };
  }

  const legacyLineId = getLegacyDialogueLineId(sceneNumber);
  if (requestedLineId && requestedLineId !== legacyLineId) {
    throw new RequestError(409, "The saved legacy speaker line changed. Refresh the project and retry.", "LINE_CHANGED");
  }
  if (characterId !== focusedCharacters[0]) {
    throw new RequestError(400, "Legacy dialogue belongs to the first focused character in this saved scene.", "CHARACTER_NOT_IN_SCENE");
  }
  if (exactSubmitted !== savedDialogue) {
    throw new RequestError(409, "The saved scene dialogue changed. Refresh the project and use the current screenplay text.", "DIALOGUE_CHANGED");
  }

  return { scene, dialogue: savedDialogue, line_id: legacyLineId };
}

function normalizeVoiceLabels(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const labels: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value).slice(0, 12)) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    const cleanKey = key.trim().slice(0, 40);
    if (!cleanKey) continue;
    labels[cleanKey] = raw.trim().slice(0, 120);
  }
  return labels;
}

function compactVoices(data: unknown): Array<Record<string, unknown>> {
  const voices = isRecord(data) && Array.isArray(data.voices) ? data.voices : [];
  return voices.slice(0, MAX_VOICES).flatMap((value) => {
    if (!isRecord(value)) return [];
    const voiceId = safeText(value.voice_id, 180);
    const name = safeText(value.name, 180);
    if (!voiceId || !name) return [];
    return [{
      voice_id: voiceId,
      name,
      category: safeText(value.category, 80),
      description: safeText(value.description, 500),
      labels: normalizeVoiceLabels(value.labels),
    }];
  });
}

async function listVoices(): Promise<Record<string, unknown>> {
  const apiKey = requireApiKey();
  let response: Response;
  try {
    response = await fetch(ELEVENLABS_VOICES_URL, {
      method: "GET",
      headers: { "xi-api-key": apiKey, Accept: "application/json" },
    });
  } catch {
    throw new RequestError(502, "ElevenLabs could not be reached. Check the connection and retry loading voices.", "ELEVENLABS_UNREACHABLE");
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new RequestError(502, "ElevenLabs rejected the connected key. Check the project connection, then retry loading voices.", "ELEVENLABS_AUTH");
    }
    if (response.status === 429) {
      throw new RequestError(429, "ElevenLabs is rate limiting voice requests. Wait a moment, then retry.", "ELEVENLABS_RATE_LIMIT");
    }
    throw new RequestError(502, "ElevenLabs could not return the available voices. Retry the sound test shortly.", "VOICE_LIST_FAILED");
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new RequestError(502, "ElevenLabs returned an unreadable voice list. Retry loading voices.", "VOICE_LIST_INVALID");
  }
  return { ok: true, operation: "list_voices", voices: compactVoices(data) };
}

async function readAudioBody(response: Response): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_AUDIO_BYTES) {
    throw new RequestError(413, "This voice take is larger than the private sound archive limit. Shorten the dialogue and retry.", "AUDIO_TOO_LARGE");
  }
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_AUDIO_BYTES) {
      throw new RequestError(413, "This voice take is larger than the private sound archive limit. Shorten the dialogue and retry.", "AUDIO_TOO_LARGE");
    }
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (!next.value) continue;
      total += next.value.byteLength;
      if (total > MAX_AUDIO_BYTES) {
        await reader.cancel();
        throw new RequestError(413, "This voice take is larger than the private sound archive limit. Shorten the dialogue and retry.", "AUDIO_TOO_LARGE");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function providerError(status: number): RequestError {
  if (status === 401 || status === 403) {
    return new RequestError(502, "ElevenLabs rejected the connected key. Check the project connection, then retry this voice.", "ELEVENLABS_AUTH");
  }
  if (status === 404) {
    return new RequestError(400, "That ElevenLabs voice is no longer available. Reload the voice list and choose another voice.", "VOICE_NOT_FOUND");
  }
  if (status === 422) {
    return new RequestError(400, "ElevenLabs could not use this voice for the saved dialogue. Reload the voice list and retry.", "VOICE_REQUEST_INVALID");
  }
  if (status === 429) {
    return new RequestError(429, "ElevenLabs is rate limiting this voice request. Wait a moment, then retry.", "ELEVENLABS_RATE_LIMIT");
  }
  return new RequestError(502, "ElevenLabs could not create this voice take. The saved screenplay is safe, so retry the scene.", "SYNTHESIS_FAILED");
}

async function synthesizeDialogue(
  context: RequestContext,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const project = await getOwnedProject(body.project_id);
  const sceneNumber = readSceneNumber(body.scene_number);
  const characterId = safeText(body.character_id, 180);
  if (!characterId) throw new RequestError(400, "Choose a focused character for this voice take.", "CHARACTER_REQUIRED");
  const voiceId = safeText(body.voice_id, 180);
  if (!voiceId || !/^[A-Za-z0-9_-]+$/.test(voiceId)) {
    throw new RequestError(400, "Choose a valid ElevenLabs voice before generating the take.", "VOICE_REQUIRED");
  }
  const voiceName = safeText(body.voice_name, 180) || "Selected ElevenLabs voice";
  const { dialogue, line_id: lineId } = requireSavedDialogue(
    project,
    sceneNumber,
    characterId,
    body.dialogue,
    body.line_id
  );
  const apiKey = requireApiKey();

  let response: Response;
  try {
    response = await fetch(`${ELEVENLABS_TTS_URL}/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: dialogue,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.52,
          similarity_boost: 0.78,
          style: 0.12,
          use_speaker_boost: true,
        },
      }),
    });
  } catch {
    throw new RequestError(502, "ElevenLabs could not be reached for this voice take. The saved screenplay is safe, so retry.", "ELEVENLABS_UNREACHABLE");
  }
  if (!response.ok) throw providerError(response.status);

  const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() || "";
  if (!["audio/mpeg", "audio/mp3", "audio/x-mpeg", "application/octet-stream"].includes(contentType)) {
    throw new RequestError(415, "ElevenLabs returned a file that is not a supported MP3 voice take. Retry this scene.", "AUDIO_TYPE_UNSUPPORTED");
  }
  const bytes = await readAudioBody(response);
  if (!bytes.byteLength) throw new RequestError(502, "ElevenLabs returned an empty voice take. Retry this scene.", "AUDIO_EMPTY");

  let uploadResult: unknown;
  try {
    const safeArchiveLineId = lineId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, MAX_DIALOGUE_LINE_ID) || "line-1";
    const file = new File([bytes], `frame-scene-${sceneNumber}-${safeArchiveLineId}-dialogue.mp3`, { type: "audio/mpeg" });
    uploadResult = await superdev.integrations.core.uploadFile(
      { file },
      { headers: context.integrationHeaders }
    );
  } catch {
    throw new RequestError(502, "The voice take rendered, but private archiving failed. No new audio was saved, so retry this scene.", "ARCHIVE_FAILED");
  }

  const audioUrl = isRecord(uploadResult) ? uploadResult.file_url : null;
  if (!isHttpsUrl(audioUrl)) {
    throw new RequestError(502, "The voice take rendered, but private archiving returned no managed audio URL. Retry this scene.", "ARCHIVE_FAILED");
  }

  return {
    ok: true,
    operation: "synthesize_dialogue",
    scene_number: sceneNumber,
    line_id: lineId,
    character_id: characterId,
    voice_id: voiceId,
    voice_name: voiceName,
    audio_url: audioUrl,
    content_type: "audio/mpeg",
    bytes: bytes.byteLength,
    text_length: dialogue.length,
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: responseHeaders(request) });
  }
  if (request.method !== "POST") {
    return errorResponse(request, 405, "Use POST for the ElevenLabs sound service.", "METHOD_NOT_ALLOWED");
  }

  try {
    const context = await authenticate(request);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new RequestError(400, "The sound request body is invalid JSON.", "INVALID_BODY");
    }
    if (!isRecord(body)) throw new RequestError(400, "The sound request body is invalid.", "INVALID_BODY");

    const operation = body.operation as VoiceOperation;
    if (operation === "list_voices") return jsonResponse(request, await listVoices());
    if (operation === "synthesize_dialogue") return jsonResponse(request, await synthesizeDialogue(context, body));
    throw new RequestError(400, "Choose a supported sound operation.", "OPERATION_REQUIRED");
  } catch (error) {
    if (error instanceof RequestError) return errorResponse(request, error.status, error.message, error.code);
    console.error("elevenlabs-voice failed", error instanceof Error ? error.message : "unknown error");
    return errorResponse(request, 500, "The sound test could not complete. The saved screenplay is safe, so retry this scene.", "SOUND_SERVICE_FAILED");
  }
});
