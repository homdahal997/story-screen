import { createSuperdevClient } from "npm:@superdevhq/client@0.1.56";

const ELEVENLABS_SOUND_URL = "https://api.elevenlabs.io/v1/sound-generation";
const MAX_BODY_BYTES = 80 * 1024;
const MAX_AUDIO_BYTES = 24 * 1024 * 1024;
const MAX_PROVIDER_PROMPT_LENGTH = 450;
// Keep this aligned with the creator-facing limit. The remaining characters hold the guidance below.
const MAX_AMBIENCE_USER_PROMPT_LENGTH = 330;
const MIN_DURATION_SECONDS = 3;
const MAX_DURATION_SECONDS = 20;
const DEFAULT_DURATION_SECONDS = 10;
const MAX_PROVIDER_ERROR_BYTES = 32 * 1024;
const MAX_PROVIDER_DETAIL_LENGTH = 480;
const MAX_PROVIDER_CODE_LENGTH = 120;
const MAX_PROVIDER_REQUEST_ID_LENGTH = 180;
const AMBIENCE_GUIDANCE_SEPARATOR = "\n\n";
const AMBIENCE_GUIDANCE =
  "Room tone and environmental ambience only. No speech, dialogue, vocals, voices, music, melody, lyrics, or singing.";

type SoundOperation = "generate_ambience";

type RequestContext = {
  authorization: string;
  integrationHeaders: Record<string, string>;
};

type ProviderDiagnostic = {
  status: string | null;
  code: string | null;
  detail: string | null;
  requestId: string | null;
};

type ProviderFailureKind = "invalid_request" | "access_rejected" | "rate_limited" | "provider_outage" | "unexpected_response";

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

function hasUnsupportedControlCharacter(value: string): boolean {
  return /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value);
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

function buildProviderPrompt(userPrompt: string): string {
  const guidanceBudget = MAX_PROVIDER_PROMPT_LENGTH - AMBIENCE_GUIDANCE_SEPARATOR.length - AMBIENCE_GUIDANCE.length;
  const safeUserPromptLength = Math.min(MAX_AMBIENCE_USER_PROMPT_LENGTH, guidanceBudget);
  const boundedUserPrompt = trimPromptAtWordBoundary(userPrompt, safeUserPromptLength);
  const finalPrompt = `${boundedUserPrompt}${AMBIENCE_GUIDANCE_SEPARATOR}${AMBIENCE_GUIDANCE}`;
  if (finalPrompt.length > MAX_PROVIDER_PROMPT_LENGTH) {
    throw new RequestError(
      500,
      "Ambience prompt safeguards could not be applied. Retry this scene.",
      "PROMPT_LIMIT_CONFIGURATION"
    );
  }
  return finalPrompt;
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
      "The ElevenLabs connection is not configured yet. Add the project connection, then retry ambience generation.",
      "ELEVENLABS_NOT_CONFIGURED"
    );
  }
  return key;
}

async function authenticate(request: Request): Promise<RequestContext> {
  const authorization = request.headers.get("Authorization")?.trim();
  if (!authorization || !/^Bearer\s+\S+/i.test(authorization)) {
    throw new RequestError(401, "Sign in to generate a private ambience bed.", "AUTH_REQUIRED");
  }

  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  superdev.auth.setToken(token);
  try {
    const user = await superdev.auth.me();
    if (!user || typeof user.email !== "string" || !user.email.trim()) throw new Error("missing user");
  } catch {
    throw new RequestError(401, "Your creator session expired. Sign in again before generating ambience.", "AUTH_REQUIRED");
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
  if (!projectId) throw new RequestError(400, "A saved project is required for ambience generation.", "PROJECT_REQUIRED");

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
    throw new RequestError(401, "Your creator session expired. Sign in again before generating ambience.", "AUTH_REQUIRED");
  }
  if (typeof user.email !== "string" || project.created_by !== user.email) {
    throw new RequestError(403, "This ambience bed belongs to another private project.", "PROJECT_FORBIDDEN");
  }
  return project;
}

function readSceneNumber(value: unknown): number {
  const sceneNumber = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(sceneNumber) || sceneNumber < 1 || sceneNumber > 99) {
    throw new RequestError(400, "Choose one valid saved scene for ambience generation.", "SCENE_REQUIRED");
  }
  return sceneNumber;
}

function readDuration(value: unknown): number {
  if (value === undefined || value === null || value === "") return DEFAULT_DURATION_SECONDS;
  const duration = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(duration) || duration < MIN_DURATION_SECONDS || duration > MAX_DURATION_SECONDS) {
    throw new RequestError(
      400,
      `Choose an ambience duration from ${MIN_DURATION_SECONDS} to ${MAX_DURATION_SECONDS} seconds.`,
      "DURATION_INVALID"
    );
  }
  return Math.round(duration * 10) / 10;
}

