import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { monthEnd, monthStart, type ISODate, type MonthKey } from "@/lib/dates";
import type { AccountType, ExpenseScope } from "@/lib/domain";
import { EXPENSE_SCOPES } from "@/lib/domain";
import { compareMoney, fromMinor, percentOf, subtractMoney, toMinor } from "@/lib/money";
import type { AccountActivity, CategoryTotal, CurrencyAmount, DayPoint, MonthPoint, PeriodSummary, ScopeTotal } from "@/lib/types";
import { prisma } from "../db";
import { asConversion, ratesTable, type CurrencyBasis } from "./currency";
import { money } from "./mappers";

/**
 * Analytics read exclusively from the ledger views defined in the migrations:
 *   IncomeEntry  — income
 *   ExpenseEntry — expenses + transfers flagged "count as expense"
 *   LedgerEntry  — every account movement (balances, inflow/outflow)
 * Totals are in the main currency: each amount in another currency is
 * converted at its rate (`fx`, see currency.ts) and rounded on its own, so
 * every breakdown adds up to its total. Currencies without a rate are left
 * out. A plain currency code counts just that currency.
 */

const EXPENSES = Prisma.raw('"ExpenseEntry"');
const INCOME = Prisma.raw('"IncomeEntry"');

/** Amounts in other currencies, in their own currency, from a JSON aggregate. */
function foreignAmounts(rows: Array<{ currency: string; amount: string }> | null): CurrencyAmount[] {
  return (rows ?? []).map((row) => ({ currency: row.currency, amount: money(row.amount) }));
}

export async function periodSummary(from: ISODate, to: ISODate, fx: CurrencyBasis): Promise<PeriodSummary> {
  const { base } = asConversion(fx);
  const [row] = await prisma.$queryRaw<
    Array<{
      income: string;
      expenses: string;
      transferExpenses: string;
      transfers: string;
      transferCount: number;
      adjustments: string;
      foreignIncome: Array<{ currency: string; amount: string }> | null;
      foreignExpenses: Array<{ currency: string; amount: string }> | null;
    }>
  >`
    WITH ${ratesTable(fx)},
    income AS (
      SELECT e."currency"::text AS "currency", e."amount", ROUND(e."amount" * fx."rate", 2) AS "converted"
      FROM "IncomeEntry" e JOIN fx ON fx."currency" = e."currency"
      WHERE e."date" BETWEEN ${from}::date AND ${to}::date
    ),
    expenses AS (
      SELECT e."currency"::text AS "currency", e."type", e."amount", ROUND(e."amount" * fx."rate", 2) AS "converted"
      FROM "ExpenseEntry" e JOIN fx ON fx."currency" = e."currency"
      WHERE e."date" BETWEEN ${from}::date AND ${to}::date
    ),
    transfers AS (
      SELECT ROUND(t."amount" * fx."rate", 2) AS "converted"
      FROM "Transaction" t JOIN "Account" a ON a."id" = t."accountId" JOIN fx ON fx."currency" = a."currency"
      WHERE t."type" = 'TRANSFER' AND NOT t."countAsExpense" AND t."date" BETWEEN ${from}::date AND ${to}::date
    )
    SELECT
      (SELECT COALESCE(SUM("converted"), 0) FROM income)::text AS "income",
      (SELECT COALESCE(SUM("converted"), 0) FROM expenses)::text AS "expenses",
      (SELECT COALESCE(SUM("converted"), 0) FROM expenses WHERE "type" = 'TRANSFER')::text AS "transferExpenses",
      (SELECT COALESCE(SUM("converted"), 0) FROM transfers)::text AS "transfers",
      (SELECT COUNT(*) FROM transfers)::int AS "transferCount",
      (SELECT COALESCE(SUM(ROUND(l."amount" * fx."rate", 2)), 0) FROM "LedgerEntry" l JOIN fx ON fx."currency" = l."currency"
        WHERE l."type" = 'ADJUSTMENT' AND l."date" BETWEEN ${from}::date AND ${to}::date)::text AS "adjustments",
      (SELECT json_agg(json_build_object('currency', f."currency", 'amount', f."amount"::text) ORDER BY f."currency")
        FROM (SELECT "currency", SUM("amount") AS "amount" FROM income WHERE "currency" <> ${base} GROUP BY "currency") f) AS "foreignIncome",
      (SELECT json_agg(json_build_object('currency', f."currency", 'amount', f."amount"::text) ORDER BY f."currency")
        FROM (SELECT "currency", SUM("amount") AS "amount" FROM expenses WHERE "currency" <> ${base} GROUP BY "currency") f) AS "foreignExpenses"`;

  const income = money(row.income);
  const expenses = money(row.expenses);
  const transferExpenses = money(row.transferExpenses);
  const netSavings = subtractMoney(income, expenses);
  return {
    from,
    to,
    currency: base,
    income,
    expenses,
    directExpenses: subtractMoney(expenses, transferExpenses),
    transferExpenses,
    transfers: money(row.transfers),
    transferCount: row.transferCount,
    adjustments: money(row.adjustments),
    netSavings,
    savingsRate: toMinor(income) > 0n ? percentOf(netSavings, income) : null,
    foreignIncome: foreignAmounts(row.foreignIncome),
    foreignExpenses: foreignAmounts(row.foreignExpenses),
  };
}

