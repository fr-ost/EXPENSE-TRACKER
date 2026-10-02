import "server-only";
import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { addDays, fromDbDate, toDbDate, type Clock, type ISODate } from "@/lib/dates";
import type { EntryType, ExpenseScope } from "@/lib/domain";
import { normalizeMoney, type Money } from "@/lib/money";
import { normalizeSmsText } from "@/lib/sms/parse";
import type { SmsBalanceInput, SmsImportInput } from "@/lib/validation";
import { prisma, type Tx } from "../db";
import { AppError, invalid } from "../errors";
import { isUniqueViolation } from "./mappers";
import { loggedTimeFor, resolveEntry } from "./transactions";

/**
 * SMS imports. Each message gets a fingerprint of its (normalised) text; its
 * transaction is stored with the idempotency key "sms:<fingerprint>:0" and a
 * fee with ":1", so pasting or sharing the same message again never adds it
 * twice — on any device, at any time.
 */
export function smsFingerprint(text: string): string {
  const normalized = normalizeSmsText(text).toLowerCase().replace(/\s+/g, " ");
  return createHash("sha256").update(normalized, "utf8").digest("hex").slice(0, 40);
}

const smsKey = (text: string, part: 0 | 1 | "b") => `sms:${smsFingerprint(text)}:${part}`;

/** What was recorded last time for the same description, to repeat the user's own choices. */
export interface LearnedEntry {
  type: EntryType;
  accountId: string;
  toAccountId: string | null;
  categoryId: string | null;
  scope: ExpenseScope | null;
  countAsExpense: boolean;
}

export interface SmsCheckResult {
  /** Transactions already added from this message. */
  existing: string[];
  /** The balance this message reports is already recorded. */
  balanceSaved: boolean;
  learned: LearnedEntry | null;
}

export async function checkSms(items: Array<{ text: string; description: string }>): Promise<SmsCheckResult[]> {
  const keys = items.flatMap((item) => [smsKey(item.text, 0), smsKey(item.text, 1)]);
  const descriptions = [...new Set(items.map((i) => i.description.toLowerCase()).filter(Boolean))];

  const [existing, balances, learned] = await Promise.all([
    prisma.transaction.findMany({
      where: { idempotencyKey: { in: keys } },
      select: { id: true, idempotencyKey: true },
      orderBy: { idempotencyKey: "asc" },
    }),
    prisma.balanceCheckpoint.findMany({ where: { smsKey: { in: items.map((item) => smsKey(item.text, "b")) } }, select: { smsKey: true } }),
    descriptions.length
      ? prisma.$queryRaw<Array<LearnedEntry & { key: string }>>`
          SELECT DISTINCT ON (lower("description"))
            lower("description") AS "key", "type"::text AS "type", "accountId", "toAccountId",
            "categoryId", "scope"::text AS "scope", "countAsExpense"
          FROM "Transaction"
          WHERE lower("description") = ANY(${descriptions}) AND "type" <> 'ADJUSTMENT'
          ORDER BY lower("description"), "createdAt" DESC`
      : Promise.resolve([]),
  ]);

  return items.map((item) => {
    const prefix = `sms:${smsFingerprint(item.text)}:`;
    const match = learned.find((l) => l.key === item.description.toLowerCase());
    return {
      existing: existing.filter((e) => e.idempotencyKey?.startsWith(prefix)).map((e) => e.id),
      balanceSaved: balances.some((b) => b.smsKey === `${prefix}b`),
      learned: match
        ? {
            type: match.type,
            accountId: match.accountId,
            toAccountId: match.toAccountId,
            categoryId: match.categoryId,
            scope: match.scope,
            countAsExpense: match.countAsExpense,
          }
        : null,
    };
  });
}

export interface SimilarTransaction {
  id: string;
  description: string;
  date: ISODate;
  amount: Money;
  account: string;
}

