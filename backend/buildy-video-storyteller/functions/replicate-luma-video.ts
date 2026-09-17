import { createSuperdevClient } from "npm:@superdevhq/client@0.1.56";

const LUMA_RAY_MODEL = "luma/ray-3.2";
const LUMA_RAY_ACCESS_MESSAGE =
  "The connected Replicate token cannot access Luma Ray 3.2. Enable or request access to Ray 3.2 in Replicate, then retry this scene.";
const LUMA_RAY_UNAVAILABLE_MESSAGE =
  "Luma Ray 3.2 is currently unavailable through Replicate. Confirm Ray 3.2 is enabled for the connected token, then retry this scene.";
const LUMA_RAY_START_MESSAGE =
  "Replicate could not start Luma Ray 3.2. The storyboard was not changed, so you can retry this scene safely.";
const REPLICATE_API_BASE = "https://api.replicate.com/v1";
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const MAX_PROMPT_LENGTH = 12000;
const DIALOGUE_CLOSEUP_KIND = "dialogue_closeup";
const MAX_CLOSEUP_DIALOGUE_TEXT = 4000;
const MAX_CLOSEUP_PREDICTION_ID_LENGTH = 180;
const CLOSEUP_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_:-]{0,179}$/;
const CLOSEUP_LINE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,179}$/;

type VideoOperation = "start" | "status" | "archive";
type SafeRemoteStatus = "QUEUED" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "CANCELED";
type DialogueCloseupRemoteStatus = "starting" | "processing" | "succeeded" | "failed" | "canceled";
type DialogueCloseupStatus = "QUEUED" | "PROCESSING" | "READY" | "FAILED" | "CANCELED";
type DialogueCloseupSourceFrameType = "scene_storyboard" | "character_reference";
type DialogueShotRecord = Record<string, unknown>;

type RequestContext = {
  authorization: string;
  origin?: string;
  integrationHeaders: Record<string, string>;
};

const superdev = createSuperdevClient({
  appId: Deno.env.get("SUPERDEV_APP_ID"),
});

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

function errorResponse(
  request: Request,
  status: number,
  message: string,
  code?: string,
  extra?: Record<string, unknown>
): Response {
  return jsonResponse(request, {
    ...(extra || {}),
    ok: false,
    error: message,
    ...(code ? { code } : {}),
  }, status);
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
  if (status === "starting" || status === "queued") return "QUEUED";
  if (status === "processing" || status === "running") return "PROCESSING";
  if (status === "succeeded" || status === "completed") return "SUCCEEDED";
  if (status === "canceled" || status === "cancelled") return "CANCELED";
  if (status === "failed" || status === "error") return "FAILED";
  return "QUEUED";
}

function friendlyPredictionError(status: SafeRemoteStatus, rawError?: unknown): string | null {
  if (status === "FAILED") {
    const message = safeText(rawError, 360);
    if (message) {
      const lower = message.toLowerCase();
      if (lower.includes("credit") || lower.includes("billing")) {
        return "The motion provider could not start this render because its account limit was reached. Check Replicate billing, then retry this scene.";
      }
      if (lower.includes("image") || lower.includes("input")) {
        return "Luma could not use this storyboard as a starting frame. Retry the scene after checking that its saved storyboard is available.";
      }
    }
    return "Luma could not finish this motion test. The saved storyboard is safe, so you can retry this scene.";
  }
  if (status === "CANCELED") {
    return "The motion test was canceled before a video was produced. Retry this scene when you are ready.";
  }
  return null;
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

  const candidateKeys = ["video_url", "url", "file_url", "output", "video"];
  for (const key of candidateKeys) {
    const found = extractVideoUrl(value[key], depth + 1);
    if (found) return found;
  }
  return null;
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
    throw new RequestError(401, "Sign in to run a private motion test.", "AUTH_REQUIRED");
  }

  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  superdev.auth.setToken(token);
  try {
    const user = await superdev.auth.me();
    if (!user || typeof user.email !== "string" || !user.email.trim()) {
      throw new Error("missing user");
    }
  } catch {
    throw new RequestError(401, "Your creator session expired. Sign in again before running a motion test.", "AUTH_REQUIRED");
  }

  const origin = request.headers.get("Origin") || undefined;
  return {
    authorization,
    origin,
    integrationHeaders: {
      Authorization: authorization,
      ...(origin ? { Origin: origin } : {}),
    },
  };
}

class RequestError extends Error {
  status: number;
  code?: string;
  extra?: Record<string, unknown>;

