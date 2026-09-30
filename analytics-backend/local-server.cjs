const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const {
  MAX_BODY_BYTES,
  hashInstallationId,
  normalizeAnalyticsPayload,
} = require("./functions/contract.cjs");

const HOST = "127.0.0.1";
const PORT = Number(process.env.ANALYTICS_PORT || 3850);
const DATA_PATH = path.resolve(process.env.ANALYTICS_DATA_PATH || path.join(__dirname, "local-data.json"));
const HASH_SECRET = String(process.env.ANALYTICS_HASH_SECRET || "local-test-secret");

function readStore() {
  try {
    const value = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
    return value && typeof value === "object" ? value : { installations: {}, events: [] };
  } catch {
    return { installations: {}, events: [] };
  }
}

function writeStore(store) {
  fs.writeFileSync(DATA_PATH, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
        reject(new Error("Analytics payload is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try { resolve(JSON.parse(body || "{}")); }
      catch { reject(new Error("Invalid analytics JSON.")); }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${HOST}:${PORT}`);
  if (req.method === "GET" && requestUrl.pathname === "/health") return sendJson(res, 200, { ok: true });
  if (req.method !== "POST" || requestUrl.pathname !== "/analyticsEvents") {
    return sendJson(res, 404, { error: "Not found." });
  }

  try {
    const payload = normalizeAnalyticsPayload(await readBody(req));
    const uid = hashInstallationId(payload.installationId, HASH_SECRET);
    const store = readStore();
    const now = new Date().toISOString();
    const installation = store.installations[uid];
    store.installations[uid] = {
      uid,
      version: payload.version,
      platform: payload.platform,
      firstSeenAt: installation?.firstSeenAt || now,
      lastSeenAt: now,
    };
    store.events = Array.isArray(store.events) ? store.events : [];
    store.events.push({
      uid,
      name: payload.name,
      version: payload.version,
      platform: payload.platform,
      createdAt: now,
      ...(Object.keys(payload.meta).length ? { meta: payload.meta } : {}),
    });
    store.events = store.events.slice(-10_000);
    writeStore(store);
    return sendJson(res, 202, { ok: true });
  } catch (error) {
    return sendJson(res, 400, { error: error.message || "Invalid analytics payload." });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Local STB PLAY analytics endpoint listening at http://${HOST}:${PORT}/analyticsEvents`);
});
