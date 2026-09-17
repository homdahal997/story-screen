import { createSuperdevClient } from "npm:@superdevhq/client@0.1.56";

const LIPSYNC_MODEL = "pixverse/lipsync";
const REPLICATE_API_BASE = "https://api.replicate.com/v1";
const MAX_PREDICTION_ID_LENGTH = 180;
const MAX_LINE_ID_LENGTH = 180;
const MAX_TEXT_LENGTH = 20000;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const DIALOGUE_LINE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,179}$/;
const SAFE_PROVIDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_:-]{0,179}$/;

const superdev = createSuperdevClient({
  appId: Deno.env.get("SUPERDEV_APP_ID"),
});

type PixverseOperation = "start" | "status";
type SafeAssetStatus = "PROCESSING" | "READY" | "FAILED" | "CANCELED";
type SafeRemoteStatus = "starting" | "processing" | "succeeded" | "failed" | "canceled";

const DIALOGUE_CLOSEUP_SOURCE_KIND = "dialogue_closeup" as const;

interface RequestContext {
  integrationHeaders: Record<string, string>;
}

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

function safeIdentifier(value: unknown, max = MAX_PREDICTION_ID_LENGTH): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max || !SAFE_PROVIDER_ID_PATTERN.test(trimmed)) return null;
  return trimmed;
}

function safeLineId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_LINE_ID_LENGTH || !DIALOGUE_LINE_ID_PATTERN.test(trimmed)) return null;
  return trimmed;
}

function exactText(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_TEXT_LENGTH ||
    !value.trim() ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)
  ) return null;
  return value;
}

