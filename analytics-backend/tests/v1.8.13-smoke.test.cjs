const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "../..");

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function waitFor(url, predicate = (response) => response.ok) {
  let lastError;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (predicate(response)) return response;
      lastError = new Error(`Unexpected status ${response.status} from ${url}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

function startProcess(file, env) {
  const child = spawn(process.execPath, [file], {
    cwd: ROOT,
    env: { ...process.env, ...env, NO_OPEN_BROWSER: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  child.testOutput = () => output;
  return child;
}

function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
}

function jsonResponse(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function startMockPortal(port) {
  const state = {
    handshakeCount: 0,
    createLinkCount: 0,
    orderedListCount: 0,
    staleChannel: false,
  };
  const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url, `http://127.0.0.1:${port}`);
    const action = requestUrl.searchParams.get("action");

    if (action === "handshake") {
      state.handshakeCount += 1;
      if (state.handshakeCount === 1) return jsonResponse(res, 200, { js: { not_valid: 1 } });
      return jsonResponse(res, 200, { js: { token: "mock-session-token" } });
    }
    if (action === "get_profile") return jsonResponse(res, 200, { js: { tariff_plan: "Smoke test" } });
    if (action === "get_vod_info") {
      return jsonResponse(res, 200, {
        js: {
          subtitles: [{
            language: "eng",
            label: "English",
            url: `http://127.0.0.1:${port}/subtitles/movie.srt`,
          }],
        },
      });
    }
    if (requestUrl.pathname === "/subtitles/movie.srt") {
      const body = "1\n00:00:01,000 --> 00:00:03,000\nHello from the provider\n";
      res.writeHead(200, { "content-type": "application/x-subrip", "content-length": Buffer.byteLength(body) });
      return res.end(body);
    }
    if (action === "get_genres") {
      return jsonResponse(res, 200, { js: [
        { id: "1", name: "General", locked: "0", adult: "0" },
        { id: "2", title: "Adult", locked: "1", adult: "0" },
      ] });
    }
    if (action === "get_all_channels") {
      const channels = [
        state.staleChannel
          ? null
          : { id: "100", title: "News One", command: "http://127.0.0.1/stream/news", genre_id: "1", channel_number: 1 },
      ].filter(Boolean);
      return jsonResponse(res, 200, { js: { data: channels } });
    }
    if (action === "get_ordered_list") {
      state.orderedListCount += 1;
      const genre = requestUrl.searchParams.get("genre");
      return jsonResponse(res, 200, { js: { data: genre === "2" ? [
        { id: "200", name: "Private TV HD", cmd: "http://127.0.0.1/stream/adult", tv_genre_id: "2", number: 2 },
      ] : [] } });
    }
    if (action === "create_link") {
      state.createLinkCount += 1;
      if (state.createLinkCount === 1) return jsonResponse(res, 401, { error: "temporary" });
      if (state.staleChannel) return jsonResponse(res, 404, { error: "missing" });
      return jsonResponse(res, 200, { js: { cmd: `http://127.0.0.1:${port}/stream/mock.m3u8` } });
    }
    return jsonResponse(res, 200, { js: [] });
  });
  server.listen(port, "127.0.0.1");
  return { server, state };
}

function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

