-- Every row belongs to one user.
--
-- Until now the database held a single owner's ledger. Each table gets a
-- "userId"; names and keys that were unique are unique per user; references
-- between rows become composite foreign keys on ("userId", "id"), so the
-- database itself refuses a transaction on someone else's account or
-- category; and the ledger views carry "userId" so a user's figures are
-- computed from that user's rows only.
--
-- Whatever is already recorded belongs to the owner.

-- ---------------------------------------------------------------------------
-- 0. What is here already
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  owners integer;
  recorded bigint;
BEGIN
  SELECT COUNT(*) INTO owners FROM "User";
  SELECT (SELECT COUNT(*) FROM "Account") + (SELECT COUNT(*) FROM "Transaction")
       + (SELECT COUNT(*) FROM "BalanceCheckpoint") + (SELECT COUNT(*) FROM "RecurringTransaction")
       + (SELECT COUNT(*) FROM "ScopeBudget") + (SELECT COUNT(*) FROM "ExchangeRate")
    INTO recorded;
  IF owners > 1 THEN
    RAISE EXCEPTION 'Expected at most one owner, found %', owners;
  END IF;
  IF owners = 0 AND recorded > 0 THEN
    RAISE EXCEPTION 'There are % recorded rows but no owner to give them to', recorded;
  END IF;
END $$;

-- The views read the columns changed below; they are rebuilt at the end.
DROP VIEW "LedgerEntry";
DROP VIEW "BalanceCorrection";
DROP VIEW "TransactionLeg";
DROP VIEW "ExpenseEntry";
DROP VIEW "IncomeEntry";

-- ---------------------------------------------------------------------------
-- 1. Owner of every row
-- ---------------------------------------------------------------------------

ALTER TABLE "Account" ADD COLUMN "userId" TEXT;
ALTER TABLE "Category" ADD COLUMN "userId" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "userId" TEXT;
ALTER TABLE "BalanceCheckpoint" ADD COLUMN "userId" TEXT;
ALTER TABLE "ScopeBudget" ADD COLUMN "userId" TEXT;
ALTER TABLE "ExchangeRate" ADD COLUMN "userId" TEXT;
ALTER TABLE "RecurringTransaction" ADD COLUMN "userId" TEXT;

UPDATE "Account" SET "userId" = (SELECT "id" FROM "User");
UPDATE "Category" SET "userId" = (SELECT "id" FROM "User");
UPDATE "Transaction" SET "userId" = (SELECT "id" FROM "User");
UPDATE "BalanceCheckpoint" SET "userId" = (SELECT "id" FROM "User");
UPDATE "ScopeBudget" SET "userId" = (SELECT "id" FROM "User");
UPDATE "ExchangeRate" SET "userId" = (SELECT "id" FROM "User");
UPDATE "RecurringTransaction" SET "userId" = (SELECT "id" FROM "User");

-- Nobody has signed in yet: the starter categories from the first migration
-- have no owner. Each user now gets their own set when their account is
-- created (DEFAULT_CATEGORIES in services/categories.ts).
DELETE FROM "Category" WHERE "userId" IS NULL;

ALTER TABLE "Account" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "Category" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "Transaction" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "BalanceCheckpoint" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "ScopeBudget" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "ExchangeRate" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "RecurringTransaction" ALTER COLUMN "userId" SET NOT NULL;

-- More than one user can exist from here on.
ALTER TABLE "User" DROP COLUMN "singleton";

-- ---------------------------------------------------------------------------
-- 2. Keys: unique per user
-- ---------------------------------------------------------------------------

ALTER TABLE "BalanceCheckpoint" DROP CONSTRAINT "BalanceCheckpoint_accountId_fkey";
ALTER TABLE "RecurringTransaction" DROP CONSTRAINT "RecurringTransaction_accountId_fkey";
ALTER TABLE "RecurringTransaction" DROP CONSTRAINT "RecurringTransaction_categoryId_fkey";
ALTER TABLE "RecurringTransaction" DROP CONSTRAINT "RecurringTransaction_toAccountId_fkey";
ALTER TABLE "Transaction" DROP CONSTRAINT "Transaction_accountId_fkey";
ALTER TABLE "Transaction" DROP CONSTRAINT "Transaction_categoryId_fkey";
ALTER TABLE "Transaction" DROP CONSTRAINT "Transaction_recurringId_fkey";
ALTER TABLE "Transaction" DROP CONSTRAINT "Transaction_toAccountId_fkey";

DROP INDEX "Account_name_key";
DROP INDEX "BalanceCheckpoint_smsKey_key";
DROP INDEX "Category_kind_name_key";
DROP INDEX "RecurringTransaction_isActive_nextOccurrence_idx";
DROP INDEX "ScopeBudget_scope_effectiveFrom_key";
DROP INDEX "Transaction_date_idx";
DROP INDEX "Transaction_idempotencyKey_key";
DROP INDEX "Transaction_type_date_idx";

ALTER TABLE "ExchangeRate" DROP CONSTRAINT "ExchangeRate_pkey",
  ADD CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("userId", "base", "currency");

