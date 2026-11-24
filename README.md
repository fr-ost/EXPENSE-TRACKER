<div align="center">

<img width="100%" alt="Hisab — a private personal finance ledger" src="https://capsule-render.vercel.app/api?type=rounded&amp;color=0:042F2E,75:0F766E,100:5EEAD4&amp;height=210&amp;section=header&amp;text=Hisab&amp;fontSize=70&amp;fontColor=ffffff&amp;fontAlignY=38&amp;animation=fadeIn&amp;desc=Private%20ledger%20%C2%B7%20exact%20with%20money&amp;descAlignY=64&amp;descSize=18"/>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://readme-typing-svg.demolab.com?font=IBM+Plex+Sans&amp;weight=500&amp;size=22&amp;duration=3200&amp;pause=800&amp;color=5EEAD4&amp;center=true&amp;vCenter=true&amp;width=760&amp;height=46&amp;lines=Private+personal+finance+ledger;Income%2C+expenses%2C+transfers%2C+budgets;Exact+with+money%2C+every+day;Google+sign-in.+Your+ledger%2C+alone;Offline+Android+app%2C+on+the+phone" />
  <source media="(prefers-color-scheme: light)" srcset="https://readme-typing-svg.demolab.com?font=IBM+Plex+Sans&amp;weight=500&amp;size=22&amp;duration=3200&amp;pause=800&amp;color=0F766E&amp;center=true&amp;vCenter=true&amp;width=760&amp;height=46&amp;lines=Private+personal+finance+ledger;Income%2C+expenses%2C+transfers%2C+budgets;Exact+with+money%2C+every+day;Google+sign-in.+Your+ledger%2C+alone;Offline+Android+app%2C+on+the+phone" />
  <img width="760" alt="Private personal finance ledger. Income, expenses, transfers, budgets. Exact with money, every day. Google sign-in. Your ledger, alone. Offline Android app, on the phone." src="https://readme-typing-svg.demolab.com?font=IBM+Plex+Sans&amp;weight=500&amp;size=22&amp;duration=3200&amp;pause=800&amp;color=0F766E&amp;center=true&amp;vCenter=true&amp;width=760&amp;height=46&amp;lines=Private+personal+finance+ledger;Income%2C+expenses%2C+transfers%2C+budgets;Exact+with+money%2C+every+day;Google+sign-in.+Your+ledger%2C+alone;Offline+Android+app%2C+on+the+phone" />
</picture>

<br/>

<img alt="Hisab, a private ledger" src="https://img.shields.io/badge/Hisab-private_ledger-0F766E?style=flat-square&amp;labelColor=5EEAD4"/>
<img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-0F766E?style=flat-square&amp;logo=typescript&amp;logoColor=white"/>
<img alt="Next.js 16" src="https://img.shields.io/badge/Next.js_16-115E59?style=flat-square&amp;logo=nextdotjs&amp;logoColor=white"/>
<img alt="React 19" src="https://img.shields.io/badge/React_19-0F766E?style=flat-square&amp;logo=react&amp;logoColor=white"/>
<img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-134E4A?style=flat-square&amp;logo=postgresql&amp;logoColor=white"/>
<img alt="Prisma 7" src="https://img.shields.io/badge/Prisma_7-0F766E?style=flat-square&amp;logo=prisma&amp;logoColor=white"/>
<img alt="Tailwind CSS 4" src="https://img.shields.io/badge/Tailwind_CSS_4-5EEAD4?style=flat-square&amp;logo=tailwindcss&amp;logoColor=042F2E"/>

<br/>

<img alt="Node.js 22" src="https://img.shields.io/badge/Node.js_22-99F6E4?style=flat-square&amp;logo=nodedotjs&amp;logoColor=042F2E"/>
<img alt="Installable PWA" src="https://img.shields.io/badge/PWA-5EEAD4?style=flat-square&amp;logo=pwa&amp;logoColor=042F2E"/>
<img alt="Android" src="https://img.shields.io/badge/Android-0F766E?style=flat-square&amp;logo=android&amp;logoColor=white"/>
<img alt="Kotlin" src="https://img.shields.io/badge/Kotlin-115E59?style=flat-square&amp;logo=kotlin&amp;logoColor=white"/>
<img alt="Railway" src="https://img.shields.io/badge/Railway-134E4A?style=flat-square&amp;logo=railway&amp;logoColor=white"/>
<a href="https://github.com/fr-ost/EXPENSE-TRACKER/actions/workflows/android.yml"><img alt="Android app workflow on GitHub Actions" src="https://img.shields.io/github/actions/workflow/status/fr-ost/EXPENSE-TRACKER/android.yml?branch=main&amp;style=flat-square&amp;logo=githubactions&amp;logoColor=white&amp;label=Android%20CI&amp;labelColor=0F766E"/></a>

</div>

*Hisab* (হিসাব) means "the accounts". Income, expenses, transfers, budgets, recurring payments and reports — exact with money, and pleasant to use every day, on a phone or a desktop. People sign in with **Google**. Each person has a ledger nobody else can see. Rename the app by changing `APP_NAME` in `src/lib/domain.ts`.

### At a glance

