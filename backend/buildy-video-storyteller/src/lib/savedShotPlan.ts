import type {
  SavedMultiLineShotPlan,
  SavedMultiLineShotPlanLine,
  SavedShotPlan,
  SavedShotPlanMasterShot,
  SavedShotPlanReviewedCloseupShot,
  SavedShotPlanShot,
  SavedShotPlanSnapshot,
} from "@/lib/dramaStudio";

/**
 * Saved shot plans are deliberately validated without looking at the current
 * screenplay or media arrays. A structurally valid plan can be stale, and
 * later slices decide that state without rewriting this approval snapshot.
 */
const MAX_SCENE_NUMBER = 99;
const MAX_IDENTIFIER_LENGTH = 180;
const MAX_TEXT_LENGTH = 20000;
const MAX_TIMESTAMP_LENGTH = 96;
const MAX_SIGNATURE_LENGTH = 512;
const MAX_SHOT_DURATION_SECONDS = 60;
const MAX_TOTAL_DURATION_SECONDS = MAX_SHOT_DURATION_SECONDS * 2;
const MAX_MULTI_LINE_COUNT = 3;
const MAX_MULTI_LINE_TOTAL_DURATION_SECONDS =
  MAX_SHOT_DURATION_SECONDS * 2 * MAX_MULTI_LINE_COUNT;
const DURATION_TOLERANCE_SECONDS = 0.001;

const SAFE_IDENTIFIER_PATTERN = new RegExp(
  `^[A-Za-z0-9][A-Za-z0-9_-]{0,${MAX_IDENTIFIER_LENGTH - 1}}$`
);
const SAFE_PREDICTION_ID_PATTERN = new RegExp(
  `^[A-Za-z0-9][A-Za-z0-9_:-]{0,${MAX_IDENTIFIER_LENGTH - 1}}$`
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPrintableNonEmptyString(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value.trim().length > 0 &&
    !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)
  );
}

function isSafeIdentifier(value: unknown): value is string {
  return typeof value === "string" && SAFE_IDENTIFIER_PATTERN.test(value);
}

function isSafePredictionId(value: unknown): value is string {
  return typeof value === "string" && SAFE_PREDICTION_ID_PATTERN.test(value);
}

function isSecureHttpsUrl(value: unknown): value is string {
  if (!isPrintableNonEmptyString(value, 4096)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

function isParseableTimestamp(value: unknown): value is string {
  return (
    isPrintableNonEmptyString(value, MAX_TIMESTAMP_LENGTH) &&
    Number.isFinite(Date.parse(value))
  );
}

function isPositiveBoundedDuration(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= MAX_SHOT_DURATION_SECONDS
  );
}

function isPositiveBoundedTotalDuration(value: unknown, max: number): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= max
  );
}

function isSceneNumber(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_SCENE_NUMBER
  );
}

function normalizeMasterShot(value: unknown): SavedShotPlanMasterShot | null {
  if (!isRecord(value) || value.role !== "master") return null;
  if (!isPositiveBoundedDuration(value.duration_seconds)) return null;
  if (!isSafePredictionId(value.clip_prediction_id)) return null;
  if (!isSecureHttpsUrl(value.video_url)) return null;
  if (!isParseableTimestamp(value.created_at) || !isParseableTimestamp(value.updated_at)) return null;

  return {
    role: "master",
    duration_seconds: value.duration_seconds,
    clip_prediction_id: value.clip_prediction_id,
    video_url: value.video_url,
    created_at: value.created_at,
    updated_at: value.updated_at,
  };
}