test("v1.8.20 release markers and recovery/search boundaries are present", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const updateJson = JSON.parse(fs.readFileSync(path.join(ROOT, "update.json"), "utf8"));
  const app = fs.readFileSync(path.join(ROOT, "local-player", "app.js"), "utf8");
  const server = fs.readFileSync(path.join(ROOT, "local-player", "server.cjs"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "local-player", "index.html"), "utf8");

  assert.equal(packageJson.version, "1.8.20");
  assert.equal(packageJson.build.appId, "ca.netplus.iptvplayer");
  assert.equal(packageJson.build.nsis.deleteAppDataOnUninstall, false);
  const versionParts = (value) => String(value).split(".").map(Number);
  const compareVersions = (left, right) => {
    const a = versionParts(left), b = versionParts(right);
    for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
      const difference = (a[index] || 0) - (b[index] || 0);
      if (difference) return difference;
    }
    return 0;
  };
  assert.ok(compareVersions(updateJson.version, packageJson.version) <= 0);
  assert.match(updateJson.downloadUrl, new RegExp(`v${updateJson.version}/Netplus-IPTV-Player-Setup-${updateJson.version}\\.exe$`));
  assert.equal(updateJson.platform, "windows");
  assert.equal(updateJson.channel, "stable");
  assert.ok(compareVersions(updateJson.minimumVersion, updateJson.version) <= 0);
  assert.match(app, /function strictTitleSearchMatch/);
  assert.match(app, /!query \|\| strictTitleSearchMatch\(\{ title: channel\.name \}, query\)/);
  assert.doesNotMatch(server, /ADULT_LIVE_CATEGORY_ID/);
  assert.match(server, /function providerFlag\(value\)/);
  assert.match(server, /locked: providerFlag\(genre\.locked\)/);
  assert.match(server, /liveRowsFromResponse\(channelsResponse\)/);
  assert.match(server, /error\.status === 401/);
  assert.match(app, /error\.status === 404/);
  assert.match(server, /\[401, 404\]/);
  assert.match(server, /Channel is no longer available\./);
  assert.match(server, /categoryLockedById/);
  assert.match(server, /vod\/subtitles/);
  assert.match(app, /isTrustedUpdateUrl/);
  assert.match(app, /vodSubtitleSelect/);
  assert.match(server, /enabled: false/);
  assert.match(html, /attach the JSON file to your support message/i);
  assert.match(app, /\/api\/analytics\/event/);
});

test("analytics contract keeps payload anonymous and allow-listed", () => {
  const { normalizeAnalyticsPayload, hashInstallationId } = require("../functions/contract.cjs");
  const installationId = "0123456789abcdef0123456789abcdef";
  const payload = normalizeAnalyticsPayload({
    installationId,
    name: "playback_failed",
    version: "1.8.18",
    platform: "linux",
    meta: {
      player: "internal",
      screen: "live",
      errorType: "network",
      statusCode: 401,
      mac: "02:00:00:00:00:01",
      channelName: "private channel",
    },
  });

  assert.deepEqual(payload.meta, {
    player: "internal",
    screen: "live",
    errorType: "network",
    statusCode: 401,
  });
  assert.notEqual(hashInstallationId(installationId, "test-secret"), installationId);
  assert.throws(
    () => normalizeAnalyticsPayload({ ...payload, installationId: "short" }),
    /installation ID is invalid/
  );
});