| Balances | Sign-in | Web | Phone |
| --- | --- | --- | --- |
| Derived from the ledger, never stored. An opening balance or a later balance update is an anchor: entries dated before it do not move the balance after it. | Google. One ledger per person. An optional PIN locks the app. | Install it from Chrome or Edge, or add it to the iPhone home screen. | `android/` works offline. No server, no account, no internet permission. |

### In this file

| | |
| --- | --- |
| [01 · Overview](#overview) | The two apps, and the shared backup file |
| [02 · Features](#key-features) | Accounts, entries, SMS, budgets, reports, backup |
| [03 · Stack](#tech-stack) | What the web app, the phone app, and CI actually use |
| [04 · Getting started](#getting-started) | Local install, Node 22, Postgres |
| [05 · Configuration](#configuration) | Environment variable names, and test-only variables |
| [06 · Railway](#deploying-to-railway) | Deploy, Google OAuth, Drive, upgrading from a password |
| [07 · Day to day](#usage) | Where each action lives in the app |
| [08 · Install](#installing-the-app) | Chrome, Edge, iPhone |
| [09 · Android](#android-app) | The offline app, signing, releases |
| [10 · SMS](#importing-from-sms) | Paste or share a bank message |
| [11 · Rules](#financial-rules) | How income, spending, transfers and balances are counted |
| [12 · Architecture](#architecture) | Money, users, ledger, writes |
| [13 · Security](#security) | Sign-in, sessions, PIN, Drive, CSRF |
| [14 · Testing](#testing) | Lint, unit, integration, end to end |
| [15 · Limits](#known-limitations) | What the ledger does not do |
| [16 · Files](#project-structure) | Where the code lives |
| [17 · Credits](#credits) | Shahriar Ahmed and Unique Labs |

---

<a id="overview"></a>

## 01 · Overview

Hisab is a personal finance ledger. Balances are never stored: they are derived from the transactions. The opening balance and each later balance update are anchors, and a transaction dated before an anchor never changes the balance after it.

The same rules run in two places:

| | |
| --- | --- |
| **Web app** | A Next.js app on PostgreSQL. Install it from Chrome or Edge, or add it to the iPhone home screen. Sign in with Google. Optional backups go to a hidden folder in your own Google Drive. |
| **Android app** | `android/` is an app of its own. It works offline, has no account and no internet permission, and keeps everything on the phone. It reads bank and wallet SMS on the device. |

A backup file from the website restores into the Android app, and the other way around. Both speak the same `hisab-backup` format.

<a id="key-features"></a>

## 02 · Features

| Line | What it does |
| --- | --- |
| **Accounts** | Cash, bank, bKash / Nagad, cards, exchanges — any currency. Balances are always derived from the ledger, never stored. The total adds every currency up in the main one (taka and dollars together), with each currency's own amount beside it. |
| **Transactions** | Expenses, income and transfers, with fast entry (`N` on desktop, the ＋ tab on phones), an optional time of day, historical back-filling, search, filters, sorting, pagination, and CSV / Excel export of any filtered view. |
| **Import from SMS** | Paste bank or bKash / Nagad / Rocket messages (or share them to the installed app on Android). Hisab reads the amount, bank, type, date and time and adds them — never the same message twice — and the balance in the newest message *replaces* the account's balance (nothing is added on top). A message that only reports a balance ("your balance is Tk 8,000") sets it too. |
| **Update balance** | Enter what an account actually holds; Hisab corrects for whatever wasn't recorded. Older transactions added later never change a balance after it, so back-filling history can't push a balance negative. Any transaction can also be kept out of the balance. |
| **Transfers that can count as spending** | Money moves once between accounts. Optionally it is also recognised as an expense (for example support sent to family) without being double counted. |
| **Personal / Family** | Every expense has "spent for", with its own analytics. |
| **Income in dollars, spending in taka** | Each type starts on an account in its usual currency (Settings). Other currencies count in every total at your exchange rate, or at the rate of your latest conversion. |
| **Dashboard** | A time-of-day greeting, total balance, the month at a glance with deltas, cash flow, spending pace, where the money went, budgets, recent activity. |
| **Budgets** | One monthly limit for Personal and one for Family: everything marked as spent for it counts, whatever the category or currency. Effective-dated (changing a budget never rewrites past months), calm warnings at 80% / 100% / over. |
| **Recurring transactions** | Weekly / monthly / yearly, posted exactly once. |
| **Reports** | Monthly and yearly statements, category, personal & family, income sources, savings trend, account activity. PDF (Bengali names included) and Excel exports. |
| **Backup and restore** | Connect Google Drive and Hisab keeps a backup there on its own: a new copy on any day the ledger has changed, the last ten kept, in a folder of Hisab's own (it can't see anything else in Drive). Or download everything as one file. Either can be restored later, into the same account or another. A restore replaces what is there, all at once or not at all. |
| **Your own account** | Sign in with Google (the account is created the first time). Everything you record belongs to you alone. An optional PIN locks the app after a while without activity. Delete the account, and everything in it, from Settings. |

<a id="tech-stack"></a>

## 03 · Stack

<div align="center">

<img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-0F766E?style=flat-square&amp;logo=typescript&amp;logoColor=white"/>
<img alt="Next.js 16" src="https://img.shields.io/badge/Next.js_16-115E59?style=flat-square&amp;logo=nextdotjs&amp;logoColor=white"/>
<img alt="React 19" src="https://img.shields.io/badge/React_19-0F766E?style=flat-square&amp;logo=react&amp;logoColor=white"/>
<img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-134E4A?style=flat-square&amp;logo=postgresql&amp;logoColor=white"/>
<img alt="Prisma 7" src="https://img.shields.io/badge/Prisma_7-0F766E?style=flat-square&amp;logo=prisma&amp;logoColor=white"/>
<img alt="Tailwind CSS 4" src="https://img.shields.io/badge/Tailwind_CSS_4-5EEAD4?style=flat-square&amp;logo=tailwindcss&amp;logoColor=042F2E"/>
<img alt="Node.js 22" src="https://img.shields.io/badge/Node.js_22-99F6E4?style=flat-square&amp;logo=nodedotjs&amp;logoColor=042F2E"/>
<img alt="Kotlin" src="https://img.shields.io/badge/Kotlin-115E59?style=flat-square&amp;logo=kotlin&amp;logoColor=white"/>
<img alt="Jetpack Compose" src="https://img.shields.io/badge/Jetpack_Compose-0F766E?style=flat-square&amp;logo=jetpackcompose&amp;logoColor=white"/>
<img alt="Vitest" src="https://img.shields.io/badge/Vitest-134E4A?style=flat-square&amp;logo=vitest&amp;logoColor=white"/>
<img alt="Playwright" src="https://img.shields.io/badge/Playwright-5EEAD4?style=flat-square&amp;logo=playwright&amp;logoColor=042F2E"/>
<img alt="Railway" src="https://img.shields.io/badge/Railway-0F766E?style=flat-square&amp;logo=railway&amp;logoColor=white"/>

</div>

| Layer | What this repo uses |
| --- | --- |
| Web app | Next.js 16 (App Router), React 19, TypeScript, on Node.js 22 |
| Data | PostgreSQL 14+ through Prisma 7. Money is `NUMERIC(14,2)`; arithmetic uses `bigint` minor units |
| Interface | Tailwind CSS 4, Radix primitives, Motion, Recharts, Sonner, Vaul |
| Sign-in | Google (OpenID Connect, authorization-code flow with PKCE). Optional PIN lock |
| Files | ExcelJS, PDFKit, Noto Sans Bengali (SIL OFL) for PDF reports |
| Phone | Kotlin and Jetpack Compose in `android/`. Offline. No internet permission |
| Checks | ESLint, TypeScript, Vitest against a real Postgres, Playwright end to end |
| Hosting | Railway. `railway.json` builds with `npm run build`, starts with `npm start`, and checks `/api/health` |
| Android CI | [`.github/workflows/android.yml`](.github/workflows/android.yml) — the only workflow in this repo. It builds and tests the phone app |

<a id="getting-started"></a>

## 04 · Getting started

Local requirements: **Node.js 22** and **PostgreSQL 14+**.

```bash
npm install                      # also generates the Prisma client
cp .env.example .env             # then set DATABASE_URL and the Google client (see Configuration)
npm run db:deploy                # apply migrations (tables, views, default categories)
npm run dev                      # http://localhost:3000
```

For Google sign-in on your machine, the authorised redirect URI is `http://localhost:3000/api/auth/google/callback`. Variable names are in [Configuration](#configuration). If the Google variables are missing, the app still starts and the sign-in page explains what to set.

Changing the schema later: edit `prisma/schema.prisma`, run `npm run db:migrate -- --name <change>`, and commit the generated migration. After changing the logo, run `node scripts/generate-icons.mjs` to re-render the icons.

**Production build locally:** `npm run build && npm start` (uses `PORT`, default 3000). The service worker is only registered in production builds.

Deploying for real: [Railway](#deploying-to-railway).

<a id="configuration"></a>

## 05 · Configuration

Copy [`.env.example`](.env.example) to `.env` for local development. On Railway, set the same names as service variables. Never commit real values. This table names the variables only.

### Application

| Variable | When | What to put |
| --- | --- | --- |
| `DATABASE_URL` | Required | PostgreSQL connection string. On Railway, a reference to the database service: `${{Postgres.DATABASE_URL}}` |
| `GOOGLE_CLIENT_ID` | Required to sign in | OAuth client ID of a **Web application** from the Google Cloud console |
| `GOOGLE_CLIENT_SECRET` | Required to sign in | That client's secret. It also seals stored Drive permissions: changing it means everyone connects Drive again |
| `OWNER_EMAIL` | Upgrade only | The Google address that should take over the ledger from the old password version. Remove it afterwards. See [Upgrading](#upgrading-from-the-password-version) |
| `APP_URL` | Optional | The app's public address (`https://YOUR-DOMAIN`), when it isn't the one requests arrive at |
| `CONTACT_EMAIL` | Optional | An address for questions, shown on the privacy policy (`/privacy`). Without it, the policy points at the contact on the Google Play listing |
| `ANDROID_CERT_SHA256` | Optional | SHA-256 fingerprints of the certificates a genuine Android copy is signed with, separated by commas (Play Console → Test and release → App integrity). With them the site vouches for the app (`/.well-known/assetlinks.json`). The Android app in this repository works on its own |
| `DATABASE_POOL_SIZE` | Optional | Postgres connections per server process. Default `10` |
| `PORT` | Optional | Port for `npm start`. Default `3000` |

`RAILWAY_GIT_COMMIT_SHA` is set by Railway. **Settings → App** shows it as the running version. You do not set it yourself.

Authorised redirect URI, once, on the OAuth client:

- Production: `https://YOUR-DOMAIN/api/auth/google/callback`
- Local: `http://localhost:3000/api/auth/google/callback`

Drive backups also need the **Google Drive API** enabled and this scope on the consent screen: `https://www.googleapis.com/auth/drive.appdata`.

### Tests

These are for local checks. The suites wipe the database on every run, so the database name **must end in `_test`** — they refuse to run otherwise.

| Variable | Default | What it is |
| --- | --- | --- |
| `TEST_DATABASE_URL` | `postgresql://ledger:ledger@localhost:5432/ledger_test?schema=public` | Integration tests (`npm test`) |
| `E2E_DATABASE_URL` | `postgresql://ledger:ledger@localhost:5432/ledger_e2e_test?schema=public` | End-to-end tests |
| `E2E_PORT` | `3200` | Port the e2e app listens on |
| `FAKE_GOOGLE_PORT` | `3201` | Port of the local Google stand-in |
| `GOOGLE_TEST_ORIGIN` | unset | Selects `tests/e2e/fake-google.mjs`. **Tests only. Never set this on a deployment** |
| `CHROMIUM_PATH` | unset | An installed Chromium for e2e tests and for `node scripts/generate-icons.mjs`, instead of `npx playwright install chromium` |

### Android signing

Not environment variables of the website. GitHub Actions secrets `ANDROID_SIGNING_KEY` and `ANDROID_SIGNING_PASSWORD` sign the installable app. How to create them is under [Android](#android-app).

<a id="deploying-to-railway"></a>

## 06 · Railway

1. **Create a project** and add a **PostgreSQL** database service.
2. **Add a service from this GitHub repository**, deploying the `main` branch (service **Settings → Source → Branch**). Every push to `main` deploys. Railway reads `railway.json`: it builds with `npm run build`, and `npm start` applies the database migrations and starts the app. The health check is `/api/health`.
3. **Generate the domain** (service **Settings → Networking → Generate domain**). Google needs the address before anyone can sign in.
4. **Connect it to Google** (once, in the [Google Cloud console](https://console.cloud.google.com/)):
   1. Create a project, and set up its OAuth consent screen (app name and your email; audience **External**). No extra scopes are needed for sign-in — Hisab only asks who you are.
   2. Create an **OAuth client ID** of type **Web application**. Under **Authorised redirect URIs** add exactly `https://YOUR-DOMAIN/api/auth/google/callback`.
   3. Copy the client ID and the client secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
   4. For backups to Google Drive: enable the **Google Drive API** for the project, and add the scope `https://www.googleapis.com/auth/drive.appdata` to the consent screen ("See, create, and delete its own configuration data in your Google Drive"). It is a non-sensitive scope: Hisab only gets a hidden folder of its own, never the rest of anyone's Drive.
   5. While the consent screen is in **Testing**, only the test users you list can sign in — and Google ends every Drive permission after seven days, so backups stop until Drive is connected again. **Publish** the consent screen when anyone should be able to sign in.
5. **Set the variables** on the service (**Variables** tab). Names and meaning: [Configuration](#configuration). The minimum is `DATABASE_URL` (`${{Postgres.DATABASE_URL}}`), `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Set `OWNER_EMAIL` only when upgrading.
6. **Deploy**, open the domain and choose **Continue with Google**. The account is created the first time you sign in, with the usual categories, Bangladeshi taka and the browser's timezone — all editable in Settings.

If the Google variables are missing, the app still starts and the sign-in page explains what to set.

<a id="upgrading-from-the-password-version"></a>

### Upgrading from the password version

> Earlier versions had one owner who signed in with an `ADMIN_PASSWORD` variable. Set `OWNER_EMAIL` **before** deploying this version, then delete `ADMIN_PASSWORD`. The app lock becomes a PIN.

That ledger is kept, and goes to its owner's Google account: set `OWNER_EMAIL` to the Google address you will sign in with. The first sign-in with that address (Google must have verified it) takes the ledger over. From then on it belongs to that Google account, and the variable can be removed. Anyone else who signs in gets a new, empty account. `ADMIN_PASSWORD` is no longer used. An app lock that asked for the password now asks for a PIN you set in **Settings → App lock**.

### Which version is running

**Settings → App** shows the deployed commit (Railway's `RAILWAY_GIT_COMMIT_SHA`), matching the latest commit once a deploy has finished. An app window left open reloads itself on its next page change after a new deploy. If it shows an older commit, check that the service deploys `main` and that the latest deploy succeeded (**Deployments** tab; a failed one shows why under **⋯ → View logs**). Error screens show the version too, next to what went wrong.

<a id="usage"></a>

## 07 · Day to day

| You want to | Where |
| --- | --- |
| Record a transaction | `N` on desktop, the ＋ tab on phones. Optional time of day. Search, filter, sort, paginate, then export that view as CSV or Excel |
| Move money | A transfer between your accounts. Mark it to count as an expense when it really was spending (support sent to family) so it is not counted twice |
| Say who it was for | **Personal** or **Family** on the expense ("spent for") |
| Match the real balance | **Update balance**, or let an SMS do it. See [Rules](#financial-rules) |
| Bring in a bank message | **Import SMS**, or on Android long-press the message and **Share → Hisab**. See [SMS](#importing-from-sms) |
| See the month | The dashboard: greeting, total, deltas, cash flow, spending pace, categories, budgets, recent activity |
| Set a limit | One monthly budget for Personal, one for Family. Warnings at 80%, 100%, and over |
| Repeat a payment | Recurring: weekly, monthly, or yearly. Posted once per date |
| Export a statement | **Reports**: monthly and yearly, PDF (Bengali names included) or Excel |
| Keep a copy | **Settings → Backup and restore**: one file, or Google Drive (last ten, Hisab's hidden folder) |
| Lock the screen | **Settings → App lock**. A PIN you choose. Nothing locks until you set one |
| Remove everything | Settings, after typing `DELETE`. `/delete-account` explains this publicly |

Currencies: Settings chooses the main currency, the usual account for income, and the usual account for spending. **Settings → Exchange rates** holds your rates. A currency with no rate is shown and left out of converted totals.

<a id="installing-the-app"></a>

## 08 · Install

- **Chrome or Edge (Windows, macOS, ChromeOS, Android):** use **Install app** in the sidebar, the phone's **More** menu, the banner on the overview, or **Settings → App** — or the install icon in the address bar.
- **iPhone / iPad:** in Safari, tap **Share → Add to Home Screen**.

The installed app opens full screen with its own icon, has shortcuts for a new transaction, SMS import and reports, and on Android appears in the share sheet: long-press a bank SMS, **Share → Hisab**, and it is added.

<a id="android-app"></a>

## 09 · Android

`android/` is **Hisab for Android**, an app of its own that works completely offline: no server, no account, no internet permission — everything is kept on the phone.

- **Everything the website does, on the phone** — accounts in any currency, entries, transfers that can count as spending, balance updates, Personal / Family, budgets, recurring entries, reports, exchange rates, backup files and CSV export. The ledger rules are the website's, ported to Kotlin (`android/core`) and checked by the website's own tests.
- **Bank and wallet SMS, read on the phone** — turn it on in **More → Import SMS** (the app says what it reads before Android asks). Only messages from a bank or wallet (a name like "bKash" or a short code, never a person's number) that are about money are read. Messages from people, and codes, never are. Each is read by the website's own reader (`android/core/.../sms`, checked against fixtures the website's reader made):
  - **clear and certain** — added at once, with its fee and the balance it reports, and a notification says what was added;
  - **not a transaction** (an advert, a failed payment) — dropped;
  - **anything else** (no matching account, unclear, something similar already recorded) — waits on Import SMS for a look.

  It can also read the last 30 days of the inbox, and pasted messages work as on the website. Nothing is sent anywhere.
- **Backup files** — save everything to a file wherever you like, and restore it on this phone or another one. Backups to the cloud come later.
- **Moving from the website** — download a backup on the website (**Settings → Backup and restore**) and restore it in the app. Same file format.
- **App lock** — a PIN of its own, or the phone's screen lock (fingerprint, face, the phone's PIN).

GitHub builds it ([`.github/workflows/android.yml`](.github/workflows/android.yml)) on every push that touches `android/`, runs every test, and keeps the result under the repository's **Actions** tab (the Android SDK isn't needed anywhere else). You can also run it by hand: **Actions → Android app → Run workflow**.

Before the build makes an app you can install, it needs **the signing key**, once. Every copy of an Android app is signed, and Google Play only takes updates signed with the same key. In the repository's **Settings → Secrets and variables → Actions → Secrets → New repository secret**, add:

| Secret | What it is |
| --- | --- |
| `ANDROID_SIGNING_KEY` | The text of the key file, in base64 |
| `ANDROID_SIGNING_PASSWORD` | The password for that key and the keystore |

Keep a copy of both somewhere safe, outside GitHub. To make a key:

```bash
keytool -genkeypair -keystore hisab-upload.p12 -storetype PKCS12 -alias hisab -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=Hisab"
```

Then `base64 -w 0 hisab-upload.p12` gives the secret's text (use the same password for the key and the keystore).

The run's summary says what is still missing, if anything. When it's complete it keeps **hisab.apk** (installs on a phone) and **hisab.aab** (for Google Play) under the run's **Artifacts**. Builds of `main` are also published as a GitHub release, so the latest APK is always at the repository's **Releases**.

Publishing on Google Play: [docs/google-play.md](docs/google-play.md). The app's privacy policy: [docs/privacy-android.md](docs/privacy-android.md).

<a id="importing-from-sms"></a>

## 10 · SMS

Open **Import SMS**, paste one message or several (blank lines or one per line separate them), or tap **Paste**. For each message Hisab reads the amount, direction (money in or out), bank or wallet, account digits, date and time, fee, reported balance and merchant, then builds the transaction.

- **Which account** — the bank or wallet name in the message, the last digits of the account or card (name your accounts like `City Bank 4567`), or the account you picked last time for that bank. No account for it yet? The message offers **Add … account** right there, filled in from the SMS (the opening balance is what it held just before the message). The waiting messages then match it and are added.
- **What kind** — payments and purchases are expenses, deposits and salary are income. Cash outs and ATM withdrawals are **transfers to your Cash account**, and money moved from your bank to bKash is a transfer too, so nothing is counted as spending twice. Fees become separate expenses.
- **Category** — from the merchant (Daraz → Shopping, Foodpanda → Food…), or whatever you chose last time for the same description.

With **Add automatically when certain** on, messages that clearly match one of your accounts are added as soon as you paste them (with Undo). Anything uncertain waits for a quick review with the normal transaction fields.

The same message is never added twice (on any device), and a message that looks like something already recorded — typed in by hand, or the other side of a transfer imported from the other bank's SMS — is flagged instead of added. OTPs, adverts, failed transactions and reminders are skipped.

### Balances from SMS

bKash, Nagad and most bank alerts end with the balance after the transaction. Adding such a message also records that balance as a balance update for the account (a switch on each message turns this off), so payments that never sent an SMS are corrected for automatically. Hisab shows whether its own balance agreed.

- A message added before (even before balances were read) records its balance when pasted again.
- A message flagged as already recorded — typed in by hand earlier — offers **It's the same one**: the SMS is linked to that transaction (which takes the SMS's date and time) and sets the balance, without counting it twice.
- A card's available limit is never taken as a balance, a balance in another currency is ignored, and a message older than the account's latest balance only fills in history. Undo removes the balance a message set.

Works with bKash, Nagad, Rocket, Upay and alerts from Bangladeshi banks and cards (DBBL, City, BRAC, EBL, Islami Bank, Standard Chartered and about 40 more), in English or Bengali. The original message is kept in the transaction's notes.

<a id="financial-rules"></a>

## 11 · Rules

These rules are implemented once, in SQL views (`TransactionLeg`, `BalanceCorrection`, `LedgerEntry`, `ExpenseEntry`, `IncomeEntry`), and every screen, report and export reads from them.

| Recorded as | Source account | Destination account | Counted as income | Counted as spending |
| --- | --- | --- | --- | --- |
| Income | + amount | — | yes | no |
| Expense | − amount | — | no | yes (its category) |
| Transfer | − amount | + amount | no | no |
| Transfer, *count as expense* | − amount | + amount | no | yes (its category) |
| Any of the above, *kept out of the balance* | — | — | as above | as above |
| Balance correction (from a balance update) | ± difference | — | no | no |

- **Known balances.** The opening balance is what an account held at the start of its date. A **balance update** (entered with *Update balance*, or read from an SMS) is what it held at a moment. Every known balance holds exactly: Hisab adds a correction for whatever the recorded transactions don't explain since the previous one. You can instead record the difference as *Unrecorded spending* or *income* in a category, so it counts in reports.
- **Balance** at any moment = the latest known balance before it + every movement after that. So a transaction dated before a known balance — last month's spending added today, or anything before the opening date — never changes the balance after it. It only shapes the history before it. Deleting a balance update hands its correction to the next one.
- **Within a day**, an entry's time decides. An entry without a time counts from the moment it was recorded if that was the same day, and otherwise at the end of its day. A balance update comes after the entries at the same moment.
- **Kept out of the balance** — *Don't change the balance* on a transaction keeps it in income, spending and reports without moving any balance (for example spending the balance already reflects).
- Future-dated entries are shown as scheduled and excluded until their date.
- **Savings** = income − spending. **Savings rate** = savings ÷ income.
- **Transfers** in reports are pure movements between your accounts. Transfers marked as expenses are reported separately (and included in spending), so every transfer lands in exactly one bucket.
- Totals and analytics are in your **main currency** (Settings). Other currencies count at their **exchange rate**: yours (**Settings → Exchange rates**), or else the rate of your latest conversion between the two (a transfer with the amount received). Each amount is converted and rounded on its own, so every breakdown adds up to its total. A currency with no rate yet is shown but not counted. Changing a rate re-values every total.

<a id="architecture"></a>

## 12 · Architecture

A single Next.js 16 (App Router) application with PostgreSQL via Prisma 7.

| Concern | Decision |
| --- | --- |
| Money | `NUMERIC(14,2)` in Postgres; decimal strings over the wire; `bigint` minor units for any arithmetic in TypeScript (`src/lib/money.ts`). Floats are used only to draw charts. |
| Users | Every row carries its owner (`userId`). Every service takes the signed-in user's id first and puts it in every query. References between rows are composite foreign keys on `(userId, id)`, so the database itself refuses one user's entry on another's account or category. |
| Backups | A backup is one JSON file of everything a person recorded. A restore replaces their data in one transaction and never trusts the file: every row is checked, references must resolve inside the file, and rows get new ids. Drive backups are that file, compressed, in the app's hidden folder of the person's Drive. The server keeps only the permission (encrypted) and when a backup last got there. |
| Ledger | No stored balances. Views expand transactions into signed per-account movements and derive the correction that makes each known balance (opening balance, balance updates) hold. Postgres sums them in milliseconds for a personal data set (about 80 ms for every account at 30,000 transactions). |
| Invariants | CHECK constraints make invalid rows impossible (transfer to the same account, expense without a category, zero or negative amounts, malformed times, an adjustment kept out of the balance…). Entry rules that need other rows (active accounts, category kinds, currencies) live in one function, `resolveEntry`, run under row locks. |
| Reads / writes | Server Components read through a service layer (`src/lib/server/services`). Writes go through REST route handlers under `/api`, then the client refreshes server data in place — no full reloads. |
| Idempotency | Each "new transaction" sheet carries an idempotency key; retries and double clicks return the original row. SMS imports use a key derived from the message text. Recurring occurrences are unique per (rule, date) and posted under `FOR UPDATE SKIP LOCKED`. |
| Dates | Calendar dates (`DATE`) plus an optional time of day. "Today" is resolved in your timezone (Settings). Formatting is deterministic so server and browser always agree. |
| SMS | The parser (`src/lib/sms`) is pure TypeScript and runs in the browser as you paste. The server re-validates every entry and checks for duplicates. |
| UI | Tailwind CSS v4 design tokens (`src/app/globals.css`), shadcn/ui-style primitives on Radix (`src/components/ui`), Motion, Recharts, Sonner, Vaul. |
| Phones | Sheets open without focusing a field, so the keyboard opens only on a tap. The page shrinks above the keyboard (`interactive-widget=resizes-content`) and the tab bar steps aside while typing. Sheets drag by their handle only. Page transitions are CSS, so a page never waits for JavaScript to appear, and a crash inside a sheet stays in that sheet. |

<a id="security"></a>

## 13 · Security

- **Sign in with Google** (OpenID Connect, authorization-code flow with PKCE, `state` and `nonce`). Hisab never sees a password and keeps no Google token for sign-in: it learns who signed in from the ID token, which must be signed by Google, issued for this app, fresh, and carry this sign-in's nonce. People are told apart by Google's permanent account id, never by email address.
- **Each person's data is theirs alone.** Every query is limited to the signed-in user, and the database refuses references across users. Asking for someone else's account, transaction or category — by any id — is "not found". Tests have two people try every route against each other, and a check fails the build if a query lacks the user filter.
- **Sessions** are random 256-bit tokens in an `HttpOnly`, `Secure`, `SameSite=Lax`, `__Host-` cookie. Only the SHA-256 of the token is stored. Sessions expire after 30 days, or after 7 days unused.
- **Every request is checked twice**: the proxy rejects cookie-less requests, and every page and API handler validates the session against the database itself. Unauthenticated API calls get `401`, locked sessions `423`.
- **App lock** — optional. Set a PIN (**Settings → App lock**) and Hisab asks for it after signing in, on "Lock now", and after a while without activity (default 15 minutes). It is enforced on the server: a locked session cannot read any data until the PIN is entered, even if the tab was closed. The PIN is stored only as a scrypt hash. Wrong PINs are counted per person, across devices: five in a row and every try waits — 1 minute, then 5, 30, then a day — the right PIN included. A forgotten PIN is removed by signing in with Google again, so it guards an unlocked device. It isn't a second password.
- **Limits** — a client that keeps failing to sign in waits (20 failures per 15 minutes, per address; stored in the database). Writes are limited per person (a burst of 120, then two a second). The client address is the first `X-Forwarded-For` entry, which Railway's edge sets and clients can't override.
- **Google Drive** — connecting it gives Hisab one permission (`drive.appdata`): a hidden folder of its own in your Drive. It cannot list, read or change any other file. The permission (a Google refresh token) is stored encrypted with a key derived from the OAuth client secret, is only ever used to save, list, fetch and prune Hisab's own backups, and is handed back to Google when you disconnect. It must be for the Google account you sign in with. The backups themselves are never kept on the server.
- **Restoring a backup** treats the file as untrusted, whether it comes from your computer or your Drive: every entry is validated, nothing in it can refer outside the file or choose where it is stored, it can't change your PIN or who you are, and it is applied in one transaction or not at all.
- **Deleting your account** (Settings, after typing `DELETE`) removes every row you own and every session, at once — and Hisab's backups in your Google Drive. `/delete-account` explains this publicly.
- **CSRF** — state-changing API requests must be same-origin (checked with `Sec-Fetch-Site`, falling back to `Origin`) and JSON.
- **Linked phones** hold a token that only hands messages in: it can read nothing, opens no page, and is stored only as a SHA-256 hash. Removing the phone kills it. A phone is linked with a one-time code (10 minutes, once) from a signed-in session, and before anything is read the phone shows whose account it joins and asks — a link can be opened by any website, so a code from someone else's account never quietly takes your messages there. Bad codes are limited like failed sign-ins.
- **Shared SMS** arrive through the URL fragment, which browsers never send to a server, so message text doesn't reach access logs. Posts from other sites are refused.
- **Service worker** stores only the offline page — never pages, API responses or anything else containing your data.
- **Headers** — CSP, HSTS, `X-Frame-Options: DENY`, `nosniff`, no-referrer leakage, `noindex`. API responses and exports are `no-store`.
- **Injection** — all SQL is parameterised (Prisma tagged templates). Exported spreadsheet cells are guarded against formula injection.

<a id="testing"></a>

## 14 · Testing

```bash
npm run lint
npm run typecheck
npm test               # unit + integration tests against a real Postgres database
npm run build && npm run test:e2e   # end-to-end, against the production build
```

Integration tests use `TEST_DATABASE_URL` and end-to-end tests use `E2E_DATABASE_URL`. Both databases are wiped on every run, so their names **must end in `_test`** — the suites refuse to run otherwise. Defaults are in [Configuration](#configuration).

> The e2e tests sign in through a local stand-in for Google (`tests/e2e/fake-google.mjs`, selected with `GOOGLE_TEST_ORIGIN`), which runs the same flow and signs real ID tokens. That variable is for tests only: never set it on a deployment.

Set `CHROMIUM_PATH` to use an installed Chromium for e2e tests instead of running `npx playwright install chromium`.

<details>
<summary><b>What the tests cover</b></summary>

Balances with historical entries, balance updates (corrections, back-filled history before them, order within a day, deleting one, entries kept out of the balance, balances read from SMS), exact cents, transfers, transfers counted as expense (once), edit/delete, future-dated entries, idempotent and concurrent creation, cross-currency transfers, account history protection, database CHECK constraints, monthly and yearly analytics (including the worked example: income 80,000 / spending 35,000 including a 10,000 transfer / transfers 20,000 / savings 45,000 / 56.25%), income and spending in dollars counted at the rate (and balances added up across currencies), Personal / Family budgets and thresholds, recurring schedules and duplicate-free posting.

The SMS parser on real message formats (wallets, banks, cards, Bengali, OTPs, adverts), account and category matching, idempotent and concurrent SMS import, duplicate detection.

Two people trying every read, write and import against each other's data. Google ID tokens (wrong app, issuer, nonce, key, algorithm; expired or stale), creating an account on first sign-in and handing the earlier ledger to its owner. Sessions, the PIN lock and its waits.

End to end: signing in through Google (cancelled, forged and replayed answers included), the PIN lock, deleting an account, every API route as someone else, SMS import, balance updates, 401s on every API route (with and without a forged cookie), CSRF, cookie flags, security headers, open redirects, rate limiting, invalid input, public install files, the share target, and the phone layout.

Backups: a ledger with one of everything restored into the same and another account and compared row for row; some sixty altered files refused without changing anything; and Google Drive against a stand-in that is strict where Google is — the daily backup and its schedule, keeping the last ten, restoring (with a copy of the present saved first), a withdrawn permission, Drive being down, disabled or full, disconnecting, and deleting the account.

</details>

<a id="known-limitations"></a>

## 15 · Limits

- One exchange rate per currency, applied to every date: past months are re-valued when the rate changes, rather than kept at the rate of their day.
- SMS reading is rule-based. Formats it doesn't know yet still import after a quick review. Anything uncertain is never added without you.
- Sharing an SMS into the app works on Android (Chrome's installed apps). On iPhone, copy and paste instead.
- The per-client sign-in limit relies on the platform proxy's `X-Forwarded-For` (Railway sets it). Without such a proxy it can be sidestepped.
- Automatic backups to Google Drive are made when you use the app (after a page has loaded, at most once a day, an hour after a failed try) — which is also the only time your ledger changes. The folder they go to is hidden in Drive's own screens. Hisab lists what is in it.
- A restore replaces everything in the account. It doesn't merge. Restored entries get new ids, so links to a particular account or transaction from before the restore no longer open.
- The write limit is kept in the server's memory: it starts afresh on a deploy and is per server process.
- The app lock keeps other people out of an unlocked device. Anyone who can sign in to your Google account can remove the PIN — as they could read your mail.
- Recurring transactions post when the app is opened (at most once a minute per server). Nothing is lost if the app isn't opened for a while — missed occurrences are posted with their original dates the next time.

<a id="project-structure"></a>

## 16 · Files

```
prisma/                     schema + migrations (views, CHECK constraints, default categories)
public/                     service worker, offline page, app icons
scripts/generate-icons.mjs  renders every icon from the logo
assets/fonts/               Noto Sans Bengali for PDF reports (SIL OFL)
src/proxy.ts                cookie presence + CSRF checks (first line only)
src/app/(app)/              authenticated pages
src/app/api/                route handlers (all authenticated except Google sign-in, logout, health)
src/lib/sms/                SMS parser and bank/wallet list
src/lib/server/auth/        Google sign-in, sessions, the PIN lock, rate limiting, guards
src/lib/server/services/    accounts, transactions, SMS import, analytics, budgets, recurring, reports…
src/lib/server/export/      CSV, Excel and PDF generation
src/components/             UI, by feature
android/                    offline Android app (Kotlin). Ledger rules in android/core
docs/                       Google Play notes and the Android privacy policy
tests/                      unit + integration (Vitest, real Postgres), e2e (Playwright)
```

<a id="credits"></a>

## 17 · Credits

**[Shahriar Ahmed](https://github.com/fr-ost)**, Co-Founder & COO of **[Unique Labs](https://www.uniquelabs.org)**.

<div align="center">

<a href="https://shahriarahmed.net"><img alt="shahriarahmed.net" src="https://img.shields.io/badge/shahriarahmed.net-0F766E?style=flat-square"/></a>
<a href="https://github.com/fr-ost"><img alt="GitHub: fr-ost" src="https://img.shields.io/badge/fr--ost-115E59?style=flat-square&amp;logo=github&amp;logoColor=white"/></a>
<a href="https://www.uniquelabs.org"><img alt="Unique Labs" src="https://img.shields.io/badge/Unique_Labs-5EEAD4?style=flat-square"/></a>
<a href="https://x.com/0x_nation"><img alt="X: @0x_nation" src="https://img.shields.io/badge/0x__nation-134E4A?style=flat-square&amp;logo=x&amp;logoColor=white"/></a>

<br/>

<img width="100%" alt="" src="https://capsule-render.vercel.app/api?type=rounded&amp;color=0:5EEAD4,30:0F766E,100:042F2E&amp;height=160&amp;section=footer"/>

</div>