  constructor(status: number, message: string, code?: string, extra?: Record<string, unknown>) {
    super(message);
    this.name = "RequestError";
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

async function getOwnedProject(projectId: unknown): Promise<Record<string, unknown>> {
  const id = safeText(projectId, 180);
  if (!id) throw new RequestError(400, "A saved project is required for this motion test.", "PROJECT_REQUIRED");

  let project: unknown;
  try {
    project = await superdev.entities.DramaProject.get(id);
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
    throw new RequestError(401, "Your creator session expired. Sign in again before running a motion test.", "AUTH_REQUIRED");
  }
  if (typeof user.email !== "string" || project.created_by !== user.email) {
    throw new RequestError(403, "This motion test belongs to another private project.", "PROJECT_FORBIDDEN");
  }
  return project;
}

function readSceneNumber(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 99) {
    throw new RequestError(400, "Choose a valid saved scene for the motion test.", "SCENE_REQUIRED");
  }
  return number;
}

function findStoryboard(project: Record<string, unknown>, sceneNumber: number): string {
  const assets = Array.isArray(project.frame_assets) ? project.frame_assets : [];
  const asset = assets.find((candidate) =>
    isRecord(candidate) &&
    candidate.asset_type === "scene_storyboard" &&
    Number(candidate.scene_number) === sceneNumber
  );
  const imageUrl = isRecord(asset) ? asset.image_url : null;
  if (!isHttpsUrl(imageUrl)) {
    throw new RequestError(400, `Scene ${sceneNumber} needs a saved storyboard image before it can move.`, "STORYBOARD_REQUIRED");
  }
  return imageUrl.trim();
}

function findSavedClip(
  project: Record<string, unknown>,
  predictionId: string,
  sceneNumber: number
): Record<string, unknown> {
  const clips = Array.isArray(project.video_clips) ? project.video_clips : [];
  const clip = clips.find((candidate) =>
    isRecord(candidate) &&
    candidate.prediction_id === predictionId &&
    Number(candidate.scene_number) === sceneNumber
  );
  if (!clip) {
    throw new RequestError(403, "This motion prediction is not attached to the selected private project.", "PREDICTION_FORBIDDEN");
  }
  return clip;
}

function assertScriptedProject(project: Record<string, unknown>): void {
  if (project.status !== "SCRIPTED" || !isRecord(project.manifest)) {
    throw new RequestError(400, "Save a valid SCRIPTED project before running a motion test.", "SCRIPT_REQUIRED");
  }
}

async function fetchPrediction(token: string, predictionId: string): Promise<Record<string, unknown>> {
  const result = await replicateFetch(`/predictions/${encodeURIComponent(predictionId)}`, token);
  if (!result.response.ok || !isRecord(result.data)) {
    if (result.response.status === 404) {
      throw new RequestError(404, "Replicate could not find this motion prediction. Retry the selected scene to start a new test.", "PREDICTION_NOT_FOUND");
    }
    if (result.response.status === 401 || result.response.status === 403) {
      throw new RequestError(502, "Replicate rejected the connected token while checking this motion test. Review the token connection, then retry.", "REPLICATE_AUTH");
    }
    throw new RequestError(502, "Replicate could not return the motion test status. Keep the tab open and try again.", "REPLICATE_STATUS");
  }
  return result.data;
}

function requireReplicateToken(): string {
  const token = Deno.env.get("REPLICATE_API_TOKEN")?.trim();
  if (!token) {
    throw new RequestError(500, "The Replicate connection is not configured yet. Add the project token, then retry this motion test.", "REPLICATE_NOT_CONFIGURED");
  }
  return token;
}

async function startPrediction(
  request: Request,
  context: RequestContext,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const project = await getOwnedProject(body.project_id);
  assertScriptedProject(project);
  const sceneNumber = readSceneNumber(body.scene_number);
  const storyboardUrl = findStoryboard(project, sceneNumber);
  const submittedImage = safeText(body.source_storyboard_url, 2000);
  if (submittedImage && submittedImage !== storyboardUrl) {
    throw new RequestError(400, "The selected storyboard changed. Refresh the project and choose its current saved frame.", "STORYBOARD_CHANGED");
  }

  const prompt = safeText(body.prompt, MAX_PROMPT_LENGTH);
  if (!prompt) throw new RequestError(400, "A cinematic motion prompt is required for this test.", "PROMPT_REQUIRED");
  const duration = Number(body.duration_seconds || 5);
  if (duration !== 5) throw new RequestError(400, "This first motion test is fixed at five seconds.", "DURATION_UNSUPPORTED");

  const clips = Array.isArray(project.video_clips) ? project.video_clips : [];
  const activeClip = clips.find((candidate) =>
    isRecord(candidate) &&
    Number(candidate.scene_number) === sceneNumber &&
    (candidate.status === "QUEUED" || candidate.status === "PROCESSING")
  );
  if (activeClip) {
    throw new RequestError(409, "A motion test is already running for this scene. Keep the tab open while it renders.", "MOTION_ALREADY_ACTIVE");
  }

  const token = requireReplicateToken();
  let predictionResult: { response: Response; data: unknown };
  try {
    predictionResult = await replicateFetch(`/models/${LUMA_RAY_MODEL}/predictions`, token, {
      method: "POST",
      body: JSON.stringify({
        input: {
          prompt,
          start_image: storyboardUrl,
          duration: 5,
        },
      }),
    });
  } catch {
    throw new RequestError(502, LUMA_RAY_START_MESSAGE, "REPLICATE_START");
  }
  if (!predictionResult.response.ok || !isRecord(predictionResult.data)) {
    if (predictionResult.response.status === 401 || predictionResult.response.status === 403) {
      throw new RequestError(502, LUMA_RAY_ACCESS_MESSAGE, "LUMA_RAY_ACCESS");
    }
    if (predictionResult.response.status === 404) {
      throw new RequestError(502, LUMA_RAY_UNAVAILABLE_MESSAGE, "LUMA_RAY_UNAVAILABLE");
    }
    throw new RequestError(502, LUMA_RAY_START_MESSAGE, "REPLICATE_START");
  }

  const predictionId = safeText(predictionResult.data.id, 180);
  if (!predictionId) throw new RequestError(502, "Replicate returned no prediction ID. The motion test was not saved.", "PREDICTION_INVALID");
  const status = normalizeRemoteStatus(predictionResult.data.status);
  return {
    ok: true,
    operation: "start",
    prediction_id: predictionId,
    status,
    remote_status: safeText(predictionResult.data.status, 40) || "starting",
  };
}

async function statusPrediction(
  request: Request,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const project = await getOwnedProject(body.project_id);
  const sceneNumber = readSceneNumber(body.scene_number);
  const predictionId = safeText(body.prediction_id, 180);
  if (!predictionId) throw new RequestError(400, "A saved motion prediction is required.", "PREDICTION_REQUIRED");
  findSavedClip(project, predictionId, sceneNumber);

  const token = requireReplicateToken();
  const prediction = await fetchPrediction(token, predictionId);
  const status = normalizeRemoteStatus(prediction.status);
  const outputUrl = status === "SUCCEEDED" ? extractVideoUrl(prediction.output) : null;
  return {
    ok: true,
    operation: "status",
    prediction_id: predictionId,
    status,
    remote_status: safeText(prediction.status, 40) || status.toLowerCase(),
    ...(outputUrl ? { output_url: outputUrl } : {}),
    ...(friendlyPredictionError(status, prediction.error) ? { error: friendlyPredictionError(status, prediction.error) } : {}),
  };
}

async function readLimitedBody(response: Response): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_VIDEO_BYTES) {
    throw new RequestError(413, "The rendered motion clip is larger than the studio archive limit. Retry this scene at five seconds.", "VIDEO_TOO_LARGE");
  }
  if (!response.body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > MAX_VIDEO_BYTES) {
      throw new RequestError(413, "The rendered motion clip is larger than the studio archive limit. Retry this scene at five seconds.", "VIDEO_TOO_LARGE");
    }
    return buffer;
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
        throw new RequestError(413, "The rendered motion clip is larger than the studio archive limit. Retry this scene at five seconds.", "VIDEO_TOO_LARGE");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }

  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function archivePrediction(
  request: Request,
  context: RequestContext,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const project = await getOwnedProject(body.project_id);
  const sceneNumber = readSceneNumber(body.scene_number);
  const predictionId = safeText(body.prediction_id, 180);
  if (!predictionId) throw new RequestError(400, "A saved motion prediction is required before archiving.", "PREDICTION_REQUIRED");
  findSavedClip(project, predictionId, sceneNumber);

  const token = requireReplicateToken();
  const prediction = await fetchPrediction(token, predictionId);
  const status = normalizeRemoteStatus(prediction.status);
  if (status !== "SUCCEEDED") {
    throw new RequestError(409, friendlyPredictionError(status, prediction.error) || "The motion clip is still rendering. Keep the tab open and try again shortly.", "VIDEO_NOT_READY");
  }
  const outputUrl = extractVideoUrl(prediction.output);
  if (!outputUrl) {
    throw new RequestError(502, "Luma finished without returning a playable video file. Retry this scene to request a fresh clip.", "VIDEO_OUTPUT_MISSING");
  }

  let outputResponse: Response;
  try {
    outputResponse = await fetch(outputUrl, { redirect: "follow" });
  } catch {
    throw new RequestError(502, "The completed Luma clip could not be downloaded for private archiving. Retry this scene.", "VIDEO_DOWNLOAD_FAILED");
  }
  if (!outputResponse.ok) {
    throw new RequestError(502, "The completed Luma clip could not be downloaded for private archiving. Retry this scene.", "VIDEO_DOWNLOAD_FAILED");
  }
  const contentType = outputResponse.headers.get("content-type")?.split(";")[0].trim().toLowerCase() || "";
  if (!contentType.startsWith("video/") && contentType !== "application/octet-stream") {
    throw new RequestError(415, "Luma returned a file that is not a supported video clip. Retry this scene.", "VIDEO_TYPE_UNSUPPORTED");
  }
  const bytes = await readLimitedBody(outputResponse);
  if (!bytes.byteLength) throw new RequestError(502, "The completed Luma clip was empty. Retry this scene.", "VIDEO_EMPTY");

  const file = new File([bytes], `frame-scene-${sceneNumber}-motion.mp4`, {
    type: contentType || "video/mp4",
  });
  let uploadResult: unknown;
  try {
    uploadResult = await superdev.integrations.core.uploadFile(
      { file },
      { headers: context.integrationHeaders }
    );
  } catch {
    throw new RequestError(502, "The motion clip rendered, but private archiving failed. No durable clip was saved, so retry this scene.", "ARCHIVE_FAILED");
  }
  const managedUrl = isRecord(uploadResult) ? uploadResult.file_url : null;
  if (!isHttpsUrl(managedUrl)) {
    throw new RequestError(502, "The motion clip rendered, but private archiving returned no managed video URL. Retry this scene.", "ARCHIVE_FAILED");
  }

  return {
    ok: true,
    operation: "archive",
    prediction_id: predictionId,
    file_url: managedUrl,
    content_type: contentType || "video/mp4",
    bytes: bytes.byteLength,
  };
}

