/*
=========================================================
 STB PLAY IPTV Player
 VERSION: 1.8.16 strict search, restored live parental locking, subtitles, recovery and analytics
 File: server.cjs
=========================================================
*/

const http = require("node:http");
const dns = require("node:dns");
const fs = require("node:fs");
const path = require("node:path");
const { randomBytes, scryptSync, timingSafeEqual } = require("node:crypto");
const { Readable } = require("node:stream");
const { spawn, spawnSync } = require("node:child_process");
const {
  MAX_QUEUE_EVENTS,
  isRetryableAnalyticsStatus,
  normalizeAnalyticsPayload,
} = require("./analytics-contract.cjs");
const {
  DEFAULT_RELEASE_REPOSITORY,
  normalizeUpdateManifest,
} = require("./update-policy.cjs");

/* IPTV/CDN hosts used by the provider can publish broken IPv6 routes. */
try { dns.setDefaultResultOrder("ipv4first"); } catch {}

const HOST = "127.0.0.1";
const requestedPort = Number(process.env.NETPLUS_PORT || 3847);
const PORT = Number.isInteger(requestedPort) && requestedPort > 0 && requestedPort < 65_536
  ? requestedPort
  : 3847;
const ROOT = __dirname;
const CONFIG_PATH = process.env.NETPLUS_CONFIG_PATH || path.join(ROOT, "config.json");
const APP_VERSION = "1.8.16";
const UPDATE_REPOSITORY = String(process.env.STB_PLAY_RELEASE_REPOSITORY || DEFAULT_RELEASE_REPOSITORY).trim();
const UPDATE_MANIFEST_URL = String(
  process.env.STB_PLAY_UPDATE_MANIFEST_URL ||
    `https://raw.githubusercontent.com/${UPDATE_REPOSITORY}/main/update.json`
).trim();
const DIAGNOSTIC_PATH = path.join(
  path.dirname(CONFIG_PATH),
  "netplus-diagnostics-v1.8.16.json"
);
const MAX_DIAGNOSTIC_EVENTS = 450;
const DEFAULT_ANALYTICS_ENDPOINT = "https://us-central1-stb-play-analytics.cloudfunctions.net/analyticsEvents";
const SUBTITLE_API_URL = String(process.env.STB_PLAY_SUBTITLE_API_URL || "").trim();
const SUBTITLE_API_KEY = String(process.env.STB_PLAY_SUBTITLE_API_KEY || "").trim();
const ANALYTICS_ENDPOINT = String(
  process.env.STB_PLAY_ANALYTICS_ENDPOINT ?? DEFAULT_ANALYTICS_ENDPOINT
).trim();
const ANALYTICS_QUEUE_PATH = path.join(
  path.dirname(CONFIG_PATH),
  "stb-play-analytics-outbox.json"
);

/* Providers are entered by the user. No provider portal is bundled into the app. */
const SERVICES = {};

const MAG_USER_AGENT =
  "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG250 stbapp ver: 4 rev: 1812 Mobile Safari/533.3";
const X_USER_AGENT = "Model: MAG250; Link: WiFi";
/* STBEmu's native media path identifies itself differently from the portal UI. */
const MEDIA_USER_AGENT = "Lavf53.32.100";

let catalogCache = null;
let catalogPromise = null;
let vodCategoriesCache = null;
const extraLiveCategoryChannels = new Map();

const vodCache = new Map();
/*
  The provider rate-limits VOD list calls. The previous build started several workers
  and also started a full All-category index, which produced a burst of 429s.
  Every VOD list/search request now passes through one shared priority queue.
  The visible category/search request wins over optional background work.
*/
const VOD_REQUEST_GAP_MS = 450;
const VOD_429_COOLDOWN_MS = 8_000;
const vodRequestQueue = {
  pending: [],
  running: false,
  sequence: 0,
  lastStartedAt: 0,
  cooldownUntil: 0,
};

function waitMs(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, milliseconds)));
}

function isVodRateLimitError(error) {
  return Number(error?.status) === 429 || /\b429\b/.test(String(error?.message || ""));
}

function rejectQueuedVodBackgroundRequests(error) {
  const keep = [];
  for (const job of vodRequestQueue.pending) {
    if (job.background) job.reject(error);
    else keep.push(job);
  }
  vodRequestQueue.pending = keep;
}

function pumpVodRequestQueue() {
  if (vodRequestQueue.running) return;
  vodRequestQueue.running = true;

  (async () => {
    while (vodRequestQueue.pending.length) {
      vodRequestQueue.pending.sort((a, b) => b.priority - a.priority || a.sequence - b.sequence);
      const job = vodRequestQueue.pending.shift();
      const now = Date.now();
      const gapWait = vodRequestQueue.lastStartedAt
        ? VOD_REQUEST_GAP_MS - (now - vodRequestQueue.lastStartedAt)
        : 0;
      const cooldownWait = vodRequestQueue.cooldownUntil - now;
      await waitMs(Math.max(gapWait, cooldownWait));
      vodRequestQueue.lastStartedAt = Date.now();

      try {
        job.resolve(await job.task());
      } catch (error) {
        if (isVodRateLimitError(error)) {
          vodRequestQueue.cooldownUntil = Math.max(
            vodRequestQueue.cooldownUntil,
            Date.now() + Math.max(
              VOD_429_COOLDOWN_MS,
              Number(error?.retryAfterMs) || 0
            )
          );
          /* A 429 means the portal wants fewer requests. Do not continue
             feeding it optional shelves/index pages during the cooldown. */
          rejectQueuedVodBackgroundRequests(error);
        }
        job.reject(error);
      }
    }
  })().finally(() => {
    vodRequestQueue.running = false;
    if (vodRequestQueue.pending.length) pumpVodRequestQueue();
  });
}

function queueVodRequest(task, { priority = 0, background = false } = {}) {
  return new Promise((resolve, reject) => {
    vodRequestQueue.pending.push({
      task,
      priority: Number(priority) || 0,
      background: Boolean(background),
      sequence: vodRequestQueue.sequence++,
      resolve,
      reject,
    });
    pumpVodRequestQueue();
  });
}

function resetVodRequestQueue() {
  const error = new PlayerError("VOD request cancelled by content refresh.", 409);
  for (const job of vodRequestQueue.pending) job.reject(error);
  vodRequestQueue.pending = [];
  vodRequestQueue.cooldownUntil = 0;
}

/* Warm a small first-page shelf set only. The remaining categories are
   fetched on demand, which keeps startup fast without triggering provider
   rate limits. */
const vodShelfState = {
  items: new Map(),
  categories: [],
  promise: null,
  loading: false,
  lastStartedAt: 0,
  errors: [],
};
const vodSearchState = {
  items: new Map(),
  nextPage: 0,
  total: 0,
  complete: false,
  building: false,
  promise: null,
  error: "",
};
const vodInfoCache = new Map();
const seriesCache = new Map();
const qualityOptionCache = new Map();
const relayTargets = new Map();
const relayTicketsByKey = new Map();

function invalidateContentCaches() {
  catalogCache = null;
  catalogPromise = null;
  extraLiveCategoryChannels.clear();
  vodCategoriesCache = null;
  vodCache.clear();
  resetVodRequestQueue();
  vodShelfState.items.clear();
  vodShelfState.categories = [];
  vodShelfState.promise = null;
  vodShelfState.loading = false;
  vodShelfState.lastStartedAt = 0;
  vodShelfState.errors = [];
  vodSearchState.items.clear();
  vodSearchState.nextPage = 0;
  vodSearchState.total = 0;
  vodSearchState.complete = false;
  vodSearchState.building = false;
  vodSearchState.promise = null;
  vodSearchState.error = "";
  vodInfoCache.clear();
  seriesCache.clear();
  qualityOptionCache.clear();
}

/* Keep the live parental-lock behavior from v1.8.12.  The provider's live
   genre remains the source of truth; v1.8.13's synthetic adult category made
   provider category IDs unusable. */
const ADULT_TERMS = /(adult|xxx|18\s*(?:\+|plus)|porn|erotic|sex)/i;
const ADULT_RATING = /(18\s*(?:\+|plus)|\bA\b|NC[- ]?17|XXX|\bX{1,3}\b)/i;
/* Recovery codes are generated per installation and only their hashes are
   written to the local config file. No shared support/master PIN is bundled. */

/* =====================================================
   SAFE DIAGNOSTICS

   This build records request/response SHAPES and timing only. It never
   writes the user's MAC, PIN, portal token, cookies, or full stream URLs.
===================================================== */

let diagnosticReport = {
  version: APP_VERSION,
  enabled: false,
  startedAt: new Date().toISOString(),
  events: [],
};

function redactUrl(value) {
  const raw = String(value || "")
    .trim()
    .replace(/\b[0-9A-F]{2}(?::[0-9A-F]{2}){5}\b/gi, "[redacted-mac]")
    .replace(
      /\b(token|authorization|cookie|password|pin|session)=([^\s;&,]+)/gi,
      (_match, key) => `${key}=[redacted]`
    )
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [redacted]");
  const urlMatch = raw.match(/(?:https?|rtsp|udp):\/\/[^\s"']+/i);

  if (!urlMatch) {
    return raw.length > 160 ? `${raw.slice(0, 160)}…` : raw;
  }

  try {
    const url = new URL(urlMatch[0]);
    const safeUrl = `${url.protocol}//[provider-host]/[redacted]`;
    return raw.replace(urlMatch[0], safeUrl);
  } catch {
    return "[stream URL redacted]";
  }
}

function safeDiagnosticValue(value, depth = 0) {
  if (depth > 5) return "[max depth]";

  if (value == null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return redactUrl(value);
  }

  if (Array.isArray(value)) {
    return {
      _type: "array",
      count: value.length,
      sample: value.slice(0, 3).map((entry) => safeDiagnosticValue(entry, depth + 1)),
    };
  }

  if (typeof value === "object") {
    const output = {};
    const entries = Object.entries(value).slice(0, 30);

    for (const [key, entry] of entries) {
      if (/(?:^|_)(?:mac|token|authorization|cookie|password|pin|session|bearer|channel|title|name|episode|show)(?:$|_)/i.test(key)) {
        output[key] = "[redacted]";
      } else {
        output[key] = safeDiagnosticValue(entry, depth + 1);
      }
    }

    if (Object.keys(value).length > entries.length) {
      output._moreKeys = Object.keys(value).length - entries.length;
    }

    return output;
  }

  return String(value);
}

function persistDiagnostics() {
  try {
    fs.mkdirSync(path.dirname(DIAGNOSTIC_PATH), { recursive: true });
    fs.writeFileSync(
      DIAGNOSTIC_PATH,
      `${JSON.stringify(diagnosticReport, null, 2)}\n`,
      "utf8"
    );
  } catch {
    /* Diagnostics must never stop the player. */
  }
}

function recordDiagnostic(event, details = {}) {
  if (!diagnosticReport.enabled) return;
  diagnosticReport.events.push({
    at: new Date().toISOString(),
    event,
    details: safeDiagnosticValue(details),
  });

  if (diagnosticReport.events.length > MAX_DIAGNOSTIC_EVENTS) {
    diagnosticReport.events.splice(0, diagnosticReport.events.length - MAX_DIAGNOSTIC_EVENTS);
  }

  persistDiagnostics();
}

/* =====================================================
   ANONYMOUS ANALYTICS OUTBOX

   The renderer sends only a random installation ID and an allow-listed event
   shape to this local endpoint. The outbox keeps a small retryable queue so a
   temporary analytics outage does not lose the next launch/playback event.
===================================================== */

let analyticsQueue = null;
let analyticsFlushPromise = null;

function loadAnalyticsQueue() {
  if (Array.isArray(analyticsQueue)) return analyticsQueue;
  try {
    const parsed = JSON.parse(fs.readFileSync(ANALYTICS_QUEUE_PATH, "utf8"));
    analyticsQueue = Array.isArray(parsed) ? parsed.slice(-MAX_QUEUE_EVENTS) : [];
  } catch {
    analyticsQueue = [];
  }
  return analyticsQueue;
}

function persistAnalyticsQueue() {
  try {
    fs.mkdirSync(path.dirname(ANALYTICS_QUEUE_PATH), { recursive: true });
    fs.writeFileSync(
      ANALYTICS_QUEUE_PATH,
      `${JSON.stringify(loadAnalyticsQueue())}\n`,
      "utf8"
    );
  } catch {
    /* Analytics must never stop the player. */
  }
}

async function postAnalyticsPayload(payload) {
  if (!ANALYTICS_ENDPOINT) return { ok: true, disabled: true };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(ANALYTICS_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (response.ok) return { ok: true };
    return {
      ok: false,
      status: response.status,
      retryable: isRetryableAnalyticsStatus(response.status),
    };
  } catch {
    return { ok: false, retryable: true };
  } finally {
    clearTimeout(timeout);
  }
}

async function flushAnalyticsQueue() {
  if (analyticsFlushPromise || !ANALYTICS_ENDPOINT) return;
  analyticsFlushPromise = (async () => {
    const queue = loadAnalyticsQueue();
    while (queue.length) {
      const result = await postAnalyticsPayload(queue[0]);
      if (result.ok || !result.retryable) {
        queue.shift();
        persistAnalyticsQueue();
        continue;
      }
      break;
    }
  })().finally(() => {
    analyticsFlushPromise = null;
  });
  await analyticsFlushPromise;
}

function queueAnalyticsPayload(body) {
  const payload = normalizeAnalyticsPayload(body);
  if (!ANALYTICS_ENDPOINT) return { queued: false, disabled: true };
  const queue = loadAnalyticsQueue();
  queue.push(payload);
  if (queue.length > MAX_QUEUE_EVENTS) queue.splice(0, queue.length - MAX_QUEUE_EVENTS);
  persistAnalyticsQueue();
  void flushAnalyticsQueue();
  return { queued: true, pending: queue.length };
}

function clearAnalyticsQueue() {
  analyticsQueue = [];
  persistAnalyticsQueue();
  return { cleared: true };
}

function resetDiagnostics() {
  diagnosticReport = {
    version: APP_VERSION,
    enabled: true,
    startedAt: new Date().toISOString(),
    events: [],
  };
  recordDiagnostic("diagnostic.reset", { note: "Fresh test started from Settings." });
}

function shouldDiagnosePortalRequest(params) {
  return (
    params?.type === "vod" ||
    params?.type === "series" ||
    (params?.type === "itv" && [
      "create_link",
      "get_genres",
      "get_all_channels",
      "get_ordered_list",
    ].includes(params?.action))
  );
}

class PlayerError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

function normalizePortalUrl(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new PlayerError("Enter a valid portal URL.", 400);
  }

  if (!/^https?:$/.test(url.protocol)) {
    throw new PlayerError("Portal URL must start with http:// or https://.", 400);
  }

  const cleanPath = url.pathname.replace(/\/+$/, "");

  if (/\/(?:server\/load\.php|portal\.php)$/i.test(cleanPath)) {
    url.pathname = cleanPath;
  } else if (/\/stalker_portal\/c$/i.test(cleanPath)) {
    url.pathname = cleanPath.replace(/\/c$/i, "/server/load.php");
  } else if (/\/stalker_portal$/i.test(cleanPath)) {
    url.pathname = `${cleanPath}/server/load.php`;
  } else if (!cleanPath) {
    url.pathname = "/stalker_portal/server/load.php";
  } else {
    url.pathname = `${cleanPath}/stalker_portal/server/load.php`;
  }

  url.search = "";
  url.hash = "";
  return url.toString();
}

function readStoredConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

function readConfig() {
  const portalFromEnv = process.env.STALKER_PORTAL_URL?.trim();
  const macFromEnv = process.env.STALKER_MAC?.trim();
  const stored = readStoredConfig();

  /* v1.6.6 portal profiles. Migrate the old single-service config in memory
     so existing users do not lose their portal when the settings model changes. */
  const profile = Array.isArray(stored.portals)
    ? (stored.portals.find((portal) => portal.id === stored.activePortalId) || stored.portals[0])
    : null;

  const service = SERVICES[stored.serviceId];
  const portalUrl = portalFromEnv || profile?.portalUrl || service?.portalUrl || stored.portalUrl;
  const mac = (macFromEnv || profile?.mac || stored.mac || "").trim().toUpperCase();

  if (!portalUrl || !mac) return null;

  if (!/^[0-9A-F]{2}(?::[0-9A-F]{2}){5}$/.test(mac)) {
    throw new PlayerError("Saved MAC address is invalid.", 400);
  }

  return {
    endpoint: normalizePortalUrl(portalUrl),
    portalUrl,
    serviceId: stored.serviceId || null,
    portalId: profile?.id || null,
    nickname: profile?.nickname || service?.name || "Portal",
    mac,
    baseCookie: `mac=${encodeURIComponent(mac)}; stb_lang=en; timezone=America%2FToronto`,
  };
}

function pinHash(pin) {
  return scryptSync(pin, "netplus-parental-v1", 32).toString("hex");
}

function recoveryCodeHash(code) {
  return scryptSync(String(code || "").trim(), "netplus-recovery-v1", 32).toString("hex");
}

function createRecoveryCode() {
  return String(randomBytes(4).readUInt32BE(0) % 100000000).padStart(8, "0");
}

function matchesHash(value, savedHash, hashFunction) {
  const actual = Buffer.from(String(savedHash || ""), "hex");
  const expected = Buffer.from(hashFunction(String(value || "").trim()), "hex");
  return actual.length > 0 && actual.length === expected.length && timingSafeEqual(actual, expected);
}

function isAdult(title) {
  return ADULT_TERMS.test(String(title || ""));
}

function isAdultRating(rating) {
  return ADULT_RATING.test(String(rating || "").trim());
}

function providerFlag(value) {
  if (value === true || value === 1) return true;
  const normalized = String(value ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

function saveConfig(serviceId, macInput, parentalPin) {
  if (!String(serviceId || "").trim()) throw new PlayerError("Add an authorised portal before connecting.", 400);

  const mac = String(macInput || "").trim().toUpperCase();

  if (!/^[0-9A-F]{2}(?::[0-9A-F]{2}){5}$/.test(mac)) {
    throw new PlayerError("Enter all 12 MAC digits.", 400);
  }

  const existing = readStoredConfig();
  const pin = String(parentalPin || "").trim();

  let recoveryCode = "";
  const parentalPinHash =
    /^\d{4}$/.test(pin) ? pinHash(pin) : existing.parentalPinHash;
  let recoveryCodeHashValue = existing.recoveryCodeHash;

  if (/^\d{4}$/.test(pin) && !recoveryCodeHashValue) {
    recoveryCode = createRecoveryCode();
    recoveryCodeHashValue = recoveryCodeHash(recoveryCode);
  }

  if (!parentalPinHash) {
    throw new PlayerError(
      "Set a 4-digit parental PIN to protect restricted content.",
      400
    );
  }

  fs.writeFileSync(
    CONFIG_PATH,
    `${JSON.stringify({ serviceId, mac, parentalPinHash, recoveryCodeHash: recoveryCodeHashValue }, null, 2)}\n`,
    "utf8"
  );

  invalidateContentCaches();
  relayTargets.clear();
  relayTicketsByKey.clear();
  return { recoveryCode };
}

function normalizePortalId(value) {
  const id = String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").slice(0, 48);
  return id || `portal-${Date.now()}`;
}

function savePortalProfile({ id, nickname, portalUrl, mac }, parentalPin = "") {
  const cleanUrl = String(portalUrl || "").trim();
  const cleanMac = String(mac || "").trim().toUpperCase();
  if (!/^https?:\/\//i.test(cleanUrl)) throw new PlayerError("Portal URL must start with http:// or https://.", 400);
  try { new URL(cleanUrl); } catch { throw new PlayerError("Enter a valid portal URL.", 400); }
  if (!/^[0-9A-F]{2}(?::[0-9A-F]{2}){5}$/.test(cleanMac)) throw new PlayerError("Enter all 12 MAC digits.", 400);

  const stored = readStoredConfig();
  const oldProfile = !Array.isArray(stored.portals) && (stored.portalUrl || stored.mac)
    ? [{ id: "portal-1", nickname: SERVICES[stored.serviceId]?.name || "Portal", portalUrl: stored.portalUrl || SERVICES[stored.serviceId]?.portalUrl || "", mac: stored.mac || "" }]
    : [];
  const portals = Array.isArray(stored.portals) ? [...stored.portals] : oldProfile;
  const portal = { id: normalizePortalId(id || `portal-${Date.now()}`), nickname: String(nickname || "Portal").trim().slice(0, 80) || "Portal", portalUrl: cleanUrl, mac: cleanMac };
  const index = portals.findIndex((entry) => entry.id === portal.id);
  if (index >= 0) portals[index] = portal; else portals.push(portal);
  const pin = String(parentalPin || "").trim();
  const parentalPinHash = /^\d{4}$/.test(pin) ? pinHash(pin) : stored.parentalPinHash;
  let recoveryCode = "";
  let recoveryCodeHashValue = stored.recoveryCodeHash;
  if (/^\d{4}$/.test(pin) && !recoveryCodeHashValue) {
    recoveryCode = createRecoveryCode();
    recoveryCodeHashValue = recoveryCodeHash(recoveryCode);
  }
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify({ portals, activePortalId: portal.id, parentalPinHash, recoveryCodeHash: recoveryCodeHashValue }, null, 2)}\n`, "utf8");
  invalidateContentCaches(); relayTargets.clear(); relayTicketsByKey.clear();
  return { portal, recoveryCode };
}

function listPortalProfiles() {
  const stored = readStoredConfig();
  if (Array.isArray(stored.portals)) return { portals: stored.portals, activePortalId: stored.activePortalId || stored.portals[0]?.id || null };
  const service = SERVICES[stored.serviceId];
  if (!service && !stored.portalUrl) return { portals: [], activePortalId: null };
  return { portals: [{ id: "portal-1", nickname: service?.name || "Portal", portalUrl: stored.portalUrl || service?.portalUrl || "", mac: stored.mac || "" }], activePortalId: "portal-1" };
}

function activatePortal(id) {
  const stored = readStoredConfig();
  const profiles = listPortalProfiles().portals;
  if (!profiles.some((portal) => portal.id === id)) throw new PlayerError("Portal was not found.", 404);
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify({ ...stored, portals: profiles, activePortalId: id }, null, 2)}\n`, "utf8");
  invalidateContentCaches(); relayTargets.clear(); relayTicketsByKey.clear();
}

function deletePortal(id) {
  const stored = readStoredConfig();
  const profiles = listPortalProfiles().portals.filter((portal) => portal.id !== id);
  if (!profiles.length) throw new PlayerError("Keep at least one portal.", 400);
  const activePortalId = stored.activePortalId === id ? profiles[0].id : (stored.activePortalId || profiles[0].id);
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify({ ...stored, portals: profiles, activePortalId }, null, 2)}\n`, "utf8");
  invalidateContentCaches(); relayTargets.clear(); relayTicketsByKey.clear();
}

function saveParentalPin(pin) {
  const cleanPin = String(pin || "").trim();
  if (!/^\d{4}$/.test(cleanPin)) throw new PlayerError("PIN must be exactly 4 digits.", 400);
  const stored = readStoredConfig();
  if (stored.parentalPinHash) throw new PlayerError("Enter your current PIN before setting a new PIN.", 401);
  return writeParentalPinHash(stored, cleanPin);
}

function writeParentalPinHash(stored, pin) {
  const recoveryCode = createRecoveryCode();
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify({ ...stored, parentalPinHash: pinHash(String(pin).trim()), recoveryCodeHash: recoveryCodeHash(recoveryCode) }, null, 2)}\n`, "utf8");
  return recoveryCode;
}

