# Hisab

A private, single-user personal finance ledger: income, expenses, transfers,
budgets, recurring payments and reports — built to be exact with money and
pleasant to use every day, on a phone or a desktop.

*Hisab* (হিসাব) means "the accounts". Rename it by changing `APP_NAME` in
`src/lib/domain.ts`.

- **Accounts** — cash, bank, bKash / Nagad, cards, exchanges; any currency.
  Balances are always derived from the ledger, never typed in.
- **Transactions** — expenses, income and transfers, with fast entry
  (`N` on desktop, the ＋ tab on phones), historical back-filling, search,
  filters, sorting, pagination, and CSV / Excel export of any filtered view.
- **Transfers that can count as spending** — money moves once between
  accounts; optionally it is also recognised as an expense (e.g. support sent
  to family) without being double counted.
- **Family / Personal / Other** classification on every expense, with its own
  analytics.
- **Dashboard** — total balance, the month at a glance with deltas, cash flow,
  spending pace, where the money went, budgets, recent activity.
- **Budgets** — monthly per category, effective-dated (changing a budget never
  rewrites past months), calm warnings at 80% / 100% / over.
- **Recurring transactions** — weekly / monthly / yearly, posted exactly once.
- **Reports** — monthly and yearly statements, category, family & personal,
  income sources, savings trend, account activity; PDF and Excel exports.
- **Reconciliation** — compare the ledger with a physical cash count and
  record the difference as an adjustment or as an unrecorded expense/income.
- **Private by construction** — one account, no sign-up, Argon2id password,
  server-side sessions, inactivity lock, brute-force protection.

---

## Financial rules

These rules are implemented once, in SQL views in the initial migration
(`LedgerEntry`, `ExpenseEntry`, `IncomeEntry`), and every screen, report and
export reads from them.

| Recorded as                    | Source account | Destination account | Counted as income | Counted as spending |
| ------------------------------ | -------------- | ------------------- | ----------------- | ------------------- |
| Income                         | + amount       | —                   | yes               | no                  |
| Expense                        | − amount       | —                   | no                | yes (its category)  |
| Transfer                       | − amount       | + amount            | no                | no                  |
| Transfer, *count as expense*   | − amount       | + amount            | no                | yes (its category)  |
| Adjustment (reconciliation)    | ± amount       | —                   | no                | no                  |

- **Balance** = opening balance + every movement dated on or before today.
  Future-dated entries are shown as scheduled and excluded until their date.
- **Savings** = income − spending. **Savings rate** = savings ÷ income.
- **Transfers** in reports are pure movements between your accounts; transfers
  marked as expenses are reported separately (and included in spending), so
  every transfer lands in exactly one bucket.
- Totals and analytics use accounts in your **main currency** (Settings).
  Amounts in different currencies are never added together; cross-currency
  transfers record the amount received.
- A transaction cannot be dated before its account's opening date. To record
  older history, move the opening date back — the opening balance is what the
  account held on that date.

## Architecture

A single Next.js 16 (App Router) application with PostgreSQL via Prisma 7.

| Concern        | Decision |
| -------------- | -------- |
| Money          | `NUMERIC(14,2)` in Postgres; decimal strings over the wire; `bigint` minor units for any arithmetic in TypeScript (`src/lib/money.ts`). Floats are used only to draw charts. |
| Ledger         | No stored balances. Views expand transactions into signed per-account movements; Postgres sums them in milliseconds for a personal data set. |
| Invariants     | CHECK constraints make invalid rows impossible (transfer to the same account, expense without category, zero/negative amounts…). Entry rules that need other rows (opening dates, category kinds, currencies) live in one function, `resolveEntry`, run under row locks. |
| Reads / writes | Server Components read through a service layer (`src/lib/server/services`). Writes go through REST route handlers under `/api`, then the client refreshes server data in place — no full reloads. |
| Idempotency    | Each "new transaction" sheet carries an idempotency key; retries and double clicks return the original row. Recurring occurrences are unique per (rule, date) and posted under `FOR UPDATE SKIP LOCKED`. |
| Dates          | Calendar dates (`DATE`), "today" resolved in your timezone (Settings), deterministic formatting so server and browser always agree. |
| UI             | Tailwind CSS v4 design tokens (`src/app/globals.css`), shadcn/ui-style primitives on Radix (`src/components/ui`), Motion, Recharts, Sonner, Vaul. |

```
prisma/                  schema + migrations (views, CHECK constraints, default categories)
scripts/                 bootstrap (creates the account) and hash-password
src/proxy.ts             cookie presence + CSRF origin checks (first line only)
src/app/(app)/           authenticated pages
src/app/api/             route handlers (all authenticated except login/logout/health)
src/lib/server/auth/     password hashing, sessions, rate limiting, guards
src/lib/server/services/ accounts, transactions, analytics, budgets, recurring, reports…
src/lib/server/export/   CSV, Excel and PDF generation
src/components/          UI, by feature
tests/                   unit + integration (Vitest, real Postgres), e2e (Playwright)
```

