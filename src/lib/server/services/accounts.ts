import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { toDbDate, type ISODate } from "@/lib/dates";
import type { AccountType, CheckpointSource } from "@/lib/domain";
import { fromMinor, toMinor, type Money } from "@/lib/money";
import type { AccountSummary } from "@/lib/types";
import type { AccountInput } from "@/lib/validation";
import { prisma, type Tx } from "../db";
import { conflict, invalid, notFound } from "../errors";
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
  checkpointDate: string | null;
  checkpointTime: string | null;
  checkpointBalance: string | null;
  checkpointSource: CheckpointSource | null;
}

/**
 * Accounts with balances derived from the ledger. Balance = opening balance +
 * every signed ledger movement dated on or before `asOf`, including the
 * automatic corrections that make balance updates hold. Nothing is cached.
 *
 * Money in/out count the account's own transactions since its opening date;
 * whatever else changed the balance (balance updates) is `corrections`, so
 * opening + in − out + corrections = balance.
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
      COALESCE(t."count", 0)::int AS "transactionCount",
      to_char(t."last", 'YYYY-MM-DD') AS "lastActivity",
      COALESCE(l."future", 0)::text AS "scheduledNet",
      to_char(c."date", 'YYYY-MM-DD') AS "checkpointDate",
      c."time" AS "checkpointTime",
      c."balance"::text AS "checkpointBalance",
      c."source"::text AS "checkpointSource"
    FROM "Account" a
    -- One pass over the account's ledger: the corrections behind it are
    -- derived from all of its history, so reading it twice costs twice.
    LEFT JOIN LATERAL (
      SELECT SUM(e."amount") FILTER (WHERE e."date" <= ${asOf}::date) AS "net",
             SUM(e."amount") FILTER (WHERE e."date" > ${asOf}::date) AS "future",
             SUM(e."amount") FILTER (WHERE e."transactionId" IS NOT NULL AND e."amount" > 0 AND e."date" BETWEEN a."openingDate" AND ${asOf}::date) AS "inflow",
             -SUM(e."amount") FILTER (WHERE e."transactionId" IS NOT NULL AND e."amount" < 0 AND e."date" BETWEEN a."openingDate" AND ${asOf}::date) AS "outflow"
      FROM "LedgerEntry" e
      WHERE e."accountId" = a."id"
    ) l ON true
    -- A transaction has at most one leg per account (transfers can't loop back).
    LEFT JOIN (
      SELECT "accountId", COUNT(*) AS "count", MAX("date") AS "last"
      FROM "TransactionLeg"
      WHERE "date" <= ${asOf}::date
      GROUP BY "accountId"
    ) t ON t."accountId" = a."id"
    LEFT JOIN LATERAL (
      SELECT cp."date", cp."balance", cp."source",
             -- As shown in the list of updates: see shownTime in balances.ts.
             COALESCE(cp."time", CASE WHEN cp."source" = 'MANUAL' THEN left(cp."loggedTime", 5) END) AS "time"
      FROM "BalanceCheckpoint" cp
      WHERE cp."accountId" = a."id" AND cp."date" <= ${asOf}::date
      ORDER BY cp."date" DESC, COALESCE(cp."time", cp."loggedTime", '24:00')::text COLLATE "C" DESC, cp."createdAt" DESC
      LIMIT 1
    ) c ON true
    ${where}
    ORDER BY a."isActive" DESC, a."sortOrder" ASC, a."createdAt" ASC`;

  return rows.map(({ checkpointDate, checkpointTime, checkpointBalance, checkpointSource, ...row }) => {
    const balance = money(row.balance);
    const openingBalance = money(row.openingBalance);
    const inflow = money(row.inflow);
    const outflow = money(row.outflow);
    return {
      ...row,
      openingBalance,
      balance,
      inflow,
      outflow,
      corrections: fromMinor(toMinor(balance) - toMinor(openingBalance) - toMinor(inflow) + toMinor(outflow)),
      scheduledNet: money(row.scheduledNet),
      lastUpdate:
        checkpointDate && checkpointBalance && checkpointSource
          ? { date: checkpointDate, time: checkpointTime, balance: money(checkpointBalance), source: checkpointSource }
          : null,
    };
  });
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

    // Amounts already recorded (transactions, balance updates, rules) are in
    // this currency. The opening date can move freely: entries before it are
    // history and don't change the balance from that date on.
    if (input.currency !== existing.currency) {
      const [transactions, checkpoints, rules] = await Promise.all([
        tx.transaction.count({ where: { OR: [{ accountId: id }, { toAccountId: id }] } }),
        tx.balanceCheckpoint.count({ where: { accountId: id } }),
        tx.recurringTransaction.count({ where: { OR: [{ accountId: id }, { toAccountId: id }] } }),
      ]);
      if (transactions + checkpoints + rules > 0) {
        throw invalid("Currency can't change once the account has history.", {
          currency: "This account already has transactions, so its currency is fixed.",
        });
      }
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
