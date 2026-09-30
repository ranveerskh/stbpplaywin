const { onRequest } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const {
  AnalyticsValidationError,
  hashInstallationId,
  normalizeAnalyticsPayload,
} = require("./contract.cjs");

initializeApp();

const db = getFirestore();
const HASH_SECRET = String(
  process.env.ANALYTICS_HASH_SECRET || process.env.GCLOUD_PROJECT || "stb-play-analytics"
);
const RATE_WINDOW_MS = 60_000;
const MAX_EVENTS_PER_WINDOW = 60;
const rateBuckets = new Map();

function json(res, status, payload) {
  res.status(status).set("Cache-Control", "no-store").json(payload);
}

function allowRequest(uid) {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) {
    if (now - bucket.startedAt >= RATE_WINDOW_MS) rateBuckets.delete(key);
  }
  const current = rateBuckets.get(uid);
  if (!current || now - current.startedAt >= RATE_WINDOW_MS) {
    rateBuckets.set(uid, { startedAt: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= MAX_EVENTS_PER_WINDOW;
}

async function storeAnalyticsEvent(payload) {
  const uid = hashInstallationId(payload.installationId, HASH_SECRET);
  const installationRef = db.collection("installations").doc(uid);
  const eventRef = db.collection("events").doc();
  const now = FieldValue.serverTimestamp();
  const event = {
    uid,
    name: payload.name,
    version: payload.version,
    platform: payload.platform,
    createdAt: now,
  };
  if (Object.keys(payload.meta).length) event.meta = payload.meta;

  await db.runTransaction(async (transaction) => {
    const installation = await transaction.get(installationRef);
    if (installation.exists) {
      transaction.update(installationRef, {
        version: payload.version,
        platform: payload.platform,
        lastSeenAt: now,
      });
    } else {
      transaction.create(installationRef, {
        uid,
        version: payload.version,
        platform: payload.platform,
        firstSeenAt: now,
        lastSeenAt: now,
      });
    }
    transaction.create(eventRef, event);
  });
}

exports.analyticsEvents = onRequest(
  {
    region: "us-central1",
    cors: true,
    maxInstances: 10,
    secrets: ["ANALYTICS_HASH_SECRET"],
  },
  async (req, res) => {
    if (req.method === "OPTIONS") return res.status(204).end();
    if (req.method !== "POST") return json(res, 405, { error: "POST is required." });

    try {
      const rawBody = req.rawBody;
      if (rawBody && rawBody.length > 16 * 1024) {
        return json(res, 413, { error: "Analytics payload is too large." });
      }
      const input = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body;
      const payload = normalizeAnalyticsPayload(input);
      const uid = hashInstallationId(payload.installationId, HASH_SECRET);
      if (!allowRequest(uid)) return json(res, 429, { error: "Analytics rate limit reached." });
      await storeAnalyticsEvent(payload);
      return json(res, 202, { ok: true });
    } catch (error) {
      if (error instanceof AnalyticsValidationError || error instanceof SyntaxError) {
        return json(res, 400, { error: error.message || "Invalid analytics payload." });
      }
      console.error("Analytics write failed:", error?.message || "unknown error");
      return json(res, 500, { error: "Analytics service unavailable." });
    }
  }
);
