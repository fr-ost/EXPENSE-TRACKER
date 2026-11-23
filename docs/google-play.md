# Publishing Hisab on Google Play

What to do, in order, to put the Android app (`android/`) on Google Play.
Most of it is filling in forms in the [Play Console](https://play.google.com/console);
the answers Hisab needs are below. Do the [Android app](../README.md#android-app)
set-up in the README first, so GitHub builds a signed `hisab.aab`.

The app works on its own: everything is kept on the phone, SMS are read on
the phone, and the only network use is the optional sync with the person's
own Google Drive. There is no server to run.

## Before the first upload

- **The app's id is `io.github.fr_ost.hisab`.** It can never change once the
  app is on Play. To use another, change `hisabApplicationId` in
  `android/gradle.properties` before uploading anything.
- **A public privacy policy.** Play needs a web address for it. The policy is
  [`docs/privacy-android.md`](privacy-android.md): if the repository is
  public, its GitHub address works as is; otherwise publish the same text on
  any public page you control (GitHub Pages, Google Sites, …).
- **Google Drive sync** needs the one-time Google Cloud set-up in
  [`docs/google-drive-android.md`](google-drive-android.md), including an
  Android client for Play's own signing key (step 6 below).

## 1. Developer account

Create one at <https://play.google.com/console/signup> (a one-time fee). A
new personal account must run a **closed test with at least 12 testers for
14 days in a row** before it can publish to everyone — plan for that.

## 2. Create the app

**Create app**: name *Hisab*, default language English, **App**, **Free**.

## 3. App content (Policy → App content)

| Form | Answer |
| --- | --- |
| Privacy policy | The public address of `docs/privacy-android.md` |
| App access | All functionality is available without special access: there is no sign-in. (Reading SMS needs a phone with a SIM; see the reviewer notes below.) |
| Ads | No ads |
| Content rating | Fill in the questionnaire: a utility / productivity app with no violence, no user-to-user communication, no gambling. |
| Target audience | 18 and over |
| News app | No |
| Data safety | See below |
| Financial features | Personal finance → budgeting / expense tracking. No loans, no payments, no banking services, no crypto. |
| Government app | No |
| Account deletion | The app doesn't let people create an account. |

### Data safety

Nothing reaches the developer. The only data that leaves the phone is the
person's own ledger, copied to **their own Google Drive** when they turn on
sync. Declare that copy (it is the cautious reading of Play's definition of
"collected"):

- **Does the app collect or share user data?** Yes, it collects (only with
  Google Drive sync on); it **shares nothing**.
- **Encrypted in transit:** yes (HTTPS to Google Drive). **Users can ask for
  their data to be deleted:** yes — *More → Sync with Google Drive → Remove
  Hisab's copy from Google Drive*, or Drive's own settings.
- **Data types** (all *optional*, *not shared*, purpose *App functionality*):

| Category | Type | Why |
| --- | --- | --- |
| Financial info | Other financial info | The ledger the person records, synced to their Google Drive |
| Messages | SMS or MMS | A bank or wallet message is kept as its transaction's note, so it is in the synced ledger |
| Personal info | Name | Only if the person types one in Preferences; synced with the ledger |

Nothing else: no location, no contacts, no device or advertising ids, no
analytics, no crash reports.

## 4. SMS permission declaration (Policy → App content → Sensitive permissions)

Hisab asks for `RECEIVE_SMS` and `READ_SMS`, which Google only allows for
certain uses. Hisab's is one of them.

- **Core functionality:** *SMS-based money management* — "Apps that track,
  manage, or budget personal finances, using SMS".
- **Describe how the app uses the permissions** (paste and adjust):

  > Hisab is a personal finance ledger that works on the phone. With the
  > user's permission, it reads the SMS alerts that banks and mobile wallets
  > (such as bKash and Nagad) send when money moves, and records each
  > transaction, its fee and the account balance in the user's ledger
  > automatically. RECEIVE_SMS reads new alerts as they arrive; READ_SMS is
  > used only when the user taps "Read the last 30 days". Only messages from
  > banks and wallets (alphanumeric senders and short codes, never personal
  > phone numbers) that mention an amount of money are read further;
  > messages from people and verification codes are not. Messages are read
  > on the phone and are never sent to the developer or anyone else. The
  > feature is off until the user turns it on, after a screen that explains
  > exactly what is read.

- **Video:** a short screen recording on a real phone: **More → Import SMS**,
  turning on **Read bank and wallet SMS**, the explanation and **Continue**,
  Android's SMS permission dialogs, a bank or wallet SMS arriving, the
  notification "Spent ৳… · …", and the entry in the app. Upload it to
  YouTube as *unlisted* and give the link.
- **Prominent disclosure:** the explanation dialog on Import SMS is shown
  before Android asks, says what is read and that nothing leaves the phone,
  and needs the user to press **Continue**.

## 5. Store listing (Grow → Store presence → Main store listing)

- **Short description** (80 characters): *Your private ledger. Bank and bKash
  SMS added for you, budgets and reports.*
- **Full description:** what Hisab does (accounts, transactions, budgets for
  Personal and Family, recurring entries, reports, several currencies),
  reading bank and wallet SMS (which messages; everything stays on the
  phone), sync between phones through the person's own Google Drive, backup
  files and CSV export, the app lock, and that there is no account and no
  server.
- **App icon:** 512×512 — `public/icons/icon-512.png`.
- **Feature graphic:** 1024×500, the logo on the dark ink colour (`#0e0e12`).
- **Phone screenshots:** at least two — the overview, activity, Import SMS,
  reports.
- **Category:** Finance. **Contact email:** required, shown publicly.

## 6. Testing, then production

1. **Test and release → Testing → Closed testing → Create track.** Upload
   `hisab.aab` from the latest **Android app** run on GitHub (its
   **Artifacts**). Add your testers' Google addresses (at least 12) and share
   the opt-in link with them.
2. Google asks to use **Play App Signing**: accept. Then copy the **app
   signing key certificate SHA-1** from **Test and release → App integrity →
   App signing** and create a second Android client with it in Google Cloud
   ([`docs/google-drive-android.md`](google-drive-android.md)), so Google
   Drive sync works in copies installed from Play.
3. After 14 days of testing, **apply for production** (Dashboard), then
   create a production release with the same bundle.

Every later version: push to `main`; the **Android app** workflow builds a
new `hisab.aab` with a higher version number; upload it as a new release.

## Notes for Google's reviewers

Paste into **App access → instructions** if asked:

> No sign-in: open the app, type a name (optional) and press Start. Add an
> account under Accounts → + (for example "City Bank 4567", type Bank). To
> try SMS reading on a phone with a SIM: More → Import SMS → turn on "Read
> bank and wallet SMS" → Continue → allow. Then send the phone an SMS from an
> alphanumeric sender or short code such as "Tk 500.00 spent at SHWAPNO on
> your A/C **4567. Avl Bal Tk 9,500.00". The entry appears with a
> notification. On an emulator:
> `adb emu sms send 16216 "Tk 500.00 spent at SHWAPNO on your A/C **4567. Avl Bal Tk 9,500.00"`.
> Without SMS, paste the same text on Import SMS and tap Read.

## Checking on a real phone

Before inviting testers, on your own Android phone:

- [ ] Install `hisab.apk` from the latest GitHub release; start a new ledger,
      or restore a backup file downloaded from the website.
- [ ] Add accounts and entries; balances, Activity, Reports and budgets agree.
- [ ] More → Import SMS → turn on → allow SMS and notifications.
- [ ] A real bank or bKash SMS arrives: a notification says what was added,
      and the entry and balance are right.
- [ ] A message from a person, and a verification code: nothing happens.
- [ ] Read the last 30 days: entries added, the rest waiting for a look.
- [ ] More → Sync with Google Drive → turn on → Google asks once → synced.
      On a second phone: Restore from Google Drive → the same ledger; an
      entry added on one appears on the other after opening it.
- [ ] App lock with a PIN and with the screen lock; it locks after the time
      away you chose, and not while picking a backup file.
- [ ] Save a backup file and a CSV export; restore the backup.
