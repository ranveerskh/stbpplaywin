const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const test = require("node:test");
const {
  compareVersions,
  normalizeUpdateManifest,
  requiresUpdate,
} = require("../local-player/update-policy.cjs");
const contentModesContext = { module: { exports: {} }, globalThis: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../local-player/content-modes.js"), "utf8"), contentModesContext);
const contentModes = contentModesContext.module.exports;
const { buildWindowsUpdateLauncher } = require("../electron/update-installer.cjs");

const policy = {
  platform: "windows",
  channel: "stable",
  latestVersion: "1.8.23",
  minimumVersion: "0.0.0",
  publishedAt: "2026-01-01T00:00:00.000Z",
  downloadUrl: "https://github.com/ranveerskh/stbpplaywin/releases/download/v1.8.23/Netplus-IPTV-Player-Setup-1.8.23.exe",
};

test("version policy gives a new stable release 14 days before requiring it", () => {
  assert.ok(compareVersions("v1.8.9", "1.8.18") < 0);
  assert.ok(compareVersions("1.8.23", "1.8.18") > 0);
  const releaseTime = Date.parse(policy.publishedAt);
  assert.equal(requiresUpdate("1.8.18", policy, releaseTime + 13 * 86400000), false);
  assert.equal(requiresUpdate("1.8.18", policy, releaseTime + 14 * 86400000), true);
  assert.equal(requiresUpdate("1.8.23", policy, releaseTime + 30 * 86400000), false);
  assert.equal(requiresUpdate("1.8.18", { ...policy, publishedAt: "" }, releaseTime + 30 * 86400000), false);
});

test("update policy accepts Windows stable installer URLs only", () => {
  const normalized = normalizeUpdateManifest(policy);
  assert.equal(normalized.latestVersion, "1.8.23");
  assert.equal(normalized.minimumVersion, "1.8.23");
  const withinGrace = normalizeUpdateManifest({ ...policy, publishedAt: "2026-01-01T00:00:00.000Z" }, {
    now: Date.parse("2026-01-10T00:00:00.000Z"),
  });
  assert.equal(withinGrace.minimumVersion, "0.0.0");
  assert.throws(() => normalizeUpdateManifest({ ...policy, platform: "android" }), /different platform/);
  assert.throws(() => normalizeUpdateManifest({ ...policy, channel: "preview" }), /different release channel/);
  assert.throws(() => normalizeUpdateManifest({ ...policy, minimumVersion: "1.8.24" }), /cannot be newer/);
  assert.throws(() => normalizeUpdateManifest({ ...policy, downloadUrl: `${policy.downloadUrl}?token=secret` }), /trusted release asset/);
  assert.throws(() => normalizeUpdateManifest({ ...policy, downloadUrl: policy.downloadUrl.replace("stbpplaywin", "netplus-player") }), /trusted release asset/);
});

test("content modes retain all mode and filter only explicitly restricted records", () => {
  const categories = [{ id: "adult", title: "Movies", locked: true }];
  const restrictedChannel = { id: "1", name: "Private TV", genreId: "adult" };
  const generalChannel = { id: "2", name: "News One", genreId: "general" };
  assert.equal(contentModes.isVisibleInMode("all", true), true);
  assert.equal(contentModes.isVisibleInMode("adult-free", contentModes.isRestrictedChannel(restrictedChannel, categories)), false);
  assert.equal(contentModes.isVisibleInMode("adult-free", contentModes.isRestrictedChannel(generalChannel, categories)), true);
  assert.equal(contentModes.isVisibleInMode("adult-only", contentModes.isRestrictedChannel(restrictedChannel, categories)), true);
  assert.equal(contentModes.isVisibleInMode("adult-only", contentModes.isRestrictedChannel(generalChannel, categories)), false);
  assert.equal(contentModes.canDisplayInMode("adult-only", true, false), false);
  assert.equal(contentModes.canDisplayInMode("adult-only", true, true), true);
  assert.equal(contentModes.canDisplayInMode("adult-only", false, true), false);
  assert.equal(contentModes.canDisplayInMode("adult-free", false, false), true);
  const mixed = [
    { id: "normal", name: "Local News", genreId: "mixed" },
    { id: "restricted", name: "Adult Cinema", genreId: "mixed" },
  ];
  const restrictedItems = mixed.map((item) => contentModes.isRestrictedChannel(item));
  assert.deepEqual(restrictedItems.map((restricted) => contentModes.isVisibleInMode("adult-free", restricted)), [true, false]);
  assert.deepEqual(restrictedItems.map((restricted) => contentModes.isVisibleInMode("adult-only", restricted)), [false, true]);
});

test("content modes reveal learned categories and keep Home recommendations mode-specific", () => {
  const mixedCategory = { id: "mixed", title: "Entertainment" };
  assert.equal(contentModes.isCategoryVisibleInMode("all", mixedCategory, false), true);
  assert.equal(contentModes.isCategoryVisibleInMode("adult-free", mixedCategory, true), true);
  assert.equal(contentModes.isCategoryVisibleInMode("adult-only", mixedCategory, false), false);
  assert.equal(contentModes.isCategoryVisibleInMode("adult-only", mixedCategory, true), true);
  assert.equal(contentModes.isVisibleOnHome("all", true, false), false);
  assert.equal(contentModes.isVisibleOnHome("adult-free", true, false), false);
  assert.equal(contentModes.isVisibleOnHome("adult-only", true, false), false);
  assert.equal(contentModes.isVisibleOnHome("adult-only", true, true), true);
  assert.equal(contentModes.isVisibleOnHome("adult-only", false, true), false);
  assert.equal(contentModes.themeForMode("adult-only", "dark"), "pink");
  assert.equal(contentModes.themeForMode("all", "midnight"), "midnight");
});

test("restricted category discovery resumes locally without storing catalog titles", () => {
  const now = 100000;
  let cache = contentModes.setCategoryFinding({}, "vod", "42", false, now, {
    complete: false,
    nextPage: 3,
  });
  assert.equal(contentModes.categoryScanPage(cache, "vod", 42), 3);
  assert.equal(contentModes.needsCategoryCheck(cache, "vod", 42, now + 1000, 86400000), true);
  cache = contentModes.setCategoryFinding(cache, "vod", 42, true, now + 1000, {
    complete: true,
    nextPage: 0,
  });
  assert.equal(contentModes.getCategoryFinding(cache, "vod", 42).restricted, true);
  assert.equal(contentModes.needsCategoryCheck(cache, "vod", 42, now + 2000, 86400000), false);
  assert.equal(JSON.stringify(cache).includes("Title"), false);
});

test("rating detection recognizes common mature ratings", () => {
  for (const rating of ["18+", "TV-MA", "R", "R-rated", "MA15+", "NC-17", "AO"]) {
    assert.equal(contentModes.isRestrictedMedia({ title: "A Show", rating }), true, rating);
  }
  assert.equal(contentModes.isRestrictedMedia({ title: "A Show", rating: "PG-13" }), false);
});

test("Windows update handoff waits for both app processes and reports launch failures", () => {
  const main = fs.readFileSync(path.join(__dirname, "../electron/main.cjs"), "utf8");
  const script = buildWindowsUpdateLauncher({
    installerPath: "C:\\Users\\O'Neil\\AppData\\Local\\Temp\\stb-play-update.exe",
    logPath: "C:\\Users\\O'Neil\\AppData\\Local\\Temp\\stb-play-update.log",
    processIds: [123, 456, 123, -1],
  });
  assert.match(script, /Get-Process -Id \$processId/);
  assert.match(script, /Start-Process -FilePath \$installer/);
  assert.match(script, /Updater helper started at/);
  assert.match(script, /Starting installer at/);
  assert.match(script, /Out-File -LiteralPath \$log/);
  assert.match(script, /MessageBox/);
  assert.match(script, /@\(123,456\)/);
  assert.match(script, /O''Neil/);
  assert.ok(main.indexOf('waiter.once("spawn"') < main.indexOf("waiter.unref()"));
  assert.ok(main.indexOf("waitForUpdateLauncherReady(logPath, waiter)") < main.indexOf("app.quit()", main.indexOf("download-and-install-update")));
  assert.ok(main.indexOf("waiter.unref()") < main.indexOf("app.quit()", main.indexOf("download-and-install-update")));
});
