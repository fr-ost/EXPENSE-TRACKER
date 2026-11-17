/**
 * The backup file: everything one person has recorded, as JSON.
 *
 * A file is read back as untrusted input — it may be old, edited by hand, or
 * made up. This schema checks every row on its own (the same rules the
 * database's CHECK constraints enforce); `restoreBackup` then checks how rows
 * refer to each other. Rows are linked by the ids in the file only: a restore
 * gives every row a new id, so a file can be restored into any account and
 * can never point at anything outside itself.
 */
import { z } from "zod";
import { isValidISODate } from "./dates";
import {
  ACCOUNT_TYPES,
  AUTO_LOCK_OPTIONS,
  CATEGORY_KINDS,
  CHECKPOINT_SOURCES,
  EXPENSE_SCOPES,
  FREQUENCIES,
  NUMBER_FORMATS,
  TRANSACTION_TYPES,
  isIconKey,
  isPaletteKey,
} from "./domain";
import { MAX_MINOR, isRate, normalizeMoney, normalizeRate, toMinor } from "./money";

export const BACKUP_FORMAT = "hisab-backup";
/** Bump when the shape changes; older versions are upgraded when read. */
export const BACKUP_VERSION = 1;

/** A file larger than this isn't a backup of one person's ledger (about 80,000 transactions). */
export const BACKUP_MAX_BYTES = 32 * 1024 * 1024;

const LIMITS = { accounts: 500, categories: 1_000, recurring: 1_000, transactions: 250_000, balanceUpdates: 100_000, budgets: 2_000, exchangeRates: 200 };

// ---------------------------------------------------------------------------
// Field types
// ---------------------------------------------------------------------------

const id = z.string().min(1).max(64);
const date = z.string().refine(isValidISODate, "is not a valid date");
/** A moment, as `Date.toISOString()` writes it. */
const instant = z.iso.datetime().transform((value) => new Date(value));
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "is not a time like 14:30");
const timeWithSeconds = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/, "is not a time like 14:30:05");
const currency = z.string().regex(/^[A-Z]{3}$/, "is not a currency code");
const scope = z.enum(EXPENSE_SCOPES);

function minorOf(value: string): bigint | null {
  return /^-?\d{1,12}(\.\d{0,2})?$/.test(value) ? toMinor(value) : null;
}
const inRange = (minor: bigint | null) => minor !== null && minor <= MAX_MINOR && minor >= -MAX_MINOR;

/** A signed amount with at most two decimals (NUMERIC(14,2)), as "1234.50". */
const money = z
  .string()
  .refine((value) => inRange(minorOf(value)), "is not an amount")
  .transform((value) => normalizeMoney(value));
const sign = (value: string) => (value.startsWith("-") ? -1 : /[1-9]/.test(value) ? 1 : 0);

const text = (max: number) => z.string().max(max);
const optional = <T extends z.ZodType>(schema: T) => schema.nullish().transform((value) => value ?? null);

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

const settings = z.object({
  displayName: text(60),
  baseCurrency: currency,
  timezone: text(64),
  numberFormat: z.enum(NUMBER_FORMATS),
  autoLockMinutes: z.number().int().transform((value) => ((AUTO_LOCK_OPTIONS as readonly number[]).includes(value) ? value : 15)),
  incomeCurrency: optional(currency),
  expenseCurrency: optional(currency),
});

const account = z.object({
  id,
  name: text(60).refine((value) => value.trim().length > 0, "is empty"),
  type: z.enum(ACCOUNT_TYPES),
  currency,
  openingBalance: money,
  openingDate: date,
  isActive: z.boolean(),
  // An icon or colour this version doesn't know is simply not shown.
  icon: optional(text(32)).transform((value) => (isIconKey(value) ? value : null)),
  color: optional(text(16)).transform((value) => (isPaletteKey(value) ? value : null)),
  sortOrder: z.number().int(),
  createdAt: instant,
  /** What the account held on the day of the backup — to check a restore against, never restored itself. */
  balance: optional(money),
});

const category = z
  .object({
    id,
    name: text(40).refine((value) => value.trim().length > 0, "is empty"),
    kind: z.enum(CATEGORY_KINDS),
    defaultScope: optional(scope),
    icon: text(32).transform((value) => (isIconKey(value) ? value : "circle-dashed")),
    color: text(16).transform((value) => (isPaletteKey(value) ? value : "gray")),
    isArchived: z.boolean(),
    sortOrder: z.number().int(),
    createdAt: instant,
  })
  .superRefine((row, ctx) => {
    if ((row.kind === "EXPENSE") !== (row.defaultScope !== null)) {
      ctx.addIssue({ code: "custom", path: ["defaultScope"], message: "must be set for expense categories only" });
    }
  });