function normalizeReviewedCloseupShot(value: unknown): SavedShotPlanReviewedCloseupShot | null {
  if (!isRecord(value) || value.role !== "reviewed-closeup") return null;
  if (!isPositiveBoundedDuration(value.duration_seconds)) return null;
  if (!isSafePredictionId(value.closeup_prediction_id)) return null;
  if (!isSecureHttpsUrl(value.closeup_video_url)) return null;
  if (!isParseableTimestamp(value.closeup_created_at) || !isParseableTimestamp(value.closeup_updated_at)) return null;
  if (!isSafePredictionId(value.lipsync_prediction_id)) return null;
  if (!isSecureHttpsUrl(value.lipsync_video_url)) return null;
  if (!isParseableTimestamp(value.lipsync_created_at) || !isParseableTimestamp(value.lipsync_updated_at)) return null;
  if (!isSecureHttpsUrl(value.audio_url)) return null;
  if (!isParseableTimestamp(value.audio_created_at) || !isParseableTimestamp(value.audio_updated_at)) return null;

  return {
    role: "reviewed-closeup",
    duration_seconds: value.duration_seconds,
    closeup_prediction_id: value.closeup_prediction_id,
    closeup_video_url: value.closeup_video_url,
    closeup_created_at: value.closeup_created_at,
    closeup_updated_at: value.closeup_updated_at,
    lipsync_prediction_id: value.lipsync_prediction_id,
    lipsync_video_url: value.lipsync_video_url,
    lipsync_created_at: value.lipsync_created_at,
    lipsync_updated_at: value.lipsync_updated_at,
    audio_url: value.audio_url,
    audio_created_at: value.audio_created_at,
    audio_updated_at: value.audio_updated_at,
  };
}

function normalizeOrderedShots(value: unknown): SavedShotPlanShot[] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;

  const normalizedShots: SavedShotPlanShot[] = [];
  for (const shot of value) {
    if (!isRecord(shot)) return null;
    if (shot.role === "master") {
      const normalizedMaster = normalizeMasterShot(shot);
      if (!normalizedMaster) return null;
      normalizedShots.push(normalizedMaster);
      continue;
    }
    if (shot.role === "reviewed-closeup") {
      const normalizedCloseup = normalizeReviewedCloseupShot(shot);
      if (!normalizedCloseup) return null;
      normalizedShots.push(normalizedCloseup);
      continue;
    }
    return null;
  }

  const roleCount = normalizedShots.reduce(
    (counts, shot) => {
      counts[shot.role] += 1;
      return counts;
    },
    { master: 0, "reviewed-closeup": 0 }
  );
  if (roleCount.master !== 1 || roleCount["reviewed-closeup"] !== 1) return null;

  return normalizedShots;
}

function hasMatchingShotDurationTotal(
  shots: SavedShotPlanShot[],
  totalDurationSeconds: number
): boolean {
  const shotDurationTotal = shots.reduce(
    (sum, shot) => sum + shot.duration_seconds,
    0
  );
  return Math.abs(totalDurationSeconds - shotDurationTotal) <= DURATION_TOLERANCE_SECONDS;
}

/**
 * Parse the exact version-one saved-plan shape without repairing it.
 *
 * This function intentionally returns null for malformed input and never binds
 * the result to current project media. In particular, the submitted shot order
 * and all accepted URLs, text, IDs, and timestamps are returned unchanged.
 */
export function normalizeSavedShotPlan(raw: unknown): SavedShotPlan | null {
  try {
    if (!isRecord(raw)) return null;

    if (raw.version !== 1 || raw.mode !== "one_line_hard_cut" || raw.status !== "APPROVED") {
      return null;
    }
    if (!isSceneNumber(raw.scene_number)) return null;
    if (!isSafeIdentifier(raw.line_id)) return null;
    if (!isSafeIdentifier(raw.character_id)) return null;
    if (!isPrintableNonEmptyString(raw.text, MAX_TEXT_LENGTH)) return null;
    if (!Array.isArray(raw.shots) || raw.shots.length !== 2) return null;
    if (!isPositiveBoundedDuration(raw.total_duration_seconds) || raw.total_duration_seconds > MAX_TOTAL_DURATION_SECONDS) {
      return null;
    }
    if (!isParseableTimestamp(raw.approved_at) || !isParseableTimestamp(raw.updated_at)) return null;

    if (raw.source_signature !== undefined) {
      if (!isPrintableNonEmptyString(raw.source_signature, MAX_SIGNATURE_LENGTH)) return null;
    }

    const normalizedShots = normalizeOrderedShots(raw.shots);
    if (!normalizedShots) return null;
    if (!hasMatchingShotDurationTotal(normalizedShots, raw.total_duration_seconds)) return null;

    return {
      version: 1,
      mode: "one_line_hard_cut",
      status: "APPROVED",
      scene_number: raw.scene_number,
      line_id: raw.line_id,
      character_id: raw.character_id,
      text: raw.text,
      ...(raw.source_signature !== undefined ? { source_signature: raw.source_signature } : {}),
      shots: [normalizedShots[0], normalizedShots[1]],
      total_duration_seconds: raw.total_duration_seconds,
      approved_at: raw.approved_at,
      updated_at: raw.updated_at,
    } as SavedShotPlan;
  } catch {
    return null;
  }
}