function updateParentalPin(currentPin, newPin) {
  const stored = readStoredConfig();
  if (!matchesHash(currentPin, stored.parentalPinHash, pinHash)) throw new PlayerError("Current parental PIN is incorrect.", 401);
  const cleanPin = String(newPin || "").trim();
  if (!/^\d{4}$/.test(cleanPin)) throw new PlayerError("PIN must be exactly 4 digits.", 400);
  if (stored.recoveryCodeHash) {
    fs.writeFileSync(CONFIG_PATH, `${JSON.stringify({ ...stored, parentalPinHash: pinHash(cleanPin) }, null, 2)}\n`, "utf8");
    return "";
  }
  return writeParentalPinHash(stored, cleanPin);
}

function regenerateRecoveryCode(currentPin) {
  const stored = readStoredConfig();
  if (!matchesHash(currentPin, stored.parentalPinHash, pinHash)) throw new PlayerError("Current parental PIN is incorrect.", 401);
  const recoveryCode = createRecoveryCode();
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify({ ...stored, recoveryCodeHash: recoveryCodeHash(recoveryCode) }, null, 2)}\n`, "utf8");
  return recoveryCode;
}

function resetParentalPinWithRecovery(code, newPin) {
  const stored = readStoredConfig();
  const cleanCode = String(code || "").trim();
  const cleanPin = String(newPin || "").trim();
  if (!/^\d{8}$/.test(cleanCode)) throw new PlayerError("Enter the 8-digit recovery code.", 400);
  if (!/^\d{4}$/.test(cleanPin)) throw new PlayerError("PIN must be exactly 4 digits.", 400);
  if (!stored.recoveryCodeHash || !matchesHash(cleanCode, stored.recoveryCodeHash, recoveryCodeHash)) {
    throw new PlayerError("Recovery code is incorrect or has not been created yet.", 401);
  }
  const nextRecoveryCode = createRecoveryCode();
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify({ ...stored, parentalPinHash: pinHash(cleanPin), recoveryCodeHash: recoveryCodeHash(nextRecoveryCode) }, null, 2)}\n`, "utf8");
  return nextRecoveryCode;
}

function extractSetCookiePairs(headers) {
  if (!headers) return [];

  let values = [];

  try {
    if (typeof headers.getSetCookie === "function") {
      values = headers.getSetCookie();
    }
  } catch {}

  if (!Array.isArray(values) || values.length === 0) {
    const combined = headers.get?.("set-cookie") || "";
    values = combined ? [combined] : [];
  }

  const pairs = [];

  for (const value of values) {
    /* Node versions without getSetCookie() may join multiple cookies. */
    const chunks = String(value || "").split(/,(?=\s*[^;,=\s]+=[^;,]*)/);

    for (const chunk of chunks) {
      const pair = String(chunk).split(";", 1)[0].trim();
      if (/^[^=;\s]+=[^;]*$/.test(pair)) pairs.push(pair);
    }
  }

  return pairs;
}

function mergeCookieHeader(existing, headersOrPairs) {
  const jar = new Map();

  for (const part of String(existing || "").split(";")) {
    const pair = part.trim();
    const index = pair.indexOf("=");
    if (index > 0) jar.set(pair.slice(0, index).trim(), pair.slice(index + 1));
  }

  const pairs = Array.isArray(headersOrPairs)
    ? headersOrPairs
    : extractSetCookiePairs(headersOrPairs);

  for (const pair of pairs) {
    const index = String(pair).indexOf("=");
    if (index > 0) {
      jar.set(String(pair).slice(0, index).trim(), String(pair).slice(index + 1));
    }
  }

  return [...jar.entries()]
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function loadBalancerCookie(headers) {
  return extractSetCookiePairs(headers)
    .find((pair) => /^__cflb=/i.test(pair)) || "";
}

async function portalRequest(params, session) {
  const config = readConfig();

  if (!config) {
    throw new PlayerError("Complete local player setup first.", 400);
  }

  const url = new URL(config.endpoint);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }

  url.searchParams.set("JsHttpRequest", "1-xml");

  const headers = {
    Accept: "application/json, text/javascript, */*; q=0.01",
    Cookie: session?.cookie || config.baseCookie,
    "User-Agent": MAG_USER_AGENT,
    "X-User-Agent": X_USER_AGENT,
  };

  if (session?.token) {
    headers.Authorization = `Bearer ${session.token}`;
  }

  let response;
  const startedAt = Date.now();

  try {
    response = await fetch(url, {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    if (shouldDiagnosePortalRequest(params)) {
      recordDiagnostic("portal.timeout", {
        request: params,
        elapsedMs: Date.now() - startedAt,
      });
    }
    throw new PlayerError("Portal connection timed out.");
  }

  if (!response.ok) {
    if (shouldDiagnosePortalRequest(params)) {
      recordDiagnostic("portal.http_error", {
        request: params,
        status: response.status,
        elapsedMs: Date.now() - startedAt,
      });
    }
    const portalError = new PlayerError(`Portal returned status ${response.status}.`, response.status);
    const retryAfter = Number(response.headers.get("retry-after"));
    if (Number.isFinite(retryAfter) && retryAfter > 0) {
      portalError.retryAfterMs = retryAfter * 1000;
    }
    throw portalError;
  }

  /* Keep every provider session cookie, not only Cloudflare's __cflb. */
  if (session) {
    session.cookie = mergeCookieHeader(session.cookie, response.headers);
  }

  const text = await response.text();

  if (text.trim() === "Authorization failed.") {
    if (shouldDiagnosePortalRequest(params)) {
      recordDiagnostic("portal.authorization_failed", {
        request: params,
        elapsedMs: Date.now() - startedAt,
      });
    }
    throw new PlayerError("Portal rejected this MAC address.", 401);
  }

  try {
    const data = JSON.parse(text);

    if (shouldDiagnosePortalRequest(params)) {
      recordDiagnostic("portal.response", {
        request: params,
        status: response.status,
        elapsedMs: Date.now() - startedAt,
        response: data,
      });
    }

    return {
      data,
      headers: response.headers,
    };
  } catch {
    if (shouldDiagnosePortalRequest(params)) {
      recordDiagnostic("portal.invalid_json", {
        request: params,
        elapsedMs: Date.now() - startedAt,
        responsePreview: text.slice(0, 180),
      });
    }
    throw new PlayerError("Portal returned an unexpected response.");
  }
}

function profileValue(profile, keys) {
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  const queue = [{ value: profile, depth: 0 }];
  while (queue.length) {
    const { value, depth } = queue.shift();
    if (!value || typeof value !== "object" || depth > 3) continue;
    for (const [key, candidate] of Object.entries(value)) {
      if (wanted.has(key.toLowerCase()) && candidate != null && candidate !== "") return candidate;
      if (candidate && typeof candidate === "object") queue.push({ value: candidate, depth: depth + 1 });
    }
  }
  return null;
}

function subscriptionDate(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" || (/^\d+$/.test(String(value).trim()) && String(value).trim().length >= 9)) {
    const number = Number(value);
    const date = new Date(number < 10_000_000_000 ? number * 1000 : number);
    return Number.isNaN(date.getTime()) || date.getUTCFullYear() < 2000 ? null : date.toISOString();
  }
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) || date.getUTCFullYear() < 2000 ? null : date.toISOString();
}

function extractSubscription(profile) {
  const expiryRaw = profileValue(profile, ["end_date", "expire_date", "expire_billing_date", "expiration", "expires_at", "expiry_date", "valid_until", "endDate", "expireDate"]);
  const normalizedRaw = String(expiryRaw ?? "").trim().toLowerCase();
  const unlimited = ["0", "none", "never", "unlimited", "infinite"].includes(normalizedRaw);
  return {
    plan: String(profileValue(profile, ["tariff_plan", "tariff", "plan", "package", "subscription_name"]) || "Subscription").trim().slice(0, 80),
    status: String(profileValue(profile, ["status", "state", "account_status"]) || "").trim().slice(0, 40),
    expiryDate: unlimited ? null : subscriptionDate(expiryRaw),
    unlimited,
  };
}

async function createSession(retry = true) {
  try {
    const config = readConfig();

    if (!config) {
      throw new PlayerError("Complete local player setup first.", 400);
    }

    const handshake = await portalRequest({
      type: "stb",
      action: "handshake",
      token: "",
    });

    const token = handshake.data?.js?.token;

    if (!token || handshake.data?.js?.not_valid === 1) {
      throw new PlayerError("Portal did not authorize this MAC address.", 401);
    }

    const session = {
      token,
      cookie: mergeCookieHeader(config.baseCookie, handshake.headers),
    };

    const profile = await portalRequest(
      {
        type: "stb",
        action: "get_profile",
        hd: "1",
        stb_type: "MAG250",
        image_version: "218",
        auth_second_step: "1",
        not_valid_token: "0",
      },
      session
    );

    if (!profile.data?.js) {
      throw new PlayerError("MAC profile is unavailable.", 401);
    }

    return { ...session, subscription: extractSubscription(profile.data.js) };
  } catch (error) {
    if (retry && error instanceof PlayerError && error.status === 401) {
      recordDiagnostic("portal.authorization_retry", { reason: "temporary-401" });
      await waitMs(450);
      return createSession(false);
    }
    throw error;
  }
}

function liveRowsFromResponse(response) {
  for (const candidate of [response?.data?.js, response?.data]) {
    const rows = portalRows(candidate).filter(
      (row) => row && typeof row === "object" && !Array.isArray(row)
    );
    if (rows.length) return rows;
  }
  return [];
}