function closeupSafeIdentifier(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_CLOSEUP_PREDICTION_ID_LENGTH || !CLOSEUP_ID_PATTERN.test(trimmed)) return null;
  return trimmed;
}

function closeupSafeLineId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 180 || !CLOSEUP_LINE_ID_PATTERN.test(trimmed)) return null;
  return trimmed;
}

function closeupExactText(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 20000 ||
    !value.trim() ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)
  ) return null;
  return value;
}

function closeupCharacterId(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase().replace(/\s+/g, "_") : "";
}

function closeupPromptPart(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function normalizeDialogueCloseupRemoteStatus(value: unknown): DialogueCloseupRemoteStatus {
  const status = typeof value === "string" ? value.toLowerCase() : "";
  if (status === "starting" || status === "queued") return "starting";
  if (status === "processing" || status === "running") return "processing";
  if (status === "succeeded" || status === "completed" || status === "ready") return "succeeded";
  if (status === "canceled" || status === "cancelled") return "canceled";
  if (status === "failed" || status === "error") return "failed";
  return "starting";
}

function dialogueCloseupStatusForRemote(value: DialogueCloseupRemoteStatus): DialogueCloseupStatus {
  if (value === "starting") return "QUEUED";
  if (value === "failed") return "FAILED";
  if (value === "canceled") return "CANCELED";
  if (value === "succeeded") return "PROCESSING";
  return "PROCESSING";
}

function dialogueCloseupError(
  status: DialogueCloseupRemoteStatus,
  rawError?: unknown
): string | null {
  if (status === "canceled") {
    return "The dialogue close-up was canceled before a video was produced. Start a new close-up when you are ready.";
  }
  if (status !== "failed") return null;

  const providerMessage = safeText(rawError, 360)?.toLowerCase() || "";
  if (providerMessage.includes("credit") || providerMessage.includes("billing")) {
    return "Luma could not finish the dialogue close-up because the connected Replicate account reached its limit. Check Replicate billing, then start a new close-up.";
  }
  if (providerMessage.includes("image") || providerMessage.includes("input")) {
    return "Luma could not use the saved close-up source frame. Review the private frame and start a new close-up.";
  }
  return "Luma could not finish this dialogue close-up. The saved source frame and screenplay line are safe, so start a new close-up when you are ready.";
}

function assertApprovedCloseupProject(project: Record<string, unknown>): Record<string, unknown> {
  const manifest = isRecord(project.manifest) ? project.manifest : null;
  const legacyApproval = project.production_approved === undefined || project.production_approved === null;
  if (
    project.status !== "SCRIPTED" ||
    !manifest ||
    (project.production_approved !== true && !legacyApproval)
  ) {
    throw new RequestError(400, "Approve the screenplay before starting a private dialogue close-up.", "PRODUCTION_REQUIRED");
  }
  return manifest;
}

function findApprovedCloseupScene(
  project: Record<string, unknown>,
  sceneNumber: number
): { manifest: Record<string, unknown>; scene: Record<string, unknown> } {
  const manifest = assertApprovedCloseupProject(project);
  const scenes = Array.isArray(manifest.scenes) ? manifest.scenes : [];
  const scene = scenes.find((candidate) => isRecord(candidate) && Number(candidate.scene_number) === sceneNumber);
  if (!isRecord(scene)) {
    throw new RequestError(400, `Scene ${sceneNumber} is not in the approved screenplay.`, "SCENE_NOT_FOUND");
  }
  return { manifest, scene };
}

function closeupLegacyLineId(sceneNumber: number): string {
  return `scene-${sceneNumber}-line-1`;
}

function readCloseupDialogueLine(
  project: Record<string, unknown>,
  sceneNumber: number,
  body: Record<string, unknown>
): {
  manifest: Record<string, unknown>;
  scene: Record<string, unknown>;
  line_id: string;
  character_id: string;
  text: string;
} {
  const lineId = closeupSafeLineId(body.line_id);
  if (!lineId) {
    throw new RequestError(400, "A saved dialogue line is required for this close-up.", "LINE_REQUIRED");
  }
  const submittedCharacterId = closeupCharacterId(body.character_id);
  if (!submittedCharacterId) {
    throw new RequestError(400, "The saved speaking character is required for this close-up.", "SPEAKER_REQUIRED");
  }
  const submittedTextValue = body.text !== undefined ? body.text : body.dialogue;
  const submittedText = closeupExactText(submittedTextValue);
  if (!submittedText) {
    throw new RequestError(400, "The exact saved dialogue text is required for this close-up.", "DIALOGUE_REQUIRED");
  }

  const { manifest, scene } = findApprovedCloseupScene(project, sceneNumber);
  const savedDialogue = closeupExactText(scene.dialogue);
  if (!savedDialogue) {
    throw new RequestError(400, `Scene ${sceneNumber} has no saved dialogue for a close-up.`, "DIALOGUE_REQUIRED");
  }

  const focusedCharacters = Array.isArray(scene.character_focus)
    ? scene.character_focus
      .filter((value): value is string => typeof value === "string")
      .map((value) => closeupCharacterId(value))
      .filter(Boolean)
    : [];
  if (!focusedCharacters.length) {
    throw new RequestError(409, "The approved scene has no valid focused character. Save the screenplay again before creating a close-up.", "SCENE_INVALID");
  }

  const rawLines = scene.dialogue_lines;
  let savedLine: { line_id: string; character_id: string; text: string };
  if (Array.isArray(rawLines) && rawLines.length > 0) {
    if (rawLines.length > 3) {
      throw new RequestError(409, "The approved scene contains too many dialogue lines. Save the screenplay again before creating a close-up.", "LINES_INVALID");
    }
    const seen = new Set<string>();
    const lines: Array<{ line_id: string; character_id: string; text: string; order: number }> = [];
    for (let index = 0; index < rawLines.length; index += 1) {
      const value = rawLines[index];
      if (!isRecord(value)) {
        throw new RequestError(409, "The approved scene dialogue lines are invalid. Save the screenplay again before creating a close-up.", "LINES_INVALID");
      }
      const savedLineId = closeupSafeLineId(value.line_id);
      const characterId = closeupCharacterId(value.character_id);
      const text = closeupExactText(value.text);
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
        throw new RequestError(409, "The approved scene dialogue lines are invalid. Save the screenplay again before creating a close-up.", "LINES_INVALID");
      }
      seen.add(savedLineId);
      lines.push({ line_id: savedLineId, character_id: characterId, text, order: index + 1 });
    }
    if (lines.map((line) => line.text).join(" ") !== savedDialogue) {
      throw new RequestError(409, "The approved scene dialogue lines are out of sync. Save the screenplay again before creating a close-up.", "LINES_INVALID");
    }
    const selected = lines.find((line) => line.line_id === lineId);
    if (!selected) {
      throw new RequestError(409, "That dialogue line is no longer in the approved screenplay. Refresh the project and retry.", "LINE_CHANGED");
    }
    savedLine = selected;
  } else {
    const legacyLineId = closeupLegacyLineId(sceneNumber);
    if (lineId !== legacyLineId) {
      throw new RequestError(409, "That legacy dialogue line is no longer current. Refresh the project and retry.", "LINE_CHANGED");
    }
    savedLine = {
      line_id: legacyLineId,
      character_id: focusedCharacters[0],
      text: savedDialogue,
    };
  }

  if (savedLine.character_id !== submittedCharacterId) {
    throw new RequestError(409, "The saved speaker changed. Refresh the project and retry the current line.", "SPEAKER_CHANGED");
  }
  if (savedLine.text !== submittedText) {
    throw new RequestError(409, "The saved dialogue text changed. Refresh the project and retry the current line.", "DIALOGUE_CHANGED");
  }

  return {
    manifest,
    scene,
    line_id: savedLine.line_id,
    character_id: savedLine.character_id,
    text: savedLine.text,
  };
}

