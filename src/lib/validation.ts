/**
 * Input schemas shared by forms (client) and route handlers (server). The
 * server always re-validates; client validation is only for fast feedback.
 */
import { z } from "zod";
import { isValidISODate, isValidMonthKey } from "./dates";
import {
  ACCOUNT_TYPES,
  AUTO_LOCK_OPTIONS,
  CATEGORY_KINDS,
  CURRENCY_CODES,
  ENTRY_TYPES,
  EXPENSE_SCOPES,
  FREQUENCIES,
  ICON_KEYS,
  NUMBER_FORMATS,
  PALETTE_KEYS,
  TRANSACTION_TYPES,
} from "./domain";
import { MAX_MINOR, toMinor } from "./money";

const AMOUNT_INPUT = /^\d{1,12}(\.\d{1,2})?$/;
const SIGNED_AMOUNT_INPUT = /^-?\d{1,12}(\.\d{1,2})?$/;

/** A strictly positive amount with at most two decimals. */
export const positiveAmount = z
  .string({ error: "Enter an amount" })
  .trim()
  .min(1, "Enter an amount")
  .regex(AMOUNT_INPUT, "Use numbers only, with up to 2 decimals")
  .refine((v) => toMinor(v) > 0n, "Amount must be greater than zero")
  .refine((v) => toMinor(v) <= MAX_MINOR, "Amount is too large");

/** Zero or positive amount (e.g. budgets, where 0 removes the budget). */
export const nonNegativeAmount = z
  .string({ error: "Enter an amount" })
  .trim()
  .min(1, "Enter an amount")
  .regex(AMOUNT_INPUT, "Use numbers only, with up to 2 decimals")
  .refine((v) => toMinor(v) <= MAX_MINOR, "Amount is too large");

/** Signed amount (opening balances can be negative, e.g. a credit card). */
export const signedAmount = z
  .string({ error: "Enter an amount" })
  .trim()
  .min(1, "Enter an amount")
  .regex(SIGNED_AMOUNT_INPUT, "Use numbers only, with up to 2 decimals")
  .refine((v) => {
    const minor = toMinor(v);
    return minor <= MAX_MINOR && minor >= -MAX_MINOR;
  }, "Amount is too large");

export const isoDate = z
  .string({ error: "Choose a date" })
  .refine(isValidISODate, "Choose a valid date");

export const monthKey = z.string().refine(isValidMonthKey, "Choose a valid month");

export const id = z.string().trim().min(1).max(64);

const description = z.string().trim().max(140, "Keep it under 140 characters").default("");
const notes = z
  .string()
  .trim()
  .max(2000, "Keep notes under 2000 characters")
  .nullish()
  .transform((v) => (v ? v : null));

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

const baseEntry = {
  amount: positiveAmount,
  date: isoDate,
  description,
  notes,
};

export const expenseInput = z.object({
  type: z.literal("EXPENSE"),
  ...baseEntry,
  accountId: id,
  categoryId: id,
  scope: z.enum(EXPENSE_SCOPES),
});

export const incomeInput = z.object({
  type: z.literal("INCOME"),
  ...baseEntry,
  accountId: id,
  categoryId: id,
});

export const transferInput = z
  .object({
    type: z.literal("TRANSFER"),
    ...baseEntry,
    accountId: id,
    toAccountId: id,
    /** Required only when the two accounts use different currencies. */
    toAmount: positiveAmount.nullish().transform((v) => v ?? null),
    countAsExpense: z.boolean().default(false),
    categoryId: id.nullish().transform((v) => v ?? null),
    scope: z
      .enum(EXPENSE_SCOPES)
      .nullish()
      .transform((v) => v ?? null),
  })
  .superRefine((value, ctx) => {
    if (value.accountId === value.toAccountId) {
      ctx.addIssue({ code: "custom", path: ["toAccountId"], message: "Choose a different destination account" });
    }
    if (value.countAsExpense && !value.categoryId) {
      ctx.addIssue({ code: "custom", path: ["categoryId"], message: "Choose the expense category" });
    }
    if (value.countAsExpense && !value.scope) {
      ctx.addIssue({ code: "custom", path: ["scope"], message: "Choose a classification" });
    }
  });

export const transactionInput = z.discriminatedUnion("type", [expenseInput, incomeInput, transferInput]);
export type TransactionInput = z.infer<typeof transactionInput>;

export const createTransactionInput = z.object({
  idempotencyKey: z.string().trim().min(8).max(64).optional(),
  transaction: transactionInput,
});

// ---------------------------------------------------------------------------
// Transaction search
// ---------------------------------------------------------------------------

export const SORT_OPTIONS = ["newest", "oldest", "highest", "lowest"] as const;
export type SortOption = (typeof SORT_OPTIONS)[number];

export const PAGE_SIZE = 50;

/** Parsed from URL search params; unknown/invalid values are dropped, not rejected. */
export const transactionFilters = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  type: z.enum(TRANSACTION_TYPES).optional().catch(undefined),
  /** Special filter: only transfers flagged as expenses. */
  countedAsExpense: z
    .enum(["1"])
    .optional()
    .catch(undefined),
  accountId: id.optional().catch(undefined),
  categoryId: id.optional().catch(undefined),
  scope: z.enum(EXPENSE_SCOPES).optional().catch(undefined),
  month: monthKey.optional().catch(undefined),
  year: z.coerce.number().int().min(1900).max(2200).optional().catch(undefined),
  from: isoDate.optional().catch(undefined),
  to: isoDate.optional().catch(undefined),
  min: z
    .string()
    .refine((v) => AMOUNT_INPUT.test(v))
    .optional()
    .catch(undefined),
  max: z
    .string()
    .refine((v) => AMOUNT_INPUT.test(v))
    .optional()
    .catch(undefined),
  sort: z.enum(SORT_OPTIONS).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).optional().catch(undefined),
});
export type TransactionFilters = z.infer<typeof transactionFilters>;

