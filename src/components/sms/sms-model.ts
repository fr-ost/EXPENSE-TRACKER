import { draftToInput, type TransactionDraft } from "@/components/transactions/transaction-draft";
import type { ISODate } from "@/lib/dates";
import type { Money } from "@/lib/money";
import { normalizeSmsText, parseSms, type ParsedSms } from "@/lib/sms/parse";
import type { AccountSummary, CategoryRef } from "@/lib/types";
import { expenseInput, fieldErrorsOf, transactionInput, type TransactionInput } from "@/lib/validation";
import { suggestFromSms, type LearnedEntry } from "./sms-suggest";

export type SmsItemStatus =
  /** Needs a look before adding (see `issues`). */
  | "review"
  /** Complete and confident. */
  | "ready"
  /** Not a transaction (OTP, advert, failed…); can still be reviewed. */
  | "ignored"
  | "saving"
  | "added"
  /** Added earlier (same message). */
  | "exists"
  /** Something similar is already recorded; add anyway or skip. */
  | "duplicate"
  | "error";

export interface SimilarTransaction {
  id: string;
  description: string;
  date: ISODate;
  amount: Money;
  account: string;
}

export interface SmsItem {
  id: string;
  text: string;
  parsed: ParsedSms;
  draft: TransactionDraft;
  fee: TransactionDraft | null;
  includeFee: boolean;
  /** Set the account's balance to the one the message reports (see `reportedBalance`). */
  includeBalance: boolean;
  issues: string[];
  status: SmsItemStatus;
  /** Transactions created from this message (main first, then the fee). */
  addedIds: string[];
  similar?: SimilarTransaction;
  error?: string;
  fieldErrors: Record<string, string>;
}

export interface CheckResult {
  existing: string[];
  learned: LearnedEntry | null;
}

/** crypto.randomUUID only exists on secure origins (HTTPS or localhost). */
const localId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** Same message, regardless of spacing or case. */
export const messageKey = (text: string) => normalizeSmsText(text).toLowerCase().replace(/\s+/g, " ");

export function buildItem(
  text: string,
  ctx: {
    accounts: AccountSummary[];
    categories: CategoryRef[];
    today: ISODate;
    remembered: Record<string, string>;
    check?: CheckResult;
  },
): SmsItem {
  const parsed = parseSms(text, { today: ctx.today });
  const suggestion = suggestFromSms(parsed, { ...ctx, learned: ctx.check?.learned ?? null });
  const existing = ctx.check?.existing ?? [];
  return {
    id: localId(),
    text: text.trim(),
    parsed,
    draft: suggestion.draft,
    fee: suggestion.fee,
    includeFee: true,
    includeBalance: true,
    issues: suggestion.issues,
    status: existing.length ? "exists" : parsed.ignored ? "ignored" : suggestion.ready ? "ready" : "review",
    addedIds: existing,
    fieldErrors: {},
  };
}

function needsToAmount(draft: TransactionDraft, accounts: AccountSummary[]): boolean {
  if (draft.type !== "TRANSFER") return false;
  const from = accounts.find((a) => a.id === draft.accountId);
  const to = accounts.find((a) => a.id === draft.toAccountId);
  return !!from && !!to && from.currency !== to.currency;
}

/** The account the message is about (money into it for a credit transfer, out of it otherwise). */
export function ownAccountId(item: Pick<SmsItem, "draft" | "parsed">): string {
  return item.draft.type === "TRANSFER" && item.parsed.direction === "credit" ? item.draft.toAccountId : item.draft.accountId;
}

/**
 * The balance a message would set for its own account, or null when it
 * shouldn't: no balance in it, a different currency, or a card (card SMS
 * report limits and amounts due, not what the card holds).
 */
export function reportedBalance(
  item: Pick<SmsItem, "draft" | "parsed">,
  accounts: AccountSummary[],
  today: ISODate,
): { account: AccountSummary; amount: Money } | null {
  const { balance, balanceCurrency } = item.parsed;
  const account = accounts.find((a) => a.id === ownAccountId(item));
  if (!balance || !account || account.type === "CARD" || item.draft.date > today) return null;
  if (balanceCurrency && balanceCurrency !== account.currency) return null;
  return { account, amount: balance };
}

/** The API payload for an item, or the field errors that stop it. */
export function itemPayload(
  item: SmsItem,
  accounts: AccountSummary[],
  today: ISODate,
):
  | { ok: true; transaction: TransactionInput; fee: TransactionInput | null; balance: { accountId: string; amount: Money } | null }
  | { ok: false; fieldErrors: Record<string, string> } {
  const main = transactionInput.safeParse(draftToInput(item.draft, needsToAmount(item.draft, accounts)));
  if (!main.success) return { ok: false, fieldErrors: fieldErrorsOf(main.error) };
  const reported = item.includeBalance ? reportedBalance(item, accounts, today) : null;
  const balance = reported ? { accountId: reported.account.id, amount: reported.amount } : null;
  if (!item.fee || !item.includeFee || !item.fee.amount) return { ok: true, transaction: main.data, fee: null, balance };
  // The fee comes out of the message's own account, on the same date, whatever was edited above.
  const fee = expenseInput.safeParse(
    draftToInput({ ...item.fee, accountId: ownAccountId(item), date: item.draft.date, time: item.draft.time }, false),
  );
  if (!fee.success) {
    const errors = fieldErrorsOf(fee.error);
    return { ok: false, fieldErrors: Object.fromEntries(Object.entries(errors).map(([key, message]) => [`fee.${key}`, message])) };
  }
  return { ok: true, transaction: main.data, fee: fee.data, balance };
}

export const PENDING_STATUSES: SmsItemStatus[] = ["ready", "review", "duplicate", "error"];
