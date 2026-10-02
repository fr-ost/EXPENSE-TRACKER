"use client";

import { GaugeIcon } from "lucide-react";
import Link from "next/link";
import { Amount } from "@/components/app-data";
import { BudgetMeter, BudgetStatusText } from "@/components/budgets/budget-meter";
import { paletteVar } from "@/components/icon";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import type { MonthKey } from "@/lib/dates";
import { SCOPE_META } from "@/lib/domain";
import type { BudgetLine } from "@/lib/types";

/** The Personal and Family budgets for the month. */
export function BudgetProgress({ lines, month }: { lines: BudgetLine[]; month: MonthKey }) {
  if (!lines.some((line) => line.budget)) {
    return (
      <EmptyState
        compact
        icon={<GaugeIcon />}
        title="No budgets yet"
        description="Set a monthly limit for what you spend on yourself and on your family."
        action={
          <Button asChild variant="secondary" size="sm">
            <Link href={`/budgets?month=${month}`}>Set budgets</Link>
          </Button>
        }
      />
    );
  }
  return (
    <ul className="flex flex-col gap-5">
      {lines.map((line) => (
        <li key={line.scope}>
          <Link href={`/budgets?month=${month}`} className="flex flex-col gap-1.5">
            <span className="flex items-baseline justify-between gap-2">
              <span className="inline-flex items-center gap-2 text-body font-medium text-text">
                <span aria-hidden className="size-2 rounded-full" style={{ background: paletteVar(SCOPE_META[line.scope].color) }} />
                {SCOPE_META[line.scope].label}
              </span>
              <span className="text-small text-text-tertiary">
                <Amount value={line.spent} className="font-medium text-text" />
                {line.budget && (
                  <>
                    {" "}
                    / <Amount value={line.budget} />
                  </>
                )}
              </span>
            </span>
            {line.budget && <BudgetMeter line={line} />}
            <BudgetStatusText line={line} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
