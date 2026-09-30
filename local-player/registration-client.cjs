"use strict";

const DEFAULT_REGISTRATION_API = "https://northamerica-northeast1-stbpplay-platform.cloudfunctions.net/appApi";

function normalizePortalHost(value) {
  try {
    const parsed = new URL(String(value || ""));
    if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) return "";
    return parsed.hostname.toLowerCase();
  } catch {
    return "";
  }
}

function normalizeRegistrationApiUrl(value) {
  try {
    const parsed = new URL(String(value || DEFAULT_REGISTRATION_API));
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
      return DEFAULT_REGISTRATION_API;
    }
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return DEFAULT_REGISTRATION_API;
  }
}

function createRegistrationPayload({ licenseKey, deviceId, appVersion, portalUrl }) {
  const key = String(licenseKey || "").trim();
  const device = String(deviceId || "").trim();
  const version = String(appVersion || "").trim();
  const portalHost = normalizePortalHost(portalUrl);
  if (!key || !device || !/^\d+\.\d+\.\d+$/.test(version) || !portalHost) {
    throw new Error("Registration needs a license key, device ID, app version, and active portal host.");
  }
  return { licenseKey: key, deviceId: device, platform: "windows", appVersion: version, portalHost };
}

module.exports = {
  DEFAULT_REGISTRATION_API,
  createRegistrationPayload,
  normalizePortalHost,
  normalizeRegistrationApiUrl,
};
