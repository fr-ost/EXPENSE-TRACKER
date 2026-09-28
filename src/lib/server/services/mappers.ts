import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { fromDbDate } from "@/lib/dates";
import { normalizeMoney, type Money } from "@/lib/money";
import type { AccountRef, CategoryRef, TransactionView } from "@/lib/types";

/** Prisma Decimal (or the ::text of a NUMERIC) → canonical money string. */
export function money(value: { toFixed(digits: number): string } | string | null | undefined): Money {
  if (value === null || value === undefined) return "0.00";
  return normalizeMoney(typeof value === "string" ? value : value.toFixed(2));
}

export function moneyOrNull(value: { toFixed(digits: number): string } | null | undefined): Money | null {
  return value === null || value === undefined ? null : money(value);
}

export const accountRefSelect = {
  id: true,
  name: true,
  type: true,
  currency: true,
  icon: true,
  color: true,
  isActive: true,
} satisfies Prisma.AccountSelect;

export const categoryRefSelect = {
  id: true,
  name: true,
  kind: true,
  icon: true,
  color: true,
  defaultScope: true,
  isArchived: true,
} satisfies Prisma.CategorySelect;

export const transactionInclude = {
  account: { select: accountRefSelect },
  toAccount: { select: accountRefSelect },
  category: { select: categoryRefSelect },
} satisfies Prisma.TransactionInclude;

type TransactionWithRefs = Prisma.TransactionGetPayload<{ include: typeof transactionInclude }>;

export function toAccountRef(account: Prisma.AccountGetPayload<{ select: typeof accountRefSelect }>): AccountRef {
  return { ...account };
}

export function toCategoryRef(category: Prisma.CategoryGetPayload<{ select: typeof categoryRefSelect }>): CategoryRef {
  return { ...category };
}

export function toTransactionView(row: TransactionWithRefs): TransactionView {
  return {
    id: row.id,
    type: row.type,
    amount: money(row.amount),
    toAmount: moneyOrNull(row.toAmount),
    date: fromDbDate(row.date),
    time: row.time,
    description: row.description,
    notes: row.notes,
    account: toAccountRef(row.account),
    toAccount: row.toAccount ? toAccountRef(row.toAccount) : null,
    category: row.category ? toCategoryRef(row.category) : null,
    countAsExpense: row.countAsExpense,
    scope: row.scope,
    recurringId: row.recurringId,
    affectsBalance: row.affectsBalance,
    fromSms: row.idempotencyKey?.startsWith("sms:") ?? false,
    createdAt: row.createdAt.toISOString(),
  };
}

/** True when a Prisma error is a unique violation on the given field. */
export function isUniqueViolation(error: unknown, field?: string): boolean {
  if (!(error && typeof error === "object" && "code" in error && error.code === "P2002")) return false;
  if (!field) return true;
  const meta = (error as { meta?: { target?: unknown; driverAdapterError?: unknown } }).meta;
  return JSON.stringify(meta ?? {}).includes(field);
}
