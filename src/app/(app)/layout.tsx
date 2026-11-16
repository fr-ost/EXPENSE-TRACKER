import { AppDataProvider } from "@/components/app-data";
import { AppShell } from "@/components/layout/app-shell";
import { TransactionSheetProvider } from "@/components/transactions/transaction-sheet";
import { loadPageContext } from "@/lib/server/page-context";
import { listAccounts } from "@/lib/server/services/accounts";
import { listCategories } from "@/lib/server/services/categories";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { userId, session, settings, today } = await loadPageContext();
  const [accounts, categories] = await Promise.all([listAccounts(userId, today), listCategories(userId)]);

  return (
    <AppDataProvider value={{ settings, today, accounts, categories }}>
      <TransactionSheetProvider>
        {/* Locking needs a PIN to come back with: without one there is no lock. */}
        <AppShell autoLockMinutes={session.autoLockMinutes} canLock={session.hasPin}>
          {children}
        </AppShell>
      </TransactionSheetProvider>
    </AppDataProvider>
  );
}
