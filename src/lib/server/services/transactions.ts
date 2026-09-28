import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { addYears, fromDbDate, monthEnd, monthStart, toDbDate, type Clock, type ISODate } from "@/lib/dates";
import { isRecognizedExpense, type AccountType, type ExpenseScope } from "@/lib/domain";
import { addMoney, isMoneyString, normalizeMoney } from "@/lib/money";
import type { TransactionPage, TransactionView } from "@/lib/types";
import { PAGE_SIZE, type TransactionFilters, type TransactionInput } from "@/lib/validation";
import { prisma, type Tx } from "../db";
import { invalid, notFound } from "../errors";
import { requireCategory } from "./categories";
import { isUniqueViolation, money, toTransactionView, transactionInclude } from "./mappers";

// ---------------------------------------------------------------------------
// Validation against the database — the single place entry rules live.
// ---------------------------------------------------------------------------

interface LockedAccount {
  id: string;
  name: string;
  currency: string;
  isActive: boolean;
  type: AccountType;
}

async function lockAccount(tx: Tx, id: string, field: string): Promise<LockedAccount> {
  // FOR SHARE: blocks a concurrent account edit or balance update until this
  // write commits, without serialising other transaction inserts.
  const [account] = await tx.$queryRaw<LockedAccount[]>`
    SELECT "id", "name", "currency", "isActive", "type"::text AS "type"
    FROM "Account" WHERE "id" = ${id} FOR SHARE`;
  if (!account) throw invalid("Choose an account.", { [field]: "This account no longer exists." });
  return account;
}

/**
 * Any date is fine: an entry dated before the account's opening balance (or
 * a balance update) is history — it shapes balances before that point but
 * never the balance after it.
 */
function assertUsable(account: LockedAccount, field: string, previousId?: string | null) {
  if (!account.isActive && account.id !== previousId) {
    throw invalid("That account is inactive.", {
      [field]: `${account.name} is inactive. Reactivate it to record new transactions.`,
    });
  }
}

export interface ExistingEntry {
  accountId: string;
  toAccountId: string | null;
  categoryId: string | null;
  date?: Date;
  time?: string | null;
  loggedTime?: string | null;
  affectsBalance?: boolean;
}

/**
 * An entry without a time that is recorded on its own date is placed at the
 * moment it was recorded, so a balance update made earlier that day still
 * sees it as coming after. Otherwise (no clock time, or another date) it
 * counts at the end of its day.
 */
export function loggedTimeFor(date: ISODate, time: string | null, clock: Clock): string | null {
  return !time && clock.time && date === clock.today ? clock.time : null;
}

/**
 * Turn validated input into a row, enforcing every rule that needs the
 * database: accounts exist and are usable, categories match the transaction
 * kind, and cross-currency transfers state the amount received.
 */
