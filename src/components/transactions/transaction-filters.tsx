"use client";

import { ArrowDownWideNarrowIcon, SearchIcon, SlidersHorizontalIcon, XIcon } from "lucide-react";
import * as React from "react";
import { useAppData } from "@/components/app-data";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ResponsiveSheet } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useUrlState } from "@/hooks/use-url-state";
import { formatDate, formatMonth, monthKeyOf, shiftMonth } from "@/lib/dates";
import { EXPENSE_SCOPES, SCOPE_META, TRANSACTION_TYPE_LABELS, type TransactionType } from "@/lib/domain";
import { useFormatMoney } from "@/components/app-data";
import { sanitizeAmountInput } from "@/lib/money";
import type { SortOption, TransactionFilters } from "@/lib/validation";
import { cn } from "@/lib/utils";

const TYPE_OPTIONS: Array<{ value: TransactionType | "ALL"; label: string }> = [
  { value: "ALL", label: "All" },
  { value: "EXPENSE", label: "Expenses" },
  { value: "INCOME", label: "Income" },
  { value: "TRANSFER", label: "Transfers" },
  { value: "ADJUSTMENT", label: "Adjustments" },
];

const SORT_LABELS: Record<SortOption, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  highest: "Highest amount",
  lowest: "Lowest amount",
};

type PeriodMode = "any" | "month" | "year" | "range";

function periodModeOf(filters: TransactionFilters): PeriodMode {
  if (filters.month) return "month";
  if (filters.year) return "year";
  if (filters.from || filters.to) return "range";
  return "any";
}

