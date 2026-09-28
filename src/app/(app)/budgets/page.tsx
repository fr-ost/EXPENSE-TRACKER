import type { Metadata } from "next";
import { BudgetsView } from "@/components/budgets/budgets-view";
import { MonthSwitcher } from "@/components/month-switcher";
import { isValidMonthKey, monthKeyOf, shiftMonth } from "@/lib/dates";
import { loadPageContext } from "@/lib/server/page-context";
import { budgetsForMonth } from "@/lib/server/services/budgets";

export const metadata: Metadata = { title: "Budgets" };

export default async function BudgetsPage({ searchParams }: PageProps<"/budgets">) {
  const { settings, today } = await loadPageContext();
  const currentMonth = monthKeyOf(today);
  const requested = (await searchParams).month;
  // Budgets can be planned up to a year ahead.
  const latest = shiftMonth(currentMonth, 12);
  const month = typeof requested === "string" && isValidMonthKey(requested) && requested <= latest ? requested : currentMonth;
  const budgets = await budgetsForMonth(month, settings.baseCurrency);

  return (
    <BudgetsView
      month={month}
      lines={budgets.lines}
      unbudgeted={budgets.unbudgeted}
      totalBudget={budgets.totalBudget}
      totalSpent={budgets.totalSpent}
      switcher={<MonthSwitcher month={month} current={currentMonth} max={latest} basePath="/budgets" />}
    />
  );
}
