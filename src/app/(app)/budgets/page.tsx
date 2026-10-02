import type { Metadata } from "next";
import { BudgetsView } from "@/components/budgets/budgets-view";
import { MonthSwitcher } from "@/components/month-switcher";
import { isValidMonthKey, monthKeyOf, shiftMonth } from "@/lib/dates";
import { loadPageContext } from "@/lib/server/page-context";
import { budgetsForMonth } from "@/lib/server/services/budgets";
import { getCurrencies } from "@/lib/server/services/currency";

export const metadata: Metadata = { title: "Budgets" };

export default async function BudgetsPage({ searchParams }: PageProps<"/budgets">) {
  const { settings, today } = await loadPageContext();
  const currentMonth = monthKeyOf(today);
  const requested = (await searchParams).month;
  // Budgets can be planned up to a year ahead.
  const latest = shiftMonth(currentMonth, 12);
  const month = typeof requested === "string" && isValidMonthKey(requested) && requested <= latest ? requested : currentMonth;
  const { conversion } = await getCurrencies(settings.baseCurrency);
  const budgets = await budgetsForMonth(month, conversion);

  return (
    <BudgetsView
      month={month}
      lines={budgets.lines}
      switcher={<MonthSwitcher month={month} current={currentMonth} max={latest} basePath="/budgets" />}
    />
  );
}
