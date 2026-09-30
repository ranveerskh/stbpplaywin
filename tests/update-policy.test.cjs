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
  latestVersion: "1.8.19",
  minimumVersion: "1.8.19",
  downloadUrl: "https://github.com/ranveerskh/stbpplaywin/releases/download/v1.8.19/Netplus-IPTV-Player-Setup-1.8.19.exe",
};

test("version policy compares semantic version triplets and gates below minimum only", () => {
  assert.ok(compareVersions("v1.8.9", "1.8.18") < 0);
  assert.ok(compareVersions("1.8.19", "1.8.18") > 0);
  assert.equal(requiresUpdate("1.8.15", policy), true);
  assert.equal(requiresUpdate("1.8.18", policy), true);
  assert.equal(requiresUpdate("1.8.19", policy), false);
});

test("update policy accepts Windows stable installer URLs only", () => {
  const normalized = normalizeUpdateManifest(policy);
  assert.equal(normalized.latestVersion, "1.8.19");
  assert.equal(normalized.minimumVersion, "1.8.19");
  assert.throws(() => normalizeUpdateManifest({ ...policy, platform: "android" }), /different platform/);
  assert.throws(() => normalizeUpdateManifest({ ...policy, channel: "preview" }), /different release channel/);
  assert.throws(() => normalizeUpdateManifest({ ...policy, minimumVersion: "1.8.21" }), /cannot be newer/);
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
});