function normalizeLiveChannelRows(rows, categories, commands, defaultGenreId = "", onlyGenreId = "") {
  const categoryLockedById = new Map(
    categories.map((category) => [String(category.id), Boolean(category.locked || category.adultLocked)])
  );

  return rows
    .map((row) => ({
      row,
      id: row?.id ?? row?.tv_id ?? row?.channel_id,
      name: row?.name ?? row?.title ?? row?.channel_name,
      command: row?.cmd ?? row?.command ?? row?.playback_cmd,
    }))
    .filter((channel) => channel.id != null && String(channel.name || "").trim() && String(channel.command || "").trim())
    .map((channel) => {
      const row = channel.row;
      const id = String(channel.id);
      const rawGenreId = String(
        row.tv_genre_id ?? row.genre_id ?? row.genreId ?? row.category_id ?? row.genre ?? ""
      ).trim();
      const hasProviderGenre = Boolean(rawGenreId && rawGenreId !== "0");
      const genreId = hasProviderGenre ? rawGenreId : String(defaultGenreId || "0");
      if (onlyGenreId && hasProviderGenre && rawGenreId !== String(onlyGenreId)) return null;

      commands.set(id, String(channel.command));
      const number = Number(row.number ?? row.channel_number ?? row.num);
      return {
        id,
        name: String(channel.name).trim(),
        number: Number.isFinite(number) ? number : null,
        genreId,
        hd: providerFlag(row.hd),
        adultLocked: isAdult(channel.name) || Boolean(categoryLockedById.get(genreId)),
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.number ?? Number.MAX_SAFE_INTEGER) - (b.number ?? Number.MAX_SAFE_INTEGER) ||
      a.name.localeCompare(b.name));
}

async function rebuildCatalog() {
  const session = await createSession();

  const [genresResponse, channelsResponse] = await Promise.all([
    portalRequest({ type: "itv", action: "get_genres" }, session),
    portalRequest({ type: "itv", action: "get_all_channels" }, session),
  ]);

  const genres = liveRowsFromResponse(genresResponse);
  const rawChannels = liveRowsFromResponse(channelsResponse);

  /* Keep the live parental-lock model from v1.8.12. Provider category IDs
     remain intact; adult channels are not moved into a synthetic category. */
  const providerCategories = genres
    .map((genre) => {
      const id = genre?.id ?? genre?.genre_id ?? genre?.category_id;
      const title = genre?.title ?? genre?.name ?? genre?.genre_name;
      if (id == null || !String(title || "").trim()) return null;
      return {
        id: String(id),
        title: String(title).trim(),
        locked: providerFlag(genre.locked) || providerFlag(genre.adult) || isAdult(title),
      };
    })
    .filter(Boolean);
  const commands = new Map();
  const channels = normalizeLiveChannelRows(rawChannels, providerCategories, commands);
  const knownChannelIds = new Set(channels.map((channel) => String(channel.id)));
  for (const [categoryId, entries] of extraLiveCategoryChannels) {
    if (!providerCategories.some((category) => String(category.id) === categoryId)) continue;
    for (const { channel, command } of entries.values()) {
      if (knownChannelIds.has(String(channel.id))) continue;
      channels.push(channel);
      commands.set(String(channel.id), command);
      knownChannelIds.add(String(channel.id));
    }
  }
  channels.sort((a, b) => (a.number ?? Number.MAX_SAFE_INTEGER) - (b.number ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name));

  catalogCache = {
    session,
    commands,
    expiresAt: Date.now() + 2 * 60_000,
    publicCatalog: {
      subscription: session.subscription || null,
      categories: providerCategories,
      channels,
    },
  };

  recordDiagnostic("live.catalogue_loaded", {
    genreRows: genres.length,
    providerCategories: providerCategories.length,
    rawChannelRows: rawChannels.length,
    normalizedChannels: channels.length,
    channelsWithIds: rawChannels.filter((row) => row?.id != null || row?.tv_id != null || row?.channel_id != null).length,
    channelsWithNames: rawChannels.filter((row) => String(row?.name ?? row?.title ?? row?.channel_name ?? "").trim()).length,
    channelsWithCommands: rawChannels.filter((row) => String(row?.cmd ?? row?.command ?? row?.playback_cmd ?? "").trim()).length,
  });

  return catalogCache;
}

async function loadLiveCategoryChannels(categoryId) {
  const wantedCategoryId = String(categoryId || "").trim();
  if (!wantedCategoryId || wantedCategoryId === "0") {
    throw new PlayerError("Choose a provider Live TV category.", 400);
  }

  let catalog = await activeCatalog();
  const category = catalog.publicCatalog.categories.find((item) => String(item.id) === wantedCategoryId);
  if (!category) throw new PlayerError("That Live TV category is no longer available.", 404);

  const existing = catalog.publicCatalog.channels.filter((channel) => String(channel.genreId) === wantedCategoryId);
  if (existing.length) return existing;

  let response;
  try {
    response = await portalRequest({
      type: "itv",
      action: "get_ordered_list",
      genre: wantedCategoryId,
      category: wantedCategoryId,
      fav: "0",
      sortby: "number",
    }, catalog.session);
  } catch (error) {
    if (!(error instanceof PlayerError) || error.status !== 401) throw error;
    catalog = await activeCatalog(true);
    response = await portalRequest({
      type: "itv",
      action: "get_ordered_list",
      genre: wantedCategoryId,
      category: wantedCategoryId,
      fav: "0",
      sortby: "number",
    }, catalog.session);
  }

  const addedChannels = normalizeLiveChannelRows(
    liveRowsFromResponse(response),
    catalog.publicCatalog.categories,
    catalog.commands,
    wantedCategoryId,
    wantedCategoryId
  );
  if (!addedChannels.length) return [];

  const knownIds = new Set(catalog.publicCatalog.channels.map((channel) => String(channel.id)));
  const retained = extraLiveCategoryChannels.get(wantedCategoryId) || new Map();
  for (const channel of addedChannels) {
    const command = catalog.commands.get(String(channel.id));
    if (command) retained.set(String(channel.id), { channel, command });
  }
  extraLiveCategoryChannels.set(wantedCategoryId, retained);
  catalog.publicCatalog.channels.push(...addedChannels.filter((channel) => !knownIds.has(String(channel.id))));
  catalog.publicCatalog.channels.sort((a, b) => (a.number ?? Number.MAX_SAFE_INTEGER) - (b.number ?? Number.MAX_SAFE_INTEGER) ||
    a.name.localeCompare(b.name));
  return addedChannels;
}

async function fetchUpdatePolicy() {
  let manifestUrl;
  try { manifestUrl = new URL(UPDATE_MANIFEST_URL); } catch { throw new PlayerError("Update service is not configured correctly.", 503); }
  const localHttp = manifestUrl.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(manifestUrl.hostname);
  if (manifestUrl.protocol !== "https:" && !localHttp) {
    throw new PlayerError("Update service must use HTTPS.", 503);
  }

  const response = await fetch(manifestUrl, {
    headers: { Accept: "application/json", "Cache-Control": "no-cache" },
    cache: "no-store",
    redirect: "follow",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new PlayerError("Could not check the update service.", 503);
  const length = Number(response.headers.get("content-length") || 0);
  if (length > 32_768) throw new PlayerError("Update policy is too large.", 503);
  const body = await response.text();
  if (Buffer.byteLength(body) > 32_768) throw new PlayerError("Update policy is too large.", 503);

  let manifest;
  try { manifest = JSON.parse(body); } catch { throw new PlayerError("Update policy is invalid.", 503); }
  try {
    return normalizeUpdateManifest(manifest, {
      platform: "windows",
      channel: String(process.env.STB_PLAY_UPDATE_CHANNEL || "stable").trim().toLowerCase(),
      repository: UPDATE_REPOSITORY,
    });
  } catch {
    throw new PlayerError("Update policy is invalid for this Windows release channel.", 503);
  }
}

async function activeCatalog(force = false) {
  if (!force && catalogCache?.expiresAt > Date.now()) {
    return catalogCache;
  }

  if (!force && catalogPromise) {
    return catalogPromise;
  }

  catalogPromise = rebuildCatalog().finally(() => {
    catalogPromise = null;
  });

  return catalogPromise;
}

function parsePortalStream(raw) {
  const cleaned = String(raw || "")
    .trim()
    .replace(/^(?:ffmpeg|ffrt|auto)\s+/i, "")
    .replace(/&amp;/gi, "&");

  try {
    const url = new URL(cleaned);

    if (!/^https?:$/.test(url.protocol)) {
      throw new Error("Unsupported stream");
    }

    return url.toString();
  } catch {
    throw new PlayerError("Portal did not return a playable stream.");
  }
}

/*
  Some Stalker portals return the final CDN URL while resolving a movie or
  episode quality. Sending that URL through create_link a second time makes
  those portals interpret it as a missing movie id and return
  "nothing_to_play". Only opaque/relative commands need create_link.
*/
function directStreamFromCommand(command) {
  try {
    return parsePortalStream(command);
  } catch {
    return "";
  }
}

async function getStreamUrl(channelId, retry = true) {
  const wantedChannelId = String(channelId || "").trim();
  let catalog;
  try {
    catalog = await activeCatalog();
  } catch (error) {
    if (retry && error instanceof PlayerError && error.status === 401) {
      recordDiagnostic("live.authorization_retry", { channelId: wantedChannelId });
      await waitMs(450);
      await activeCatalog(true);
      return getStreamUrl(wantedChannelId, false);
    }
    throw error;
  }

  let command = catalog.commands.get(wantedChannelId);

  if (!command && retry) {
    /* The channel list can change while a user is watching. Rebuild once
       before telling the renderer that the selected channel is stale. */
    recordDiagnostic("live.catalogue_refresh_for_stale_id", { channelId: wantedChannelId });
    catalog = await activeCatalog(true);
    command = catalog.commands.get(wantedChannelId);
  }

  if (!command) {
    throw new PlayerError("Channel is no longer available.", 404);
  }

  try {
    const response = await portalRequest(
      {
        type: "itv",
        action: "create_link",
        cmd: command,
        series: "0",
        forced_storage: "undefined",
        disable_ad: "0",
        download: "0",
      },
      catalog.session
    );

    const raw =
      typeof response.data?.js === "string"
        ? response.data.js
        : response.data?.js?.cmd || "";
    const streamUrl = parsePortalStream(raw);

    recordDiagnostic("live.playback_link", {
      channelId: wantedChannelId,
      command,
      returnedLink: raw,
      streamUrl,
    });

    return streamUrl;
  } catch (error) {
    if (retry && error instanceof PlayerError && [401, 404].includes(error.status)) {
      recordDiagnostic("live.link_retry", {
        channelId: wantedChannelId,
        status: error.status,
      });
      await waitMs(450);
      await activeCatalog(true);
      return getStreamUrl(wantedChannelId, false);
    }
    if (!retry && error instanceof PlayerError && error.status === 404) {
      for (const [categoryId, entries] of extraLiveCategoryChannels) {
        entries.delete(wantedChannelId);
        if (!entries.size) extraLiveCategoryChannels.delete(categoryId);
      }
    }

    throw error;
  }
}

function cleanPosterUrl(value) {
  const raw = String(value || "").trim();

  if (!raw || raw === "0") return "";

  let candidate = raw;
  try {
    const config = readConfig();
    const base = config?.endpoint || "";
    if (raw.startsWith("//")) candidate = `http:${raw}`;
    else if (raw.startsWith("/") && base) candidate = new URL(raw, base).toString();
    else if (!/^[a-z][a-z\d+.-]*:\/\//i.test(raw) && /^[\w.-]+\//.test(raw)) {
      candidate = `http://${raw}`;
    }
  } catch {}

  try {
    const url = new URL(candidate);
    return /^https?:$/.test(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function normalizeMediaItem(row, kind = "vod") {
  const id = row?.id ?? row?.series_id ?? row?.movie_id ?? row?.stream_id;
  const videoId = row?.video_id ?? row?.movie_id ?? row?.id ?? row?.series_id;
  const movieId = row?.movie_id ?? row?.video_id ?? row?.id ?? row?.series_id;
  const seriesValue = row?.series;
  const seriesFlag = typeof seriesValue === "object"
    ? ""
    : String(seriesValue ?? "").trim().toLowerCase();
  const hasSeriesShape =
    kind === "series" ||
    ["1", "true", "yes"].includes(seriesFlag) ||
    row?.series_name != null ||
    row?.seasons != null ||
    row?.episodes != null ||
    row?.season != null ||
    (seriesValue && typeof seriesValue === "object" &&
      (Array.isArray(seriesValue) ? seriesValue.length > 0 : Object.keys(seriesValue).length > 0));

  return {
    id: String(id ?? ""),
    title: String(row.name || row.title || "").trim(),
    oldTitle: String(row.old_name || row.o_name || "").trim(),
    alternateTitle: String(
      row.alternate_title || row.alt_title || row.original_title || row.title_original || ""
    ).trim(),
    description: String(
      row.description || row.description_en || row.plot || ""
    ).trim(),
    year: String(row.year || "").trim(),
    rating: String(
      row.rating_imdb || row.rating || row.kinopoisk_rating || ""
    ).trim(),
    director: String(row.director || "").trim(),
    actors: String(row.actors || row.cast || "").trim(),
    genre: String(row.genre || row.genre_name || row.category_name || "").trim(),
    language: String(row.language || row.lang || row.language_name || row.audio_language || row.audio_lang || "").trim(),
    audioLanguage: String(row.audio_language || row.audio_lang || row.language || row.lang || "").trim(),
    categoryTitle: String(row.category_title || row.category_name || row.categoryTitle || "").trim(),
    releaseDate: String(row.date_add || row.release_date || row.releaseDate || row.date || "").trim(),
    poster: cleanPosterUrl(
      row.screenshot_uri ||
        row.pic ||
        row.poster ||
        row.cover ||
        row.logo ||
        row.movie_image
    ),
    cmd: String(row.cmd || row.command || row.playback_cmd || ""),
    videoId: String(videoId ?? ""),
    movieId: String(movieId ?? ""),
    path: String(row.path || row.file || "").trim(),
    protocol: String(row.protocol || "").trim(),
    kind: hasSeriesShape ? "series" : "vod",
    isSeries: hasSeriesShape,
    categoryId: row?.category_id == null ? undefined : String(row.category_id),
    adultLocked: isAdult(row.name || row.title) || isAdultRating(row.rating || row.rating_imdb || row.kinopoisk_rating),
  };
}

function uniqueMediaIds(itemOrId) {
  const candidates = itemOrId && typeof itemOrId === "object"
    ? [
        itemOrId.movieId,
        itemOrId.movie_id,
        itemOrId.videoId,
        itemOrId.video_id,
        itemOrId.id,
        itemOrId.seriesId,
        itemOrId.series_id,
      ]
    : [itemOrId];

  return [...new Set(
    candidates
      .map((value) => String(value ?? "").trim())
      .filter(Boolean)
  )];
}

function portalRows(value, depth = 0, seen = new Set()) {
  if (value == null || depth > 6) return [];

  if (typeof value === "string") {
    try {
      return portalRows(JSON.parse(value), depth + 1, seen);
    } catch {
      return [];
    }
  }

  if (Array.isArray(value)) return value;
  if (typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);

  const preferredKeys = [
    "data",
    "items",
    "records",
    "list",
    "seasons",
    "episodes",
    "series",
    "qualities",
    "streams",
    "js",
    "result",
    "payload",
  ];

  for (const key of preferredKeys) {
    if (value[key] == null) continue;
    const rows = portalRows(value[key], depth + 1, seen);
    if (rows.length) return rows;
  }

  return [];
}

function hierarchyTitle(row) {
  return String(
    row?.name || row?.title || row?.episode_name || row?.season_name || ""
  ).trim();
}

function numberFromTitle(value, expression, fallback) {
  const match = String(value || "").match(expression);
  return numberOrFallback(match?.[1], fallback);
}

function seasonNumberFromRow(row, index = 0) {
  return numberOrFallback(
    row?.season_number ?? row?.season_num ?? row?.season ?? row?.number,
    numberFromTitle(hierarchyTitle(row), /(?:^|\b)(?:season|s)\s*[-_.:]?\s*(\d+)/i, index + 1)
  );
}

function episodeNumberFromRow(row, index = 0) {
  return numberOrFallback(
    row?.episode_num ?? row?.episode_number ?? row?.episode ?? row?.number,
    numberFromTitle(hierarchyTitle(row), /(?:^|\b)(?:episode|ep|e)\s*[-_.:]?\s*(\d+)/i, index + 1)
  );
}

function isSeasonHierarchyRow(row) {
  if (!row || typeof row !== "object") return false;
  return (
    row.season_id != null ||
    row.season_number != null ||
    row.season_num != null ||
    row.season != null ||
    /(?:^|\b)(?:season|s)\s*[-_.:]?\s*\d+/i.test(hierarchyTitle(row))
  );
}

function isEpisodeHierarchyRow(row) {
  if (!row || typeof row !== "object") return false;
  return (
    row.episode_id != null ||
    row.episode_num != null ||
    row.episode_number != null ||
    row.episode != null ||
    /(?:^|\b)(?:episode|ep|e)\s*[-_.:]?\s*\d+/i.test(hierarchyTitle(row))
  );
}

function hasVodHierarchySignal(rows) {
  return rows.some((row) => {
    if (!row || typeof row !== "object") return false;
    if (isSeasonHierarchyRow(row) || isEpisodeHierarchyRow(row)) return true;

    return Boolean(
      firstNestedValue(row, QUALITY_COMMAND_KEYS) ||
      row.qualities ||
      row.streams ||
      row.quality ||
      row.resolution
    );
  });
}

function portalProviderError(value) {
  const direct = firstNestedValue(value, ["error", "error_message", "error_msg"]);
  if (direct) return String(direct).trim().replace(/^error\s*:\s*/i, "");

  const text = typeof value?.js === "string"
    ? value.js
    : typeof value === "string"
      ? value
      : "";
  const match = text.match(/(?:^|\b)error\s*:\s*([a-z0-9_-]+)/i);
  return match ? match[1] : "";
}

async function requestVodHierarchy(
  itemOrId,
  { seasonId = "0", episodeId = "0" } = {}
) {
  const catalog = await activeCatalog();
  const mediaIds = uniqueMediaIds(itemOrId);
  const item = itemOrId && typeof itemOrId === "object" ? itemOrId : {};
  const categories = [...new Set(
    [item.categoryId, item.category_id, "*"]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean)
  )];
  let lastRaw = {};

  for (const movieId of mediaIds) {
    for (const category of categories) {
      for (const page of [0, 1]) {
        try {
          const response = await portalRequest(
            {
              type: "vod",
              action: "get_ordered_list",
              category,
              movie_id: movieId,
              season_id: String(seasonId ?? "0"),
              episode_id: String(episodeId ?? "0"),
              p: page,
              sortby: "added",
            },
            catalog.session
          );
          lastRaw = response.data?.js ?? response.data ?? {};
          const rows = portalRows(lastRaw);

          /*
            A few Stalker portals silently ignore movie_id and return the
            normal category page.  Treating that page as a season list is
            what made mixed VOD shows appear empty or malformed.  Only stop
            probing when the response has a real season, episode, quality,
            or playable-command signal.
          */
          if (rows.length && hasVodHierarchySignal(rows)) {
            recordDiagnostic("vod.hierarchy_resolved", {
              movieId,
              category,
              seasonId,
              episodeId,
              page,
              rowCount: rows.length,
              rows,
            });
            return { rows, raw: lastRaw, movieId, category, seasonId, episodeId };
          }

          if (rows.length) {
            recordDiagnostic("vod.hierarchy_catalogue_page_ignored", {
              movieId,
              category,
              seasonId,
              episodeId,
              page,
              rowCount: rows.length,
            });
          }
        } catch (error) {
          recordDiagnostic("vod.hierarchy_attempt_failed", {
            movieId,
            category,
            seasonId,
            episodeId,
            page,
            message: error.message,
          });
        }
      }
    }
  }

  return {
    rows: [],
    raw: lastRaw,
    movieId: mediaIds[0] || "",
    category: categories[0] || "*",
    seasonId: String(seasonId ?? "0"),
    episodeId: String(episodeId ?? "0"),
  };
}

/* =====================================================
   VOD / MOVIES
===================================================== */

async function getVodCategories() {
  if (vodCategoriesCache?.expiresAt > Date.now()) {
    return vodCategoriesCache.value;
  }

  const catalog = await activeCatalog();

  const response = await portalRequest(
    { type: "vod", action: "get_categories" },
    catalog.session
  );

  const raw = response.data?.js;
  const rows = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.data)
      ? raw.data
      : Array.isArray(raw?.items)
        ? raw.items
        : Array.isArray(response.data)
          ? response.data
          : [];

  const value = rows
    .filter((row) => row.id != null && (row.title || row.name))
    .map((row) => ({
      id: String(row.id),
      title: String(row.title || row.name).trim(),
      locked: isAdult(row.title || row.name),
    }));

  vodCategoriesCache = {
    value,
    expiresAt: Date.now() + 60_000,
  };

  return value;
}

async function warmVodShelves(categories) {
  const safeCategories = (Array.isArray(categories) ? categories : [])
    .filter((category) => category?.id != null && !category.locked)
    .map((category) => ({ ...category, id: String(category.id) }));
  if (!safeCategories.length) return;
  if (vodShelfState.promise) return vodShelfState.promise;

  vodShelfState.categories = safeCategories.slice(0, 12);
  vodShelfState.loading = true;
  vodShelfState.lastStartedAt = Date.now();
  vodShelfState.errors = [];
  vodShelfState.promise = (async () => {
    for (const category of vodShelfState.categories) {
      try {
        const result = await getVodItems(category.id, 0, "", {
          priority: -20,
          background: true,
        });
        for (const item of result?.items || []) {
          if (item?.id != null) vodShelfState.items.set(String(item.id), item);
        }
      } catch (error) {
        vodShelfState.errors.push({ categoryId: category.id, message: error.message });
        if (isVodRateLimitError(error)) break;
      }
    }
    vodShelfState.loading = false;
    vodShelfState.promise = null;
    return getVodShelfSnapshot();
  })();
  return vodShelfState.promise;
}

function getVodShelfSnapshot() {
  const shelves = vodShelfState.categories.map((category) => ({
    id: String(category.id),
    title: category.title,
    locked: Boolean(category.locked),
    items: [...vodShelfState.items.values()]
      .filter((item) => String(item.categoryId || "") === String(category.id))
      .slice(0, 24)
      .map((item) => ({ ...item, categoryTitle: item.categoryTitle || category.title })),
  })).filter((shelf) => shelf.items.length);

  return {
    shelves,
    loadedItems: vodShelfState.items.size,
    loading: vodShelfState.loading,
    errors: vodShelfState.errors.length,
    startedAt: vodShelfState.lastStartedAt || 0,
  };
}

async function isLikelySeriesCategory(categoryId) {
  const categories = await getVodCategories();
  const title = categories.find((category) => category.id === String(categoryId))?.title || "";
  return /\b(series|shows?|episodes?|seasons?)\b/i.test(title) &&
    !/\b(movie|movies|film|films)\b/i.test(title);
}

async function getVodItems(categoryId, page = 0, searchTerm = "", queueOptions = {}) {
  /* Normal paging stays independent of search; searchTerm is used only by
     the one-shot provider-search accelerator. */
  /* Large providers can expose tens of thousands of pages. The old 1000
     page cap silently made the local index incomplete forever. */
  const safePage = Math.max(0, Math.min(Number(page) || 0, 100000));
  const safeSearch = String(searchTerm || "").trim().toLowerCase();
  const key = `${categoryId}:${safePage}:${safeSearch}`;

  const cached = vodCache.get(key);

  if (cached?.expiresAt > Date.now()) {
    return cached.value;
  }

  const catalog = await activeCatalog();

  const response = await queueVodRequest(
    () => portalRequest(
      {
        type: "vod",
        action: "get_ordered_list",
        category: categoryId,
        p: safePage,
        sortby: "added",
        ...(safeSearch ? { search: safeSearch } : {}),
      },
      catalog.session
    ),
    {
      priority: queueOptions.priority ?? (safeSearch ? 110 : 100),
      background: queueOptions.background === true,
    }
  );

  const js = response.data?.js || {};
  const rows = Array.isArray(js)
    ? js
    : Array.isArray(js.data)
      ? js.data
      : Array.isArray(response.data)
        ? response.data
        : [];

  /*
    Do NOT require cmd here. Some Stalker portals only provide the
    playable command in get_vod_info/get_ordered_list variations.
    Keeping the title visible fixes categories that previously looked empty.
  */
  /*
    A number of Stalker portals put movies and series in the same VOD
    catalogue and leave `series` empty in get_ordered_list.  The category
    name is therefore a useful hint at list-render time; detail loading
    still verifies the actual seasons/episodes before opening the series UI.
  */
  let categorySuggestsSeries = false;
  let categoryLocked = false;
  let categoryTitle = "";
  try {
    const categories = await getVodCategories();
    const category = categories.find((entry) => entry.id === String(categoryId));
    categoryTitle = String(category?.title || "").trim();
    categorySuggestsSeries = Boolean(category && await isLikelySeriesCategory(categoryId));
    categoryLocked = Boolean(category?.locked);
  } catch {
    /* Category naming must never make the catalogue fail. */
  }

  const items = rows
    .filter((row) =>
      (row.id ?? row.series_id ?? row.movie_id ?? row.stream_id) != null &&
      (row.name || row.title)
    )
    .map((row) => {
      const normalized = normalizeMediaItem(row, "vod");
      return {
        ...normalized,
        categoryId: String(categoryId),
        categoryTitle: normalized.categoryTitle || categoryTitle,
        categoryLocked: categoryLocked || normalized.adultLocked,
        ...(categorySuggestsSeries ? { kind: "series", isSeries: true } : {}),
      };
    });

  const value = {
    items,
    total: Number(js.total_items) || Number(js.total) || items.length,
    pageSize: Number(js.max_page_items) || items.length,
    page: safePage,
  };

  vodCache.set(key, {
    value,
    expiresAt: Date.now() + 5 * 60_000,
  });

  return value;
}

function normalizeTitleSearchText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function strictTitleSearchMatch(item, query) {
  const needle = normalizeTitleSearchText(query);
  if (!needle) return false;
  const escapedNeedle = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp(`(?:^| )${escapedNeedle}(?=$| )`, "u");
  return [
    item?.title,
    item?.name,
    item?.oldTitle,
    item?.alternateTitle,
    item?.originalTitle,
  ].some((value) => matcher.test(normalizeTitleSearchText(value)));
}

function addVodSearchItems(items, categoryMap) {
  for (const rawItem of items || []) {
    if (!rawItem?.id) continue;
    const id = String(rawItem.id);
    const categoryId = String(rawItem.categoryId || "*");
    const category = categoryMap.get(categoryId);
    const item = {
      ...rawItem,
      id,
      categoryId,
      categoryTitle: category?.title || rawItem.categoryTitle || "All",
      categoryLocked: Boolean(category?.locked || rawItem.categoryLocked),
    };
    vodSearchState.items.set(id, {
      ...vodSearchState.items.get(id),
      ...item,
      id,
    });
  }
}

async function buildVodSearchIndex() {
  if (vodSearchState.complete) return;
  if (vodSearchState.promise) return vodSearchState.promise;

  vodSearchState.building = true;
  vodSearchState.error = "";
  vodSearchState.promise = (async () => {
    try {
      const categories = await getVodCategories();
      const categoryMap = new Map(categories.map((category) => [String(category.id), category]));
      const allCategory = categories.find((category) => String(category.id) === "*") || {
        id: "*",
        title: "All",
        locked: false,
      };

      let stop = false;
      let firstError = null;
      const fetchPage = async () => {
        const page = vodSearchState.nextPage;
        vodSearchState.nextPage += 1;
        const result = await getVodItems(allCategory.id, page, "", {
          priority: -30,
          background: true,
        });
        addVodSearchItems(result.items, categoryMap);
        vodSearchState.total = Number(result.total) || vodSearchState.total;
        const pageSize = result.items?.length || 0;
        const maxPages = vodSearchState.total > 0
          ? Math.ceil(vodSearchState.total / Math.max(Number(result.pageSize) || 14, pageSize || 14)) + 1
          : 100000;
        if (!pageSize || page >= maxPages - 1) stop = true;
      };

      /* Build the optional full index one page at a time. It is started only
         by the Settings button and never competes with visible VOD requests. */
      const worker = async () => {
        while (!stop && !firstError) {
          try { await fetchPage(); }
          catch (error) { firstError = error; stop = true; }
        }
      };
      await worker();
      if (firstError) throw firstError;
      vodSearchState.complete = true;
    } catch (error) {
      vodSearchState.error = error.message || "VOD search index failed.";
      recordDiagnostic("vod.search_index_failed", { message: vodSearchState.error });
    } finally {
      vodSearchState.building = false;
      vodSearchState.promise = null;
    }
  })();

  return vodSearchState.promise;
}

async function searchVodCatalog(query) {
  const needle = String(query || "").trim().toLowerCase();
  if (needle.length < 3) return { query: needle, items: [], total: 0, complete: true };

  /* Try the provider's native search parameter once. The Formuler capture
     proves this is part of the normal Stalker dialect. Some providers ignore
     it, so only trust the response when its returned titles actually match. */
  try {
    const categories = await getVodCategories();
    const allCategory = categories.find((category) => String(category.id) === "*") ||
      categories.find((category) => String(category.id) === "0") ||
      { id: "*", title: "All", locked: false };
    const providerPage = await getVodItems(allCategory.id, 0, needle, {
      priority: 120,
      background: false,
    });
    const providerMatches = (providerPage.items || []).filter((item) => strictTitleSearchMatch(item, needle));
    if (providerMatches.length || Number(providerPage.total) === 0) {
      return {
        query: needle,
        items: providerMatches.slice(0, 100),
        total: providerMatches.length,
        indexedItems: vodSearchState.items.size,
        totalItems: Number(providerPage.total) || 0,
        complete: true,
        building: false,
        provider: true,
        error: "",
      };
    }
  } catch (error) {
    recordDiagnostic("vod.provider_search_failed", { message: error.message });
  }

  /* If the provider ignored `search=`, return the local shelf/index. A full
     index is never started implicitly by typing in the search box. */
  const items = [...vodSearchState.items.values()]
    .filter((item) => strictTitleSearchMatch(item, needle))
    .slice(0, 100);

  recordDiagnostic("vod.search_index_status", {
    query: needle,
    indexedItems: vodSearchState.items.size,
    totalItems: vodSearchState.total,
    complete: vodSearchState.complete,
    building: vodSearchState.building,
  });

  return {
    query: needle,
    items,
    total: items.length,
    indexedItems: vodSearchState.items.size,
    totalItems: vodSearchState.total,
    complete: vodSearchState.complete,
    building: vodSearchState.building,
    error: vodSearchState.error,
  };
}

async function getVodIndexSnapshot(after = 0) {
  /* Seed the local search stream from the fast category shelves first. */
  for (const item of vodShelfState.items.values()) {
    if (!item?.id) continue;
    vodSearchState.items.set(String(item.id), item);
  }
  void buildVodSearchIndex();
  const cursor = Math.max(0, Number(after) || 0);
  const indexedItems = vodSearchState.items.size;
  const reset = cursor > indexedItems;
  const allItems = [...vodSearchState.items.values()];
  return {
    /* Return only rows after the client's cursor. Re-sending the entire
       growing catalogue every poll made the local index unnecessarily slow. */
    items: reset ? allItems : allItems.slice(cursor),
    reset,
    indexedItems,
    totalItems: vodSearchState.total,
    complete: vodSearchState.complete,
    building: vodSearchState.building,
    error: vodSearchState.error || "",
  };
}

async function getVodShelves() {
  const categories = await getVodCategories();
  if (!vodShelfState.promise && !vodShelfState.items.size) void warmVodShelves(categories);
  return getVodShelfSnapshot();
}

function normalizeClientVodFallback(categoryId, itemId, fallback) {
  if (!fallback || typeof fallback !== "object") return null;
  const safeId = String(itemId || fallback.id || "").trim();
  const title = String(fallback.title || fallback.name || "").trim();
  if (!safeId || !title) return null;
  return {
    ...fallback,
    id: safeId,
    categoryId: String(categoryId),
    title,
    categoryTitle: String(fallback.categoryTitle || "").trim(),
  };
}

async function findVodItem(categoryId, itemId, clientFallback = null) {
  const known = vodSearchState.items.get(String(itemId)) || vodShelfState.items.get(String(itemId));
  if (known) return known;

  /* A title can come from the renderer's local index while this server
     process has not visited that page yet. Keep the selected card usable
     without scanning thousands of provider pages just to rediscover it. */
  const fallback = normalizeClientVodFallback(categoryId, itemId, clientFallback);
  if (fallback) {
    vodSearchState.items.set(String(itemId), fallback);
    return fallback;
  }

  for (let page = 0; page <= 10; page += 1) {
    const result = await getVodItems(categoryId, page, "", { priority: 90 });
    const item = result.items.find((entry) => entry.id === itemId);

    if (item) return item;

    if (!result.items.length) break;
    if (result.total && (page + 1) * result.items.length >= result.total) {
      /* harmless optimization for smaller catalogues */
    }
  }

  return null;
}

function firstNestedValue(value, keys, depth = 0) {
  if (!value || typeof value !== "object" || depth > 5) return "";
  for (const key of keys) {
    if (value[key] != null && (typeof value[key] === "string" || typeof value[key] === "number")) {
      const candidate = String(value[key]).trim();
      if (candidate) return candidate;
    }
  }
  for (const child of Object.values(value)) {
    const found = firstNestedValue(child, keys, depth + 1);
    if (found) return found;
  }
  return "";
}

async function getVodInfo(item) {
  const ids = uniqueMediaIds(item);
  const key = `vod-info:${ids.join(":")}`;
  const cached = vodInfoCache.get(key);
  if (cached?.expiresAt > Date.now()) return cached.value;
  const catalog = await activeCatalog();
  let value = {};

  for (const mediaId of ids) {
    try {
      const response = await portalRequest(
        { type: "vod", action: "get_vod_info", movie_id: mediaId, vod_id: mediaId },
        catalog.session
      );
      const rawValue = response.data?.js ?? response.data ?? {};
      value = rawValue;
      if (typeof rawValue === "string") {
        try {
          value = JSON.parse(rawValue);
        } catch {
          value = { cmd: rawValue };
        }
      }
      if (value && value !== false && (typeof value !== "object" || Object.keys(value).length)) break;
    } catch (error) {
      if (mediaId === ids.at(-1)) throw error;
    }
  }

  vodInfoCache.set(key, { value, expiresAt: Date.now() + 5 * 60_000 });
  return value;
}

const SUBTITLE_CONTAINER_KEY = /^(?:subtitles?|captions?|closed[_-]?captions?|subtitle_tracks?|caption_tracks?|tracks?)$/i;
const SUBTITLE_URL_KEY = /^(?:url|uri|src|source|file|path|srt|vtt|subtitle[_-]?(?:url|uri|file|src)|caption[_-]?(?:url|uri|file|src))$/i;
const SUBTITLE_LANGUAGE_KEY = /^(?:language|lang|srclang|subtitle[_-]?language|caption[_-]?language)$/i;
const SUBTITLE_LABEL_KEY = /^(?:label|name|title|language_name|lang_name)$/i;

function subtitleLanguageCode(value) {
  const raw = String(value || "").trim().toLowerCase().replace(/_/g, "-");
  if (!raw) return "und";
  const base = raw.split(/[-\s]/)[0];
  if (["en", "eng", "english"].includes(raw) || ["en", "eng"].includes(base)) return "en";
  if (["pa", "pan", "pun", "punjabi"].includes(raw) || ["pa", "pan", "pun"].includes(base)) return "pa";
  if (["hi", "hin", "hindi"].includes(raw) || ["hi", "hin"].includes(base)) return "hi";
  return raw.slice(0, 12) || "und";
}

function subtitleLabel(language, fallback = "Subtitle") {
  return {
    en: "English",
    pa: "Punjabi",
    hi: "Hindi",
    und: fallback,
  }[language] || String(fallback || language || "Subtitle").slice(0, 48);
}

function subtitleSourceUrl(rawValue) {
  const raw = String(rawValue || "").trim();
  if (!raw || raw.length > 2048) return "";

  let base = "";
  try { base = String(readConfig()?.endpoint || "").trim(); } catch {}

  let target;
  try {
    target = new URL(raw, base || undefined);
  } catch {
    return "";
  }

  if (!/^https?:$/.test(target.protocol) || target.username || target.password) return "";

  /* A provider may legitimately host its subtitle file on the same private
     portal address. Other private targets are rejected to avoid turning the
     local player into a generic SSRF proxy. */
  let sameAsPortal = false;
  try { sameAsPortal = Boolean(base) && target.origin === new URL(base).origin; } catch {}
  if (isPrivatePosterHost(target.hostname) && !sameAsPortal) return "";
  return target.toString();
}

function collectSubtitleCandidates(value, output = [], inherited = {}, subtitleContext = false, depth = 0, seen = new Set()) {
  if (value == null || depth > 8) return output;

  if (typeof value === "string" || typeof value === "number") {
    if (subtitleContext) output.push({ ...inherited, url: String(value).trim() });
    return output;
  }

  if (Array.isArray(value)) {
    for (const child of value) collectSubtitleCandidates(child, output, inherited, subtitleContext, depth + 1, seen);
    return output;
  }

  if (typeof value !== "object" || seen.has(value)) return output;
  seen.add(value);

  const local = { ...inherited };
  for (const [key, child] of Object.entries(value)) {
    if (SUBTITLE_LANGUAGE_KEY.test(key) && (typeof child === "string" || typeof child === "number")) {
      local.language = String(child);
    }
    if (SUBTITLE_LABEL_KEY.test(key) && (typeof child === "string" || typeof child === "number")) {
      local.label = String(child);
    }
    if (/^(?:format|type|extension)$/i.test(key) && (typeof child === "string" || typeof child === "number")) {
      local.format = String(child);
    }
  }

  for (const [key, child] of Object.entries(value)) {
    const subtitleKey = SUBTITLE_CONTAINER_KEY.test(key) || /subtitle|caption/i.test(key);
    if (SUBTITLE_URL_KEY.test(key) && (subtitleContext || subtitleKey)) {
      if (typeof child === "string" || typeof child === "number") {
        output.push({ ...local, url: String(child).trim() });
      }
      continue;
    }
    if ((subtitleKey || subtitleContext) && child && typeof child === "object") {
      collectSubtitleCandidates(child, output, local, true, depth + 1, seen);
    }
  }
  return output;
}

function normalizeSubtitleTracks(value, source = "provider") {
  const candidates = collectSubtitleCandidates(value);
  const tracks = [];
  const seen = new Set();

  for (const candidate of candidates) {
    const url = subtitleSourceUrl(candidate.url);
    if (!url) continue;
    const language = subtitleLanguageCode(candidate.language);
    const key = `${language}\u0000${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const format = String(candidate.format || "").toLowerCase() || (/\.vtt(?:$|\?)/i.test(url) ? "vtt" : "srt");
    tracks.push({
      language,
      label: subtitleLabel(language, candidate.label),
      url,
      format: /vtt|webvtt/i.test(format) ? "vtt" : "srt",
      source,
    });
  }
  return tracks.slice(0, 12);
}

async function getConfiguredSubtitleTracks(title, year, language) {
  if (!SUBTITLE_API_URL) return [];

  let endpoint;
  try { endpoint = new URL(SUBTITLE_API_URL); } catch { return []; }
  if (!/^https?:$/.test(endpoint.protocol) || endpoint.username || endpoint.password || isPrivatePosterHost(endpoint.hostname)) {
    recordDiagnostic("vod.subtitle_api_rejected", { reason: "unsafe-endpoint" });
    return [];
  }

  endpoint.searchParams.set("query", String(title || "").slice(0, 160));
  if (year) endpoint.searchParams.set("year", String(year).slice(0, 4));
  endpoint.searchParams.set("languages", language && language !== "auto" ? language : "en,pa,hi");

  try {
    const response = await fetch(endpoint, {
      headers: {
        Accept: "application/json",
        ...(SUBTITLE_API_KEY ? { Authorization: `Bearer ${SUBTITLE_API_KEY}` } : {}),
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`subtitle service returned ${response.status}`);
    return normalizeSubtitleTracks(await response.json(), "configured-api");
  } catch (error) {
    recordDiagnostic("vod.subtitle_api_failed", { status: error?.status, message: error?.message });
    return [];
  }
}

async function getVodSubtitles(categoryId, itemId, clientFallback, language = "auto", title = "", year = "") {
  const item = await findVodItem(String(categoryId), String(itemId), clientFallback);
  if (!item) throw new PlayerError("Choose a valid movie or episode.", 404);

  let info = {};
  try { info = await getVodInfo(item); } catch (error) {
    recordDiagnostic("vod.subtitle_info_failed", { itemId: item.id, status: error?.status });
  }

  const providerTracks = normalizeSubtitleTracks(info, "provider");
  const configuredTracks = providerTracks.length
    ? []
    : await getConfiguredSubtitleTracks(title || item.title, year || item.year, language);
  const requested = String(language || "auto").toLowerCase();
  const allTracks = [...providerTracks, ...configuredTracks];
  const filtered = requested === "auto" || requested === "off"
    ? allTracks
    : allTracks.filter((track) => track.language === requested);
  const session = (await activeCatalog()).session;
  const sourceTracks = filtered.map((track, index) => ({
    ...track,
    id: `${track.language}-${track.source}-${index}`,
    url: createRelayTarget(
      track.url,
      30 * 60_000,
      "subtitle",
      false,
      track.source === "provider" ? relayCredentials(session) : null
    ),
  }));

  return {
    tracks: sourceTracks.map(({ id, url, language: trackLanguage, label, format, source }) => ({
      id,
      language: trackLanguage,
      label,
      format,
      source,
      url,
    })),
    message: sourceTracks.length ? "Online subtitles ready." : "No online subtitles were found for this title.",
  };
}

async function resolveVodCommand(item) {
  if (item?.cmd) {
    recordDiagnostic("vod.command_from_list", {
      itemId: item.id,
      title: item.title,
      command: item.cmd,
    });
    return item.cmd;
  }

  const js = await getVodInfo(item);
  const command = firstNestedValue(js, ["cmd", "command", "playback_cmd", "url", "stream_url"]);

  recordDiagnostic(command ? "vod.command_resolved" : "vod.command_missing", {
    itemId: item.id,
    title: item.title,
    command,
    info: js,
  });

  return command;
}

const QUALITY_COMMAND_KEYS = ["cmd", "command", "playback_cmd", "url", "stream_url"];
const QUALITY_LABEL_KEYS = [
  "quality_name",
  "quality",
  "profile",
  "resolution",
  "language",
  "format",
  "label",
  "name",
  "title",
];

function collectQualityCommands(value, inheritedLabel = "", output = [], seen = new Set(), depth = 0) {
  if (!value || typeof value !== "object" || depth > 8 || seen.has(value)) return output;
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      collectQualityCommands(entry, inheritedLabel || `Quality ${index + 1}`, output, seen, depth + 1);
    });
    return output;
  }

  let label = inheritedLabel;
  for (const key of QUALITY_LABEL_KEYS) {
    const candidate = value[key];
    if (candidate != null && (typeof candidate === "string" || typeof candidate === "number")) {
      const text = String(candidate).trim();
      if (text && text.length < 120) {
        label = text;
        break;
      }
    }
  }

  for (const key of QUALITY_COMMAND_KEYS) {
    const command = value[key];
    if (typeof command === "string" && command.trim()) {
      output.push({ command: command.trim(), label: label || "Quality" });
      break;
    }
  }

  for (const [key, child] of Object.entries(value)) {
    if (!child || typeof child !== "object") continue;
    const nextLabel = /quality|profile|resolution|language|format|label/i.test(key)
      ? key.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
      : label;
    collectQualityCommands(child, nextLabel, output, seen, depth + 1);
  }

  return output;
}

function createQualityOptions(rawOptions, context) {
  const unique = [];
  const commands = new Set();

  for (const option of rawOptions) {
    const command = String(option?.command || "").trim();
    if (!command || commands.has(command)) continue;
    commands.add(command);
    const id = randomBytes(18).toString("hex");
    qualityOptionCache.set(id, {
      ...context,
      command,
      expiresAt: Date.now() + 5 * 60_000,
    });
    unique.push({
      id,
      label: String(option?.label || "Quality").trim() || "Quality",
    });
  }

  return unique;
}

function getQualityCommand(token, expected) {
  const key = String(token || "").trim();
  const entry = qualityOptionCache.get(key);

  if (!entry || entry.expiresAt < Date.now()) {
    qualityOptionCache.delete(key);
    throw new PlayerError("Playback quality expired. Select the quality again.", 410);
  }

  for (const field of ["kind", "categoryId", "itemId", "season", "episodeId"]) {
    if (expected[field] != null && String(entry[field]) !== String(expected[field])) {
      throw new PlayerError("Playback quality does not match this title.", 400);
    }
  }

  return entry.command;
}

/*
  The portal's VOD list exposes a playable URL in `cmd`, but the native MAG
  client does not replay that URL. It converts the selected file row to a
  fresh create_link command such as /media/file_217872.mpg. Reusing the old
  CDN URL is what caused the 403 seen in v1.5.7 after the URL had expired.
*/
function vodFileId(row) {
  if (!row || typeof row !== "object") return "";

  const value =
    row.file_id ??
    row.fileId ??
    (row.is_file || row.file_type ? row.id : "");

  const id = String(value ?? "").trim();
  return /^\d+$/.test(id) ? id : "";
}

function commandUrl(value) {
  try {
    return parsePortalStream(value);
  } catch {
    return "";
  }
}

async function resolveVodCreateCommand(command, item, hierarchyOptions = {}) {
  const original = String(command || "").trim();
  if (!original) return "";

  let hierarchy;
  try {
    hierarchy = await requestVodHierarchy(item, hierarchyOptions);
  } catch (error) {
    recordDiagnostic("vod.create_command_hierarchy_failed", {
      command: original,
      message: error.message,
    });
    return original;
  }

  const rows = Array.isArray(hierarchy?.rows) ? hierarchy.rows : [];
  const originalUrl = commandUrl(original);
  const fileRows = rows.filter((row) => vodFileId(row));

  const matchingRow = fileRows.find((row) => {
    const rowCommand = firstNestedValue(row, QUALITY_COMMAND_KEYS);
    if (!rowCommand) return false;

    if (rowCommand === original) return true;

    const rowUrl = commandUrl(rowCommand);
    return Boolean(originalUrl && rowUrl && originalUrl === rowUrl);
  });

  const row = matchingRow || (fileRows.length === 1 ? fileRows[0] : null);
  const fileId = vodFileId(row);

  if (!fileId) {
    recordDiagnostic("vod.create_command_file_id_missing", {
      command: original,
      rowCount: rows.length,
      fileRowCount: fileRows.length,
      seasonId: hierarchyOptions.seasonId,
      episodeId: hierarchyOptions.episodeId,
    });
    return original;
  }

  const freshCommand = `/media/file_${fileId}.mpg`;
  recordDiagnostic("vod.create_command_mapped", {
    originalCommand: original,
    freshCommand,
    fileId,
    seasonId: hierarchyOptions.seasonId,
    episodeId: hierarchyOptions.episodeId,
  });
  return freshCommand;
}

async function getVodQualityOptions(categoryId, itemId, clientFallback = null) {
  const item = await findVodItem(categoryId, itemId, clientFallback);
  if (!item) throw new PlayerError("Movie is no longer available. Refresh Movies & Series and try again.", 404);

  let info = {};
  try {
    info = await getVodInfo(item);
  } catch {
    /* Some mixed portals reject get_vod_info; series probing can still work. */
  }

  /*
    On mixed MAG/Stalker portals the quality rows are not returned by
    get_vod_info. They live behind the same VOD hierarchy used by the native
    client: movie_id -> season_id -> episode_id. Query the movie level before
    falling back to the catalogue command.
  */
  const hierarchy = await requestVodHierarchy(item, {
    seasonId: "0",
    episodeId: "0",
  });
  const rawOptions = collectQualityCommands(info);
  collectQualityCommands(hierarchy.raw, "", rawOptions);
  hierarchy.rows.forEach((row) => {
    collectQualityCommands(row, hierarchyTitle(row), rawOptions);
  });
  if (item.cmd) rawOptions.push({ command: item.cmd, label: "Default quality" });
  if (!rawOptions.length) {
    const command = await resolveVodCommand(item);
    if (command) rawOptions.push({ command, label: "Default quality" });
  }

  const options = createQualityOptions(rawOptions, {
    kind: "movie",
    categoryId: String(categoryId),
    itemId: String(itemId),
  });

  if (!options.length) throw new PlayerError("Portal did not provide playback quality for this movie.");
  return { item: { ...item, categoryId: String(categoryId) }, options };
}

async function getVodEpisodeQualityOptions(categoryId, itemId, seasonNumber, episodeId, clientFallback = null) {
  const item = await findVodItem(categoryId, itemId, clientFallback);
  if (!item) throw new PlayerError("Series is no longer available. Refresh and try again.", 404);

  const safeSeason = numberOrFallback(seasonNumber, 1);
  const info = await getSeriesSeasonInfo(item, safeSeason);
  const episodes = extractEpisodes(info, safeSeason);

  const episode =
    episodes.find((entry) => entry.id === String(episodeId)) ||
    episodes.find((entry) => entry.portalId === String(episodeId)) ||
    episodes.find((entry) => String(entry.episode) === String(episodeId));
  if (!episode) throw new PlayerError("Episode is no longer available. Refresh and try again.", 404);

  const rawOptions = collectQualityCommands(episode.raw || episode);
  const hierarchy = await requestVodHierarchy(item, {
    seasonId: episode.seasonPortalId || safeSeason,
    episodeId: episode.portalId || episode.id,
  });
  collectQualityCommands(hierarchy.raw, "", rawOptions);
  hierarchy.rows.forEach((row) => {
    collectQualityCommands(row, hierarchyTitle(row), rawOptions);
  });

  /* A few portals use the episode id as movie_id for the final quality row. */
  if (!rawOptions.length && (episode.portalId || episode.id)) {
    const episodeMediaId = episode.portalId || episode.id;
    const episodeHierarchy = await requestVodHierarchy(
      { ...item, movieId: episodeMediaId, videoId: episodeMediaId, id: episodeMediaId },
      { seasonId: "0", episodeId: "0" }
    );
    collectQualityCommands(episodeHierarchy.raw, "", rawOptions);
    episodeHierarchy.rows.forEach((row) => {
      collectQualityCommands(row, hierarchyTitle(row), rawOptions);
    });
  }
  if (episode.cmd) rawOptions.push({ command: episode.cmd, label: "Default quality" });
  const options = createQualityOptions(rawOptions, {
    kind: "episode",
    categoryId: String(categoryId),
    itemId: String(itemId),
    season: String(safeSeason),
    episodeId: String(episode.id),
  });

  if (!options.length) throw new PlayerError("Portal did not provide playback quality for this episode.");
  return {
    item: { ...item, categoryId: String(categoryId), kind: "series", isSeries: true },
    season: safeSeason,
    episode,
    options,
  };
}

async function getVodStreamUrl(categoryId, itemId, qualityId = "", clientFallback = null) {
  const item = await findVodItem(categoryId, itemId, clientFallback);

  if (!item) {
    throw new PlayerError(
      "Movie is no longer available. Refresh Movies and try again.",
      404
    );
  }

  const requestedCommand = qualityId
    ? getQualityCommand(qualityId, { kind: "movie", categoryId, itemId })
    : await resolveVodCommand(item);

  if (!requestedCommand) {
    throw new PlayerError("Portal did not provide a movie playback command.");
  }

  /* Always obtain a fresh VOD link, matching STBEmu's create_link flow. */
  const command = await resolveVodCreateCommand(requestedCommand, item, {
    seasonId: "0",
    episodeId: "0",
  });

  const catalog = await activeCatalog();

  const response = await portalRequest(
    {
      type: "vod",
      action: "create_link",
      cmd: command,
      series: "0",
      forced_storage: "undefined",
      disable_ad: "0",
      download: "0",
    },
    catalog.session
  );

  const raw =
    typeof response.data?.js === "string"
      ? response.data.js
      : firstNestedValue(response.data?.js || response.data, [
          "cmd",
          "url",
          "stream_url",
          "stream",
        ]);

  const providerError = portalProviderError(response.data);

  if (providerError) {
    recordDiagnostic("vod.provider_unavailable", {
      itemId,
      title: item.title,
      command,
      providerError,
    });

    if (providerError.toLowerCase() === "nothing_to_play") {
      throw new PlayerError(
        "This movie is currently unavailable on the provider's VOD storage. Please try another title.",
        503
      );
    }

    throw new PlayerError(
      "The provider could not start this movie. Please try another title.",
      503
    );
  }

  const streamUrl = parsePortalStream(raw);

  recordDiagnostic("vod.playback_link", {
    itemId,
    title: item.title,
    command,
    returnedLink: raw,
    streamUrl,
  });

  return streamUrl;
}

/*
  Many providers put both films and shows in the VOD catalogue. The same
  get_vod_info response can contain seasons/episodes, so the combined UI
  asks these routes first and decides which detail view to show at runtime.
*/
async function getCombinedVodDetail(categoryId, itemId, clientFallback = null) {
  const item = await findVodItem(categoryId, itemId, clientFallback);

  if (!item) {
    throw new PlayerError("Title is no longer available. Refresh Movies & Series and try again.", 404);
  }

  let info = {};
  try {
    info = await getVodInfo(item);
  } catch (error) {
    if (!item.cmd) throw error;
  }

  let seasons = extractSeasons(info);
  let categorySuggestsSeries = false;
  try {
    categorySuggestsSeries = await isLikelySeriesCategory(categoryId);
  } catch {
    /* Category naming is only a hint; metadata remains authoritative. */
  }

  /*
    The provider's "All" category can contain shows too, but it has no
    useful category name to identify them.  Rows without a direct movie
    command are therefore also probed through the series dialects.
  */
  /*
    A mixed VOD row may still contain a direct `cmd` even when it is a
    show.  Do not use that command as a movie classification signal: the
    provider's series endpoint is the source of truth for seasons and
    episodes.  Probe it whenever VOD info did not already expose seasons.
    This keeps the UI flow deterministic: show -> season -> episode ->
    quality, while ordinary movies simply return no series details.
  */
  if (!seasons.length) {
    try {
      const seriesInfo = await getSeriesInfo(item);
      const seriesSeasons = extractSeasons(seriesInfo);
      if (seriesSeasons.length || hasSeriesDetails(seriesInfo)) {
        info = seriesInfo;
        seasons = seriesSeasons;
      }
    } catch {
      /* Some portals do not implement the series endpoint. */
    }
  }

  const isSeries = Boolean(
    item.isSeries ||
    item.kind === "series" ||
    seasons.length ||
    hasSeriesDetails(info) ||
    categorySuggestsSeries
  );
  const normalizedItem = {
    ...item,
    categoryId: String(categoryId),
    kind: isSeries ? "series" : "vod",
    isSeries,
  };

  recordDiagnostic("vod.detail_normalized", {
    categoryId,
    itemId,
    title: item.title,
    kind: normalizedItem.kind,
    seasonCount: seasons.length,
    info,
  });

  return { item: normalizedItem, seasons };
}

async function getCombinedVodEpisodes(categoryId, itemId, seasonNumber) {
  const item = await findVodItem(categoryId, itemId);
  if (!item) throw new PlayerError("Series is no longer available. Refresh and try again.", 404);

  const safeSeason = numberOrFallback(seasonNumber, 1);
  const info = await getSeriesSeasonInfo(item, safeSeason);
  const episodes = extractEpisodes(info, safeSeason);

  return {
    item: { ...item, categoryId: String(categoryId), kind: "series", isSeries: true },
    season: safeSeason,
    episodes,
  };
}

async function getCombinedVodEpisodeStream(categoryId, itemId, seasonNumber, episodeId, qualityId = "") {
  const item = await findVodItem(categoryId, itemId);
  if (!item) throw new PlayerError("Series is no longer available. Refresh and try again.", 404);

  const safeSeason = numberOrFallback(seasonNumber, 1);
  const info = await getSeriesSeasonInfo(item, safeSeason);
  const episodes = extractEpisodes(info, safeSeason);
  const episode =
    episodes.find((entry) => entry.id === String(episodeId)) ||
    episodes.find((entry) => entry.portalId === String(episodeId)) ||
    episodes.find((entry) => String(entry.episode) === String(episodeId));

  if (!episode) {
    recordDiagnostic("vod.series_episode_missing", {
      categoryId,
      itemId,
      seasonNumber: safeSeason,
      episodeId,
      availableEpisodes: episodes,
    });
    throw new PlayerError("Episode is no longer available. Refresh and try again.", 404);
  }

  const requestedCommand = qualityId
    ? getQualityCommand(qualityId, {
        kind: "episode",
        categoryId,
        itemId,
        season: safeSeason,
        episodeId: episode.id,
      })
    : episode.cmd || firstNestedValue(episode.raw, ["cmd", "command", "playback_cmd", "url", "stream_url"]);
  if (!requestedCommand) {
    recordDiagnostic("vod.series_episode_command_missing", {
      categoryId,
      itemId,
      seasonNumber: safeSeason,
      episodeId,
      episode,
    });
    throw new PlayerError("Portal did not provide a playback command for this episode.");
  }

  /* The native capture shows the exact episode file row is resolved first,
     then create_link is called with /media/file_<fileId>.mpg. */
  const command = await resolveVodCreateCommand(requestedCommand, item, {
    seasonId: String(episode.seasonPortalId || safeSeason),
    episodeId: String(episode.portalId || episode.id),
  });

  const catalog = await activeCatalog();
  const response = await portalRequest(
    {
      type: "vod",
      action: "create_link",
      cmd: command,
      series: "1",
      forced_storage: "undefined",
      disable_ad: "0",
      download: "0",
    },
    catalog.session
  );

  const raw =
    typeof response.data?.js === "string"
      ? response.data.js
      : firstNestedValue(response.data?.js || response.data, [
          "cmd",
          "url",
          "stream_url",
          "stream",
        ]);
  const providerError = portalProviderError(response.data);

  if (providerError) {
    recordDiagnostic("vod.series_provider_unavailable", {
      categoryId,
      itemId,
      episodeId,
      command,
      providerError,
    });
    throw new PlayerError(
      providerError.toLowerCase() === "nothing_to_play"
        ? "This episode is currently unavailable on the provider's VOD storage."
        : "The provider could not start this episode. Please try another episode.",
      503
    );
  }

  const streamUrl = parsePortalStream(raw);
  recordDiagnostic("vod.series_playback_link", {
    categoryId,
    itemId,
    seasonNumber: safeSeason,
    episodeId,
    episode,
    returnedLink: raw,
    streamUrl,
  });
  return streamUrl;
}

/* =====================================================
   SERIES SUPPORT
   Endpoints are ready for the next UI step:
   /api/series/categories
   /api/series/items
   /api/series/seasons
   /api/series/episodes
   /api/series/play
===================================================== */

async function getSeriesCategories() {
  const catalog = await activeCatalog();

  const response = await portalRequest(
    { type: "series", action: "get_categories" },
    catalog.session
  );

  const raw = response.data?.js;
  const rows = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.data)
      ? raw.data
      : Array.isArray(raw?.items)
        ? raw.items
        : Array.isArray(response.data)
          ? response.data
          : [];

  return rows
    .filter((row) => row.id != null && (row.title || row.name))
    .map((row) => ({
      id: String(row.id),
      title: String(row.title || row.name).trim(),
      locked: isAdult(row.title || row.name),
    }));
}

async function getSeriesItems(categoryId, page = 0) {
  const safePage = Math.max(0, Math.min(Number(page) || 0, 100));
  const key = `items:${categoryId}:${safePage}`;

  const cached = seriesCache.get(key);
  if (cached?.expiresAt > Date.now()) return cached.value;

  const catalog = await activeCatalog();

  const response = await portalRequest(
    {
      type: "series",
      action: "get_ordered_list",
      category: categoryId,
      p: safePage,
    },
    catalog.session
  );

  const js = response.data?.js || {};
  const rows = Array.isArray(js)
    ? js
    : Array.isArray(js.data)
      ? js.data
      : Array.isArray(response.data)
        ? response.data
        : [];

  let categoryLocked = false;
  let categoryTitle = "";
  try {
    const category = (await getSeriesCategories()).find((entry) => entry.id === String(categoryId));
    categoryLocked = Boolean(category?.locked);
    categoryTitle = String(category?.title || "").trim();
  } catch {}

  const items = rows
    .filter((row) =>
      (row.id ?? row.series_id ?? row.movie_id ?? row.stream_id) != null &&
      (row.name || row.title)
    )
    .map((row) => {
      const normalized = normalizeMediaItem(row, "series");
      return {
        ...normalized,
        categoryTitle: normalized.categoryTitle || categoryTitle,
        categoryLocked,
      };
    });

  const value = {
    items,
    total: Number(js.total_items) || Number(js.total) || items.length,
    page: safePage,
  };

  seriesCache.set(key, {
    value,
    expiresAt: Date.now() + 5 * 60_000,
  });

  return value;
}

function normalizeEpisode(raw, seasonNumber, index) {
  const source = raw && typeof raw === "object" ? raw : {};
  const id =
    source.episode_id ??
    source.video_id ??
    source.id ??
    source.series_id ??
    source.ch_id ??
    `${seasonNumber}-${index + 1}`;

  return {
    id: String(id),
    title: String(
      source.name ||
        source.title ||
        source.episode_name ||
        `Episode ${source.episode_num || index + 1}`
    ).trim(),
    description: String(source.description || source.plot || source.info || "").trim(),
    episode: Number(source.episode_num || source.episode || source.number || index + 1),
    season: Number(source.season || source.season_number || seasonNumber || 1),
    portalId: String(
      source._portalEpisodeId ??
      source.episode_id ??
      source.video_id ??
      source.id ??
      id
    ),
    seasonPortalId: String(
      source._portalSeasonId ??
      source.season_id ??
      source.season ??
      seasonNumber ??
      1
    ),
    cmd: firstNestedValue(source, ["cmd", "command", "playback_cmd", "url", "stream_url"]),
    raw: source,
  };
}

/*
  Stalker/Ministra portals do not agree on whether seasons and episodes are
  arrays or objects keyed by the season number. Normalize both shapes before
  the UI asks for seasons or episode rows.
*/
function seriesInfoCandidates(info, depth = 0, seen = new Set()) {
  if (!info || typeof info !== "object" || depth > 4 || seen.has(info)) return [];
  seen.add(info);

  const candidates = [info];
  /*
    Stalker builds wrap the same payload under different names.  In
    particular, mixed VOD portals commonly return `movie_data` or
    `series_data`, while some return a generic `payload` object.  Walk all
    of those wrappers so the UI can still discover seasons/episodes instead
    of incorrectly treating a show as a movie.
  */
  const wrapperKeys = [
    "data",
    "js",
    "info",
    "movie",
    "movie_data",
    "series",
    "series_data",
    "vod",
    "result",
    "details",
    "payload",
  ];

  for (const key of wrapperKeys) {
    const child = info[key];
    if (child && typeof child === "object") {
      candidates.push(...seriesInfoCandidates(child, depth + 1, seen));
    }
  }

  return candidates;
}

function seriesField(info, field) {
  const aliases = {
    seasons: ["seasons", "season", "season_list", "season_data"],
    episodes: ["episodes", "episode", "episode_list", "episode_data"],
  }[field] || [field];

  for (const candidate of seriesInfoCandidates(info)) {
    for (const alias of aliases) {
      if (candidate[alias] != null) return candidate[alias];
    }
  }

  return null;
}

function numberOrFallback(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function recordsFromSeasonObject(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];

  return Object.entries(value).map(([key, entry]) => {
    if (Array.isArray(entry)) {
      return { season: numberOrFallback(key, 1), episodes: entry };
    }

    if (entry && typeof entry === "object") {
      return {
        ...entry,
        season: entry.season ?? entry.number ?? numberOrFallback(key, 1),
      };
    }

    return { season: numberOrFallback(key, 1) };
  });
}

function recordsFromEpisodeObject(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];

  return Object.entries(value).flatMap(([key, entry]) => {
    const season = numberOrFallback(key, 1);
    const entries = Array.isArray(entry) ? entry : [entry];

    return entries
      .filter((episode) => episode && typeof episode === "object")
      .map((episode) => ({
        ...episode,
        season:
          episode.season ?? episode.season_number ?? episode.number ?? season,
      }));
  });
}

function rawSeriesSeasons(info) {
  const explicitSeasons = seriesField(info, "seasons");

  if (explicitSeasons != null) {
    return recordsFromSeasonObject(explicitSeasons);
  }

  for (const candidate of seriesInfoCandidates(info)) {
    for (const value of Object.values(candidate)) {
      if (!Array.isArray(value)) continue;
      if (value.some((entry) => entry?.episodes || entry?.series || entry?.season_number)) {
        return recordsFromSeasonObject(value);
      }
    }
  }

  return [];
}

function rawSeriesEpisodes(info) {
  const explicitEpisodes = seriesField(info, "episodes");

  if (explicitEpisodes != null) {
    return recordsFromEpisodeObject(explicitEpisodes);
  }

  for (const candidate of seriesInfoCandidates(info)) {
    for (const value of Object.values(candidate)) {
      if (!Array.isArray(value)) continue;
      if (value.some((entry) => entry?.episode_num || entry?.episode_id || entry?.episode || entry?.cmd)) {
        return recordsFromEpisodeObject(value);
      }
    }
  }

  return [];
}

function hasSeriesDetails(info) {
  return rawSeriesSeasons(info).length > 0 || rawSeriesEpisodes(info).length > 0;
}

async function getSeriesInfo(itemOrId) {
  const item = itemOrId && typeof itemOrId === "object" ? itemOrId : {};
  const mediaIds = uniqueMediaIds(itemOrId);
  const key = `info:${mediaIds.join(":")}:${item.categoryId || item.category_id || ""}`;

  const cached = seriesCache.get(key);
  if (cached?.expiresAt > Date.now()) return cached.value;

  const catalog = await activeCatalog();
  let js = {};

  /*
    Native MAG clients open shows through the VOD hierarchy, not through the
    often-empty `type=series` API.  At the title level the portal returns
    season rows; a small number of portals return episode rows immediately.
  */
  try {
    const hierarchy = await requestVodHierarchy(itemOrId, {
      seasonId: "0",
      episodeId: "0",
    });
    const rows = hierarchy.rows.filter((row) => row && typeof row === "object");
    const episodeRows = rows.filter(isEpisodeHierarchyRow);
    const seasonRows = rows.filter(
      (row) => isSeasonHierarchyRow(row) && !isEpisodeHierarchyRow(row)
    );

    if (episodeRows.length) {
      js = {
        episodes: episodeRows.map((row, index) => {
          const season = seasonNumberFromRow(row, 0);
          return {
            ...row,
            season,
            season_id: String(row.season_id ?? row.season ?? season),
            episode_num: episodeNumberFromRow(row, index),
            _portalSeasonId: String(row.season_id ?? row.season ?? season),
            _portalEpisodeId: String(
              row.episode_id ?? row.video_id ?? row.id ?? row.number ?? index + 1
            ),
          };
        }),
        _hierarchy: hierarchy,
      };
    } else if (seasonRows.length) {
      js = {
        seasons: seasonRows.map((row, index) => {
          const season = seasonNumberFromRow(row, index);
          return {
            ...row,
            season,
            _portalSeasonId: String(
              row.season_id ?? row.id ?? row.number ?? season
            ),
          };
        }),
        _hierarchy: hierarchy,
      };
    }
  } catch (error) {
    recordDiagnostic("series.vod_hierarchy_failed", {
      mediaIds,
      message: error.message,
    });
  }

  /*
    Mixed VOD portals are not consistent about the series endpoint.  Try
    the common variants in order and keep the first response that contains
    seasons or episodes.  This is deliberately server-side so the browser
    never needs to know which Stalker dialect the portal uses.
  */
  const requests = mediaIds.flatMap((seriesId) => [
    {
      type: "series",
      action: "get_ordered_list",
      movie_id: seriesId,
      series_id: seriesId,
      p: 0,
    },
    {
      type: "series",
      action: "get_series_info",
      series_id: seriesId,
      movie_id: seriesId,
    },
    {
      type: "vod",
      action: "get_vod_info",
      movie_id: seriesId,
      vod_id: seriesId,
      series_id: seriesId,
    },
  ]);

  for (const request of hasSeriesDetails(js) ? [] : requests) {
    try {
      const response = await portalRequest(request, catalog.session);
      const jsValue = response.data?.js;
      const candidate =
        jsValue && typeof jsValue === "object"
          ? jsValue
          : response.data && typeof response.data === "object"
            ? response.data
            : {};
      if (!Object.keys(js || {}).length || hasSeriesDetails(candidate)) {
        js = candidate;
      }
      if (hasSeriesDetails(candidate)) break;
    } catch {
      /* Try the next supported Stalker dialect. */
    }
  }

  seriesCache.set(key, {
    value: js,
    expiresAt: Date.now() + 5 * 60_000,
  });

  recordDiagnostic("series.info_normalized", {
    mediaIds,
    seasonCount: extractSeasons(js).length,
    episodeCounts: extractSeasons(js).map((season) => ({
      season: season.number,
      episodes: extractEpisodes(js, season.number).length,
    })),
    info: js,
  });

  return js;
}

async function getSeriesSeasonInfo(itemOrId, seasonNumber) {
  const safeSeason = numberOrFallback(seasonNumber, 1);
  const baseInfo = await getSeriesInfo(itemOrId);
  if (extractEpisodes(baseInfo, safeSeason).length) return baseInfo;

  const item = itemOrId && typeof itemOrId === "object" ? itemOrId : {};
  const mediaIds = uniqueMediaIds(itemOrId);
  const season = extractSeasons(baseInfo).find(
    (entry) => Number(entry.number) === safeSeason
  );
  const seasonIds = [...new Set(
    [season?.portalId, season?.id, safeSeason]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean)
  )];
  let episodes = [];
  let usedHierarchy = null;

  const normalizeRows = (rows, seasonId) => rows
    .filter((row) => row && typeof row === "object")
    .filter((row) => {
      if (isEpisodeHierarchyRow(row)) return true;
      if (isSeasonHierarchyRow(row)) return false;

      const rowId = String(
        row.episode_id ?? row.video_id ?? row.id ?? row.ch_id ?? ""
      ).trim();
      const hasEpisodeShape = Boolean(
        rowId &&
        hierarchyTitle(row) &&
        (firstNestedValue(row, QUALITY_COMMAND_KEYS) || row.episode_id != null)
      );
      return hasEpisodeShape && !mediaIds.includes(rowId);
    })
    .map((row, index) => ({
      ...row,
      season: safeSeason,
      season_id: String(seasonId),
      episode_num: episodeNumberFromRow(row, index),
      _portalSeasonId: String(seasonId),
      _portalEpisodeId: String(
        row.episode_id ?? row.video_id ?? row.id ?? row.ch_id ?? row.number ?? index + 1
      ),
    }));

  for (const seasonId of seasonIds) {
    const hierarchy = await requestVodHierarchy(itemOrId, {
      seasonId,
      episodeId: "0",
    });
    episodes = normalizeRows(hierarchy.rows, seasonId);
    if (episodes.length) {
      usedHierarchy = hierarchy;
      break;
    }

    /* Some middleware promotes the season row to movie_id for step two. */
    const seasonHierarchy = await requestVodHierarchy(
      {
        ...item,
        id: seasonId,
        movieId: seasonId,
        videoId: seasonId,
      },
      { seasonId: "0", episodeId: "0" }
    );
    episodes = normalizeRows(seasonHierarchy.rows, seasonId);
    if (episodes.length) {
      usedHierarchy = seasonHierarchy;
      break;
    }
  }

  const value = episodes.length
    ? { ...baseInfo, episodes, _seasonHierarchy: usedHierarchy }
    : baseInfo;

  recordDiagnostic("series.season_normalized", {
    mediaIds,
    season: safeSeason,
    portalSeasonId: season?.portalId || season?.id || "",
    episodeCount: episodes.length,
    episodes,
  });

  return value;
}

function extractSeasons(info) {
  const rawSeasons = rawSeriesSeasons(info);

  if (rawSeasons.length) {
    return rawSeasons.map((season, index) => {
      const number = numberOrFallback(
        season.season ?? season.number ?? season.season_number,
        index + 1
      );
      const portalId = String(
        season._portalSeasonId ?? season.season_id ?? season.id ?? season.number ?? number
      );
      return {
        id: String(season.id ?? season.season_id ?? season.season ?? season.number ?? number),
        portalId,
        number,
        title: String(
          season.name ||
          season.title ||
          `Season ${number}`
        ),
      };
    });
  }

  const rawEpisodes = rawSeriesEpisodes(info);

  const numbers = new Set();

  rawEpisodes.forEach((episode) => {
    numbers.add(Number(episode.season || 1));
  });

  return [...numbers]
    .sort((a, b) => a - b)
    .map((number) => ({
      id: String(number),
      portalId: String(number),
      number,
      title: `Season ${number}`,
    }));
}

function extractEpisodes(info, seasonNumber) {
  const rawEpisodes = rawSeriesEpisodes(info);

  if (rawEpisodes.length) {
    return rawEpisodes
      .filter(
        (episode) =>
          numberOrFallback(
            episode.season ?? episode.season_number,
            Number(seasonNumber) || 1
          ) === Number(seasonNumber)
      )
      .map((episode, index) =>
        normalizeEpisode(episode, seasonNumber, index)
      );
  }

  const rawSeasons = rawSeriesSeasons(info);

  const season = rawSeasons.find(
    (entry, index) =>
      numberOrFallback(
        entry.season ?? entry.number ?? entry.season_number,
        index + 1
      ) === Number(seasonNumber)
  );

  const episodes =
    season?.episodes ||
    season?.series ||
    season?.data ||
    season?.items ||
    [];

  if (Array.isArray(episodes)) {
    return episodes.map((episode, index) =>
      normalizeEpisode(episode, seasonNumber, index)
    );
  }

  return recordsFromEpisodeObject(episodes).map((episode, index) =>
    normalizeEpisode(episode, seasonNumber, index)
  );
}

async function getSeriesEpisodeStream(seriesId, seasonNumber, episodeId) {
  const info = await getSeriesInfo(seriesId);
  const episodes = extractEpisodes(info, seasonNumber);

  const episode =
    episodes.find((entry) => entry.id === String(episodeId)) ||
    episodes.find((entry) => String(entry.episode) === String(episodeId));

  if (!episode) {
    recordDiagnostic("series.episode_missing", {
      seriesId,
      seasonNumber,
      episodeId,
      availableEpisodes: episodes,
    });
    throw new PlayerError("Episode is no longer available.", 404);
  }

  if (!episode.cmd) {
    recordDiagnostic("series.episode_command_missing", {
      seriesId,
      seasonNumber,
      episodeId,
      episode,
    });
    throw new PlayerError("Portal did not provide an episode playback command.");
  }

  const command = await resolveVodCreateCommand(episode.cmd, {
    id: String(seriesId),
    movieId: String(seriesId),
    videoId: String(seriesId),
  }, {
    seasonId: String(seasonNumber),
    episodeId: String(episode.portalId || episode.id || episodeId),
  });

  const catalog = await activeCatalog();

  const response = await portalRequest(
    {
      type: "series",
      action: "create_link",
      cmd: episode.cmd,
      series: "1",
      forced_storage: "undefined",
      disable_ad: "0",
      download: "0",
    },
    catalog.session
  );

  const raw =
    typeof response.data?.js === "string"
      ? response.data.js
      : response.data?.js?.cmd || "";
  const streamUrl = parsePortalStream(raw);

  recordDiagnostic("series.playback_link", {
    seriesId,
    seasonNumber,
    episodeId,
    episode,
    returnedLink: raw,
    streamUrl,
  });

  return streamUrl;
}

/* =====================================================
   RELAY
===================================================== */

function deleteRelayTarget(ticket) {
  const target = relayTargets.get(ticket);

  if (target?.key && relayTicketsByKey.get(target.key) === ticket) {
    relayTicketsByKey.delete(target.key);
  }

  relayTargets.delete(ticket);
}

function pruneExpiredRelayTargets(now = Date.now()) {
  for (const [ticket, target] of relayTargets) {
    if (target.expiresAt < now) deleteRelayTarget(ticket);
  }
}

/*
  HLS identifies a segment using its URI and media sequence number. The old
  relay generated a new random local URI on every playlist refresh, so HLS
  rejected the same sequence as changed content (levelParsingError). Only
  children inside an HLS manifest use stable tickets. A newly selected channel
  still gets a fresh root ticket and never reuses an old create_link session.
*/
function createRelayTarget(
  url,
  lifetimeMs = 2 * 60 * 60_000,
  context = "unknown",
  stable = false,
  credentials = null
) {
  if (typeof lifetimeMs === "string") {
    context = lifetimeMs;
    lifetimeMs = 2 * 60 * 60_000;
  }

  const now = Date.now();
  pruneExpiredRelayTargets(now);
  const key = stable ? `${context}\u0000${url}` : null;

  if (key) {
    const existingTicket = relayTicketsByKey.get(key);
    const existingTarget = existingTicket
      ? relayTargets.get(existingTicket)
      : null;

    if (existingTarget && existingTarget.expiresAt > now) {
      return `/stream/${existingTicket}`;
    }

    if (existingTicket) deleteRelayTarget(existingTicket);
  }

  const ticket = randomBytes(18).toString("base64url");

  relayTargets.set(ticket, {
    url,
    expiresAt: now + lifetimeMs,
    context,
    key,
    /* Shared per-playback jar: manifest and segment tickets must see cookies
       learned during an earlier redirect/request in the same playback. */
    credentials: credentials || null,
  });

  if (key) relayTicketsByKey.set(key, ticket);

  return `/stream/${ticket}`;
}

function relayCredentials(session) {
  if (!session) return null;

  return {
    cookie: session.cookie || "",
    authorization: session.token ? `Bearer ${session.token}` : "",
  };
}

function createStreamRelayTarget(url, context, session) {
  return createRelayTarget(
    url,
    2 * 60 * 60_000,
    context,
    false,
    relayCredentials(session)
  );
}

function findVlcExecutable() {
  const candidates = [
    process.env.VLC_PATH,
    process.platform === "win32" && process.env.ProgramFiles
      ? path.join(process.env.ProgramFiles, "VideoLAN", "VLC", "vlc.exe")
      : "",
    process.platform === "win32" && process.env["ProgramFiles(x86)"]
      ? path.join(process.env["ProgramFiles(x86)"], "VideoLAN", "VLC", "vlc.exe")
      : "",
    process.platform === "win32" && process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "Programs", "VideoLAN", "VLC", "vlc.exe")
      : "",
    process.platform === "darwin" ? "/Applications/VLC.app/Contents/MacOS/VLC" : "",
    process.platform !== "win32" && process.platform !== "darwin" ? "/usr/bin/vlc" : "",
    process.platform !== "win32" && process.platform !== "darwin" ? "/usr/local/bin/vlc" : "",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  const lookupCommand = process.platform === "win32" ? "where.exe" : "which";
  try {
    const result = spawnSync(lookupCommand, ["vlc"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 3_000,
    });
    const found = String(result.stdout || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (found) return found;
  } catch {}

  return "";
}

function launchVlc(stream, title) {
  let streamUrl;
  try {
    streamUrl = new URL(String(stream || ""), `http://${HOST}:${PORT}`);
  } catch {
    throw new PlayerError("The stream link is not valid for VLC.", 400);
  }

  if (
    streamUrl.origin !== `http://${HOST}:${PORT}` ||
    !streamUrl.pathname.startsWith("/stream/")
  ) {
    throw new PlayerError("Only an active STB PLAY stream can be opened in VLC.", 400);
  }

  const ticket = streamUrl.pathname.slice("/stream/".length);
  const target = relayTargets.get(ticket);
  if (!target || target.expiresAt < Date.now()) {
    deleteRelayTarget(ticket);
    throw new PlayerError("The stream link expired. Start the channel again.", 410);
  }

  const executable = findVlcExecutable();
  if (!executable) {
    throw new PlayerError("VLC is not installed. Install VLC, then try Play in VLC again.", 404);
  }

  try {
    const child = spawn(executable, [streamUrl.toString()], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
  } catch {
    throw new PlayerError("VLC could not be started on this computer.", 502);
  }

  recordDiagnostic("external_player.launch", {
    player: "VLC",
    context: target.context,
    title: String(title || "STB PLAY").slice(0, 160),
  });
  return { player: "VLC" };
}

function rewriteUriAttributes(line, baseUrl, context, credentials) {
  return line.replace(/URI="([^"]+)"/g, (_match, uri) => {
    return `URI="${createRelayTarget(
      new URL(uri, baseUrl).toString(),
      2 * 60 * 60_000,
      `${context}:manifest-uri`,
      true,
      credentials
    )}"`;
  });
}

function removeUnsupportedVariants(manifest) {
  const lines = String(manifest || "").split(/\r?\n/);
  const output = [];
  let removed = 0;
  let skipVariantUri = false;
  const unsupported = /\b(?:hev1|hvc1|av01|vp09)\b|(?:^|[,\"])(?:ac-3|ec-3)(?:$|[,\"])/i;

  for (const line of lines) {
    if (skipVariantUri) {
      if (line.trim() && !line.trim().startsWith("#")) {
        skipVariantUri = false;
        continue;
      }
      skipVariantUri = false;
    }

    if (/^\s*#EXT-X-STREAM-INF:/i.test(line) && unsupported.test(line)) {
      removed += 1;
      skipVariantUri = true;
      continue;
    }
    output.push(line);
  }

  return {
    body: output.join("\n"),
    removed,
    allUnsupported: removed > 0 && !output.some((line) => /^\s*#EXT-X-STREAM-INF:/i.test(line)),
  };
}

function rewriteManifest(manifest, baseUrl, context, credentials) {
  return manifest
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();

      if (!trimmed) return line;
      if (trimmed.startsWith("#")) {
        return rewriteUriAttributes(line, baseUrl, context, credentials);
      }

      return createRelayTarget(
        new URL(trimmed, baseUrl).toString(),
        2 * 60 * 60_000,
        `${context}:segment`,
        true,
        credentials
      );
    })
    .join("\n");
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);

  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });

  res.end(body);
}

