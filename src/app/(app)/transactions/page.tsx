import { ListIcon, SearchXIcon } from "lucide-react";
import type { Metadata } from "next";
import { Amount } from "@/components/app-data";
import { PageHeader } from "@/components/layout/page-header";
import { Pagination } from "@/components/pagination";
import { EmptyState } from "@/components/states";
import { ExportMenu } from "@/components/transactions/export-menu";
import { NewTransactionButton } from "@/components/transactions/new-transaction-button";
import { TransactionFilterBar } from "@/components/transactions/transaction-filters";
import { TransactionList } from "@/components/transactions/transaction-list";
import { loadPageContext } from "@/lib/server/page-context";
import { listTransactions } from "@/lib/server/services/transactions";
import { parseTransactionFilters } from "@/lib/validation";

export const metadata: Metadata = { title: "Transactions" };

export default async function TransactionsPage({ searchParams }: PageProps<"/transactions">) {
  const { settings, today } = await loadPageContext();
  const params = await searchParams;
  const filters = parseTransactionFilters(params);
  const result = await listTransactions(filters, settings.baseCurrency);

  const hasFilters = Object.entries(filters).some(([key, value]) => key !== "page" && key !== "sort" && value !== undefined);
  const groupByDate = !filters.sort || filters.sort === "newest" || filters.sort === "oldest";

  return (
    <>
      <PageHeader
        title="Transactions"
        description={
          result.total === 0
            ? "Every income, expense and transfer, in one ledger."
            : `${result.total.toLocaleString("en-US")} ${result.total === 1 ? "transaction" : "transactions"}${hasFilters ? " match" : ""}`
        }
        actions={
          <>
            <ExportMenu />
            <NewTransactionButton className="hidden sm:inline-flex" />
          </>
        }
      />

      <div className="flex flex-col gap-5">
        <TransactionFilterBar filters={filters} />

        {result.total > 0 && (
          <dl className="grid grid-cols-3 divide-x divide-border rounded-xl border border-border bg-surface-subtle">
            <SummaryStat label="Income" value={<Amount value={result.summary.income} tone="income" />} />
            <SummaryStat label="Spending" value={<Amount value={result.summary.expenses} />} />
            <SummaryStat label="Transfers" value={<Amount value={result.summary.transfers} className="text-text-secondary" />} />
          </dl>
        )}

        {result.items.length > 0 ? (
          <div>
            <TransactionList items={result.items} today={today} groupByDate={groupByDate} perspectiveAccountId={filters.accountId} />
            <Pagination
              page={result.page}
              pageCount={result.pageCount}
              total={result.total}
              pageSize={result.pageSize}
              searchParams={params}
              basePath="/transactions"
            />
          </div>
        ) : hasFilters ? (
          <EmptyState
            icon={<SearchXIcon />}
            title="No matching transactions"
            description="Try a different search, or remove some filters."
          />
        ) : (
          <EmptyState
            icon={<ListIcon />}
            title="No transactions yet"
            description="Record what you spend, earn and move between accounts. Older entries from previous months and years are welcome too."
            action={<NewTransactionButton label="Add your first transaction" />}
          />
        )}
      </div>
    </>
  );
}

function SummaryStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 px-3 py-3 sm:px-5">
      <dt className="text-caption font-medium text-text-tertiary">{label}</dt>
      <dd className="truncate text-body font-semibold sm:text-heading">{value}</dd>
    </div>
  );
}