function findCloseupCharacter(
  manifest: Record<string, unknown>,
  characterId: string
): Record<string, unknown> {
  const characters = Array.isArray(manifest.characters) ? manifest.characters : [];
  const character = characters.find((candidate) =>
    isRecord(candidate) && closeupCharacterId(candidate.id) === characterId
  );
  if (!isRecord(character)) {
    throw new RequestError(409, "The saved speaking character is missing from the approved screenplay.", "CHARACTER_NOT_FOUND");
  }
  return character;
}

function findCloseupFrameAsset(
  project: Record<string, unknown>,
  assetType: DialogueCloseupSourceFrameType,
  sceneNumber: number,
  characterId: string
): string | null {
  const assets = Array.isArray(project.frame_assets) ? project.frame_assets : [];
  const asset = assets.find((candidate) =>
    isRecord(candidate) &&
    candidate.asset_type === assetType &&
    (assetType === "scene_storyboard"
      ? Number(candidate.scene_number) === sceneNumber
      : closeupCharacterId(candidate.character_id) === characterId)
  );
  const imageUrl = isRecord(asset) ? asset.image_url : null;
  return isHttpsUrl(imageUrl) ? imageUrl.trim() : null;
}

function resolveCloseupSourceFrame(
  project: Record<string, unknown>,
  sceneNumber: number,
  characterId: string,
  body: Record<string, unknown>
): { source_frame_type: DialogueCloseupSourceFrameType; source_frame_url: string } {
  const submittedFrameType = body.source_frame_type;
  if (
    submittedFrameType !== undefined &&
    submittedFrameType !== "scene_storyboard" &&
    submittedFrameType !== "character_reference"
  ) {
    throw new RequestError(400, "Choose the saved scene storyboard or the selected character reference as the close-up source.", "SOURCE_FRAME_TYPE_INVALID");
  }

  const directUrl = body.source_frame_url;
  const storyboardAlias = body.source_storyboard_url;
  if (directUrl !== undefined && storyboardAlias !== undefined) {
    if (!isHttpsUrl(directUrl) || !isHttpsUrl(storyboardAlias) || directUrl.trim() !== storyboardAlias.trim()) {
      throw new RequestError(409, "The selected close-up source changed. Refresh the project and choose one saved frame.", "SOURCE_FRAME_CHANGED");
    }
  }
  const submittedUrlValue = directUrl !== undefined ? directUrl : storyboardAlias;
  if (!isHttpsUrl(submittedUrlValue)) {
    throw new RequestError(400, "A saved storyboard or character reference is required as the close-up source.", "SOURCE_FRAME_REQUIRED");
  }
  const submittedUrl = submittedUrlValue.trim();
  const savedStoryboardUrl = findCloseupFrameAsset(project, "scene_storyboard", sceneNumber, characterId);
  const savedCharacterUrl = findCloseupFrameAsset(project, "character_reference", sceneNumber, characterId);

  let sourceFrameType: DialogueCloseupSourceFrameType | null = submittedFrameType || null;
  if (!sourceFrameType) {
    if (savedStoryboardUrl === submittedUrl) sourceFrameType = "scene_storyboard";
    else if (savedCharacterUrl === submittedUrl) sourceFrameType = "character_reference";
  }
  if (!sourceFrameType) {
    throw new RequestError(409, "The selected close-up source is not an exact saved frame for this project. Refresh the project and retry.", "SOURCE_FRAME_CHANGED");
  }

  const savedUrl = sourceFrameType === "scene_storyboard" ? savedStoryboardUrl : savedCharacterUrl;
  if (!savedUrl) {
    throw new RequestError(
      400,
      sourceFrameType === "scene_storyboard"
        ? `Scene ${sceneNumber} needs its saved storyboard before it can create a close-up.`
        : "The selected speaker needs a saved character reference before it can create a close-up.",
      sourceFrameType === "scene_storyboard" ? "STORYBOARD_REQUIRED" : "CHARACTER_REFERENCE_REQUIRED"
    );
  }
  if (submittedUrl !== savedUrl) {
    throw new RequestError(409, "The selected close-up source changed. Refresh the project and choose its current saved frame.", "SOURCE_FRAME_CHANGED");
  }
  return { source_frame_type: sourceFrameType, source_frame_url: savedUrl };
}

