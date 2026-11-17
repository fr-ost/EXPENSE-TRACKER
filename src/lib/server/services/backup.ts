import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { BACKUP_FORMAT, BACKUP_VERSION, parseBackup, summarizeBackup, type Backup, type BackupFile, type RestoreResult } from "@/lib/backup";
import { fromDbDate, isValidTimeZone, toDbDate, type ISODate } from "@/lib/dates";
import { normalizeRate, type Money } from "@/lib/money";
import { prisma, type Tx } from "../db";
import { invalid } from "../errors";
import type { UserId } from "../user-id";
import { appVersion } from "../version";
import { balanceAsOf } from "./accounts";
import { money, moneyOrNull } from "./mappers";
import { deleteUserData } from "./users";

/**
 * Backup and restore of one person's ledger.
 *
 * A backup is everything they have recorded, read in one consistent snapshot.
 * A restore replaces everything in their account with what a backup holds, in
 * one database transaction: it either happens completely or not at all.
 *
 * The app lock (PIN), who the person is (their Google account) and their
 * sign-ins are not part of a backup: a file can't change how to get in.
 */

/** Rows read or written per query. */
const BATCH = 2_000;

/** A big ledger takes a while; the default (5 s) is for ordinary requests. */
const LONG_TRANSACTION = { maxWait: 15_000, timeout: 5 * 60_000 } as const;

const dateOrNull = (value: Date | null) => (value ? fromDbDate(value) : null);

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

