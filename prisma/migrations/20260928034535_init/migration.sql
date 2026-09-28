-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('CASH', 'BANK', 'MOBILE_WALLET', 'CARD', 'EXCHANGE', 'OTHER');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('INCOME', 'EXPENSE', 'TRANSFER', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "CategoryKind" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "ExpenseScope" AS ENUM ('FAMILY', 'PERSONAL', 'OTHER');

-- CreateEnum
CREATE TYPE "RecurrenceFrequency" AS ENUM ('WEEKLY', 'MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "NumberFormat" AS ENUM ('SOUTH_ASIAN', 'INTERNATIONAL');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "singleton" BOOLEAN NOT NULL DEFAULT true,
    "displayName" VARCHAR(60) NOT NULL DEFAULT '',
    "passwordHash" TEXT NOT NULL,
    "baseCurrency" CHAR(3) NOT NULL DEFAULT 'BDT',
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Dhaka',
    "numberFormat" "NumberFormat" NOT NULL DEFAULT 'SOUTH_ASIAN',
    "autoLockMinutes" INTEGER NOT NULL DEFAULT 15,
    "passwordChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" CHAR(64) NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "userAgent" VARCHAR(255),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "id" TEXT NOT NULL,
    "ip" VARCHAR(64) NOT NULL,
    "success" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "type" "AccountType" NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'BDT',
    "openingBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "openingDate" DATE NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "icon" VARCHAR(32),
    "color" VARCHAR(16),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "kind" "CategoryKind" NOT NULL,
    "defaultScope" "ExpenseScope",
    "icon" VARCHAR(32) NOT NULL,
    "color" VARCHAR(16) NOT NULL,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "date" DATE NOT NULL,
    "accountId" TEXT NOT NULL,
    "toAccountId" TEXT,
    "toAmount" DECIMAL(14,2),
    "categoryId" TEXT,
    "countAsExpense" BOOLEAN NOT NULL DEFAULT false,
    "scope" "ExpenseScope",
    "description" VARCHAR(140) NOT NULL DEFAULT '',
    "notes" VARCHAR(2000),
    "recurringId" TEXT,
    "occurrenceDate" DATE,
    "idempotencyKey" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Budget" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringTransaction" (
    "id" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "accountId" TEXT NOT NULL,
    "toAccountId" TEXT,
    "toAmount" DECIMAL(14,2),
    "categoryId" TEXT,
    "countAsExpense" BOOLEAN NOT NULL DEFAULT false,
    "scope" "ExpenseScope",
    "description" VARCHAR(140) NOT NULL DEFAULT '',
    "notes" VARCHAR(2000),
    "frequency" "RecurrenceFrequency" NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "occurrenceIndex" INTEGER NOT NULL DEFAULT 0,
    "nextOccurrence" DATE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_singleton_key" ON "User"("singleton");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "LoginAttempt_createdAt_idx" ON "LoginAttempt"("createdAt");

-- CreateIndex
CREATE INDEX "LoginAttempt_ip_createdAt_idx" ON "LoginAttempt"("ip", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Account_name_key" ON "Account"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Category_kind_name_key" ON "Category"("kind", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_idempotencyKey_key" ON "Transaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Transaction_date_idx" ON "Transaction"("date");

-- CreateIndex
CREATE INDEX "Transaction_accountId_date_idx" ON "Transaction"("accountId", "date");

-- CreateIndex
CREATE INDEX "Transaction_toAccountId_date_idx" ON "Transaction"("toAccountId", "date");

-- CreateIndex
CREATE INDEX "Transaction_categoryId_date_idx" ON "Transaction"("categoryId", "date");

-- CreateIndex
CREATE INDEX "Transaction_type_date_idx" ON "Transaction"("type", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_recurringId_occurrenceDate_key" ON "Transaction"("recurringId", "occurrenceDate");

-- CreateIndex
CREATE UNIQUE INDEX "Budget_categoryId_effectiveFrom_key" ON "Budget"("categoryId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "RecurringTransaction_isActive_nextOccurrence_idx" ON "RecurringTransaction"("isActive", "nextOccurrence");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_toAccountId_fkey" FOREIGN KEY ("toAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_recurringId_fkey" FOREIGN KEY ("recurringId") REFERENCES "RecurringTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringTransaction" ADD CONSTRAINT "RecurringTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringTransaction" ADD CONSTRAINT "RecurringTransaction_toAccountId_fkey" FOREIGN KEY ("toAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringTransaction" ADD CONSTRAINT "RecurringTransaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Invariants Prisma cannot express. These make impossible states
-- unrepresentable even if application code has a bug.
-- ---------------------------------------------------------------------------

ALTER TABLE "User"
  ADD CONSTRAINT "User_singleton_check" CHECK ("singleton" = true),
  ADD CONSTRAINT "User_autoLock_check" CHECK ("autoLockMinutes" BETWEEN 0 AND 1440),
  ADD CONSTRAINT "User_currency_check" CHECK ("baseCurrency" ~ '^[A-Z]{3}$');

ALTER TABLE "Account"
  ADD CONSTRAINT "Account_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "Account_name_check" CHECK (length(btrim("name")) > 0);

ALTER TABLE "Category"
  ADD CONSTRAINT "Category_name_check" CHECK (length(btrim("name")) > 0),
  ADD CONSTRAINT "Category_scope_check" CHECK (
    ("kind" = 'EXPENSE' AND "defaultScope" IS NOT NULL) OR
    ("kind" = 'INCOME' AND "defaultScope" IS NULL)
  );

ALTER TABLE "Transaction"
  ADD CONSTRAINT "Transaction_amount_check" CHECK (
    ("type" = 'ADJUSTMENT' AND "amount" <> 0) OR
    ("type" <> 'ADJUSTMENT' AND "amount" > 0)
  ),
  ADD CONSTRAINT "Transaction_transfer_check" CHECK (
    ("type" = 'TRANSFER' AND "toAccountId" IS NOT NULL AND "toAccountId" <> "accountId") OR
    ("type" <> 'TRANSFER' AND "toAccountId" IS NULL AND "toAmount" IS NULL AND "countAsExpense" = false)
  ),
  ADD CONSTRAINT "Transaction_toAmount_check" CHECK ("toAmount" IS NULL OR "toAmount" > 0),
  ADD CONSTRAINT "Transaction_category_check" CHECK (
    ("type" IN ('INCOME', 'EXPENSE') AND "categoryId" IS NOT NULL) OR
    ("type" = 'TRANSFER' AND "countAsExpense" AND "categoryId" IS NOT NULL) OR
    ("type" = 'TRANSFER' AND NOT "countAsExpense" AND "categoryId" IS NULL) OR
    ("type" = 'ADJUSTMENT' AND "categoryId" IS NULL)
  ),
  ADD CONSTRAINT "Transaction_scope_check" CHECK (
    (("type" = 'EXPENSE' OR ("type" = 'TRANSFER' AND "countAsExpense")) AND "scope" IS NOT NULL) OR
    (NOT ("type" = 'EXPENSE' OR ("type" = 'TRANSFER' AND "countAsExpense")) AND "scope" IS NULL)
  );

ALTER TABLE "RecurringTransaction"
  ADD CONSTRAINT "Recurring_type_check" CHECK ("type" IN ('INCOME', 'EXPENSE', 'TRANSFER')),
  ADD CONSTRAINT "Recurring_amount_check" CHECK ("amount" > 0),
  ADD CONSTRAINT "Recurring_transfer_check" CHECK (
    ("type" = 'TRANSFER' AND "toAccountId" IS NOT NULL AND "toAccountId" <> "accountId") OR
    ("type" <> 'TRANSFER' AND "toAccountId" IS NULL AND "toAmount" IS NULL AND "countAsExpense" = false)
  ),
  ADD CONSTRAINT "Recurring_toAmount_check" CHECK ("toAmount" IS NULL OR "toAmount" > 0),
  ADD CONSTRAINT "Recurring_category_check" CHECK (
    ("type" IN ('INCOME', 'EXPENSE') AND "categoryId" IS NOT NULL) OR
    ("type" = 'TRANSFER' AND "countAsExpense" AND "categoryId" IS NOT NULL) OR
    ("type" = 'TRANSFER' AND NOT "countAsExpense" AND "categoryId" IS NULL)
  ),
  ADD CONSTRAINT "Recurring_scope_check" CHECK (
    (("type" = 'EXPENSE' OR ("type" = 'TRANSFER' AND "countAsExpense")) AND "scope" IS NOT NULL) OR
    (NOT ("type" = 'EXPENSE' OR ("type" = 'TRANSFER' AND "countAsExpense")) AND "scope" IS NULL)
  ),
  ADD CONSTRAINT "Recurring_dates_check" CHECK ("endDate" IS NULL OR "endDate" >= "startDate"),
  ADD CONSTRAINT "Recurring_index_check" CHECK ("occurrenceIndex" >= 0);

ALTER TABLE "Budget"
  ADD CONSTRAINT "Budget_amount_check" CHECK ("amount" >= 0),
  ADD CONSTRAINT "Budget_month_check" CHECK (EXTRACT(DAY FROM "effectiveFrom") = 1);

-- ---------------------------------------------------------------------------
-- The ledger. Every balance, inflow and outflow in the application is derived
-- from this view: one signed row per account movement. A transfer produces
-- two rows (out of the source, into the destination) — never an expense.
-- ---------------------------------------------------------------------------

CREATE VIEW "LedgerEntry" AS
SELECT
  t."id"        AS "transactionId",
  t."accountId" AS "accountId",
  a."currency"  AS "currency",
  t."date"      AS "date",
  t."type"      AS "type",
  CASE WHEN t."type" IN ('EXPENSE', 'TRANSFER') THEN -t."amount" ELSE t."amount" END AS "amount"
FROM "Transaction" t
JOIN "Account" a ON a."id" = t."accountId"
UNION ALL
SELECT
  t."id",
  t."toAccountId",
  a."currency",
  t."date",
  t."type",
  COALESCE(t."toAmount", t."amount")
FROM "Transaction" t
JOIN "Account" a ON a."id" = t."toAccountId"
WHERE t."type" = 'TRANSFER';

-- Expense recognition: direct expenses plus transfers explicitly flagged
-- "count as expense". Measured in the source account's currency.
CREATE VIEW "ExpenseEntry" AS
SELECT
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
  t."id"         AS "transactionId",
  t."accountId"  AS "accountId",
  a."currency"   AS "currency",
  t."date"       AS "date",
  t."categoryId" AS "categoryId",
  t."amount"     AS "amount"
FROM "Transaction" t
JOIN "Account" a ON a."id" = t."accountId"
WHERE t."type" = 'INCOME';

-- ---------------------------------------------------------------------------
-- Default categories (editable in Settings).
-- ---------------------------------------------------------------------------

INSERT INTO "Category" ("id", "name", "kind", "defaultScope", "icon", "color", "sortOrder", "updatedAt") VALUES
  (gen_random_uuid()::text, 'Family',        'EXPENSE', 'FAMILY',   'users',          'terracotta', 10,  now()),
  (gen_random_uuid()::text, 'Personal',      'EXPENSE', 'PERSONAL', 'user',           'violet',     20,  now()),
  (gen_random_uuid()::text, 'Food',          'EXPENSE', 'PERSONAL', 'utensils',       'orange',     30,  now()),
  (gen_random_uuid()::text, 'Transport',     'EXPENSE', 'PERSONAL', 'bus',            'blue',       40,  now()),
  (gen_random_uuid()::text, 'Housing',       'EXPENSE', 'OTHER',    'house',          'brown',      50,  now()),
  (gen_random_uuid()::text, 'Bills',         'EXPENSE', 'OTHER',    'receipt',        'slate',      60,  now()),
  (gen_random_uuid()::text, 'Education',     'EXPENSE', 'PERSONAL', 'graduation-cap', 'teal',       70,  now()),
  (gen_random_uuid()::text, 'Medical',       'EXPENSE', 'PERSONAL', 'heart-pulse',    'rose',       80,  now()),
  (gen_random_uuid()::text, 'Shopping',      'EXPENSE', 'PERSONAL', 'shopping-bag',   'plum',       90,  now()),
  (gen_random_uuid()::text, 'Subscriptions', 'EXPENSE', 'PERSONAL', 'repeat',         'indigo',     100, now()),
  (gen_random_uuid()::text, 'Technology',    'EXPENSE', 'PERSONAL', 'laptop',         'cyan',       110, now()),
  (gen_random_uuid()::text, 'Entertainment', 'EXPENSE', 'PERSONAL', 'clapperboard',   'amber',      120, now()),
  (gen_random_uuid()::text, 'Gifts',         'EXPENSE', 'OTHER',    'gift',           'lime',       130, now()),
  (gen_random_uuid()::text, 'Other',         'EXPENSE', 'OTHER',    'circle-dashed',  'gray',       140, now()),
  (gen_random_uuid()::text, 'Salary',        'INCOME',  NULL,       'briefcase',      'green',      10,  now()),
  (gen_random_uuid()::text, 'Business',      'INCOME',  NULL,       'store',          'teal',       20,  now()),
  (gen_random_uuid()::text, 'Freelance',     'INCOME',  NULL,       'pen-tool',       'blue',       30,  now()),
  (gen_random_uuid()::text, 'Investment',    'INCOME',  NULL,       'trending-up',    'indigo',     40,  now()),
  (gen_random_uuid()::text, 'Gifts',         'INCOME',  NULL,       'gift',           'amber',      50,  now()),
  (gen_random_uuid()::text, 'Other',         'INCOME',  NULL,       'circle-dashed',  'gray',       60,  now());