function text(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });

  res.end(body);
}

function downloadDiagnosticReport(res) {
  const body = `${JSON.stringify(diagnosticReport, null, 2)}\n`;

  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Content-Disposition": "attachment; filename=netplus-diagnostics-v1.8.16.json",
    "Cache-Control": "no-store, no-cache, must-revalidate",
  });

  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let failed = false;

    req.on("data", (chunk) => {
      if (failed) return;

      body += chunk;

      if (body.length > 64 * 1024) {
        failed = true;
        reject(new PlayerError("Request too large.", 413));
        req.destroy();
      }
    });

    req.on("end", () => {
      if (failed) return;

      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new PlayerError("Invalid request.", 400));
      }
    });

    req.on("error", reject);
  });
}

function serveFile(res, filename, contentType) {
  try {
    const data = fs.readFileSync(path.join(ROOT, filename));

    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": data.length,

      /*
        v1.4: disable cache for app files while testing.
        This prevents Windows/browser from silently running old JS/CSS.
      */
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
      "X-Content-Type-Options": "nosniff",
    });

    res.end(data);
  } catch {
    text(res, 404, "Not found.");
  }
}

function isPrivatePosterHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host === "localhost" || host === "::1" || host === "[::1]" ||
    /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
}

async function relayPoster(res, rawUrl) {
  let target;
  try { target = new URL(String(rawUrl || "")); } catch { return text(res, 400, "Invalid poster URL."); }
  if (!/^https?:$/.test(target.protocol) || target.username || target.password || isPrivatePosterHost(target.hostname)) {
    return text(res, 400, "Invalid poster URL.");
  }

  const session = (await activeCatalog()).session;
  const response = await fetch(target, {
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
    headers: {
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      Cookie: session?.cookie || "",
      "User-Agent": MAG_USER_AGENT,
    },
  });
  const type = response.headers.get("content-type") || "";
  if (!response.ok || !/^image\//i.test(type)) return text(res, response.status || 502, "Poster unavailable.");
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length > 12 * 1024 * 1024) return text(res, 413, "Poster is too large.");
  res.writeHead(200, { "Content-Type": type, "Content-Length": body.length, "Cache-Control": "public, max-age=86400" });
  return res.end(body);
}

