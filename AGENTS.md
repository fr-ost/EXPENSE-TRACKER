<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Project notes (Hisab)

- Every row belongs to one user (`userId`), and nobody may ever see or change
  another user's rows. Every service takes a `UserId` first (branded; it comes
  from the session via `authed()` / `loadPageContext()`, never from request
  input) and puts it in every query: `where: { id, userId }` in Prisma,
  `x."userId" = ${userId}` for each table or view read in raw SQL. Names and
  keys are unique per user; references between rows are composite foreign keys
  on `(userId, id)`, so the database refuses one user's entry on another's
  account or category. Nothing cascades from `User`: `deleteUserData` removes
  a user's rows in order. `tests/unit/user-scope.test.ts` (reads the source)
  and `tests/integration/isolation.test.ts` (two users) guard this — extend
  the second with every new service.
- The transaction ledger is the only source of truth for balances. Never add a
  stored balance column; derive from the `LedgerEntry` view.
- Known balances are anchors: the opening balance and each balance update
  (`BalanceCheckpoint`, manual or from an SMS). The `BalanceCorrection` view
  derives the correction that makes each hold, so entries dated before one
  never change the balance after it. Filter that view (and `LedgerEntry`) by
  `userId`, and by `accountId` for one account: both are in every PARTITION
  BY, so it is then computed for that user's (that account's) rows only.
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
  the migrations and `isRecognizedExpense` in `src/lib/domain.ts`.
- Currencies: analytics take a `Conversion` (`services/currency.ts`): totals in
  the main currency, each amount converted at its rate and rounded on its own
  (`ROUND(amount * fx.rate, 2)` joined on the `ratesTable`); a currency without
  a rate is left out. A rate is the owner's (`ExchangeRate`) or else the latest
  conversion transfer's. A plain currency code means just that currency.
  `convertMoney` does the same maths in TypeScript.
- Spending is for `PERSONAL` or `FAMILY` (`ExpenseScope`, no third value), and
  budgets are per scope (`ScopeBudget`, effective-dated), never per category.
- New transactions start on an account in the type's usual currency
  (`User.incomeCurrency` / `expenseCurrency`, null = main; `defaultAccountId`)
  until an account is picked by hand.
- Transaction entry rules live in `resolveEntry` (`src/lib/server/services/transactions.ts`).
- Every page calls `loadPageContext()`; every API handler is wrapped in
  `authed()`. Both hand over the signed-in `userId` to pass to the services;
  `authed()` also limits writes per user (`takeWrite`).
- People sign in with Google only (`auth/google.ts`: authorization-code flow
  with PKCE, state and nonce; the ID token is verified with `jose`). A user
  is their Google `sub` (`User.googleSub`), never their email. The first
  sign-in creates the user with the starter categories (`signInWithGoogle`,
  `DEFAULT_CATEGORIES`) and the browser's timezone. The one row without a
  `googleSub` is the owner from the password days: the verified Google
  address in `OWNER_EMAIL` takes it over. There are no passwords anywhere.
  E2E tests sign in through `tests/e2e/fake-google.mjs` (`GOOGLE_TEST_ORIGIN`,
  tests only).
- The app lock is a PIN of the user's own (`auth/pin.ts`, scrypt hash on
  `User`). Without one nothing locks. With one, a session starts locked after
  sign-in, on "Lock now" and after `autoLockMinutes` idle; wrong PINs are
  counted per user with growing waits; a forgotten PIN is removed only from a
  session Google has just signed in and the PIN hasn't opened yet
  (`canResetPin`).
- Backup and restore (`src/lib/backup.ts`, `services/backup.ts`): a backup is
  one JSON file of everything a user has recorded (never the PIN, the Google
  id or sessions). A restore replaces the user's data in one transaction and
  treats the file as untrusted: every row is checked against the same rules
  as the database's CHECK constraints, every reference must resolve inside
  the file, and every row gets a new id — so a file restores into any account
  and can never point outside itself. `createdAt` is kept (it orders entries
  at the same moment); the balances recorded in the file are compared after
  the restore. A new table or column that holds user data must be added to
  the export, the restore, `deleteUserData` and `tests/integration/backup.test.ts`
  (its round trip compares whole ledgers).
