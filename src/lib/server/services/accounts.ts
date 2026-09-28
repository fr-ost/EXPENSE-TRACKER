import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { formatDate, toDbDate, type ISODate } from "@/lib/dates";
import type { AccountType } from "@/lib/domain";
import { fromMinor, normalizeMoney, toMinor, type Money } from "@/lib/money";
import type { AccountSummary } from "@/lib/types";
import type { AccountInput, ReconcileInput } from "@/lib/validation";
import { prisma, type Tx } from "../db";
import { conflict, invalid, notFound } from "../errors";
import { requireCategory } from "./categories";
import { money } from "./mappers";

interface AccountRow {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
  openingBalance: string;
  openingDate: string;
  isActive: boolean;
  icon: string | null;
  color: string | null;
  sortOrder: number;
  balance: string;
  inflow: string;
  outflow: string;
  transactionCount: number;
  lastActivity: string | null;
  scheduledNet: string;
}

/**
 * Accounts with balances derived from the ledger. Balance = opening balance +
 * every signed ledger movement dated on or before `asOf`. Nothing is cached.
 */
async function queryAccounts(asOf: ISODate, where: Prisma.Sql = Prisma.empty): Promise<AccountSummary[]> {
  const rows = await prisma.$queryRaw<AccountRow[]>`
    SELECT
      a."id", a."name", a."type"::text AS "type", a."currency",
      a."openingBalance"::text AS "openingBalance",
      to_char(a."openingDate", 'YYYY-MM-DD') AS "openingDate",
      a."isActive", a."icon", a."color", a."sortOrder",
      (a."openingBalance" + COALESCE(l."net", 0))::text AS "balance",
      COALESCE(l."inflow", 0)::text AS "inflow",
      COALESCE(l."outflow", 0)::text AS "outflow",
      COALESCE(l."count", 0)::int AS "transactionCount",
      to_char(l."last", 'YYYY-MM-DD') AS "lastActivity",
      COALESCE(f."net", 0)::text AS "scheduledNet"
    FROM "Account" a
    LEFT JOIN (
      SELECT "accountId",
             SUM("amount") AS "net",
             SUM("amount") FILTER (WHERE "amount" > 0) AS "inflow",
             -SUM("amount") FILTER (WHERE "amount" < 0) AS "outflow",
             COUNT(*) AS "count",
             MAX("date") AS "last"
      FROM "LedgerEntry"
      WHERE "date" <= ${asOf}::date
      GROUP BY "accountId"
    ) l ON l."accountId" = a."id"
    LEFT JOIN (
      SELECT "accountId", SUM("amount") AS "net"
      FROM "LedgerEntry"
      WHERE "date" > ${asOf}::date
      GROUP BY "accountId"
    ) f ON f."accountId" = a."id"
    ${where}
    ORDER BY a."isActive" DESC, a."sortOrder" ASC, a."createdAt" ASC`;

  return rows.map((row) => ({
    ...row,
    openingBalance: money(row.openingBalance),
    balance: money(row.balance),
    inflow: money(row.inflow),
    outflow: money(row.outflow),
    scheduledNet: money(row.scheduledNet),
  }));
}

export function listAccounts(today: ISODate): Promise<AccountSummary[]> {
  return queryAccounts(today);
}

export async function getAccount(id: string, today: ISODate): Promise<AccountSummary> {
  const [account] = await queryAccounts(today, Prisma.sql`WHERE a."id" = ${id}`);
  if (!account) throw notFound("Account");
  return account;
}

/** Ledger balance of one account at the end of `date`. */
export async function balanceAsOf(accountId: string, date: ISODate, client: Tx | typeof prisma = prisma): Promise<Money> {
  const rows = await client.$queryRaw<Array<{ balance: string }>>`
    SELECT (a."openingBalance" + COALESCE((
      SELECT SUM(l."amount") FROM "LedgerEntry" l
      WHERE l."accountId" = a."id" AND l."date" <= ${date}::date
    ), 0))::text AS "balance"
    FROM "Account" a WHERE a."id" = ${accountId}`;
  if (!rows[0]) throw notFound("Account");
  return money(rows[0].balance);
}

