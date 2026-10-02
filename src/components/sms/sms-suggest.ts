/**
 * Turns a parsed SMS into an editable transaction draft for your accounts and
 * categories: which account it is about, whether it is an expense, income or
 * a transfer (an ATM withdrawal moves money to your Cash account, it isn't
 * spending), the category, and any fee as its own expense.
 */
import type { TransactionDraft } from "@/components/transactions/transaction-draft";
import { addDays, type ISODate } from "@/lib/dates";
import type { AccountType, EntryType, ExpenseScope } from "@/lib/domain";
import { toMinor, type Money } from "@/lib/money";
import { FEE_CATEGORY_HINTS, type ParsedSms } from "@/lib/sms/parse";
import type { Provider } from "@/lib/sms/providers";
import type { AccountSummary, CategoryRef } from "@/lib/types";

/** How the same description was recorded last time (from the server). */
export interface LearnedEntry {
  type: EntryType;
  accountId: string;
  toAccountId: string | null;
  categoryId: string | null;
  scope: ExpenseScope | null;
  countAsExpense: boolean;
}

export interface SuggestContext {
  accounts: AccountSummary[];
  categories: CategoryRef[];
  today: ISODate;
  /** Accounts you picked before for a bank or wallet (see rememberAccountFor). */
  remembered: Record<string, string>;
  learned?: LearnedEntry | null;
}

