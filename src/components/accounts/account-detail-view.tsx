"use client";

import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ChevronLeftIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  ScaleIcon,
  Trash2Icon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { Amount } from "@/components/app-data";
import { BalanceChart } from "@/components/charts/balance-chart";
import { accountIcon } from "@/components/forms/account-select";
import { IconBadge } from "@/components/icon";
import { EmptyState } from "@/components/states";
import { TransactionList } from "@/components/transactions/transaction-list";
import { useTransactionSheet } from "@/components/transactions/transaction-sheet";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Badge, Card, CardHeader } from "@/components/ui/misc";
import { api, errorMessage } from "@/lib/api-client";
import { describeDay, formatDate, formatTime, type ISODate } from "@/lib/dates";
import { ACCOUNT_TYPE_META } from "@/lib/domain";
import { isZero, type Money } from "@/lib/money";
import type { AccountSummary, BalanceUpdateView, TransactionView } from "@/lib/types";
import { AccountFormSheet } from "./account-form-sheet";
import { BalanceUpdates } from "./balance-updates";
import { UpdateBalanceSheet } from "./update-balance-sheet";

export function AccountDetailView({
  account,
  history,
  transactions,
  totalTransactions,
  balanceUpdates,
  today,
}: {
  account: AccountSummary;
  history: Array<{ date: ISODate; balance: Money }>;
  transactions: TransactionView[];
  totalTransactions: number;
  balanceUpdates: BalanceUpdateView[];
  today: ISODate;
}) {
  const router = useRouter();
  const { openCreate } = useTransactionSheet();
  const [editKey, setEditKey] = React.useState(0);
  const [editOpen, setEditOpen] = React.useState(false);
  const [updateKey, setUpdateKey] = React.useState(0);
  const [updateOpen, setUpdateOpen] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const openUpdate = () => {
    setUpdateKey((k) => k + 1);
    setUpdateOpen(true);
  };
  const lastUpdate = account.lastUpdate;

  async function setActive(isActive: boolean) {
    try {
      await api(`/api/accounts/${account.id}`, {
        method: "PUT",
        body: {
          name: account.name,
          type: account.type,
          currency: account.currency,
          openingBalance: account.openingBalance,
          openingDate: account.openingDate,
          icon: account.icon,
          color: account.color,
          isActive,
        },
      });
      toast.success(isActive ? `${account.name} reactivated` : `${account.name} deactivated`);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api(`/api/accounts/${account.id}`, { method: "DELETE" });
      toast.success(`${account.name} deleted`);
      router.replace("/accounts");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
      setConfirmDelete(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Link href="/accounts" className="mb-4 inline-flex items-center gap-1 text-small font-medium text-text-tertiary hover:text-text">
        <ChevronLeftIcon className="size-4" />
        Accounts
      </Link>

      <header className="mb-8 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <IconBadge icon={accountIcon(account)} color={account.color ?? "slate"} size="lg" />
            <div className="flex flex-col">
              <h1 className="flex items-center gap-2 text-title font-semibold text-text">
                {account.name}
                {!account.isActive && <Badge>Inactive</Badge>}
              </h1>
              <span className="text-small text-text-tertiary">
                {ACCOUNT_TYPE_META[account.type].label} · {account.currency}
              </span>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-small font-medium text-text-tertiary">Current balance</span>
            <Amount
              value={account.balance}
              currency={account.currency}
              tabular={false}
              tone={account.balance.startsWith("-") ? "signed" : "none"}
              className="text-[2.5rem] font-semibold leading-none tracking-[-0.035em]"
            />
            {lastUpdate && (
              <span className="text-small text-text-tertiary">
                {lastUpdate.source === "SMS" ? "Balance from an SMS" : "Balance checked"} {describeDay(lastUpdate.date, today)}
                {lastUpdate.time && ` at ${formatTime(lastUpdate.time)}`}
              </span>
            )}
            {!isZero(account.scheduledNet) && (
              <span className="text-small text-text-tertiary">
                <Amount value={account.scheduledNet} currency={account.currency} sign="always" /> scheduled after today
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={openUpdate}>
            <ScaleIcon />
            Update balance
          </Button>
          {account.isActive && (
            <Button variant="outline" onClick={() => openCreate({ accountId: account.id })}>
              <PlusIcon />
              Transaction
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => {
              setEditKey((k) => k + 1);
              setEditOpen(true);
            }}
          >
            <PencilIcon />
            Edit
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="More actions">
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {account.isActive ? (
                <DropdownMenuItem onSelect={() => void setActive(false)}>
                  <ArchiveIcon />
                  Deactivate
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => void setActive(true)}>
                  <ArchiveRestoreIcon />
                  Reactivate
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onSelect={() => setConfirmDelete(true)}>
                <Trash2Icon />
                Delete account
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <dl className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3">
        <Stat label={`Opening · ${formatDate(account.openingDate, "medium")}`}>
          <Amount value={account.openingBalance} currency={account.currency} />
        </Stat>
        <Stat label="Money in">
          <Amount value={account.inflow} currency={account.currency} tone="income" />
        </Stat>
        <Stat label="Money out" className="col-span-2 sm:col-span-1">
          <Amount value={account.outflow} currency={account.currency} />
        </Stat>
      </dl>

      {(account.transactionCount > 0 || balanceUpdates.length > 0) && (
        <Card className="mb-6">
          <CardHeader title="Balance" description={`${formatDate(history[0].date, "medium")} – today`} />
          <div className="px-3 pb-4 pt-2 sm:px-4">
            <BalanceChart points={history} currency={account.currency} color={account.color} />
          </div>
        </Card>
      )}

      {balanceUpdates.length > 0 && <BalanceUpdates account={account} updates={balanceUpdates} today={today} onUpdate={openUpdate} />}

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-heading font-semibold text-text">History</h2>
          {totalTransactions > transactions.length && (
            <Link href={`/transactions?accountId=${account.id}`} className="text-small font-medium text-accent-text hover:underline">
              View all {totalTransactions}
            </Link>
          )}
        </div>
        {transactions.length ? (
          <TransactionList items={transactions} today={today} perspectiveAccountId={account.id} />
        ) : (
          <EmptyState
            compact
            title="No transactions yet"
            description={`The balance is the opening balance until you record something in ${account.name}.`}
          />
        )}
      </section>

      <AccountFormSheet key={`edit-${editKey}`} open={editOpen} onOpenChange={setEditOpen} account={account} />
      <UpdateBalanceSheet key={`update-${updateKey}`} open={updateOpen} onOpenChange={setUpdateOpen} account={account} />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${account.name}?`}
        description={
          account.transactionCount > 0
            ? "Accounts with transactions can't be deleted — deactivate it instead to hide it while keeping its history."
            : "This account has no transactions. It will be removed permanently."
        }
        confirmLabel="Delete"
        destructive
        loading={busy}
        onConfirm={remove}
      />
    </>
  );
}

function Stat({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col gap-1 bg-surface px-4 py-3.5 sm:px-5 ${className ?? ""}`}>
      <dt className="truncate text-caption font-medium text-text-tertiary">{label}</dt>
      <dd className="text-heading font-semibold">{children}</dd>
    </div>
  );
}
