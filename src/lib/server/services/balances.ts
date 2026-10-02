import "server-only";
import { fromDbDate, toDbDate, type Clock, type ISODate } from "@/lib/dates";
import { absMoney, isZero, signOf, subtractMoney, type Money } from "@/lib/money";
import type { BalanceUpdateView, RecordedBalance } from "@/lib/types";
import type { BalanceUpdateInput } from "@/lib/validation";
import { prisma, type Tx } from "../db";
import { invalid, notFound } from "../errors";
import { requireCategory } from "./categories";
import { money } from "./mappers";
import { loggedTimeFor } from "./transactions";

/**
 * Balance updates ("checkpoints"): the account held exactly this much at a
 * moment. The ledger view "BalanceCorrection" derives whatever correction
 * makes each one hold, so a transaction added later but dated earlier never
 * changes the balance after an update — the correction absorbs it.
 */

/**
 * The balance recorded for a moment, placed exactly like a new update there
 * would be: after everything at the same moment; without a time, now (for
 * today) or the end of the day.
 */
export async function recordedBalanceAt(
  accountId: string,
  date: ISODate,
  time: string | null,
  clock: Clock,
  client: Tx | typeof prisma = prisma,
): Promise<RecordedBalance> {
  const at = time ?? loggedTimeFor(date, time, clock) ?? "24:00";
  const [row] = await client.$queryRaw<Array<{ balance: string; startingPoint: boolean; nextDate: string | null; nextIsOpening: boolean | null }>>`
    SELECT
      (a."openingBalance" + COALESCE((
        SELECT SUM(l."amount") FROM "LedgerEntry" l
        WHERE l."accountId" = a."id"
          AND (l."date" < ${date}::date OR (l."date" = ${date}::date AND l."at" <= ${at}))
      ), 0))::text AS "balance",
      (a."openingDate" > ${date}::date AND NOT EXISTS (
        SELECT 1 FROM "BalanceCheckpoint" c
        WHERE c."accountId" = a."id"
          AND (c."date" < ${date}::date
               OR (c."date" = ${date}::date AND COALESCE(c."time", c."loggedTime", '24:00')::text COLLATE "C" <= ${at}))
      )) AS "startingPoint",
      to_char(n."date", 'YYYY-MM-DD') AS "nextDate",
      n."opening" AS "nextIsOpening"
    FROM "Account" a
    LEFT JOIN LATERAL (
      SELECT x."date", x."opening" FROM (
        -- The opening balance sits at the very start of its day.
        SELECT a."openingDate" AS "date", '00:00'::text COLLATE "C" AS "at", -1 AS "rank", true AS "opening"
        WHERE a."openingDate" > ${date}::date
        UNION ALL
        SELECT c."date", COALESCE(c."time", c."loggedTime", '24:00')::text COLLATE "C", 1, false
        FROM "BalanceCheckpoint" c
        WHERE c."accountId" = a."id"
          AND (c."date" > ${date}::date
               OR (c."date" = ${date}::date AND COALESCE(c."time", c."loggedTime", '24:00')::text COLLATE "C" > ${at}))
      ) x
      ORDER BY x."date", x."at", x."rank"
      LIMIT 1
    ) n ON true
    WHERE a."id" = ${accountId}`;
  if (!row) throw notFound("Account");
  return {
    balance: money(row.balance),
    startingPoint: row.startingPoint,
    nextBalance: row.nextDate ? { date: row.nextDate, opening: !!row.nextIsOpening } : null,
  };
}

export interface BalanceUpdateResult {
  id: string;
  /**
   * New balance − what Hisab had recorded for that moment (+ more money than
   * recorded, − less). Normally the correction; for a starting point, the
   * change to the history before the opening balance.
   */
  difference: Money;
  /** It came before every other known balance, so it only fills in history. */
  startingPoint: boolean;
  /** The unrecorded expense/income created for the difference, if asked for. */
  recorded: { id: string; type: "EXPENSE" | "INCOME" } | null;
}

const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/** Grace for a device clock running slightly ahead of the server's. */
const CLOCK_SKEW_MINUTES = 5;

/**
 * Record what the account holds at a moment. Without a time it is "now" when
 * the date is today (to the second), otherwise the end of that day.
 */