function readAmbiencePrompt(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || hasUnsupportedControlCharacter(value)) {
    throw new RequestError(
      400,
      `Write a room-tone prompt between 3 and ${MAX_AMBIENCE_USER_PROMPT_LENGTH} characters.`,
      "PROMPT_INVALID"
    );
  }

  const userPrompt = trimPromptAtWordBoundary(value, MAX_AMBIENCE_USER_PROMPT_LENGTH);
  if (userPrompt.length < 3 || userPrompt.length > MAX_AMBIENCE_USER_PROMPT_LENGTH) {
    throw new RequestError(
      400,
      `Write a room-tone prompt between 3 and ${MAX_AMBIENCE_USER_PROMPT_LENGTH} characters.`,
      "PROMPT_INVALID"
    );
  }
  return buildProviderPrompt(userPrompt);
}

function getApprovedScene(project: Record<string, unknown>, sceneNumber: number): Record<string, unknown> {
  const manifest = isRecord(project.manifest) ? project.manifest : null;
  const legacyApproval = project.production_approved === undefined || project.production_approved === null;
  const approved =
    project.status === "SCRIPTED" &&
    Boolean(manifest) &&
    (project.production_approved === true || legacyApproval);
  if (!approved || !manifest) {
    throw new RequestError(400, "Approve and save the screenplay before generating ambience.", "PRODUCTION_REQUIRED");
  }

  const scenes = Array.isArray(manifest.scenes) ? manifest.scenes : [];
  const scene = scenes.find((candidate) => isRecord(candidate) && Number(candidate.scene_number) === sceneNumber);
  if (!isRecord(scene)) {
    throw new RequestError(400, `Scene ${sceneNumber} is not in the current saved screenplay.`, "SCENE_NOT_FOUND");
  }
  return scene;
}

async function readAudioBody(response: Response): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_AUDIO_BYTES) {
    throw new RequestError(413, "This ambience bed is larger than the private sound archive limit. Choose a shorter duration and retry.", "AUDIO_TOO_LARGE");
  }
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_AUDIO_BYTES) {
      throw new RequestError(413, "This ambience bed is larger than the private sound archive limit. Choose a shorter duration and retry.", "AUDIO_TOO_LARGE");
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
        throw new RequestError(413, "This ambience bed is larger than the private sound archive limit. Choose a shorter duration and retry.", "AUDIO_TOO_LARGE");
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

function looksLikeMp3(bytes: Uint8Array): boolean {
  if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return true;
  const scanLimit = Math.min(bytes.length - 1, 256);
  for (let index = 0; index < scanLimit; index += 1) {
    if (bytes[index] === 0xff && (bytes[index + 1] & 0xe0) === 0xe0) return true;
  }
  return false;
}

function normalizeDiagnosticText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || null;
}

function redactDiagnosticText(value: unknown, redactions: unknown[], max: number): string | null {
  let text = normalizeDiagnosticText(value);
  if (!text) return null;

  for (const redaction of redactions) {
    const needle = normalizeDiagnosticText(redaction);
    if (!needle || needle.length < 3) continue;
    text = text.split(needle).join("[redacted]");
  }

  return text.slice(0, max) || null;
}

function providerToken(value: unknown, max: number): string | null {
  const text = normalizeDiagnosticText(value);
  if (!text) return null;
  const token = text.replace(/[^A-Za-z0-9._:/-]/g, "").slice(0, max);
  return token || null;
}

function firstProviderValue(
  sources: Array<Record<string, unknown> | null>,
  keys: string[]
): unknown {
  for (const source of sources) {
    if (!source) continue;
    for (const key of keys) {
      const value = source[key];
      if (value !== undefined && value !== null) return value;
    }
  }
  return null;
}

function firstStringValue(values: unknown[]): string | null {
  for (const value of values) {
    const text = normalizeDiagnosticText(value);
    if (text) return text;
  }
  return null;
}

function responseRequestId(headers: Headers): string | null {
  const headerNames = ["request-id", "x-request-id", "x-amzn-requestid", "trace-id", "cf-ray"];
  for (const headerName of headerNames) {
    const value = providerToken(headers.get(headerName), MAX_PROVIDER_REQUEST_ID_LENGTH);
    if (value) return value;
  }
  return null;
}