export async function resolveEntry(
  tx: Tx,
  input: TransactionInput,
  clock: Clock,
  existing?: ExistingEntry,
): Promise<Prisma.TransactionUncheckedCreateInput> {
  if (input.date > addYears(clock.today, 1)) {
    throw invalid("That date is too far ahead.", {
      date: "Dates more than a year ahead aren't allowed. Use a recurring transaction for future payments.",
    });
  }

  const account = await lockAccount(tx, input.accountId, "accountId");
  assertUsable(account, "accountId", existing?.accountId);

  const time = input.time === undefined ? (existing?.time ?? null) : input.time;
  // An edit that leaves the date and time alone keeps the entry where it was.
  const unmoved = !!existing?.date && fromDbDate(existing.date) === input.date && (existing.time ?? null) === time;
  const base = {
    amount: input.amount,
    date: toDbDate(input.date),
    time,
    loggedTime: time ? null : unmoved ? (existing?.loggedTime ?? null) : loggedTimeFor(input.date, time, clock),
    affectsBalance: input.affectsBalance ?? existing?.affectsBalance ?? true,
    description: input.description,
    notes: input.notes,
    accountId: account.id,
    toAccountId: null,
    toAmount: null,
    countAsExpense: false,
    categoryId: null as string | null,
    scope: null as ExpenseScope | null,
  };

  switch (input.type) {
    case "EXPENSE": {
      const category = await requireCategory(tx, input.categoryId, "EXPENSE", existing?.categoryId);
      return { ...base, type: "EXPENSE", categoryId: category.id, scope: input.scope };
    }
    case "INCOME": {
      const category = await requireCategory(tx, input.categoryId, "INCOME", existing?.categoryId);
      return { ...base, type: "INCOME", categoryId: category.id, scope: null };
    }
    case "TRANSFER": {
      if (input.toAccountId === input.accountId) {
        throw invalid("Choose two different accounts.", { toAccountId: "Choose a different destination account." });
      }
      const destination = await lockAccount(tx, input.toAccountId, "toAccountId");
      assertUsable(destination, "toAccountId", existing?.toAccountId);

      let toAmount: string | null = null;
      if (destination.currency !== account.currency) {
        if (!input.toAmount) {
          throw invalid("Enter the amount received.", {
            toAmount: `${destination.name} uses ${destination.currency}. Enter the amount it received.`,
          });
        }
        toAmount = input.toAmount;
      }

      if (input.countAsExpense) {
        if (!input.categoryId || !input.scope) {
          throw invalid("Choose how to classify this expense.", { categoryId: "Choose the expense category." });
        }
        const category = await requireCategory(tx, input.categoryId, "EXPENSE", existing?.categoryId);
        return {
          ...base,
          type: "TRANSFER",
          toAccountId: destination.id,
          toAmount,
          countAsExpense: true,
          categoryId: category.id,
          scope: input.scope,
        };
      }
      return { ...base, type: "TRANSFER", toAccountId: destination.id, toAmount, countAsExpense: false };
    }
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * Create a transaction. With an idempotency key, retries and double-clicks
 * return the original row instead of creating a duplicate.
 */
export async function createTransaction(
  input: TransactionInput,
  options: Clock & { idempotencyKey?: string },
): Promise<{ id: string; created: boolean }> {
  const { idempotencyKey } = options;
  if (idempotencyKey) {
    const existing = await prisma.transaction.findUnique({ where: { idempotencyKey }, select: { id: true } });
    if (existing) return { id: existing.id, created: false };
  }
  try {
    const row = await prisma.$transaction(async (tx) => {
      const data = await resolveEntry(tx, input, options);
      return tx.transaction.create({ data: { ...data, idempotencyKey: idempotencyKey ?? null }, select: { id: true } });
    });
    return { id: row.id, created: true };
  } catch (error) {
    if (idempotencyKey && isUniqueViolation(error, "idempotencyKey")) {
      const existing = await prisma.transaction.findUnique({ where: { idempotencyKey }, select: { id: true } });
      if (existing) return { id: existing.id, created: false };
    }
    throw error;
  }
}

export async function updateTransaction(id: string, input: TransactionInput, today: ISODate, time?: string | null) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.transaction.findUnique({
      where: { id },
      select: {
        type: true,
        accountId: true,
        toAccountId: true,
        categoryId: true,
        date: true,
        time: true,
        loggedTime: true,
        affectsBalance: true,
      },
    });
    if (!existing) throw notFound("Transaction");
    if (existing.type === "ADJUSTMENT") {
      throw invalid("Adjustments can't be edited. Delete it and update the account balance instead.");
    }
    const data = await resolveEntry(tx, input, { today, time }, existing);
    return tx.transaction.update({ where: { id }, data, select: { id: true } });
  });
}

/** A message's own transaction ("sms:<fingerprint>:0"), not its fee. */
const SMS_MAIN_KEY = /^sms:([0-9a-f]+):0$/;

