import "server-only";
import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { addDays, fromDbDate, type Clock, type ISODate } from "@/lib/dates";
import type { EntryType, ExpenseScope } from "@/lib/domain";
import { normalizeMoney, type Money } from "@/lib/money";
import { normalizeSmsText } from "@/lib/sms/parse";
import type { SmsImportInput } from "@/lib/validation";
import { prisma, type Tx } from "../db";
import { AppError } from "../errors";
import { isUniqueViolation } from "./mappers";
import { resolveEntry } from "./transactions";

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
  learned: LearnedEntry | null;
}

export async function checkSms(items: Array<{ text: string; description: string }>): Promise<SmsCheckResult[]> {
  const keys = items.flatMap((item) => [smsKey(item.text, 0), smsKey(item.text, 1)]);
  const descriptions = [...new Set(items.map((i) => i.description.toLowerCase()).filter(Boolean))];

  const [existing, learned] = await Promise.all([
    prisma.transaction.findMany({ where: { idempotencyKey: { in: keys } }, select: { id: true, idempotencyKey: true } }),
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

export type SmsImportResult =
  | { status: "added"; ids: string[] }
  | { status: "exists"; ids: string[] }
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

/**
 * The balance the message reports becomes a balance update for the account it
 * belongs to, placed right after the message's own transaction (same moment,
 * and a balance update comes after the movements at its minute). Idempotent
 * per message.
 */
async function recordReportedBalance(client: Tx, item: ImportItem, row: Prisma.TransactionUncheckedCreateInput): Promise<void> {
  const accountIds = [row.accountId, row.toAccountId].filter((v): v is string => !!v);
  if (!item.balance || !accountIds.includes(item.balance.accountId)) return;
  const key = smsKey(item.text, "b");
  if (await client.balanceCheckpoint.findUnique({ where: { smsKey: key }, select: { id: true } })) return;
  await client.balanceCheckpoint.create({
    data: {
      accountId: item.balance.accountId,
      date: row.date,
      time: row.time ?? null,
      loggedTime: row.loggedTime ?? null,
      balance: item.balance.amount,
      source: "SMS",
      smsKey: key,
    },
  });
}

class PossibleDuplicate extends Error {
  constructor(public readonly similar: SimilarTransaction) {
    super("possible duplicate");
  }
}

async function importOne(item: ImportItem, clock: Clock): Promise<SmsImportResult> {
  const mainKey = smsKey(item.text, 0);
  const feeKey = smsKey(item.text, 1);
  const already = async () =>
    (await prisma.transaction.findMany({ where: { idempotencyKey: { in: [mainKey, feeKey] } }, select: { id: true } })).map((t) => t.id);

  const existing = await already();
  if (existing.length) return { status: "exists", ids: existing };

  try {
    const ids = await prisma.$transaction(async (tx) => {
      const row = await resolveEntry(tx, item.transaction, clock);
      if (!item.allowDuplicate) {
        const similar = await findSimilar(tx, row);
        if (similar) throw new PossibleDuplicate(similar);
      }
      const created = [await tx.transaction.create({ data: { ...row, idempotencyKey: mainKey }, select: { id: true } })];
      if (item.fee) {
        const feeRow = await resolveEntry(tx, item.fee, clock);
        created.push(await tx.transaction.create({ data: { ...feeRow, idempotencyKey: feeKey }, select: { id: true } }));
      }
      await recordReportedBalance(tx, item, row);
      return created.map((c) => c.id);
    });
    return { status: "added", ids };
  } catch (error) {
    // The balance is only recorded with its transaction: the entry this one
    // resembles may be timed differently, and would be counted twice.
    if (error instanceof PossibleDuplicate) return { status: "possible_duplicate", similar: error.similar };
    if (isUniqueViolation(error, "idempotencyKey")) return { status: "exists", ids: await already() };
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
