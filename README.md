# Hisab

A private personal finance ledger: income, expenses, transfers, budgets,
recurring payments and reports — built to be exact with money and pleasant to
use every day, on a phone or a desktop. People sign in with Google, and each
has a ledger nobody else can see.

*Hisab* (হিসাব) means "the accounts". Rename it by changing `APP_NAME` in
`src/lib/domain.ts`.

- **Accounts** — cash, bank, bKash / Nagad, cards, exchanges; any currency.
  Balances are always derived from the ledger, never stored. The total adds
  every currency up in the main one (taka and dollars together), with each
  currency's own amount beside it.
- **Transactions** — expenses, income and transfers, with fast entry
  (`N` on desktop, the ＋ tab on phones), an optional time of day, historical
  back-filling, search, filters, sorting, pagination, and CSV / Excel export
  of any filtered view.
- **Import from SMS** — paste bank or bKash / Nagad / Rocket messages (or
  share them to the installed app on Android): Hisab reads the amount, bank,
  type, date and time and adds them — never the same message twice — and the
  balance in the newest message *replaces* the account's balance (nothing is
  added on top). A message that only reports a balance ("your balance is
  Tk 8,000") sets it too.
- **Update balance** — enter what an account actually holds; Hisab corrects
  for whatever wasn't recorded. Older transactions added later never change a
  balance after it, so back-filling history can't push a balance negative.
  Any transaction can also be kept out of the balance.
- **Transfers that can count as spending** — money moves once between
  accounts; optionally it is also recognised as an expense (e.g. support sent
  to family) without being double counted.
- **Personal / Family** on every expense ("spent for"), with its own
  analytics.
- **Income in dollars, spending in taka** — each type starts on an account in
  its usual currency (Settings); other currencies count in every total at your
  exchange rate, or at the rate of your latest conversion.
- **Dashboard** — a time-of-day greeting, total balance, the month at a glance
  with deltas, cash flow, spending pace, where the money went, budgets,
  recent activity.
- **Budgets** — one monthly limit for Personal and one for Family: everything
  marked as spent for it counts, whatever the category or currency.
  Effective-dated (changing a budget never rewrites past months), calm
  warnings at 80% / 100% / over.
- **Recurring transactions** — weekly / monthly / yearly, posted exactly once.
- **Reports** — monthly and yearly statements, category, personal & family,
  income sources, savings trend, account activity; PDF (Bengali names
  included) and Excel exports.
- **Backup and restore** — connect your Google Drive and Hisab keeps a backup
  there on its own: a new copy on any day your ledger has changed, the last
  ten kept, in a folder of Hisab's own (it can't see anything else in your
  Drive). Or download everything as one file. Either can be restored later,
  into the same account or another: a restore replaces what is there, all at
  once or not at all.
- **Installable app** — install it from Chrome or Edge (desktop and Android)
  or add it to the iPhone home screen.
- **Your own account** — sign in with Google (your account is created the
  first time); everything you record belongs to you alone. An optional PIN
  locks the app after a while without activity. Delete your account, and
  everything in it, from Settings.

---

## Deploying to Railway

1. **Create a project** and add a **PostgreSQL** database service.
2. **Add a service from this GitHub repository**, deploying the `main`
   branch (service **Settings → Source → Branch**); every push to `main`
   deploys. Railway reads `railway.json`: it builds with `npm run build`, and
   `npm start` applies the database migrations and starts the app. The health
   check is `/api/health`.
3. **Generate the domain** (service **Settings → Networking → Generate
   domain**): Google needs the address before anyone can sign in.
