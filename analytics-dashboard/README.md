# STB PLAY Analytics Dashboard

This is a separate, private static admin webpage for the `stb-play-analytics`
Firebase project. It is not embedded in STB PLAY.

The desktop app sends allow-listed anonymous health events to the
`analyticsEvents` Firebase Function. The function hashes the random local
installation ID and writes the dashboard's `installations` and `events`
collections. The app never writes directly to Firestore and does not use
anonymous Firebase sign-in.

The dashboard reads GitHub release downloads, installation/version adoption,
portal and playback outcomes, VLC fallback, update events, and crash totals.
It does not collect or display portal URLs, credentials, MAC addresses, PINs,
stream URLs, channel names, raw IP addresses, or personal files.

## Private Firebase setup

1. Enable Email/Password sign-in for the private admin account.
2. Copy that account's UID into an `admins/{uid}` document.
3. Set the document field `role` to the string `admin`.
4. Deploy the backend function and Firestore rules before distributing the
   v1.8.16 player:

```bash
firebase use stb-play-analytics
firebase functions:secrets:set ANALYTICS_HASH_SECRET
npm run analytics:install
firebase deploy --only functions:analyticsEvents,firestore:rules
```

5. Publish this dashboard after the backend is ready:

```bash
firebase deploy --only hosting
```

The Firebase web configuration in `app.js` is public project configuration,
not an admin password. Access is protected by Firebase Authentication and the
Firestore rules.

The packaged desktop player defaults to:

`https://us-central1-stb-play-analytics.cloudfunctions.net/analyticsEvents`

For production, set a stable private `ANALYTICS_HASH_SECRET` in Functions.
Changing it creates a new anonymous installation ID namespace.
