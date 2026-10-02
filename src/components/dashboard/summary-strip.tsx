"use client";

import { ArrowDownRightIcon, ArrowUpRightIcon, InfoIcon } from "lucide-react";
import * as React from "react";
import { Amount, useFormatMoney } from "@/components/app-data";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDate, formatMonth, monthStart, shiftMonth, type MonthKey } from "@/lib/dates";
import { absMoney, compareMoney, isZero, percentOf, subtractMoney, type Money } from "@/lib/money";
import type { CurrencyAmount, PeriodSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The month at a glance: one strip, four figures, each with its change
 * against the previous month. Definitions are one tap away.
 */
export function SummaryStrip({ current, previous, month }: { current: PeriodSummary; previous: PeriodSummary; month: MonthKey }) {
  const format = useFormatMoney();
  const rate = current.savingsRate;
  const prevRate = previous.savingsRate;
  const vs = `vs ${formatDate(monthStart(shiftMonth(month, -1)), "monthShort")}`;

  return (
    <section aria-label={`${formatMonth(month)} summary`} className="rounded-xl border border-border bg-surface shadow-xs">
      <div className="flex items-center justify-between border-b border-border px-5 py-3 sm:px-6">
        <h2 className="text-small font-medium text-text-secondary">{formatMonth(month)}</h2>
        <Definitions summary={current} />
      </div>
      <dl className="grid grid-cols-2 lg:grid-cols-4">
        <Figure label="Income" className="border-b border-r border-border lg:border-b-0">
          <Amount value={current.income} tabular={false} />
          <Delta current={current.income} previous={previous.income} upIsGood vs={vs} />
          <ForeignNote amounts={current.foreignIncome} />
        </Figure>
        <Figure label="Spending" className="border-b border-border lg:border-b-0 lg:border-r">
          <Amount value={current.expenses} tabular={false} />
          <Delta current={current.expenses} previous={previous.expenses} upIsGood={false} vs={vs} />
          {!isZero(current.transferExpenses) && (
            <span className="text-caption text-text-tertiary">incl. {format(current.transferExpenses)} transfers</span>
          )}
          <ForeignNote amounts={current.foreignExpenses} />
        </Figure>
        <Figure label="Saved" className="border-r border-border">
          <Amount value={current.netSavings} tabular={false} tone={current.netSavings.startsWith("-") ? "signed" : "none"} />
          <Delta current={current.netSavings} previous={previous.netSavings} upIsGood vs={vs} />
        </Figure>
        <Figure label="Savings rate">
          <span className={cn(rate !== null && rate < 0 && "text-negative-text")}>{rate === null ? "—" : `${formatPercent(rate)}`}</span>
          {rate !== null && prevRate !== null ? (
            <DeltaText value={rate - prevRate} unit="pts" upIsGood vs={vs} />
          ) : (
            <span className="text-caption text-text-tertiary">{rate === null ? "No income this month" : " "}</span>
          )}
        </Figure>
      </dl>
    </section>
  );
}

/** "incl. $1,000": what came in (or went out) in other currencies, counted at its rate. */
function ForeignNote({ amounts }: { amounts: CurrencyAmount[] }) {
  const format = useFormatMoney();
  if (!amounts.length) return null;
  return <span className="text-caption text-text-tertiary">incl. {amounts.map((a) => format(a.amount, { currency: a.currency })).join(" + ")}</span>;
}

function formatPercent(value: number) {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

function Figure({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  const [value, ...rest] = React.Children.toArray(children);
  return (
    <div className={cn("flex min-w-0 flex-col gap-1 px-5 py-4 sm:px-6 sm:py-5", className)}>
      <dt className="text-small text-text-tertiary">{label}</dt>
      <dd className="flex flex-col gap-1">
        <span className="truncate text-[1.375rem] font-semibold leading-tight tracking-[-0.02em] text-text sm:text-[1.5rem]">{value}</span>
        {rest}
      </dd>
    </div>
  );
}

function Delta({ current, previous, upIsGood, vs }: { current: Money; previous: Money; upIsGood: boolean; vs: string }) {
  if (isZero(previous)) return <span className="text-caption text-text-tertiary">Nothing last month</span>;
  const change = percentOf(subtractMoney(current, previous), absMoney(previous));
  if (change === null) return null;
  return <DeltaText value={change} unit="%" upIsGood={upIsGood} same={compareMoney(current, previous) === 0} vs={vs} />;
}

function DeltaText({ value, unit, upIsGood, same, vs }: { value: number; unit: "%" | "pts"; upIsGood: boolean; same?: boolean; vs: string }) {
  if (same || Math.abs(value) < 0.05) return <span className="text-caption text-text-tertiary">Same as last month</span>;
  const up = value > 0;
  const good = up === upIsGood;
  const Icon = up ? ArrowUpRightIcon : ArrowDownRightIcon;
  const magnitude = Math.abs(value);
  return (
    <span className="text-caption">
      <span className={cn("font-medium", good ? "text-positive-text" : "text-negative-text")}>
        <Icon className="mr-0.5 inline size-3.5 align-[-3px]" aria-hidden />
        <span className="sr-only">{up ? "Up" : "Down"} </span>
        {magnitude >= 100 ? Math.round(magnitude) : magnitude.toFixed(1)}
        {unit === "%" ? "%" : " pts"}
      </span>{" "}
      <span className="text-text-tertiary">{vs}</span>
    </span>
  );
}

function Definitions({ summary }: { summary: PeriodSummary }) {
  return (
    <Popover>
      <PopoverTrigger className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-caption font-medium text-text-tertiary transition-colors hover:bg-surface-muted hover:text-text">
        <InfoIcon className="size-3.5" />
        <span className="hidden sm:inline">How these are calculated</span>
        <span className="sm:hidden">Definitions</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <dl className="flex flex-col gap-3 text-small">
          <div>
            <dt className="font-medium text-text">Income</dt>
            <dd className="text-text-secondary">Everything recorded as income.</dd>
          </div>
          <div>
            <dt className="font-medium text-text">Spending</dt>
            <dd className="text-text-secondary">
              Expenses, plus transfers you marked “count as expense”
              {!isZero(summary.transferExpenses) && (
                <>
                  {" "}
                  (<Amount value={summary.transferExpenses} /> this month)
                </>
              )}
              .
            </dd>
          </div>
          <div>
            <dt className="font-medium text-text">Transfers</dt>
            <dd className="text-text-secondary">
              Moving money between your own accounts (<Amount value={summary.transfers} /> this month) changes balances,
              not spending.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-text">Saved &amp; savings rate</dt>
            <dd className="text-text-secondary">Income minus spending, and that as a share of income.</dd>
          </div>
          <p className="border-t border-border pt-3 text-caption text-text-tertiary">
            Totals are in {summary.currency}; other currencies count at your rates (Settings). Corrections from balance
            updates are not counted as income or spending.
          </p>
        </dl>
      </PopoverContent>
    </Popover>
  );
}
