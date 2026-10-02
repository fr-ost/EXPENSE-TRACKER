<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Project notes (Hisab)

- The transaction ledger is the only source of truth for balances. Never add a
  stored balance column; derive from the `LedgerEntry` view.
- Known balances are anchors: the opening balance and each balance update
  (`BalanceCheckpoint`, manual or from an SMS). The `BalanceCorrection` view
  derives the correction that makes each hold, so entries dated before one
  never change the balance after it. Filter that view (and `LedgerEntry`) by
  `accountId` for one account: it is then computed for that account only.
- Order within a day is (date, `at`, rank, createdAt): `at` is the time, else
  the hidden `loggedTime` ("HH:MM:SS", set only when an untimed entry is
  recorded on its own date, via `loggedTimeFor` and the server clock), else
  '24:00'; rank puts the opening first and a checkpoint after the movements at
  the same moment. `src/lib/known-balance.ts` mirrors this for UI hints.
- `Transaction.affectsBalance = false` keeps an entry in reports (ExpenseEntry /
  IncomeEntry) but out of every balance.
- Money: `NUMERIC(14,2)` in SQL, decimal strings in TypeScript, `bigint` minor
  units for arithmetic (`src/lib/money.ts`). Never do money maths in floats.
- Income / spending / transfer classification is defined once: the SQL views in
  the init migration and `isRecognizedExpense` in `src/lib/domain.ts`.
- Transaction entry rules live in `resolveEntry` (`src/lib/server/services/transactions.ts`).
- Every page calls `loadPageContext()`; every API handler is wrapped in `authed()`.
- The password is the `ADMIN_PASSWORD` env var (plain text, compared in
  constant time); nothing about it is stored. Sessions carry an HMAC keyed
  with it (`Session.credential`), so changing it signs everyone out. The owner
  row is created on first sign-in (`ensureOwner`).
- SMS import: the parser (`src/lib/sms/parse.ts`) is pure and client-side;
  account/category suggestions live in `src/components/sms/sms-suggest.ts`;
  the server (`src/lib/server/services/sms.ts`) re-validates through
  `resolveEntry`, keys each message `sms:<fingerprint>:<part>` (0 transaction,
  1 fee, b its balance update) and flags likely duplicates via the
  `TransactionLeg` view. A reported balance is recorded only with its own
  transaction and deleted with it (`deleteTransaction`): on add, on a repeat
  of a message added earlier ("exists", or `saveSmsBalances`), or when a
  flagged duplicate is confirmed with `sameAs` (the recorded transaction takes
  the message's key, date and time). Card limits are never balances.
  Add new message formats as parser tests first (`tests/unit/sms-parse.test.ts`).
- Displaying money (`formatMoney`) must never throw: it runs during render,
  and amount fields hold partial input like "12.". `ResponsiveSheet` wraps its
  content in `SheetErrorBoundary`, so a crash in a form stays in its sheet;
  sheet components are exported through `guardSheet` (the transaction sheet
  sits in a `SheetCrashGuard`), so a crash in a sheet's own render only closes
  that sheet. Error screens show `describeError` and the version, so a
  screenshot is enough to find the cause.
- Phones: never auto-focus a field on a touch screen (`useAutoFocusFields`);
  the keyboard opens on a tap. Sheets drag by the handle only and move for the
  keyboard only on iOS; Android resizes the page (`interactiveWidget` in the
  root layout). Page transitions are CSS (`animate-page-in`): nothing may keep
  a page invisible until JavaScript runs.
- `deploymentId` is Railway's commit SHA (skew protection: an open app reloads
  after a deploy); Settings shows it as the version. Railway deploys `main`.
- The service worker (`public/sw.js`) must never cache pages or API responses.
  Icons are rendered from one drawing: `node scripts/generate-icons.mjs`.
- Rate limiting keys on the leftmost `X-Forwarded-For` (Railway). Next.js fills
  that header from the socket when absent, so e2e tests simulate clients with it.
- Checks: `npm run lint && npm run typecheck && npm test`; e2e: `npm run build && npm run test:e2e`.
