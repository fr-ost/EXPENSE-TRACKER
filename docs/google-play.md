# Publishing Hisab on Google Play

What to do, in order, to put the Android app (`android/`) on Google Play.
Most of it is filling in forms in the [Play Console](https://play.google.com/console);
the answers Hisab needs are below. Do the [Android app](../README.md#android-app)
set-up in the README first, so GitHub builds a signed `hisab.aab`.

## Before the first upload

- **The app's id is `io.github.fr_ost.hisab`.** It can never change once the
  app is on Play. To use another (for example one based on your own domain),
  change `hisabApplicationId` in `android/gradle.properties` and
  `ANDROID_PACKAGE` in `src/lib/android.ts` together, before uploading
  anything.
- **The site must be live** at the address in `HISAB_URL`, with Google
  sign-in working, and its OAuth consent screen **published** (in Testing,
  only listed test users can sign in).

## 1. Developer account

Create one at <https://play.google.com/console/signup> (a one-time fee). A
new personal account must run a **closed test with at least 12 testers for
14 days in a row** before it can publish to everyone — plan for that.

## 2. Create the app

**Create app**: name *Hisab*, default language English, **App**, **Free**.

## 3. App content (Policy → App content)

| Form | Answer |
| --- | --- |
| Privacy policy | `https://YOUR-DOMAIN/privacy` |
| App access | All functionality is available without special access: anyone can sign in with a Google account, and a new account is created at the first sign-in. (Automatic SMS import needs an Android phone with a SIM; see the review notes below.) |
| Ads | No ads |
| Content rating | Fill in the questionnaire: a utility / productivity app with no violence, no user-to-user communication, no gambling. |
| Target audience | 18 and over |
| News app | No |
| Data safety | See below |
| Financial features | Personal finance → budgeting / expense tracking. No loans, no payments, no banking services, no crypto. |
| Government app | No |
| Account deletion | Yes, accounts can be created. Deletion link: `https://YOUR-DOMAIN/delete-account` (deletes everything, immediately). |

### Data safety

- **Does the app collect or share user data?** Yes, it collects; it shares
  nothing (the hosting provider and Google sign-in are service providers,
  which Play doesn't count as sharing).
- **Encrypted in transit:** yes. **Users can ask for their data to be
  deleted:** yes.
- **Data types collected** (all *not shared*, *not processed ephemerally*,
  purpose *App functionality* and *Account management* where it fits):

| Category | Type | Required? | Why |
| --- | --- | --- | --- |
| Personal info | Name | Required | Shown in the app; from Google sign-in |
| Personal info | Email address | Required | Sign-in, shown in Settings |
| Financial info | Other financial info | Required | The ledger the person records: accounts, transactions, balances, budgets |
| Messages | SMS or MMS | **Optional** (only with automatic SMS import turned on) | Bank and wallet messages about money, to add their transactions |

Nothing else: no location, no contacts, no device or advertising ids, no
analytics, no crash reports.

## 4. SMS permission declaration (Policy → App content → Sensitive permissions)

Hisab asks for `RECEIVE_SMS` and `READ_SMS`, which Google only allows for
certain uses. Hisab's is one of them.

- **Core functionality:** *SMS-based money management* — "Apps that track,
  manage, or budget personal finances, using SMS".
- **Describe how the app uses the permissions** (paste and adjust):

  > Hisab is a personal finance ledger. With the user's permission, it reads
  > the SMS alerts that banks and mobile wallets (such as bKash and Nagad)
  > send when money moves, and adds each transaction, its fee and the account
  > balance to the user's ledger automatically. RECEIVE_SMS reads new alerts
  > as they arrive; READ_SMS is used only if the user chooses, at set-up, to
  > bring in the last 30 days of alerts. On the phone, only messages from
  > banks and wallets (alphanumeric senders and short codes, never personal
  > phone numbers) that mention an amount of money are sent to the user's
  > account; messages from people and verification codes are never read
  > further or sent. The feature is off until the user turns it on, after a
  > screen that explains exactly what is read and sent.

- **Video:** a short screen recording on a real phone showing: the app's
  **Settings → Automatic SMS import → Set up on this phone**; the
  explanation screen and **Turn on**; Android's SMS permission dialog; a
  bank or wallet SMS arriving; the notification "Spent ৳… · …"; and the
  transaction in the app. Upload it to YouTube as *unlisted* and give the
  link.
- **Prominent disclosure:** the explanation screen (`SmsSetupActivity`) is
  shown before Android asks, says what is read, what is sent and why, and
  needs the user to press **Turn on**.

## 5. Store listing (Grow → Store presence → Main store listing)

- **Short description** (80 characters): *Your private ledger. Bank and bKash
  SMS added for you, budgets and reports.*
- **Full description:** what Hisab does (accounts, transactions, budgets for
  Personal and Family, reports, several currencies), automatic SMS import
  (which messages, what stays on the phone), Google sign-in, backups to the
  user's own Google Drive, the app lock, and that the ledger is private.
- **App icon:** 512×512 — `public/icons/icon-512.png`.
- **Feature graphic:** 1024×500, the logo on the dark ink colour (`#0e0e12`).
- **Phone screenshots:** at least two — the overview, a transaction list,
  Import SMS, budgets.
- **Category:** Finance. **Contact email:** required, shown publicly.

## 6. Testing, then production

1. **Test and release → Testing → Closed testing → Create track.** Upload
   `hisab.aab` from the latest **Android app** run on GitHub (its
   **Artifacts**). Add your testers' Google addresses (at least 12) and share
   the opt-in link with them.
2. Google asks to use **Play App Signing**: accept. Then copy the **app
   signing key certificate SHA-256 fingerprint** from **Test and release →
   App integrity → App signing** into the server's `ANDROID_CERT_SHA256`
   variable on Railway and redeploy, so copies installed from Play open
   without an address bar. Check `https://YOUR-DOMAIN/.well-known/assetlinks.json`
   lists it.
3. After 14 days of testing, **apply for production** (Dashboard), then
   create a production release with the same bundle.

Every later version: push to `main`; the **Android app** workflow builds a
new `hisab.aab` with a higher version number; upload it as a new release.
Changes to the site itself need no new app version.

## Notes for Google's reviewers

Paste into **App access → instructions** if asked:

> Sign in with any Google account; a new, empty account is created. To try
> automatic SMS import on a phone with a SIM: open Settings in the app,
> choose "Set up on this phone", read the explanation and press "Turn on",
> allow SMS. Then send the phone an SMS from an alphanumeric sender or short
> code such as "Tk 500.00 spent at SHWAPNO on your A/C **4567. Avl Bal Tk
> 9,500.00" — first add an account named "City Bank 4567" (Accounts → New).
> The transaction appears with a notification. On an emulator:
> `adb emu sms send 16216 "Tk 500.00 spent at SHWAPNO on your A/C **4567. Avl Bal Tk 9,500.00"`.

## Checking on a real phone

Before inviting testers, on your own Android phone:

- [ ] Install `hisab.apk` from the latest GitHub release; the app opens the
      site full screen, with no address bar once the site vouches for it.
- [ ] Sign in with Google inside the app; close and reopen it — still signed in.
- [ ] Back button, keyboard over a form, sharing an SMS to Hisab.
- [ ] Settings → Automatic SMS import → Set up on this phone → the
      explanation shows your Google address → Turn on → allow SMS.
- [ ] A real bank or bKash SMS arrives: a notification says what was added,
      and the transaction and balance are right.
- [ ] A message from a person, and a verification code: nothing happens.
- [ ] Airplane mode, receive an SMS, back online: it is added then.
- [ ] Remove the phone in Settings; the next SMS isn't sent, and the phone
      says automatic import stopped.
