import type { Metadata } from "next";
import { AccountsView } from "@/components/accounts/accounts-view";
import { loadPageContext } from "@/lib/server/page-context";
import { listAccounts, totalBalance } from "@/lib/server/services/accounts";

export const metadata: Metadata = { title: "Accounts" };

export default async function AccountsPage() {
  const { settings, today } = await loadPageContext();
  const accounts = await listAccounts(today);
  const foreignCurrencies = [...new Set(accounts.map((a) => a.currency))].filter((c) => c !== settings.baseCurrency);

  return (
    <AccountsView
      total={totalBalance(accounts, settings.baseCurrency)}
      foreign={foreignCurrencies.map((currency) => ({ currency, total: totalBalance(accounts, currency) }))}
    />
  );
}
