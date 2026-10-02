Warning: truncated output (original token count: 39207)
Total output lines: 4969

/*
=========================================================
 STB PLAY IPTV Player
 VERSION: 1.8.26 provider setup details
 File: server.cjs
=========================================================
*/

const http = require("node:http");
const dns = require("node:dns");
const fs = require("node:fs");
const path = require("node:path");
const { randomBytes, randomUUID, scryptSync, timingSafeEqual } = require("node:crypto");
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
const {
  DEFAULT_REGISTRATION_API,
  createRegistrationPayload,
  normalizeRegistrationApiUrl,
} = require("./registration-client.cjs");

/* IPTV/CDN hosts used by the provider can publish broken IPv6 routes. */
try { dns.setDefaultResultOrder("ipv4first"); } catch {}

const HOST = "127.0.0.1";
const requestedPort = Number(process.env.NETPLUS_PORT || 3847);
const PORT = Number.isInteger(requestedPort) && requestedPort > 0 && requestedPort < 65_536
  ? requestedPort
  : 3847;
const ROOT = __dirname;
const CONFIG_PATH = process.env.NETPLUS_CONFIG_PATH || path.join(ROOT, "config.json");
const APP_VERSION = "1.8.26";
const REGISTRATION_API = normalizeRegistrationApiUrl(process.env.STB_PLAY_REGISTRATION_API || DEFAULT_REGISTRATION_API);
const REGISTRATION_PATH = path.join(path.dirname(CONFIG_PATH), "stb-play-registration.json");
const REGISTRATION_HEARTBEAT_INTERVAL_MS = 15 * 60 * 1000;
const UPDATE_REPOSITORY = String(process.env.STB_PLAY_RELEASE_REPOSITORY || DEFAULT_RELEASE_REPOSITORY).trim();
const UPDATE_MANIFEST_URL = String(
  process.env.STB_PLAY_UPDATE_MANIFEST_URL ||
    `https://raw.githubusercontent.com/${UPDATE_REPOSITORY}/main/update.json`
).trim();
const DIAGNOSTIC_PATH = path.join(
  path.dirname(CONFIG_PATH),
  "netplus-diagnostics-v1.8.19.json"
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

/* Registration stores only the license key and a random stable device ID.
   Portal paths, query strings, credentials, and content names are never sent. */
function readRegistration() {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(REGISTRATION_PATH, "utf8")); } catch {}
  if (!/^[0-9a-f-]{36}$/i.test(String(saved.deviceId || ""))) saved.deviceId = randomUUID();
  return saved;
}

function persistRegistration(registration) {
  try {
    fs.mkdirSync(path.dirname(REGISTRATION_PATH), { recursive: true });
    fs.writeFileSync(REGISTRATION_PATH, `${JSON.stringify(registration, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  } catch {
    throw new PlayerError("Could not save registration on this device.", 500);
  }
}

function activePortalUrl() {
  const portals = listPortalProfiles();
  return portals.portals.find((portal) => portal.id === portals.activePortalId)?.portalUrl || "";
}

function registrationPayload(registration) {
  return createRegistrationPayload({
    licenseKey: registration.licenseKey,
    deviceId: registration.deviceId,
    platform: "windows",
    appVersion: APP_VERSION,
    portalUrl: activePortalUrl(),
  });
}

async function callRegistrationApi(action, payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${REGISTRATION_API}/api/${action}`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result?.ok === false || result?.success === false || result?.error) {
      throw new PlayerError(`Registration service rejected the request (HTTP ${response.status}).`, response.status || 502);
    }
    return result;
  } catch (error) {
    if (error instanceof PlayerError) throw error;
    throw new PlayerError("Registration service could not be reached. Check your connection and retry.", 503);
  } finally {
    clearTimeout(timeout);
  }
}

function publicRegistrationStatus(registration = readRegistration()) {
  return {
    registered: Boolean(registration.registeredAt),
    registeredAt: registration.registeredAt || null,
    lastHeartbeatAt: registration.lastHeartbeatAt || null,
    deviceId: registration.deviceId,
  };
}

async function registerDevice(licenseKey) {
  const registration = readRegistration();
  const cleanKey = String(licenseKey || "").trim();
  if (!cleanKey || cleanKey.length > 256) throw new PlayerError("Enter a valid registration key.", 400);
  registration.licenseKey = cleanKey;
  registration.registeredAt = "";
  registration.lastHeartbeatAt = "";
  persistRegistration(registration);
  const payload = registrationPayload(registration);
  await callRegistrationApi("register", payload);
  registration.registeredAt = new Date().toISOString();
  persistRegistration(registration);
  let heartbeat = false;
  try {
    await callRegistrationApi("heartbeat", payload);
    registration.lastHeartbeatAt = new Date().toISOString();
    persistRegistration(registration);
    heartbeat = true;
  } catch {
    /* Registration remains valid; the next scheduled heartbeat retries. */
  }
  return { ...publicRegistrationStatus(registration), heartbeat };
}

async function sendRegistrationHeartbeat() {
  const registration = readRegistration();
  if (!registration.registeredAt || !registration.licenseKey) {
    throw new PlayerError("Register this device before sending a heartbeat.", 409);
  }
  await callRegistrationApi("heartbeat", registrationPayload(registration));
  registration.lastHeartbeatAt = new Date().toISOString();
  persistRegistration(registration);
  return publicRegistrationStatus(registration);
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
  const index = portals.findIndex((…27207 tokens truncated…sSubtitle = /^subtitle(?::|$)/i.test(String(target.context || ""));
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

  if (req.method === "GET" && requestUrl.pathname === "/content-modes.js") {
    return serveFile(res, "content-modes.js", "text/javascript; charset=utf-8");
  }

  if (req.method === "GET" && requestUrl.pathname === "/provider-setup-details.js") {
    return serveFile(res, "provider-setup-details.js", "text/javascript; charset=utf-8");
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

  if (req.method === "GET" && requestUrl.pathname === "/api/registration/status") {
    return json(res, 200, publicRegistrationStatus());
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/registration/register") {
    const body = await readJson(req);
    return json(res, 200, { ok: true, ...await registerDevice(body.licenseKey) });
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/registration/heartbeat") {
    return json(res, 200, { ok: true, ...await sendRegistrationHeartbeat() });
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
        requestUrl.searchParams.get("q") || "",
        requestUrl.searchParams.get("background") === "1"
          ? { priority: -20, background: true }
          : {}
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
        requestUrl.searchParams.get("page"),
        requestUrl.searchParams.get("background") === "1"
          ? { priority: -20, background: true }
          : {}
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