export async function monthlySeries(first: MonthKey, last: MonthKey, fx: CurrencyBasis): Promise<MonthPoint[]> {
  const start = monthStart(first);
  const end = monthEnd(last);
  const rows = await prisma.$queryRaw<Array<{ month: string; income: string; expenses: string }>>`
    WITH ${ratesTable(fx)},
    months AS (
      SELECT to_char(m, 'YYYY-MM') AS "month"
      FROM generate_series(${start}::date, ${monthStart(last)}::date, interval '1 month') AS m
    ),
    inc AS (
      SELECT to_char(e."date", 'YYYY-MM') AS "month", SUM(ROUND(e."amount" * fx."rate", 2)) AS "total"
      FROM "IncomeEntry" e JOIN fx ON fx."currency" = e."currency"
      WHERE e."date" BETWEEN ${start}::date AND ${end}::date GROUP BY 1
    ),
    exp AS (
      SELECT to_char(e."date", 'YYYY-MM') AS "month", SUM(ROUND(e."amount" * fx."rate", 2)) AS "total"
      FROM "ExpenseEntry" e JOIN fx ON fx."currency" = e."currency"
      WHERE e."date" BETWEEN ${start}::date AND ${end}::date GROUP BY 1
    )
    SELECT months."month", COALESCE(inc."total", 0)::text AS "income", COALESCE(exp."total", 0)::text AS "expenses"
    FROM months LEFT JOIN inc USING ("month") LEFT JOIN exp USING ("month")
    ORDER BY months."month"`;

  return rows.map((row) => {
    const income = money(row.income);
    const expenses = money(row.expenses);
    const savings = subtractMoney(income, expenses);
    return {
      month: row.month,
      income,
      expenses,
      savings,
      savingsRate: toMinor(income) > 0n ? percentOf(savings, income) : null,
    };
  });
}

export async function categoryTotals(
  from: ISODate,
  to: ISODate,
  fx: CurrencyBasis,
  kind: "EXPENSE" | "INCOME" = "EXPENSE",
  scope?: ExpenseScope,
): Promise<CategoryTotal[]> {
  const source = kind === "EXPENSE" ? EXPENSES : INCOME;
  const scopeFilter = kind === "EXPENSE" && scope ? Prisma.sql`AND e."scope" = ${scope}::"ExpenseScope"` : Prisma.empty;
  const rows = await prisma.$queryRaw<Array<{ categoryId: string; name: string; icon: string; color: string; total: string; count: number }>>`
    WITH ${ratesTable(fx)}
    SELECT c."id" AS "categoryId", c."name", c."icon", c."color",
           SUM(ROUND(e."amount" * fx."rate", 2))::text AS "total", COUNT(*)::int AS "count"
    FROM ${source} e JOIN fx ON fx."currency" = e."currency" JOIN "Category" c ON c."id" = e."categoryId"
    WHERE e."date" BETWEEN ${from}::date AND ${to}::date ${scopeFilter}
    GROUP BY c."id" ORDER BY SUM(ROUND(e."amount" * fx."rate", 2)) DESC, c."name"`;

  const grand = rows.reduce((sum, r) => sum + toMinor(money(r.total)), 0n);
  return rows.map((row) => {
    const total = money(row.total);
    return { ...row, total, share: percentOf(total, grand) ?? 0 };
  });
}

export async function scopeTotals(from: ISODate, to: ISODate, fx: CurrencyBasis): Promise<ScopeTotal[]> {
  const rows = await prisma.$queryRaw<Array<{ scope: ExpenseScope; total: string; count: number }>>`
    WITH ${ratesTable(fx)}
    SELECT e."scope"::text AS "scope", SUM(ROUND(e."amount" * fx."rate", 2))::text AS "total", COUNT(*)::int AS "count"
    FROM "ExpenseEntry" e JOIN fx ON fx."currency" = e."currency"
    WHERE e."date" BETWEEN ${from}::date AND ${to}::date
    GROUP BY e."scope"`;
  const grand = rows.reduce((sum, r) => sum + toMinor(money(r.total)), 0n);
  return EXPENSE_SCOPES.map((scope) => {
    const row = rows.find((r) => r.scope === scope);
    const total = money(row?.total ?? "0");
    return { scope, total, count: row?.count ?? 0, share: percentOf(total, grand) ?? 0 };
  });
}

