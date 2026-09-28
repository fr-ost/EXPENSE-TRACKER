"use client";

import { ChevronLeftIcon, ChevronRightIcon, DownloadIcon, FileSpreadsheetIcon, FileTextIcon, ListIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { formatMonth, monthKeyOf, shiftMonth, type ISODate } from "@/lib/dates";
import { cn } from "@/lib/utils";

type Period = { kind: "month"; month: string } | { kind: "year"; year: number };

function href(period: Period) {
  return period.kind === "month" ? `/reports?month=${period.month}` : `/reports?period=year&year=${period.year}`;
}

export function PeriodControls({ period, today }: { period: Period; today: ISODate }) {
  const router = useRouter();
  const currentMonth = monthKeyOf(today);
  const currentYear = Number(today.slice(0, 4));
  const [pending, startTransition] = React.useTransition();

  const prev: Period = period.kind === "month" ? { kind: "month", month: shiftMonth(period.month, -1) } : { kind: "year", year: period.year - 1 };
  const next: Period = period.kind === "month" ? { kind: "month", month: shiftMonth(period.month, 1) } : { kind: "year", year: period.year + 1 };
  const atLatest = period.kind === "month" ? period.month >= currentMonth : period.year >= currentYear;
  const label = period.kind === "month" ? formatMonth(period.month) : String(period.year);
  const button = "inline-flex size-9 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-muted hover:text-text";

  const switchKind = (kind: "month" | "year") => {
    const target: Period =
      kind === "year"
        ? { kind: "year", year: period.kind === "month" ? Number(period.month.slice(0, 4)) : period.year }
        : { kind: "month", month: period.kind === "year" ? (period.year === currentYear ? currentMonth : `${period.year}-12`) : period.month };
    startTransition(() => router.push(href(target), { scroll: false }));
  };

  const query = period.kind === "month" ? `month=${period.month}` : `period=year&year=${period.year}`;
  const transactionsQuery = period.kind === "month" ? `month=${period.month}` : `year=${period.year}`;

  return (
    <div className={cn("flex flex-wrap items-center gap-2 transition-opacity", pending && "opacity-60")}>
      <SegmentedControl
        ariaLabel="Report period"
        value={period.kind}
        onValueChange={switchKind}
        options={[
          { value: "month", label: "Month" },
          { value: "year", label: "Year" },
        ]}
      />
      <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface p-0.5 shadow-xs">
        <Link href={href(prev)} scroll={false} className={button} aria-label="Previous period">
          <ChevronLeftIcon className="size-4" />
        </Link>
        <span className="min-w-[7.5rem] text-center text-body font-medium text-text" aria-live="polite">
          {label}
        </span>
        <Link
          href={href(next)}
          scroll={false}
          aria-disabled={atLatest}
          tabIndex={atLatest ? -1 : undefined}
          className={cn(button, atLatest && "pointer-events-none opacity-30")}
          aria-label="Next period"
        >
          <ChevronRightIcon className="size-4" />
        </Link>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" aria-label="Export report">
            <DownloadIcon />
            <span className="hidden sm:inline">Export</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>{label}</DropdownMenuLabel>
          <DropdownMenuItem asChild>
            <a href={`/api/export/report?format=pdf&${query}`} download>
              <FileTextIcon />
              Report (PDF)
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href={`/api/export/report?format=xlsx&${query}`} download>
              <FileSpreadsheetIcon />
              Report with transactions (Excel)
            </a>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <a href={`/api/export/transactions?format=csv&${transactionsQuery}`} download>
              <ListIcon />
              Transactions (CSV)
            </a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
