import "server-only";
import { monthEnd, monthStart, toDbDate, type MonthKey } from "@/lib/dates";
import { EXPENSE_SCOPES, type ExpenseScope } from "@/lib/domain";
import { addMoney, percentOf, subtractMoney, toMinor, type Money } from "@/lib/money";
import type { BudgetLine } from "@/lib/types";
import { prisma } from "../db";
import { categoryTotals, scopeTotals } from "./analytics";
import type { CurrencyBasis } from "./currency";
import { money } from "./mappers";

/** Thresholds for calm budget signals. */
export const BUDGET_WARNING_PERCENT = 80;

export function budgetStatus(percent: number): Exclude<BudgetLine["status"], "none"> {
  if (percent > 100) return "over";
  if (percent >= 100) return "reached";
  if (percent >= BUDGET_WARNING_PERCENT) return "warning";
  return "ok";
}

export interface MonthBudgets {
  month: MonthKey;
  /** Personal, then Family — with or without a budget set. */
  lines: BudgetLine[];
  /** Sum of the budgets set, and of the spending they cover. */
  totalBudget: Money;
  totalSpent: Money;
}

/**
 * The Personal and Family budgets in effect for a month (the latest change at
 * or before it), against everything marked as spent for each — whatever the
 * category or currency, transfers counted as expense included.
 */
export async function budgetsForMonth(month: MonthKey, fx: CurrencyBasis): Promise<MonthBudgets> {
  const start = monthStart(month);
  const end = monthEnd(month);
  const [rows, spending, ...categoryLists] = await Promise.all([
    prisma.$queryRaw<Array<{ scope: ExpenseScope; amount: string; effectiveFrom: string }>>`
      SELECT DISTINCT ON (b."scope") b."scope"::text AS "scope", b."amount"::text AS "amount", to_char(b."effectiveFrom", 'YYYY-MM') AS "effectiveFrom"
      FROM "ScopeBudget" b
      WHERE b."effectiveFrom" <= ${start}::date
      ORDER BY b."scope", b."effectiveFrom" DESC`,
    scopeTotals(start, end, fx),
    ...EXPENSE_SCOPES.map((scope) => categoryTotals(start, end, fx, "EXPENSE", scope)),
  ]);

  const lines = EXPENSE_SCOPES.map((scope, i): BudgetLine => {
    const row = rows.find((r) => r.scope === scope && toMinor(money(r.amount)) > 0n);
    const spent = spending.find((s) => s.scope === scope)?.total ?? "0.00";
    const categories = categoryLists[i];
    if (!row) return { scope, budget: null, spent, remaining: null, percent: 0, status: "none", effectiveFrom: null, categories };
    const budget = money(row.amount);
    const percent = percentOf(spent, budget) ?? 0;
    return {
      scope,
      budget,
      spent,
      remaining: subtractMoney(budget, spent),
      percent,
      status: budgetStatus(percent),
      effectiveFrom: row.effectiveFrom,
      categories,
    };
  });

  const budgeted = lines.filter((l) => l.budget !== null);
  return {
    month,
    lines,
    totalBudget: addMoney(...budgeted.map((l) => l.budget!)),
    totalSpent: addMoney(...budgeted.map((l) => l.spent)),
  };
}

/**
 * Set the Personal or Family monthly budget from `month` onward (until the
 * next change). An amount of 0 removes the budget from that month on.
 */
export async function setBudget(scope: ExpenseScope, month: MonthKey, amount: Money) {
  await prisma.$transaction(async (tx) => {
    const effectiveFrom = toDbDate(monthStart(month));
    await tx.scopeBudget.upsert({
      where: { scope_effectiveFrom: { scope, effectiveFrom } },
      create: { scope, effectiveFrom, amount },
      update: { amount },
    });
    // Tidy: a zero row with nothing in effect before it is redundant.
    if (toMinor(amount) === 0n) {
      const earlier = await tx.scopeBudget.findFirst({
        where: { scope, effectiveFrom: { lt: effectiveFrom } },
        orderBy: { effectiveFrom: "desc" },
        select: { amount: true },
      });
      if (!earlier || toMinor(money(earlier.amount)) === 0n) {
        await tx.scopeBudget.delete({ where: { scope_effectiveFrom: { scope, effectiveFrom } } });
      }
    }
  });
}
