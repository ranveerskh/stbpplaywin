STB PLAY Windows — v1.8.16

PROJECT SCOPE
This repository contains the Windows desktop application and its private
analytics dashboard source. Windows updates use this repository's stable
release channel. Android uses its own repository and release channel.

LOCAL BUILD AND CHECKS
Requirements: Windows 10/11 for the installer, Node.js 22.13 or newer, and
npm. From this directory run:

  npm install
  npm test
  npm run desktop:make

The NSIS installer is written to release/Netplus-IPTV-Player-Setup-1.8.16.exe.
The test suite checks the application sources, update policy rules, and the
local portal integration flow. A successful Linux source check does not replace
a Windows installer build, Authenticode verification, or physical-device test.

RELEASE SIGNING
A tag release is allowed only after Windows tests and packaging pass and the
installer has a valid Authenticode signature. Configure the GitHub Actions
secrets WINDOWS_CERTIFICATE_B64 and WINDOWS_CERTIFICATE_PASSWORD with the
release certificate before creating a release tag. The release job signs and
verifies the installer before uploading it. Without those secrets the release
workflow stops before building or publishing an installer.

UPDATE POLICY
The default manifest is:
https://raw.githubusercontent.com/ranveerskh/stbpplaywin/main/update.json

The manifest identifies platform, channel, latestVersion, minimumVersion,
and an exact installer asset URL. The server can be configured with
STB_PLAY_UPDATE_MANIFEST_URL and STB_PLAY_RELEASE_REPOSITORY. Use HTTPS for a
remote manifest. Stable Windows releases are independent of Android releases.
A minimum-version policy blocks the main UI and offers retry plus installer
actions. A verified cached policy keeps an already-required update blocked
while offline; with no known mandatory policy, a failed check lets the app open
and keeps retry available in Settings.

USER DATA AND UPGRADES
The Electron appId (ca.netplus.iptvplayer), product name, local HTTP origin,
and Electron userData path remain unchanged. Portal profiles, parental settings,
preferences, favourites, and watch progress continue using the existing files
and localStorage/IndexedDB namespaces. Install the newer build over the prior
build; do not uninstall the application first. The installer does not clear the
userData folder. Back up important settings before testing any installer.

DATA SERVICE STATUS
The current Firebase service is anonymous product-health analytics, not a
registration-key service. It does not implement shared Android/Windows keys or
the requested cross-platform device dashboard. No shared registration backend
is configured by this Windows project, so none is fabricated here.

MANUAL WINDOWS CHECKS
1. Install over an existing build and confirm the saved portal, favourites,
   preferences, and watch progress remain available.
2. Connect to a portal where a Live TV category is missing from the initial
   channel response; open that category, confirm its channels load, then play
   one channel.
3. Check category PIN behavior, the three content modes, and all three themes.
4. Test a valid update policy, a mandatory minimum version, a failed update
   check with retry, and the installer handoff.
5. Confirm the installer signature is valid before distribution.

No installer is published by local build commands. GitHub Releases are made
only by the verified, signed tag workflow.
