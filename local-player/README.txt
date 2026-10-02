STB PLAY — v1.8.23 Windows player

Run “Start Player.bat” for local browser testing, or use the Electron installer
for the desktop app. The Electron shell stores its config under its existing
userData directory. Portal profiles, settings, favourites and watch progress
are retained when upgrading in place.

The Live TV category loader asks the provider for a selected category's channel
list if that category was absent from its initial all-channels response. The
provider's original category IDs and PIN lock flags stay intact.

Version policy is served through /api/update-policy. The default policy source
is the Windows repository's update.json. Set STB_PLAY_UPDATE_MANIFEST_URL to
use another HTTPS manifest and STB_PLAY_RELEASE_REPOSITORY to configure its
matching trusted GitHub release repository. A failed check is retryable; an
unverified policy does not create a permanent lock.

Device registration calls the configured Firebase appApi `/api/register` and
`/api/heartbeat` endpoints. The app sends its license key, stable random device
ID, Windows platform, app version, and active portal hostname only. Portal
paths/query strings, access tokens, and watched titles are not sent. Anonymous
product-health analytics remains a separate opt-in service.