function buildDialogueCloseupPrompt(
  manifest: Record<string, unknown>,
  scene: Record<string, unknown>,
  character: Record<string, unknown>,
  lineText: string,
  characterId: string,
  sourceFrameType: DialogueCloseupSourceFrameType
): string {
  if (lineText.length > MAX_CLOSEUP_DIALOGUE_TEXT) {
    throw new RequestError(400, "This saved dialogue line is too long for a five-second close-up. Shorten the line and retry.", "DIALOGUE_TOO_LONG");
  }

  const globalStyle = closeupPromptPart(manifest.global_style, 1000);
  const sceneDirection = closeupPromptPart(scene.visual_prompt, 1800);
  const cameraDirection = closeupPromptPart(scene.camera_movement, 700);
  const characterProfile = closeupPromptPart(character.detailed_visual_profile, 1800);
  const sourceLabel = sourceFrameType === "character_reference" ? "character reference" : "scene storyboard";
  const prompt = [
    "Create one continuous five-second vertical 9:16 cinematic drama speaking close-up from the supplied first frame.",
    `Use the saved ${sourceLabel} as the exact first frame and preserve the subject's identity, face, hair, wardrobe, lighting, color grade, and setting wherever the source supports them.`,
    `Frame ${characterId} in a tight medium or head-and-shoulders shot with a frontal or near-frontal face, readable eyes, and an unobstructed mouth.`,
    "Use steady restrained head movement and minimal camera motion. Keep the performance intimate and controlled.",
    "Make this one continuous take with no cutaways, transitions, scene changes, extra people, subtitles, logos, or text overlays.",
    "The mouth movement is visual performance guidance only. Do not generate audio and do not embed a voice or soundtrack.",
    globalStyle ? `Global visual style: ${globalStyle}` : "",
    characterProfile ? `Saved character profile: ${characterProfile}` : "",
    sceneDirection ? `Saved scene direction: ${sceneDirection}` : "",
    cameraDirection ? `Saved camera context: ${cameraDirection}` : "",
    `Exact saved dialogue text for timing guidance only: "${lineText}"`,
  ].filter(Boolean).join("\n");
  if (prompt.length > MAX_PROMPT_LENGTH) {
    throw new RequestError(400, "The saved close-up direction is too long for this motion test. Shorten the screenplay direction and retry.", "PROMPT_TOO_LONG");
  }
  return prompt;
}

function readDialogueShotRecords(project: Record<string, unknown>): DialogueShotRecord[] {
  return Array.isArray(project.dialogue_shot_clips)
    ? project.dialogue_shot_clips.filter((value): value is DialogueShotRecord => isRecord(value))
    : [];
}

function findActiveDialogueCloseup(
  project: Record<string, unknown>,
  sceneNumber: number,
  lineId: string,
  characterId: string
): DialogueShotRecord | null {
  return readDialogueShotRecords(project).find((candidate) =>
    candidate.shot_role === "dialogue_closeup" &&
    (candidate.status === "QUEUED" || candidate.status === "PROCESSING") &&
    Number(candidate.scene_number) === sceneNumber &&
    candidate.line_id === lineId &&
    closeupCharacterId(candidate.character_id) === characterId
  ) || null;
}

function findSavedDialogueCloseup(
  project: Record<string, unknown>,
  predictionId: string
): DialogueShotRecord {
  const clip = readDialogueShotRecords(project).find((candidate) =>
    candidate.shot_role === "dialogue_closeup" &&
    candidate.prediction_id === predictionId
  );
  if (!clip) {
    throw new RequestError(403, "This dialogue close-up prediction is not attached to the selected private project.", "PREDICTION_FORBIDDEN");
  }
  if (clip.status === "READY" && !isHttpsUrl(clip.video_url)) {
    throw new RequestError(409, "This saved close-up is marked ready without a private video archive. Start a new close-up.", "CLOSEUP_RECORD_INVALID");
  }
  return clip;
}

function closeupStateRecord(
  tracked: DialogueShotRecord,
  update: Record<string, unknown>
): DialogueShotRecord {
  const next = { ...tracked, ...update };
  if (next.status !== "READY") delete next.video_url;
  return next;
}

async function persistDialogueShotClip(
  project: Record<string, unknown>,
  nextClip: DialogueShotRecord,
  failureMessage: string
): Promise<DialogueShotRecord> {
  const predictionId = closeupSafeIdentifier(nextClip.prediction_id) || "unknown";
  const projectId = safeText(project.id, 180);
  if (!projectId) {
    console.error("replicate-luma dialogue close-up persistence project ID missing", {
      prediction_id: predictionId,
    });
    throw new RequestError(502, failureMessage, "CLOSEUP_PERSISTENCE_FAILED", {
      prediction_id: predictionId,
      status: nextClip.status,
      remote_status: nextClip.remote_status,
    });
  }
  let latestProject: Record<string, unknown>;
  try {
    latestProject = await getOwnedProject(projectId);
  } catch (error) {
    console.error("replicate-luma dialogue close-up persistence read failed", {
      prediction_id: predictionId,
      reason: error instanceof Error ? error.name : "unknown_error",
    });
    throw new RequestError(502, failureMessage, "CLOSEUP_PERSISTENCE_FAILED", {
      prediction_id: predictionId,
      status: nextClip.status,
      remote_status: nextClip.remote_status,
    });
  }

  const existing = Array.isArray(latestProject.dialogue_shot_clips)
    ? latestProject.dialogue_shot_clips
    : [];
  const merged = [
    ...existing.filter((candidate) => !isRecord(candidate) || candidate.prediction_id !== predictionId),
    nextClip,
  ];
  try {
    await superdev.entities.DramaProject.update(projectId, {
      dialogue_shot_clips: merged,
    });
  } catch (error) {
    console.error("replicate-luma dialogue close-up persistence write failed", {
      prediction_id: predictionId,
      reason: error instanceof Error ? error.name : "unknown_error",
    });
    throw new RequestError(502, failureMessage, "CLOSEUP_PERSISTENCE_FAILED", {
      prediction_id: predictionId,
      status: nextClip.status,
      remote_status: nextClip.remote_status,
    });
  }
  return nextClip;
}

