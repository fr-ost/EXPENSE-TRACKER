# Hisab

A private, single-user personal finance ledger: income, expenses, transfers,
budgets, recurring payments and reports — built to be exact with money and
pleasant to use every day, on a phone or a desktop.

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
- **Installable app** — install it from Chrome or Edge (desktop and Android)
  or add it to the iPhone home screen.
- **Private by construction** — one account, no sign-up, the password lives
  only in a server variable, server-side sessions, inactivity lock,
  brute-force protection.

---

## Deploying to Railway

1. **Create a project** and add a **PostgreSQL** database service.
2. **Add a service from this GitHub repository**, deploying the `main`
   branch (service **Settings → Source → Branch**); every push to `main`
   deploys. Railway reads `railway.json`: it builds with `npm run build`, and
   `npm start` applies the database migrations and starts the app. The health
   check is `/api/health`.
3. **Set two variables** on the service (Variables tab):

   | Variable         | Value |
   | ---------------- | ----- |
   | `DATABASE_URL`   | `${{Postgres.DATABASE_URL}}` (a reference to the database) |
   | `ADMIN_PASSWORD` | your password, as plain text — e.g. `4821` or `hisab2026` |

   Any 1–10 letters or digits work; longer is safer. Surrounding spaces are
   ignored.
4. **Deploy**, then **Settings → Networking → Generate domain**, open it and
   sign in. The first sign-in creates your account (named Shahriar Ahmed,
   with Bangladeshi taka and Dhaka time — all editable in Settings).

**Changing the password:** edit `ADMIN_PASSWORD` in Railway and deploy the
change. Every signed-in device is signed out; sign in with the new password.
That is also the answer to a forgotten password.

If `ADMIN_PASSWORD` is missing, the app still starts and the sign-in page
explains what to set.

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
src/app/api/             route handlers (all authenticated except login/logout/health)
src/lib/sms/             SMS parser and bank/wallet list
src/lib/server/auth/     password check, sessions, rate limiting, guards
src/lib/server/services/ accounts, transactions, SMS import, analytics, budgets, recurring, reports…
src/lib/server/export/   CSV, Excel and PDF generation
src/components/          UI, by feature
tests/                   unit + integration (Vitest, real Postgres), e2e (Playwright)
```

## Security

- **One account, no sign-up.** The owner's row is created on the first
  successful sign-in and the database allows only one. Nothing in the app can
  create users.
- **Password** is the `ADMIN_PASSWORD` variable, compared in constant time.
  It is never stored in the database, logged, or sent anywhere but the
  sign-in request. Each session is bound to the password it was created with
  (an HMAC of the session id), so changing the variable signs out every
  device.
- **Sessions** are random 256-bit tokens in an `HttpOnly`, `Secure`,
  `SameSite=Lax`, `__Host-` cookie. Only the SHA-256 of the token is stored.
  Sessions expire after 30 days, or after 7 days unused.
- **Every request is checked twice**: the proxy rejects cookie-less requests,
  and every page and API handler validates the session against the database
  itself. Unauthenticated API calls get `401`, locked sessions `423`.
- **Lock** — "Lock now" and auto-lock after inactivity (configurable, default
  15 minutes) are enforced on the server: a locked session cannot read any
  data until the password is entered again, even if the tab was closed. Five
  wrong passwords on the lock screen sign that session out.
- **Brute force** — sign-in allows 5 failed attempts per client and 30 overall
  per 15 minutes (stored in the database, so it survives restarts). While
  limited, even the correct password is refused, so the limiter never reveals
  a correct guess. The client address is the first `X-Forwarded-For` entry,
  which Railway's edge sets and clients can't override. Short passwords are
  convenient; the limits are what keep them safe.
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
cp .env.example .env             # then set DATABASE_URL and ADMIN_PASSWORD
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
matching, idempotent and concurrent SMS import, duplicate detection; the
password variable, session binding, unlock limits; and — end to end —
authentication, locking, SMS import, balance updates, 401s on every API route (with and without
a forged cookie), CSRF, cookie flags, security headers, open redirects, rate
limiting, invalid input, public install files, the share target, and the
phone layout.

## Known limitations

- One exchange rate per currency, applied to every date: past months are
  re-valued when the rate changes, rather than kept at the rate of their day.
- SMS reading is rule-based. Formats it doesn't know yet still import after a
  quick review; anything uncertain is never added without you.
- Sharing an SMS into the app works on Android (Chrome's installed apps);
  on iPhone, copy and paste instead.
- The per-client login limit relies on the platform proxy's
  `X-Forwarded-For` (Railway sets it). Without such a proxy it can be
  sidestepped; the global limit still applies.
- Recurring transactions post when the app is opened (at most once a minute
  per server). Nothing is lost if the app isn't opened for a while — missed
  occurrences are posted with their original dates the next time.