export function parseTransactionFilters(params: Record<string, string | string[] | undefined> | URLSearchParams) {
  const entries: Record<string, string> = {};
  if (params instanceof URLSearchParams) {
    params.forEach((value, key) => {
      if (value !== "") entries[key] = value;
    });
  } else {
    for (const [key, value] of Object.entries(params)) {
      const v = Array.isArray(value) ? value[0] : value;
      if (v !== undefined && v !== "") entries[key] = v;
    }
  }
  return transactionFilters.parse(entries);
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export const accountInput = z.object({
  name: z.string().trim().min(1, "Give the account a name").max(60, "Keep it under 60 characters"),
  type: z.enum(ACCOUNT_TYPES),
  currency: z.enum(CURRENCY_CODES),
  openingBalance: signedAmount,
  openingDate: isoDate,
  icon: z.enum(ICON_KEYS).nullish().transform((v) => v ?? null),
  color: z.enum(PALETTE_KEYS).nullish().transform((v) => v ?? null),
  isActive: z.boolean().default(true),
});
export type AccountInput = z.infer<typeof accountInput>;

export const reconcileInput = z.object({
  countedBalance: signedAmount,
  date: isoDate,
  /** How to record a difference. */
  recordAs: z.enum(["ADJUSTMENT", "CATEGORY"]),
  categoryId: id.nullish().transform((v) => v ?? null),
  scope: z
    .enum(EXPENSE_SCOPES)
    .nullish()
    .transform((v) => v ?? null),
  note: z.string().trim().max(500).default(""),
});
export type ReconcileInput = z.infer<typeof reconcileInput>;

// ---------------------------------------------------------------------------
// Categories, budgets, recurring
// ---------------------------------------------------------------------------

export const categoryInput = z
  .object({
    name: z.string().trim().min(1, "Give the category a name").max(40, "Keep it under 40 characters"),
    kind: z.enum(CATEGORY_KINDS),
    defaultScope: z
      .enum(EXPENSE_SCOPES)
      .nullish()
      .transform((v) => v ?? null),
    icon: z.enum(ICON_KEYS),
    color: z.enum(PALETTE_KEYS),
    isArchived: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (value.kind === "EXPENSE" && !value.defaultScope) {
      ctx.addIssue({ code: "custom", path: ["defaultScope"], message: "Choose a default classification" });
    }
  })
  .transform((value) => ({ ...value, defaultScope: value.kind === "EXPENSE" ? value.defaultScope : null }));
export type CategoryInput = z.infer<typeof categoryInput>;

export const budgetInput = z.object({
  categoryId: id,
  month: monthKey,
  amount: nonNegativeAmount,
});

export const recurringInput = z
  .object({
    type: z.enum(ENTRY_TYPES),
    amount: positiveAmount,
    accountId: id,
    toAccountId: id.nullish().transform((v) => v ?? null),
    toAmount: positiveAmount.nullish().transform((v) => v ?? null),
    categoryId: id.nullish().transform((v) => v ?? null),
    countAsExpense: z.boolean().default(false),
    scope: z
      .enum(EXPENSE_SCOPES)
      .nullish()
      .transform((v) => v ?? null),
    description,
    notes,
    frequency: z.enum(FREQUENCIES),
    startDate: isoDate,
    endDate: isoDate.nullish().transform((v) => v ?? null),
    isActive: z.boolean().default(true),
  })
  .superRefine((value, ctx) => {
    if (value.type === "TRANSFER") {
      if (!value.toAccountId) ctx.addIssue({ code: "custom", path: ["toAccountId"], message: "Choose a destination account" });
      else if (value.toAccountId === value.accountId)
        ctx.addIssue({ code: "custom", path: ["toAccountId"], message: "Choose a different destination account" });
      if (value.countAsExpense && !value.categoryId)
        ctx.addIssue({ code: "custom", path: ["categoryId"], message: "Choose the expense category" });
    } else if (!value.categoryId) {
      ctx.addIssue({ code: "custom", path: ["categoryId"], message: "Choose a category" });
    }
    const expenseLike = value.type === "EXPENSE" || (value.type === "TRANSFER" && value.countAsExpense);
    if (expenseLike && !value.scope) ctx.addIssue({ code: "custom", path: ["scope"], message: "Choose a classification" });
    if (value.endDate && value.endDate < value.startDate)
      ctx.addIssue({ code: "custom", path: ["endDate"], message: "End date must be after the start date" });
  });
export type RecurringInput = z.infer<typeof recurringInput>;

// ---------------------------------------------------------------------------
// Auth & settings
// ---------------------------------------------------------------------------

export const passwordInput = z.object({
  password: z.string().min(1, "Enter your password").max(256),
});

export const changePasswordInput = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password").max(256),
    newPassword: z.string().min(12, "Use at least 12 characters").max(256),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { path: ["confirmPassword"], message: "Passwords don't match" });

export const settingsInput = z.object({
  displayName: z.string().trim().max(60),
  baseCurrency: z.enum(CURRENCY_CODES),
  timezone: z.string().trim().min(1).max(64),
  numberFormat: z.enum(NUMBER_FORMATS),
  autoLockMinutes: z.coerce
    .number()
    .int()
    .refine((v) => (AUTO_LOCK_OPTIONS as readonly number[]).includes(v), "Choose an option"),
});
export type SettingsInput = z.infer<typeof settingsInput>;

/** Flatten a ZodError into `{ field: firstMessage }` for forms. */
export function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    if (!(key in result)) result[key] = issue.message;
  }
  return result;
}