function dialogueCloseupResponse(
  operation: VideoOperation,
  clip: DialogueShotRecord,
  statusOverride?: string,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  const predictionId = closeupSafeIdentifier(clip.prediction_id) || "";
  const remoteStatus = typeof clip.remote_status === "string" ? clip.remote_status : undefined;
  return {
    ...extra,
    ok: true,
    operation,
    clip_kind: DIALOGUE_CLOSEUP_KIND,
    prediction_id: predictionId,
    status: statusOverride || clip.status,
    ...(remoteStatus ? { remote_status: remoteStatus } : {}),
    ...(clip.status === "READY" && isHttpsUrl(clip.video_url) ? { file_url: clip.video_url.trim() } : {}),
    dialogue_shot_clip: clip,
  };
}

function buildDialogueCloseupAttempt(params: {
  predictionId: string;
  sceneNumber: number;
  lineId: string;
  characterId: string;
  text: string;
  sourceFrameType: DialogueCloseupSourceFrameType;
  sourceFrameUrl: string;
  prompt: string;
  remoteStatus: DialogueCloseupRemoteStatus;
}): DialogueShotRecord {
  const now = new Date().toISOString();
  return {
    provider: "replicate-luma",
    prediction_id: params.predictionId,
    scene_number: params.sceneNumber,
    line_id: params.lineId,
    character_id: params.characterId,
    text: params.text,
    shot_role: DIALOGUE_CLOSEUP_KIND,
    source_frame_type: params.sourceFrameType,
    source_frame_url: params.sourceFrameUrl,
    prompt: params.prompt,
    duration_seconds: 5,
    status: params.remoteStatus === "starting" ? "QUEUED" : "PROCESSING",
    remote_status: params.remoteStatus,
    updated_at: now,
    created_at: now,
    error: null,
  };
}

async function startDialogueCloseup(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const project = await getOwnedProject(body.project_id);
  const sceneNumber = readSceneNumber(body.scene_number);
  const line = readCloseupDialogueLine(project, sceneNumber, body);
  const character = findCloseupCharacter(line.manifest, line.character_id);
  const sourceFrame = resolveCloseupSourceFrame(project, sceneNumber, line.character_id, body);
  const prompt = buildDialogueCloseupPrompt(
    line.manifest,
    line.scene,
    character,
    line.text,
    line.character_id,
    sourceFrame.source_frame_type
  );
  const duration = body.duration_seconds === undefined ? 5 : Number(body.duration_seconds);
  if (duration !== 5) {
    throw new RequestError(400, "This dialogue close-up is fixed at five seconds.", "DURATION_UNSUPPORTED");
  }

  const activeClip = findActiveDialogueCloseup(project, sceneNumber, line.line_id, line.character_id);
  if (activeClip) {
    throw new RequestError(409, "A dialogue close-up is already rendering for this scene and line. Check its saved prediction before starting another.", "DIALOGUE_CLOSEUP_ALREADY_ACTIVE");
  }

  const token = requireReplicateToken();
  let predictionResult: { response: Response; data: unknown };
  try {
    predictionResult = await replicateFetch(`/models/${LUMA_RAY_MODEL}/predictions`, token, {
      method: "POST",
      body: JSON.stringify({
        input: {
          prompt,
          start_image: sourceFrame.source_frame_url,
          duration: 5,
        },
      }),
    });
  } catch {
    throw new RequestError(502, "Replicate could not be reached for this dialogue close-up. The saved project is safe, so retry without starting another render automatically.", "REPLICATE_UNREACHABLE");
  }
  if (!predictionResult.response.ok || !isRecord(predictionResult.data)) {
    if (predictionResult.response.status === 401 || predictionResult.response.status === 403) {
      throw new RequestError(502, LUMA_RAY_ACCESS_MESSAGE.replace("this scene", "this dialogue close-up"), "LUMA_RAY_ACCESS");
    }
    if (predictionResult.response.status === 404) {
      throw new RequestError(502, LUMA_RAY_UNAVAILABLE_MESSAGE.replace("this scene", "this dialogue close-up"), "LUMA_RAY_UNAVAILABLE");
    }
    throw new RequestError(502, "Replicate could not start this dialogue close-up. The saved source frame was not changed, so retry safely.", "REPLICATE_START");
  }

  const predictionId = closeupSafeIdentifier(predictionResult.data.id);
  if (!predictionId) {
    throw new RequestError(502, "Replicate accepted no usable prediction ID. The close-up attempt was not saved.", "PREDICTION_INVALID");
  }
  const remoteStatus = normalizeDialogueCloseupRemoteStatus(predictionResult.data.status);
  const attempt = buildDialogueCloseupAttempt({
    predictionId,
    sceneNumber,
    lineId: line.line_id,
    characterId: line.character_id,
    text: line.text,
    sourceFrameType: sourceFrame.source_frame_type,
    sourceFrameUrl: sourceFrame.source_frame_url,
    prompt,
    remoteStatus,
  });
  const saved = await persistDialogueShotClip(
    project,
    attempt,
    `Luma accepted prediction ${predictionId}, but the private dialogue close-up attempt could not be saved. Keep this prediction ID and check its status after the project save is available. Do not start another paid render automatically.`
  );
  return dialogueCloseupResponse("start", saved);
}

async function fetchDialogueCloseupPrediction(
  token: string,
  predictionId: string
): Promise<Record<string, unknown>> {
  try {
    return await fetchPrediction(token, predictionId);
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError(502, "Replicate could not be reached while checking this dialogue close-up. The saved processing attempt is paused, so try the status check again.", "REPLICATE_UNREACHABLE");
  }
}