/** `balanceSaved`: the balance the message reports is recorded for its account. */
export type SmsImportResult =
  | { status: "added"; ids: string[]; balanceSaved: boolean }
  | { status: "exists"; ids: string[]; balanceSaved: boolean }
  | { status: "possible_duplicate"; similar: SimilarTransaction }
  | { status: "error"; error: string; fieldErrors?: Record<string, string> };

/**
 * A recorded movement of the same amount, in the same direction, on the same
 * account within a day — e.g. the expense was typed in by hand already, or a
 * transfer was imported from the other bank's SMS.
 */
async function findSimilar(tx: Tx, row: Prisma.TransactionUncheckedCreateInput): Promise<SimilarTransaction | null> {
  const amount = String(row.amount);
  const movements: Array<{ accountId: string; amount: string }> =
    row.type === "INCOME"
      ? [{ accountId: row.accountId, amount }]
      : [{ accountId: row.accountId, amount: `-${amount}` }];
  if (row.type === "TRANSFER" && row.toAccountId) {
    movements.push({ accountId: row.toAccountId, amount: row.toAmount ? String(row.toAmount) : amount });
  }
  const date = fromDbDate(row.date as Date);
  for (const movement of movements) {
    const [match] = await tx.$queryRaw<Array<Omit<SimilarTransaction, "amount"> & { amount: string }>>`
      SELECT t."id", t."description", to_char(t."date", 'YYYY-MM-DD') AS "date", t."amount"::text AS "amount", a."name" AS "account"
      FROM "TransactionLeg" l
      JOIN "Transaction" t ON t."id" = l."transactionId"
      JOIN "Account" a ON a."id" = t."accountId"
      WHERE l."accountId" = ${movement.accountId}
        AND l."amount" = ${movement.amount}::numeric
        AND l."date" BETWEEN ${addDays(date, -1)}::date AND ${addDays(date, 1)}::date
        AND t."type" <> 'ADJUSTMENT'
      ORDER BY abs(l."date" - ${date}::date), t."createdAt" DESC
      LIMIT 1`;
    if (match) return { ...match, amount: normalizeMoney(match.amount) };
  }
  return null;
}

type ImportItem = SmsImportInput["items"][number];

/** A message and the balance it reports for one of its accounts. */
type ReportedBalance = Pick<ImportItem, "text" | "balance">;

/** Where a transaction sits: the accounts it touches and its moment. */
interface Placed {
  accountId: string;
  toAccountId?: string | null;
  date: Date | string;
  time?: string | null;
  loggedTime?: string | null;
}

const PLACED = { id: true, idempotencyKey: true, accountId: true, toAccountId: true, date: true, time: true, loggedTime: true } as const;

/**
 * An SMS balance replaces the account's balance — nothing is added to it. The
 * newest message for an account (none sent later, and no balance you entered
 * for a later moment) sets the balance as of now: everything already recorded
 * is taken as included, so the account shows exactly what the bank or wallet
 * said. An older message is kept as history at its own moment. Idempotent per
 * message.
 */
async function saveSmsCheckpoint(
  client: Tx,
  input: { key: string; accountId: string; amount: Money; messageDate: ISODate; messageTime: string | null; loggedTime: string | null },
  clock: Clock,
): Promise<void> {
  const at = input.messageTime ?? "24:00";
  const [{ newer }] = await client.$queryRaw<[{ newer: boolean }]>`
    SELECT EXISTS (
      SELECT 1 FROM "BalanceCheckpoint" c
      WHERE c."accountId" = ${input.accountId} AND (
        (c."source" = 'SMS' AND (c."messageDate" > ${input.messageDate}::date OR (
          c."messageDate" = ${input.messageDate}::date AND COALESCE(c."messageTime", '24:00')::text COLLATE "C" > ${at}::text COLLATE "C")))
        OR (c."source" = 'MANUAL' AND (c."date" > ${input.messageDate}::date OR (
          c."date" = ${input.messageDate}::date AND COALESCE(c."time", c."loggedTime", '24:00')::text COLLATE "C" > ${at}::text COLLATE "C")))
      )
    ) AS "newer"`;
  const current = !newer && input.messageDate <= clock.today;
  // It holds from now — or from its own time, if the message is stamped later
  // than now (clocks differ by a minute or two), so it still follows its own
  // transaction.
  const ahead = !!input.messageTime && input.messageDate === clock.today && !!clock.time && input.messageTime > clock.time.slice(0, 5);
  await client.balanceCheckpoint.create({
    data: {
      accountId: input.accountId,
      balance: input.amount,
      source: "SMS",
      smsKey: input.key,
      messageDate: toDbDate(input.messageDate),
      messageTime: input.messageTime,
      ...(current && !ahead
        ? { date: toDbDate(clock.today), time: null, loggedTime: clock.time ?? null }
        : { date: toDbDate(input.messageDate), time: input.messageTime, loggedTime: input.messageTime ? null : input.loggedTime }),
    },
  });
}