export function TransactionFilterBar({ filters }: { filters: TransactionFilters }) {
  const { accounts, categories, today } = useAppData();
  const format = useFormatMoney();
  const { setParams, isPending } = useUrlState();
  const [query, setQuery] = React.useState(filters.q ?? "");
  const [panel, setPanel] = React.useState({ key: 0, open: false });
  // A fresh key on every open re-initialises the panel from the current URL filters.
  const openPanel = () => setPanel((p) => ({ key: p.key + 1, open: true }));
  const setPanelOpen = (open: boolean) => setPanel((p) => ({ ...p, open }));

  // Debounced search.
  React.useEffect(() => {
    if (query === (filters.q ?? "")) return;
    const timer = window.setTimeout(() => setParams({ q: query.trim() || null }), 300);
    return () => window.clearTimeout(timer);
  }, [query, filters.q, setParams]);

  const account = accounts.find((a) => a.id === filters.accountId);
  const category = categories.find((c) => c.id === filters.categoryId);

  const chips: Array<{ key: string; label: string; clear: Record<string, null> }> = [];
  if (filters.month) chips.push({ key: "month", label: formatMonth(filters.month), clear: { month: null } });
  if (filters.year) chips.push({ key: "year", label: String(filters.year), clear: { year: null } });
  if (filters.from || filters.to)
    chips.push({
      key: "range",
      label: `${filters.from ? formatDate(filters.from) : "Start"} – ${filters.to ? formatDate(filters.to) : "Today"}`,
      clear: { from: null, to: null },
    });
  if (account) chips.push({ key: "account", label: account.name, clear: { accountId: null } });
  if (category) chips.push({ key: "category", label: category.name, clear: { categoryId: null } });
  if (filters.scope) chips.push({ key: "scope", label: SCOPE_META[filters.scope].label, clear: { scope: null } });
  if (filters.countedAsExpense) chips.push({ key: "counted", label: "Counted as expense", clear: { countedAsExpense: null } });
  if (filters.min || filters.max)
    chips.push({
      key: "amount",
      label: filters.min && filters.max ? `${format(filters.min)} – ${format(filters.max)}` : filters.min ? `≥ ${format(filters.min)}` : `≤ ${format(filters.max!)}`,
      clear: { min: null, max: null },
    });

  const panelCount = chips.length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-tertiary" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search description, notes, category, account or amount"
            aria-label="Search transactions"
            className="h-10 pl-9 pr-9 [&::-webkit-search-cancel-button]:hidden"
          />
          {isPending ? (
            <Spinner className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary" label="Updating" />
          ) : (
            query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-text-tertiary hover:bg-surface-muted hover:text-text"
              >
                <XIcon className="size-3.5" />
              </button>
            )
          )}
        </div>
        <Button variant="outline" onClick={openPanel} aria-label="Filters" className="shrink-0 px-3 sm:px-4">
          <SlidersHorizontalIcon />
          <span className="hidden sm:inline">Filters</span>
          {panelCount > 0 && (
            <span className="inline-flex size-5 items-center justify-center rounded-full bg-ink text-[11px] text-white">{panelCount}</span>
          )}
        </Button>
        <div className="hidden md:block">
          <SortSelect value={filters.sort ?? "newest"} onChange={(sort) => setParams({ sort: sort === "newest" ? null : sort })} />
        </div>
      </div>

      <div className="-mx-4 overflow-x-auto px-4 scrollbar-none sm:mx-0 sm:px-0">
        <SegmentedControl
          ariaLabel="Transaction type"
          size="sm"
          value={filters.type ?? "ALL"}
          onValueChange={(type) => setParams({ type: type === "ALL" ? null : type })}
          options={TYPE_OPTIONS}
        />
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((chip) => (
            <span key={chip.key} className="inline-flex h-7 items-center gap-1 rounded-full bg-surface-muted pl-3 pr-1 text-small font-medium text-text-secondary">
              {chip.label}
              <button
                type="button"
                onClick={() => setParams(chip.clear)}
                aria-label={`Remove filter: ${chip.label}`}
                className="inline-flex size-5 items-center justify-center rounded-full hover:bg-surface-sunken hover:text-text"
              >
                <XIcon className="size-3" />
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={() =>
              setParams({ month: null, year: null, from: null, to: null, accountId: null, categoryId: null, scope: null, countedAsExpense: null, min: null, max: null })
            }
            className="h-7 rounded-full px-2 text-small font-medium text-text-tertiary hover:text-text"
          >
            Clear all
          </button>
        </div>
      )}

      <FilterPanel
        key={panel.key}
        open={panel.open}
        onOpenChange={setPanelOpen}
        filters={filters}
        today={today}
        onApply={(patch) => {
          setParams(patch);
          setPanelOpen(false);
        }}
      />
    </div>
  );
}