test("live catalogue loads a missing locked category on demand and recovers 401/stale playback", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "stb-play-live-v1.8.18-"));
  const portalPort = await freePort();
  const playerPort = await freePort();
  const portal = startMockPortal(portalPort);
  const player = startProcess(path.join(ROOT, "local-player", "server.cjs"), {
    NETPLUS_PORT: String(playerPort),
    NETPLUS_CONFIG_PATH: path.join(tempRoot, "config.json"),
    STB_PLAY_ANALYTICS_ENDPOINT: "",
  });
  t.after(async () => {
    stopProcess(player);
    await closeServer(portal.server);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  await waitFor(`http://127.0.0.1:${playerPort}/api/config`);
  const save = await fetch(`http://127.0.0.1:${playerPort}/api/portals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      nickname: "Mock portal",
      portalUrl: `http://127.0.0.1:${portalPort}`,
      mac: "02:00:00:00:00:01",
      parentalPin: "1234",
    }),
  });
  assert.equal(save.status, 200);

  const catalogResponse = await fetch(`http://127.0.0.1:${playerPort}/api/catalog`);
  assert.equal(catalogResponse.status, 200);
  const catalog = await catalogResponse.json();
  const generalCategory = catalog.categories.find((category) => category.id === "1");
  const adultCategory = catalog.categories.find((category) => category.id === "2");
  assert.deepEqual(
    { title: generalCategory?.title, locked: generalCategory?.locked },
    { title: "General", locked: false }
  );
  assert.deepEqual(
    { title: adultCategory?.title, locked: adultCategory?.locked },
    { title: "Adult", locked: true }
  );
  assert.equal(catalog.channels.some((channel) => channel.id === "200"), false,
    "the portal intentionally omits locked channels from get_all_channels");
  assert.equal(catalog.channels.find((channel) => channel.id === "100")?.adultLocked, false);
  assert.equal(catalog.channels.length, 1);
  assert.equal(portal.state.handshakeCount, 2, "the initial temporary authorization should retry");

  const categoryResponse = await fetch(`http://127.0.0.1:${playerPort}/api/live/category?categoryId=2`);
  assert.equal(categoryResponse.status, 200);
  const categoryPayload = await categoryResponse.json();
  assert.equal(categoryPayload.channels.length, 1);
  assert.equal(categoryPayload.channels[0].id, "200");
  assert.equal(categoryPayload.channels[0].genreId, "2");
  assert.equal(categoryPayload.channels[0].adultLocked, true);
  assert.equal(portal.state.orderedListCount, 1);

  const adultPlayback = await fetch(`http://127.0.0.1:${playerPort}/api/play`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ channelId: "200" }),
  });
  const adultPlaybackPayload = await adultPlayback.json();
  assert.equal(adultPlayback.status, 200, JSON.stringify(adultPlaybackPayload));
  assert.match(adultPlaybackPayload.stream, /\/stream\//);
  assert.equal(portal.state.createLinkCount, 2, "the temporary create_link 401 should retry");

  const playback = await fetch(`http://127.0.0.1:${playerPort}/api/play`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ channelId: "100" }),
  });
  assert.equal(playback.status, 200);
  assert.match((await playback.json()).stream, /\/stream\//);
  assert.equal(portal.state.createLinkCount, 3);

  portal.state.staleChannel = true;
  const stalePlayback = await fetch(`http://127.0.0.1:${playerPort}/api/play`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ channelId: "100" }),
  });
  assert.equal(stalePlayback.status, 404);
  assert.equal((await stalePlayback.json()).error, "Channel is no longer available.");

  const subtitleResponse = await fetch(`http://127.0.0.1:${playerPort}/api/vod/subtitles`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      categoryId: "10",
      itemId: "501",
      language: "en",
      clientItem: { id: "501", categoryId: "10", title: "Demo Movie", year: "2025" },
    }),
  });
  assert.equal(subtitleResponse.status, 200);
  const subtitlePayload = await subtitleResponse.json();
  assert.equal(subtitlePayload.tracks.length, 1);
  assert.equal(subtitlePayload.tracks[0].language, "en");
  const subtitleFile = await fetch(`http://127.0.0.1:${playerPort}${subtitlePayload.tracks[0].url}`);
  assert.equal(subtitleFile.status, 200);
  assert.match(await subtitleFile.text(), /^WEBVTT[\s\S]*00:00:01\.000 --> 00:00:03\.000/);
});

test("update policy endpoint validates a configurable local manifest and remains retryable", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "stb-play-update-policy-"));
  const manifestPort = await freePort();
  const playerPort = await freePort();
  const state = {
    unavailable: false,
    policy: {
      platform: "windows",
      channel: "stable",
      version: "1.8.20",
      latestVersion: "1.8.20",
      minimumVersion: "1.8.18",
      publishedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
      notes: "Safe update policy test",
      downloadUrl: "https://github.com/ranveerskh/stbpplaywin/releases/download/v1.8.20/Netplus-IPTV-Player-Setup-1.8.20.exe",
    },
  };
  const manifestServer = http.createServer((req, res) => {
    if (state.unavailable) return jsonResponse(res, 503, { error: "offline" });
    return jsonResponse(res, 200, state.policy);
  });
  manifestServer.listen(manifestPort, "127.0.0.1");
  const player = startProcess(path.join(ROOT, "local-player", "server.cjs"), {
    NETPLUS_PORT: String(playerPort),
    NETPLUS_CONFIG_PATH: path.join(tempRoot, "config.json"),
    STB_PLAY_ANALYTICS_ENDPOINT: "",
    STB_PLAY_UPDATE_MANIFEST_URL: `http://127.0.0.1:${manifestPort}/policy.json`,
  });
  t.after(async () => {
    stopProcess(player);
    await closeServer(manifestServer);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  await waitFor(`http://127.0.0.1:${playerPort}/api/config`);
  const accepted = await fetch(`http://127.0.0.1:${playerPort}/api/update-policy`);
  assert.equal(accepted.status, 200);
  const normalized = await accepted.json();
  assert.equal(normalized.platform, "windows");
  assert.equal(normalized.channel, "stable");
  assert.equal(normalized.minimumVersion, "1.8.20");
  assert.equal(normalized.latestVersion, "1.8.20");

  state.policy.downloadUrl += "?token=not-allowed";
  const invalid = await fetch(`http://127.0.0.1:${playerPort}/api/update-policy`);
  assert.equal(invalid.status, 503);
  state.unavailable = true;
  const offline = await fetch(`http://127.0.0.1:${playerPort}/api/update-policy`);
  assert.equal(offline.status, 503);
});