## Security

- **One account, no sign-up.** The account is created only by the bootstrap
  step from `ADMIN_PASSWORD_HASH`. Nothing in the app can create users.
- **Password** hashed with Argon2id (19 MiB, t=2). The plaintext is never
  stored, logged or sent anywhere but the login request.
- **Sessions** are random 256-bit tokens in an `HttpOnly`, `Secure`,
  `SameSite=Lax`, `__Host-` cookie. Only the SHA-256 of the token is stored.
  Sessions expire after 30 days, or after 7 days unused; changing the password
  signs out every other device.
- **Every request is checked twice**: the proxy rejects cookie-less requests,
  and every page and API handler validates the session against the database
  itself. Unauthenticated API calls get `401`, locked sessions `423`.
- **Lock** — "Lock now" and auto-lock after inactivity (configurable, default
  15 minutes) are enforced on the server: a locked session cannot read any data
  until the password is entered again, even if the tab was closed.
- **Brute force** — 5 failed attempts per IP and 30 overall per 15 minutes
  (stored in the database, so it survives restarts). While limited, even the
  correct password is refused, so the limiter never reveals a correct guess.
- **CSRF** — state-changing API requests must be same-origin and JSON.
- **Headers** — CSP, HSTS, `X-Frame-Options: DENY`, `nosniff`, no-referrer
  leakage, `noindex`. API responses and exports are `no-store`.
- **Injection** — all SQL is parameterised (Prisma tagged templates); exported
  spreadsheet cells are guarded against formula injection.

## Local development

Requirements: Node.js 22, PostgreSQL 14+.

```bash
npm install                      # also generates the Prisma client
cp .env.example .env             # then edit DATABASE_URL
npm run hash-password            # prompts for a password (12+ chars), prints its hash
# put the printed value in .env as ADMIN_PASSWORD_HASH (use the base64: form in
# .env files — some loaders expand "$" characters)
npm run db:deploy                # apply migrations (creates tables, views, default categories)
npm run bootstrap                # create the account from ADMIN_PASSWORD_HASH
npm run dev                      # http://localhost:3000
```

Changing the schema later: edit `prisma/schema.prisma`, run
`npm run db:migrate -- --name <change>`, and commit the generated migration.

## Deploying to Railway

1. **Create a project** and add a **PostgreSQL** database service.
2. **Add a service from this GitHub repository.** Railway reads
   `railway.json`: it builds with `npm run build` and starts with `npm start`,
   which runs `prisma migrate deploy`, the bootstrap step, then `next start`.
   The health check is `/api/health`.
3. **Set the service variables** (Variables tab):
   - `DATABASE_URL` → `${{Postgres.DATABASE_URL}}` (a reference to the database)
   - `ADMIN_PASSWORD_HASH` → the output of `npm run hash-password` (run it on
     your own computer; the raw `$argon2id$…` value works, and so does the
     `base64:…` form)
   - optionally `ADMIN_DISPLAY_NAME`, `DEFAULT_CURRENCY`, `DEFAULT_TIMEZONE`
4. **Deploy.** The first start creates the tables and your account. Then open
   **Settings → Networking → Generate domain** and sign in.

Railway terminates HTTPS and sets `X-Real-IP`, which the rate limiter uses.
Nothing else is needed — secrets stay in Railway variables, never in the repo.

**Forgot the password?** Generate a new hash, set it as `ADMIN_PASSWORD_HASH`,
add `FORCE_PASSWORD_RESET=true`, redeploy, sign in — then remove
`FORCE_PASSWORD_RESET`. This also signs out every existing session.

**Production build locally:** `npm run build && npm start` (uses `PORT`,
default 3000).

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

Covered: balances with historical entries, exact cents, transfers,
transfers counted as expense (once), edit/delete, future-dated entries,
idempotent and concurrent creation, cross-currency transfers, account history
protection, database CHECK constraints, monthly and yearly analytics (including
the worked example: income 80,000 / spending 35,000 incl. a 10,000 transfer /
transfers 20,000 / savings 45,000 / 56.25%), budgets and thresholds, recurring
schedules and duplicate-free posting, and — end to end — authentication,
locking, 401s on every API route (with and without a forged cookie), CSRF,
cookie flags, security headers, open redirects, rate limiting, invalid input,
and the phone layout.

## Known limitations

- Analytics cover the main currency only; other-currency accounts are shown
  with their own balances but not converted.
- The per-IP login limit relies on the platform proxy's `X-Real-IP`. Without
  such a proxy it can be spoofed; the global limit still applies.
- Recurring transactions post when the app is opened (at most once a minute
  per server). Nothing is lost if the app isn't opened for a while — missed
  occurrences are posted with their original dates the next time.
