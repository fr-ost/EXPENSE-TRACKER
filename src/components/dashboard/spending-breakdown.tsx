"use client";

import Link from "next/link";
import { Amount, useFormatMoney } from "@/components/app-data";
import { StackedBar } from "@/components/charts/stacked-bar";
import { IconBadge, paletteVar } from "@/components/icon";
import { EmptyState } from "@/components/states";
import { SCOPE_META } from "@/lib/domain";
import type { MonthKey } from "@/lib/dates";
import type { CategoryTotal, ScopeTotal } from "@/lib/types";

/**
 * Where the month's spending went: Personal / Family as one part-to-whole
 * bar, then the leading categories ranked.
 */
export function SpendingBreakdown({
  scopes,
  categories,
  month,
  limit = 5,
}: {
  scopes: ScopeTotal[];
  categories: CategoryTotal[];
  month: MonthKey;
  limit?: number;
}) {
  const format = useFormatMoney();
  if (!categories.length) {
    return <EmptyState compact title="No spending yet" description="Expenses you record this month will be broken down here." />;
  }
  const top = categories.slice(0, limit);
  const rest = categories.slice(limit);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <StackedBar
          label="Spending by classification"
          segments={scopes.map((s) => ({
            key: s.scope,
            label: SCOPE_META[s.scope].label,
            share: s.share,
            color: paletteVar(SCOPE_META[s.scope].color),
            valueText: format(s.total),
          }))}
        />
        <ul className="grid grid-cols-2 gap-2">
          {scopes.map((s) => (
            <li key={s.scope}>
              <Link
                href={`/transactions?scope=${s.scope}&month=${month}`}
                className="flex flex-col gap-0.5 rounded-md p-1 -m-1 transition-colors hover:bg-surface-subtle"
              >
                <span className="inline-flex items-center gap-1.5 text-caption text-text-tertiary">
                  <span aria-hidden className="size-2 rounded-full" style={{ background: paletteVar(SCOPE_META[s.scope].color) }} />
                  {SCOPE_META[s.scope].label}
                </span>
                <Amount value={s.total} className="text-body font-semibold text-text" />
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <ul className="flex flex-col gap-3 border-t border-border pt-4">
        {top.map((c) => (
          <li key={c.categoryId}>
            <Link href={`/transactions?categoryId=${c.categoryId}&month=${month}`} className="group flex items-center gap-3">
              <IconBadge icon={c.icon} color={c.color} size="sm" />
              <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-body font-medium text-text group-hover:underline">{c.name}</span>
                  <Amount value={c.total} className="text-body font-medium text-text" />
                </span>
                <span className="flex items-center gap-2">
                  <span className="h-1 flex-1 overflow-hidden rounded-full bg-surface-muted">
                    <span className="block h-full rounded-full" style={{ width: `${Math.max(c.share, 1)}%`, background: paletteVar(c.color) }} />
                  </span>
                  <span className="w-9 text-right text-caption text-text-tertiary tabular">{Math.round(c.share)}%</span>
                </span>
              </span>
            </Link>
          </li>
        ))}
        {rest.length > 0 && (
          <li className="text-small text-text-tertiary">
            + {rest.length} more {rest.length === 1 ? "category" : "categories"} ·{" "}
            <Link href={`/reports?month=${month}#categories`} className="font-medium text-accent-text hover:underline">
              Full breakdown
            </Link>
          </li>
        )}
      </ul>
    </div>
  );
}