/** The rules shared by transactions and the recurring rules that post them. */
function checkEntry(
  row: { type: string; amount: string; toAccountId: string | null; accountId: string; toAmount: string | null; countAsExpense: boolean; categoryId: string | null; scope: string | null },
  ctx: z.RefinementCtx,
) {
  const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
  const transfer = row.type === "TRANSFER";
  const spending = row.type === "EXPENSE" || (transfer && row.countAsExpense);

  if (row.type === "ADJUSTMENT" ? sign(row.amount) === 0 : sign(row.amount) <= 0) {
    issue("amount", row.type === "ADJUSTMENT" ? "can't be zero" : "must be greater than zero");
  }
  if (transfer) {
    if (!row.toAccountId) issue("toAccountId", "is missing for a transfer");
    else if (row.toAccountId === row.accountId) issue("toAccountId", "is the account the transfer comes from");
  } else if (row.toAccountId || row.toAmount || row.countAsExpense) {
    issue("toAccountId", "only a transfer has a destination");
  }
  if (row.toAmount !== null && sign(row.toAmount) <= 0) issue("toAmount", "must be greater than zero");

  const needsCategory = row.type === "INCOME" || spending;
  if (needsCategory !== (row.categoryId !== null)) issue("categoryId", needsCategory ? "is missing" : "doesn't belong on this entry");
  if (spending !== (row.scope !== null)) issue("scope", spending ? "is missing" : "doesn't belong on this entry");
}

const transaction = z
  .object({
    type: z.enum(TRANSACTION_TYPES),
    amount: money,
    date,
    time: optional(time),
    loggedTime: optional(timeWithSeconds),
    accountId: id,
    toAccountId: optional(id),
    toAmount: optional(money),
    categoryId: optional(id),
    countAsExpense: z.boolean(),
    scope: optional(scope),
    description: text(140),
    notes: optional(text(2000)),
    recurringId: optional(id),
    occurrenceDate: optional(date),
    affectsBalance: z.boolean(),
    idempotencyKey: optional(text(64).min(1)),
    createdAt: instant,
  })
  .superRefine((row, ctx) => {
    checkEntry(row, ctx);
    if (row.loggedTime !== null && row.time !== null) ctx.addIssue({ code: "custom", path: ["loggedTime"], message: "can't be set together with a time" });
    if (row.type === "ADJUSTMENT" && !row.affectsBalance) ctx.addIssue({ code: "custom", path: ["affectsBalance"], message: "an adjustment always counts in the balance" });
  });

const recurring = z
  .object({
    id,
    type: z.enum(["INCOME", "EXPENSE", "TRANSFER"]),
    amount: money,
    accountId: id,
    toAccountId: optional(id),
    toAmount: optional(money),
    categoryId: optional(id),
    countAsExpense: z.boolean(),
    scope: optional(scope),
    description: text(140),
    notes: optional(text(2000)),
    frequency: z.enum(FREQUENCIES),
    startDate: date,
    endDate: optional(date),
    occurrenceIndex: z.number().int().min(0).max(1_000_000),
    nextOccurrence: optional(date),
    isActive: z.boolean(),
    createdAt: instant,
  })
  .superRefine((row, ctx) => {
    checkEntry(row, ctx);
    if (row.endDate !== null && row.endDate < row.startDate) ctx.addIssue({ code: "custom", path: ["endDate"], message: "is before the start date" });
  });

const balanceUpdate = z
  .object({
    accountId: id,
    date,
    time: optional(time),
    loggedTime: optional(timeWithSeconds),
    balance: money,
    source: z.enum(CHECKPOINT_SOURCES),
    note: optional(text(500)),
    smsKey: optional(text(64).min(1)),
    messageDate: optional(date),
    messageTime: optional(time),
    createdAt: instant,
  })
  .superRefine((row, ctx) => {
    if (row.loggedTime !== null && row.time !== null) ctx.addIssue({ code: "custom", path: ["loggedTime"], message: "can't be set together with a time" });
    if (row.source === "SMS" ? row.messageDate === null : row.messageDate !== null || row.messageTime !== null) {
      ctx.addIssue({ code: "custom", path: ["messageDate"], message: "must be set for a balance read from an SMS, and only then" });
    }
  });

const budget = z.object({
  scope,
  effectiveFrom: date.refine((value) => value.endsWith("-01"), "is not the first day of a month"),
  amount: money.refine((value) => sign(value) >= 0, "can't be negative"),
});

const exchangeRate = z
  .object({
    base: currency,
    currency,
    rate: z.string().refine(isRate, "is not a rate above 0").transform(normalizeRate),
  })
  .refine((row) => row.base !== row.currency, { path: ["currency"], message: "is the same as the main currency" });

const rows = <T extends z.ZodType>(schema: T, max: number) =>
  z.array(schema, "is missing").max(max, `has more than ${max.toLocaleString("en-US")} entries`);

export const backupFile = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.number().int().min(1),
  /** When it was made. */
  exportedAt: z.iso.datetime(),
  /** "Today" for the person it belongs to, then: account balances are as of the end of this date. */
  asOf: date,
  app: z.object({ version: text(64) }).optional(),
  settings,
  accounts: rows(account, LIMITS.accounts),
  categories: rows(category, LIMITS.categories),
  recurring: rows(recurring, LIMITS.recurring),
  transactions: rows(transaction, LIMITS.transactions),
  balanceUpdates: rows(balanceUpdate, LIMITS.balanceUpdates),
  budgets: rows(budget, LIMITS.budgets),
  exchangeRates: rows(exchangeRate, LIMITS.exchangeRates),
});