function isLikelyHls(url, contentType = "") {
  return (
    String(contentType).toLowerCase().includes("mpegurl") ||
    /\.m3u8(?:$|\?)/i.test(String(url))
  );
}

/* Relay URLs hide the provider's original extension. Unknown HTTP streams
   should be tried through HLS.js first; explicit progressive files stay native. */
function shouldTryHlsFirst(url) {
  return !/\.(?:mp4|m4v|webm|ogv|ogg|mp3|aac|wav)(?:$|\?)/i.test(
    String(url || "")
  );
}

function isValidHlsManifest(body) {
  return String(body || "")
    .replace(/^\uFEFF/, "")
    .trimStart()
    .startsWith("#EXTM3U");
}

function normalizeSubtitleBody(body) {
  const raw = String(body || "").replace(/^\uFEFF/, "").trim();
  if (!raw || /<(?:!doctype|html|head|body)\b/i.test(raw.slice(0, 512))) return "";
  if (/^WEBVTT(?:\s|$)/i.test(raw)) return `${raw}\n`;
  if (!/\d{1,2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,.]\d{3}/.test(raw)) return "";
  return `WEBVTT\n\n${raw.replace(/(\d{1,2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2")}\n`;
}

async function fetchRelayUpstream(target, headers) {
  let currentUrl = target.url;
  const requestHeaders = { ...headers };
  const redirects = [];

  /*
    The working STBEmu capture is decisive here: VOD media requests are made
    directly to the provider's dynamic host and custom port with only the
    native FFmpeg identity (Lavf53.32.100).  The portal MAC/Bearer/cookie
    session is used to obtain create_link, but is not attached to the VOD CDN
    requests.  Some CDN nodes reject those extra portal headers with 403.
  */
  const isVodMedia = /^(?:vod|series)(?::|$)/i.test(String(target.context || ""));
  if (isVodMedia) {
    delete requestHeaders.Cookie;
    delete requestHeaders.Authorization;
    delete requestHeaders["X-User-Agent"];
    delete requestHeaders.Referer;
    delete requestHeaders.Origin;
  }

  for (let redirectCount = 0; redirectCount <= 6; redirectCount += 1) {
    /* STBEmu asks FFmpeg for compressed playlists and identity-encoded TS
       segments. Preserve the provider's custom host and port exactly. */
    if (isVodMedia) {
      requestHeaders["Accept-Encoding"] = /\.m3u8(?:$|\?)/i.test(currentUrl)
        ? "gzip"
        : "identity";
    }

    const timeoutMs = /:segment$/i.test(String(target.context || ""))
      ? 20_000
      : 45_000;
    const response = await fetch(currentUrl, {
      headers: requestHeaders,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });

    /* Native fetch/undici has no persistent cookie jar. Capture cookies from
       every CDN hop and send them on the next hop and later HLS requests. */
    const responseCookies = isVodMedia
      ? []
      : extractSetCookiePairs(response.headers);
    if (responseCookies.length) {
      target.credentials ||= {};
      target.credentials.cookie = mergeCookieHeader(
        target.credentials.cookie,
        responseCookies
      );
      requestHeaders.Cookie = target.credentials.cookie;
    }

    const location = response.headers.get("location");
    const isRedirect = response.status >= 300 && response.status < 400;

    if (!isRedirect || !location) {
      return { response, finalUrl: currentUrl, redirects };
    }

    const nextUrl = new URL(location, currentUrl).toString();
    redirects.push({
      from: currentUrl,
      to: nextUrl,
      status: response.status,
    });

    /* Authorization is origin-bound. Cookies learned from the redirect are
       retained, while the portal Bearer token is not sent to a new CDN host. */
    try {
      if (new URL(nextUrl).origin !== new URL(currentUrl).origin) {
        delete requestHeaders.Authorization;
      }
    } catch {}

    try { await response.body?.cancel(); } catch {}
    currentUrl = nextUrl;
  }

  throw new PlayerError("The stream provider returned too many redirects.", 502);
}