/**
 * The balance a message reports, for the account it belongs to (see
 * saveSmsCheckpoint). Returns whether the message's balance is saved.
 */
async function recordReportedBalance(client: Tx, item: ReportedBalance, row: Placed, clock: Clock): Promise<boolean> {
  const accountIds = [row.accountId, row.toAccountId].filter((v): v is string => !!v);
  if (!item.balance || !accountIds.includes(item.balance.accountId)) return false;
  const key = smsKey(item.text, "b");
  if (await client.balanceCheckpoint.findUnique({ where: { smsKey: key }, select: { id: true } })) return true;
  const messageDate = typeof row.date === "string" ? row.date : fromDbDate(row.date);
  await saveSmsCheckpoint(
    client,
    { key, accountId: item.balance.accountId, amount: item.balance.amount, messageDate, messageTime: row.time ?? null, loggedTime: row.loggedTime ?? null },
    clock,
  );
  return true;
}

class PossibleDuplicate extends Error {
  constructor(public readonly similar: SimilarTransaction) {
    super("possible duplicate");
  }
}

/**
 * The user confirmed a flagged message is a transaction already recorded
 * (e.g. typed in by hand). The message becomes its record: the transaction
 * takes the message's date and time — the bank's clock beats a guess — so the
 * balance the message reports lands right after it, and pasting the message
 * again finds it.
 */
async function linkToRecorded(tx: Tx, item: ImportItem, targetId: string, mainKey: string, clock: Clock): Promise<SmsImportResult> {
  const target = await tx.transaction.findUnique({ where: { id: targetId }, select: { ...PLACED, type: true } });
  if (!target || target.type === "ADJUSTMENT") throw invalid("That transaction no longer exists.");
  const date = item.transaction.date;
  const time = item.transaction.time ?? target.time;
  const unmoved = fromDbDate(target.date) === date && target.time === time;
  const linked = await tx.transaction.update({
    where: { id: target.id },
    data: {
      date: toDbDate(date),
      time,
      loggedTime: time ? null : unmoved ? target.loggedTime : loggedTimeFor(date, null, clock),
      // Keep a key another message already gave it (the other side of a transfer).
      ...(target.idempotencyKey?.startsWith("sms:") ? {} : { idempotencyKey: mainKey }),
    },
    select: PLACED,
  });
  return { status: "exists", ids: [linked.id], balanceSaved: await recordReportedBalance(tx, item, linked, clock) };
}