/** A backup as read (dates parsed, amounts normalised). */
export type Backup = z.infer<typeof backupFile>;
/** A backup as written to a file. */
export type BackupFile = z.input<typeof backupFile>;

/** What a backup holds, for showing before and after a restore. */
export interface BackupSummary {
  exportedAt: string;
  accounts: number;
  categories: number;
  transactions: number;
  balanceUpdates: number;
  budgets: number;
  exchangeRates: number;
  recurring: number;
}

/** The file's sections, as one entry of each is called. */
/** A backup kept in the person's Google Drive. */
export interface DriveBackupFile {
  id: string;
  /** When it reached Drive (ISO). */
  createdAt: string;
  /** Bytes, as stored (compressed). */
  size: number;
  /** What it holds, when the file says. */
  summary: BackupSummary | null;
}

/** Where backups to Google Drive stand for one person. */
export interface DriveStatus {
  /** Google sign-in is set up, so Drive can be offered at all. */
  available: boolean;
  connected: boolean;
  /** When a backup last reached Drive (ISO). */
  lastBackupAt: string | null;
  /** When Hisab last looked for something new to back up (ISO). */
  lastCheckedAt: string | null;
  /** Google has withdrawn the permission: Drive must be connected again. */
  needsReconnect: boolean;
  /** Why the last backup didn't work, in words. */
  problem: string | null;
}

/** How many backups are kept in Drive; older ones are removed as new ones arrive. */
export const DRIVE_BACKUPS_KEPT = 10;

/** What a restore did. */
export interface RestoreResult extends BackupSummary {
  /**
   * Accounts whose balance after the restore isn't the one the backup
   * recorded for that day. Empty for a backup restored as it was made.
   */
  balanceDifferences: Array<{ account: string; currency: string; inBackup: string; restored: string }>;
}

/** "5 accounts, 1,240 transactions, 3 balance updates" — the parts that say how much there is. */
export function describeContents(summary: BackupSummary): string {
  const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
  const parts = [count(summary.accounts, "account"), count(summary.transactions, "transaction")];
  if (summary.balanceUpdates) parts.push(count(summary.balanceUpdates, "balance update"));
  if (summary.recurring) parts.push(count(summary.recurring, "recurring transaction"));
  if (summary.budgets) parts.push(count(summary.budgets, "budget"));
  return parts.join(", ");
}

const NAMES: Record<string, string> = {
  accounts: "account",
  categories: "category",
  recurring: "recurring transaction",
  transactions: "transaction",
  balanceUpdates: "balance update",
  budgets: "budget",
  exchangeRates: "exchange rate",
};

/**
 * Where in the file, in words: "transaction 12: amount must be greater than
 * zero", "the list of accounts is missing", "settings: timezone is not valid".
 */
export function describeIssue(path: PropertyKey[], message: string): string {
  // The schema's own messages finish the sentence; the library's don't.
  const problem = /^[a-z]/.test(message) ? message : "is not valid";
  const [section, ...rest] = path.map(String);
  const name = NAMES[section];
  if (name && rest.length === 0) return `the list of ${name}s ${problem}`.replace("categorys", "categories");
  const numbered = name && /^\d+$/.test(rest[0] ?? "");
  const where = numbered ? `${name} ${Number(rest[0]) + 1}` : (section ?? "the file");
  const field = (numbered ? rest.slice(1) : rest).join(".");
  return field ? `${where}: ${field} ${problem}` : `${where} ${problem}`;
}

export type ParsedBackup = { ok: true; backup: Backup } | { ok: false; error: string };

/**
 * Read a backup file's contents. Says, in a sentence, why a file can't be
 * used — it isn't a Hisab backup, it is from a newer version, or which entry
 * in it is wrong.
 */
export function parseBackup(input: unknown): ParsedBackup {
  const header = z.object({ format: z.literal(BACKUP_FORMAT), version: z.number().int().min(1) }).safeParse(input);
  if (!header.success) return { ok: false, error: "This isn't a Hisab backup file." };
  if (header.data.version > BACKUP_VERSION) {
    return { ok: false, error: "This backup was made by a newer version of Hisab. Update Hisab, then restore it." };
  }
  const parsed = backupFile.safeParse(input);
  if (!parsed.success) {
    const [first] = parsed.error.issues;
    return { ok: false, error: `This backup can't be restored — ${describeIssue(first.path, first.message)}.` };
  }
  return { ok: true, backup: parsed.data };
}

export function summarizeBackup(
  backup: { exportedAt: string } & Record<"accounts" | "categories" | "transactions" | "balanceUpdates" | "budgets" | "exchangeRates" | "recurring", unknown[]>,
): BackupSummary {
  return {
    exportedAt: backup.exportedAt,
    accounts: backup.accounts.length,
    categories: backup.categories.length,
    transactions: backup.transactions.length,
    balanceUpdates: backup.balanceUpdates.length,
    budgets: backup.budgets.length,
    exchangeRates: backup.exchangeRates.length,
    recurring: backup.recurring.length,
  };
}