/** Spending per calendar day, including zero days. */
export async function dailySpending(from: ISODate, to: ISODate, fx: CurrencyBasis): Promise<DayPoint[]> {
  const rows = await prisma.$queryRaw<Array<{ date: string; total: string }>>`
    WITH ${ratesTable(fx)},
    days AS (SELECT d::date AS "date" FROM generate_series(${from}::date, ${to}::date, interval '1 day') AS d),
    spent AS (
      SELECT e."date", SUM(ROUND(e."amount" * fx."rate", 2)) AS "total"
      FROM "ExpenseEntry" e JOIN fx ON fx."currency" = e."currency"
      WHERE e."date" BETWEEN ${from}::date AND ${to}::date
      GROUP BY e."date"
    )
    SELECT to_char(days."date", 'YYYY-MM-DD') AS "date", COALESCE(spent."total", 0)::text AS "total"
    FROM days LEFT JOIN spent ON spent."date" = days."date"
    ORDER BY days."date"`;
  return rows.map((row) => ({ date: row.date, total: money(row.total) }));
}

/** Running totals of daily spending (exact, bigint). */
export function cumulative(points: DayPoint[]): DayPoint[] {
  let running = 0n;
  return points.map((p) => {
    running += toMinor(p.total);
    return { date: p.date, total: fromMinor(running) };
  });
}

/** Opening balance, money in/out and closing balance per account for a period. */
export async function accountActivity(from: ISODate, to: ISODate): Promise<AccountActivity[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      name: string;
      type: AccountType;
      currency: string;
      icon: string | null;
      color: string | null;
      isActive: boolean;
      openingBalance: string;
      inflow: string;
      outflow: string;
      closingBalance: string;
      transactionCount: number;
    }>
  >`
    SELECT a."id", a."name", a."type"::text AS "type", a."currency", a."icon", a."color", a."isActive",
      (a."openingBalance" + COALESCE(SUM(l."amount") FILTER (WHERE l."date" < ${from}::date), 0))::text AS "openingBalance",
      COALESCE(SUM(l."amount") FILTER (WHERE l."date" BETWEEN ${from}::date AND ${to}::date AND l."amount" > 0), 0)::text AS "inflow",
      COALESCE(-SUM(l."amount") FILTER (WHERE l."date" BETWEEN ${from}::date AND ${to}::date AND l."amount" < 0), 0)::text AS "outflow",
      (a."openingBalance" + COALESCE(SUM(l."amount") FILTER (WHERE l."date" <= ${to}::date), 0))::text AS "closingBalance",
      COUNT(l."transactionId") FILTER (WHERE l."date" BETWEEN ${from}::date AND ${to}::date)::int AS "transactionCount"
    FROM "Account" a
    LEFT JOIN "LedgerEntry" l ON l."accountId" = a."id"
    GROUP BY a."id"
    HAVING a."openingDate" <= ${to}::date OR COUNT(l."transactionId") FILTER (WHERE l."date" <= ${to}::date) > 0
    ORDER BY a."isActive" DESC, a."sortOrder", a."createdAt"`;

  return rows.map((row) => ({
    ...row,
    openingBalance: money(row.openingBalance),
    inflow: money(row.inflow),
    outflow: money(row.outflow),
    closingBalance: money(row.closingBalance),
  }));
}

export interface YearReport {
  year: number;
  summary: PeriodSummary;
  months: MonthPoint[];
  scopes: ScopeTotal[];
  categories: CategoryTotal[];
  incomeCategories: CategoryTotal[];
  highestCategory: CategoryTotal | null;
  highestSpendingMonth: MonthPoint | null;
}

export async function yearReport(year: number, fx: CurrencyBasis): Promise<YearReport> {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const [summary, months, scopes, categories, incomeCategories] = await Promise.all([
    periodSummary(from, to, fx),
    monthlySeries(`${year}-01`, `${year}-12`, fx),
    scopeTotals(from, to, fx),
    categoryTotals(from, to, fx, "EXPENSE"),
    categoryTotals(from, to, fx, "INCOME"),
  ]);
  const highestSpendingMonth = months.reduce<MonthPoint | null>(
    (best, m) => (toMinor(m.expenses) > 0n && (!best || compareMoney(m.expenses, best.expenses) > 0) ? m : best),
    null,
  );
  return {
    year,
    summary,
    months,
    scopes,
    categories,
    incomeCategories,
    highestCategory: categories[0] ?? null,
    highestSpendingMonth,
  };
}

/** Earliest and latest transaction dates (for period pickers). */
export async function ledgerRange(): Promise<{ first: ISODate | null; last: ISODate | null }> {
  const [row] = await prisma.$queryRaw<Array<{ first: string | null; last: string | null }>>`
    SELECT to_char(MIN("date"), 'YYYY-MM-DD') AS "first", to_char(MAX("date"), 'YYYY-MM-DD') AS "last" FROM "Transaction"`;
  return row;
}