CREATE UNIQUE INDEX "Account_userId_name_key" ON "Account"("userId", "name");
CREATE UNIQUE INDEX "Account_userId_id_key" ON "Account"("userId", "id");
CREATE UNIQUE INDEX "BalanceCheckpoint_userId_smsKey_key" ON "BalanceCheckpoint"("userId", "smsKey");
CREATE UNIQUE INDEX "Category_userId_kind_name_key" ON "Category"("userId", "kind", "name");
CREATE UNIQUE INDEX "Category_userId_id_key" ON "Category"("userId", "id");
CREATE INDEX "RecurringTransaction_userId_isActive_nextOccurrence_idx" ON "RecurringTransaction"("userId", "isActive", "nextOccurrence");
CREATE UNIQUE INDEX "RecurringTransaction_userId_id_key" ON "RecurringTransaction"("userId", "id");
CREATE UNIQUE INDEX "ScopeBudget_userId_scope_effectiveFrom_key" ON "ScopeBudget"("userId", "scope", "effectiveFrom");
CREATE INDEX "Transaction_userId_date_idx" ON "Transaction"("userId", "date");
CREATE INDEX "Transaction_userId_type_date_idx" ON "Transaction"("userId", "type", "date");
CREATE UNIQUE INDEX "Transaction_userId_idempotencyKey_key" ON "Transaction"("userId", "idempotencyKey");

-- ---------------------------------------------------------------------------
-- 3. References stay inside one user's data
--
-- A user's rows are removed only by deleting them in order (deleteUserData):
-- nothing cascades from "User", so data never disappears as a side effect.
-- Deleting a recurring rule keeps what it posted (deleteRecurring clears
-- "recurringId" first).
-- ---------------------------------------------------------------------------

ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Category" ADD CONSTRAINT "Category_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_userId_accountId_fkey" FOREIGN KEY ("userId", "accountId") REFERENCES "Account"("userId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_userId_toAccountId_fkey" FOREIGN KEY ("userId", "toAccountId") REFERENCES "Account"("userId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_userId_categoryId_fkey" FOREIGN KEY ("userId", "categoryId") REFERENCES "Category"("userId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_userId_recurringId_fkey" FOREIGN KEY ("userId", "recurringId") REFERENCES "RecurringTransaction"("userId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BalanceCheckpoint" ADD CONSTRAINT "BalanceCheckpoint_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BalanceCheckpoint" ADD CONSTRAINT "BalanceCheckpoint_userId_accountId_fkey" FOREIGN KEY ("userId", "accountId") REFERENCES "Account"("userId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ScopeBudget" ADD CONSTRAINT "ScopeBudget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExchangeRate" ADD CONSTRAINT "ExchangeRate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RecurringTransaction" ADD CONSTRAINT "RecurringTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecurringTransaction" ADD CONSTRAINT "RecurringTransaction_userId_accountId_fkey" FOREIGN KEY ("userId", "accountId") REFERENCES "Account"("userId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecurringTransaction" ADD CONSTRAINT "RecurringTransaction_userId_toAccountId_fkey" FOREIGN KEY ("userId", "toAccountId") REFERENCES "Account"("userId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecurringTransaction" ADD CONSTRAINT "RecurringTransaction_userId_categoryId_fkey" FOREIGN KEY ("userId", "categoryId") REFERENCES "Category"("userId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 4. Ledger views
--
-- As before, with the owner on every row. Filter a view by "userId" (and
-- "accountId" for one account): both are in every PARTITION BY below, so the
-- database works through that user's (that account's) history only.
--
-- Where an event sits within its day ("at", compared as plain text: "14:05"
-- is the start of that minute, "14:05:30" within it): its time; without one,
-- the time it was recorded if that was on the same day ("loggedTime");
-- otherwise the end of the day ('24:00'). The opening balance comes first
-- ('00:00'), and a checkpoint comes after the movements at the same moment.
-- ---------------------------------------------------------------------------

-- Every account leg of every transaction, whether or not it moves the balance.
CREATE VIEW "TransactionLeg" AS
SELECT
  t."userId"         AS "userId",
  t."id"             AS "transactionId",
  t."accountId"      AS "accountId",
  a."currency"       AS "currency",
  t."date"           AS "date",
  t."time"           AS "time",
  COALESCE(t."time", t."loggedTime", '24:00')::text COLLATE "C" AS "at",
  t."type"           AS "type",
  CASE WHEN t."type" IN ('EXPENSE', 'TRANSFER') THEN -t."amount" ELSE t."amount" END AS "amount",
  t."affectsBalance" AS "affectsBalance",
  t."createdAt"      AS "createdAt"
FROM "Transaction" t
JOIN "Account" a ON a."id" = t."accountId"
UNION ALL
SELECT
  t."userId",
  t."id",
  t."toAccountId",
  a."currency",
  t."date",
  t."time",
  COALESCE(t."time", t."loggedTime", '24:00')::text COLLATE "C",
  t."type",
  COALESCE(t."toAmount", t."amount"),
  t."affectsBalance",
  t."createdAt"
