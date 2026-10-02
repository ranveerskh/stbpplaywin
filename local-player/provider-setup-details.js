"use strict";

(function exposeProviderSetupDetails(root) {
  async function hashDeviceIdForDisplay(rawDeviceId) {
    if (typeof rawDeviceId !== "string" || !rawDeviceId || !root.crypto?.subtle || typeof root.TextEncoder !== "function") return "";
    const bytes = new root.TextEncoder().encode(rawDeviceId);
    const digest = await root.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  root.StbPlayProviderSetup = Object.freeze({ hashDeviceIdForDisplay });
})(globalThis);
