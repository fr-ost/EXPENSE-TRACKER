"use client";

import { GaugeIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Amount, useAppData } from "@/components/app-data";
import { IconBadge } from "@/components/icon";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/misc";
import { formatMonth, type MonthKey } from "@/lib/dates";
import { percentOf, subtractMoney } from "@/lib/money";
import type { BudgetLine, CategoryTotal } from "@/lib/types";
import { BudgetMeter, BudgetStatusText } from "./budget-meter";
import { BudgetSheet } from "./budget-sheet";

export function BudgetsView({
  month,
  lines,
  unbudgeted,
  totalBudget,
  totalSpent,
  switcher,
}: {
  month: MonthKey;
  lines: BudgetLine[];
  unbudgeted: CategoryTotal[];
  totalBudget: string;
  totalSpent: string;
  switcher: React.ReactNode;
}) {
  const { settings } = useAppData();
  const [sheet, setSheet] = React.useState<{ key: number; open: boolean; line?: BudgetLine; categoryId?: string }>({ key: 0, open: false });
  const open = (line?: BudgetLine, categoryId?: string) => setSheet((s) => ({ key: s.key + 1, open: true, line, categoryId }));

  const overall = percentOf(totalSpent, totalBudget) ?? 0;
  const overallLine: BudgetLine | null = lines.length
    ? {
        category: { id: "all", name: "All budgets", kind: "EXPENSE", icon: "gauge", color: "gray", defaultScope: null, isArchived: false },
        budget: totalBudget,
        spent: totalSpent,
        remaining: subtractMoney(totalBudget, totalSpent),
        percent: overall,
        status: overall > 100 ? "over" : overall >= 100 ? "reached" : overall >= 80 ? "warning" : "ok",
        effectiveFrom: month,
      }
    : null;

  return (
    <>
      <PageHeader
        title="Budgets"
        description="Monthly limits per category."
        actions={
          <>
            {switcher}
            <Button onClick={() => open()} aria-label="Add budget">
              <PlusIcon />
              <span className="hidden sm:inline">Add budget</span>
            </Button>
          </>
        }
      />

      {!lines.length ? (
        <EmptyState
          icon={<GaugeIcon />}
          title="No budgets for this month"
          description="Give the categories you care about a monthly limit. You'll get a quiet heads-up at 80% and when you reach it."
          action={
            <Button onClick={() => open()}>
              <PlusIcon />
              Add a budget
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-6">
          {overallLine && (
            <section aria-label="Overall" className="rounded-xl border border-border bg-surface-subtle p-5 sm:p-6">
              <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                <div className="flex flex-col gap-1">
                  <span className="text-small text-text-tertiary">Spent of budgeted, {formatMonth(month)}</span>
                  <span className="text-[1.75rem] font-semibold leading-none tracking-[-0.025em]">
                    <Amount value={totalSpent} tabular={false} />
                    <span className="text-heading font-medium text-text-tertiary">
                      {" "}
                      / <Amount value={totalBudget} tabular={false} />
                    </span>
                  </span>
                </div>
                <BudgetStatusText line={overallLine} />
              </div>
              <BudgetMeter line={overallLine} className="h-1.5" />
            </section>
          )}

          <Card>
            <ul className="divide-y divide-border">
              {lines.map((line) => (
                <li key={line.category.id}>
                  <button
                    type="button"
                    onClick={() => open(line)}
                    className="flex w-full items-start gap-3.5 px-5 py-4 text-left transition-colors hover:bg-surface-subtle focus-visible:bg-surface-subtle focus-visible:outline-none sm:px-6"
                  >
                    <IconBadge icon={line.category.icon} color={line.category.color} />
                    <span className="flex min-w-0 flex-1 flex-col gap-2">
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate text-body font-medium text-text">{line.category.name}</span>
                          <span className="text-caption text-text-tertiary">
                            {line.effectiveFrom === month ? "Set this month" : `Since ${formatMonth(line.effectiveFrom, "short")}`}
                          </span>
                        </span>
                        <span className="shrink-0 text-right text-small text-text-tertiary">
                          <Amount value={line.spent} className="text-body font-semibold text-text" /> of <Amount value={line.budget} />
                        </span>
                      </span>
                      <BudgetMeter line={line} />
                      <BudgetStatusText line={line} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      {unbudgeted.length > 0 && (
        <Card className="mt-6">
          <CardHeader title="Spending without a budget" description={`${formatMonth(month)} · ${settings.baseCurrency} accounts`} />
          <ul className="flex flex-col px-5 pb-3 pt-2 sm:px-6">
            {unbudgeted.map((c) => (
              <li key={c.categoryId} className="flex items-center gap-3 py-2">
                <IconBadge icon={c.icon} color={c.color} size="sm" />
                <Link href={`/transactions?categoryId=${c.categoryId}&month=${month}`} className="min-w-0 flex-1 truncate text-body font-medium text-text hover:underline">
                  {c.name}
                </Link>
                <Amount value={c.total} className="text-body text-text-secondary" />
                <Button variant="secondary" size="sm" onClick={() => open(undefined, c.categoryId)}>
                  Set budget
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <p className="mt-6 text-caption text-text-tertiary">
        Budgets count spending in {settings.baseCurrency} accounts, including transfers you marked as expenses. A budget
        applies from the month you set it until you change it.
      </p>

      <BudgetSheet
        key={sheet.key}
        open={sheet.open}
        onOpenChange={(value) => setSheet((s) => ({ ...s, open: value }))}
        month={month}
        line={sheet.line}
        initialCategoryId={sheet.categoryId}
        budgetedIds={lines.map((l) => l.category.id)}
      />
    </>
  );
}
