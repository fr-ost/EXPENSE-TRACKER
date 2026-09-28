import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { formatMonth, shiftMonth, type MonthKey } from "@/lib/dates";
import { cn } from "@/lib/utils";

/** ‹ September 2026 › — navigates by URL so every section re-renders for the month. */
export function MonthSwitcher({
  month,
  current,
  basePath,
  extraParams = {},
  max,
}: {
  month: MonthKey;
  current: MonthKey;
  basePath: string;
  extraParams?: Record<string, string>;
  /** Latest selectable month (defaults to the current month). */
  max?: MonthKey;
}) {
  const href = (target: MonthKey) => {
    const params = new URLSearchParams(extraParams);
    if (target !== current) params.set("month", target);
    const query = params.toString();
    return query ? `${basePath}?${query}` : basePath;
  };
  const prev = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);
  const atCurrent = month >= (max ?? current);
  const button = "inline-flex size-9 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-muted hover:text-text";

  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface p-0.5 shadow-xs">
      <Link href={href(prev)} scroll={false} className={button} aria-label={`Previous month, ${formatMonth(prev)}`}>
        <ChevronLeftIcon className="size-4" />
      </Link>
      <span className="min-w-[8.5rem] text-center text-body font-medium text-text" aria-live="polite">
        {formatMonth(month)}
      </span>
      <Link
        href={href(next)}
        scroll={false}
        aria-disabled={atCurrent}
        tabIndex={atCurrent ? -1 : undefined}
        className={cn(button, atCurrent && "pointer-events-none opacity-30")}
        aria-label={`Next month, ${formatMonth(next)}`}
      >
        <ChevronRightIcon className="size-4" />
      </Link>
    </div>
  );
}