export async function deleteTransaction(id: string) {
  await prisma.$transaction(async (tx) => {
    const row = await tx.transaction.findUnique({ where: { id }, select: { idempotencyKey: true } });
    const result = await tx.transaction.deleteMany({ where: { id } });
    if (!row || result.count === 0) throw notFound("Transaction");
    // A balance read from an SMS goes with the message's transaction (e.g. Undo after an import).
    const sms = row.idempotencyKey ? SMS_MAIN_KEY.exec(row.idempotencyKey) : null;
    if (sms) await tx.balanceCheckpoint.deleteMany({ where: { smsKey: `sms:${sms[1]}:b` } });
  });
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function getTransaction(id: string): Promise<TransactionView> {
  const row = await prisma.transaction.findUnique({ where: { id }, include: transactionInclude });
  if (!row) throw notFound("Transaction");
  return toTransactionView(row);
}

/** Translate URL filters into a Prisma where clause (also used by exports). */
export function buildTransactionWhere(filters: TransactionFilters): Prisma.TransactionWhereInput {
  const and: Prisma.TransactionWhereInput[] = [];

  if (filters.q) {
    const q = filters.q;
    const or: Prisma.TransactionWhereInput[] = [
      { description: { contains: q, mode: "insensitive" } },
      { notes: { contains: q, mode: "insensitive" } },
      { category: { name: { contains: q, mode: "insensitive" } } },
      { account: { name: { contains: q, mode: "insensitive" } } },
      { toAccount: { name: { contains: q, mode: "insensitive" } } },
    ];
    const numeric = q.replace(/[,\s৳]/g, "");
    if (isMoneyString(numeric) && !numeric.startsWith("-")) or.push({ amount: normalizeMoney(numeric) });
    and.push({ OR: or });
  }

  if (filters.countedAsExpense) and.push({ type: "TRANSFER", countAsExpense: true });
  else if (filters.type) and.push({ type: filters.type });

  if (filters.accountId) and.push({ OR: [{ accountId: filters.accountId }, { toAccountId: filters.accountId }] });
  if (filters.categoryId) and.push({ categoryId: filters.categoryId });
  if (filters.scope) and.push({ scope: filters.scope });

  if (filters.month) and.push({ date: { gte: toDbDate(monthStart(filters.month)), lte: toDbDate(monthEnd(filters.month)) } });
  if (filters.year) and.push({ date: { gte: toDbDate(`${filters.year}-01-01`), lte: toDbDate(`${filters.year}-12-31`) } });
  if (filters.from) and.push({ date: { gte: toDbDate(filters.from) } });
  if (filters.to) and.push({ date: { lte: toDbDate(filters.to) } });

  if (filters.min) and.push({ amount: { gte: filters.min } });
  if (filters.max) and.push({ amount: { lte: filters.max } });

  return and.length ? { AND: and } : {};
}

/** Newest first by default; within a day, entries with a time of day come in time order. */
export const NEWEST_FIRST: Prisma.TransactionOrderByWithRelationInput[] = [
  { date: "desc" },
  { time: { sort: "desc", nulls: "last" } },
  { createdAt: "desc" },
];

export function transactionOrderBy(sort: TransactionFilters["sort"]): Prisma.TransactionOrderByWithRelationInput[] {
  switch (sort) {
    case "oldest":
      return [{ date: "asc" }, { time: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }];
    case "highest":
      return [{ amount: "desc" }, ...NEWEST_FIRST];
    case "lowest":
      return [{ amount: "asc" }, ...NEWEST_FIRST];
    default:
      return NEWEST_FIRST;
  }
}

export async function listTransactions(filters: TransactionFilters, baseCurrency: string): Promise<TransactionPage> {
  const where = buildTransactionWhere(filters);
  const findPage = (page: number) =>
    prisma.transaction.findMany({
      where,
      include: transactionInclude,
      orderBy: transactionOrderBy(filters.sort),
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    });
  let page = filters.page ?? 1;

  const [total, firstRows, groups] = await Promise.all([
    prisma.transaction.count({ where }),
    findPage(page),
    prisma.transaction.groupBy({
      by: ["type", "countAsExpense"],
      where: { AND: [where, { account: { currency: baseCurrency } }] },
      _sum: { amount: true },
    }),
  ]);

  // A page past the end (an old link, or entries deleted since) shows the last page.
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  let rows = firstRows;
  if (page > pageCount) {
    page = pageCount;
    rows = await findPage(page);
  }

  let income = "0.00";
  let expenses = "0.00";
  let transfers = "0.00";
  for (const group of groups) {
    const sum = money(group._sum.amount);
    if (group.type === "INCOME") income = addMoney(income, sum);
    if (group.type === "TRANSFER" && !group.countAsExpense) transfers = addMoney(transfers, sum);
    if (isRecognizedExpense(group.type, group.countAsExpense)) expenses = addMoney(expenses, sum);
  }

  return {
    items: rows.map(toTransactionView),
    total,
    page,
    pageSize: PAGE_SIZE,
    pageCount,
    summary: { currency: baseCurrency, income, expenses, transfers },
  };
}

export async function recentTransactions(limit: number, today: ISODate): Promise<TransactionView[]> {
  const rows = await prisma.transaction.findMany({
    where: { date: { lte: toDbDate(today) } },
    include: transactionInclude,
    orderBy: NEWEST_FIRST,
    take: limit,
  });
  return rows.map(toTransactionView);
}
