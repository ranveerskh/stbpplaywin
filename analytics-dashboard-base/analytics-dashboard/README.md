# STB PLAY Analytics Dashboard

This is a private, static admin dashboard for the `stb-play-analytics` Firebase project.

It reads:

- GitHub Release asset download counts from `ranveerskh/stbpplaywin`
- `installations` documents for total installs, active devices and version adoption
- `events` documents for portal, playback, VLC, update and crash totals

The dashboard does not collect or display portal URLs, credentials, MAC addresses, stream URLs, channel names or personal files.

## Firebase checklist

1. Enable Email/Password sign-in for the admin account.
2. Add the admin account's UID as a document ID in the `admins` collection.
3. Add a string field named `role` with value `admin`.
4. Enable Anonymous sign-in when the desktop app telemetry integration is added.
5. Publish the rules from `firestore.rules`.

## Deploy with Firebase Hosting

From the repository root:

```bash
npm install -g firebase-tools
firebase login
firebase use stb-play-analytics
firebase deploy --only hosting
```

The hosting configuration publishes this folder only. The Firebase web configuration in `app.js` is not a password; access is protected by Firebase Authentication and Firestore Rules.

## Data contract for the next desktop build

The desktop app should authenticate anonymously, then write only these shapes:

`installations/{anonymousAuthUid}`

```js
{
  uid,
  version,
  platform,
  firstSeenAt: serverTimestamp(),
  lastSeenAt: serverTimestamp()
}
```

`events/{autoId}`

```js
{
  uid,
  name,
  version,
  platform,
  createdAt: serverTimestamp(),
  meta: { player, errorType, screen, durationSec, success }
}
```

Never send provider credentials, portal URLs, MAC addresses, stream URLs, channel/show names or raw IP addresses.
