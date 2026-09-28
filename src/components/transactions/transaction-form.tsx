"use client";

import { ArrowRightIcon, ArrowUpDownIcon, HistoryIcon, StickyNoteIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { useAppData, useFormatMoney } from "@/components/app-data";
import { AccountSelect } from "@/components/forms/account-select";
import { AmountInput } from "@/components/forms/amount-input";
import { CategoryPicker } from "@/components/forms/category-picker";
import { DateField } from "@/components/forms/date-field";
import { ScopePicker } from "@/components/forms/scope-picker";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { formatDate } from "@/lib/dates";
import { ENTRY_TYPES, TRANSACTION_TYPE_LABELS, type EntryType } from "@/lib/domain";
import { landsBefore, latestKnownBalance } from "@/lib/known-balance";
import { currencySymbol, sanitizeAmountInput } from "@/lib/money";
import type { AccountSummary } from "@/lib/types";
import { selectableCategories, type TransactionDraft } from "./transaction-draft";

const TYPE_OPTIONS = ENTRY_TYPES.map((type) => ({ value: type, label: TRANSACTION_TYPE_LABELS[type] }));

const reveal = {
  initial: { opacity: 0, y: -4 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
  transition: { duration: 0.18 },
};

export function TransactionFields({
  draft,
  update,
  errors,
  accounts,
  autoFocusAmount,
  dateLabel = "Date",
  withTime = false,
  withBalanceOption = false,
}: {
  draft: TransactionDraft;
  update: (patch: Partial<TransactionDraft>) => void;
  errors: Record<string, string>;
  accounts: AccountSummary[];
  autoFocusAmount?: boolean;
  dateLabel?: string;
  /** Offer an optional time of day next to the date (not for recurring rules). */
  withTime?: boolean;
  /** Offer to keep it out of the account balance, and say when it lands before a known balance. */
  withBalanceOption?: boolean;
}) {
  const { categories, today } = useAppData();
  const format = useFormatMoney();
  const [showNotes, setShowNotes] = React.useState(!!draft.notes);

  const source = accounts.find((a) => a.id === draft.accountId);
  const destination = accounts.find((a) => a.id === draft.toAccountId);
  const crossCurrency = draft.type === "TRANSFER" && !!source && !!destination && source.currency !== destination.currency;

  const expenseCategories = selectableCategories(categories, "EXPENSE", draft.expenseCategoryId);
  const incomeCategories = selectableCategories(categories, "INCOME", draft.incomeCategoryId);

  const chooseExpenseCategory = (id: string) => {
    const category = expenseCategories.find((c) => c.id === id);
    update({ expenseCategoryId: id, scope: category?.defaultScope ?? draft.scope });
  };

  const timeProps = withTime
    ? { time: draft.time, onTimeChange: (time: string) => update({ time }), timeError: errors.time }
    : {};

  // Accounts whose latest known balance already includes this entry.
  const settled =
    withBalanceOption && draft.affectsBalance
      ? [source, draft.type === "TRANSFER" ? destination : undefined].filter(
          (account): account is AccountSummary => !!account && landsBefore(draft.date, draft.time, latestKnownBalance(account), today),
        )
      : [];

  // Right under the account it would move, so it's seen before saving.
  const balanceOption = withBalanceOption ? (
    <div className="flex flex-col gap-2">
      <label className="flex items-start justify-between gap-4 rounded-lg border border-border px-4 py-3">
        <span className="flex flex-col gap-0.5">
          <span className="text-body font-medium text-text">Don&rsquo;t change the balance</span>
          <span className="text-small text-text-secondary">
            {draft.type === "TRANSFER"
              ? "Neither account's balance moves. Still listed with your transfers."
              : `Keeps ${source?.name ?? "the account"}'s balance as it is. Still counts in reports.`}
          </span>
        </span>
        <Switch
          checked={!draft.affectsBalance}
          onCheckedChange={(keepOut) => update({ affectsBalance: !keepOut })}
          aria-label="Don't change the balance"
        />
      </label>
      {settled.length > 0 && (
        <p className="flex items-start gap-2 px-1 text-small text-text-tertiary">
          <HistoryIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            {settled.map((account, index) => (
              <React.Fragment key={account.id}>
                {index > 0 && " and "}
                {account.name}&rsquo;s {latestKnownBalance(account).opening ? "opening balance" : "latest balance update"} (
                {formatDate(latestKnownBalance(account).date, "short")})
              </React.Fragment>
            ))}{" "}
            already {settled.length > 1 ? "include" : "includes"} this date, so it won&rsquo;t change the current balance.
          </span>
        </p>
      )}
    </div>
  ) : null;

  const setType = (type: EntryType) => {
    const patch: Partial<TransactionDraft> = { type };
    if (type === "TRANSFER" && (!draft.toAccountId || draft.toAccountId === draft.accountId)) {
      patch.toAccountId = accounts.find((a) => a.id !== draft.accountId)?.id ?? "";
    }
    update(patch);
  };

  return (
    <div className="flex flex-col gap-5">
      <SegmentedControl ariaLabel="Transaction type" value={draft.type} onValueChange={setType} options={TYPE_OPTIONS} block />

      <AmountInput
        value={draft.amount}
        onChange={(amount) => update({ amount })}
        currency={source?.currency ?? "BDT"}
        error={errors.amount}
        autoFocus={autoFocusAmount}
        tone={draft.type === "INCOME" ? "positive" : "neutral"}
      />

      {draft.type === "EXPENSE" && (
        <CategoryPicker
          label="Category"
          categories={expenseCategories}
          value={draft.expenseCategoryId}
          onChange={chooseExpenseCategory}
          error={errors.categoryId}
        />
      )}
      {draft.type === "INCOME" && (
        <CategoryPicker
          label="Source"
          categories={incomeCategories}
          value={draft.incomeCategoryId}
          onChange={(id) => update({ incomeCategoryId: id })}
          error={errors.categoryId}
        />
      )}

      {draft.type === "TRANSFER" ? (
        <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_auto_1fr]">
          <AccountSelect
            label="From"
            accounts={accounts}
            value={draft.accountId}
            onChange={(accountId) => update({ accountId })}
            error={errors.accountId}
            disabledId={draft.toAccountId}
          />
          <button
            type="button"
            onClick={() => update({ accountId: draft.toAccountId, toAccountId: draft.accountId })}
            className="mx-auto mb-1.5 inline-flex size-8 items-center justify-center rounded-full border border-border bg-surface text-text-tertiary shadow-xs transition-colors hover:text-text"
            aria-label="Swap accounts"
          >
            <ArrowUpDownIcon className="size-3.5 sm:hidden" />
            <ArrowRightIcon className="hidden size-3.5 sm:block" />
          </button>
          <AccountSelect
            label="To"
            accounts={accounts}
            value={draft.toAccountId}
            onChange={(toAccountId) => update({ toAccountId })}
            error={errors.toAccountId}
            disabledId={draft.accountId}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <AccountSelect
            label={draft.type === "INCOME" ? "Received in" : "Paid from"}
            accounts={accounts}
            value={draft.accountId}
            onChange={(accountId) => update({ accountId })}
            error={errors.accountId}
          />
          <DateField label={dateLabel} value={draft.date} onChange={(date) => update({ date })} today={today} error={errors.date} {...timeProps} />
        </div>
      )}

      {draft.type !== "TRANSFER" && balanceOption}

      <AnimatePresence initial={false}>
        {crossCurrency && destination && (
          <motion.div key="to-amount" {...reveal}>
            <Field
              label={`Amount received in ${destination.name}`}
              error={errors.toAmount}
              hint={`${destination.name} uses ${destination.currency}.`}
            >
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary">
                  {currencySymbol(destination.currency).trim()}
                </span>
                <Input
                  inputMode="decimal"
                  value={draft.toAmount}
                  onChange={(e) => update({ toAmount: sanitizeAmountInput(e.target.value) })}
                  className="h-11 pl-10 tabular"
                  placeholder="0"
                />
              </div>
            </Field>
          </motion.div>
        )}
      </AnimatePresence>

      {draft.type === "EXPENSE" && <ScopePicker value={draft.scope} onChange={(scope) => update({ scope })} />}

      {draft.type === "TRANSFER" && (
        <>
          <DateField label={dateLabel} value={draft.date} onChange={(date) => update({ date })} today={today} error={errors.date} {...timeProps} />
          {balanceOption}
          <div className="rounded-lg border border-border bg-surface-subtle p-4">
            <label className="flex items-start justify-between gap-4">
              <span className="flex flex-col gap-0.5">
                <span className="text-body font-medium text-text">Count this transfer as an expense</span>
                <span className="text-small text-text-secondary">
                  For money that leaves your hands for good — like support sent to family. It moves between accounts
                  once, and is also counted in spending.
                </span>
              </span>
              <Switch
                checked={draft.countAsExpense}
                onCheckedChange={(countAsExpense) => update({ countAsExpense })}
                aria-label="Count this transfer as an expense"
              />
            </label>
            <AnimatePresence initial={false}>
              {draft.countAsExpense && (
                <motion.div key="expense-fields" {...reveal} className="mt-4 flex flex-col gap-4 border-t border-border pt-4">
                  <CategoryPicker
                    label="Expense category"
                    categories={expenseCategories}
                    value={draft.expenseCategoryId}
                    onChange={chooseExpenseCategory}
                    error={errors.categoryId}
                  />
                  <ScopePicker value={draft.scope} onChange={(scope) => update({ scope })} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </>
      )}

      <Field label="Description" optional error={errors.description}>
        <Input
          value={draft.description}
          onChange={(e) => update({ description: e.target.value })}
          placeholder={draft.type === "TRANSFER" ? "e.g. ATM withdrawal" : draft.type === "INCOME" ? "e.g. September salary" : "What was it for?"}
          maxLength={140}
          className="h-11"
        />
      </Field>

      {showNotes ? (
        <motion.div {...reveal}>
          <Field label="Notes" optional error={errors.notes}>
            <Textarea
              value={draft.notes}
              onChange={(e) => update({ notes: e.target.value })}
              maxLength={2000}
              rows={3}
              placeholder="Anything worth remembering"
            />
          </Field>
        </motion.div>
      ) : (
        <button
          type="button"
          onClick={() => setShowNotes(true)}
          className="-mt-2 inline-flex items-center gap-1.5 self-start rounded-md py-1 text-small font-medium text-text-tertiary transition-colors hover:text-text"
        >
          <StickyNoteIcon className="size-3.5" />
          Add a note
        </button>
      )}

      {draft.type === "TRANSFER" && source && destination && draft.amount && (
        <p className="flex flex-wrap items-center gap-1.5 rounded-md bg-surface-muted px-3 py-2 text-small text-text-secondary">
          <ArrowRightIcon className="size-3.5" />
          {source.name} −{format(draft.amount, { currency: source.currency })}
          <span className="text-text-quaternary">·</span>
          {destination.name} +
          {format(crossCurrency ? draft.toAmount || "0" : draft.amount, { currency: destination.currency })}
          {draft.countAsExpense && (
            <>
              <span className="text-text-quaternary">·</span>
              counted as spending
            </>
          )}
        </p>
      )}
    </div>
  );
}