async function statusDialogueCloseup(
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const project = await getOwnedProject(body.project_id);
  const predictionId = closeupSafeIdentifier(body.prediction_id);
  if (!predictionId) {
    throw new RequestError(400, "A saved dialogue close-up prediction is required.", "PREDICTION_REQUIRED");
  }
  const tracked = findSavedDialogueCloseup(project, predictionId);
  if (tracked.status === "READY") return dialogueCloseupResponse("status", tracked);
  if (tracked.status === "FAILED" || tracked.status === "CANCELED") {
    return dialogueCloseupResponse("status", tracked);
  }
  if (tracked.status === "PROCESSING" && tracked.remote_status === "succeeded") {
    return dialogueCloseupResponse("status", tracked, "SUCCEEDED", { ready_to_archive: true });
  }
  if (tracked.status !== "QUEUED" && tracked.status !== "PROCESSING") {
    throw new RequestError(409, "This close-up attempt has an invalid saved state. Start a new dialogue close-up.", "CLOSEUP_RECORD_INVALID");
  }

  const token = requireReplicateToken();
  const prediction = await fetchDialogueCloseupPrediction(token, predictionId);
  const remoteStatus = normalizeDialogueCloseupRemoteStatus(prediction.status);
  if (remoteStatus === "starting" || remoteStatus === "processing") {
    const next = closeupStateRecord(tracked, {
      status: dialogueCloseupStatusForRemote(remoteStatus),
      remote_status: remoteStatus,
      updated_at: new Date().toISOString(),
      error: null,
    });
    const saved = await persistDialogueShotClip(
      project,
      next,
      `The dialogue close-up status changed, but its private attempt record could not be updated. Keep prediction ${predictionId} and retry the status check without starting another render.`
    );
    return dialogueCloseupResponse("status", saved);
  }

  if (remoteStatus === "failed" || remoteStatus === "canceled") {
    const next = closeupStateRecord(tracked, {
      status: remoteStatus === "failed" ? "FAILED" : "CANCELED",
      remote_status: remoteStatus,
      updated_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      error: dialogueCloseupError(remoteStatus, prediction.error),
    });
    const saved = await persistDialogueShotClip(
      project,
      next,
      `The dialogue close-up reached a terminal provider state, but its saved result could not be updated. Keep prediction ${predictionId} and retry the status check.`
    );
    return dialogueCloseupResponse("status", saved);
  }

  const next = closeupStateRecord(tracked, {
    status: "PROCESSING",
    remote_status: "succeeded",
    updated_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    error: null,
  });
  const saved = await persistDialogueShotClip(
    project,
    next,
    `Luma finished prediction ${predictionId}, but the close-up could not be marked ready for private archiving. Keep the prediction ID and retry status without starting another render.`
  );
  return dialogueCloseupResponse("status", saved, "SUCCEEDED", { ready_to_archive: true });
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

function normalizeCloseupArchiveContentType(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.split(";", 1)[0].trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "video/mp4" || normalized === "application/octet-stream") return normalized;
  if (/^video\/[a-z0-9.+-]{1,32}$/.test(normalized)) return normalized;
  return "other";
}

const CLOSEUP_ARCHIVE_FAILURE_MESSAGE =
  "Luma finished this dialogue close-up, but private MP4 archiving failed. This attempt is marked failed, and the saved source frame and dialogue line are safe. Start a new close-up when you are ready.";

type CloseupArchiveFailureCategory =
  | "output_missing"
  | "download_failed"
  | "video_type_unsupported"
  | "video_too_large"
  | "video_read_failed"
  | "video_invalid"
  | "archive_upload_failed"
  | "archive_url_invalid";

async function saveDialogueCloseupArchiveFailure(
  project: Record<string, unknown>,
  tracked: DialogueShotRecord,
  predictionId: string,
  category: CloseupArchiveFailureCategory,
  bytes: number | null,
  contentType: string | null
): Promise<Record<string, unknown>> {
  console.error("replicate-luma dialogue close-up archive failed", {
    prediction_id: predictionId,
    category,
    bytes,
    content_type: contentType,
  });
  const next = closeupStateRecord(tracked, {
    status: "FAILED",
    remote_status: "succeeded",
    updated_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    error: CLOSEUP_ARCHIVE_FAILURE_MESSAGE,
    ...(contentType && contentType !== "other" && contentType.includes("/") ? { content_type: contentType } : {}),
    ...(typeof bytes === "number" && Number.isSafeInteger(bytes) && bytes >= 0 ? { bytes } : {}),
  });
  return persistDialogueShotClip(
    project,
    next,
    `The provider finished prediction ${predictionId}, but the terminal archive failure could not be saved. Keep this prediction ID and retry the archive check without starting another paid render.`
  );
}

async function archiveDialogueCloseupPrediction(
  context: RequestContext,
  project: Record<string, unknown>,
  tracked: DialogueShotRecord,
  predictionId: string,
  prediction: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const outputUrl = extractVideoUrl(prediction.output);
  if (!outputUrl) {
    const saved = await saveDialogueCloseupArchiveFailure(project, tracked, predictionId, "output_missing", null, null);
    return dialogueCloseupResponse("archive", saved, "FAILED", { error: CLOSEUP_ARCHIVE_FAILURE_MESSAGE, code: "ARCHIVE_FAILED" });
  }

  let outputResponse: Response;
  try {
    outputResponse = await fetch(outputUrl, { redirect: "follow" });
  } catch {
    const saved = await saveDialogueCloseupArchiveFailure(project, tracked, predictionId, "download_failed", null, null);
    return dialogueCloseupResponse("archive", saved, "FAILED", { error: CLOSEUP_ARCHIVE_FAILURE_MESSAGE, code: "ARCHIVE_FAILED" });
  }

  const contentType = normalizeCloseupArchiveContentType(outputResponse.headers.get("content-type"));
  if (!outputResponse.ok) {
    const saved = await saveDialogueCloseupArchiveFailure(project, tracked, predictionId, "download_failed", null, contentType);
    return dialogueCloseupResponse("archive", saved, "FAILED", { error: CLOSEUP_ARCHIVE_FAILURE_MESSAGE, code: "ARCHIVE_FAILED" });
  }
  if (contentType !== "video/mp4" && contentType !== "application/octet-stream") {
    const saved = await saveDialogueCloseupArchiveFailure(project, tracked, predictionId, "video_type_unsupported", null, contentType);
    return dialogueCloseupResponse("archive", saved, "FAILED", { error: CLOSEUP_ARCHIVE_FAILURE_MESSAGE, code: "ARCHIVE_FAILED" });
  }

  let bytes: Uint8Array;
  try {
    bytes = await readLimitedBody(outputResponse);
  } catch (error) {
    const category: CloseupArchiveFailureCategory =
      error instanceof RequestError && error.code === "VIDEO_TOO_LARGE"
        ? "video_too_large"
        : "video_read_failed";
    const saved = await saveDialogueCloseupArchiveFailure(project, tracked, predictionId, category, null, contentType);
    return dialogueCloseupResponse("archive", saved, "FAILED", { error: CLOSEUP_ARCHIVE_FAILURE_MESSAGE, code: "ARCHIVE_FAILED" });
  }
  if (!bytes.byteLength || !hasMp4Container(bytes)) {
    const saved = await saveDialogueCloseupArchiveFailure(project, tracked, predictionId, "video_invalid", bytes.byteLength, contentType);
    return dialogueCloseupResponse("archive", saved, "FAILED", { error: CLOSEUP_ARCHIVE_FAILURE_MESSAGE, code: "ARCHIVE_FAILED" });
  }

  const sceneNumber = Number(tracked.scene_number);
  const lineId = closeupSafeLineId(tracked.line_id) || "line-1";
  const safeFileLineId = lineId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 180) || "line-1";
  const file = new File(
    [bytes],
    `frame-scene-${Number.isInteger(sceneNumber) ? sceneNumber : 0}-${safeFileLineId}-dialogue-closeup.mp4`,
    { type: "video/mp4" }
  );

  let uploadResult: unknown;
  try {
    uploadResult = await superdev.integrations.core.uploadFile(
      { file },
      { headers: context.integrationHeaders }
    );
  } catch {
    const saved = await saveDialogueCloseupArchiveFailure(project, tracked, predictionId, "archive_upload_failed", bytes.byteLength, contentType);
    return dialogueCloseupResponse("archive", saved, "FAILED", { error: CLOSEUP_ARCHIVE_FAILURE_MESSAGE, code: "ARCHIVE_FAILED" });
  }
  const managedUrlValue = isRecord(uploadResult) ? uploadResult.file_url : null;
  const managedUrl = typeof managedUrlValue === "string" ? managedUrlValue.trim() : "";
  if (!isHttpsUrl(managedUrl) || managedUrl === outputUrl.trim()) {
    const saved = await saveDialogueCloseupArchiveFailure(project, tracked, predictionId, "archive_url_invalid", bytes.byteLength, contentType);
    return dialogueCloseupResponse("archive", saved, "FAILED", { error: CLOSEUP_ARCHIVE_FAILURE_MESSAGE, code: "ARCHIVE_FAILED" });
  }

  const completedAt = typeof tracked.completed_at === "string" && tracked.completed_at.trim()
    ? tracked.completed_at
    : new Date().toISOString();
  const ready = closeupStateRecord(tracked, {
    status: "READY",
    remote_status: "succeeded",
    video_url: managedUrl,
    content_type: "video/mp4",
    bytes: bytes.byteLength,
    updated_at: new Date().toISOString(),
    completed_at: completedAt,
    error: null,
  });
  const saved = await persistDialogueShotClip(
    project,
    ready,
    `The private MP4 archive for prediction ${predictionId} was created, but its saved close-up record could not be updated. Keep this prediction ID and retry the archive check without starting another paid render.`
  );
  return dialogueCloseupResponse("archive", saved, "READY");
}

