# STB PLAY Windows

Electron desktop player with a local Node.js HTTP server and static HTML/CSS/JavaScript interface. Windows installers and update manifests live in this repository; Android releases use a separate repository and channel.

## Build and test

Requirements: Node.js 22.13+ and npm. Run from the repository root:

```sh
npm install --no-audit --no-fund
npm test
npm run desktop:make
```

`npm test` runs JavaScript syntax checks, update-policy/content-mode unit tests, and local portal/analytics integration tests. The Windows installer is produced in `release/` and is never published by a local build.

## Updates and local data

The default Windows update manifest is [`update.json`](update.json). It declares platform, channel, latest version, minimum supported version, neutral notes, and the exact release asset. Configure `STB_PLAY_UPDATE_MANIFEST_URL` for another HTTPS manifest and `STB_PLAY_RELEASE_REPOSITORY` for its matching GitHub release repository. Update checks run through the local server. A mandatory policy blocks the app with retry and install actions; an unknown or unavailable policy does not lock users out.

The Electron app identity (`ca.netplus.iptvplayer` / `STB PLAY`) and local web origin remain the same. Portal profiles, parental settings, preferences, favourites, and watch history keep the existing user-data path and storage keys when installing over an existing build. Do not uninstall before upgrading.

## Release process

Pushes and pull requests run Windows CI tests and build the installer without publishing it. A `v<package.json version>` tag starts the separate release workflow. Release publishing requires the `WINDOWS_CERTIFICATE_B64` and `WINDOWS_CERTIFICATE_PASSWORD` repository secrets, then verifies Authenticode before upload. Release notes are read from [`RELEASE_NOTES.md`](RELEASE_NOTES.md).

## Backend status

The configured Firebase service is anonymous product-health analytics, not a shared registration-key service. It does not currently provide the requested cross-platform registration/device dashboard. No registration backend or shared Android/Windows keys are fabricated in this project.