export interface SmsSuggestion {
  draft: TransactionDraft;
  fee: TransactionDraft | null;
  /** Things to check before adding; empty when the suggestion is complete. */
  issues: string[];
  /** Confident enough to add without review. */
  ready: boolean;
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

const compact = (value: string) => value.toLowerCase().replace(/[^a-z0-9ঀ-৿]+/g, "");

export function nameMatches(account: AccountSummary, provider: Provider): boolean {
  const name = compact(account.name);
  return provider.aliases.some((alias) => name.includes(compact(alias)));
}

function digitsMatch(account: AccountSummary, digits: string): boolean {
  return account.name.split(/\D+/).some((group) => group.length >= digits.length && group.endsWith(digits));
}

/** Key for remembering which account a bank or wallet's messages belong to. */
export function rememberKey(parsed: Pick<ParsedSms, "provider" | "accountDigits">): string | null {
  if (!parsed.provider && !parsed.accountDigits) return null;
  return `${parsed.provider?.id ?? "?"}:${parsed.accountDigits ?? ""}`;
}

const REMEMBER_STORAGE = "hisab:sms-accounts";

export function loadRememberedAccounts(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(REMEMBER_STORAGE) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

/** Remember the account chosen for this bank/wallet (only ids are stored, never message text). */
export function rememberAccountFor(parsed: Pick<ParsedSms, "provider" | "accountDigits">, accountId: string) {
  const key = rememberKey(parsed);
  if (!key) return;
  try {
    const stored = loadRememberedAccounts();
    stored[key] = accountId;
    if (parsed.provider) stored[`${parsed.provider.id}:`] = accountId;
    localStorage.setItem(REMEMBER_STORAGE, JSON.stringify(stored));
  } catch {
    // Storage unavailable (private mode): suggestions just won't learn.
  }
}

function likelyKind(parsed: ParsedSms): AccountType | null {
  if (parsed.provider) return parsed.provider.kind;
  if (["cash_out", "cash_in", "send_money", "recharge", "add_money"].includes(parsed.channel)) return "MOBILE_WALLET";
  if (parsed.isCard) return "CARD";
  if (parsed.accountDigits) return "BANK";
  return null;
}

function matchOwnAccount(parsed: ParsedSms, active: AccountSummary[], remembered: Record<string, string>) {
  const { provider, accountDigits } = parsed;
  if (accountDigits) {
    const byDigits = active.filter((a) => digitsMatch(a, accountDigits));
    if (byDigits.length === 1) return { account: byDigits[0], how: "matched" as const };
    const both = provider ? byDigits.filter((a) => nameMatches(a, provider)) : [];
    if (both.length === 1) return { account: both[0], how: "matched" as const };
  }
  const key = rememberKey(parsed);
  const rememberedId = (key && remembered[key]) || (provider && remembered[`${provider.id}:`]);
  const rememberedAccount = rememberedId ? active.find((a) => a.id === rememberedId) : undefined;
  if (rememberedAccount) return { account: rememberedAccount, how: "matched" as const };

  if (provider) {
    const byName = active.filter((a) => nameMatches(a, provider));
    const sameKind = byName.filter((a) => a.type === provider.kind || (parsed.isCard && a.type === "CARD"));
    if (byName.length === 1) return { account: byName[0], how: "matched" as const };
    if (sameKind.length === 1) return { account: sameKind[0], how: "matched" as const };
    // A bank or wallet you don't have an account for: don't guess another one.
    return null;
  }
  const kind = likelyKind(parsed);
  const ofKind = kind ? active.filter((a) => a.type === kind) : [];
  if (ofKind.length === 1) return { account: ofKind[0], how: "guessed" as const };
  return null;
}

function cashAccount(active: AccountSummary[], excludeId?: string): AccountSummary | undefined {
  const cash = active.filter((a) => a.type === "CASH" && a.id !== excludeId);
  return cash.find((a) => /cash|wallet|pocket|hand|নগদ টাকা/i.test(a.name)) ?? cash[0];
}

function matchOtherAccount(parsed: ParsedSms, active: AccountSummary[], ownId?: string): AccountSummary | undefined {
  const others = active.filter((a) => a.id !== ownId);
  if (parsed.counterpartyDigits) {
    const byDigits = others.filter((a) => digitsMatch(a, parsed.counterpartyDigits!));
    if (byDigits.length === 1) return byDigits[0];
  }
  if (parsed.otherProvider) {
    const byName = others.filter((a) => nameMatches(a, parsed.otherProvider!));
    if (byName.length === 1) return byName[0];
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export function pickCategory(hints: string[], kind: CategoryRef["kind"], categories: CategoryRef[]): CategoryRef | undefined {
  const usable = categories.filter((c) => c.kind === kind && !c.isArchived);
  for (const hint of hints) {
    const match = usable.find((c) => c.name.toLowerCase() === hint.toLowerCase());
    if (match) return match;
  }
  return usable.find((c) => c.name.toLowerCase() === "other") ?? usable[0];
}

const FEE_LABELS: Partial<Record<ParsedSms["channel"], string>> = {
  cash_out: "Cash out fee",
  send_money: "Send money fee",
  atm: "ATM fee",
  transfer: "Transfer fee",
  bill: "Bill payment fee",
  payment: "Payment fee",
};

// ---------------------------------------------------------------------------
// Suggestion
// ---------------------------------------------------------------------------

export function suggestFromSms(parsed: ParsedSms, ctx: SuggestContext): SmsSuggestion {
  const { categories, today, learned } = ctx;
  const active = ctx.accounts.filter((a) => a.isActive);
  const isActive = (id: string | null | undefined): id is string => !!id && active.some((a) => a.id === id);
  const credit = parsed.direction === "credit";

  const own = matchOwnAccount(parsed, active, ctx.remembered);
  const cash = cashAccount(active, own?.account.id);
  const other = matchOtherAccount(parsed, active, own?.account.id);

  // 1. The shape the message implies: expense or income, or a transfer
  //    between two of your own accounts (money you still have isn't spending).
  let type: EntryType = credit ? "INCOME" : "EXPENSE";
  let counterpart: AccountSummary | undefined;
  let counterpartHint = "";
  switch (parsed.channel) {
    case "atm":
    case "cash_out":
      if (!credit) {
        type = "TRANSFER";
        counterpart = cash;
        counterpartHint = "Add a Cash account (or pick one) to record this withdrawal as a transfer.";
      }
      break;
    case "cash_in":
      if (credit) {
        type = "TRANSFER";
        counterpart = cash;
        counterpartHint = "Choose where the cash came from.";
      }
      break;
    case "add_money":
      if (credit) {
        type = "TRANSFER";
        counterpart = other;
        counterpartHint = `Choose the account the money came from${parsed.otherProvider ? ` (${parsed.otherProvider.name})` : ""}.`;
      }
      break;
    case "transfer":
      if (other) {
        type = "TRANSFER";
        counterpart = other;
      }
      break;
    default:
      // e.g. a bank alert for money sent to your own bKash.
      if (!credit && other && parsed.otherProvider?.kind === "MOBILE_WALLET") {
        type = "TRANSFER";
        counterpart = other;
      }
  }
  let ownId = own?.account.id ?? "";
  let counterpartId = counterpart?.id ?? "";
  let categoryId = "";
  let scope: ExpenseScope | null = null;
  let countAsExpense = false;

  // 2. Repeat how you recorded the same description before, when it points
  //    the same way (money out stays money out).
  if (learned && (credit ? learned.type !== "EXPENSE" : learned.type !== "INCOME")) {
    const learnedOwn = learned.type === "TRANSFER" && credit ? learned.toAccountId : learned.accountId;
    const learnedCounterpart = learned.type === "TRANSFER" ? (credit ? learned.accountId : learned.toAccountId) : null;
    if (!ownId && isActive(learnedOwn)) ownId = learnedOwn;
    type = learned.type;
    if (type === "TRANSFER" && !counterpartId && isActive(learnedCounterpart) && learnedCounterpart !== ownId) {
      counterpartId = learnedCounterpart;
    }
    if (categories.some((c) => c.id === learned.categoryId && !c.isArchived)) {
      categoryId = learned.categoryId ?? "";
      scope = learned.scope;
      countAsExpense = type === "TRANSFER" && learned.countAsExpense;
    }
  }
  if (!categoryId && type !== "TRANSFER") {
    const category = pickCategory(parsed.categoryHints, type === "INCOME" ? "INCOME" : "EXPENSE", categories);
    categoryId = category?.id ?? "";
    scope = category?.defaultScope ?? null;
  }

  const accountId = type === "TRANSFER" && credit ? counterpartId : ownId;
  const toAccountId = type === "TRANSFER" ? (credit ? ownId : counterpartId) : "";

  // 3. What to check before adding.
  const issues: string[] = [];
  const ownAccount = active.find((a) => a.id === ownId);
  if (!ownAccount) issues.push(parsed.provider ? `Choose the account for ${parsed.provider.name}.` : "Choose the account.");
  else if (parsed.currency && ownAccount.currency !== parsed.currency) {
    issues.push(`The message is in ${parsed.currency}; ${ownAccount.name} uses ${ownAccount.currency}. Enter the amount in ${ownAccount.currency}.`);
  }
  if (own?.how === "guessed" && ownId === own.account.id) issues.push(`Check the account — ${own.account.name} is a guess.`);
  if (type === "TRANSFER" && !counterpartId) {
    issues.push(counterpartHint || (credit ? "Choose the account the money came from." : "Choose the account the money went to."));
  }
  if (!parsed.amount) issues.push("Enter the amount.");
  if (!parsed.direction) issues.push("Couldn't tell whether money came in or went out.");
  if (!parsed.date) issues.push("No date in the message — using today.");
  const date = parsed.date ?? today;
  if (date > addDays(today, 1)) issues.push("The date is in the future.");

  const draft: TransactionDraft = {
    type,
    amount: parsed.amount?.replace(/\.00$/, "") ?? "",
    accountId,
    toAccountId,
    toAmount: "",
    expenseCategoryId: type === "INCOME" ? "" : categoryId,
    incomeCategoryId: type === "INCOME" ? categoryId : "",
    scope: scope ?? categories.find((c) => c.id === categoryId)?.defaultScope ?? "PERSONAL",
    countAsExpense,
    date,
    time: parsed.time ?? "",
    description: parsed.description,
    notes: parsed.text.slice(0, 2000),
    affectsBalance: true,
    // The message says which account it is.
    accountChosen: true,
  };

  let fee: TransactionDraft | null = null;
  if (parsed.fee) {
    const feeCategory = pickCategory(FEE_CATEGORY_HINTS, "EXPENSE", categories);
    fee = {
      ...draft,
      type: "EXPENSE",
      amount: parsed.fee.replace(/\.00$/, ""),
      accountId: ownId,
      toAccountId: "",
      expenseCategoryId: feeCategory?.id ?? "",
      incomeCategoryId: "",
      scope: feeCategory?.defaultScope ?? "PERSONAL",
      countAsExpense: false,
      description: FEE_LABELS[parsed.channel] ?? `${parsed.provider?.name ?? "Bank"} fee`,
    };
  }

  const ready = !parsed.ignored && issues.length === 0 && parsed.confidence === "high";
  return { draft, fee, issues, ready };
}

/**
 * How an entry changes the balance of the message's own account (the amount,
 * plus or minus, and any fee), or null while the draft is incomplete.
 */
export function ownEffect(
  parsed: ParsedSms,
  draft: TransactionDraft,
  fee: TransactionDraft | null,
): { accountId: string; delta: bigint } | null {
  try {
    const incoming = draft.type === "INCOME" || (draft.type === "TRANSFER" && parsed.direction === "credit");
    const accountId = draft.type === "TRANSFER" && incoming ? draft.toAccountId : draft.accountId;
    if (!accountId || !draft.amount) return null;
    const received = draft.type === "TRANSFER" && incoming && draft.toAmount ? draft.toAmount : draft.amount;
    let delta = incoming ? toMinor(received) : -toMinor(draft.amount);
    if (fee?.amount) delta -= toMinor(fee.amount);
    return { accountId, delta };
  } catch {
    return null;
  }
}

export interface BalanceCheck {
  account: AccountSummary;
  /** What Hisab shows once every pending message for this account is added. */
  expected: Money;
  reported: Money;
  matches: boolean;
  /** Some messages for this account are still waiting to be added. */
  afterPending: boolean;
}