export async function updateBalance(
  accountId: string,
  input: BalanceUpdateInput,
  today: ISODate,
  time?: string | null,
): Promise<BalanceUpdateResult> {
  if (input.date > today) throw invalid("A balance can't be set for the future.", { date: "Choose today or an earlier date." });
  if (input.date === today && input.time && time && minutesOf(input.time) > minutesOf(time) + CLOCK_SKEW_MINUTES) {
    // Anything recorded in between would land before it and be absorbed.
    throw invalid("A balance can't be set for later today.", { time: "Choose the current time or earlier." });
  }
  const clock = { today, time };
  const loggedTime = loggedTimeFor(input.date, input.time, clock);

  return prisma.$transaction(async (tx) => {
    // Serialises with transaction writes on this account (they take FOR SHARE).
    const [account] = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Account" WHERE "id" = ${accountId} FOR UPDATE`;
    if (!account) throw notFound("Account");

    const before = await recordedBalanceAt(accountId, input.date, input.time, clock, tx);
    const difference = subtractMoney(input.balance, before.balance);
    const checkpoint = await tx.balanceCheckpoint.create({
      data: {
        accountId,
        date: toDbDate(input.date),
        time: input.time,
        loggedTime,
        balance: input.balance,
        source: "MANUAL",
        note: input.note,
      },
      select: { id: true },
    });

    let recorded: BalanceUpdateResult["recorded"] = null;
    if (input.recordAs === "CATEGORY" && !before.startingPoint && !isZero(difference)) {
      // Money that left (or arrived) without being recorded: record it at the
      // same moment (movements come before a checkpoint), so no correction is needed.
      const type = signOf(difference) < 0 ? "EXPENSE" : "INCOME";
      if (!input.categoryId) {
        throw invalid("Choose a category.", { categoryId: `Choose the ${type === "EXPENSE" ? "expense" : "income"} category.` });
      }
      const category = await requireCategory(tx, input.categoryId, type);
      const created = await tx.transaction.create({
        data: {
          type,
          amount: absMoney(difference),
          date: toDbDate(input.date),
          time: input.time,
          loggedTime,
          accountId,
          categoryId: category.id,
          scope: type === "EXPENSE" ? (input.scope ?? category.defaultScope ?? "PERSONAL") : null,
          description: type === "EXPENSE" ? "Unrecorded spending" : "Unrecorded income",
          notes: input.note,
        },
        select: { id: true },
      });
      recorded = { id: created.id, type };
    }
    return { id: checkpoint.id, difference, startingPoint: before.startingPoint, recorded };
  });
}

/**
 * The time shown for a balance update: the one given, or for one entered as
 * "now", the moment it was entered (to the minute). An SMS without a time
 * shows none — when it was imported says nothing about when it was sent.
 */
function shownTime(row: { time: string | null; loggedTime: string | null; source: string }): string | null {
  return row.time ?? (row.source === "MANUAL" && row.loggedTime ? row.loggedTime.slice(0, 5) : null);
}

/** Balance updates for an account, newest first, with what each one replaced. */
export async function listBalanceUpdates(accountId: string, limit = 20): Promise<BalanceUpdateView[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      date: Date;
      time: string | null;
      loggedTime: string | null;
      messageDate: Date | null;
      messageTime: string | null;
      balance: string;
      source: "MANUAL" | "SMS";
      note: string | null;
      correction: string | null;
      kind: string | null;
    }>
  >`
    SELECT c."id", c."date", c."time", c."loggedTime", c."messageDate", c."messageTime",
           c."balance"::text AS "balance", c."source"::text AS "source", c."note",
           bc."amount"::text AS "correction", bc."kind"
    FROM "BalanceCheckpoint" c
    -- Filtering the view by account lets the database work through that account's history only.
    LEFT JOIN (SELECT * FROM "BalanceCorrection" WHERE "accountId" = ${accountId}) bc ON bc."checkpointId" = c."id"
    WHERE c."accountId" = ${accountId}
    ORDER BY c."date" DESC, COALESCE(c."time", c."loggedTime", '24:00')::text COLLATE "C" DESC, c."createdAt" DESC
    LIMIT ${limit}`;
  return rows.map((row) => {
    const balance = money(row.balance);
    const correction = row.kind === "HISTORY" ? money("0") : money(row.correction ?? "0");
    return {
      id: row.id,
      // An SMS shows when it was sent, not when it was read.
      date: fromDbDate(row.messageDate ?? row.date),
      time: row.source === "SMS" ? row.messageTime : shownTime(row),
      balance,
      source: row.source,
      note: row.note,
      startingPoint: row.kind === "HISTORY",
      previous: subtractMoney(balance, correction),
      correction,
    };
  });
}

export async function deleteBalanceUpdate(accountId: string, checkpointId: string) {
  const result = await prisma.balanceCheckpoint.deleteMany({ where: { id: checkpointId, accountId } });
  if (result.count === 0) throw notFound("Balance update");
}