async function importOne(item: ImportItem, clock: Clock): Promise<SmsImportResult> {
  const mainKey = smsKey(item.text, 0);
  const feeKey = smsKey(item.text, 1);
  // Main transaction first (":0" sorts before ":1").
  const fromThisMessage = (client: Tx | typeof prisma) =>
    client.transaction.findMany({ where: { idempotencyKey: { in: [mainKey, feeKey] } }, select: PLACED, orderBy: { idempotencyKey: "asc" } });

  try {
    return await prisma.$transaction(async (tx): Promise<SmsImportResult> => {
      const existing = await fromThisMessage(tx);
      if (existing.length) {
        // Added before — perhaps before balances were read from SMS: record it now.
        const main = existing.find((row) => row.idempotencyKey === mainKey);
        return { status: "exists", ids: existing.map((row) => row.id), balanceSaved: main ? await recordReportedBalance(tx, item, main, clock) : false };
      }
      if (item.sameAs) return linkToRecorded(tx, item, item.sameAs, mainKey, clock);

      const row = await resolveEntry(tx, item.transaction, clock);
      if (!item.allowDuplicate) {
        // Not added (and its balance not recorded) until the user says whether
        // it's the same transaction or another one.
        const similar = await findSimilar(tx, row);
        if (similar) throw new PossibleDuplicate(similar);
      }
      const created = [await tx.transaction.create({ data: { ...row, idempotencyKey: mainKey }, select: { id: true } })];
      if (item.fee) {
        const feeRow = await resolveEntry(tx, item.fee, clock);
        created.push(await tx.transaction.create({ data: { ...feeRow, idempotencyKey: feeKey }, select: { id: true } }));
      }
      return { status: "added", ids: created.map((c) => c.id), balanceSaved: await recordReportedBalance(tx, item, row, clock) };
    });
  } catch (error) {
    if (error instanceof PossibleDuplicate) return { status: "possible_duplicate", similar: error.similar };
    if (isUniqueViolation(error)) {
      // The same message imported at the same moment elsewhere won the race.
      const saved = await prisma.balanceCheckpoint.findUnique({ where: { smsKey: smsKey(item.text, "b") }, select: { id: true } });
      return { status: "exists", ids: (await fromThisMessage(prisma)).map((row) => row.id), balanceSaved: !!saved };
    }
    if (error instanceof AppError) return { status: "error", error: error.message, fieldErrors: error.fieldErrors };
    throw error;
  }
}

/** Add each message's transaction (and fee) atomically; one bad message doesn't block the rest. */
export async function importSms(input: SmsImportInput, today: ISODate, time?: string | null): Promise<SmsImportResult[]> {
  const results: SmsImportResult[] = [];
  // Sequential on purpose: later items see earlier ones when looking for duplicates.
  for (const item of input.items) results.push(await importOne(item, { today, time }));
  return results;
}

/**
 * Record the balances messages report without adding anything: messages added
 * earlier (e.g. before balances were read from SMS), and messages that only
 * report a balance ("Your balance is Tk 8,000"), dated `reportedAt`.
 */
export async function saveSmsBalances(items: SmsBalanceInput["items"], clock: Clock): Promise<Array<{ saved: boolean }>> {
  const results: Array<{ saved: boolean }> = [];
  for (const item of items) {
    const saved = await prisma
      .$transaction(async (tx) => {
        const main = await tx.transaction.findUnique({ where: { idempotencyKey: smsKey(item.text, 0) }, select: PLACED });
        if (main) return recordReportedBalance(tx, item, main, clock);
        if (!item.reportedAt) return false;
        const key = smsKey(item.text, "b");
        if (await tx.balanceCheckpoint.findUnique({ where: { smsKey: key }, select: { id: true } })) return true;
        const account = await tx.account.findUnique({ where: { id: item.balance.accountId }, select: { type: true } });
        if (!account) throw invalid("That account no longer exists.");
        if (account.type === "CARD") throw invalid("A card's SMS reports a limit or amount due, not a balance.");
        if (item.reportedAt.date > clock.today) throw invalid("The message is dated in the future.");
        await saveSmsCheckpoint(
          tx,
          {
            key,
            accountId: item.balance.accountId,
            amount: item.balance.amount,
            messageDate: item.reportedAt.date,
            messageTime: item.reportedAt.time,
            loggedTime: loggedTimeFor(item.reportedAt.date, item.reportedAt.time, clock),
          },
          clock,
        );
        return true;
      })
      .catch(async (error: unknown) => {
        // Saved at the same moment by another request.
        if (!isUniqueViolation(error)) throw error;
        return !!(await prisma.balanceCheckpoint.findUnique({ where: { smsKey: smsKey(item.text, "b") }, select: { id: true } }));
      });
    results.push({ saved });
  }
  return results;
}