async function relay(req, res, ticket) {
  const target = relayTargets.get(ticket);

  if (!target || target.expiresAt < Date.now()) {
    deleteRelayTarget(ticket);
    return text(res, 401, "Stream link expired. Select the channel again.");
  }

  const headers = {
    Accept: "*/*",
    "User-Agent": MEDIA_USER_AGENT,
    "X-User-Agent": X_USER_AGENT,
  };

  /* The portal API session is also needed by many CDN stream links. */
  if (target.credentials?.cookie) {
    headers.Cookie = target.credentials.cookie;
  }

  if (target.credentials?.authorization) {
    headers.Authorization = target.credentials.authorization;
  }

  if (req.headers.range) {
    headers.Range = req.headers.range;
  }

  let upstream;
  let finalUrl = target.url;
  let redirects = [];
  const startedAt = Date.now();

  try {
    const result = await fetchRelayUpstream(target, headers);
    upstream = result.response;
    finalUrl = result.finalUrl;
    redirects = result.redirects;
  } catch (error) {
    const errorStatus = error instanceof PlayerError ? error.status : 504;
    recordDiagnostic("relay.upstream_error", {
      context: target.context,
      url: target.url,
      redirects,
      elapsedMs: Date.now() - startedAt,
      status: errorStatus,
      message: error?.message || "upstream request failed",
    });
    return text(
      res,
      errorStatus,
      errorStatus === 504 ? "Stream server timed out." : error.message
    );
  }

  if (!upstream.ok && upstream.status !== 206) {
    recordDiagnostic("relay.http_error", {
      context: target.context,
      url: finalUrl || upstream.url || target.url,
      redirects,
      status: upstream.status,
      elapsedMs: Date.now() - startedAt,
      contentType: upstream.headers.get("content-type") || "",
    });
    return text(
      res,
      upstream.status,
      `Stream server returned ${upstream.status}.`
    );
  }

  const contentType = upstream.headers.get("content-type") || "";
  const isSubtitle = /^subtitle(?::|$)/i.test(String(target.context || ""));
  if (isSubtitle) {
    const contentLength = Number(upstream.headers.get("content-length") || 0);
    if (contentLength > 2 * 1024 * 1024) return text(res, 413, "Subtitle file is too large.");
    const subtitleBody = normalizeSubtitleBody(await upstream.text());
    if (!subtitleBody) {
      recordDiagnostic("relay.invalid_subtitle", {
        context: target.context,
        url: finalUrl || upstream.url || target.url,
        status: upstream.status,
        contentType,
      });
      return text(res, 502, "The subtitle file is unavailable or invalid.");
    }
    return text(res, 200, subtitleBody, "text/vtt; charset=utf-8");
  }

  const isManifest =
    isLikelyHls(target.url, contentType) ||
    isLikelyHls(finalUrl || upstream.url, contentType);

  recordDiagnostic("relay.response", {
    context: target.context,
    url: finalUrl || upstream.url || target.url,
    redirects,
    status: upstream.status,
    elapsedMs: Date.now() - startedAt,
    contentType,
    contentLength: upstream.headers.get("content-length") || "",
    isManifest,
    ranged: Boolean(req.headers.range),
  });

  if (isManifest) {
    const upstreamBody = await upstream.text();

    /*
      Some expired provider links redirect to a SafeBrowse/login HTML page
      with HTTP 200. Passing that page to HLS.js causes a misleading
      "no EXTM3U delimiter" parsing error. Detect it at the relay boundary so
      Live TV can request a fresh create_link immediately.
    */
    if (!isValidHlsManifest(upstreamBody)) {
      recordDiagnostic("relay.invalid_manifest", {
        context: target.context,
        requestedUrl: target.url,
        returnedUrl: finalUrl || upstream.url || target.url,
        status: upstream.status,
        contentType,
        contentLength: upstream.headers.get("content-length") || "",
        redirected: Boolean(upstream.redirected),
        looksLikeHtml: /<(?:!doctype|html|head|body)\b/i.test(upstreamBody.slice(0, 512)),
      });
      return text(
        res,
        502,
        "The stream provider returned a web page instead of an HLS playlist. A fresh link is required."
      );
    }

    /* The browser needs incompatible variants removed, but VLC is the
       intentional fallback for those exact channels. Let VLC receive the
       original playlist so it can decode HEVC/AC-3 when installed. */
    const isVlcClient = /\bVLC\//i.test(String(req.headers["user-agent"] || ""));
    const compatible = isVlcClient
      ? { body: upstreamBody, removed: 0, allUnsupported: false }
      : removeUnsupportedVariants(upstreamBody);
    if (compatible.removed) {
      recordDiagnostic("relay.filtered_unsupported_variants", {
        context: target.context,
        removed: compatible.removed,
        allUnsupported: compatible.allUnsupported,
      });
      if (compatible.allUnsupported) {
        return text(res, 415, "This channel uses an unsupported video or audio codec.");
      }
    }

    const body = rewriteManifest(
      compatible.body,
      finalUrl,
      target.context,
      target.credentials
    );

    return text(
      res,
      200,
      body,
      "application/vnd.apple.mpegurl; charset=utf-8"
    );
  }

  const responseHeaders = {
    "Content-Type": contentType || "application/octet-stream",
    "Cache-Control": "no-store",
  };

  for (const header of [
    "accept-ranges",
    "content-range",
    "content-length",
    "content-disposition",
  ]) {
    const value = upstream.headers.get(header);
    if (value) responseHeaders[header] = value;
  }

  res.writeHead(upstream.status, responseHeaders);

  if (!upstream.body) {
    return res.end();
  }

  const readable = Readable.fromWeb(upstream.body);

  req.on("close", () => {
    try {
      readable.destroy();
    } catch {}
  });

  readable.on("error", () => {
    recordDiagnostic("relay.body_error", {
      context: target.context,
      url: finalUrl || upstream.url || target.url,
      elapsedMs: Date.now() - startedAt,
    });
    if (!res.destroyed) res.destroy();
  });

  readable.on("end", () => {
    recordDiagnostic("relay.complete", {
      context: target.context,
      url: finalUrl || upstream.url || target.url,
      elapsedMs: Date.now() - startedAt,
    });
  });

  readable.pipe(res);
}

