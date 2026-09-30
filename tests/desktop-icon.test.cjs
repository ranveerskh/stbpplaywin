const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");

test("Windows shell, runtime window, and shortcut use the packaged icon resource", () => {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const main = fs.readFileSync(path.join(ROOT, "electron", "main.cjs"), "utf8");
  const iconPath = path.join(ROOT, "build", "stb-play-desktop.ico");
  const icon = fs.readFileSync(iconPath);
  assert.ok(config.build.win.icon.endsWith("build/stb-play-desktop.ico"));
  assert.ok(config.build.extraResources.some((resource) => resource.from === "build/stb-play-desktop.ico" && resource.to === "stb-play-desktop.ico"));
  assert.match(main, /process\.resourcesPath, "stb-play-desktop\.ico"/);
  assert.doesNotMatch(main, /stb-play-desktop-v1\.8\.9\.ico/);
  assert.equal(icon.readUInt16LE(0), 0);
  assert.equal(icon.readUInt16LE(2), 1);
  assert.ok(icon.readUInt16LE(4) >= 1);
});