FROM "Transaction" t
JOIN "Account" a ON a."id" = t."toAccountId"
WHERE t."type" = 'TRANSFER';

-- Automatic corrections that make every balance anchor (the opening balance
-- and each checkpoint) hold exactly:
--   * the earliest anchor fixes the balance at its moment; movements dated
--     before it are history, so they are cancelled by a "history" row at the
--     very start (1900-01-01) and only shape balances before the anchor;
--   * every later anchor gets a correction at its own moment for whatever the
--     ledger doesn't explain since the previous anchor.
CREATE VIEW "BalanceCorrection" AS
WITH events AS (
  SELECT l."userId", l."accountId", l."date", l."at", 0 AS "rank",
         l."amount", NULL::numeric AS "balance", NULL::text AS "checkpointId", l."createdAt"
  FROM "TransactionLeg" l
  WHERE l."affectsBalance"
  UNION ALL
  SELECT a."userId", a."id", a."openingDate", '00:00' COLLATE "C", -1, 0, a."openingBalance", NULL, a."createdAt"
  FROM "Account" a
  UNION ALL
  SELECT c."userId", c."accountId", c."date", COALESCE(c."time", c."loggedTime", '24:00')::text COLLATE "C", 1, 0, c."balance", c."id", c."createdAt"
  FROM "BalanceCheckpoint" c
),
running AS (
  SELECT e.*,
         SUM(e."amount") OVER (
           PARTITION BY e."userId", e."accountId"
           ORDER BY e."date", e."at", e."rank", e."createdAt"
           ROWS UNBOUNDED PRECEDING
         ) AS "movedBefore"
  FROM events e
),
anchors AS (
  SELECT r.*,
         LAG(r."balance") OVER w     AS "previousBalance",
         LAG(r."movedBefore") OVER w AS "previousMoved",
         ROW_NUMBER() OVER w         AS "position"
  FROM running r
  WHERE r."balance" IS NOT NULL
  WINDOW w AS (PARTITION BY r."userId", r."accountId" ORDER BY r."date", r."at", r."rank", r."createdAt")
)
SELECT
  an."userId"        AS "userId",
  an."accountId"     AS "accountId",
  ac."currency"      AS "currency",
  an."checkpointId"  AS "checkpointId",
  CASE WHEN an."position" = 1 THEN 'HISTORY' ELSE 'CORRECTION' END AS "kind",
  CASE WHEN an."position" = 1 THEN DATE '1900-01-01' ELSE an."date" END AS "date",
  CASE WHEN an."position" = 1 THEN '00:00' ELSE an."at" END AS "at",
  CASE WHEN an."position" = 1
       THEN an."balance" - ac."openingBalance" - an."movedBefore"
       ELSE an."balance" - an."previousBalance" - (an."movedBefore" - an."previousMoved")
  END AS "amount"
FROM anchors an
JOIN "Account" ac ON ac."id" = an."accountId";

-- Everything that moves a balance: opening balance + SUM("amount") up to a
-- date is the balance at the end of that date ("at" places it in the day).
CREATE VIEW "LedgerEntry" AS
SELECT
  l."userId"        AS "userId",
  l."transactionId" AS "transactionId",
  NULL::text        AS "checkpointId",
  l."accountId"     AS "accountId",
  l."currency"      AS "currency",
  l."date"          AS "date",
  l."at"            AS "at",
  l."type"          AS "type",
  l."amount"        AS "amount"
FROM "TransactionLeg" l
WHERE l."affectsBalance"
UNION ALL
SELECT
  c."userId",
  NULL,
  c."checkpointId",
  c."accountId",
  c."currency",
  c."date",
  c."at",
  'ADJUSTMENT'::"TransactionType",
  c."amount"
FROM "BalanceCorrection" c
WHERE c."amount" <> 0;

-- Expense recognition: direct expenses plus transfers explicitly flagged
-- "count as expense". Measured in the source account's currency.
CREATE VIEW "ExpenseEntry" AS
SELECT
  t."userId"     AS "userId",
  t."id"         AS "transactionId",
  t."accountId"  AS "accountId",
  a."currency"   AS "currency",
  t."date"       AS "date",
  t."type"       AS "type",
  t."categoryId" AS "categoryId",
  t."scope"      AS "scope",
  t."amount"     AS "amount"
FROM "Transaction" t
JOIN "Account" a ON a."id" = t."accountId"
WHERE t."type" = 'EXPENSE' OR (t."type" = 'TRANSFER' AND t."countAsExpense");

-- Income recognition, symmetric with ExpenseEntry.
CREATE VIEW "IncomeEntry" AS
SELECT
  t."userId"     AS "userId",
  t."id"         AS "transactionId",
  t."accountId"  AS "accountId",
  a."currency"   AS "currency",
  t."date"       AS "date",
  t."categoryId" AS "categoryId",
  t."amount"     AS "amount"
FROM "Transaction" t
JOIN "Account" a ON a."id" = t."accountId"
WHERE t."type" = 'INCOME';
