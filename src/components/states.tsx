import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Empty state: says what is missing and what to do about it. Never a blank
 * area.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  compact,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex animate-rise flex-col items-center justify-center text-center",
        compact ? "gap-2 px-4 py-8" : "gap-3 px-6 py-14",
        className,
      )}
    >
      {icon && (
        <div className="mb-1 inline-flex size-11 items-center justify-center rounded-[13px] bg-surface-muted text-text-tertiary [&_svg]:size-5">
          {icon}
        </div>
      )}
      <div className="flex max-w-sm flex-col gap-1">
        <p className="text-heading font-semibold text-text">{title}</p>
        {description && <p className="text-body text-text-secondary">{description}</p>}
      </div>
      {action && <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
}
