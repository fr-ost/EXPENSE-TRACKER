-- Balance checkpoints ("at this moment the account held exactly this much")
-- and transactions that are kept for the record without moving a balance.

-- CreateEnum
CREATE TYPE "CheckpointSource" AS ENUM ('MANUAL', 'SMS');

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "affectsBalance" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "loggedTime" CHAR(8);

-- CreateTable
CREATE TABLE "BalanceCheckpoint" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "time" CHAR(5),
    "loggedTime" CHAR(8),
    "balance" DECIMAL(14,2) NOT NULL,
    "source" "CheckpointSource" NOT NULL DEFAULT 'MANUAL',
    "note" VARCHAR(500),
    "smsKey" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BalanceCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BalanceCheckpoint_smsKey_key" ON "BalanceCheckpoint"("smsKey");

-- CreateIndex
CREATE INDEX "BalanceCheckpoint_accountId_date_idx" ON "BalanceCheckpoint"("accountId", "date");

-- AddForeignKey
ALTER TABLE "BalanceCheckpoint" ADD CONSTRAINT "BalanceCheckpoint_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Invariants
ALTER TABLE "BalanceCheckpoint"
  ADD CONSTRAINT "BalanceCheckpoint_time_check" CHECK ("time" IS NULL OR "time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ADD CONSTRAINT "BalanceCheckpoint_loggedTime_check" CHECK (
    "loggedTime" IS NULL OR ("time" IS NULL AND "loggedTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
  );

ALTER TABLE "Transaction"
  ADD CONSTRAINT "Transaction_loggedTime_check" CHECK (
    "loggedTime" IS NULL OR ("time" IS NULL AND "loggedTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
  ),
  -- An adjustment exists only to change a balance.
  ADD CONSTRAINT "Transaction_affectsBalance_check" CHECK ("type" <> 'ADJUSTMENT' OR "affectsBalance");

-- ---------------------------------------------------------------------------
-- Ledger views
--
-- Where an event sits within its day ("at", compared as plain text: "14:05"
-- is the start of that minute, "14:05:30" within it): its time; without one,
-- the time it was recorded if that was on the same day ("loggedTime");
-- otherwise the end of the day ('24:00'). The opening balance comes first
-- ('00:00'), and a checkpoint comes after the movements at the same moment.
-- ---------------------------------------------------------------------------

DROP VIEW "LedgerEntry";

-- Every account leg of every transaction, whether or not it moves the balance.
CREATE VIEW "TransactionLeg" AS
SELECT
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
  SELECT l."accountId", l."date", l."at", 0 AS "rank",
         l."amount", NULL::numeric AS "balance", NULL::text AS "checkpointId", l."createdAt"
  FROM "TransactionLeg" l
  WHERE l."affectsBalance"
  UNION ALL
  SELECT a."id", a."openingDate", '00:00' COLLATE "C", -1, 0, a."openingBalance", NULL, a."createdAt"
  FROM "Account" a
  UNION ALL
  SELECT c."accountId", c."date", COALESCE(c."time", c."loggedTime", '24:00')::text COLLATE "C", 1, 0, c."balance", c."id", c."createdAt"
  FROM "BalanceCheckpoint" c
),
running AS (
  SELECT e.*,
         SUM(e."amount") OVER (
           PARTITION BY e."accountId"
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
  WINDOW w AS (PARTITION BY r."accountId" ORDER BY r."date", r."at", r."rank", r."createdAt")
)
SELECT
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