function cleanIdentifier(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase().replace(/\s+/g, "_") : "";
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    return new URL(value.trim()).protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeRemoteStatus(value: unknown): SafeRemoteStatus {
  const status = typeof value === "string" ? value.toLowerCase() : "";
  if (status === "starting" || status === "queued") return "starting";
  if (status === "processing" || status === "running") return "processing";
  if (status === "succeeded" || status === "completed") return "succeeded";
  if (status === "canceled" || status === "cancelled") return "canceled";
  if (status === "failed" || status === "error") return "failed";
  return "processing";
}

function assetStatusFromRemote(value: unknown): SafeAssetStatus {
  const remote = normalizeRemoteStatus(value);
  if (remote === "succeeded") return "READY";
  if (remote === "failed") return "FAILED";
  if (remote === "canceled") return "CANCELED";
  return "PROCESSING";
}

function friendlyPredictionError(status: SafeRemoteStatus, rawError?: unknown): string | null {
  if (status === "canceled") {
    return "The PixVerse lip-sync prediction was canceled before a video was produced. Start this take again when you are ready.";
  }
  if (status !== "failed") return null;

  const message = safeText(rawError, 360)?.toLowerCase() || "";
  if (message.includes("credit") || message.includes("billing")) {
    return "PixVerse could not finish the lip-sync render because the connected Replicate account limit was reached. Check Replicate billing, then retry this take.";
  }
  if (message.includes("audio") || message.includes("video") || message.includes("input")) {
    return "PixVerse could not use the saved close-up video and dialogue take. Keep those source assets and start this take again.";
  }
  return "PixVerse could not finish this render. The saved source clip and dialogue take are safe, so retry this take.";
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

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function replicateFetch(
  path: string,
  token: string,
  init: RequestInit = {}
): Promise<{ response: Response; data: unknown }> {
  const response = await fetch(`${REPLICATE_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const data = await readJson(response);
  return { response, data };
}

async function authenticate(request: Request): Promise<RequestContext> {
  const authorization = request.headers.get("Authorization")?.trim();
  if (!authorization || !/^Bearer\s+\S+/i.test(authorization)) {
    throw new RequestError(401, "Sign in to run a private PixVerse lip-sync render.", "AUTH_REQUIRED");
  }

  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  superdev.auth.setToken(token);
  try {
    const user = await superdev.auth.me();
    if (!user || typeof user.email !== "string" || !user.email.trim()) throw new Error("missing user");
  } catch {
    throw new RequestError(401, "Your creator session expired. Sign in again before running PixVerse lip-sync.", "AUTH_REQUIRED");
  }

  const origin = request.headers.get("Origin");
  return {
    integrationHeaders: {
      Authorization: authorization,
      ...(origin ? { Origin: origin } : {}),
    },
  };
}

async function getOwnedProject(projectIdValue: unknown): Promise<Record<string, unknown>> {
  const projectId = safeText(projectIdValue, 180);
  if (!projectId) {
    throw new RequestError(400, "A saved project is required for PixVerse lip-sync.", "PROJECT_REQUIRED");
  }

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
    throw new RequestError(401, "Your creator session expired. Sign in again before running PixVerse lip-sync.", "AUTH_REQUIRED");
  }
  if (typeof user.email !== "string" || project.created_by !== user.email) {
    throw new RequestError(403, "This PixVerse lip-sync render belongs to another private project.", "PROJECT_FORBIDDEN");
  }
  return project;
}

function readSceneNumber(value: unknown): number {
  const sceneNumber = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(sceneNumber) || sceneNumber < 1 || sceneNumber > 99) {
    throw new RequestError(400, "Choose a valid saved scene for PixVerse lip-sync.", "SCENE_REQUIRED");
  }
  return sceneNumber;
}

function assertApprovedScript(project: Record<string, unknown>): Record<string, unknown> {
  const manifest = isRecord(project.manifest) ? project.manifest : null;
  const legacyApproval = project.production_approved === undefined || project.production_approved === null;
  if (
    project.status !== "SCRIPTED" ||
    !manifest ||
    (project.production_approved !== true && !legacyApproval)
  ) {
    throw new RequestError(400, "Approve the screenplay before starting a private PixVerse lip-sync render.", "PRODUCTION_REQUIRED");
  }
  return manifest;
}

function findApprovedScene(
  project: Record<string, unknown>,
  sceneNumber: number
): { manifest: Record<string, unknown>; scene: Record<string, unknown> } {
  const manifest = assertApprovedScript(project);
  const scenes = Array.isArray(manifest.scenes) ? manifest.scenes : [];
  const scene = scenes.find((candidate) => isRecord(candidate) && Number(candidate.scene_number) === sceneNumber);
  if (!isRecord(scene)) {
    throw new RequestError(400, `Scene ${sceneNumber} is not in the current approved screenplay.`, "SCENE_NOT_FOUND");
  }
  return { manifest, scene };
}

function getLegacyLineId(sceneNumber: number): string {
  return `scene-${sceneNumber}-line-1`;
}

function readCurrentDialogueLine(
  project: Record<string, unknown>,
  sceneNumber: number,
  submittedLineId: unknown
): { scene: Record<string, unknown>; line_id: string; character_id: string; text: string } {
  const lineId = safeLineId(submittedLineId);
  if (!lineId) {
    throw new RequestError(400, "A valid saved dialogue line is required for PixVerse lip-sync.", "LINE_REQUIRED");
  }

  const { scene } = findApprovedScene(project, sceneNumber);
  const savedDialogue = exactText(scene.dialogue);
  if (!savedDialogue) {
    throw new RequestError(400, `Scene ${sceneNumber} has no saved dialogue to send to PixVerse yet.`, "DIALOGUE_REQUIRED");
  }

  const focusedCharacters = Array.isArray(scene.character_focus)
    ? scene.character_focus
      .filter((value): value is string => typeof value === "string")
      .map((value) => cleanIdentifier(value))
      .filter(Boolean)
    : [];
  if (!focusedCharacters.length) {
    throw new RequestError(409, "The approved scene has no valid focused character. Save the screenplay again before PixVerse lip-sync.", "SCENE_INVALID");
  }

  const rawLines = scene.dialogue_lines;
  if (Array.isArray(rawLines) && rawLines.length > 0) {
    if (rawLines.length > 3) {
      throw new RequestError(409, "The approved scene contains too many dialogue lines. Save the screenplay again before PixVerse lip-sync.", "LINES_INVALID");
    }
    const seen = new Set<string>();
    const lines: Array<{ line_id: string; character_id: string; text: string; order: number }> = [];
    for (let index = 0; index < rawLines.length; index += 1) {
      const value = rawLines[index];
      if (!isRecord(value)) {
        throw new RequestError(409, "The approved scene dialogue lines are invalid. Save the screenplay again before PixVerse lip-sync.", "LINES_INVALID");
      }
      const savedLineId = safeLineId(value.line_id);
      const characterId = cleanIdentifier(value.character_id);
      const text = exactText(value.text);
      if (
        !savedLineId ||
        seen.has(savedLineId) ||
        !characterId ||
        !focusedCharacters.includes(characterId) ||
        !text ||
        typeof value.order !== "number" ||
        !Number.isInteger(value.order) ||
        value.order !== index + 1
      ) {
        throw new RequestError(409, "The approved scene dialogue lines are invalid. Save the screenplay again before PixVerse lip-sync.", "LINES_INVALID");
      }
      seen.add(savedLineId);
      lines.push({ line_id: savedLineId, character_id: characterId, text, order: index + 1 });
    }
    if (lines.map((line) => line.text).join(" ") !== savedDialogue) {
      throw new RequestError(409, "The approved scene dialogue lines are out of sync. Save the screenplay again before PixVerse lip-sync.", "LINES_INVALID");
    }
    const selected = lines.find((line) => line.line_id === lineId);
    if (!selected) {
      throw new RequestError(409, "That dialogue line is no longer in the approved screenplay. Refresh the project and retry.", "LINE_CHANGED");
    }
    return {
      scene,
      line_id: selected.line_id,
      character_id: selected.character_id,
      text: selected.text,
    };
  }

  const legacyLineId = getLegacyLineId(sceneNumber);
  if (lineId !== legacyLineId) {
    throw new RequestError(409, "That legacy dialogue line is no longer current. Refresh the project and retry.", "LINE_CHANGED");
  }
  return {
    scene,
    line_id: legacyLineId,
    character_id: focusedCharacters[0],
    text: savedDialogue,
  };
}

function readUpdatedAt(value: unknown): number {
  if (typeof value !== "string") return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Production PixVerse records live in the shared collection. Keep it first so
 * an accidental duplicate ID resolves to the production lineage deterministically.
 */
function orderedPixverseAssets(project: Record<string, unknown>): unknown[] {
  const productionAssets = Array.isArray(project.lipsync_assets) ? project.lipsync_assets : [];
  const comparisonAssets = Array.isArray(project.pixverse_lipsync_assets)
    ? project.pixverse_lipsync_assets
    : [];
  return [...productionAssets, ...comparisonAssets];
}

function findSavedReadyDialogueCloseup(
  project: Record<string, unknown>,
  sceneNumber: number,
  line: { line_id: string; character_id: string; text: string },
  predictionId: string
): { prediction_id: string; video_url: string } {
  const clips = Array.isArray(project.dialogue_shot_clips) ? project.dialogue_shot_clips : [];
  const clip = clips.find((candidate) =>
    isRecord(candidate) && candidate.prediction_id === predictionId
  );
  if (!isRecord(clip)) {
    throw new RequestError(403, "That dialogue close-up is not attached to the selected private project.", "CLIP_FORBIDDEN");
  }
  if (clip.provider !== "replicate-luma" || clip.shot_role !== "dialogue_closeup") {
    throw new RequestError(409, "That prediction is not a dialogue close-up source for PixVerse.", "CLOSEUP_SOURCE_INVALID");
  }
  if (clip.status !== "READY") {
    throw new RequestError(409, "Choose a READY dialogue close-up before starting PixVerse lip-sync.", "CLIP_NOT_READY");
  }
  if (
    Number(clip.scene_number) !== sceneNumber ||
    typeof clip.line_id !== "string" ||
    clip.line_id.trim() !== line.line_id ||
    cleanIdentifier(clip.character_id) !== line.character_id ||
    clip.text !== line.text
  ) {
    throw new RequestError(409, "That close-up no longer matches the current approved dialogue line. Refresh the project and choose its current source.", "CLOSEUP_LINE_CHANGED");
  }
  const videoUrl = isHttpsUrl(clip.video_url) ? clip.video_url.trim() : "";
  if (!videoUrl) {
    throw new RequestError(409, "The selected READY dialogue close-up has no private video archive. Choose another source.", "CLIP_OUTPUT_MISSING");
  }
  return { prediction_id: predictionId, video_url: videoUrl };
}

function findExactSavedReadyDialogue(
  project: Record<string, unknown>,
  sceneNumber: number,
  lineId: string,
  characterId: string,
  text: string,
  submittedAudioUrl: unknown
): { audio_url: string; content_type: "audio/mpeg" } {
  if (!isHttpsUrl(submittedAudioUrl)) {
    throw new RequestError(400, "Pass the exact managed READY ElevenLabs MP3 for this PixVerse close-up line.", "DIALOGUE_TAKE_REQUIRED");
  }
  const requestedAudioUrl = submittedAudioUrl.trim();
  const assets = Array.isArray(project.audio_assets) ? project.audio_assets : [];
  const selected = assets.find((candidate) => {
    if (!isRecord(candidate)) return false;
    if (candidate.asset_type !== "dialogue" || candidate.provider !== "elevenlabs" || candidate.status !== "READY") return false;
    if (Number(candidate.scene_number) !== sceneNumber) return false;
    const candidateLineId = typeof candidate.line_id === "string" && candidate.line_id.trim()
      ? candidate.line_id.trim()
      : getLegacyLineId(sceneNumber);
    if (candidateLineId !== lineId) return false;
    if (cleanIdentifier(candidate.character_id) !== characterId || candidate.text !== text) return false;
    const contentType = typeof candidate.content_type === "string"
      ? candidate.content_type.split(";", 1)[0].trim().toLowerCase()
      : "";
    return contentType === "audio/mpeg" &&
      isHttpsUrl(candidate.audio_url) &&
      candidate.audio_url.trim() === requestedAudioUrl;
  });
  if (!isRecord(selected)) {
    throw new RequestError(409, "That audio URL is not the exact saved READY ElevenLabs take for this approved line.", "DIALOGUE_TAKE_CHANGED");
  }
  return {
    audio_url: requestedAudioUrl,
    content_type: "audio/mpeg",
  };
}

function requireExactCloseupCharacter(body: Record<string, unknown>, savedCharacterId: string): void {
  if (body.character_id === undefined || body.character_id === null) {
    throw new RequestError(400, "Pass the exact approved speaker for this PixVerse dialogue close-up.", "SPEAKER_REQUIRED");
  }
  const submittedCharacterId = cleanIdentifier(body.character_id);
  if (!submittedCharacterId || submittedCharacterId !== savedCharacterId) {
    throw new RequestError(409, "The saved speaker changed. Refresh the project and retry the current line.", "SPEAKER_CHANGED");
  }
}

function requireExactCloseupText(body: Record<string, unknown>, savedText: string): void {
  if (body.text === undefined || body.text === null) {
    throw new RequestError(400, "Pass the exact approved dialogue text for this PixVerse close-up line.", "DIALOGUE_REQUIRED");
  }
  const submittedText = exactText(body.text);
  if (submittedText === null || submittedText !== savedText) {
    throw new RequestError(409, "The saved dialogue text changed. Refresh the project and retry the current line.", "DIALOGUE_CHANGED");
  }
}

function requireExactSourceUrl(
  body: Record<string, unknown>,
  key: string,
  savedUrl: string,
  label: string
): string {
  if (!isHttpsUrl(body[key])) {
    throw new RequestError(400, `Pass the exact managed READY ${label} URL for PixVerse lip-sync.`, "SOURCE_REQUIRED");
  }
  const submittedUrl = body[key].trim();
  if (submittedUrl !== savedUrl) {
    throw new RequestError(409, `The saved ${label} changed. Refresh the project and retry the current line.`, "SOURCE_CHANGED");
  }
  return submittedUrl;
}

function requireReplicateToken(): string {
  const token = Deno.env.get("REPLICATE_API_TOKEN")?.trim();
  if (!token) {
    throw new RequestError(500, "The Replicate connection is not configured yet. Add the project token, then retry PixVerse lip-sync.", "REPLICATE_NOT_CONFIGURED");
  }
  return token;
}

function startProviderError(status: number): RequestError {
  if (status === 401 || status === 403) {
    return new RequestError(502, "Replicate rejected the connected token for PixVerse lip-sync. Review the token connection, then retry.", "REPLICATE_AUTH");
  }
  if (status === 404) {
    return new RequestError(502, "The connected Replicate account cannot access pixverse/lipsync yet. Enable that model, then retry.", "LIPSYNC_UNAVAILABLE");
  }
  if (status === 409) {
    return new RequestError(409, "Replicate could not start PixVerse lip-sync because the saved source is already being processed. Retry after the active render settles.", "LIPSYNC_CONFLICT");
  }
  if (status === 429) {
    return new RequestError(429, "Replicate is rate limiting PixVerse lip-sync requests. Wait a moment, then retry this take.", "REPLICATE_RATE_LIMIT");
  }
  if (status === 422) {
    return new RequestError(400, "PixVerse could not use the saved close-up video and dialogue inputs. Keep those source assets and retry this take.", "LIPSYNC_INPUT_INVALID");
  }
  return new RequestError(502, "Replicate could not start PixVerse lip-sync. The saved source clip and dialogue take are safe, so retry this take.", "REPLICATE_START");
}

async function startPrediction(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (body.source_clip_kind !== undefined && body.source_clip_kind !== DIALOGUE_CLOSEUP_SOURCE_KIND) {
    throw new RequestError(400, "PixVerse lip-sync supports dialogue close-up sources only.", "SOURCE_CLIP_KIND_UNSUPPORTED");
  }

  const project = await getOwnedProject(body.project_id);
  const sceneNumber = readSceneNumber(body.scene_number);
  const lineId = safeLineId(body.line_id);
  if (!lineId) {
    throw new RequestError(400, "A valid saved dialogue line is required for PixVerse lip-sync.", "LINE_REQUIRED");
  }
  const clipPredictionId = safeIdentifier(body.clip_prediction_id);
  if (!clipPredictionId) {
    throw new RequestError(400, "A saved READY dialogue close-up is required for PixVerse lip-sync.", "CLIP_REQUIRED");
  }

  const line = readCurrentDialogueLine(project, sceneNumber, lineId);
  requireExactCloseupCharacter(body, line.character_id);
  requireExactCloseupText(body, line.text);

  const clip = findSavedReadyDialogueCloseup(project, sceneNumber, line, clipPredictionId);
  const dialogue = findExactSavedReadyDialogue(
    project,
    sceneNumber,
    line.line_id,
    line.character_id,
    line.text,
    body.source_audio_url
  );
  requireExactSourceUrl(body, "source_video_url", clip.video_url, "dialogue close-up");

  const savedPixverseAssets = orderedPixverseAssets(project);
  const active = savedPixverseAssets.find((candidate) =>
    isRecord(candidate) &&
    candidate.provider === "pixverse-lipsync" &&
    candidate.status === "PROCESSING" &&
    Number(candidate.scene_number) === sceneNumber &&
    (typeof candidate.line_id === "string" ? candidate.line_id.trim() : "") === line.line_id &&
    (typeof candidate.source_clip_prediction_id === "string" ? candidate.source_clip_prediction_id.trim() : "") === clip.prediction_id &&
    (typeof candidate.source_video_url === "string" ? candidate.source_video_url.trim() : "") === clip.video_url &&
    (typeof candidate.source_audio_url === "string" ? candidate.source_audio_url.trim() : "") === dialogue.audio_url
  );
  if (active) {
    throw new RequestError(
      409,
      "PixVerse lip-sync is already processing for this scene, line, close-up, and dialogue take. Keep the render open and check its status.",
      "LIPSYNC_ALREADY_ACTIVE"
    );
  }

  const token = requireReplicateToken();
  let predictionResult: { response: Response; data: unknown };
  try {
    predictionResult = await replicateFetch(`/models/${LIPSYNC_MODEL}/predictions`, token, {
      method: "POST",
      body: JSON.stringify({
        input: {
          video: clip.video_url,
          audio: dialogue.audio_url,
        },
      }),
    });
  } catch {
    throw new RequestError(502, "Replicate could not be reached for PixVerse lip-sync. The saved source clip and dialogue take are safe, so retry.", "REPLICATE_UNREACHABLE");
  }

  if (!predictionResult.response.ok || !isRecord(predictionResult.data)) {
    throw startProviderError(predictionResult.response.status);
  }
  const predictionId = safeIdentifier(predictionResult.data.id);
  if (!predictionId) {
    throw new RequestError(502, "Replicate returned no PixVerse lip-sync prediction ID. Nothing was saved, so retry this take.", "PREDICTION_INVALID");
  }
  const remoteStatus = normalizeRemoteStatus(predictionResult.data.status);
  return {
    ok: true,
    operation: "start",
    prediction_id: predictionId,
    status: assetStatusFromRemote(predictionResult.data.status),
    remote_status: remoteStatus,
    scene_number: sceneNumber,
    line_id: line.line_id,
    character_id: line.character_id,
    clip_prediction_id: clip.prediction_id,
    source_clip_prediction_id: clip.prediction_id,
  };
}

async function fetchPrediction(token: string, predictionId: string): Promise<Record<string, unknown>> {
  let result: { response: Response; data: unknown };
  try {
    result = await replicateFetch(`/predictions/${encodeURIComponent(predictionId)}`, token);
  } catch {
    throw new RequestError(502, "Replicate could not be reached while checking PixVerse lip-sync. Keep the saved processing record and retry.", "REPLICATE_UNREACHABLE");
  }
  if (!result.response.ok || !isRecord(result.data)) {
    if (result.response.status === 404) {
      throw new RequestError(404, "Replicate could not find this PixVerse lip-sync prediction. Keep the saved source assets and start a new take.", "PREDICTION_NOT_FOUND");
    }
    if (result.response.status === 401 || result.response.status === 403) {
      throw new RequestError(502, "Replicate rejected the connected token while checking PixVerse lip-sync. Review the token connection, then retry.", "REPLICATE_AUTH");
    }
    throw new RequestError(502, "Replicate could not return the PixVerse lip-sync status. Keep the processing record and try again shortly.", "REPLICATE_STATUS");
  }
  return result.data;
}

function extractVideoUrl(value: unknown, depth = 0): string | null {
  if (depth > 3) return null;
  if (isHttpsUrl(value)) return value.trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractVideoUrl(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  for (const key of ["video_url", "url", "file_url", "output", "video"]) {
    const found = extractVideoUrl(value[key], depth + 1);
    if (found) return found;
  }
  return null;
}

async function readLimitedBody(response: Response): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_VIDEO_BYTES) {
    throw new RequestError(413, "The PixVerse lip-sync video is larger than the private archive limit. Retry this take.", "VIDEO_TOO_LARGE");
  }
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_VIDEO_BYTES) {
      throw new RequestError(413, "The PixVerse lip-sync video is larger than the private archive limit. Retry this take.", "VIDEO_TOO_LARGE");
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
      if (total > MAX_VIDEO_BYTES) {
        await reader.cancel();
        throw new RequestError(413, "The PixVerse lip-sync video is larger than the private archive limit. Retry this take.", "VIDEO_TOO_LARGE");
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

function hasMp4Container(bytes: Uint8Array): boolean {
  const limit = Math.min(Math.max(0, bytes.byteLength - 4), 128);
  for (let index = 0; index <= limit; index += 1) {
    if (
      bytes[index] === 0x66 &&
      bytes[index + 1] === 0x74 &&
      bytes[index + 2] === 0x79 &&
      bytes[index + 3] === 0x70
    ) return true;
  }
  return false;
}

type ArchiveFailureCategory =
  | "output_missing"
  | "download_failed"
  | "video_type_unsupported"
  | "video_too_large"
  | "video_read_failed"
  | "video_invalid"
  | "archive_upload_failed"
  | "archive_url_invalid"
  | "archive_internal";

const ARCHIVE_RETRY_MESSAGE =
  "PixVerse finished this lip-sync, but the private MP4 archive could not be completed. Your saved source clip and dialogue take are safe, so retry this take.";

function normalizeArchiveContentType(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.split(";", 1)[0].trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "video/mp4" || normalized === "application/octet-stream") return normalized;
  if (/^video\/[a-z0-9.+-]{1,32}$/.test(normalized)) return normalized;
  return "other";
}

function knownContentLength(response: Response): number | null {
  const parsed = Number(response.headers.get("content-length") || "");
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > Number.MAX_SAFE_INTEGER) return null;
  return Math.floor(parsed);
}

function safeArchiveSceneNumber(value: unknown): number | null {
  const sceneNumber = typeof value === "number" ? value : Number(value);
  return Number.isInteger(sceneNumber) && sceneNumber >= 1 && sceneNumber <= 99 ? sceneNumber : null;
}

function savedPixverseLipsyncLineage(trackedAsset: Record<string, unknown>): Record<string, unknown> {
  const sceneNumber = safeArchiveSceneNumber(trackedAsset.scene_number);
  const lineId = safeLineId(trackedAsset.line_id);
  const rawCharacterId = typeof trackedAsset.character_id === "string" ? trackedAsset.character_id.trim() : "";
  const normalizedCharacterId = cleanIdentifier(rawCharacterId);
  const characterId = /^[A-Z0-9][A-Z0-9_-]{0,179}$/.test(normalizedCharacterId) ? normalizedCharacterId : null;
  const sourceClipPredictionId = safeIdentifier(trackedAsset.source_clip_prediction_id);

  return {
    ...(sceneNumber === null ? {} : { scene_number: sceneNumber }),
    ...(lineId ? { line_id: lineId } : {}),
    ...(characterId ? { character_id: characterId } : {}),
    ...(sourceClipPredictionId
      ? {
          clip_prediction_id: sourceClipPredictionId,
          source_clip_prediction_id: sourceClipPredictionId,
        }
      : {}),
  };
}

function archiveFailureResponse(
  predictionId: string,
  trackedAsset: Record<string, unknown>,
  category: ArchiveFailureCategory,
  bytes: number | null,
  contentType: string | null
): Record<string, unknown> {
  console.error("pixverse-lipsync archive failed", {
    prediction_id: predictionId,
    bytes,
    content_type: contentType,
    category,
  });

  return {
    ok: true,
    operation: "status",
    prediction_id: predictionId,
    status: "FAILED",
    remote_status: "succeeded",
    error: ARCHIVE_RETRY_MESSAGE,
    code: "ARCHIVE_FAILED",
    ...savedPixverseLipsyncLineage(trackedAsset),
  };
}

async function archiveCompletedPrediction(
  context: RequestContext,
  predictionId: string,
  prediction: Record<string, unknown>,
  trackedAsset: Record<string, unknown>
): Promise<Record<string, unknown>> {
  let downloadedBytes: number | null = null;
  let contentType: string | null = null;

  try {
    const outputUrl = extractVideoUrl(prediction.output);
    if (!outputUrl) {
      return archiveFailureResponse(predictionId, trackedAsset, "output_missing", downloadedBytes, contentType);
    }

    let outputResponse: Response;
    try {
      outputResponse = await fetch(outputUrl, { redirect: "follow" });
    } catch {
      return archiveFailureResponse(predictionId, trackedAsset, "download_failed", downloadedBytes, contentType);
    }

    contentType = normalizeArchiveContentType(outputResponse.headers.get("content-type"));
    downloadedBytes = knownContentLength(outputResponse);
    if (!outputResponse.ok) {
      return archiveFailureResponse(predictionId, trackedAsset, "download_failed", downloadedBytes, contentType);
    }
    if (contentType !== "video/mp4" && contentType !== "application/octet-stream") {
      return archiveFailureResponse(predictionId, trackedAsset, "video_type_unsupported", downloadedBytes, contentType);
    }

    let bytes: Uint8Array;
    try {
      bytes = await readLimitedBody(outputResponse);
    } catch (error) {
      const category: ArchiveFailureCategory =
        error instanceof RequestError && error.code === "VIDEO_TOO_LARGE"
          ? "video_too_large"
          : "video_read_failed";
      return archiveFailureResponse(predictionId, trackedAsset, category, downloadedBytes, contentType);
    }
    downloadedBytes = bytes.byteLength;
    if (!bytes.byteLength || !hasMp4Container(bytes)) {
      return archiveFailureResponse(predictionId, trackedAsset, "video_invalid", downloadedBytes, contentType);
    }

    const sceneNumber = safeArchiveSceneNumber(trackedAsset.scene_number);
    const lineId = safeLineId(trackedAsset.line_id) || "line-1";
    const safeArchiveLineId = lineId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, MAX_LINE_ID_LENGTH) || "line-1";
    const file = new File(
      [bytes],
      `frame-scene-${sceneNumber ?? 0}-${safeArchiveLineId}-pixverse-lipsync.mp4`,
      { type: "video/mp4" }
    );

    let uploadResult: unknown;
    try {
      uploadResult = await superdev.integrations.core.uploadFile(
        { file },
        { headers: context.integrationHeaders }
      );
    } catch {
      return archiveFailureResponse(predictionId, trackedAsset, "archive_upload_failed", downloadedBytes, contentType);
    }

    const managedUrlValue = isRecord(uploadResult) ? uploadResult.file_url : null;
    const managedUrl = typeof managedUrlValue === "string" ? managedUrlValue.trim() : "";
    if (!isHttpsUrl(managedUrl) || managedUrl === outputUrl.trim()) {
      return archiveFailureResponse(predictionId, trackedAsset, "archive_url_invalid", downloadedBytes, contentType);
    }

    return {
      ok: true,
      operation: "status",
      prediction_id: predictionId,
      status: "READY",
      remote_status: "succeeded",
      file_url: managedUrl,
      content_type: "video/mp4",
      bytes: bytes.byteLength,
      ...savedPixverseLipsyncLineage(trackedAsset),
    };
  } catch {
    return archiveFailureResponse(predictionId, trackedAsset, "archive_internal", downloadedBytes, contentType);
  }
}

async function statusPrediction(
  context: RequestContext,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const project = await getOwnedProject(body.project_id);
  const predictionId = safeIdentifier(body.prediction_id);
  if (!predictionId) {
    throw new RequestError(400, "A saved PixVerse lip-sync prediction is required.", "PREDICTION_REQUIRED");
  }

  const assets = orderedPixverseAssets(project);
  const trackedAsset = assets.find((candidate) =>
    isRecord(candidate) &&
    candidate.provider === "pixverse-lipsync" &&
    candidate.prediction_id === predictionId
  );
  if (!isRecord(trackedAsset)) {
    throw new RequestError(403, "That PixVerse lip-sync prediction is not attached to this private project.", "PREDICTION_FORBIDDEN");
  }
  if (trackedAsset.status !== "PROCESSING") {
    throw new RequestError(409, "This PixVerse lip-sync prediction is no longer processing. Refresh the project before checking it again.", "PREDICTION_NOT_PROCESSING");
  }

  const token = requireReplicateToken();
  const prediction = await fetchPrediction(token, predictionId);
  const remoteStatus = normalizeRemoteStatus(prediction.status);
  const status = assetStatusFromRemote(prediction.status);
  if (status === "PROCESSING") {
    return {
      ok: true,
      operation: "status",
      prediction_id: predictionId,
      status,
      remote_status: remoteStatus,
      ...savedPixverseLipsyncLineage(trackedAsset),
    };
  }
  if (status === "FAILED" || status === "CANCELED") {
    return {
      ok: true,
      operation: "status",
      prediction_id: predictionId,
      status,
      remote_status: remoteStatus,
      ...savedPixverseLipsyncLineage(trackedAsset),
      error: friendlyPredictionError(remoteStatus, prediction.error) || "PixVerse did not produce a video. Retry this take when you are ready.",
    };
  }

  return archiveCompletedPrediction(context, predictionId, prediction, trackedAsset);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: responseHeaders(request) });
  }
  if (request.method !== "POST") {
    return errorResponse(request, 405, "Use POST for the private PixVerse lip-sync service.", "METHOD_NOT_ALLOWED");
  }

  try {
    const context = await authenticate(request);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new RequestError(400, "The PixVerse lip-sync request body is invalid JSON.", "INVALID_BODY");
    }
    if (!isRecord(body)) throw new RequestError(400, "The PixVerse lip-sync request body is invalid.", "INVALID_BODY");

    const operation = body.operation as PixverseOperation;
    if (operation === "start") return jsonResponse(request, await startPrediction(body));
    if (operation === "status") return jsonResponse(request, await statusPrediction(context, body));
    throw new RequestError(400, "Choose a supported PixVerse lip-sync operation.", "OPERATION_REQUIRED");
  } catch (error) {
    if (error instanceof RequestError) return errorResponse(request, error.status, error.message, error.code);
    console.error("pixverse-lipsync failed", error instanceof Error ? "unexpected_error" : "unknown_error");
    return errorResponse(request, 500, "The private PixVerse lip-sync service could not complete. The saved project is safe, so retry this take.", "LIPSYNC_SERVICE_FAILED");
  }
});
