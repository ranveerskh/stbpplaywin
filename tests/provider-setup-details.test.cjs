const assert = require("node:assert/strict");
const { createHash, webcrypto } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const ROOT = path.resolve(__dirname, "..");

test("provider setup display hashes the exact raw device ID as UTF-8 SHA-256 lowercase hex", async () => {
  const context = { crypto: webcrypto, TextEncoder, Uint8Array, Array, Object };
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, "local-player/provider-setup-details.js"), "utf8"), context);

  const rawDeviceId = "device-identity-é-0123456789";
  const displayId = await context.StbPlayProviderSetup.hashDeviceIdForDisplay(rawDeviceId);
  const expected = createHash("sha256").update(rawDeviceId, "utf8").digest("hex");

  assert.equal(displayId, expected);
  assert.match(displayId, /^[a-f0-9]{64}$/);
  assert.equal(await context.StbPlayProviderSetup.hashDeviceIdForDisplay(""), "");
});

test("provider setup card uses distinct local portal and STB PLAY identity labels", () => {
  const html = fs.readFileSync(path.join(ROOT, "local-player/index.html"), "utf8");
  const app = fs.readFileSync(path.join(ROOT, "local-player/app.js"), "utf8");

  assert.match(html, /<h3 id="providerSetupDetailsTitle">Provider setup details<\/h3>/);
  assert.match(html, /<dt>Portal MAC<\/dt><dd id="providerPortalMacValue">No portal MAC configured<\/dd>/);
  assert.match(html, /<dt>STB PLAY Device ID<\/dt><dd id="providerDeviceIdValue"/);
  assert.match(html, /Take a screenshot of these details and send it to your authorized provider\./);
  assert.match(app, /state\.portals\.find\(\(portal\) => String\(portal\.id\) === String\(state\.activePortalId\)\)/);
  assert.match(app, /window\.StbPlayProviderSetup\.hashDeviceIdForDisplay\(rawDeviceId\)/);
});