/**
 * Parse the version-two multi-line shape without sorting, repairing, migrating,
 * or rebinding any submitted line or shot. Screenplay order is represented by
 * the submitted array order plus its contiguous canonical `order` values.
 */
export function normalizeSavedMultiLineShotPlan(raw: unknown): SavedMultiLineShotPlan | null {
  try {
    if (!isRecord(raw)) return null;
    if (raw.version !== 2 || raw.mode !== "multi_line_hard_cut" || raw.status !== "APPROVED") {
      return null;
    }
    if (!isSceneNumber(raw.scene_number)) return null;
    if (!isPrintableNonEmptyString(raw.source_signature, MAX_SIGNATURE_LENGTH)) return null;
    if (!Array.isArray(raw.lines) || raw.lines.length < 2 || raw.lines.length > MAX_MULTI_LINE_COUNT) {
      return null;
    }
    if (!isPositiveBoundedTotalDuration(raw.total_duration_seconds, MAX_MULTI_LINE_TOTAL_DURATION_SECONDS)) {
      return null;
    }
    if (!isParseableTimestamp(raw.approved_at) || !isParseableTimestamp(raw.updated_at)) return null;

    const lineIds = new Set<string>();
    const normalizedLines: SavedMultiLineShotPlanLine[] = [];
    let lineDurationTotal = 0;

    for (let index = 0; index < raw.lines.length; index += 1) {
      const value = raw.lines[index];
      if (!isRecord(value)) return null;
      if (!isSafeIdentifier(value.line_id) || lineIds.has(value.line_id)) return null;
      if (value.order !== index + 1) return null;
      if (!isSafeIdentifier(value.character_id)) return null;
      if (!isPrintableNonEmptyString(value.text, MAX_TEXT_LENGTH)) return null;
      if (!isPositiveBoundedTotalDuration(value.total_duration_seconds, MAX_TOTAL_DURATION_SECONDS)) {
        return null;
      }

      const normalizedShots = normalizeOrderedShots(value.shots);
      if (!normalizedShots) return null;
      if (!hasMatchingShotDurationTotal(normalizedShots, value.total_duration_seconds)) return null;

      lineIds.add(value.line_id);
      lineDurationTotal += value.total_duration_seconds;
      normalizedLines.push({
        line_id: value.line_id,
        character_id: value.character_id,
        text: value.text,
        order: value.order,
        shots: [normalizedShots[0], normalizedShots[1]],
        total_duration_seconds: value.total_duration_seconds,
      });
    }

    if (
      !Number.isFinite(lineDurationTotal) ||
      lineDurationTotal <= 0 ||
      lineDurationTotal > MAX_MULTI_LINE_TOTAL_DURATION_SECONDS ||
      Math.abs(raw.total_duration_seconds - lineDurationTotal) > DURATION_TOLERANCE_SECONDS
    ) {
      return null;
    }

    return {
      version: 2,
      mode: "multi_line_hard_cut",
      status: "APPROVED",
      scene_number: raw.scene_number,
      source_signature: raw.source_signature,
      lines: normalizedLines,
      total_duration_seconds: raw.total_duration_seconds,
      approved_at: raw.approved_at,
      updated_at: raw.updated_at,
    };
  } catch {
    return null;
  }
}

/**
 * Normalize either saved-plan version while keeping the version-one API above
 * available to existing callers. The dispatcher never repairs an old or
 * malformed value and never chooses current media for a stored snapshot.
 */
export function normalizeSavedShotPlanSnapshot(raw: unknown): SavedShotPlanSnapshot | null {
  try {
    if (!isRecord(raw)) return null;
    if (raw.version === 1 && raw.mode === "one_line_hard_cut") {
      return normalizeSavedShotPlan(raw);
    }
    if (raw.version === 2 && raw.mode === "multi_line_hard_cut") {
      return normalizeSavedMultiLineShotPlan(raw);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Validate a newly assembled version-one snapshot through the same strict
 * boundary used when loading it. The name makes the original save path
 * explicit without adding a weaker representation of that contract.
 */
export function buildSavedShotPlanSnapshot(raw: unknown): SavedShotPlan | null {
  return normalizeSavedShotPlan(raw);
}
