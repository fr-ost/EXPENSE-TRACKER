# Google Drive sync for the Android app

The Android app keeps everything on the phone. Sync is optional: when someone
turns it on, the phone talks to **their own Google Drive** directly — there is
no Hisab server. Each phone keeps one file of its ledger in Hisab's app folder
in Drive (hidden from the person and from every other app, the
`drive.appdata` permission and nothing else), reads the other phones' files
and merges them: for each record the later change wins, deletions included
(`SyncFiles` and `Sync` in `android/core`, `DriveSync` in the app).

Google only lets an app ask for Drive access when the app is registered in a
Google Cloud project. That is a one-time job for whoever publishes the app;
the people who use it only see Google's usual "Allow Hisab to…" prompt.

## One-time set-up in Google Cloud

Use the project the website already uses for Google sign-in, or a new one.

1. **Turn on the Drive API.** Google Cloud console → *APIs & Services* →
   *Library* → "Google Drive API" → *Enable*.
2. **Add the permission to the consent screen.** *Google Auth Platform* →
   *Data access* → *Add or remove scopes* → tick
   `.../auth/drive.appdata` ("See, create, and delete its own configuration
   data in your Google Drive") → *Update* → *Save*. It is not a sensitive
   permission, so Google doesn't need to review the app for it.
3. **Make it available to everyone.** *Google Auth Platform* → *Audience* →
   *Publish app* (in "Testing", only the test users you list can connect, and
   Google drops their access after seven days).
4. **Register the Android app.** *Google Auth Platform* → *Clients* →
   *Create client* → type **Android**:
   - Package name: `io.github.fr_ost.hisab` (`hisabApplicationId` in
     `android/gradle.properties`).
   - SHA-1 certificate fingerprint: the one the app is signed with. Every
     build's summary on GitHub (Actions → "Android app") prints it, under
     "For Google Drive sync". Or, with the upload key file:
     `keytool -list -v -keystore hisab-upload.p12 -storetype pkcs12 -alias hisab`.

   Create **one Android client per certificate**:
   - the upload key (`ANDROID_SIGNING_KEY`) — for the `hisab.apk` the
     workflow builds and installs from GitHub;
   - Google Play's app signing key, once the app is on Play — Play Console →
     *Test and release* → *Setup* → *App signing* → "App signing key
     certificate" → SHA-1. People who install from Play run this one.

   Android clients have no secret: there is nothing to copy into the app or
   into GitHub. Google recognises the app by its package and signature.

Debug builds (`io.github.fr_ost.hisab.debug`) are signed with a different key
each time CI runs, so Drive sync isn't expected to work in them.

## What people see

- *More → Sync with Google Drive*: turn it on (Google asks once, on the phone,
  for the Google account and the permission), *Sync now*, turn it off, or
  remove Hisab's copy from Drive.
- A new phone: *Restore from Google Drive* on the first screen.
- If sync is turned on on a phone that already has a ledger while Drive holds
  another phone's, the app says the two will be combined first.
- Changes go up about half a minute after they are made, and the app syncs
  when it opens and every six hours (`SyncWorker`, only with a connection).
- SMS waiting for review stay on the phone that received them.

## If it doesn't connect

"Google Drive isn't set up for this copy of Hisab yet" means Google didn't
recognise the app: check the package name and SHA-1 of the Android client
against the build that is installed (a Play install needs the Play signing
key's SHA-1), and that the Drive API is enabled.
