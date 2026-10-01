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

const policy = {
  platform: "windows",
  channel: "stable",
  latestVersion: "1.8.21",
  minimumVersion: "0.0.0",
  publishedAt: "2026-01-01T00:00:00.000Z",
  downloadUrl: "https://github.com/ranveerskh/stbpplaywin/releases/download/v1.8.21/Netplus-IPTV-Player-Setup-1.8.21.exe",
};

test("version policy gives a new stable release 14 days before requiring it", () => {
  assert.ok(compareVersions("v1.8.9", "1.8.18") < 0);
  assert.ok(compareVersions("1.8.21", "1.8.18") > 0);
  const releaseTime = Date.parse(policy.publishedAt);
  assert.equal(requiresUpdate("1.8.18", policy, releaseTime + 13 * 86400000), false);
  assert.equal(requiresUpdate("1.8.18", policy, releaseTime + 14 * 86400000), true);
  assert.equal(requiresUpdate("1.8.21", policy, releaseTime + 30 * 86400000), false);
  assert.equal(requiresUpdate("1.8.18", { ...policy, publishedAt: "" }, releaseTime + 30 * 86400000), false);
});

test("update policy accepts Windows stable installer URLs only", () => {
  const normalized = normalizeUpdateManifest(policy);
  assert.equal(normalized.latestVersion, "1.8.21");
  assert.equal(normalized.minimumVersion, "1.8.21");
  const withinGrace = normalizeUpdateManifest({ ...policy, publishedAt: "2026-01-01T00:00:00.000Z" }, {
    now: Date.parse("2026-01-10T00:00:00.000Z"),
  });
  assert.equal(withinGrace.minimumVersion, "0.0.0");
  assert.throws(() => normalizeUpdateManifest({ ...policy, platform: "android" }), /different platform/);
  assert.throws(() => normalizeUpdateManifest({ ...policy, channel: "preview" }), /different release channel/);
  assert.throws(() => normalizeUpdateManifest({ ...policy, minimumVersion: "1.8.22" }), /cannot be newer/);
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
