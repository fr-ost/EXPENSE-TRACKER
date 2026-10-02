import type { Metadata } from "next";
import { AccountsView } from "@/components/accounts/accounts-view";
import { loadPageContext } from "@/lib/server/page-context";
import { listAccounts } from "@/lib/server/services/accounts";
import { balanceTotals, getCurrencies } from "@/lib/server/services/currency";

export const metadata: Metadata = { title: "Accounts" };

export default async function AccountsPage() {
  const { settings, today } = await loadPageContext();
  const [accounts, { conversion, foreign }] = await Promise.all([listAccounts(today), getCurrencies(settings.baseCurrency)]);
  return <AccountsView totals={balanceTotals(accounts, conversion)} foreign={foreign} />;
}
