"use client";

import Link from "next/link";
import * as React from "react";
import { Amount } from "@/components/app-data";
import { accountIcon } from "@/components/forms/account-select";
import { IconBadge, paletteVar } from "@/components/icon";
import { EmptyState } from "@/components/states";
import { SCOPE_META, EXPENSE_SCOPES, type ExpenseScope } from "@/lib/domain";
import { isZero, type Money } from "@/lib/money";
import type { AccountActivity, CategoryTotal, PeriodSummary, ScopeTotal } from "@/lib/types";
import { cn } from "@/lib/utils";

/** A financial statement: every line labelled with what it includes. */
export function Statement({ summary, transactionsQuery }: { summary: PeriodSummary; transactionsQuery: string }) {
  const rows: Array<{ label: string; hint: string; value: Money; strong?: boolean; indent?: boolean; tone?: "income" | "signed"; href?: string }> = [
    { label: "Income", hint: "Everything recorded as income", value: summary.income, tone: "income", href: `/transactions?type=INCOME&${transactionsQuery}` },
    { label: "Direct expenses", hint: "Recorded as expenses", value: summary.directExpenses, indent: true, href: `/transactions?type=EXPENSE&${transactionsQuery}` },
    {
      label: "Transfers counted as expense",
      hint: "Transfers you marked as spending",
      value: summary.transferExpenses,
      indent: true,
      href: `/transactions?countedAsExpense=1&type=TRANSFER&${transactionsQuery}`,
    },
    { label: "Spending", hint: "Direct expenses + transfers counted as expense", value: summary.expenses, strong: true },
    { label: "Net savings", hint: "Income − spending", value: summary.netSavings, strong: true, tone: "signed" },
  ];
  const outside: typeof rows = [
    {
      label: "Transfers between accounts",
      hint: `${summary.transferCount} moves between your own accounts — not spending`,
      value: summary.transfers,
      href: `/transactions?type=TRANSFER&${transactionsQuery}`,
    },
    { label: "Balance corrections", hint: "Balance updates correcting what wasn't recorded — not income or spending", value: summary.adjustments },
  ];

  const renderRow = (row: (typeof rows)[number]) => {
    const content = (
      <>
        <span className={cn("flex min-w-0 flex-col", row.indent && "pl-4")}>
          <span className={cn("text-body text-text", row.strong && "font-semibold")}>{row.label}</span>
          <span className="text-caption text-text-tertiary">{row.hint}</span>
        </span>
        <Amount value={row.value} tone={row.tone} className={cn("text-body", row.strong ? "font-semibold" : "font-medium")} />
      </>
    );
    return (
      <li key={row.label}>
        {row.href ? (
          <Link href={row.href} className="-mx-2 flex items-center justify-between gap-4 rounded-md px-2 py-2.5 transition-colors hover:bg-surface-subtle">
            {content}
          </Link>
        ) : (
          <div className="flex items-center justify-between gap-4 py-2.5">{content}</div>
        )}
      </li>
    );
  };

  return (
    <div className="flex flex-col">
      <ul className="flex flex-col divide-y divide-border">{rows.map(renderRow)}</ul>
      <p className="mb-1 mt-5 text-caption font-medium text-text-tertiary">Not counted as income or spending</p>
      <ul className="flex flex-col divide-y divide-border">{outside.map(renderRow)}</ul>
      <p className="mt-4 text-caption text-text-tertiary">
        Totals are in {summary.currency}; other currencies count at your exchange rates.
      </p>
    </div>
  );
}

