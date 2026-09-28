"use client";

import { CheckCircle2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { Amount, useAppData, useFormatMoney } from "@/components/app-data";
import { AmountInput } from "@/components/forms/amount-input";
import { CategoryPicker } from "@/components/forms/category-picker";
import { ScopePicker } from "@/components/forms/scope-picker";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";
import { ResponsiveSheet } from "@/components/ui/sheet";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import type { ExpenseScope } from "@/lib/domain";
import { fromMinor, toMinor } from "@/lib/money";
import type { AccountSummary } from "@/lib/types";
import { cn } from "@/lib/utils";
import { selectableCategories } from "@/components/transactions/transaction-draft";

type RecordAs = "ADJUSTMENT" | "CATEGORY";

export function ReconcileSheet({
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
  const [counted, setCounted] = React.useState("");
  const [recordAs, setRecordAs] = React.useState<RecordAs>("ADJUSTMENT");
  const [categoryId, setCategoryId] = React.useState("");
  const [scope, setScope] = React.useState<ExpenseScope>("PERSONAL");
  const [note, setNote] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [pending, setPending] = React.useState(false);

  // Display only — the server recomputes the difference when recording.
  const difference = counted ? toMinor(counted) - toMinor(account.balance) : null;
  const kind = difference !== null && difference < 0n ? "EXPENSE" : "INCOME";
  const pickable = selectableCategories(categories, kind);
  const currency = account.currency;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!counted) return setErrors({ countedBalance: "Enter the amount you counted." });
    if (difference === 0n) {
      toast.success(`${account.name} is balanced`, { description: "The counted amount matches the ledger." });
      return onOpenChange(false);
    }
    if (recordAs === "CATEGORY" && !categoryId) return setErrors({ categoryId: "Choose a category." });
    setPending(true);
    try {
      const result = await api<{ difference: string }>(`/api/accounts/${account.id}/reconcile`, {
        body: {
          countedBalance: counted,
          date: today,
          recordAs,
          categoryId: recordAs === "CATEGORY" ? categoryId : null,
          scope: recordAs === "CATEGORY" && kind === "EXPENSE" ? scope : null,
          note,
        },
      });
      toast.success("Difference recorded", {
        description: `${format(result.difference, { currency, sign: "always" })} on ${account.name}`,
      });
      onOpenChange(false);
      router.refresh();
    } catch (error) {
      if (error instanceof ApiClientError) setErrors(error.fieldErrors);
      toast.error(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Reconcile ${account.name}`}
      description="Count what's actually there and compare it with the ledger."
      footer={
        <Button type="submit" form="reconcile-form" size="lg" loading={pending} disabled={!counted} className="w-full sm:ml-auto sm:flex sm:h-10 sm:w-auto sm:text-body">
          {difference === 0n || difference === null
            ? "Confirm balance"
            : `Record ${format(fromMinor(difference), { currency, sign: "always" })}`}
        </Button>
      }
    >
      <form id="reconcile-form" onSubmit={submit} noValidate className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3 rounded-lg bg-surface-muted p-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-caption font-medium text-text-tertiary">Expected (ledger)</span>
            <Amount value={account.balance} currency={currency} className="text-heading font-semibold" />
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-caption font-medium text-text-tertiary">Difference</span>
            {difference === null ? (
              <span className="text-heading font-semibold text-text-quaternary">—</span>
            ) : difference === 0n ? (
              <span className="inline-flex items-center gap-1.5 text-heading font-semibold text-positive-text">
                <CheckCircle2Icon className="size-4" /> Balanced
              </span>
            ) : (
              <Amount value={difference} currency={currency} sign="always" tone="signed" className="text-heading font-semibold" />
            )}
          </div>
        </div>

        <AmountInput label="Counted balance" value={counted} onChange={setCounted} currency={currency} error={errors.countedBalance} autoFocus />

        {difference !== null && difference !== 0n && (
          <>
            <div className="flex flex-col gap-2">
              <span className="text-small font-medium text-text-secondary">Record the difference as</span>
              <div role="radiogroup" aria-label="Record the difference as" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <ChoiceCard
                  selected={recordAs === "ADJUSTMENT"}
                  onSelect={() => setRecordAs("ADJUSTMENT")}
                  title="Balance adjustment"
                  description="Corrects the balance. Not counted as spending or income."
                />
                <ChoiceCard
                  selected={recordAs === "CATEGORY"}
                  onSelect={() => setRecordAs("CATEGORY")}
                  title={kind === "EXPENSE" ? "Unrecorded expense" : "Unrecorded income"}
                  description={kind === "EXPENSE" ? "Money you spent but didn't log. Counts in spending." : "Money you received but didn't log."}
                />
              </div>
            </div>
            {recordAs === "CATEGORY" && (
              <>
                <CategoryPicker label="Category" categories={pickable} value={categoryId} onChange={setCategoryId} error={errors.categoryId} />
                {kind === "EXPENSE" && <ScopePicker value={scope} onChange={setScope} />}
              </>
            )}
            <Field label="Reason" optional>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} placeholder="e.g. Rickshaw fares not logged this week" />
            </Field>
          </>
        )}
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
