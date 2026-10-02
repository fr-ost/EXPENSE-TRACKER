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
  /** False keeps it in reports without moving the account balance. */
  affectsBalance: boolean;
  /** The account was picked by hand (or the entry exists): changing the type keeps it. */
  accountChosen: boolean;
}

/** The currency each kind of entry usually comes in (null: the main currency). */
export interface CurrencyPreferences {
  baseCurrency: string;
  incomeCurrency: string | null;
  expenseCurrency: string | null;
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

export function preferredCurrency(type: EntryType, preferences: CurrencyPreferences | undefined): string | null {
  if (!preferences) return null;
  if (type === "INCOME") return preferences.incomeCurrency ?? preferences.baseCurrency;
  if (type === "EXPENSE") return preferences.expenseCurrency ?? preferences.baseCurrency;
  return null;
}

/**
 * The account a new entry starts on: the one last used for its type if it is
 * in the currency that type usually comes in (income in dollars, spending in
 * taka…), else the first account in that currency — cash first — else the
 * last used, cash, or first account.
 */
export function defaultAccountId(type: EntryType, active: AccountSummary[], currency: string | null): string {
  const remembered = active.find((a) => a.id === recalledAccount(type));
  const fallback = remembered?.id ?? active.find((a) => a.type === "CASH")?.id ?? active[0]?.id ?? "";
  if (!currency) return fallback;
  if (remembered?.currency === currency) return remembered.id;
  const inCurrency = active.filter((a) => a.currency === currency);
  return inCurrency.find((a) => a.type === "CASH")?.id ?? inCurrency[0]?.id ?? fallback;
}

export function newDraft(
  defaults: DraftDefaults,
  accounts: AccountSummary[],
  today: ISODate,
  preferences?: CurrencyPreferences,
): TransactionDraft {
  const type = defaults.type ?? "EXPENSE";
  const active = accounts.filter((a) => a.isActive);
  const accountId = defaults.accountId ?? defaultAccountId(type, active, preferredCurrency(type, preferences));
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
    affectsBalance: true,
    accountChosen: !!defaults.accountId,
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
    affectsBalance: tx.affectsBalance,
    accountChosen: true,
  };
}

/** Shape the draft into the API input for its type (validated by the shared schema). */
export function draftToInput(draft: TransactionDraft, needsToAmount: boolean) {
  const common = {
    amount: draft.amount,
    date: draft.date,
    time: draft.time || null,
    affectsBalance: draft.affectsBalance,
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