4. **Connect it to Google** (once, in the
   [Google Cloud console](https://console.cloud.google.com/)):
   1. Create a project, and set up its OAuth consent screen (app name and
      your email; audience **External**). No extra scopes are needed — Hisab
      only asks who you are.
   2. Create an **OAuth client ID** of type **Web application**. Under
      **Authorised redirect URIs** add exactly
      `https://YOUR-DOMAIN/api/auth/google/callback`.
   3. Copy the client ID and the client secret.
   4. For backups to Google Drive: enable the **Google Drive API** for the
      project, and add the scope
      `https://www.googleapis.com/auth/drive.appdata` to the consent screen
      ("See, create, and delete its own configuration data in your Google
      Drive"). It is a non-sensitive scope: Hisab only gets a hidden folder
      of its own, never the rest of anyone's Drive.
   5. While the consent screen is in **Testing**, only the test users you
      list can sign in — and Google ends every Drive permission after seven
      days, so backups stop until Drive is connected again. **Publish** the
      consent screen when anyone should be able to sign in.
5. **Set the variables** on the service (Variables tab):

   | Variable               | Value |
   | ---------------------- | ----- |
   | `DATABASE_URL`         | `${{Postgres.DATABASE_URL}}` (a reference to the database) |
   | `GOOGLE_CLIENT_ID`     | the OAuth client ID |
   | `GOOGLE_CLIENT_SECRET` | the OAuth client secret |
   | `OWNER_EMAIL`          | only when upgrading — see below |
   | `APP_URL`              | optional: the app's address (`https://YOUR-DOMAIN`), if it isn't the one requests arrive at |

6. **Deploy**, open the domain and choose **Continue with Google**. Your
   account is created the first time you sign in, with the usual categories,
   Bangladeshi taka and your browser's timezone — all editable in Settings.

If the Google variables are missing, the app still starts and the sign-in
page explains what to set.

**Upgrading from the password version.** Earlier versions had one owner who
signed in with an `ADMIN_PASSWORD` variable. That ledger is kept, and goes to
its owner's Google account: set `OWNER_EMAIL` to the Google address you will
sign in with, **before** deploying this version. The first sign-in with that
address (Google must have verified it) takes the ledger over; from then on it
belongs to that Google account, and the variable can be removed. Anyone else
who signs in gets a new, empty account. `ADMIN_PASSWORD` is no longer used —
delete it. An app lock that asked for the password now asks for a PIN you set
in **Settings → App lock**.

**Which version is running:** **Settings → App** shows the deployed commit
(Railway's `RAILWAY_GIT_COMMIT_SHA`), matching the latest commit once a deploy
has finished. An app window left open reloads itself on its next page change
after a new deploy. If it shows an older commit, check that the service
deploys `main` and that the latest deploy succeeded (**Deployments** tab; a
failed one shows why under **⋯ → View logs**). Error screens show the version
too, next to what went wrong.

## Installing the app

- **Chrome or Edge (Windows, macOS, ChromeOS, Android):** use **Install app**
  in the sidebar, the phone's **More** menu, the banner on the overview, or
  **Settings → App**; or the install icon in the address bar.
- **iPhone / iPad:** in Safari, tap **Share → Add to Home Screen**.

The installed app opens full screen with its own icon, has shortcuts for a
new transaction, SMS import and reports, and on Android appears in the share
sheet: long-press a bank SMS, **Share → Hisab**, and it is added.

## Importing from SMS

Open **Import SMS**, paste one message or several (blank lines or one per line
separate them), or tap **Paste**. For each message Hisab reads the amount,
direction (money in or out), bank or wallet, account digits, date and time,
fee, reported balance and merchant, then builds the transaction:

- **Which account** — the bank or wallet name in the message, the last digits
  of the account or card (name your accounts like `City Bank 4567`), or the
  account you picked last time for that bank. No account for it yet? The
  message offers **Add … account** right there, filled in from the SMS (the
  opening balance is what it held just before the message); the waiting
  messages then match it and are added.
- **What kind** — payments and purchases are expenses, deposits and salary are
  income. Cash outs and ATM withdrawals are **transfers to your Cash
  account**, and money moved from your bank to bKash is a transfer too, so
  nothing is counted as spending twice. Fees become separate expenses.
- **Category** — from the merchant (Daraz → Shopping, Foodpanda → Food…), or
  whatever you chose last time for the same description.

With **Add automatically when certain** on, messages that clearly match one
of your accounts are added as soon as you paste them (with Undo). Anything
uncertain waits for a quick review with the normal transaction fields.

The same message is never added twice (on any device), and a message that
looks like something already recorded — typed in by hand, or the other side
of a transfer imported from the other bank's SMS — is flagged instead of
added. OTPs, adverts, failed transactions and reminders are skipped.

**Balances from SMS.** bKash, Nagad and most bank alerts end with the balance
after the transaction. Adding such a message also records that balance as a
balance update for the account (a switch on each message turns this off), so
payments that never sent an SMS are corrected for automatically. Hisab shows
whether its own balance agreed.

- A message added before (even before balances were read) records its
  balance when pasted again.
- A message flagged as already recorded — typed in by hand earlier — offers
  **It's the same one**: the SMS is linked to that transaction (which takes
  the SMS's date and time) and sets the balance, without counting it twice.
- A card's available limit is never taken as a balance, a balance in another
  currency is ignored, and a message older than the account's latest balance
  only fills in history. Undo removes the balance a message set.

Works with bKash, Nagad, Rocket, Upay and alerts from Bangladeshi banks and
cards (DBBL, City, BRAC, EBL, Islami Bank, Standard Chartered and ~40 more),
in English or Bengali. The original message is kept in the transaction's
notes.

## Financial rules

These rules are implemented once, in SQL views (`TransactionLeg`,
`BalanceCorrection`, `LedgerEntry`, `ExpenseEntry`, `IncomeEntry`), and every
screen, report and export reads from them.

| Recorded as                    | Source account | Destination account | Counted as income | Counted as spending |
| ------------------------------ | -------------- | ------------------- | ----------------- | ------------------- |
| Income                         | + amount       | —                   | yes               | no                  |
| Expense                        | − amount       | —                   | no                | yes (its category)  |
| Transfer                       | − amount       | + amount            | no                | no                  |
| Transfer, *count as expense*   | − amount       | + amount            | no                | yes (its category)  |
| Any of the above, *kept out of the balance* | — | —                 | as above          | as above            |
| Balance correction (from a balance update)  | ± difference | —   | no                | no                  |

- **Known balances.** The opening balance is what an account held at the
  start of its date. A **balance update** (entered with *Update balance*, or
  read from an SMS) is what it held at a moment. Every known balance holds
  exactly: Hisab adds a correction for whatever the recorded transactions
  don't explain since the previous one. You can instead record the difference
  as *Unrecorded spending* or *income* in a category, so it counts in reports.
- **Balance** at any moment = the latest known balance before it + every
  movement after that. So a transaction dated before a known balance — last
  month's spending added today, or anything before the opening date — never
  changes the balance after it; it only shapes the history before it. Deleting
  a balance update hands its correction to the next one.
- **Within a day**, an entry's time decides. An entry without a time counts
  from the moment it was recorded if that was the same day, and otherwise at
  the end of its day. A balance update comes after the entries at the same
  moment.
- **Kept out of the balance** — *Don't change the balance* on a transaction
  keeps it in income, spending and reports without moving any balance (e.g.
  spending the balance already reflects).
- Future-dated entries are shown as scheduled and excluded until their date.
- **Savings** = income − spending. **Savings rate** = savings ÷ income.
- **Transfers** in reports are pure movements between your accounts; transfers
  marked as expenses are reported separately (and included in spending), so
  every transfer lands in exactly one bucket.
- Totals and analytics are in your **main currency** (Settings). Other
  currencies count at their **exchange rate**: yours (Settings → Exchange
  rates), or else the rate of your latest conversion between the two (a
  transfer with the amount received). Each amount is converted and rounded on
  its own, so every breakdown adds up to its total; a currency with no rate
  yet is shown but not counted. Changing a rate re-values every total.

## Architecture

A single Next.js 16 (App Router) application with PostgreSQL via Prisma 7.

| Concern        | Decision |
| -------------- | -------- |
| Money          | `NUMERIC(14,2)` in Postgres; decimal strings over the wire; `bigint` minor units for any arithmetic in TypeScript (`src/lib/money.ts`). Floats are used only to draw charts. |
| Users          | Every row carries its owner (`userId`). Every service takes the signed-in user's id first and puts it in every query; references between rows are composite foreign keys on `(userId, id)`, so the database itself refuses one user's entry on another's account or category. |
| Backups        | A backup is one JSON file of everything a person recorded. A restore replaces their data in one transaction and never trusts the file: every row is checked, references must resolve inside the file, and rows get new ids. Drive backups are that file, compressed, in the app's hidden folder of the person's Drive; the server keeps only the permission (encrypted) and when a backup last got there. |
| Ledger         | No stored balances. Views expand transactions into signed per-account movements and derive the correction that makes each known balance (opening balance, balance updates) hold; Postgres sums them in milliseconds for a personal data set (~80 ms for every account at 30,000 transactions). |
| Invariants     | CHECK constraints make invalid rows impossible (transfer to the same account, expense without category, zero/negative amounts, malformed times, an adjustment kept out of the balance…). Entry rules that need other rows (active accounts, category kinds, currencies) live in one function, `resolveEntry`, run under row locks. |
| Reads / writes | Server Components read through a service layer (`src/lib/server/services`). Writes go through REST route handlers under `/api`, then the client refreshes server data in place — no full reloads. |
| Idempotency    | Each "new transaction" sheet carries an idempotency key; retries and double clicks return the original row. SMS imports use a key derived from the message text. Recurring occurrences are unique per (rule, date) and posted under `FOR UPDATE SKIP LOCKED`. |
| Dates          | Calendar dates (`DATE`) plus an optional time of day, "today" resolved in your timezone (Settings), deterministic formatting so server and browser always agree. |
| SMS            | The parser (`src/lib/sms`) is pure TypeScript and runs in the browser as you paste; the server re-validates every entry and checks for duplicates. |
| UI             | Tailwind CSS v4 design tokens (`src/app/globals.css`), shadcn/ui-style primitives on Radix (`src/components/ui`), Motion, Recharts, Sonner, Vaul. |
| Phones         | Sheets open without focusing a field, so the keyboard opens only on a tap; the page shrinks above the keyboard (`interactive-widget=resizes-content`) and the tab bar steps aside while typing; sheets drag by their handle only. Page transitions are CSS, so a page never waits for JavaScript to appear, and a crash inside a sheet stays in that sheet. |

```
prisma/                  schema + migrations (views, CHECK constraints, default categories)
public/                  service worker, offline page, app icons
scripts/generate-icons.mjs  renders every icon from the logo
assets/fonts/            Noto Sans Bengali for PDF reports (SIL OFL)
src/proxy.ts             cookie presence + CSRF checks (first line only)
src/app/(app)/           authenticated pages
src/app/api/             route handlers (all authenticated except Google sign-in, logout, health)
src/lib/sms/             SMS parser and bank/wallet list
src/lib/server/auth/     Google sign-in, sessions, the PIN lock, rate limiting, guards
src/lib/server/services/ accounts, transactions, SMS import, analytics, budgets, recurring, reports…
src/lib/server/export/   CSV, Excel and PDF generation
src/components/          UI, by feature
tests/                   unit + integration (Vitest, real Postgres), e2e (Playwright)
```

## Security

- **Sign in with Google** (OpenID Connect, authorization-code flow with PKCE,
  `state` and `nonce`). Hisab never sees a password and keeps no Google
  token: it learns who signed in from the ID token, which must be signed by
  Google, issued for this app, fresh, and carry this sign-in's nonce. People
  are told apart by Google's permanent account id, never by email address.
- **Each person's data is theirs alone.** Every query is limited to the
  signed-in user, and the database refuses references across users. Asking
  for someone else's account, transaction or category — by any id — is "not
  found". Tests have two people try every route against each other, and a
  check fails the build if a query lacks the user filter.
- **Sessions** are random 256-bit tokens in an `HttpOnly`, `Secure`,
  `SameSite=Lax`, `__Host-` cookie. Only the SHA-256 of the token is stored.
  Sessions expire after 30 days, or after 7 days unused.
- **Every request is checked twice**: the proxy rejects cookie-less requests,
  and every page and API handler validates the session against the database
  itself. Unauthenticated API calls get `401`, locked sessions `423`.
- **App lock** — optional: set a PIN (Settings → App lock) and Hisab asks for
  it after signing in, on "Lock now", and after a while without activity
  (default 15 minutes). It is enforced on the server: a locked session cannot
  read any data until the PIN is entered, even if the tab was closed. The PIN
  is stored only as a scrypt hash. Wrong PINs are counted per person, across
  devices: five in a row and every try waits — 1 minute, then 5, 30, then a
  day — the right PIN included. A forgotten PIN is removed by signing in with
  Google again, so it guards an unlocked device; it isn't a second password.
- **Limits** — a client that keeps failing to sign in waits (20 failures per
  15 minutes, per address; stored in the database). Writes are limited per
  person (a burst of 120, then two a second). The client address is the first
  `X-Forwarded-For` entry, which Railway's edge sets and clients can't
  override.
- **Google Drive** — connecting it gives Hisab one permission
  (`drive.appdata`): a hidden folder of its own in your Drive. It cannot
  list, read or change any other file. The permission (a Google refresh
  token) is stored encrypted with a key derived from the OAuth client secret,
  is only ever used to save, list, fetch and prune Hisab's own backups, and
  is handed back to Google when you disconnect. It must be for the Google
  account you sign in with. The backups themselves are never kept on the
  server.
- **Restoring a backup** treats the file as untrusted, whether it comes from
  your computer or your Drive: every entry is validated, nothing in it can
  refer outside the file or choose where it is stored, it can't change your
  PIN or who you are, and it is applied in one transaction or not at all.
- **Deleting your account** (Settings, after typing DELETE) removes every row
  you own and every session, at once — and Hisab's backups in your Google
  Drive. `/delete-account` explains this publicly.
- **CSRF** — state-changing API requests must be same-origin (checked with
  `Sec-Fetch-Site`, falling back to `Origin`) and JSON.
- **Shared SMS** arrive through the URL fragment, which browsers never send to
  a server, so message text doesn't reach access logs. Posts from other sites
  are refused.
- **Service worker** stores only the offline page — never pages, API
  responses or anything else containing your data.
- **Headers** — CSP, HSTS, `X-Frame-Options: DENY`, `nosniff`, no-referrer
  leakage, `noindex`. API responses and exports are `no-store`.
- **Injection** — all SQL is parameterised (Prisma tagged templates); exported
  spreadsheet cells are guarded against formula injection.

## Local development

Requirements: Node.js 22, PostgreSQL 14+.

```bash
npm install                      # also generates the Prisma client
cp .env.example .env             # then set DATABASE_URL and the Google client (see .env.example)
npm run db:deploy                # apply migrations (tables, views, default categories)
npm run dev                      # http://localhost:3000
```

Changing the schema later: edit `prisma/schema.prisma`, run
`npm run db:migrate -- --name <change>`, and commit the generated migration.
After changing the logo, run `node scripts/generate-icons.mjs` to re-render
the icons.

**Production build locally:** `npm run build && npm start` (uses `PORT`,
default 3000). The service worker is only registered in production builds.

## Testing

```bash
npm run lint
npm run typecheck
npm test               # unit + integration tests against a real Postgres database
npm run build && npm run test:e2e   # end-to-end, against the production build
```

- Integration tests use `TEST_DATABASE_URL` (default
  `postgresql://ledger:ledger@localhost:5432/ledger_test`); e2e tests use
  `E2E_DATABASE_URL` (default `…/ledger_e2e_test`). Both databases are wiped on
  every run, so their names **must end in `_test`** — the suites refuse to run
  otherwise.
- The e2e tests sign in through a local stand-in for Google
  (`tests/e2e/fake-google.mjs`, selected with `GOOGLE_TEST_ORIGIN`), which
  runs the same flow and signs real ID tokens. That variable is for tests
  only: never set it on a deployment.
- Set `CHROMIUM_PATH` to use an installed Chromium for e2e tests instead of
  running `npx playwright install chromium`.

Covered: balances with historical entries, balance updates (corrections,
back-filled history before them, order within a day, deleting one, entries
kept out of the balance, balances read from SMS), exact cents, transfers,
transfers counted as expense (once), edit/delete, future-dated entries,
idempotent and concurrent creation, cross-currency transfers, account history
protection, database CHECK constraints, monthly and yearly analytics (including
the worked example: income 80,000 / spending 35,000 incl. a 10,000 transfer /
transfers 20,000 / savings 45,000 / 56.25%), income and spending in dollars
counted at the rate (and balances added up across currencies), Personal /
Family budgets and thresholds, recurring
schedules and duplicate-free posting; the SMS parser on real message formats
(wallets, banks, cards, Bengali, OTPs, adverts), account and category
matching, idempotent and concurrent SMS import, duplicate detection; two
people trying every read, write and import against each other's data; Google
ID tokens (wrong app, issuer, nonce, key, algorithm; expired or stale),
creating an account on first sign-in and handing the earlier ledger to its
owner; sessions, the PIN lock and its waits; and — end to end — signing in
through Google (cancelled, forged and replayed answers included), the PIN
lock, deleting an account, every API route as someone else, SMS import,
balance updates, 401s on every API route (with and without a forged cookie),
CSRF, cookie flags, security headers, open redirects, rate limiting, invalid
input, public install files, the share target, and the phone layout. Backups:
a ledger with one of everything restored into the same and another account
and compared row for row; some sixty altered files refused without changing
anything; and Google Drive against a stand-in that is strict where Google is
— the daily backup and its schedule, keeping the last ten, restoring (with a
copy of the present saved first), a withdrawn permission, Drive being down,
disabled or full, disconnecting, and deleting the account.

## Known limitations

- One exchange rate per currency, applied to every date: past months are
  re-valued when the rate changes, rather than kept at the rate of their day.
- SMS reading is rule-based. Formats it doesn't know yet still import after a
  quick review; anything uncertain is never added without you.
- Sharing an SMS into the app works on Android (Chrome's installed apps);
  on iPhone, copy and paste instead.
- The per-client sign-in limit relies on the platform proxy's
  `X-Forwarded-For` (Railway sets it). Without such a proxy it can be
  sidestepped.
- Automatic backups to Google Drive are made when you use the app (after a
  page has loaded, at most once a day, an hour after a failed try) — which is
  also the only time your ledger changes. The folder they go to is hidden in
  Drive's own screens; Hisab lists what is in it.
- A restore replaces everything in the account; it doesn't merge. Restored
  entries get new ids, so links to a particular account or transaction from
  before the restore no longer open.
- The write limit is kept in the server's memory: it starts afresh on a
  deploy and is per server process.
- The app lock keeps other people out of an unlocked device. Anyone who can
  sign in to your Google account can remove the PIN — as they could read
  your mail.
- Recurring transactions post when the app is opened (at most once a minute
  per server). Nothing is lost if the app isn't opened for a while — missed
  occurrences are posted with their original dates the next time.