/** Everything the user has recorded, as the contents of a backup file. `today` is theirs. */
export async function exportBackup(userId: UserId, today: ISODate): Promise<BackupFile> {
  return prisma.$transaction(
    async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      const accounts = await tx.account.findMany({ where: { userId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
      const balances = new Map<string, Money>();
      for (const account of accounts) balances.set(account.id, await balanceAsOf(userId, account.id, today, tx));
      const categories = await tx.category.findMany({ where: { userId }, orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }] });
      const recurring = await tx.recurringTransaction.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
      const checkpoints = await tx.balanceCheckpoint.findMany({ where: { userId }, orderBy: [{ date: "asc" }, { createdAt: "asc" }] });
      const budgets = await tx.scopeBudget.findMany({ where: { userId }, orderBy: [{ scope: "asc" }, { effectiveFrom: "asc" }] });
      const rates = await tx.exchangeRate.findMany({ where: { userId }, orderBy: [{ base: "asc" }, { currency: "asc" }] });

      const transactions: BackupFile["transactions"] = [];
      for (let cursor: string | undefined; ; ) {
        const page = await tx.transaction.findMany({
          where: { userId },
          orderBy: { id: "asc" },
          take: BATCH,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        for (const t of page) {
          transactions.push({
            type: t.type,
            amount: money(t.amount),
            date: fromDbDate(t.date),
            time: t.time,
            loggedTime: t.loggedTime,
            accountId: t.accountId,
            toAccountId: t.toAccountId,
            toAmount: moneyOrNull(t.toAmount),
            categoryId: t.categoryId,
            countAsExpense: t.countAsExpense,
            scope: t.scope,
            description: t.description,
            notes: t.notes,
            recurringId: t.recurringId,
            occurrenceDate: dateOrNull(t.occurrenceDate),
            affectsBalance: t.affectsBalance,
            idempotencyKey: t.idempotencyKey,
            createdAt: t.createdAt.toISOString(),
          });
        }
        if (page.length < BATCH) break;
        cursor = page[page.length - 1].id;
      }

      return {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        asOf: today,
        app: { version: appVersion() },
        settings: {
          displayName: user.displayName,
          baseCurrency: user.baseCurrency,
          timezone: user.timezone,
          numberFormat: user.numberFormat,
          autoLockMinutes: user.autoLockMinutes,
          incomeCurrency: user.incomeCurrency,
          expenseCurrency: user.expenseCurrency,
        },
        accounts: accounts.map((a) => ({
          id: a.id,
          name: a.name,
          type: a.type,
          currency: a.currency,
          openingBalance: money(a.openingBalance),
          openingDate: fromDbDate(a.openingDate),
          isActive: a.isActive,
          icon: a.icon,
          color: a.color,
          sortOrder: a.sortOrder,
          createdAt: a.createdAt.toISOString(),
          balance: balances.get(a.id) ?? null,
        })),
        categories: categories.map((c) => ({
          id: c.id,
          name: c.name,
          kind: c.kind,
          defaultScope: c.defaultScope,
          icon: c.icon,
          color: c.color,
          isArchived: c.isArchived,
          sortOrder: c.sortOrder,
          createdAt: c.createdAt.toISOString(),
        })),
        recurring: recurring.map((r) => ({
          id: r.id,
          type: r.type as "INCOME" | "EXPENSE" | "TRANSFER",
          amount: money(r.amount),
          accountId: r.accountId,
          toAccountId: r.toAccountId,
          toAmount: moneyOrNull(r.toAmount),
          categoryId: r.categoryId,
          countAsExpense: r.countAsExpense,
          scope: r.scope,
          description: r.description,
          notes: r.notes,
          frequency: r.frequency,
          startDate: fromDbDate(r.startDate),
          endDate: dateOrNull(r.endDate),
          occurrenceIndex: r.occurrenceIndex,
          nextOccurrence: dateOrNull(r.nextOccurrence),
          isActive: r.isActive,
          createdAt: r.createdAt.toISOString(),
        })),
        transactions,
        balanceUpdates: checkpoints.map((c) => ({
          accountId: c.accountId,
          date: fromDbDate(c.date),
          time: c.time,
          loggedTime: c.loggedTime,
          balance: money(c.balance),
          source: c.source,
          note: c.note,
          smsKey: c.smsKey,
          messageDate: dateOrNull(c.messageDate),
          messageTime: c.messageTime,
          createdAt: c.createdAt.toISOString(),
        })),
        budgets: budgets.map((b) => ({ scope: b.scope, effectiveFrom: fromDbDate(b.effectiveFrom), amount: money(b.amount) })),
        exchangeRates: rates.map((r) => ({ base: r.base, currency: r.currency, rate: normalizeRate(r.rate.toFixed(6)) })),
      };
    },
    // One snapshot: nothing recorded while the backup is read is half in it.
    { ...LONG_TRANSACTION, isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

/** "hisab-backup-2026-11-17.json" */
export function backupFileName(today: ISODate): string {
  return `hisab-backup-${today}.json`;
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

/** Stop with a message that says where the file is wrong. */
function refuse(where: string, problem: string): never {
  throw invalid(`This backup can't be restored — ${where} ${problem}.`);
}

/** Entries of a list that share a key with an earlier entry. */
function firstDuplicate<T>(items: T[], key: (item: T) => string | null): number {
  const seen = new Set<string>();
  for (let i = 0; i < items.length; i++) {
    const k = key(items[i]);
    if (k === null) continue;
    if (seen.has(k)) return i;
    seen.add(k);
  }
  return -1;
}

/**
 * How the rows of a backup refer to each other: every account, category and
 * rule an entry names must be in the same file, and fit it. Returns the new
 * ids the rows will be stored under.
 */
function linkBackup(backup: Backup) {
  const { accounts, categories, recurring, transactions, balanceUpdates, budgets, exchangeRates } = backup;

  const duplicate = (label: string, index: number, what: string) => {
    if (index >= 0) refuse(`${label} ${index + 1}`, `repeats ${what}`);
  };
  duplicate("account", firstDuplicate(accounts, (a) => a.id), "an id used by an earlier account");
  duplicate("account", firstDuplicate(accounts, (a) => a.name.trim().toLowerCase()), "the name of an earlier account");
  duplicate("category", firstDuplicate(categories, (c) => c.id), "an id used by an earlier category");
  duplicate("category", firstDuplicate(categories, (c) => `${c.kind}:${c.name.trim().toLowerCase()}`), "the name of an earlier category");
  duplicate("recurring transaction", firstDuplicate(recurring, (r) => r.id), "an id used by an earlier one");
  duplicate("transaction", firstDuplicate(transactions, (t) => t.idempotencyKey), "the key of an earlier transaction");
  duplicate("transaction", firstDuplicate(transactions, (t) => (t.recurringId && t.occurrenceDate ? `${t.recurringId}:${t.occurrenceDate}` : null)), "an occurrence already posted");
  duplicate("balance update", firstDuplicate(balanceUpdates, (c) => c.smsKey), "the message of an earlier balance update");
  duplicate("budget", firstDuplicate(budgets, (b) => `${b.scope}:${b.effectiveFrom}`), "the month of an earlier budget");
  duplicate("exchange rate", firstDuplicate(exchangeRates, (r) => `${r.base}:${r.currency}`), "an earlier rate");

  // New ids for everything: nothing in a file decides where it is stored.
  const accountIds = new Map(accounts.map((a) => [a.id, randomUUID()]));
  const categoryIds = new Map(categories.map((c) => [c.id, randomUUID()]));
  const recurringIds = new Map(recurring.map((r) => [r.id, randomUUID()]));
  const currencyOf = new Map(accounts.map((a) => [a.id, a.currency]));
  const kindOf = new Map(categories.map((c) => [c.id, c.kind]));

  /** The checks every entry that moves money needs, whether posted or (`rule`) still to be. */
  const checkEntry = (
    label: string,
    entry: { type: string; accountId: string; toAccountId: string | null; toAmount: string | null; categoryId: string | null },
    rule = false,
  ) => {
    if (!accountIds.has(entry.accountId)) refuse(label, "is on an account that isn't in the backup");
    if (entry.toAccountId !== null) {
      if (!accountIds.has(entry.toAccountId)) refuse(label, "goes to an account that isn't in the backup");
      // The amount received is recorded exactly when the two accounts differ in currency
      // (a rule may carry one it doesn't need: it is dropped when the rule posts).
      const crossCurrency = currencyOf.get(entry.accountId) !== currencyOf.get(entry.toAccountId);
      if (crossCurrency && entry.toAmount === null) refuse(label, "moves money between currencies without the amount received");
      if (!crossCurrency && entry.toAmount !== null && !rule) refuse(label, "has an amount received, though both accounts use the same currency");
    }
    if (entry.categoryId !== null) {
      const kind = kindOf.get(entry.categoryId);
      if (!kind) refuse(label, "has a category that isn't in the backup");
      if (kind !== (entry.type === "INCOME" ? "INCOME" : "EXPENSE")) refuse(label, `has ${kind === "INCOME" ? "an income" : "an expense"} category`);
    }
  };

  recurring.forEach((rule, i) => checkEntry(`recurring transaction ${i + 1}`, rule, true));
  transactions.forEach((t, i) => {
    checkEntry(`transaction ${i + 1}`, t);
    if (t.recurringId !== null && !recurringIds.has(t.recurringId)) refuse(`transaction ${i + 1}`, "was posted by a recurring transaction that isn't in the backup");
  });
  balanceUpdates.forEach((c, i) => {
    if (!accountIds.has(c.accountId)) refuse(`balance update ${i + 1}`, "is for an account that isn't in the backup");
  });

  return { accountIds, categoryIds, recurringIds };
}

function isCheckViolation(error: unknown): boolean {
  return error instanceof Error && /23514|check constraint/i.test(`${error.message} ${JSON.stringify(error)}`);
}

async function insertInBatches<T>(rows: T[], insert: (batch: T[]) => Promise<unknown>) {
  for (let start = 0; start < rows.length; start += BATCH) await insert(rows.slice(start, start + BATCH));
}

/**
 * Replace everything the user has recorded with the contents of a backup.
 * `input` is the parsed JSON of a backup file — any backup file, from this
 * account or another, as old as you like, and not to be trusted.
 */
export async function restoreBackup(userId: UserId, input: unknown): Promise<RestoreResult> {
  const parsed = parseBackup(input);
  if (!parsed.ok) throw invalid(parsed.error);
  const backup = parsed.backup;
  const { accountIds, categoryIds, recurringIds } = linkBackup(backup);
  const accountId = (old: string) => accountIds.get(old)!;
  const categoryId = (old: string | null) => (old === null ? null : categoryIds.get(old)!);

  /** Everything out, everything from the backup in, then compare the balances. */
  const replace = async (tx: Tx): Promise<RestoreResult["balanceDifferences"]> => {
    await deleteUserData(tx, userId);

    const { settings } = backup;
    await tx.user.update({
      where: { id: userId },
      data: {
        displayName: settings.displayName.trim(),
        baseCurrency: settings.baseCurrency,
        numberFormat: settings.numberFormat,
        autoLockMinutes: settings.autoLockMinutes,
        incomeCurrency: settings.incomeCurrency,
        expenseCurrency: settings.expenseCurrency,
        // A timezone this server doesn't know would break "today": keep the current one.
        ...(isValidTimeZone(settings.timezone) ? { timezone: settings.timezone } : {}),
      },
      select: { id: true },
    });

    await tx.account.createMany({
      data: backup.accounts.map((a) => ({
        id: accountId(a.id),
        userId,
        name: a.name.trim(),
        type: a.type,
        currency: a.currency,
        openingBalance: a.openingBalance,
        openingDate: toDbDate(a.openingDate),
        isActive: a.isActive,
        icon: a.icon,
        color: a.color,
        sortOrder: a.sortOrder,
        createdAt: a.createdAt,
      })),
    });
    await tx.category.createMany({
      data: backup.categories.map((c) => ({
        id: categoryId(c.id)!,
        userId,
        name: c.name.trim(),
        kind: c.kind,
        defaultScope: c.defaultScope,
        icon: c.icon,
        color: c.color,
        isArchived: c.isArchived,
        sortOrder: c.sortOrder,
        createdAt: c.createdAt,
      })),
    });
    await tx.recurringTransaction.createMany({
      data: backup.recurring.map((r) => ({
        id: recurringIds.get(r.id)!,
        userId,
        type: r.type,
        amount: r.amount,
        accountId: accountId(r.accountId),
        toAccountId: r.toAccountId === null ? null : accountId(r.toAccountId),
        toAmount: r.toAmount,
        categoryId: categoryId(r.categoryId),
        countAsExpense: r.countAsExpense,
        scope: r.scope,
        description: r.description,
        notes: r.notes,
        frequency: r.frequency,
        startDate: toDbDate(r.startDate),
        endDate: r.endDate === null ? null : toDbDate(r.endDate),
        occurrenceIndex: r.occurrenceIndex,
        nextOccurrence: r.nextOccurrence === null ? null : toDbDate(r.nextOccurrence),
        isActive: r.isActive,
        createdAt: r.createdAt,
      })),
    });
    await insertInBatches(backup.transactions, (batch) =>
      tx.transaction.createMany({
        data: batch.map((t) => ({
          userId,
          type: t.type,
          amount: t.amount,
          date: toDbDate(t.date),
          time: t.time,
          loggedTime: t.loggedTime,
          accountId: accountId(t.accountId),
          toAccountId: t.toAccountId === null ? null : accountId(t.toAccountId),
          toAmount: t.toAmount,
          categoryId: categoryId(t.categoryId),
          countAsExpense: t.countAsExpense,
          scope: t.scope,
          description: t.description,
          notes: t.notes,
          recurringId: t.recurringId === null ? null : recurringIds.get(t.recurringId)!,
          occurrenceDate: t.occurrenceDate === null ? null : toDbDate(t.occurrenceDate),
          affectsBalance: t.affectsBalance,
          idempotencyKey: t.idempotencyKey,
          // Kept exactly: it decides the order of entries at the same moment.
          createdAt: t.createdAt,
        })),
      }),
    );
    await insertInBatches(backup.balanceUpdates, (batch) =>
      tx.balanceCheckpoint.createMany({
        data: batch.map((c) => ({
          userId,
          accountId: accountId(c.accountId),
          date: toDbDate(c.date),
          time: c.time,
          loggedTime: c.loggedTime,
          balance: c.balance,
          source: c.source,
          note: c.note,
          smsKey: c.smsKey,
          messageDate: c.messageDate === null ? null : toDbDate(c.messageDate),
          messageTime: c.messageTime,
          createdAt: c.createdAt,
        })),
      }),
    );
    await tx.scopeBudget.createMany({
      data: backup.budgets.map((b) => ({ userId, scope: b.scope, effectiveFrom: toDbDate(b.effectiveFrom), amount: b.amount })),
    });
    await tx.exchangeRate.createMany({
      data: backup.exchangeRates.map((r) => ({ userId, base: r.base, currency: r.currency, rate: r.rate })),
    });

    // The ledger derives every balance; a faithful restore derives the same ones.
    const balanceDifferences: RestoreResult["balanceDifferences"] = [];
    for (const account of backup.accounts) {
      if (account.balance === null) continue;
      const balance = await balanceAsOf(userId, accountId(account.id), backup.asOf, tx);
      if (balance !== account.balance) {
        balanceDifferences.push({ account: account.name, currency: account.currency, inBackup: account.balance, restored: balance });
      }
    }
    return balanceDifferences;
  };

  const balanceDifferences = await prisma.$transaction(replace, LONG_TRANSACTION).catch((error: unknown) => {
    // A rule of the database that the checks above don't spell out. The transaction is undone.
    if (error instanceof Prisma.PrismaClientKnownRequestError || isCheckViolation(error)) {
      console.warn("[backup] restore refused by the database", error);
      throw invalid("This backup can't be restored — it holds something Hisab can't store. Nothing was changed.");
    }
    throw error;
  });

  return { ...summarizeBackup(backup), balanceDifferences };
}
