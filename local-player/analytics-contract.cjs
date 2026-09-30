const crypto = require("node:crypto");

const EVENT_NAMES = new Set([
  "app_opened",
  "first_run",
  "heartbeat",
  "portal_load_success",
  "portal_load_failed",
  "playback_started",
  "playback_failed",
  "vlc_fallback",
  "update_available",
  "update_downloaded",
  "update_installed",
  "crash_reported",
  "feature_used",
]);

const PLATFORMS = new Set(["win32", "darwin", "linux"]);
const PLAYERS = new Set(["internal", "vlc", "auto"]);
const SCREENS = new Set(["setup", "live", "vod", "series", "update", "app"]);
const MAX_BODY_BYTES = 16 * 1024;
const MAX_QUEUE_EVENTS = 250;

class AnalyticsValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "AnalyticsValidationError";
    this.status = 400;
  }
}

function cleanText(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

function safeEnum(value, allowed, max = 48) {
  const candidate = cleanText(value, max).toLowerCase();
  return allowed.has(candidate) ? candidate : "";
}

function safeCode(value, max = 48) {
  return cleanText(value, max).toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, max);
}

function sanitizeAnalyticsMeta(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output = {};
  const player = safeEnum(value.player, PLAYERS);
  const screen = safeEnum(value.screen, SCREENS);
  const errorType = safeCode(value.errorType);
  const reason = safeCode(value.reason);
  if (player) output.player = player;
  if (screen) output.screen = screen;
  if (errorType) output.errorType = errorType;
  if (reason) output.reason = reason;

  if (Number.isFinite(Number(value.durationSec))) {
    output.durationSec = Math.max(0, Math.min(86_400, Math.round(Number(value.durationSec))));
  }
  if (typeof value.success === "boolean") output.success = value.success;

  for (const key of ["fromVersion", "toVersion"]) {
    const candidate = cleanText(value[key], 20);
    if (/^\d+\.\d+\.\d+$/.test(candidate)) output[key] = candidate;
  }

  if (Number.isInteger(Number(value.statusCode)) && Number(value.statusCode) >= 100 && Number(value.statusCode) <= 599) {
    output.statusCode = Number(value.statusCode);
  }
  return output;
}

function normalizeAnalyticsPayload(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AnalyticsValidationError("Analytics payload must be an object.");
  }

  const installationId = cleanText(input.installationId, 128);
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(installationId)) {
    throw new AnalyticsValidationError("Analytics installation ID is invalid.");
  }

  const name = cleanText(input.name, 48);
  if (!EVENT_NAMES.has(name)) throw new AnalyticsValidationError("Analytics event is not allowed.");

  const version = cleanText(input.version, 20);
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new AnalyticsValidationError("Analytics version is invalid.");

  const platform = cleanText(input.platform, 12).toLowerCase();
  if (!PLATFORMS.has(platform)) throw new AnalyticsValidationError("Analytics platform is invalid.");

  return {
    installationId,
    name,
    version,
    platform,
    meta: sanitizeAnalyticsMeta(input.meta),
  };
}

function hashInstallationId(installationId, secret) {
  return crypto
    .createHmac("sha256", String(secret || "stb-play-analytics"))
    .update(String(installationId))
    .digest("hex");
}

function isRetryableAnalyticsStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

module.exports = {
  AnalyticsValidationError,
  EVENT_NAMES,
  MAX_BODY_BYTES,
  MAX_QUEUE_EVENTS,
  hashInstallationId,
  isRetryableAnalyticsStatus,
  normalizeAnalyticsPayload,
  sanitizeAnalyticsMeta,
};
