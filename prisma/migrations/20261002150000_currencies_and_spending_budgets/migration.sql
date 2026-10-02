-- Totals that add up every currency, and budgets by who the spending was for.
--
-- 1. Spending is for you or for your family: "Other" becomes "Personal".
-- 2. One monthly budget for Personal and one for Family (ScopeBudget), instead
--    of budgets per category. Budgets set on the "Family" and "Personal"
--    categories carry over to them.
-- 3. Exchange rates, so other currencies count in the main one; and the
--    currency income and spending usually come in.

-- ---------------------------------------------------------------------------
-- 1. Two classifications
-- ---------------------------------------------------------------------------

UPDATE "Transaction" SET "scope" = 'PERSONAL' WHERE "scope" = 'OTHER';
UPDATE "RecurringTransaction" SET "scope" = 'PERSONAL' WHERE "scope" = 'OTHER';
UPDATE "Category" SET "defaultScope" = 'PERSONAL' WHERE "defaultScope" = 'OTHER';

-- A column's type can't change under a view that reads it.
DROP VIEW "ExpenseEntry";

ALTER TYPE "ExpenseScope" RENAME TO "ExpenseScope_old";
CREATE TYPE "ExpenseScope" AS ENUM ('FAMILY', 'PERSONAL');
ALTER TABLE "Transaction" ALTER COLUMN "scope" TYPE "ExpenseScope" USING "scope"::text::"ExpenseScope";
ALTER TABLE "RecurringTransaction" ALTER COLUMN "scope" TYPE "ExpenseScope" USING "scope"::text::"ExpenseScope";
ALTER TABLE "Category" ALTER COLUMN "defaultScope" TYPE "ExpenseScope" USING "defaultScope"::text::"ExpenseScope";
DROP TYPE "ExpenseScope_old";

-- As in the init migration. Expense recognition: direct expenses plus
-- transfers explicitly flagged "count as expense". Measured in the source
-- account's currency.
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

-- ---------------------------------------------------------------------------
-- 2. Budgets by classification
-- ---------------------------------------------------------------------------

CREATE TABLE "ScopeBudget" (
    "id" TEXT NOT NULL,
    "scope" "ExpenseScope" NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScopeBudget_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ScopeBudget_scope_effectiveFrom_key" ON "ScopeBudget"("scope", "effectiveFrom");

ALTER TABLE "ScopeBudget"
  ADD CONSTRAINT "ScopeBudget_amount_check" CHECK ("amount" >= 0),
  ADD CONSTRAINT "ScopeBudget_month_check" CHECK (EXTRACT(DAY FROM "effectiveFrom") = 1);

-- What was meant as the family (or personal) budget keeps its history.
INSERT INTO "ScopeBudget" ("id", "scope", "effectiveFrom", "amount", "updatedAt")
SELECT gen_random_uuid()::text,
       (CASE c."name" WHEN 'Family' THEN 'FAMILY' ELSE 'PERSONAL' END)::"ExpenseScope",
       b."effectiveFrom", b."amount", now()
FROM "Budget" b
JOIN "Category" c ON c."id" = b."categoryId"
WHERE c."kind" = 'EXPENSE' AND c."name" IN ('Family', 'Personal');

DROP TABLE "Budget";

-- ---------------------------------------------------------------------------
-- 3. Currencies
-- ---------------------------------------------------------------------------

-- What one unit of "currency" is worth in "base" (the main currency), set by
-- the owner. Without one, the rate of the latest conversion between the two
-- is used.
CREATE TABLE "ExchangeRate" (
    "base" CHAR(3) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "rate" DECIMAL(18,6) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("base", "currency")
);

ALTER TABLE "ExchangeRate"
  ADD CONSTRAINT "ExchangeRate_rate_check" CHECK ("rate" > 0),
  ADD CONSTRAINT "ExchangeRate_pair_check" CHECK ("base" <> "currency");

-- The currency a new income / expense starts in (null: the main currency).
ALTER TABLE "User"
  ADD COLUMN "incomeCurrency" CHAR(3),
  ADD COLUMN "expenseCurrency" CHAR(3);

-- The owner's income arrives in US dollars.
UPDATE "User" SET "incomeCurrency" = 'USD';
