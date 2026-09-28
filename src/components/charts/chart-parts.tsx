"use client";

import * as React from "react";
import { useAppData } from "@/components/app-data";
import { formatCompactNumber } from "@/lib/money";
import { cn } from "@/lib/utils";

/** Shared axis props: hairline, recessive, compact numbers. */
export function useAxisFormatter() {
  const { settings } = useAppData();
  return React.useCallback((value: number) => formatCompactNumber(value, settings.numberFormat), [settings.numberFormat]);
}

export const axisProps = {
  tickLine: false,
  axisLine: false,
  tick: { fill: "var(--chart-axis)", fontSize: 11 },
} as const;

export const gridProps = {
  stroke: "var(--chart-grid)",
  strokeWidth: 1,
  vertical: false,
} as const;

/** Tooltip shell: ink card, text in text tokens, a swatch per series. */
export function TooltipCard({ title, rows }: { title: React.ReactNode; rows: Array<{ label: string; value: React.ReactNode; color?: string; muted?: boolean }> }) {
  return (
    <div className="min-w-44 rounded-lg bg-ink px-3 py-2.5 text-white shadow-lg">
      <div className="mb-1.5 text-caption font-medium text-white/60">{title}</div>
      <div className="flex flex-col gap-1">
        {rows.map((row) => (
          <div key={row.label} className={cn("flex items-center justify-between gap-4 text-small", row.muted && "text-white/60")}>
            <span className="inline-flex items-center gap-2">
              {row.color && <span aria-hidden className="size-2 rounded-full" style={{ background: row.color }} />}
              {row.label}
            </span>
            <span className="font-medium tabular">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Legend({ items, className }: { items: Array<{ label: string; color: string; value?: React.ReactNode }>; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5", className)}>
      {items.map((item) => (
        <li key={item.label} className="inline-flex items-center gap-1.5 text-small text-text-secondary">
          <span aria-hidden className="size-2 rounded-full" style={{ background: item.color }} />
          {item.label}
          {item.value !== undefined && <span className="font-medium text-text">{item.value}</span>}
        </li>
      ))}
    </ul>
  );
}