/* =====================================================
   ROUTES
===================================================== */

async function handle(req, res) {
  const requestUrl = new URL(req.url, `http://${HOST}:${PORT}`);

  if (req.method === "GET" && requestUrl.pathname === "/") {
    return serveFile(res, "index.html", "text/html; charset=utf-8");
  }

  if (req.method === "GET" && requestUrl.pathname === "/styles.css") {
    return serveFile(res, "styles.css", "text/css; charset=utf-8");
  }

  if (req.method === "GET" && requestUrl.pathname === "/app.js") {
    return serveFile(res, "app.js", "text/javascript; charset=utf-8");
  }

  if (req.method === "GET" && requestUrl.pathname === "/hls.min.js") {
    return serveFile(res, "hls.min.js", "text/javascript; charset=utf-8");
  }

  const staticAssets = {
    "/assets/stb-play-logo.png": "image/png",
    "/assets/stb-play-logo.svg": "image/svg+xml; charset=utf-8",
  };
  if (req.method === "GET" && staticAssets[requestUrl.pathname]) {
    return serveFile(
      res,
      requestUrl.pathname.slice(1),
      staticAssets[requestUrl.pathname]
    );
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/config") {
    let configured = false;
    let parentalConfigured = false;
    let serviceId = null;
    let mac = "";

    try {
      configured = Boolean(readConfig());
      const stored = readStoredConfig();
      parentalConfigured = Boolean(stored.parentalPinHash);
      serviceId = stored.serviceId || null;
      mac = stored.mac || "";
    } catch {
      configured = false;
    }

    return json(res, 200, {
      configured,
      parentalConfigured,
      recoveryConfigured: Boolean(readStoredConfig().recoveryCodeHash),
      serviceId,
      mac,
      services: Object.entries(SERVICES).map(([id, service]) => ({
        id,
        name: service.name,
      })),
      ...listPortalProfiles(),
    });
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/portals") {
    return json(res, 200, { ...listPortalProfiles(), subscription: catalogCache?.publicCatalog?.subscription || null });
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/subscription") {
    try {
      const catalog = await activeCatalog();
      return json(res, 200, { subscription: catalog.publicCatalog.subscription || null });
    } catch (error) {
      return json(res, error.status || 500, { error: error.message || "Subscription is unavailable." });
    }
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/portals") {
    const body = await readJson(req);
    const result = savePortalProfile(body, body.parentalPin);
    return json(res, 200, { ok: true, portal: result.portal, recoveryCode: result.recoveryCode, ...listPortalProfiles() });
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/portals/activate") {
    const body = await readJson(req);
    activatePortal(String(body.id || ""));
    return json(res, 200, { ok: true, ...listPortalProfiles() });
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/parental/pin") {
    const body = await readJson(req);
    const recoveryCode = saveParentalPin(body.pin);
    return json(res, 200, { ok: true, recoveryCode });
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/parental/update") {
    const body = await readJson(req);
    const recoveryCode = updateParentalPin(body.currentPin, body.newPin);
    return json(res, 200, { ok: true, recoveryCode });
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/parental/recovery") {
    const body = await readJson(req);
    return json(res, 200, { ok: true, recoveryCode: regenerateRecoveryCode(body.currentPin) });
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/parental/reset") {
    const body = await readJson(req);
    return json(res, 200, { ok: true, recoveryCode: resetParentalPinWithRecovery(body.recoveryCode, body.newPin) });
  }

  if (req.method === "DELETE" && requestUrl.pathname.startsWith("/api/portals/")) {
    deletePortal(decodeURIComponent(requestUrl.pathname.slice("/api/portals/".length)));
    return json(res, 200, { ok: true, ...listPortalProfiles() });
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/config") {
    const body = await readJson(req);
    saveConfig(body.serviceId, body.mac, body.parentalPin);
    return json(res, 200, { ok: true });
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/diagnostics/reset") {
    resetDiagnostics();
    return json(res, 200, { ok: true, startedAt: diagnosticReport.startedAt });
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/diagnostics/event") {
    const body = await readJson(req);
    const event = String(body.event || "client.event").slice(0, 80);
    recordDiagnostic(event, body.details || {});
    return json(res, 200, { ok: true });
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/diagnostics/download") {
    return downloadDiagnosticReport(res);
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/analytics/event") {
    const body = await readJson(req);
    return json(res, 202, { ok: true, ...queueAnalyticsPayload(body) });
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/analytics/clear") {
    return json(res, 200, { ok: true, ...clearAnalyticsQueue() });
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/analytics/status") {
    return json(res, 200, {
      enabled: Boolean(ANALYTICS_ENDPOINT),
      pending: loadAnalyticsQueue().length,
    });
  }

  if (
    req.method === "POST" &&
    requestUrl.pathname === "/api/parental/verify"
  ) {
    const body = await readJson(req);
    const stored = readStoredConfig();
    const suppliedPin = String(body.pin || "").trim();

    const valid = matchesHash(suppliedPin, stored.parentalPinHash, pinHash);

    return json(
      res,
      valid ? 200 : 401,
      valid ? { ok: true } : { error: "Incorrect parental PIN." }
    );
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/catalog") {
    return json(res, 200, (await activeCatalog()).publicCatalog);
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/live/category") {
    const categoryId = requestUrl.searchParams.get("categoryId");
    return json(res, 200, { channels: await loadLiveCategoryChannels(categoryId) });
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/update-policy") {
    try {
      return json(res, 200, await fetchUpdatePolicy());
    } catch (error) {
      return json(res, error.status || 503, { error: "Could not verify the current Windows version." });
    }
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/refresh") {
    invalidateContentCaches();
    return json(res, 200, { ok: true, refreshedAt: new Date().toISOString() });
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/poster") {
    return relayPoster(res, requestUrl.searchParams.get("url"));
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/vod/search") {
    return json(res, 200, await searchVodCatalog(requestUrl.searchParams.get("q")));
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/vod/index") {
    return json(
      res,
      200,
      await getVodIndexSnapshot(requestUrl.searchParams.get("after"))
    );
  }

  if (
    req.method === "GET" &&
    requestUrl.pathname === "/api/vod/categories"
  ) {
    return json(res, 200, {
      categories: await getVodCategories(),
    });
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/vod/shelves") {
    return json(res, 200, await getVodShelves());
  }

  function clientVodFallback() {
    const encoded = requestUrl.searchParams.get("fallback");
    if (!encoded) return null;
    try {
      const value = JSON.parse(encoded);
      return value && typeof value === "object" ? value : null;
    } catch {
      return null;
    }
  }

  if (
    req.method === "GET" &&
    requestUrl.pathname === "/api/vod/items"
  ) {
    const categoryId = requestUrl.searchParams.get("categoryId");

    if (!categoryId) {
      throw new PlayerError("Choose a VOD category.", 400);
    }

    return json(
      res,
      200,
      await getVodItems(
        categoryId,
        requestUrl.searchParams.get("page"),
        requestUrl.searchParams.get("q") || ""
      )
    );
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/vod/item") {
    const categoryId = requestUrl.searchParams.get("categoryId");
    const itemId = requestUrl.searchParams.get("itemId");

    if (!categoryId || !itemId) {
      throw new PlayerError("Choose a valid movie or series.", 400);
    }

    return json(res, 200, await getCombinedVodDetail(categoryId, itemId, clientVodFallback()));
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/vod/subtitles") {
    const body = await readJson(req);
    const categoryId = String(body.categoryId || "").trim();
    const itemId = String(body.itemId || "").trim();
    const language = String(body.language || "auto").trim().toLowerCase();
    if (!categoryId || !itemId || !["off", "auto", "en", "pa", "hi"].includes(language)) {
      throw new PlayerError("Choose a valid subtitle request.", 400);
    }
    if (language === "off") return json(res, 200, { tracks: [], message: "Subtitles are off." });

    return json(
      res,
      200,
      await getVodSubtitles(
        categoryId,
        itemId,
        body.clientItem,
        language,
        String(body.title || "").slice(0, 160),
        String(body.year || "").slice(0, 4)
      )
    );
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/vod/seasons") {
    const categoryId = requestUrl.searchParams.get("categoryId");
    const itemId = requestUrl.searchParams.get("itemId");

    if (!categoryId || !itemId) {
      throw new PlayerError("Choose a valid series.", 400);
    }

    const detail = await getCombinedVodDetail(categoryId, itemId, clientVodFallback());
    return json(res, 200, { seasons: detail.seasons });
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/vod/episodes") {
    const categoryId = requestUrl.searchParams.get("categoryId");
    const itemId = requestUrl.searchParams.get("itemId");
    const season = requestUrl.searchParams.get("season");

    if (!categoryId || !itemId || !season) {
      throw new PlayerError("Choose a series and season.", 400);
    }

    return json(
      res,
      200,
      await getCombinedVodEpisodes(categoryId, itemId, Number(season))
    );
  }

  /*
    Quality is selected before a stream is created.  The portal command is
    kept server-side behind a short-lived opaque token, so the renderer never
    needs to expose a raw Stalker command or stream URL.
  */
  if (req.method === "GET" && requestUrl.pathname === "/api/vod/options") {
    const categoryId = requestUrl.searchParams.get("categoryId");
    const itemId = requestUrl.searchParams.get("itemId");

    if (!categoryId || !itemId) {
      throw new PlayerError("Choose a valid movie.", 400);
    }

    return json(res, 200, await getVodQualityOptions(categoryId, itemId, clientVodFallback()));
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/vod/episode/options") {
    const categoryId = requestUrl.searchParams.get("categoryId");
    const itemId = requestUrl.searchParams.get("itemId");
    const season = requestUrl.searchParams.get("season");
    const episodeId = requestUrl.searchParams.get("episodeId");

    if (!categoryId || !itemId || !season || !episodeId) {
      throw new PlayerError("Choose a valid episode.", 400);
    }

    return json(
      res,
      200,
      await getVodEpisodeQualityOptions(
        categoryId,
        itemId,
        Number(season),
        String(episodeId),
        clientVodFallback()
      )
    );
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/play-vlc") {
    const body = await readJson(req);
    return json(res, 200, launchVlc(body.stream, body.title));
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/play") {
    const body = await readJson(req);

    if (typeof body.channelId !== "string") {
      throw new PlayerError("Choose a valid channel.", 400);
    }

    /*
      Always request a fresh portal create_link on each recovery.
      app.js v1.5.5 calls this again immediately when a short-lived IPTV URL
      returns 401/403/410/502 or stops returning a valid HLS manifest.
    */
    const streamUrl = await getStreamUrl(body.channelId);
    const session = (await activeCatalog()).session;

    return json(res, 200, {
      stream: createStreamRelayTarget(streamUrl, "live", session),
      hls: shouldTryHlsFirst(streamUrl),
      mediaType: shouldTryHlsFirst(streamUrl) ? "hls-or-auto" : "progressive",
    });
  }

  if (
    req.method === "POST" &&
    requestUrl.pathname === "/api/vod/play"
  ) {
    const body = await readJson(req);

    if (
      typeof body.categoryId !== "string" ||
      typeof body.itemId !== "string"
    ) {
      throw new PlayerError("Choose a valid movie.", 400);
    }

    const streamUrl = await getVodStreamUrl(
      body.categoryId,
      body.itemId,
      typeof body.qualityId === "string" ? body.qualityId : "",
      body.clientItem
    );
    const session = (await activeCatalog()).session;

    return json(res, 200, {
      stream: createStreamRelayTarget(streamUrl, "vod", session),
      hls: shouldTryHlsFirst(streamUrl),
      mediaType: shouldTryHlsFirst(streamUrl) ? "hls-or-auto" : "progressive",
    });
  }

  if (
    req.method === "POST" &&
    requestUrl.pathname === "/api/vod/episode/play"
  ) {
    const body = await readJson(req);

    if (
      typeof body.categoryId !== "string" ||
      typeof body.itemId !== "string" ||
      body.season == null ||
      body.episodeId == null
    ) {
      throw new PlayerError("Choose a valid episode.", 400);
    }

    const streamUrl = await getCombinedVodEpisodeStream(
      body.categoryId,
      body.itemId,
      Number(body.season),
      String(body.episodeId),
      typeof body.qualityId === "string" ? body.qualityId : ""
    );
    const session = (await activeCatalog()).session;

    return json(res, 200, {
      stream: createStreamRelayTarget(streamUrl, "vod", session),
      hls: shouldTryHlsFirst(streamUrl),
      mediaType: shouldTryHlsFirst(streamUrl) ? "hls-or-auto" : "progressive",
    });
  }

  if (
    req.method === "GET" &&
    requestUrl.pathname === "/api/series/categories"
  ) {
    return json(res, 200, {
      categories: await getSeriesCategories(),
    });
  }

  if (
    req.method === "GET" &&
    requestUrl.pathname === "/api/series/items"
  ) {
    const categoryId = requestUrl.searchParams.get("categoryId");

    if (!categoryId) {
      throw new PlayerError("Choose a series category.", 400);
    }

    return json(
      res,
      200,
      await getSeriesItems(
        categoryId,
        requestUrl.searchParams.get("page")
      )
    );
  }

  if (
    req.method === "GET" &&
    requestUrl.pathname === "/api/series/seasons"
  ) {
    const seriesId = requestUrl.searchParams.get("seriesId");

    if (!seriesId) {
      throw new PlayerError("Choose a series.", 400);
    }

    const info = await getSeriesInfo(seriesId);

    return json(res, 200, {
      seasons: extractSeasons(info),
    });
  }

  if (
    req.method === "GET" &&
    requestUrl.pathname === "/api/series/episodes"
  ) {
    const seriesId = requestUrl.searchParams.get("seriesId");
    const season = requestUrl.searchParams.get("season");

    if (!seriesId || !season) {
      throw new PlayerError("Choose a series and season.", 400);
    }

    const info = await getSeriesInfo(seriesId);

    return json(res, 200, {
      episodes: extractEpisodes(info, Number(season)),
    });
  }

  if (
    req.method === "POST" &&
    requestUrl.pathname === "/api/series/play"
  ) {
    const body = await readJson(req);

    if (
      typeof body.seriesId !== "string" ||
      body.season == null ||
      body.episodeId == null
    ) {
      throw new PlayerError("Choose a valid episode.", 400);
    }

    const streamUrl = await getSeriesEpisodeStream(
      body.seriesId,
      Number(body.season),
      String(body.episodeId)
    );
    const session = (await activeCatalog()).session;

    return json(res, 200, {
      stream: createStreamRelayTarget(streamUrl, "series", session),
      hls: shouldTryHlsFirst(streamUrl),
      mediaType: shouldTryHlsFirst(streamUrl) ? "hls-or-auto" : "progressive",
    });
  }

  if (
    req.method === "GET" &&
    requestUrl.pathname.startsWith("/stream/")
  ) {
    return relay(
      req,
      res,
      requestUrl.pathname.slice("/stream/".length)
    );
  }

  return text(res, 404, "Not found.");
}

/* =====================================================
   SERVER
===================================================== */

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error(error.message);
    recordDiagnostic("local.request_error", {
      method: req.method,
      path: new URL(req.url, `http://${HOST}:${PORT}`).pathname,
      status: error.status || 500,
      message: error.message || "Local player request failed.",
    });

    if (res.headersSent) {
      return res.destroy();
    }

    json(res, error.status || 500, {
      error: error.message || "Local player request failed.",
    });
  });
});

function openBrowser() {
  const url = `http://${HOST}:${PORT}`;

  if (process.env.NO_OPEN_BROWSER === "1") return;

  const command =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];

  try {
    spawn(command[0], command[1], {
      detached: true,
      stdio: "ignore",
    }).unref();
  } catch {
    console.log(`Open ${url} in your browser.`);
  }
}

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.log(
      "Player is already running. Opening it in your browser..."
    );

    openBrowser();

    setTimeout(() => process.exit(0), 800);
    return;
  }

  console.error(error);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`STB PLAY v${APP_VERSION} is running.`);
  console.log(`Open http://${HOST}:${PORT}`);
  console.log(
    "Keep this window open while watching. Close it to stop the player."
  );

  openBrowser();
});
