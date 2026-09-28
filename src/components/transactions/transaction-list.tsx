"use client";

import { ArrowRightIcon, MessageSquareTextIcon, RepeatIcon } from "lucide-react";
import { motion } from "motion/react";
import * as React from "react";
import { Amount } from "@/components/app-data";
import { IconBadge } from "@/components/icon";
import { Badge } from "@/components/ui/misc";
import { formatRelativeDay, formatTime, type ISODate } from "@/lib/dates";
import { SCOPE_META } from "@/lib/domain";
import type { TransactionView } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useTransactionSheet } from "./transaction-sheet";

interface TransactionListProps {
  items: TransactionView[];
  today: ISODate;
  /** Group rows under date headings (only meaningful when sorted by date). */
  groupByDate?: boolean;
  /** Show transfers as + / − relative to this account. */
  perspectiveAccountId?: string;
  className?: string;
}

export function TransactionList({ items, today, groupByDate = true, perspectiveAccountId, className }: TransactionListProps) {
  const groups = React.useMemo(() => {
    if (!groupByDate) return [{ date: null as ISODate | null, items }];
    const result: Array<{ date: ISODate | null; items: TransactionView[] }> = [];
    for (const item of items) {
      const last = result[result.length - 1];
      if (last && last.date === item.date) last.items.push(item);
      else result.push({ date: item.date, items: [item] });
    }
    return result;
  }, [items, groupByDate]);

  return (
    <div className={cn("flex flex-col", className)}>
      {groups.map((group, groupIndex) => (
        <section key={group.date ?? "all"} aria-label={group.date ? formatRelativeDay(group.date, today) : undefined}>
          {group.date && (
            <h3
              className={cn(
                "sticky top-14 z-10 -mx-1 bg-canvas/90 px-1 pb-1.5 pt-4 text-caption font-medium text-text-tertiary backdrop-blur-md md:top-0",
                groupIndex === 0 && "pt-0",
              )}
            >
              {formatRelativeDay(group.date, today)}
            </h3>
          )}
          <ul className="flex flex-col">
            {group.items.map((item, index) => (
              <motion.li
                key={item.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2, delay: Math.min(index + groupIndex, 12) * 0.015 }}
              >
                <TransactionRow transaction={item} today={today} perspectiveAccountId={perspectiveAccountId} />
              </motion.li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function transferDirection(tx: TransactionView, perspectiveAccountId?: string): "in" | "out" | null {
  if (tx.type !== "TRANSFER" || !perspectiveAccountId) return null;
  if (tx.toAccount?.id === perspectiveAccountId) return "in";
  if (tx.account.id === perspectiveAccountId) return "out";
  return null;
}

export function transactionTitle(tx: TransactionView): string {
  if (tx.description) return tx.description;
  if (tx.type === "TRANSFER") return tx.countAsExpense && tx.category ? tx.category.name : "Transfer";
  if (tx.type === "ADJUSTMENT") return "Balance adjustment";
  return tx.category?.name ?? "Transaction";
}

function TransactionRow({
  transaction: tx,
  today,
  perspectiveAccountId,
}: {
  transaction: TransactionView;
  today: ISODate;
  perspectiveAccountId?: string;
}) {
  const { openEdit } = useTransactionSheet();
  const direction = transferDirection(tx, perspectiveAccountId);
  const upcoming = tx.date > today;

  const icon =
    tx.type === "TRANSFER" && !tx.countAsExpense
      ? { icon: "arrow-left-right", color: "slate" }
      : tx.type === "ADJUSTMENT"
        ? { icon: "scale", color: "gray" }
        : { icon: tx.category?.icon ?? "circle-dashed", color: tx.category?.color ?? "gray" };

  const meta: React.ReactNode[] = [];
  if (tx.time) meta.push(<span key="time" className="tabular">{formatTime(tx.time)}</span>);
  if (tx.type === "TRANSFER") {
    meta.push(
      <span key="route" className="inline-flex min-w-0 items-center gap-1">
        <span className="truncate">{tx.account.name}</span>
        <ArrowRightIcon className="size-3 shrink-0" aria-label="to" />
        <span className="truncate">{tx.toAccount?.name}</span>
      </span>,
    );
  } else {
    if (tx.description && tx.category) meta.push(<span key="category">{tx.category.name}</span>);
    meta.push(<span key="account" className="truncate">{tx.account.name}</span>);
  }

  let amount: React.ReactNode;
  if (tx.type === "INCOME") {
    amount = <Amount value={tx.amount} currency={tx.account.currency} sign="always" tone="income" />;
  } else if (tx.type === "EXPENSE") {
    amount = <Amount value={`-${tx.amount}`} currency={tx.account.currency} />;
  } else if (tx.type === "ADJUSTMENT") {
    amount = <Amount value={tx.amount} currency={tx.account.currency} sign="always" tone="signed" />;
  } else if (direction === "in") {
    amount = <Amount value={tx.toAmount ?? tx.amount} currency={tx.toAccount?.currency} sign="always" />;
  } else if (direction === "out") {
    amount = <Amount value={`-${tx.amount}`} currency={tx.account.currency} />;
  } else {
    amount = <Amount value={tx.amount} currency={tx.account.currency} className={tx.countAsExpense ? undefined : "text-text-secondary"} />;
  }

  return (
    <button
      type="button"
      onClick={() => openEdit(tx)}
      className="group -mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-surface-subtle focus-visible:bg-surface-subtle focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--focus-ring)] sm:gap-3.5"
    >
      <IconBadge icon={icon.icon} color={icon.color} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-body font-medium text-text">{transactionTitle(tx)}</span>
          {tx.recurringId && <RepeatIcon className="size-3 shrink-0 text-text-quaternary" aria-label="Recurring" />}
          {tx.fromSms && <MessageSquareTextIcon className="size-3 shrink-0 text-text-quaternary" aria-label="Added from SMS" />}
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-small text-text-tertiary">
          {meta.map((node, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span aria-hidden className="text-text-quaternary">·</span>}
              {node}
            </React.Fragment>
          ))}
          {tx.scope && tx.scope !== "OTHER" && (
            <span className="inline-flex items-center gap-1">
              <span aria-hidden className="text-text-quaternary">·</span>
              <span aria-hidden className="size-1.5 rounded-full" style={{ background: `var(--palette-${SCOPE_META[tx.scope].color})` }} />
              {SCOPE_META[tx.scope].label}
            </span>
          )}
          {tx.countAsExpense && <Badge tone="info">Counted as expense</Badge>}
          {upcoming && <Badge tone="warning">Upcoming</Badge>}
        </span>
      </span>
      <span className="shrink-0 text-right text-body font-medium">{amount}</span>
    </button>
  );
}
