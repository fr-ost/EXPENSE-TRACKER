"use client";

import { MessageSquareTextIcon, Trash2Icon, WalletIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { Amount, useAppData, useFormatMoney } from "@/components/app-data";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ResponsiveSheet } from "@/components/ui/sheet";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import { formatDate } from "@/lib/dates";
import { TRANSACTION_TYPE_LABELS } from "@/lib/domain";
import type { TransactionView } from "@/lib/types";
import { fieldErrorsOf, transactionInput } from "@/lib/validation";
import {
  draftFromTransaction,
  draftToInput,
  newDraft,
  rememberAccount,
  type DraftDefaults,
  type TransactionDraft,
} from "./transaction-draft";
import { TransactionFields } from "./transaction-form";

interface SheetApi {
  openCreate: (defaults?: DraftDefaults) => void;
  openEdit: (transaction: TransactionView) => void;
}

const SheetContext = React.createContext<SheetApi | null>(null);

export function useTransactionSheet(): SheetApi {
  const value = React.useContext(SheetContext);
  if (!value) throw new Error("useTransactionSheet must be used inside <TransactionSheetProvider>.");
  return value;
}

interface SheetState {
  open: boolean;
  /** Changes on every open so the form starts fresh (and gets a new idempotency key). */
  key: number;
  editing: TransactionView | null;
  defaults: DraftDefaults;
}

export function TransactionSheetProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<SheetState>({ open: false, key: 0, editing: null, defaults: {} });

  const api = React.useMemo<SheetApi>(
    () => ({
      openCreate: (defaults = {}) => setState((s) => ({ open: true, key: s.key + 1, editing: null, defaults })),
      openEdit: (editing) => setState((s) => ({ open: true, key: s.key + 1, editing, defaults: {} })),
    }),
    [],
  );

  const close = React.useCallback(() => setState((s) => ({ ...s, open: false })), []);

  return (
    <SheetContext.Provider value={api}>
      {children}
      <TransactionSheet key={state.key} state={state} onClose={close} />
    </SheetContext.Provider>
  );
}

