"use client";

import { CheckCircle2Icon, HistoryIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { Amount, useAppData, useFormatMoney } from "@/components/app-data";
import { AmountInput } from "@/components/forms/amount-input";
import { CategoryPicker } from "@/components/forms/category-picker";
import { DateField } from "@/components/forms/date-field";
import { ScopePicker } from "@/components/forms/scope-picker";
import { selectableCategories } from "@/components/transactions/transaction-draft";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/misc";
import { ResponsiveSheet } from "@/components/ui/sheet";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import { formatDate } from "@/lib/dates";
import type { ExpenseScope } from "@/lib/domain";
import { toMinor } from "@/lib/money";
import type { AccountSummary, RecordedBalance } from "@/lib/types";
import { cn } from "@/lib/utils";

type RecordAs = "CORRECTION" | "CATEGORY";

interface UpdateResult {
  difference: string;
  startingPoint: boolean;
  recorded: { id: string; type: "EXPENSE" | "INCOME" } | null;
}

/**
 * "The account holds exactly this much" — for money that moved without a
 * record or an SMS. Whatever is dated before it and added later is absorbed,
 * so back-filling old spending never changes the balance after it.
 */
export function UpdateBalanceSheet({
  open,
  onOpenChange,
  account,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account: AccountSummary;
}) {
  const router = useRouter();
  const { categories, today } = useAppData();
  const format = useFormatMoney();
  const formId = React.useId();
  const currency = account.currency;

  const [amount, setAmount] = React.useState("");
  // Only a card normally holds a negative balance (what's owed). A wallet or
  // bank showing one is usually what's being corrected, so start positive.
  const [negative, setNegative] = React.useState(account.type === "CARD" && account.balance.startsWith("-"));
  const [date, setDate] = React.useState(today);
  /** "" = no time: now (today) or the end of that day. */
  const [time, setTime] = React.useState("");
  const [recordAs, setRecordAs] = React.useState<RecordAs>("CORRECTION");
  const [categoryId, setCategoryId] = React.useState("");
  const [scope, setScope] = React.useState<ExpenseScope>("PERSONAL");
  const [note, setNote] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [pending, setPending] = React.useState(false);

  // What Hisab has at the chosen moment depends on the times of that day's
  // entries, so the server works it out. An answer for a moment no longer
  // chosen is ignored.
  const moment = `${date} ${time}`;
  const [recorded, setRecorded] = React.useState<{ moment: string; value: RecordedBalance | null } | null>(null);
  React.useEffect(() => {
    if (!open) return;
    let live = true;
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams({ date });
      if (time) query.set("time", time);
      api<RecordedBalance>(`/api/accounts/${account.id}/balance?${query}`, { method: "GET" }).then(
        (value) => {
          if (live) setRecorded({ moment, value });
        },
        () => {
          if (live) setRecorded({ moment, value: null });
        },
      );
    }, 150);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [open, account.id, date, time, moment]);

  /** undefined while loading, null if it couldn't be loaded. */
  const known = recorded?.moment === moment ? recorded.value : undefined;
  const balance = amount ? `${negative ? "-" : ""}${amount}` : "";
  // Display only — the server works the difference out again when saving.
  const difference = known && balance ? toMinor(balance) - toMinor(known.balance) : null;
  const kind = difference !== null && difference < 0n ? "EXPENSE" : "INCOME";
  const canRecordAsCategory = difference !== null && difference !== 0n && !known?.startingPoint;
  const pickable = selectableCategories(categories, kind);
  // Cards (owed) and bank overdrafts can really be below zero.
  const showSign = negative || account.type === "CARD" || account.type === "BANK";

  const clearError = (...keys: string[]) =>
    setErrors((current) => {
      const next = { ...current };
      for (const key of keys) delete next[key];
      return next;
    });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (!amount) return setErrors({ balance: "Enter what the account holds." });
    const asCategory = recordAs === "CATEGORY" && canRecordAsCategory;
    if (asCategory && !categoryId) return setErrors({ categoryId: "Choose a category." });
    setPending(true);
    try {
      const result = await api<UpdateResult>(`/api/accounts/${account.id}/balance`, {
        body: {
          balance,
          date,
          time: time || null,
          recordAs: asCategory ? "CATEGORY" : "CORRECTION",
          categoryId: asCategory ? categoryId : null,
          scope: asCategory && kind === "EXPENSE" ? scope : null,
          note,
        },
      });
      const signed = format(result.difference, { currency, sign: "always" });
      toast.success(`${account.name} balance updated`, {
        description: result.startingPoint
          ? "Saved as the earliest balance on record."
          : toMinor(result.difference) === 0n
            ? "It matches what Hisab had."
            : result.recorded
              ? `Recorded ${format(result.difference.replace(/^-/, ""), { currency })} as unrecorded ${result.recorded.type === "EXPENSE" ? "spending" : "income"}.`
              : `Corrected by ${signed}.`,
      });
      onOpenChange(false);
      router.refresh();
    } catch (error) {
      // Re-enable only on failure: after success the sheet is closing and must not submit twice.
      setPending(false);
      if (error instanceof ApiClientError) setErrors(error.fieldErrors);
      toast.error(errorMessage(error));
    }
  }

  const momentLabel = time ? "then" : date === today ? "now" : "by the end of that day";

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Update ${account.name} balance`}
      description="Enter what's actually there. Hisab corrects for anything that wasn't recorded."
      footer={
        <Button
          type="submit"
          form={formId}
          size="lg"
          loading={pending}
          disabled={!amount}
          className="w-full sm:ml-auto sm:flex sm:h-10 sm:w-auto sm:text-body"
        >
          {difference === 0n ? "Confirm balance" : "Update balance"}
          {balance && <span className="font-normal text-white/60">· {format(balance, { currency })}</span>}
        </Button>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-5">
        <div className="flex flex-col items-center">
          <AmountInput
            label="Balance"
            value={amount}
            onChange={(value) => {
              setAmount(value);
              clearError("balance");
            }}
            currency={currency}
            error={errors.balance}
            autoFocus
          />
          {showSign && (
            <button
              type="button"
              onClick={() => setNegative((n) => !n)}
              aria-pressed={negative}
              className={cn(
                "-mt-1 h-7 rounded-full border px-3 text-caption font-medium transition-colors",
                negative ? "border-negative/40 bg-negative-soft text-negative-text" : "border-border text-text-tertiary hover:text-text",
              )}
            >
              {negative ? "Negative (owed)" : "Make it negative"}
            </button>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <DateField
            label="As of"
            value={date}
            onChange={(value) => {
              setDate(value);
              clearError("date", "time");
            }}
            today={today}
            allowFuture={false}
            error={errors.date}
            time={time}
            onTimeChange={(value) => {
              setTime(value);
              clearError("date", "time");
            }}
            timeError={errors.time}
          />
          {!errors.date && !errors.time && !time && (
            <p className="text-caption text-text-tertiary">
              {date === today ? "Right now. Add a time if you saw this balance earlier today." : "At the end of that day, unless you add a time."}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 rounded-lg bg-surface-muted p-4" aria-live="polite">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-caption font-medium text-text-tertiary">In Hisab {momentLabel}</span>
            {known === undefined ? (
              <Skeleton className="mt-1 h-6 w-24" />
            ) : known === null ? (
              <span className="text-heading font-semibold text-text-quaternary">—</span>
            ) : (
              <Amount value={known.balance} currency={currency} className="text-heading font-semibold" />
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-caption font-medium text-text-tertiary">Difference</span>
            {difference === null ? (
              <span className="text-heading font-semibold text-text-quaternary">—</span>
            ) : difference === 0n ? (
              <span className="inline-flex items-center gap-1.5 text-heading font-semibold text-positive-text">
                <CheckCircle2Icon className="size-4" /> Matches
              </span>
            ) : (
              <Amount value={difference} currency={currency} sign="always" tone="signed" className="text-heading font-semibold" />
            )}
          </div>
        </div>

        {known?.nextBalance && (
          <p className="flex items-start gap-2 rounded-lg border border-border px-3 py-2.5 text-small text-text-secondary">
            <HistoryIcon className="mt-0.5 size-4 shrink-0 text-text-tertiary" aria-hidden />
            <span>
              {known.nextBalance.opening ? "The opening balance" : "A later balance update"} on{" "}
              {formatDate(known.nextBalance.date, "medium")} comes after this, so the balance from then on stays as it is. This
              only corrects the history before it.
            </span>
          </p>
        )}

        {canRecordAsCategory && (
          <div className="flex flex-col gap-2">
            <span className="text-small font-medium text-text-secondary">Record the difference as</span>
            <div role="radiogroup" aria-label="Record the difference as" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <ChoiceCard
                selected={recordAs === "CORRECTION"}
                onSelect={() => setRecordAs("CORRECTION")}
                title="Balance correction"
                description="Fixes the balance. Not counted as spending or income."
              />
              <ChoiceCard
                selected={recordAs === "CATEGORY"}
                onSelect={() => setRecordAs("CATEGORY")}
                title={kind === "EXPENSE" ? "Unrecorded spending" : "Unrecorded income"}
                description={kind === "EXPENSE" ? "Money you spent but didn't log. Counts in reports." : "Money you received but didn't log."}
              />
            </div>
          </div>
        )}
        {canRecordAsCategory && recordAs === "CATEGORY" && (
          <>
            <CategoryPicker
              label="Category"
              categories={pickable}
              value={categoryId}
              onChange={(id) => {
                setCategoryId(id);
                clearError("categoryId");
                const picked = pickable.find((c) => c.id === id);
                if (picked?.defaultScope) setScope(picked.defaultScope);
              }}
              error={errors.categoryId}
            />
            {kind === "EXPENSE" && <ScopePicker value={scope} onChange={setScope} />}
          </>
        )}

        <Field label="Note" optional error={errors.note}>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="e.g. Checked in the bKash app"
          />
        </Field>

        <p className="-mt-2 text-caption text-text-tertiary">
          Transactions you add later but date before this won&rsquo;t change this balance.
        </p>
      </form>
    </ResponsiveSheet>
  );
}

function ChoiceCard({ selected, onSelect, title, description }: { selected: boolean; onSelect: () => void; title: string; description: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex flex-col gap-0.5 rounded-lg border p-3.5 text-left transition-[border-color,background-color]",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--focus-ring)]",
        selected ? "border-ink bg-surface-subtle" : "border-border hover:border-border-strong",
      )}
    >
      <span className="text-body font-medium text-text">{title}</span>
      <span className="text-small text-text-secondary">{description}</span>
    </button>
  );
}
