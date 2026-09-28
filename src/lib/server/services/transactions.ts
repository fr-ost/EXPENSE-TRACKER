import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { addYears, formatDate, monthEnd, monthStart, toDbDate, type ISODate } from "@/lib/dates";
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
  openingDate: string;
  type: AccountType;
}

async function lockAccount(tx: Tx, id: string, field: string): Promise<LockedAccount> {
  // FOR SHARE: blocks a concurrent account edit (e.g. moving the opening date)
  // until this write commits, without serialising other transaction inserts.
  const [account] = await tx.$queryRaw<LockedAccount[]>`
    SELECT "id", "name", "currency", "isActive", "type"::text AS "type",
           to_char("openingDate", 'YYYY-MM-DD') AS "openingDate"
    FROM "Account" WHERE "id" = ${id} FOR SHARE`;
  if (!account) throw invalid("Choose an account.", { [field]: "This account no longer exists." });
  return account;
}

function assertUsable(account: LockedAccount, field: string, date: ISODate, previousId?: string | null) {
  if (!account.isActive && account.id !== previousId) {
    throw invalid("That account is inactive.", {
      [field]: `${account.name} is inactive. Reactivate it to record new transactions.`,
    });
  }
  if (date < account.openingDate) {
    throw invalid("The date is before the account was opened.", {
      date: `${account.name} starts on ${formatDate(account.openingDate)}. To record earlier history, move its opening date back first.`,
    });
  }
}

export interface ExistingEntry {
  accountId: string;
  toAccountId: string | null;
  categoryId: string | null;
  time?: string | null;
}

/**
 * Turn validated input into a row, enforcing every rule that needs the
 * database: accounts exist and are usable, the date is not before an
 * account's opening date, categories match the transaction kind, and
 * cross-currency transfers state the amount received.
 */
export async function resolveEntry(
  tx: Tx,
  input: TransactionInput,
  today: ISODate,
  existing?: ExistingEntry,
): Promise<Prisma.TransactionUncheckedCreateInput> {
  if (input.date > addYears(today, 1)) {
    throw invalid("That date is too far ahead.", {
      date: "Dates more than a year ahead aren't allowed. Use a recurring transaction for future payments.",
    });
  }

  const account = await lockAccount(tx, input.accountId, "accountId");
  assertUsable(account, "accountId", input.date, existing?.accountId);

  const base = {
    amount: input.amount,
    date: toDbDate(input.date),
    time: input.time === undefined ? (existing?.time ?? null) : input.time,
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
      assertUsable(destination, "toAccountId", input.date, existing?.toAccountId);

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
  options: { today: ISODate; idempotencyKey?: string },
): Promise<{ id: string; created: boolean }> {
  const { today, idempotencyKey } = options;
  if (idempotencyKey) {
    const existing = await prisma.transaction.findUnique({ where: { idempotencyKey }, select: { id: true } });
    if (existing) return { id: existing.id, created: false };
  }
  try {
    const row = await prisma.$transaction(async (tx) => {
      const data = await resolveEntry(tx, input, today);
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

export async function updateTransaction(id: string, input: TransactionInput, today: ISODate) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.transaction.findUnique({
      where: { id },
      select: { type: true, accountId: true, toAccountId: true, categoryId: true, time: true },
    });
    if (!existing) throw notFound("Transaction");
    if (existing.type === "ADJUSTMENT") {
      throw invalid("Adjustments can't be edited. Delete it and reconcile the account again.");
    }
    const data = await resolveEntry(tx, input, today, existing);
    return tx.transaction.update({ where: { id }, data, select: { id: true } });
  });
}

export async function deleteTransaction(id: string) {
  const result = await prisma.transaction.deleteMany({ where: { id } });
  if (result.count === 0) throw notFound("Transaction");
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
  const page = filters.page ?? 1;

  const [total, rows, groups] = await Promise.all([
    prisma.transaction.count({ where }),
    prisma.transaction.findMany({
      where,
      include: transactionInclude,
      orderBy: transactionOrderBy(filters.sort),
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.transaction.groupBy({
      by: ["type", "countAsExpense"],
      where: { AND: [where, { account: { currency: baseCurrency } }] },
      _sum: { amount: true },
    }),
  ]);

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
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
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
