import type { ISODate } from "@/lib/dates";
import type { EntryType, ExpenseScope } from "@/lib/domain";
import type { AccountSummary, CategoryRef, TransactionView } from "@/lib/types";

/** Editable form state. Categories are remembered per kind while switching type. */
export interface TransactionDraft {
  type: EntryType;
  amount: string;
  accountId: string;
  toAccountId: string;
  toAmount: string;
  expenseCategoryId: string;
  incomeCategoryId: string;
  scope: ExpenseScope;
  countAsExpense: boolean;
  date: ISODate;
  /** "HH:MM" or "" when not recorded. */
  time: string;
  description: string;
  notes: string;
}

export type DraftDefaults = Partial<Pick<TransactionDraft, "type" | "accountId" | "toAccountId" | "expenseCategoryId" | "incomeCategoryId" | "date">>;

const LAST_ACCOUNT_KEY = "hisab:last-account";

export function rememberAccount(type: EntryType, accountId: string) {
  try {
    const stored = JSON.parse(localStorage.getItem(LAST_ACCOUNT_KEY) ?? "{}") as Record<string, string>;
    localStorage.setItem(LAST_ACCOUNT_KEY, JSON.stringify({ ...stored, [type]: accountId }));
  } catch {
    // Storage unavailable (private mode); the default account is used instead.
  }
}

function recalledAccount(type: EntryType): string | undefined {
  try {
    return (JSON.parse(localStorage.getItem(LAST_ACCOUNT_KEY) ?? "{}") as Record<string, string>)[type];
  } catch {
    return undefined;
  }
}

export function newDraft(
  defaults: DraftDefaults,
  accounts: AccountSummary[],
  today: ISODate,
): TransactionDraft {
  const type = defaults.type ?? "EXPENSE";
  const active = accounts.filter((a) => a.isActive);
  const remembered = recalledAccount(type);
  const accountId =
    defaults.accountId ??
    active.find((a) => a.id === remembered)?.id ??
    active.find((a) => a.type === "CASH")?.id ??
    active[0]?.id ??
    "";
  const toAccountId = defaults.toAccountId ?? active.find((a) => a.id !== accountId)?.id ?? "";
  return {
    type,
    amount: "",
    accountId,
    toAccountId: type === "TRANSFER" ? toAccountId : "",
    toAmount: "",
    expenseCategoryId: defaults.expenseCategoryId ?? "",
    incomeCategoryId: defaults.incomeCategoryId ?? "",
    scope: "PERSONAL",
    countAsExpense: false,
    date: defaults.date ?? today,
    time: "",
    description: "",
    notes: "",
  };
}

export function draftFromTransaction(tx: TransactionView): TransactionDraft {
  const type: EntryType = tx.type === "ADJUSTMENT" ? "EXPENSE" : tx.type;
  const categoryId = tx.category?.id ?? "";
  return {
    type,
    amount: tx.amount.replace(/\.00$/, ""),
    accountId: tx.account.id,
    toAccountId: tx.toAccount?.id ?? "",
    toAmount: tx.toAmount?.replace(/\.00$/, "") ?? "",
    expenseCategoryId: tx.category?.kind === "EXPENSE" ? categoryId : "",
    incomeCategoryId: tx.category?.kind === "INCOME" ? categoryId : "",
    scope: tx.scope ?? "PERSONAL",
    countAsExpense: tx.countAsExpense,
    date: tx.date,
    time: tx.time ?? "",
    description: tx.description,
    notes: tx.notes ?? "",
  };
}

/** Shape the draft into the API input for its type (validated by the shared schema). */
export function draftToInput(draft: TransactionDraft, needsToAmount: boolean) {
  const common = {
    amount: draft.amount,
    date: draft.date,
    time: draft.time || null,
    description: draft.description,
    notes: draft.notes || null,
    accountId: draft.accountId,
  };
  switch (draft.type) {
    case "EXPENSE":
      return { ...common, type: "EXPENSE" as const, categoryId: draft.expenseCategoryId, scope: draft.scope };
    case "INCOME":
      return { ...common, type: "INCOME" as const, categoryId: draft.incomeCategoryId };
    case "TRANSFER":
      return {
        ...common,
        type: "TRANSFER" as const,
        toAccountId: draft.toAccountId,
        toAmount: needsToAmount ? draft.toAmount : null,
        countAsExpense: draft.countAsExpense,
        categoryId: draft.countAsExpense ? draft.expenseCategoryId : null,
        scope: draft.countAsExpense ? draft.scope : null,
      };
  }
}

export function selectableCategories(categories: CategoryRef[], kind: CategoryRef["kind"], currentId?: string) {
  return categories.filter((c) => c.kind === kind && (!c.isArchived || c.id === currentId));
}