/**
 * Running balance at each day with activity between `from` and `to`, plus
 * the two endpoints — enough to draw an exact step chart.
 */
export async function balanceHistory(accountId: string, from: ISODate, to: ISODate) {
  const [start, daily] = await Promise.all([
    balanceAsOf(accountId, from),
    prisma.$queryRaw<Array<{ date: string; net: string }>>`
      SELECT to_char("date", 'YYYY-MM-DD') AS "date", SUM("amount")::text AS "net"
      FROM "LedgerEntry"
      WHERE "accountId" = ${accountId} AND "date" > ${from}::date AND "date" <= ${to}::date
      GROUP BY "date" ORDER BY "date"`,
  ]);
  let running = toMinor(start);
  const points: Array<{ date: ISODate; balance: Money }> = [{ date: from, balance: start }];
  for (const day of daily) {
    running += toMinor(money(day.net));
    points.push({ date: day.date, balance: fromMinor(running) });
  }
  if (points[points.length - 1].date !== to) points.push({ date: to, balance: fromMinor(running) });
  return points;
}

async function assertUniqueName(name: string, exceptId?: string) {
  const clash = await prisma.account.findFirst({
    where: { name: { equals: name, mode: "insensitive" }, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    select: { id: true },
  });
  if (clash) throw invalid("Choose another name.", { name: "You already have an account with this name." });
}

function assertNotFuture(input: AccountInput, today?: ISODate) {
  if (today && input.openingDate > today) {
    throw invalid("The opening date can't be in the future.", { openingDate: "Choose today or an earlier date." });
  }
}

export async function createAccount(input: AccountInput, today?: ISODate) {
  assertNotFuture(input, today);
  await assertUniqueName(input.name);
  const last = await prisma.account.aggregate({ _max: { sortOrder: true } });
  return prisma.account.create({
    data: {
      name: input.name,
      type: input.type,
      currency: input.currency,
      openingBalance: input.openingBalance,
      openingDate: toDbDate(input.openingDate),
      icon: input.icon,
      color: input.color,
      isActive: input.isActive,
      sortOrder: (last._max.sortOrder ?? 0) + 10,
    },
    select: { id: true },
  });
}

export async function updateAccount(id: string, input: AccountInput, today?: ISODate) {
  assertNotFuture(input, today);
  await assertUniqueName(input.name, id);
  return prisma.$transaction(async (tx) => {
    // Lock the row so a concurrent transaction insert can't slip in between
    // the history checks below and the update.
    const [existing] = await tx.$queryRaw<Array<{ currency: string }>>`
      SELECT "currency" FROM "Account" WHERE "id" = ${id} FOR UPDATE`;
    if (!existing) throw notFound("Account");

    const [history] = await tx.$queryRaw<Array<{ earliest: string | null; count: number }>>`
      SELECT to_char(MIN("date"), 'YYYY-MM-DD') AS "earliest", COUNT(*)::int AS "count"
      FROM "LedgerEntry" WHERE "accountId" = ${id}`;
    const recurringCount = await tx.recurringTransaction.count({
      where: { OR: [{ accountId: id }, { toAccountId: id }] },
    });

    if (input.currency !== existing.currency && (history.count > 0 || recurringCount > 0)) {
      throw invalid("Currency can't change once the account has history.", {
        currency: "This account already has transactions, so its currency is fixed.",
      });
    }
    if (history.earliest && history.earliest < input.openingDate) {
      throw invalid("The opening date is after existing transactions.", {
        openingDate: `The earliest transaction is on ${formatDate(history.earliest)}. Choose that date or earlier.`,
      });
    }

    return tx.account.update({
      where: { id },
      data: {
        name: input.name,
        type: input.type,
        currency: input.currency,
        openingBalance: input.openingBalance,
        openingDate: toDbDate(input.openingDate),
        icon: input.icon,
        color: input.color,
        isActive: input.isActive,
      },
      select: { id: true },
    });
  });
}

export async function setAccountActive(id: string, isActive: boolean) {
  await prisma.account.update({ where: { id }, data: { isActive }, select: { id: true } });
}

/** Accounts with history can't be deleted — deactivating keeps the ledger intact. */
export async function deleteAccount(id: string) {
  const [transactions, recurring] = await Promise.all([
    prisma.transaction.count({ where: { OR: [{ accountId: id }, { toAccountId: id }] } }),
    prisma.recurringTransaction.count({ where: { OR: [{ accountId: id }, { toAccountId: id }] } }),
  ]);
  if (transactions > 0 || recurring > 0) {
    throw conflict(
      transactions > 0
        ? `This account has ${transactions} transaction${transactions === 1 ? "" : "s"}. Deactivate it instead to hide it while keeping its history.`
        : "Recurring transactions use this account. Remove them first, or deactivate the account instead.",
    );
  }
  await prisma.account.delete({ where: { id } });
}

/** Sum of balances for accounts in one currency (other currencies can't be added). */
export function totalBalance(accounts: AccountSummary[], currency: string): Money {
  return fromMinor(accounts.filter((a) => a.currency === currency).reduce((sum, a) => sum + toMinor(a.balance), 0n));
}

export interface ReconcileResult {
  expected: Money;
  counted: Money;
  difference: Money;
  transactionId: string | null;
}

/**
 * Compare the ledger balance with a physically counted balance and record the
 * difference. The expected balance and the difference are computed here,
 * under a row lock — never taken from the client.
 */
export async function reconcileAccount(id: string, input: ReconcileInput, today: ISODate): Promise<ReconcileResult> {
  return prisma.$transaction(async (tx) => {
    const [account] = await tx.$queryRaw<Array<{ id: string; openingDate: string }>>`
      SELECT "id", to_char("openingDate", 'YYYY-MM-DD') AS "openingDate"
      FROM "Account" WHERE "id" = ${id} FOR UPDATE`;
    if (!account) throw notFound("Account");
    if (input.date > today) throw invalid("Choose today or an earlier date.", { date: "You can't count cash in the future." });
    if (input.date < account.openingDate) {
      throw invalid("The date is before the account was opened.", { date: "Choose a date on or after the opening date." });
    }

    const expected = await balanceAsOf(id, input.date, tx);
    const counted = normalizeMoney(input.countedBalance);
    const difference = toMinor(counted) - toMinor(expected);
    if (difference === 0n) return { expected, counted, difference: fromMinor(0n), transactionId: null };

    const base = {
      date: toDbDate(input.date),
      accountId: id,
      description: "Reconciliation",
      notes: input.note || null,
    };

    let created: { id: string };
    if (input.recordAs === "ADJUSTMENT") {
      created = await tx.transaction.create({
        data: { ...base, type: "ADJUSTMENT", amount: fromMinor(difference) },
        select: { id: true },
      });
    } else {
      const kind = difference < 0n ? "EXPENSE" : "INCOME";
      if (!input.categoryId) {
        throw invalid("Choose a category.", { categoryId: `Choose the ${kind === "EXPENSE" ? "expense" : "income"} category.` });
      }
      const category = await requireCategory(tx, input.categoryId, kind);
      created = await tx.transaction.create({
        data: {
          ...base,
          type: kind,
          amount: fromMinor(difference < 0n ? -difference : difference),
          categoryId: category.id,
          scope: kind === "EXPENSE" ? (input.scope ?? category.defaultScope ?? "OTHER") : null,
        },
        select: { id: true },
      });
    }
    return { expected, counted, difference: fromMinor(difference), transactionId: created.id };
  });
}
