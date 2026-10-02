import { BarChart3Icon } from "lucide-react";
import type { Metadata } from "next";
import { Amount } from "@/components/app-data";
import { CashflowChart } from "@/components/charts/cashflow-chart";
import { DailyChart } from "@/components/charts/daily-chart";
import { SavingsChart } from "@/components/charts/savings-chart";
import { PageHeader } from "@/components/layout/page-header";
import { PeriodControls } from "@/components/reports/period-controls";
import { AccountActivityTable, CategoryTable, Highlight, ScopeColumns, Statement } from "@/components/reports/report-sections";
import { EmptyState } from "@/components/states";
import { NewTransactionButton } from "@/components/transactions/new-transaction-button";
import { Card, CardHeader } from "@/components/ui/misc";
import { formatMonth } from "@/lib/dates";
import { SCOPE_META } from "@/lib/domain";
import { loadPageContext } from "@/lib/server/page-context";
import { getCurrencies } from "@/lib/server/services/currency";
import { buildReport, parseReportPeriod } from "@/lib/server/services/reports";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  const { settings, today } = await loadPageContext();
  const period = parseReportPeriod(await searchParams, today);
  const { conversion } = await getCurrencies(settings.baseCurrency);
  const report = await buildReport(period, conversion, today);
  const s = report.summary;
  const transactionsQuery = period.kind === "month" ? `month=${period.month}` : `year=${period.year}`;
  const family = report.scopes.find((x) => x.scope === "FAMILY");
  const personal = report.scopes.find((x) => x.scope === "PERSONAL");
  const rate = s.savingsRate === null ? "—" : `${s.savingsRate.toFixed(1)}%`;
  const empty = [s.income, s.expenses, s.transfers, s.adjustments].every((v) => v === "0.00");

  if (empty) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Reports" description={report.label} actions={<PeriodControls period={period} today={today} />} />
        <EmptyState
          icon={<BarChart3Icon />}
          title={`Nothing recorded in ${report.label}`}
          description="Choose another period, or add transactions from this time — older entries are welcome and balances stay correct."
          action={<NewTransactionButton label="Add a transaction" />}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Reports"
        description={period.kind === "month" ? "A month in detail." : "The year at a glance, month by month."}
        actions={<PeriodControls period={period} today={today} />}
      />

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border lg:grid-cols-4">
        <Highlight label="Income">
          <Amount value={s.income} tabular={false} />
        </Highlight>
        <Highlight label="Spending" hint={s.transferExpenses !== "0.00" ? <>incl. <Amount value={s.transferExpenses} /> transfers</> : undefined}>
          <Amount value={s.expenses} tabular={false} />
        </Highlight>
        <Highlight label="Net savings">
          <Amount value={s.netSavings} tabular={false} tone={s.netSavings.startsWith("-") ? "signed" : "none"} />
        </Highlight>
        <Highlight label="Savings rate">{rate}</Highlight>
        {period.kind === "year" && (
          <>
            <Highlight label={`${SCOPE_META.FAMILY.label} spending`} hint={`${Math.round(family?.share ?? 0)}% of spending`}>
              <Amount value={family?.total ?? "0.00"} tabular={false} />
            </Highlight>
            <Highlight label={`${SCOPE_META.PERSONAL.label} spending`} hint={`${Math.round(personal?.share ?? 0)}% of spending`}>
              <Amount value={personal?.total ?? "0.00"} tabular={false} />
            </Highlight>
            <Highlight label="Highest category" hint={report.highestCategory ? <Amount value={report.highestCategory.total} /> : undefined}>
              {report.highestCategory?.name ?? "—"}
            </Highlight>
            <Highlight label="Highest spending month" hint={report.highestSpendingMonth ? <Amount value={report.highestSpendingMonth.expenses} /> : undefined}>
              {report.highestSpendingMonth ? formatMonth(report.highestSpendingMonth.month) : "—"}
            </Highlight>
          </>
        )}
      </dl>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader title="Statement" description={report.label} />
          <div className="px-5 pb-5 pt-3 sm:px-6">
            <Statement summary={s} transactionsQuery={transactionsQuery} />
          </div>
        </Card>
        <div className="flex flex-col gap-4 lg:col-span-3">
          {report.daily && (
            <Card>
              <CardHeader title="Daily spending" description={report.label} />
              <div className="px-4 pb-5 pt-4 sm:px-6">
                <DailyChart days={report.daily} />
              </div>
            </Card>
          )}
          {report.months && (
            <>
              <Card>
                <CardHeader title="Income vs spending" description="By month" />
                <div className="h-[300px] px-4 pb-5 pt-4 sm:px-6">
                  <CashflowChart months={report.months} />
                </div>
              </Card>
              <Card>
                <CardHeader title="Savings trend" description="Income minus spending, by month" />
                <div className="px-4 pb-5 pt-4 sm:px-6">
                  <SavingsChart months={report.months} />
                </div>
              </Card>
            </>
          )}
        </div>
      </div>

      <section className="flex flex-col gap-3" aria-labelledby="scope-heading">
        <h2 id="scope-heading" className="text-heading font-semibold text-text">
          Family &amp; personal
        </h2>
        <ScopeColumns scopes={report.scopes} scopeCategories={report.scopeCategories} transactionsQuery={transactionsQuery} />
      </section>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <Card id="categories" className="scroll-mt-20">
          <CardHeader title="Spending by category" description={`${report.categories.length} categories`} />
          <div className="px-5 pb-4 pt-3 sm:px-6">
            <CategoryTable categories={report.categories} transactionsQuery={transactionsQuery} empty="No spending in this period" />
          </div>
        </Card>
        <Card>
          <CardHeader title="Income by source" />
          <div className="px-5 pb-4 pt-3 sm:px-6">
            <CategoryTable categories={report.incomeCategories} transactionsQuery={transactionsQuery} empty="No income in this period" />
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Account activity" description="Opening balance, money in and out, and closing balance for the period" />
        <div className="px-5 pb-4 pt-3 sm:px-6">
          <AccountActivityTable accounts={report.accounts} />
        </div>
      </Card>
    </div>
  );
}