function SortSelect({ value, onChange, className }: { value: SortOption; onChange: (value: SortOption) => void; className?: string }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as SortOption)}>
      <SelectTrigger className={cn("w-auto gap-2 pl-3", className)} aria-label="Sort">
        <ArrowDownWideNarrowIcon className="size-4 text-text-tertiary" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {(Object.keys(SORT_LABELS) as SortOption[]).map((option) => (
          <SelectItem key={option} value={option}>
            {SORT_LABELS[option]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const ANY = "__any";

function FilterPanel({
  open,
  onOpenChange,
  filters,
  today,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: TransactionFilters;
  today: string;
  onApply: (patch: Record<string, string | null>) => void;
}) {
  const { accounts, categories } = useAppData();
  const thisMonth = monthKeyOf(today);
  const [mode, setMode] = React.useState<PeriodMode>(periodModeOf(filters));
  const [month, setMonth] = React.useState(filters.month ?? thisMonth);
  const [year, setYear] = React.useState(String(filters.year ?? today.slice(0, 4)));
  const [from, setFrom] = React.useState(filters.from ?? "");
  const [to, setTo] = React.useState(filters.to ?? "");
  const [accountId, setAccountId] = React.useState(filters.accountId ?? ANY);
  const [categoryId, setCategoryId] = React.useState(filters.categoryId ?? ANY);
  const [scope, setScope] = React.useState<string>(filters.scope ?? ANY);
  const [counted, setCounted] = React.useState(!!filters.countedAsExpense);
  const [min, setMin] = React.useState(filters.min ?? "");
  const [max, setMax] = React.useState(filters.max ?? "");
  const [sort, setSort] = React.useState<SortOption>(filters.sort ?? "newest");

  const years = Array.from({ length: 12 }, (_, i) => String(Number(today.slice(0, 4)) - i));
  const quickMonths = [
    { label: "This month", value: thisMonth },
    { label: "Last month", value: shiftMonth(thisMonth, -1) },
  ];

  const apply = () =>
    onApply({
      month: mode === "month" ? month : null,
      year: mode === "year" ? year : null,
      from: mode === "range" ? from || null : null,
      to: mode === "range" ? to || null : null,
      accountId: accountId === ANY ? null : accountId,
      categoryId: categoryId === ANY ? null : categoryId,
      scope: scope === ANY ? null : scope,
      countedAsExpense: counted ? "1" : null,
      type: counted ? "TRANSFER" : (filters.type ?? null),
      min: min || null,
      max: max || null,
      sort: sort === "newest" ? null : sort,
    });

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Filter transactions"
      footer={
        <div className="flex gap-2 sm:justify-end">
          <Button variant="secondary" className="flex-1 sm:flex-none" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="flex-1 sm:flex-none" onClick={apply}>
            Show results
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <span className="text-small font-medium text-text-secondary">Period</span>
          <SegmentedControl
            ariaLabel="Period"
            size="sm"
            block
            value={mode}
            onValueChange={setMode}
            options={[
              { value: "any", label: "Any time" },
              { value: "month", label: "Month" },
              { value: "year", label: "Year" },
              { value: "range", label: "Range" },
            ]}
          />
          {mode === "month" && (
            <div className="flex flex-wrap items-center gap-2">
              <Input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="w-44" aria-label="Month" />
              {quickMonths.map((q) => (
                <Button key={q.label} size="sm" variant={month === q.value ? "primary" : "secondary"} onClick={() => setMonth(q.value)}>
                  {q.label}
                </Button>
              ))}
            </div>
          )}
          {mode === "year" && (
            <Select value={year} onValueChange={setYear}>
              <SelectTrigger aria-label="Year" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y} value={y}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {mode === "range" && (
            <div className="grid grid-cols-2 gap-2">
              <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
              <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Account">
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any account</SelectItem>
                <SelectSeparator />
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Category">
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any category</SelectItem>
                <SelectSeparator />
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                    <span className="text-text-tertiary">{c.kind === "INCOME" ? "· income" : ""}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Classification">
            <Select value={scope} onValueChange={setScope}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any</SelectItem>
                <SelectSeparator />
                {EXPENSE_SCOPES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {SCOPE_META[s].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Sort">
            <Select value={sort} onValueChange={(v) => setSort(v as SortOption)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SORT_LABELS) as SortOption[]).map((option) => (
                  <SelectItem key={option} value={option}>
                    {SORT_LABELS[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-small font-medium text-text-secondary">Amount</span>
          <div className="grid grid-cols-2 gap-2">
            <Input inputMode="decimal" placeholder="Min" value={min} onChange={(e) => setMin(sanitizeAmountInput(e.target.value))} aria-label="Minimum amount" className="tabular" />
            <Input inputMode="decimal" placeholder="Max" value={max} onChange={(e) => setMax(sanitizeAmountInput(e.target.value))} aria-label="Maximum amount" className="tabular" />
          </div>
        </div>

        <label className="flex items-center justify-between gap-4 rounded-lg border border-border px-4 py-3">
          <span className="flex flex-col">
            <span className="text-body font-medium text-text">Only transfers counted as expense</span>
            <span className="text-small text-text-tertiary">{TRANSACTION_TYPE_LABELS.TRANSFER}s you marked as spending</span>
          </span>
          <Switch checked={counted} onCheckedChange={setCounted} aria-label="Only transfers counted as expense" />
        </label>
      </div>
    </ResponsiveSheet>
  );
}
