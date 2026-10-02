"use client";

import { CircleAlertIcon, TriangleAlertIcon } from "lucide-react";
import { motion } from "motion/react";
import { useFormatMoney } from "@/components/app-data";
import { SCOPE_META } from "@/lib/domain";
import { absMoney } from "@/lib/money";
import type { BudgetLine } from "@/lib/types";
import { cn } from "@/lib/utils";

const FILL: Record<BudgetLine["status"], string> = {
  ok: "var(--accent)",
  warning: "var(--warning)",
  reached: "var(--warning)",
  over: "var(--negative)",
  none: "var(--border-strong)",
};

/** Budget meter: fill colour carries severity; the track is a light step of the same hue. */
export function BudgetMeter({ line, className }: { line: BudgetLine; className?: string }) {
  const fill = FILL[line.status];
  return (
    <div
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.min(Math.round(line.percent), 100)}
      aria-label={`${SCOPE_META[line.scope].label}: ${Math.round(line.percent)}% of budget used`}
      className={cn("h-1 w-full overflow-hidden rounded-full", className)}
      style={{ background: `color-mix(in srgb, ${fill} 14%, var(--surface))` }}
    >
      <motion.div
        className="h-full origin-left rounded-full"
        style={{ background: fill, width: `${Math.min(line.percent, 100)}%` }}
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      />
    </div>
  );
}

export function BudgetStatusText({ line }: { line: BudgetLine }) {
  const format = useFormatMoney();
  const remaining = line.remaining ?? "0.00";
  switch (line.status) {
    case "none":
      return <span className="text-caption text-text-tertiary">No budget set</span>;
    case "over":
      return (
        <span className="inline-flex items-center gap-1 text-caption font-medium text-negative-text">
          <TriangleAlertIcon className="size-3.5" aria-hidden />
          Over by {format(absMoney(remaining))}
        </span>
      );
    case "reached":
      return (
        <span className="inline-flex items-center gap-1 text-caption font-medium text-warning-text">
          <CircleAlertIcon className="size-3.5" aria-hidden />
          Budget reached
        </span>
      );
    case "warning":
      return (
        <span className="inline-flex items-center gap-1 text-caption font-medium text-warning-text">
          <CircleAlertIcon className="size-3.5" aria-hidden />
          {Math.round(line.percent)}% used · {format(remaining)} left
        </span>
      );
    default:
      return (
        <span className="text-caption text-text-tertiary">
          {Math.round(line.percent)}% used · {format(remaining)} left
        </span>
      );
  }
}