test("local player queues and delivers an analytics event to the backend", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "stb-play-v1.8.18-"));
  const analyticsPort = await freePort();
  const playerPort = await freePort();
  const analyticsDataPath = path.join(tempRoot, "analytics-data.json");
  const configPath = path.join(tempRoot, "config.json");
  const analytics = startProcess(path.join(ROOT, "analytics-backend", "local-server.cjs"), {
    ANALYTICS_PORT: String(analyticsPort),
    ANALYTICS_DATA_PATH: analyticsDataPath,
    ANALYTICS_HASH_SECRET: "smoke-test-secret",
  });
  const player = startProcess(path.join(ROOT, "local-player", "server.cjs"), {
    NETPLUS_PORT: String(playerPort),
    NETPLUS_CONFIG_PATH: configPath,
    STB_PLAY_ANALYTICS_ENDPOINT: `http://127.0.0.1:${analyticsPort}/analyticsEvents`,
  });
  t.after(() => {
    stopProcess(player);
    stopProcess(analytics);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  await waitFor(`http://127.0.0.1:${analyticsPort}/health`);
  await waitFor(`http://127.0.0.1:${playerPort}/api/analytics/status`);

  const installationId = "fedcba9876543210fedcba9876543210";
  const response = await fetch(`http://127.0.0.1:${playerPort}/api/analytics/event`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      installationId,
      name: "app_opened",
      version: "1.8.18",
      platform: "linux",
      meta: { screen: "app", portalUrl: "https://should-not-be-sent.example" },
    }),
  });
  assert.equal(response.status, 202);

  const crash = await fetch(`http://127.0.0.1:${playerPort}/api/analytics/event`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      installationId,
      name: "crash_reported",
      version: "1.8.18",
      platform: "linux",
      meta: { screen: "app", errorType: "unhandled-rejection", rawError: "must-not-be-stored" },
    }),
  });
  assert.equal(crash.status, 202);

  let store;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { store = JSON.parse(fs.readFileSync(analyticsDataPath, "utf8")); } catch {}
    if (store?.events?.length >= 2) break;
    await new Promise((resolve) => setTimeout(resolve, 75));
  }

  assert.equal(store?.events?.length, 2, `analytics delivery failed: ${player.testOutput()}`);
  assert.deepEqual(store.events.map((event) => event.name), ["app_opened", "crash_reported"]);
  assert.equal(store.events[0].version, "1.8.18");
  assert.equal(store.events[0].meta.screen, "app");
  assert.equal(store.events[1].meta.errorType, "unhandled-rejection");
  assert.equal(store.events[0].uid.length, 64);
  assert.notEqual(store.events[0].uid, installationId);
  assert.equal(JSON.stringify(store).includes("should-not-be-sent"), false);

  const invalid = await fetch(`http://127.0.0.1:${playerPort}/api/analytics/event`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ installationId: "bad", name: "app_opened", version: "1.8.18", platform: "linux" }),
  });
  assert.equal(invalid.status, 400);
});
