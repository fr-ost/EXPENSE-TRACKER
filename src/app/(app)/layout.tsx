import { AppDataProvider } from "@/components/app-data";
import { AppShell } from "@/components/layout/app-shell";
import { TransactionSheetProvider } from "@/components/transactions/transaction-sheet";
import { loadPageContext } from "@/lib/server/page-context";
import { listAccounts } from "@/lib/server/services/accounts";
import { listCategories } from "@/lib/server/services/categories";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { settings, today } = await loadPageContext();
  const [accounts, categories] = await Promise.all([listAccounts(today), listCategories()]);

  return (
    <AppDataProvider value={{ settings, today, accounts, categories }}>
      <TransactionSheetProvider>
        <AppShell autoLockMinutes={settings.autoLockMinutes}>{children}</AppShell>
      </TransactionSheetProvider>
    </AppDataProvider>
  );
}
