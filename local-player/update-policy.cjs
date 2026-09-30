const VERSION_RE = /^\d+\.\d+\.\d+$/;
const DEFAULT_RELEASE_REPOSITORY = "ranveerskh/stbpplaywin";

function compareVersions(left, right) {
  const a = String(left).replace(/^v/i, "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const b = String(right).replace(/^v/i, "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference) return difference;
  }
  return 0;
}

function normalizeUpdateManifest(manifest, {
  platform = "windows",
  channel = "stable",
  repository = DEFAULT_RELEASE_REPOSITORY,
} = {}) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("Update policy must be a JSON object.");
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error("The configured release repository is invalid.");
  }

  const manifestPlatform = String(manifest.platform || "windows").trim().toLowerCase();
  const manifestChannel = String(manifest.channel || "stable").trim().toLowerCase();
  const latestVersion = String(manifest.latestVersion || manifest.version || "").trim().replace(/^v/i, "");
  const minimumVersion = String(manifest.minimumVersion || manifest.minVersion || latestVersion).trim().replace(/^v/i, "");
  if (!VERSION_RE.test(latestVersion) || !VERSION_RE.test(minimumVersion)) {
    throw new Error("The update policy has an invalid version.");
  }
  if (compareVersions(minimumVersion, latestVersion) > 0) {
    throw new Error("The minimum supported version cannot be newer than the latest version.");
  }
  if (!(manifestPlatform === platform || (platform === "windows" && manifestPlatform === "win32"))) {
    throw new Error("The update policy belongs to a different platform.");
  }
  if (manifestChannel !== channel) {
    throw new Error("The update policy belongs to a different release channel.");
  }

  const downloadUrl = String(manifest.downloadUrl || "").trim();
  let parsed;
  try { parsed = new URL(downloadUrl); } catch { throw new Error("The update installer link is invalid."); }
  const expectedPath = `/${repository}/releases/download/v${latestVersion}/Netplus-IPTV-Player-Setup-${latestVersion}.exe`;
  if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "github.com" ||
      parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash ||
      parsed.pathname !== expectedPath) {
    throw new Error("The update installer link is not a trusted release asset.");
  }

  return {
    platform: "windows",
    channel,
    version: latestVersion,
    latestVersion,
    minimumVersion,
    downloadUrl: parsed.toString(),
    notes: String(manifest.notes || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 400),
  };
}

function requiresUpdate(currentVersion, policy) {
  return compareVersions(currentVersion, policy?.minimumVersion || policy?.latestVersion || policy?.version || "0.0.0") < 0;
}

module.exports = {
  DEFAULT_RELEASE_REPOSITORY,
  compareVersions,
  normalizeUpdateManifest,
  requiresUpdate,
};
