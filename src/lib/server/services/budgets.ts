import "server-only";
import { monthEnd, monthStart, toDbDate, type MonthKey } from "@/lib/dates";
import { addMoney, percentOf, subtractMoney, toMinor, type Money } from "@/lib/money";
import type { BudgetLine, CategoryTotal } from "@/lib/types";
import { prisma } from "../db";
import { invalid } from "../errors";
import { categoryTotals } from "./analytics";
import { requireCategory } from "./categories";
import { money } from "./mappers";

/** Thresholds for calm budget signals. */
export const BUDGET_WARNING_PERCENT = 80;

export function budgetStatus(percent: number): BudgetLine["status"] {
  if (percent > 100) return "over";
  if (percent >= 100) return "reached";
  if (percent >= BUDGET_WARNING_PERCENT) return "warning";
  return "ok";
}

export interface MonthBudgets {
  month: MonthKey;
  lines: BudgetLine[];
  /** Spending this month in categories without a budget. */
  unbudgeted: CategoryTotal[];
  totalBudget: Money;
  totalSpent: Money;
}

interface BudgetRow {
  id: string;
  name: string;
  kind: "EXPENSE";
  icon: string;
  color: string;
  defaultScope: "FAMILY" | "PERSONAL" | "OTHER" | null;
  isArchived: boolean;
  budget: string;
  effectiveFrom: string;
  spent: string;
}

/**
 * Budgets in effect for a month (the latest row at or before it), with
 * spending from the ExpenseEntry view — so transfers counted as expense
 * count against their category's budget too.
 */
export async function budgetsForMonth(month: MonthKey, currency: string): Promise<MonthBudgets> {
  const start = monthStart(month);
  const end = monthEnd(month);
  const [rows, spending] = await Promise.all([
    prisma.$queryRaw<BudgetRow[]>`
      WITH effective AS (
        SELECT DISTINCT ON (b."categoryId") b."categoryId", b."amount", b."effectiveFrom"
        FROM "Budget" b
        WHERE b."effectiveFrom" <= ${start}::date
        ORDER BY b."categoryId", b."effectiveFrom" DESC
      ),
      spent AS (
        SELECT "categoryId", SUM("amount") AS "total" FROM "ExpenseEntry"
        WHERE "currency" = ${currency} AND "date" BETWEEN ${start}::date AND ${end}::date
        GROUP BY "categoryId"
      )
      SELECT c."id", c."name", c."kind"::text AS "kind", c."icon", c."color", c."defaultScope"::text AS "defaultScope", c."isArchived",
             e."amount"::text AS "budget", to_char(e."effectiveFrom", 'YYYY-MM') AS "effectiveFrom",
             COALESCE(s."total", 0)::text AS "spent"
      FROM effective e
      JOIN "Category" c ON c."id" = e."categoryId"
      LEFT JOIN spent s ON s."categoryId" = c."id"
      WHERE e."amount" > 0
      ORDER BY c."sortOrder", c."name"`,
    categoryTotals(start, end, currency, "EXPENSE"),
  ]);

  const lines: BudgetLine[] = rows.map((row) => {
    const budget = money(row.budget);
    const spent = money(row.spent);
    const percent = percentOf(spent, budget) ?? 0;
    return {
      category: {
        id: row.id,
        name: row.name,
        kind: "EXPENSE",
        icon: row.icon,
        color: row.color,
        defaultScope: row.defaultScope,
        isArchived: row.isArchived,
      },
      budget,
      spent,
      remaining: subtractMoney(budget, spent),
      percent,
      status: budgetStatus(percent),
      effectiveFrom: row.effectiveFrom,
    };
  });

  const budgeted = new Set(lines.map((l) => l.category.id));
  return {
    month,
    lines,
    unbudgeted: spending.filter((c) => !budgeted.has(c.categoryId)),
    totalBudget: addMoney(...lines.map((l) => l.budget)),
    totalSpent: addMoney(...lines.map((l) => l.spent)),
  };
}

/**
 * Set a category's monthly budget from `month` onward (until the next
 * change). An amount of 0 removes the budget from that month on.
 */
export async function setBudget(categoryId: string, month: MonthKey, amount: Money) {
  await prisma.$transaction(async (tx) => {
    const category = await requireCategory(tx, categoryId, "EXPENSE");
    if (category.isArchived) throw invalid("That category is archived.");
    const effectiveFrom = toDbDate(monthStart(month));
    await tx.budget.upsert({
      where: { categoryId_effectiveFrom: { categoryId, effectiveFrom } },
      create: { categoryId, effectiveFrom, amount },
      update: { amount },
    });
    // Tidy: a zero row with nothing in effect before it is redundant.
    if (toMinor(amount) === 0n) {
      const earlier = await tx.budget.findFirst({
        where: { categoryId, effectiveFrom: { lt: effectiveFrom } },
        orderBy: { effectiveFrom: "desc" },
        select: { amount: true },
      });
      if (!earlier || toMinor(money(earlier.amount)) === 0n) {
        await tx.budget.delete({ where: { categoryId_effectiveFrom: { categoryId, effectiveFrom } } });
      }
    }
  });
}
