"use client";

import { GaugeIcon } from "lucide-react";
import Link from "next/link";
import { Amount } from "@/components/app-data";
import { BudgetMeter, BudgetStatusText } from "@/components/budgets/budget-meter";
import { IconBadge } from "@/components/icon";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import type { MonthKey } from "@/lib/dates";
import type { BudgetLine } from "@/lib/types";

const PRIORITY: Record<BudgetLine["status"], number> = { over: 0, reached: 1, warning: 2, ok: 3 };

/** The budgets that need attention first. */
export function BudgetProgress({ lines, month, limit = 4 }: { lines: BudgetLine[]; month: MonthKey; limit?: number }) {
  if (!lines.length) {
    return (
      <EmptyState
        compact
        icon={<GaugeIcon />}
        title="No budgets yet"
        description="Set a monthly limit for the categories you want to keep an eye on."
        action={
          <Button asChild variant="secondary" size="sm">
            <Link href="/budgets">Set budgets</Link>
          </Button>
        }
      />
    );
  }
  const shown = [...lines].sort((a, b) => PRIORITY[a.status] - PRIORITY[b.status] || b.percent - a.percent).slice(0, limit);
  return (
    <ul className="flex flex-col gap-4">
      {shown.map((line) => (
        <li key={line.category.id}>
          <Link href={`/budgets?month=${month}`} className="flex items-start gap-3">
            <IconBadge icon={line.category.icon} color={line.category.color} size="sm" />
            <span className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate text-body font-medium text-text">{line.category.name}</span>
                <span className="text-small text-text-tertiary">
                  <Amount value={line.spent} className="font-medium text-text" /> / <Amount value={line.budget} />
                </span>
              </span>
              <BudgetMeter line={line} />
              <BudgetStatusText line={line} />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
