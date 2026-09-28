<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Project notes (Hisab)

- The transaction ledger is the only source of truth for balances. Never add a
  stored balance column; derive from the `LedgerEntry` view.
- Money: `NUMERIC(14,2)` in SQL, decimal strings in TypeScript, `bigint` minor
  units for arithmetic (`src/lib/money.ts`). Never do money maths in floats.
- Income / spending / transfer classification is defined once: the SQL views in
  the init migration and `isRecognizedExpense` in `src/lib/domain.ts`.
- Transaction entry rules live in `resolveEntry` (`src/lib/server/services/transactions.ts`).
- Every page calls `loadPageContext()`; every API handler is wrapped in `authed()`.
- Checks: `npm run lint && npm run typecheck && npm test`; e2e: `npm run build && npm run test:e2e`.
