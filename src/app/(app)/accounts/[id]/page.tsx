import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccountDetailView } from "@/components/accounts/account-detail-view";
import { addDays, maxDate } from "@/lib/dates";
import { AppError } from "@/lib/server/errors";
import { loadPageContext } from "@/lib/server/page-context";
import { balanceHistory, getAccount } from "@/lib/server/services/accounts";
import { listBalanceUpdates } from "@/lib/server/services/balances";
import { listTransactions } from "@/lib/server/services/transactions";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage({ params }: PageProps<"/accounts/[id]">) {
  const { userId, settings, today } = await loadPageContext();
  const { id } = await params;

  const account = await getAccount(userId, id, today).catch((error) => {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  });

  const from = maxDate(account.openingDate, addDays(today, -180));
  const [history, page, balanceUpdates] = await Promise.all([
    balanceHistory(userId, id, from, today),
    listTransactions(userId, { accountId: id }, settings.baseCurrency),
    listBalanceUpdates(userId, id, 10),
  ]);

  return (
    <AccountDetailView
      account={account}
      history={history}
      transactions={page.items}
      totalTransactions={page.total}
      balanceUpdates={balanceUpdates}
      today={today}
    />
  );
}
