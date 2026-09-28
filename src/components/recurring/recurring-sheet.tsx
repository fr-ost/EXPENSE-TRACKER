"use client";

import { Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { useAppData } from "@/components/app-data";
import { DateField } from "@/components/forms/date-field";
import { TransactionFields } from "@/components/transactions/transaction-form";
import { draftToInput, newDraft, type TransactionDraft } from "@/components/transactions/transaction-draft";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ResponsiveSheet } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import { describeSchedule, formatDate } from "@/lib/dates";
import { FREQUENCIES, FREQUENCY_LABELS, type Frequency } from "@/lib/domain";
import type { RecurringView } from "@/lib/types";
import { fieldErrorsOf, recurringInput } from "@/lib/validation";

function draftFromRule(rule: RecurringView): TransactionDraft {
  const categoryId = rule.category?.id ?? "";
  return {
    type: rule.type,
    amount: rule.amount.replace(/\.00$/, ""),
    accountId: rule.account.id,
    toAccountId: rule.toAccount?.id ?? "",
    toAmount: rule.toAmount?.replace(/\.00$/, "") ?? "",
    expenseCategoryId: rule.category?.kind === "EXPENSE" ? categoryId : "",
    incomeCategoryId: rule.category?.kind === "INCOME" ? categoryId : "",
    scope: rule.scope ?? "PERSONAL",
    countAsExpense: rule.countAsExpense,
    date: rule.startDate,
    description: rule.description,
    notes: rule.notes ?? "",
  };
}

export function RecurringSheet({ open, onOpenChange, rule }: { open: boolean; onOpenChange: (open: boolean) => void; rule?: RecurringView }) {
  const router = useRouter();
  const { accounts, today } = useAppData();
  const formId = React.useId();
  const [draft, setDraft] = React.useState<TransactionDraft>(() => (rule ? draftFromRule(rule) : newDraft({}, accounts, today)));
  const [frequency, setFrequency] = React.useState<Frequency>(rule?.frequency ?? "MONTHLY");
  const [hasEnd, setHasEnd] = React.useState(!!rule?.endDate);
  const [endDate, setEndDate] = React.useState(rule?.endDate ?? draft.date);
  const [backfill, setBackfill] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [pending, setPending] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  const usable = accounts.filter((a) => a.isActive || a.id === rule?.account.id || a.id === rule?.toAccount?.id);
  const update = React.useCallback((patch: Partial<TransactionDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setErrors({});
  }, []);

  const source = accounts.find((a) => a.id === draft.accountId);
  const destination = accounts.find((a) => a.id === draft.toAccountId);
  const needsToAmount = draft.type === "TRANSFER" && !!source && !!destination && source.currency !== destination.currency;
  const startsInPast = !rule && draft.date < today;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const entry = draftToInput(draft, needsToAmount);
    const candidate = {
      type: entry.type,
      amount: entry.amount,
      accountId: entry.accountId,
      toAccountId: entry.type === "TRANSFER" ? entry.toAccountId : null,
      toAmount: entry.type === "TRANSFER" ? entry.toAmount : null,
      categoryId: "categoryId" in entry ? entry.categoryId : null,
      countAsExpense: entry.type === "TRANSFER" ? entry.countAsExpense : false,
      scope: "scope" in entry ? entry.scope : null,
      description: entry.description,
      notes: entry.notes,
      frequency,
      startDate: draft.date,
      endDate: hasEnd ? endDate : null,
      isActive: rule?.isActive ?? true,
    };
    const parsed = recurringInput.safeParse(candidate);
    if (!parsed.success) {
      const fieldErrors = fieldErrorsOf(parsed.error);
      if (fieldErrors.startDate) fieldErrors.date = fieldErrors.startDate;
      return setErrors(fieldErrors);
    }
    setPending(true);
    try {
      if (rule) {
        await api(`/api/recurring/${rule.id}`, { method: "PUT", body: parsed.data });
        toast.success("Recurring transaction updated");
      } else {
        await api("/api/recurring", { body: { rule: parsed.data, backfill: startsInPast && backfill } });
        toast.success("Recurring transaction created", { description: describeSchedule(frequency, draft.date) });
      }
      onOpenChange(false);
      router.refresh();
    } catch (error) {
      // Re-enable only on failure: after success the sheet is closing and must not submit twice.
      setPending(false);
      if (error instanceof ApiClientError) setErrors(error.fieldErrors);
      toast.error(errorMessage(error));
    }
  }

  async function remove() {
    if (!rule) return;
    setDeleting(true);
    try {
      await api(`/api/recurring/${rule.id}`, { method: "DELETE" });
      toast.success("Recurring transaction deleted", { description: "Transactions it already posted are kept." });
      setConfirmDelete(false);
      onOpenChange(false);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <ResponsiveSheet
        open={open}
        onOpenChange={onOpenChange}
        title={rule ? "Edit recurring transaction" : "New recurring transaction"}
        footer={
          <div className="flex items-center gap-2">
            {rule && (
              <Button variant="ghost" size="icon" onClick={() => setConfirmDelete(true)} aria-label="Delete recurring transaction" className="text-negative-text hover:bg-negative-soft hover:text-negative-text">
                <Trash2Icon />
              </Button>
            )}
            <Button type="submit" form={formId} size="lg" loading={pending} className="flex-1 sm:ml-auto sm:h-10 sm:flex-none sm:text-body">
              {rule ? "Save changes" : "Create"}
            </Button>
          </div>
        }
      >
        <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-5">
          <TransactionFields draft={draft} update={update} errors={errors} accounts={usable} autoFocusAmount={!rule} dateLabel="First payment" />

          <div className="flex flex-col gap-4 rounded-lg border border-border p-4">
            <div className="flex flex-col gap-2">
              <span className="text-small font-medium text-text-secondary">Repeats</span>
              <SegmentedControl
                ariaLabel="Repeats"
                block
                value={frequency}
                onValueChange={setFrequency}
                options={FREQUENCIES.map((f) => ({ value: f, label: FREQUENCY_LABELS[f] }))}
              />
              <p className="text-caption text-text-tertiary">{describeSchedule(frequency, draft.date)}</p>
            </div>
            <label className="flex items-center justify-between gap-4">
              <span className="text-body text-text">Ends on a date</span>
              <Switch checked={hasEnd} onCheckedChange={setHasEnd} aria-label="Ends on a date" />
            </label>
            {hasEnd && <DateField label="Last payment on or before" value={endDate} onChange={setEndDate} today={today} error={errors.endDate} quickPicks={false} />}
            {startsInPast && (
              <label className="flex items-start justify-between gap-4 border-t border-border pt-4">
                <span className="flex flex-col gap-0.5">
                  <span className="text-body text-text">Record past payments too</span>
                  <span className="text-small text-text-tertiary">
                    Adds every occurrence from {formatDate(draft.date, "medium")} to today. Otherwise it starts with the next one.
                  </span>
                </span>
                <Switch checked={backfill} onCheckedChange={setBackfill} aria-label="Record past payments too" />
              </label>
            )}
          </div>
        </form>
      </ResponsiveSheet>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this recurring transaction?"
        description="It will stop posting. Transactions it already recorded stay in your history."
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onConfirm={remove}
      />
    </>
  );
}
