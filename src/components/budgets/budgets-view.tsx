"use client";

import { PencilIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Amount } from "@/components/app-data";
import { IconBadge, paletteVar } from "@/components/icon";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { formatMonth, type MonthKey } from "@/lib/dates";
import { SCOPE_META } from "@/lib/domain";
import type { BudgetLine } from "@/lib/types";
import { BudgetMeter, BudgetStatusText } from "./budget-meter";
import { BudgetSheet } from "./budget-sheet";

/**
 * Two budgets: what you spend on yourself and what you spend on your family.
 * Every expense counts towards the one it was marked for, whatever its
 * category or currency.
 */
export function BudgetsView({ month, lines, switcher }: { month: MonthKey; lines: BudgetLine[]; switcher: React.ReactNode }) {
  const [sheet, setSheet] = React.useState<{ key: number; open: boolean; line?: BudgetLine }>({ key: 0, open: false });
  const open = (line: BudgetLine) => setSheet((s) => ({ key: s.key + 1, open: true, line }));

  return (
    <>
      <PageHeader title="Budgets" description="A monthly limit for Personal and for Family spending." actions={switcher} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {lines.map((line) => (
          <BudgetCard key={line.scope} line={line} month={month} onEdit={() => open(line)} />
        ))}
      </div>

      <p className="mt-6 text-caption text-text-tertiary">
        Whatever you mark as spent for {SCOPE_META.PERSONAL.label} or {SCOPE_META.FAMILY.label} counts towards that budget —
        any category, any account, other currencies at your rates, and transfers you count as expenses. A budget applies
        from the month you set it until you change it.
      </p>

      {sheet.line && (
        <BudgetSheet key={sheet.key} open={sheet.open} onOpenChange={(value) => setSheet((s) => ({ ...s, open: value }))} month={month} line={sheet.line} />
      )}
    </>
  );
}

function BudgetCard({ line, month, onEdit }: { line: BudgetLine; month: MonthKey; onEdit: () => void }) {
  const meta = SCOPE_META[line.scope];
  const top = line.categories.slice(0, 5);
  return (
    <section aria-label={`${meta.label} budget`} className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5 shadow-xs sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="inline-flex items-center gap-2 text-heading font-semibold text-text">
          <span aria-hidden className="size-2.5 rounded-full" style={{ background: paletteVar(meta.color) }} />
          {meta.label}
        </h2>
        <Button variant={line.budget ? "secondary" : "primary"} size="sm" onClick={onEdit}>
          {line.budget ? <PencilIcon /> : <PlusIcon />}
          {line.budget ? "Edit" : "Set budget"}
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[1.75rem] font-semibold leading-none tracking-[-0.025em] text-text">
          <Amount value={line.spent} tabular={false} />
          {line.budget && (
            <span className="text-heading font-medium text-text-tertiary">
              {" "}
              / <Amount value={line.budget} tabular={false} />
            </span>
          )}
        </span>
        {line.budget ? (
          <>
            <BudgetMeter line={line} className="h-1.5" />
            <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <BudgetStatusText line={line} />
              {line.effectiveFrom && (
                <span className="text-caption text-text-tertiary">
                  {line.effectiveFrom === month ? "Set this month" : `Since ${formatMonth(line.effectiveFrom, "short")}`}
                </span>
              )}
            </span>
          </>
        ) : (
          <span className="text-small text-text-tertiary">Spent in {formatMonth(month)} · no budget yet</span>
        )}
      </div>

      {top.length > 0 ? (
        <ul className="flex flex-col gap-2.5 border-t border-border pt-4">
          {top.map((c) => (
            <li key={c.categoryId} className="flex items-center gap-3">
              <IconBadge icon={c.icon} color={c.color} size="sm" />
              <Link href={`/transactions?categoryId=${c.categoryId}&scope=${line.scope}&month=${month}`} className="min-w-0 flex-1 truncate text-body text-text hover:underline">
                {c.name}
              </Link>
              <Amount value={c.total} className="text-body text-text-secondary" />
            </li>
          ))}
        </ul>
      ) : (
        <p className="border-t border-border pt-4 text-small text-text-tertiary">Nothing spent for {meta.label.toLowerCase()} yet this month.</p>
      )}

      <Link href={`/transactions?scope=${line.scope}&month=${month}`} className="mt-auto text-small font-medium text-accent-text hover:underline">
        View {meta.label.toLowerCase()} spending
      </Link>
    </section>
  );
}