export function CategoryTable({ categories, transactionsQuery, empty }: { categories: CategoryTotal[]; transactionsQuery: string; empty: string }) {
  if (!categories.length) return <EmptyState compact title={empty} />;
  return (
    <ul className="flex flex-col">
      {categories.map((c) => (
        <li key={c.categoryId}>
          <Link
            href={`/transactions?categoryId=${c.categoryId}&${transactionsQuery}`}
            className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-surface-subtle"
          >
            <IconBadge icon={c.icon} color={c.color} size="sm" />
            <span className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="flex items-baseline justify-between gap-3">
                <span className="truncate text-body font-medium text-text">
                  {c.name}
                  <span className="ml-2 text-caption font-normal text-text-tertiary">
                    {c.count} {c.count === 1 ? "entry" : "entries"}
                  </span>
                </span>
                <Amount value={c.total} className="text-body font-medium" />
              </span>
              <span className="flex items-center gap-2">
                <span className="h-1 flex-1 overflow-hidden rounded-full bg-surface-muted">
                  <span className="block h-full rounded-full" style={{ width: `${Math.max(c.share, 0.8)}%`, background: paletteVar(c.color) }} />
                </span>
                <span className="w-11 text-right text-caption text-text-tertiary tabular">{c.share.toFixed(1)}%</span>
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Family, Personal and Other side by side, each with its leading categories. */
export function ScopeColumns({
  scopes,
  scopeCategories,
  transactionsQuery,
}: {
  scopes: ScopeTotal[];
  scopeCategories: Record<ExpenseScope, CategoryTotal[]>;
  transactionsQuery: string;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {EXPENSE_SCOPES.map((scope) => {
        const total = scopes.find((s) => s.scope === scope);
        const top = scopeCategories[scope].slice(0, 4);
        return (
          <section key={scope} className="flex flex-col gap-3 rounded-xl border border-border p-5">
            <div className="flex flex-col gap-1">
              <span className="inline-flex items-center gap-1.5 text-small font-medium text-text-secondary">
                <span aria-hidden className="size-2 rounded-full" style={{ background: paletteVar(SCOPE_META[scope].color) }} />
                {SCOPE_META[scope].label}
              </span>
              <Amount value={total?.total ?? "0.00"} tabular={false} className="text-[1.5rem] font-semibold leading-tight tracking-[-0.02em]" />
              <span className="text-caption text-text-tertiary">
                {Math.round(total?.share ?? 0)}% of spending · {total?.count ?? 0} {total?.count === 1 ? "entry" : "entries"}
              </span>
            </div>
            {top.length > 0 && (
              <ul className="flex flex-col gap-1.5 border-t border-border pt-3">
                {top.map((c) => (
                  <li key={c.categoryId} className="flex items-center justify-between gap-2 text-small">
                    <span className="inline-flex min-w-0 items-center gap-2 text-text-secondary">
                      <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: paletteVar(c.color) }} />
                      <span className="truncate">{c.name}</span>
                    </span>
                    <Amount value={c.total} className="text-text" />
                  </li>
                ))}
              </ul>
            )}
            <Link href={`/transactions?scope=${scope}&${transactionsQuery}`} className="mt-auto text-small font-medium text-accent-text hover:underline">
              View {SCOPE_META[scope].label.toLowerCase()} transactions
            </Link>
          </section>
        );
      })}
    </div>
  );
}

export function AccountActivityTable({ accounts }: { accounts: AccountActivity[] }) {
  const rows = accounts.filter((a) => a.isActive || a.transactionCount > 0 || !isZero(a.closingBalance));
  if (!rows.length) return <EmptyState compact title="No accounts in this period" />;
  return (
    <>
      <table className="hidden w-full text-body sm:table">
        <thead>
          <tr className="text-left text-caption font-medium text-text-tertiary">
            <th className="pb-2 font-medium">Account</th>
            <th className="pb-2 text-right font-medium">Opening</th>
            <th className="pb-2 text-right font-medium">Money in</th>
            <th className="pb-2 text-right font-medium">Money out</th>
            <th className="pb-2 text-right font-medium">Closing</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border border-t border-border">
          {rows.map((a) => (
            <tr key={a.id}>
              <td className="py-2.5">
                <Link href={`/accounts/${a.id}`} className="inline-flex items-center gap-2.5 font-medium text-text hover:underline">
                  <IconBadge icon={accountIcon(a)} color={a.color ?? "slate"} size="sm" />
                  {a.name}
                </Link>
              </td>
              <td className="py-2.5 text-right text-text-secondary">
                <Amount value={a.openingBalance} currency={a.currency} />
              </td>
              <td className="py-2.5 text-right">
                <Amount value={a.inflow} currency={a.currency} tone="income" />
              </td>
              <td className="py-2.5 text-right">
                <Amount value={a.outflow} currency={a.currency} />
              </td>
              <td className="py-2.5 text-right font-semibold">
                <Amount value={a.closingBalance} currency={a.currency} tone={a.closingBalance.startsWith("-") ? "signed" : "none"} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="flex flex-col divide-y divide-border sm:hidden">
        {rows.map((a) => (
          <li key={a.id} className="flex flex-col gap-1 py-3">
            <span className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-2 text-body font-medium text-text">
                <IconBadge icon={accountIcon(a)} color={a.color ?? "slate"} size="sm" />
                {a.name}
              </span>
              <Amount value={a.closingBalance} currency={a.currency} className="font-semibold" />
            </span>
            <span className="pl-9 text-caption text-text-tertiary">
              Opened at <Amount value={a.openingBalance} currency={a.currency} /> · in <Amount value={a.inflow} currency={a.currency} /> · out{" "}
              <Amount value={a.outflow} currency={a.currency} />
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

export function Highlight({ label, children, hint }: { label: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 bg-surface px-5 py-4">
      <dt className="text-small text-text-tertiary">{label}</dt>
      <dd className="truncate text-[1.25rem] font-semibold leading-tight tracking-[-0.02em] text-text">{children}</dd>
      {hint && <dd className="truncate text-caption text-text-tertiary">{hint}</dd>}
    </div>
  );
}