async function readProviderErrorBody(response: Response): Promise<string> {
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < MAX_PROVIDER_ERROR_BYTES) {
      const next = await reader.read();
      if (next.done) break;
      if (!next.value || !next.value.byteLength) continue;

      const remaining = MAX_PROVIDER_ERROR_BYTES - total;
      if (next.value.byteLength > remaining) {
        chunks.push(next.value.slice(0, remaining));
        total += remaining;
        try {
          await reader.cancel();
        } catch {
          // The provider body is already bounded. There is nothing else to consume.
        }
        break;
      }
      chunks.push(next.value);
      total += next.value.byteLength;
    }
  } catch {
    // Keep any bounded bytes collected before a provider stream interruption.
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function parseProviderDiagnostic(
  rawBody: string,
  response: Response,
  prompt: string,
  apiKey: string
): ProviderDiagnostic {
  let parsed: unknown = null;
  try {
    parsed = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    parsed = null;
  }

  const root = isRecord(parsed) ? parsed : {};
  const detailRecord = isRecord(root.detail) ? root.detail : null;
  const errorRecord = isRecord(root.error) ? root.error : null;
  const sources = [detailRecord, errorRecord, root];

  const detailValue = firstStringValue([
    firstProviderValue(sources, ["message", "detail", "error", "description"]),
    typeof root.detail === "string" ? root.detail : null,
    typeof root.error === "string" ? root.error : null,
    isRecord(parsed) ? null : rawBody,
  ]);
  const requestIdValue = firstProviderValue(sources, ["request_id", "requestId", "request_identifier", "trace_id", "traceId"]);

  return {
    status: providerToken(firstProviderValue(sources, ["status", "type"]), MAX_PROVIDER_CODE_LENGTH),
    code: providerToken(firstProviderValue(sources, ["code", "error_code", "errorCode"]), MAX_PROVIDER_CODE_LENGTH),
    detail: redactDiagnosticText(detailValue, [prompt, AMBIENCE_GUIDANCE, apiKey], MAX_PROVIDER_DETAIL_LENGTH),
    requestId: responseRequestId(response.headers) || providerToken(requestIdValue, MAX_PROVIDER_REQUEST_ID_LENGTH),
  };
}

function logProviderDiagnostic(response: Response, diagnostic: ProviderDiagnostic): void {
  console.error("elevenlabs-sound provider rejection", {
    status: response.status,
    status_text: normalizeDiagnosticText(response.statusText)?.slice(0, 120) || null,
    request_id: diagnostic.requestId,
    provider_status: diagnostic.status,
    provider_code: diagnostic.code,
    provider_detail: diagnostic.detail,
  });
}

function providerFailureKind(response: Response, diagnostic: ProviderDiagnostic): ProviderFailureKind {
  const signal = [diagnostic.status, diagnostic.code, diagnostic.detail]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();

  if (response.status === 401 || response.status === 403 || /unauthori|forbidden|invalid[_ -]?api[_ -]?key|permission|access denied|subscription/.test(signal)) {
    return "access_rejected";
  }
  if (response.status === 429 || /rate[ -]?limit|too many requests|throttl|quota|credit limit/.test(signal)) {
    return "rate_limited";
  }
  if (response.status >= 500 || /server|internal|unavailable|timeout|overload|temporar/.test(signal)) {
    return "provider_outage";
  }
  if (response.status === 400 || response.status === 422 || /invalid|validation|prompt|duration|parameter|request/.test(signal)) {
    return "invalid_request";
  }
  return "unexpected_response";
}

async function providerError(response: Response, prompt: string, apiKey: string): Promise<RequestError> {
  const rawBody = await readProviderErrorBody(response);
  const diagnostic = parseProviderDiagnostic(rawBody, response, prompt, apiKey);
  logProviderDiagnostic(response, diagnostic);

  switch (providerFailureKind(response, diagnostic)) {
    case "invalid_request":
      return new RequestError(
        400,
        "ElevenLabs rejected this ambience request. Check the prompt and duration, then retry this scene.",
        "SOUND_REQUEST_INVALID"
      );
    case "access_rejected":
      return new RequestError(
        502,
        "The connected ElevenLabs key cannot use Sound Generation, or the connection was rejected. Check the project connection and Sound Generation access, then retry ambience generation.",
        "ELEVENLABS_AUTH"
      );
    case "rate_limited":
      return new RequestError(
        429,
        "ElevenLabs is rate limiting sound generation or the current sound quota is reached. Wait a moment or check the ElevenLabs plan, then retry this scene.",
        "ELEVENLABS_RATE_LIMIT"
      );
    case "provider_outage":
      return new RequestError(
        502,
        "ElevenLabs is temporarily unavailable for sound generation. The saved project is safe, so retry this scene shortly.",
        "ELEVENLABS_OUTAGE"
      );
    default:
      return new RequestError(
        502,
        "ElevenLabs returned an unexpected sound-generation response. The saved project is safe, so retry this scene; if it continues, check the backend diagnostic log.",
        "SOUND_GENERATION_FAILED"
      );
  }
}

async function generateAmbience(
  context: RequestContext,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const project = await getOwnedProject(body.project_id);
  const sceneNumber = readSceneNumber(body.scene_number);
  getApprovedScene(project, sceneNumber);
  const durationSeconds = readDuration(body.duration_seconds);
  const prompt = readAmbiencePrompt(body.prompt);
  const apiKey = requireApiKey();

  let response: Response;
  try {
    response = await fetch(ELEVENLABS_SOUND_URL, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: prompt,
        duration_seconds: durationSeconds,
        prompt_influence: 0.3,
      }),
    });
  } catch {
    throw new RequestError(502, "ElevenLabs could not be reached for this ambience bed. The saved project is safe, so retry.", "ELEVENLABS_UNREACHABLE");
  }

  if (!response.ok) throw await providerError(response, prompt, apiKey);
  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() || "";
  if (!["audio/mpeg", "audio/mp3", "audio/x-mpeg", "application/octet-stream"].includes(contentType)) {
    throw new RequestError(415, "ElevenLabs returned a file that is not a supported MP3 ambience bed. Retry this scene.", "AUDIO_TYPE_UNSUPPORTED");
  }
  const bytes = await readAudioBody(response);
  if (!bytes.byteLength) throw new RequestError(502, "ElevenLabs returned an empty ambience bed. Retry this scene.", "AUDIO_EMPTY");
  if (!looksLikeMp3(bytes)) {
    throw new RequestError(415, "ElevenLabs returned audio that could not be verified as MP3. Retry this scene.", "AUDIO_INVALID");
  }

  let uploadResult: unknown;
  try {
    const file = new File([bytes], `frame-scene-${sceneNumber}-ambience.mp3`, { type: "audio/mpeg" });
    uploadResult = await superdev.integrations.core.uploadFile(
      { file },
      { headers: context.integrationHeaders }
    );
  } catch {
    throw new RequestError(502, "The ambience rendered, but private archiving failed. No new audio was saved, so retry this scene.", "ARCHIVE_FAILED");
  }

  const audioUrl = isRecord(uploadResult) ? uploadResult.file_url : null;
  if (!isHttpsUrl(audioUrl)) {
    throw new RequestError(502, "The ambience rendered, but private archiving returned no managed audio URL. Retry this scene.", "ARCHIVE_FAILED");
  }

  return {
    ok: true,
    operation: "generate_ambience",
    scene_number: sceneNumber,
    prompt,
    audio_url: audioUrl,
    content_type: "audio/mpeg",
    duration_seconds: durationSeconds,
    bytes: bytes.byteLength,
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: responseHeaders(request) });
  }
  if (request.method !== "POST") {
    return errorResponse(request, 405, "Use POST for the ElevenLabs ambience service.", "METHOD_NOT_ALLOWED");
  }

  try {
    const context = await authenticate(request);
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > MAX_BODY_BYTES) {
      throw new RequestError(413, "That ambience request is too large. Shorten the prompt and retry.", "BODY_TOO_LARGE");
    }
    let body: unknown;
    try {
      const raw = await request.text();
      if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
        throw new RequestError(413, "That ambience request is too large. Shorten the prompt and retry.", "BODY_TOO_LARGE");
      }
      body = JSON.parse(raw);
    } catch (error) {
      if (error instanceof RequestError) throw error;
      throw new RequestError(400, "The ambience request body is invalid JSON.", "INVALID_BODY");
    }
    if (!isRecord(body)) throw new RequestError(400, "The ambience request body is invalid.", "INVALID_BODY");

    const operation = body.operation as SoundOperation;
    if (operation !== "generate_ambience") {
      throw new RequestError(400, "Choose the supported ambience generation operation.", "OPERATION_REQUIRED");
    }
    return jsonResponse(request, await generateAmbience(context, body));
  } catch (error) {
    if (error instanceof RequestError) return errorResponse(request, error.status, error.message, error.code);
    console.error("elevenlabs-sound failed", error instanceof Error ? error.message : "unknown error");
    return errorResponse(request, 500, "Ambience generation could not complete. The saved project is safe, so retry this scene.", "SOUND_SERVICE_FAILED");
  }
});
