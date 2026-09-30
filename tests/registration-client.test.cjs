const assert = require("node:assert/strict");
const test = require("node:test");
const {
  DEFAULT_REGISTRATION_API,
  createRegistrationPayload,
  normalizePortalHost,
  normalizeRegistrationApiUrl,
} = require("../local-player/registration-client.cjs");

test("registration payload sends only portal hostname with stable Windows fields", () => {
  const payload = createRegistrationPayload({
    licenseKey: "KEY-123",
    deviceId: "123e4567-e89b-12d3-a456-426614174000",
    appVersion: "1.8.17",
    portalUrl: "https://portal.example:9443/path/server/load.php?token=secret&mac=00:11:22:33:44:55",
  });
  assert.deepEqual(payload, {
    licenseKey: "KEY-123",
    deviceId: "123e4567-e89b-12d3-a456-426614174000",
    platform: "windows",
    appVersion: "1.8.17",
    portalHost: "portal.example",
  });
});

test("portal host rejects invalid and non-http portal URLs", () => {
  assert.equal(normalizePortalHost("file:///tmp/portal"), "");
  assert.equal(normalizePortalHost("not a URL"), "");
  assert.throws(() => createRegistrationPayload({
    licenseKey: "KEY-123", deviceId: "device", appVersion: "1.8.17", portalUrl: ""
  }), /active portal host/);
});

test("registration API override must use HTTPS and cannot carry query secrets", () => {
  assert.equal(normalizeRegistrationApiUrl("http://example.test/api"), DEFAULT_REGISTRATION_API);
  assert.equal(normalizeRegistrationApiUrl("https://example.test/api?token=secret"), DEFAULT_REGISTRATION_API);
  assert.equal(normalizeRegistrationApiUrl("https://example.test/api/"), "https://example.test/api");
});
