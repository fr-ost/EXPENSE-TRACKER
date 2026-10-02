"use client";

import {
  AlertTriangleIcon,
  ArrowRightIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  CopyIcon,
  PencilIcon,
  PlusIcon,
  Undo2Icon,
  XIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { Amount, useAppData, useFormatMoney } from "@/components/app-data";
import { IconBadge } from "@/components/icon";
import { TransactionFields } from "@/components/transactions/transaction-form";
import type { TransactionDraft } from "@/components/transactions/transaction-draft";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/misc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { formatDate, formatTime } from "@/lib/dates";
import { landsBefore, latestReportedBalance } from "@/lib/known-balance";
import { IGNORE_REASON_LABELS } from "@/lib/sms/parse";
import { cn } from "@/lib/utils";
import { isBalanceOnly, missingAccount, reportedBalance, suggestAccount, type SmsItem, type SmsItemStatus } from "./sms-model";
import type { BalanceCheck } from "./sms-suggest";

const STATUS: Record<SmsItemStatus, { label: string; tone: "positive" | "warning" | "neutral" | "negative" | "info" }> = {
  ready: { label: "Ready", tone: "positive" },
  review: { label: "Check", tone: "warning" },
  ignored: { label: "Skipped", tone: "neutral" },
  saving: { label: "Adding…", tone: "neutral" },
  added: { label: "Added", tone: "positive" },
  exists: { label: "Already added", tone: "neutral" },
  duplicate: { label: "Possible duplicate", tone: "warning" },
  error: { label: "Couldn't add", tone: "negative" },
};

export interface SmsCardActions {
  onChange: (patch: Partial<SmsItem>) => void;
  onAdd: (options?: { allowDuplicate?: boolean; sameAs?: string }) => void;
  /** Record the balance of a message added earlier. */
  onSaveBalance: () => void;
  /** Create the account the message needs (its bank or wallet, or Cash). */
  onCreateAccount: () => void;
  onUndo: () => void;
  onOpen: () => void;
  onDismiss: () => void;
}

export function SmsCard({ item, actions, balance }: { item: SmsItem; actions: SmsCardActions; balance?: BalanceCheck }) {
  const { accounts, categories, settings, today } = useAppData();
  const format = useFormatMoney();
  // Open the fields straight away when something must be chosen — unless the
  // choice is a new account, which the card offers to create.
  const [editing, setEditing] = React.useState(
    item.status === "review" && item.issues.some((i) => i.startsWith("Choose")) && !missingAccount(item),
  );
  const [showText, setShowText] = React.useState(false);

  const { draft, fee, parsed, status } = item;
  const done = status === "added" || status === "exists";
  const pending = status === "ready" || status === "review" || status === "duplicate" || status === "error";
  const source = accounts.find((a) => a.id === draft.accountId);
  const destination = accounts.find((a) => a.id === draft.toAccountId);
  const categoryId = draft.type === "INCOME" ? draft.incomeCategoryId : draft.expenseCategoryId;
  const category = categories.find((c) => c.id === categoryId);
  const currency = (draft.type === "TRANSFER" && parsed.direction === "credit" ? destination : source)?.currency;
  const reported = reportedBalance(item, accounts, today);
  const newAccount = suggestAccount(item, settings.baseCurrency);
  // The box offering to create the missing account says it already.
  const missing = missingAccount(item);
  const issues = item.issues.filter(
    (issue) => !newAccount || !(missing === "own" ? issue.startsWith("Choose the account") : /cash/i.test(issue)),
  );
  // "Your balance is Tk 8,000": nothing to add, it sets the account's balance.
  const balanceOnly = status === "ignored" && isBalanceOnly(item);
  const statusLabel = balanceOnly ? "Balance" : STATUS[status].label;
  // A message older than the account's latest known balance only fills in history.
  const olderThanKnown = !!reported && landsBefore(draft.date, draft.time, latestReportedBalance(reported.account), today);

  const updateDraft = (patch: Partial<TransactionDraft>) => {
    const fieldErrors = { ...item.fieldErrors };
    for (const key of Object.keys(patch)) delete fieldErrors[key];
    actions.onChange({ draft: { ...draft, ...patch }, fieldErrors, status: status === "error" ? "review" : status });
  };

  const icon =
    draft.type === "TRANSFER" && !draft.countAsExpense
      ? { icon: "arrow-left-right", color: "slate" }
      : { icon: category?.icon ?? "circle-dashed", color: category?.color ?? "gray" };

  const amountValue = draft.amount || "0";
  const amount =
    draft.type === "INCOME" ? (
      <Amount value={amountValue} currency={currency} sign="always" tone="income" />
    ) : draft.type === "EXPENSE" ? (
      <Amount value={`-${amountValue}`} currency={currency} />
    ) : (
      <Amount value={amountValue} currency={currency} />
    );

  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, marginTop: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "overflow-hidden rounded-xl border bg-surface shadow-xs",
        status === "duplicate" || status === "review" ? "border-warning/40" : status === "error" ? "border-negative/40" : "border-border",
      )}
      aria-label={`${balanceOnly ? "Balance" : draft.description || "SMS"}: ${statusLabel}`}
    >
      <div className={cn("flex flex-col gap-3 p-4 sm:p-5", (done || status === "ignored") && "bg-surface-subtle/60")}>
        <div className="flex items-start gap-3">
          <IconBadge icon={icon.icon} color={icon.color} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <p className="truncate text-body font-medium text-text">{balanceOnly ? "Balance" : draft.description || "SMS transaction"}</p>
            <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-small text-text-tertiary">
              {parsed.provider && <span className="font-medium text-text-secondary">{parsed.provider.name}</span>}
              {parsed.provider && <span aria-hidden>·</span>}
              <span className="tabular">
                {formatDate(draft.date, "medium")}
                {draft.time && ` · ${formatTime(draft.time)}`}
              </span>
              <Badge tone={balanceOnly ? "info" : STATUS[status].tone} className="ml-0.5">
                {status === "added" && <CheckCircle2Icon />}
                {statusLabel}
              </Badge>
            </p>
          </div>
          <div className={cn("shrink-0 text-right text-heading font-semibold", status === "ignored" && !balanceOnly && "[&_*]:!text-text-tertiary")}>
            {balanceOnly && parsed.balance ? (
              <Amount value={parsed.balance} currency={source?.currency} />
            ) : parsed.amount || draft.amount ? (
              amount
            ) : (
              <span className="text-text-quaternary">—</span>
            )}
          </div>
        </div>

        {status !== "ignored" && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 sm:pl-12 text-small text-text-secondary">
            {draft.type === "TRANSFER" ? (
              <span className="inline-flex min-w-0 items-center gap-1">
                <span className={cn("truncate", !source && "text-warning-text")}>{source?.name ?? "Choose account"}</span>
                <ArrowRightIcon className="size-3 shrink-0 text-text-tertiary" aria-label="to" />
                <span className={cn("truncate", !destination && "text-warning-text")}>{destination?.name ?? "Choose account"}</span>
              </span>
            ) : (
              <span className={cn("truncate", !source && "text-warning-text")}>{source?.name ?? "Choose account"}</span>
            )}
            {(draft.type !== "TRANSFER" || draft.countAsExpense) && category && (
              <>
                <span aria-hidden className="text-text-quaternary">·</span>
                <span>{category.name}</span>
              </>
            )}
            {draft.type === "TRANSFER" && !draft.countAsExpense && (
              <>
                <span aria-hidden className="text-text-quaternary">·</span>
                <span>Transfer (not spending)</span>
              </>
            )}
          </div>
        )}

        {fee && status !== "ignored" && (
          <label className="sm:ml-12 flex items-center justify-between gap-3 rounded-lg bg-surface-subtle px-3 py-2 text-small">
            <span className="text-text-secondary">
              Also record the <Amount value={fee.amount || "0"} currency={currency} className="font-medium text-text" /> fee as an expense
            </span>
            <Switch
              checked={item.includeFee}
              disabled={!pending}
              onCheckedChange={(includeFee) => actions.onChange({ includeFee })}
              aria-label="Record the fee"
            />
          </label>
        )}

        {reported && pending && (
          <label className="sm:ml-12 flex items-center justify-between gap-3 rounded-lg bg-surface-subtle px-3 py-2 text-small">
            <span className="flex min-w-0 flex-col">
              <span className="text-text-secondary">
                {olderThanKnown ? `Save ${reported.account.name} balance of ` : `Update ${reported.account.name} balance to `}
                <span className="font-medium text-text">{format(reported.amount, { currency: reported.account.currency, decimals: "always" })}</span>
              </span>
              {olderThanKnown ? (
                <span className="text-caption text-text-tertiary">
                  It&rsquo;s older than {reported.account.name}&rsquo;s latest balance, which stays current.
                </span>
              ) : (
                balance &&
                (balance.matches ? (
                  <span className="inline-flex items-center gap-1 text-caption text-positive-text">
                    <CheckCircle2Icon className="size-3 shrink-0" /> Matches Hisab
                  </span>
                ) : (
                  <span className="text-caption text-text-tertiary">
                    Replaces {format(balance.expected, { currency: balance.account.currency, decimals: "always" })}, what Hisab
                    {balance.afterPending ? " would show after adding" : " shows now"}
                  </span>
                ))
              )}
            </span>
            <Switch
              checked={item.includeBalance}
              onCheckedChange={(includeBalance) => actions.onChange({ includeBalance })}
              aria-label={`Update ${reported.account.name} balance from this SMS`}
            />
          </label>
        )}
        {reported && done && item.balanceSaved && (
          <p className="sm:ml-12 flex items-center gap-1.5 text-small text-positive-text">
            <CheckCircle2Icon className="size-3.5 shrink-0" />
            {reported.account.name} balance from the SMS saved:{" "}
            {format(reported.amount, { currency: reported.account.currency, decimals: "always" })}
          </p>
        )}
        {reported && status === "exists" && !item.balanceSaved && (
          <div className="sm:ml-12 flex items-center justify-between gap-3 rounded-lg bg-surface-subtle px-3 py-2 text-small">
            <span className="flex min-w-0 flex-col">
              <span className="text-text-secondary">
                Added before, without its balance:{" "}
                <span className="font-medium text-text">{format(reported.amount, { currency: reported.account.currency, decimals: "always" })}</span>
              </span>
              {olderThanKnown && (
                <span className="text-caption text-text-tertiary">
                  It&rsquo;s older than {reported.account.name}&rsquo;s latest balance, which stays current.
                </span>
              )}
            </span>
            <Button size="sm" variant="outline" onClick={actions.onSaveBalance}>
              Update {reported.account.name}
            </Button>
          </div>
        )}

        {balanceOnly ? (
          <BalanceOnly item={item} reported={reported} olderThanKnown={olderThanKnown} onChange={actions.onChange} onSave={actions.onSaveBalance} />
        ) : (
          status === "ignored" && parsed.ignored && <p className="sm:pl-12 text-small text-text-secondary">{IGNORE_REASON_LABELS[parsed.ignored]}.</p>
        )}

        {status === "review" && issues.length > 0 && (
          <ul className="sm:ml-12 flex flex-col gap-1 rounded-lg bg-warning-soft px-3 py-2 text-small text-warning-text">
            {issues.map((issue) => (
              <li key={issue} className="flex items-start gap-1.5">
                <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                {issue}
              </li>
            ))}
          </ul>
        )}
        {newAccount && (
          <div className="sm:ml-12 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-dashed border-border-strong px-3 py-2.5 text-small">
            <span className="min-w-0 flex-1 text-text-secondary">
              {missing === "cash"
                ? "No Cash account yet for this withdrawal."
                : `No account for ${parsed.provider?.name ?? "this message"} yet.`}
            </span>
            <Button size="sm" onClick={actions.onCreateAccount}>
              <PlusIcon />
              {newAccount.name ? `Add ${newAccount.name} account` : "Add account"}
            </Button>
            {accounts.some((a) => a.isActive) && !editing && (
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                Pick an existing one
              </Button>
            )}
          </div>
        )}

        {status === "duplicate" && item.similar && (
          <div className="sm:ml-12 flex flex-col gap-2 rounded-lg bg-warning-soft px-3 py-2.5 text-small text-warning-text">
            <p>
              Looks like this is already recorded: <span className="font-medium">{item.similar.description || "a transaction"}</span> ·{" "}
              <Amount value={item.similar.amount} currency={currency} /> · {item.similar.account} · {formatDate(item.similar.date, "short")}.
              {reported && item.includeBalance && " If it's the same one, the SMS is linked to it and sets the balance."}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => item.similar && actions.onAdd({ sameAs: item.similar.id })}>
                It&rsquo;s the same one
              </Button>
              <Button size="sm" variant="outline" onClick={() => actions.onAdd({ allowDuplicate: true })}>
                Add as new
              </Button>
            </div>
          </div>
        )}

        {status === "error" && item.error && <p className="sm:ml-12 rounded-lg bg-negative-soft px-3 py-2 text-small text-negative-text">{item.error}</p>}

        <div className="flex flex-wrap items-center gap-2 sm:pl-12">
          {pending && status !== "duplicate" && (
            <Button size="sm" onClick={() => actions.onAdd()}>
              Add
            </Button>
          )}
          {status === "saving" && (
            <Button size="sm" loading disabled>
              Adding
            </Button>
          )}
          {status === "ignored" && !balanceOnly && (
            <Button size="sm" variant="outline" onClick={() => actions.onChange({ status: "review" })}>
              Review anyway
            </Button>
          )}
          {pending && (
            <Button size="sm" variant="ghost" onClick={() => setEditing((v) => !v)} aria-expanded={editing}>
              <PencilIcon />
              {editing ? "Done editing" : "Edit"}
            </Button>
          )}
          {status === "added" && (
            <Button size="sm" variant="ghost" onClick={actions.onUndo}>
              <Undo2Icon />
              Undo
            </Button>
          )}
          {done && (
            <Button size="sm" variant="ghost" onClick={actions.onOpen}>
              <PencilIcon />
              Open
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setShowText((v) => !v)} aria-expanded={showText}>
            <ChevronDownIcon className={cn("transition-transform", showText && "rotate-180")} />
            Message
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={actions.onDismiss}
            aria-label="Remove from list"
            className="ml-auto text-text-tertiary"
            disabled={status === "saving"}
          >
            <XIcon />
          </Button>
        </div>

        <AnimatePresence initial={false}>
          {showText && (
            <motion.div
              key="text"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.18 }}
              className="sm:ml-12"
            >
              <div className="relative rounded-lg border border-border bg-surface-subtle p-3 pr-10">
                <p className="whitespace-pre-wrap break-words font-mono text-caption leading-relaxed text-text-secondary">{item.text}</p>
                <button
                  type="button"
                  onClick={() => void navigator.clipboard?.writeText(item.text).catch(() => undefined)}
                  className="absolute right-2 top-2 inline-flex size-7 items-center justify-center rounded-md text-text-tertiary hover:bg-surface-muted hover:text-text"
                  aria-label="Copy message"
                >
                  <CopyIcon className="size-3.5" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence initial={false}>
        {editing && pending && (
          <motion.div
            key="editor"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="border-t border-border bg-surface"
          >
            <div className="p-4 sm:p-5">
              <TransactionFields
                draft={draft}
                update={updateDraft}
                errors={item.fieldErrors}
                accounts={accounts.filter((a) => a.isActive)}
                withTime
              />
              {item.fee && item.includeFee && (
                <p className="mt-4 text-small text-text-tertiary">
                  The fee is recorded from the same account on the same date.
                  {item.fieldErrors["fee.categoryId"] && <span className="text-negative-text"> {item.fieldErrors["fee.categoryId"]}</span>}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  );
}

/** A message that only reports a balance: set the account's balance to it. */
function BalanceOnly({
  item,
  reported,
  olderThanKnown,
  onChange,
  onSave,
}: {
  item: SmsItem;
  reported: ReturnType<typeof reportedBalance>;
  olderThanKnown: boolean;
  onChange: SmsCardActions["onChange"];
  onSave: () => void;
}) {
  const { accounts } = useAppData();
  const format = useFormatMoney();
  const choices = accounts.filter((a) => a.isActive && a.type !== "CARD");
  if (!reported) {
    return (
      <div className="sm:ml-12 flex flex-wrap items-center gap-2 rounded-lg bg-surface-subtle px-3 py-2 text-small">
        <span className="text-text-secondary">Which account is this balance for?</span>
        <Select value={item.draft.accountId || undefined} onValueChange={(accountId) => onChange({ draft: { ...item.draft, accountId } })}>
          <SelectTrigger className="h-8 w-48" aria-label="Account for this balance">
            <SelectValue placeholder="Choose account" />
          </SelectTrigger>
          <SelectContent>
            {choices.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }
  const amount = format(reported.amount, { currency: reported.account.currency, decimals: "always" });
  if (item.balanceSaved) {
    return (
      <p className="sm:ml-12 flex items-center gap-1.5 text-small text-positive-text">
        <CheckCircle2Icon className="size-3.5 shrink-0" />
        {reported.account.name} balance set to {amount}
      </p>
    );
  }
  return (
    <div className="sm:ml-12 flex items-center justify-between gap-3 rounded-lg bg-surface-subtle px-3 py-2 text-small">
      <span className="flex min-w-0 flex-col">
        <span className="text-text-secondary">
          Set {reported.account.name} balance to <span className="font-medium text-text">{amount}</span>
        </span>
        <span className="text-caption text-text-tertiary">
          {olderThanKnown
            ? `It’s older than ${reported.account.name}’s latest balance, which stays current.`
            : `Replaces ${format(reported.account.balance, { currency: reported.account.currency, decimals: "always" })}, what Hisab shows now.`}
        </span>
      </span>
      <Button size="sm" onClick={onSave}>
        Set balance
      </Button>
    </div>
  );
}
