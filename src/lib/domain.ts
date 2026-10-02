/**
 * Domain vocabulary shared by client and server. Kept free of Prisma imports
 * so client components can use it.
 */

export const APP_NAME = "Hisab";

/** The owner's name, used in the greeting until changed in Settings. */
export const OWNER_NAME = "Shahriar Ahmed";

export const TRANSACTION_TYPES = ["INCOME", "EXPENSE", "TRANSFER", "ADJUSTMENT"] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

/** Types a user can create directly (adjustments are older balance corrections). */
export const ENTRY_TYPES = ["EXPENSE", "INCOME", "TRANSFER"] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  INCOME: "Income",
  EXPENSE: "Expense",
  TRANSFER: "Transfer",
  ADJUSTMENT: "Adjustment",
};

export const ACCOUNT_TYPES = ["CASH", "BANK", "MOBILE_WALLET", "CARD", "EXCHANGE", "OTHER"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_TYPE_META: Record<AccountType, { label: string; icon: IconKey; hint: string }> = {
  CASH: { label: "Cash", icon: "banknote", hint: "Wallet, drawer, petty cash" },
  BANK: { label: "Bank", icon: "landmark", hint: "Savings or current account" },
  MOBILE_WALLET: { label: "Mobile wallet", icon: "smartphone", hint: "bKash, Nagad, Rocket…" },
  CARD: { label: "Card", icon: "credit-card", hint: "Credit or debit card" },
  EXCHANGE: { label: "Exchange", icon: "arrow-left-right", hint: "Currency or crypto exchange" },
  OTHER: { label: "Other", icon: "wallet", hint: "Anything else" },
};

/** Who spending was for. Each has its own monthly budget. */
export const EXPENSE_SCOPES = ["PERSONAL", "FAMILY"] as const;
export type ExpenseScope = (typeof EXPENSE_SCOPES)[number];

export const SCOPE_META: Record<ExpenseScope, { label: string; description: string; color: PaletteKey }> = {
  PERSONAL: { label: "Personal", description: "Spending on yourself", color: "violet" },
  FAMILY: { label: "Family", description: "Spending for your family or household", color: "terracotta" },
};

export const CATEGORY_KINDS = ["EXPENSE", "INCOME"] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];

export const FREQUENCIES = ["WEEKLY", "MONTHLY", "YEARLY"] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  WEEKLY: "Weekly",
  MONTHLY: "Monthly",
  YEARLY: "Yearly",
};

/** Where a balance update came from. */
export const CHECKPOINT_SOURCES = ["MANUAL", "SMS"] as const;
export type CheckpointSource = (typeof CHECKPOINT_SOURCES)[number];

export const NUMBER_FORMATS = ["SOUTH_ASIAN", "INTERNATIONAL"] as const;
export type NumberFormat = (typeof NUMBER_FORMATS)[number];

export const NUMBER_FORMAT_LABELS: Record<NumberFormat, string> = {
  SOUTH_ASIAN: "1,00,000 (lakh / crore)",
  INTERNATIONAL: "100,000 (thousand / million)",
};

/** Currencies with two minor-unit digits (matches NUMERIC(14,2)). */
export const CURRENCIES = [
  { code: "BDT", name: "Bangladeshi taka" },
  { code: "USD", name: "US dollar" },
  { code: "EUR", name: "Euro" },
  { code: "GBP", name: "British pound" },
  { code: "INR", name: "Indian rupee" },
  { code: "PKR", name: "Pakistani rupee" },
  { code: "AED", name: "UAE dirham" },
  { code: "SAR", name: "Saudi riyal" },
  { code: "MYR", name: "Malaysian ringgit" },
  { code: "SGD", name: "Singapore dollar" },
  { code: "CAD", name: "Canadian dollar" },
  { code: "AUD", name: "Australian dollar" },
] as const;
export const CURRENCY_CODES = CURRENCIES.map((c) => c.code) as unknown as readonly [string, ...string[]];

/**
 * Curated category/account palette. Stored by key so the design system owns
 * the actual colour values (see globals.css `--palette-*`).
 */
export const PALETTE_KEYS = [
  "terracotta",
  "orange",
  "amber",
  "lime",
  "green",
  "teal",
  "cyan",
  "blue",
  "indigo",
  "violet",
  "plum",
  "rose",
  "brown",
  "slate",
  "gray",
] as const;
export type PaletteKey = (typeof PALETTE_KEYS)[number];

export function isPaletteKey(value: string | null | undefined): value is PaletteKey {
  return !!value && (PALETTE_KEYS as readonly string[]).includes(value);
}

/** Icon keys stored in the database; mapped to components in components/icon.tsx. */
export const ICON_KEYS = [
  "users",
  "user",
  "baby",
  "utensils",
  "coffee",
  "shopping-cart",
  "bus",
  "car",
  "fuel",
  "plane",
  "house",
  "lightbulb",
  "wifi",
  "phone",
  "receipt",
  "graduation-cap",
  "book-open",
  "heart-pulse",
  "pill",
  "shopping-bag",
  "shirt",
  "repeat",
  "laptop",
  "clapperboard",
  "gamepad",
  "dumbbell",
  "gift",
  "hand-heart",
  "paw-print",
  "wrench",
  "circle-dashed",
  "briefcase",
  "store",
  "pen-tool",
  "trending-up",
  "piggy-bank",
  "coins",
  "banknote",
  "landmark",
  "smartphone",
  "credit-card",
  "arrow-left-right",
  "wallet",
  "vault",
  "scale",
] as const;
export type IconKey = (typeof ICON_KEYS)[number];

export function isIconKey(value: string | null | undefined): value is IconKey {
  return !!value && (ICON_KEYS as readonly string[]).includes(value);
}

export const AUTO_LOCK_OPTIONS = [0, 1, 5, 10, 15, 30, 60] as const;

/**
 * Expense recognition — the TypeScript twin of the "ExpenseEntry" SQL view.
 * A transaction is spending when it is an expense, or a transfer the user
 * explicitly flagged "count as expense". Plain transfers never are.
 */
export function isRecognizedExpense(type: TransactionType, countAsExpense: boolean): boolean {
  return type === "EXPENSE" || (type === "TRANSFER" && countAsExpense);
}
