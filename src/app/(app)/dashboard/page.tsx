import type { Metadata } from "next";
import Link from "next/link";
import { AccountBalances } from "@/components/dashboard/account-balances";
import { BudgetProgress } from "@/components/dashboard/budget-progress";
import { DashboardHero } from "@/components/dashboard/dashboard-hero";
import { Greeting } from "@/components/dashboard/greeting";
import { Onboarding } from "@/components/dashboard/onboarding";
import { SpendingBreakdown } from "@/components/dashboard/spending-breakdown";
import { SummaryStrip } from "@/components/dashboard/summary-strip";
import { CashflowChart } from "@/components/charts/cashflow-chart";
import { PaceChart } from "@/components/charts/pace-chart";
import { MonthSwitcher } from "@/components/month-switcher";
import { EmptyState } from "@/components/states";
import { NewTransactionButton } from "@/components/transactions/new-transaction-button";
import { TransactionList } from "@/components/transactions/transaction-list";
import { Card, CardHeader } from "@/components/ui/misc";
import { formatDate, isValidMonthKey, minDate, monthEnd, monthKeyOf, monthStart, shiftMonth } from "@/lib/dates";
import { greeting } from "@/lib/greeting";
import { loadPageContext } from "@/lib/server/page-context";
import { listAccounts, totalBalance } from "@/lib/server/services/accounts";
import { categoryTotals, cumulative, dailySpending, monthlySeries, periodSummary, scopeTotals } from "@/lib/server/services/analytics";
import { budgetsForMonth } from "@/lib/server/services/budgets";
import { recentTransactions } from "@/lib/server/services/transactions";

export const metadata: Metadata = { title: "Overview" };

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const { settings, today } = await loadPageContext();
  const currentMonth = monthKeyOf(today);
  const requested = (await searchParams).month;
  const month = typeof requested === "string" && isValidMonthKey(requested) && requested <= currentMonth ? requested : currentMonth;
  const previousMonth = shiftMonth(month, -1);
  const currency = settings.baseCurrency;

  const from = monthStart(month);
  const to = monthEnd(month);
  // Pace lines stop at today for the current month.
  const paceTo = minDate(to, today);

  const [accounts, summary, previousSummary, series, categories, scopes, pace, previousPace, budgets, recent] = await Promise.all([
    listAccounts(today),
    periodSummary(from, to, currency),
    periodSummary(monthStart(previousMonth), monthEnd(previousMonth), currency),
    monthlySeries(shiftMonth(month, -11), month, currency),
    categoryTotals(from, to, currency),
    scopeTotals(from, to, currency),
    from <= paceTo ? dailySpending(from, paceTo, currency) : Promise.resolve([]),
    dailySpending(monthStart(previousMonth), monthEnd(previousMonth), currency),
    budgetsForMonth(month, currency),
    recentTransactions(6, today),
  ]);

  const hello = <Greeting name={settings.displayName} timeZone={settings.timezone} initial={greeting(settings.timezone)} />;

  if (accounts.length === 0) {
    return <Onboarding greeting={hello} />;
  }

  const foreign = [...new Set(accounts.map((a) => a.currency))]
    .filter((c) => c !== currency)
    .map((c) => ({ currency: c, total: totalBalance(accounts, c) }));

  return (
    <div className="flex flex-col gap-8 sm:gap-10">
      <header className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-small text-text-tertiary">{formatDate(today, "long")}</p>
          <h1 className="text-[1.75rem] font-semibold leading-tight tracking-[-0.025em] text-text sm:text-title">{hello}</h1>
        </div>
        <div className="flex items-center gap-2">
          <MonthSwitcher month={month} current={currentMonth} basePath="/dashboard" />
          <NewTransactionButton className="hidden sm:inline-flex" label="New" />
        </div>
      </header>

      <DashboardHero total={totalBalance(accounts, currency)} foreign={foreign} />

      <SummaryStrip current={summary} previous={previousSummary} month={month} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Card className="flex flex-col lg:col-span-3">
          <CardHeader title="Cash flow" description="Income and spending, last 12 months" />
          <div className="flex-1 px-4 pb-5 pt-4 sm:px-6">
            <CashflowChart months={series} highlight={month} />
          </div>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader
            title="Where it went"
            description="Spending by classification and category"
            action={
              <Link href={`/reports?month=${month}`} className="text-small font-medium text-accent-text hover:underline">
                Report
              </Link>
            }
          />
          <div className="px-5 pb-5 pt-4 sm:px-6">
            <SpendingBreakdown scopes={scopes} categories={categories} month={month} />
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Spending pace" description="Cumulative spending by day, against last month" />
          <div className="px-4 pb-5 pt-4 sm:px-6">
            {pace.length || previousPace.some((p) => p.total !== "0.00") ? (
              <PaceChart current={cumulative(pace)} previous={cumulative(previousPace)} month={month} previousMonth={previousMonth} />
            ) : (
              <EmptyState compact title="Nothing to compare yet" description="Once you record spending, you'll see how this month tracks against the last." />
            )}
          </div>
        </Card>
        <Card>
          <CardHeader
            title="Budgets"
            description={budgets.lines.length ? `${budgets.lines.length} budgeted categories` : undefined}
            action={
              <Link href={`/budgets?month=${month}`} className="text-small font-medium text-accent-text hover:underline">
                All budgets
              </Link>
            }
          />
          <div className="px-5 pb-5 pt-4 sm:px-6">
            <BudgetProgress lines={budgets.lines} month={month} />
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader
            title="Recent transactions"
            action={
              <Link href="/transactions" className="text-small font-medium text-accent-text hover:underline">
                View all
              </Link>
            }
          />
          <div className="px-5 pb-4 pt-3 sm:px-6">
            {recent.length ? (
              <TransactionList items={recent} today={today} groupByDate={false} />
            ) : (
              <EmptyState
                compact
                title="No transactions yet"
                description="Add what you spend, earn and move — including older entries."
                action={<NewTransactionButton size="sm" label="Add transaction" />}
              />
            )}
          </div>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader
            title="Accounts"
            action={
              <Link href="/accounts" className="text-small font-medium text-accent-text hover:underline">
                Manage
              </Link>
            }
          />
          <div className="px-5 pb-4 pt-3 sm:px-6">
            <AccountBalances />
          </div>
        </Card>
      </div>
    </div>
  );
}