function TransactionSheet({ state, onClose }: { state: SheetState; onClose: () => void }) {
  const router = useRouter();
  const { accounts, today } = useAppData();
  const format = useFormatMoney();
  const formId = React.useId();
  const editing = state.editing;

  const [draft, setDraft] = React.useState<TransactionDraft>(() =>
    editing ? draftFromTransaction(editing) : newDraft(state.defaults, accounts, today),
  );
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [pending, setPending] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  // One key per opened sheet: a double submit or network retry can't duplicate.
  const [idempotencyKey] = React.useState(() => crypto.randomUUID());

  // Offer active accounts, plus whichever inactive ones this transaction already uses.
  const usable = accounts.filter(
    (a) => a.isActive || a.id === editing?.account.id || a.id === editing?.toAccount?.id,
  );

  const update = React.useCallback((patch: Partial<TransactionDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setErrors((e) => {
      const next = { ...e };
      for (const key of Object.keys(patch)) {
        delete next[key];
        if (key.endsWith("CategoryId")) delete next.categoryId;
      }
      return next;
    });
  }, []);

  const source = accounts.find((a) => a.id === draft.accountId);
  const destination = accounts.find((a) => a.id === draft.toAccountId);
  const needsToAmount = draft.type === "TRANSFER" && !!source && !!destination && source.currency !== destination.currency;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    const parsed = transactionInput.safeParse(draftToInput(draft, needsToAmount));
    if (!parsed.success) {
      setErrors(fieldErrorsOf(parsed.error));
      return;
    }
    setPending(true);
    try {
      const label = TRANSACTION_TYPE_LABELS[draft.type];
      const amountText = format(parsed.data.amount, { currency: source?.currency });
      if (editing) {
        await api(`/api/transactions/${editing.id}`, { method: "PUT", body: parsed.data });
        toast.success(`${label} updated`, { description: amountText });
      } else {
        const result = await api<{ id: string }>("/api/transactions", {
          body: { transaction: parsed.data, idempotencyKey },
        });
        rememberAccount(draft.type, draft.accountId);
        toast.success(`${label} added`, {
          description: `${amountText} · ${formatDate(parsed.data.date, "short")}`,
          action: {
            label: "Undo",
            onClick: () => {
              void api(`/api/transactions/${result.id}`, { method: "DELETE" })
                .then(() => {
                  toast(`${label} removed`);
                  router.refresh();
                })
                .catch((error) => toast.error(errorMessage(error)));
            },
          },
        });
      }
      onClose();
      router.refresh();
    } catch (error) {
      // Re-enable only on failure: after success the sheet is closing and must not submit twice.
      setPending(false);
      if (error instanceof ApiClientError && Object.keys(error.fieldErrors).length) {
        setErrors(error.fieldErrors);
      }
      toast.error(errorMessage(error));
    }
  }

  async function remove() {
    if (!editing) return;
    setDeleting(true);
    try {
      await api(`/api/transactions/${editing.id}`, { method: "DELETE" });
      toast.success(`${TRANSACTION_TYPE_LABELS[editing.type]} deleted`);
      setConfirmDelete(false);
      onClose();
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setDeleting(false);
    }
  }

  const isAdjustment = editing?.type === "ADJUSTMENT";
  const noAccounts = usable.length === 0;
  const needsTwoAccounts = draft.type === "TRANSFER" && usable.length < 2;

  const submitLabel = editing ? "Save changes" : `Add ${TRANSACTION_TYPE_LABELS[draft.type].toLowerCase()}`;

  const footer =
    noAccounts || isAdjustment ? undefined : (
      <div className="flex items-center gap-2">
        {editing && (
          <Button variant="ghost" size="icon" onClick={() => setConfirmDelete(true)} aria-label="Delete transaction" className="text-negative-text hover:bg-negative-soft hover:text-negative-text">
            <Trash2Icon />
          </Button>
        )}
        <Button variant="secondary" onClick={onClose} className="hidden sm:inline-flex sm:ml-auto">
          Cancel
        </Button>
        <Button type="submit" form={formId} size="lg" loading={pending} disabled={needsTwoAccounts} className="flex-1 sm:h-10 sm:flex-none sm:rounded-md sm:px-5 sm:text-body">
          {submitLabel}
          {draft.amount && !editing && (
            <span className="font-normal text-white/60">· {format(draft.amount, { currency: source?.currency })}</span>
          )}
        </Button>
      </div>
    );

  return (
    <>
      <ResponsiveSheet
        open={state.open}
        onOpenChange={(open) => !open && onClose()}
        title={editing ? (isAdjustment ? "Balance adjustment" : "Edit transaction") : "New transaction"}
        footer={footer}
      >
        {noAccounts ? (
          <EmptyState
            compact
            icon={<WalletIcon />}
            title="Add an account first"
            description="Transactions are recorded against an account — cash, bank, bKash, a card."
            action={
              <Button asChild onClick={onClose}>
                <Link href="/accounts?new=1">Add account</Link>
              </Button>
            }
          />
        ) : isAdjustment && editing ? (
          <AdjustmentDetails transaction={editing} onDelete={() => setConfirmDelete(true)} />
        ) : (
          <form id={formId} onSubmit={submit} noValidate>
            {!editing && (
              <Link
                href="/sms"
                onClick={onClose}
                className="-mt-1 mb-4 flex items-center gap-2 rounded-lg bg-surface-subtle px-3 py-2 text-small text-text-secondary transition-colors hover:bg-surface-muted hover:text-text"
              >
                <MessageSquareTextIcon className="size-4 shrink-0 text-text-tertiary" />
                Have a bank or bKash SMS? <span className="font-medium text-accent-text">Paste it instead</span>
              </Link>
            )}
            <TransactionFields draft={draft} update={update} errors={errors} accounts={usable} autoFocusAmount={!editing} withTime />
            {needsTwoAccounts && (
              <p className="mt-4 text-small text-text-secondary">
                Transfers need two accounts.{" "}
                <Link href="/accounts?new=1" onClick={onClose} className="font-medium text-accent-text hover:underline">
                  Add another account
                </Link>
              </p>
            )}
          </form>
        )}
      </ResponsiveSheet>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this transaction?"
        description="Balances and reports will be recalculated without it. This can't be undone."
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onConfirm={remove}
      />
    </>
  );
}

function AdjustmentDetails({ transaction, onDelete }: { transaction: TransactionView; onDelete: () => void }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col items-center gap-1 py-2 text-center">
        <Amount value={transaction.amount} currency={transaction.account.currency} sign="always" tone="signed" className="text-[2.5rem] font-semibold tracking-[-0.03em]" />
        <p className="text-small text-text-secondary">
          {transaction.account.name} · {formatDate(transaction.date, "long")}
        </p>
      </div>
      {transaction.notes && <p className="rounded-lg bg-surface-muted p-4 text-body text-text-secondary">{transaction.notes}</p>}
      <p className="text-small text-text-tertiary">
        Adjustments come from reconciling an account and correct its balance without counting as income or spending.
        To change one, delete it and reconcile again.
      </p>
      <Button variant="danger-soft" onClick={onDelete}>
        <Trash2Icon />
        Delete adjustment
      </Button>
    </div>
  );
}