async function archiveDialogueCloseup(
  context: RequestContext,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const project = await getOwnedProject(body.project_id);
  const predictionId = closeupSafeIdentifier(body.prediction_id);
  if (!predictionId) {
    throw new RequestError(400, "A saved dialogue close-up prediction is required before archiving.", "PREDICTION_REQUIRED");
  }
  const tracked = findSavedDialogueCloseup(project, predictionId);
  if (tracked.status === "READY") return dialogueCloseupResponse("archive", tracked, "READY");
  if (tracked.status === "FAILED" || tracked.status === "CANCELED") {
    return dialogueCloseupResponse("archive", tracked);
  }
  if (tracked.status !== "QUEUED" && tracked.status !== "PROCESSING") {
    throw new RequestError(409, "This close-up attempt has an invalid saved state. Start a new dialogue close-up.", "CLOSEUP_RECORD_INVALID");
  }

  const token = requireReplicateToken();
  const prediction = await fetchDialogueCloseupPrediction(token, predictionId);
  const remoteStatus = normalizeDialogueCloseupRemoteStatus(prediction.status);
  if (remoteStatus === "starting" || remoteStatus === "processing") {
    const next = closeupStateRecord(tracked, {
      status: dialogueCloseupStatusForRemote(remoteStatus),
      remote_status: remoteStatus,
      updated_at: new Date().toISOString(),
      error: null,
    });
    const saved = await persistDialogueShotClip(
      project,
      next,
      `The dialogue close-up is still processing, but its private attempt record could not be updated. Keep prediction ${predictionId} and retry the archive check.`
    );
    return dialogueCloseupResponse("archive", saved);
  }
  if (remoteStatus === "failed" || remoteStatus === "canceled") {
    const next = closeupStateRecord(tracked, {
      status: remoteStatus === "failed" ? "FAILED" : "CANCELED",
      remote_status: remoteStatus,
      updated_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      error: dialogueCloseupError(remoteStatus, prediction.error),
    });
    const saved = await persistDialogueShotClip(
      project,
      next,
      `The dialogue close-up reached a terminal provider state, but its saved result could not be updated. Keep prediction ${predictionId} and retry the archive check.`
    );
    return dialogueCloseupResponse("archive", saved);
  }

  const prepared = closeupStateRecord(tracked, {
    status: "PROCESSING",
    remote_status: "succeeded",
    completed_at: typeof tracked.completed_at === "string" && tracked.completed_at.trim()
      ? tracked.completed_at
      : new Date().toISOString(),
    updated_at: new Date().toISOString(),
    error: null,
  });
  const savedPrepared = await persistDialogueShotClip(
    project,
    prepared,
    `Luma finished prediction ${predictionId}, but its close-up could not be saved for private archiving. Keep the prediction ID and retry the archive check without starting another render.`
  );
  return archiveDialogueCloseupPrediction(context, project, savedPrepared, predictionId, prediction);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: responseHeaders(request) });
  }
  if (request.method !== "POST") {
    return errorResponse(request, 405, "Use POST for the Luma motion service.", "METHOD_NOT_ALLOWED");
  }

  try {
    const context = await authenticate(request);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new RequestError(400, "The motion request body is invalid JSON.", "INVALID_BODY");
    }
    if (!isRecord(body)) throw new RequestError(400, "The motion request body is invalid.", "INVALID_BODY");

    const operation = body.operation as VideoOperation;
    const clipKind = body.clip_kind;
    if (clipKind !== undefined && clipKind !== DIALOGUE_CLOSEUP_KIND) {
      throw new RequestError(400, "Choose a supported motion clip kind.", "CLIP_KIND_UNSUPPORTED");
    }
    if (clipKind === DIALOGUE_CLOSEUP_KIND) {
      if (operation === "start") return jsonResponse(request, await startDialogueCloseup(body));
      if (operation === "status") return jsonResponse(request, await statusDialogueCloseup(body));
      if (operation === "archive") return jsonResponse(request, await archiveDialogueCloseup(context, body));
      throw new RequestError(400, "Choose a supported dialogue close-up operation.", "OPERATION_REQUIRED");
    }
    if (operation === "start") return jsonResponse(request, await startPrediction(request, context, body));
    if (operation === "status") return jsonResponse(request, await statusPrediction(request, body));
    if (operation === "archive") return jsonResponse(request, await archivePrediction(request, context, body));
    throw new RequestError(400, "Choose a supported motion operation.", "OPERATION_REQUIRED");
  } catch (error) {
    if (error instanceof RequestError) return errorResponse(request, error.status, error.message, error.code, error.extra);
    console.error("replicate-luma-video failed", error instanceof Error ? error.name : "unknown_error");
    return errorResponse(request, 500, "The motion test could not complete. Check the saved project and retry this scene.", "MOTION_SERVICE_FAILED");
  }
});