- Google Drive backups (`services/drive.ts`, `drive/client.ts`): opt-in, one
  permission only (`DRIVE_SCOPE`, the app's hidden folder), asked for through
  the same OAuth callback as sign-in (`pending.drive`) and kept only when it
  is for the Google account the user signs in with. The refresh token is
  stored sealed (`drive/tokens.ts`, key derived from the client secret) in
  `DriveBackup`. `ensureDailyBackup` runs after a page is sent (`after()` in
  `loadPageContext`), claims its turn in the database, skips an unchanged or
  empty ledger, and keeps the newest ten files. A restore from Drive first
  saves the present to Drive. Never revoke an earlier token when a new one
  arrives: Google withdraws the whole grant, the new token included — only
  `disconnectDrive` / `removeDriveBackups` revoke. The server never stores a
  backup. Tests run against `tests/e2e/fake-google.mjs`, which also stands in
  for Drive; keep it as strict as Google.
- SMS import: the parser (`src/lib/sms/parse.ts`) is pure and client-side;
  account/category suggestions live in `src/components/sms/sms-suggest.ts`;
  the server (`src/lib/server/services/sms.ts`) re-validates through
  `resolveEntry`, keys each message `sms:<fingerprint>:<part>` (0 transaction,
  1 fee, b its balance update; unique per user) and flags likely duplicates via the
  `TransactionLeg` view. An SMS balance replaces the account's balance
  (`saveSmsCheckpoint`): the newest message — none sent later, no manual
  update for a later moment — is anchored at the moment it is read, so the
  account shows exactly that; an older one stays history at its own moment
  (`messageDate` / `messageTime` keep when it was sent). A message that only
  reports a balance is saved by `saveSmsBalances` with `reportedAt`. A
  reported balance is recorded only with its own
  transaction and deleted with it (`deleteTransaction`): on add, on a repeat
  of a message added earlier ("exists", or `saveSmsBalances`), or when a
  flagged duplicate is confirmed with `sameAs` (the recorded transaction takes
  the message's key, date and time). Card limits are never balances.
  Add new message formats as parser tests first (`tests/unit/sms-parse.test.ts`).
- Automatic SMS import from a linked phone (server side): a `Device` hands
  bank and wallet messages to `POST /api/devices/inbox` (`deviceAuthed()`:
  its token, no session). Linking: a signed-in browser asks for a one-time
  code (`startDeviceLink`, 10 minutes, once), the phone exchanges it for a
  token (`completeDeviceLink`, limited like failed sign-ins). Tokens and codes
  are stored only as SHA-256; a token can hand messages in and nothing else.
  `receiveSms` (`services/sms-inbox.ts`) reads each message with the browser
  importer's own code (`buildItem` / `itemPayload` from
  `components/sms/sms-model.ts`, so keep those free of browser-only work at
  import time) and the same `importSms` / `saveSmsBalances`: certain → added;
  not a transaction → dropped, never stored; anything else → `SmsInbox`,
  shown on Import SMS. Every way a message gets dealt with in `sms.ts`
  removes it from `SmsInbox` (`stopWaiting`). Phones and waiting messages go
  with the user (cascade), like sessions; they are not ledger data, so a
  backup and restore leave them out. The Android app in this repository no
  longer links to the site (below); this stays for other clients.
- The Android app (`android/`) is an app of its own, fully offline (no
  server, no account, no INTERNET permission — keep it that way): Compose
  UI in `android/app`, the ledger rules in plain Kotlin in `android/core`
  (testable on any JVM). It is built and tested only by
  `.github/workflows/android.yml` (the Android SDK and Google's Maven aren't
  reachable from every environment; CI is the build — push and read the
  run). Keep `android/core` a faithful port of the website: money as `Long`
  paisa, the ledger/balance/correction rules of the SQL views, `resolveEntry`
  as `Edits`, recurring, budgets, the backup file format (the website's
  `hisab-backup` v1, read as untrusted), and the SMS reader, suggestions and
  import rules. When a website rule changes, change the port and its tests;
  the SMS fixtures (`android/core/src/test/resources/sms-*.json`) are made by
  running the website's own reader over its test messages — regenerate them
  rather than editing them by hand.
- On the phone every record is `Synced` (stable id, `updatedAt` from
  `SyncClock`, device, `deleted` tombstone); edits go through `Edits` and are
  stamped by `Repository.commit`. Ids that must agree across phones are
  derived (`Ids.stable`): starter categories, backup rows, SMS entries
  (`sms:<fingerprint>:<part>`, the website's fingerprint), recurring
  occurrences — so copies can be merged record by record later (`Sync`,
  later change wins). Cloud backup/sync is deliberately left for later (an
  earlier Google Drive sync is in git history, commit 21c1c92). The app lock
  and waiting SMS belong to one phone and are never in a backup. Which
  messages Hisab reads is decided by `SmsFilter.kt` (a business sender, about
  money, never a code) — keep the app's privacy policy
  (`docs/privacy-android.md`) saying exactly what it reads and that nothing
  leaves the phone. Signing keys are
  secrets, never in the repository. Publishing: `docs/google-play.md`.
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
- Sign-in rate limiting keys on the leftmost `X-Forwarded-For` (Railway).
  Next.js fills that header from the socket when absent, so e2e tests simulate
  clients with it. It is per client only: there is no secret to guess, and an
  overall limit would let one client keep everyone out.
- Checks: `npm run lint && npm run typecheck && npm test`; e2e: `npm run build && npm run test:e2e`.
