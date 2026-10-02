"use client";

import { ChevronDownIcon, PlusIcon, WalletIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { useAppData } from "@/components/app-data";
import { BalanceTotal } from "@/components/balance-total";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import type { AccountSummary, BalanceTotals, ForeignCurrency } from "@/lib/types";
import { AccountCard } from "./account-card";
import { AccountFormSheet } from "./account-form-sheet";

export function AccountsView({ totals, foreign }: { totals: BalanceTotals; foreign: ForeignCurrency[] }) {
  const { accounts, today } = useAppData();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [formKey, setFormKey] = React.useState(0);
  const [formOpen, setFormOpen] = React.useState(searchParams.get("new") === "1");
  const [showInactive, setShowInactive] = React.useState(false);

  // "/accounts?new=1" (from empty states elsewhere) opens the form once.
  React.useEffect(() => {
    if (searchParams.get("new") === "1") router.replace(pathname, { scroll: false });
  }, [searchParams, router, pathname]);

  const openForm = () => {
    setFormKey((k) => k + 1);
    setFormOpen(true);
  };

  const active = accounts.filter((a) => a.isActive);
  const inactive = accounts.filter((a) => !a.isActive);

  return (
    <>
      <PageHeader
        title="Accounts"
        description="Where your money lives. Balances are calculated from your transactions."
        actions={
          <Button onClick={openForm}>
            <PlusIcon />
            Add account
          </Button>
        }
      />

      {accounts.length === 0 ? (
        <EmptyState
          icon={<WalletIcon />}
          title="Add your first account"
          description="Start with where your money is right now — a cash wallet, a bank account, bKash or Nagad. Set the balance it held on a date, and every transaction after that keeps it up to date."
          action={
            <Button onClick={openForm}>
              <PlusIcon />
              Add account
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-8">
          <BalanceTotal totals={totals} foreign={foreign} />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {active.map((account) => (
              <AccountCard key={account.id} account={account} today={today} />
            ))}
          </div>

          {inactive.length > 0 && (
            <section className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() => setShowInactive((v) => !v)}
                aria-expanded={showInactive}
                className="inline-flex items-center gap-1.5 self-start text-small font-medium text-text-secondary hover:text-text"
              >
                <ChevronDownIcon className={`size-4 transition-transform ${showInactive ? "" : "-rotate-90"}`} />
                Inactive ({inactive.length})
              </button>
              {showInactive && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {inactive.map((account: AccountSummary) => (
                    <AccountCard key={account.id} account={account} today={today} />
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      )}

      <AccountFormSheet key={formKey} open={formOpen} onOpenChange={setFormOpen} />
    </>
  );
}
