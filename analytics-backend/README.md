# STB PLAY anonymous analytics backend

This folder contains the central event endpoint used by STB PLAY v1.8.16.
The desktop app sends events to its local player server; that server keeps a
small retryable outbox and forwards the allow-listed payload to the Firebase
Function named `analyticsEvents`.

The endpoint stores only:

- a one-way HMAC installation identifier;
- app version and platform;
- an allow-listed event name;
- small safe metadata such as player, screen, error type, status code and
  success.

It does not accept or store portal URLs, credentials, MAC addresses, PINs,
stream URLs, channel/show names, raw IP addresses or personal files.

## Deploy the central endpoint

From this project root, after installing the Firebase CLI and authenticating:

```bash
firebase use stb-play-analytics
firebase functions:secrets:set ANALYTICS_HASH_SECRET
cd analytics-backend/functions
npm install --no-audit --no-fund
cd ../..
firebase deploy --only functions:analyticsEvents,firestore:rules
```

Set a stable `ANALYTICS_HASH_SECRET` in the Functions runtime before deploying
or use the project fallback. Keep the secret private; changing it creates new
anonymous installation IDs.

The packaged player defaults to:

`https://us-central1-stb-play-analytics.cloudfunctions.net/analyticsEvents`

For a local smoke test, run:

```bash
node analytics-backend/local-server.cjs
```

Then start the player with:

```bash
STB_PLAY_ANALYTICS_ENDPOINT=http://127.0.0.1:3850/analyticsEvents node local-player/server.cjs
```
