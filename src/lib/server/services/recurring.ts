import "server-only";
import { addDays, addMonths, addYears, fromDbDate, toDbDate, type ISODate } from "@/lib/dates";
import type { Frequency } from "@/lib/domain";
import type { RecurringView } from "@/lib/types";
import type { RecurringInput, TransactionInput } from "@/lib/validation";
import { prisma, type Tx } from "../db";
import { AppError, notFound } from "../errors";
import { accountRefSelect, categoryRefSelect, isUniqueViolation, money, moneyOrNull, toAccountRef, toCategoryRef } from "./mappers";
import { resolveEntry } from "./transactions";

/** Safety valve: never post more than this many occurrences of one rule in a run. */
const MAX_POSTS_PER_RUN = 400;

/**
 * Occurrence k of a schedule, always computed from the start date so month
 * ends don't drift (Jan 31 → Feb 28 → Mar 31).
 */
export function occurrenceDate(startDate: ISODate, frequency: Frequency, index: number): ISODate {
  switch (frequency) {
    case "WEEKLY":
      return addDays(startDate, 7 * index);
    case "MONTHLY":
      return addMonths(startDate, index);
    case "YEARLY":
      return addYears(startDate, index);
  }
}

/** First occurrence index whose date is on/after `date` (and after `after`, if given). */
export function firstIndexOnOrAfter(startDate: ISODate, frequency: Frequency, date: ISODate, after?: ISODate | null): number {
  let index = 0;
  // Jump close first, then step — keeps this O(1)-ish for long-running rules.
  if (date > startDate) {
    const days = (new Date(`${date}T00:00:00Z`).getTime() - new Date(`${startDate}T00:00:00Z`).getTime()) / 86_400_000;
    index = Math.max(0, Math.floor(frequency === "WEEKLY" ? days / 7 : frequency === "MONTHLY" ? days / 31 : days / 366) - 1);
  }
  while (occurrenceDate(startDate, frequency, index) < date || (after && occurrenceDate(startDate, frequency, index) <= after)) {
    index++;
  }
  return index;
}

function scheduleState(startDate: ISODate, frequency: Frequency, endDate: ISODate | null, index: number) {
  const next = occurrenceDate(startDate, frequency, index);
  return { occurrenceIndex: index, nextOccurrence: endDate && next > endDate ? null : toDbDate(next) };
}

/** The transaction a rule posts on a given date, in API input shape (so it is validated like any other). */
function ruleToInput(rule: RecurringInput | RuleRow, date: ISODate): TransactionInput {
  const common = {
    amount: typeof rule.amount === "string" ? rule.amount : money(rule.amount),
    date,
    description: rule.description,
    notes: rule.notes ?? null,
    accountId: rule.accountId,
  };
  switch (rule.type) {
    case "EXPENSE":
      return { ...common, type: "EXPENSE", categoryId: rule.categoryId!, scope: rule.scope ?? "OTHER" };
    case "INCOME":
      return { ...common, type: "INCOME", categoryId: rule.categoryId! };
    default:
      return {
        ...common,
        type: "TRANSFER",
        toAccountId: rule.toAccountId!,
        toAmount: rule.toAmount === null || rule.toAmount === undefined ? null : typeof rule.toAmount === "string" ? rule.toAmount : money(rule.toAmount),
        countAsExpense: rule.countAsExpense,
        categoryId: rule.countAsExpense ? rule.categoryId : null,
        scope: rule.countAsExpense ? rule.scope : null,
      };
  }
}

type RuleRow = NonNullable<Awaited<ReturnType<typeof loadRule>>>;

function loadRule(tx: Tx, id: string) {
  return tx.recurringTransaction.findUnique({ where: { id } });
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function listRecurring(): Promise<RecurringView[]> {
  const rows = await prisma.recurringTransaction.findMany({
    include: {
      account: { select: accountRefSelect },
      toAccount: { select: accountRefSelect },
      category: { select: categoryRefSelect },
      _count: { select: { transactions: true } },
    },
    orderBy: [{ isActive: "desc" }, { nextOccurrence: "asc" }, { createdAt: "asc" }],
  });
  return rows.map((row) => ({
    id: row.id,
    type: row.type as RecurringView["type"],
    amount: money(row.amount),
    toAmount: moneyOrNull(row.toAmount),
    account: toAccountRef(row.account),
    toAccount: row.toAccount ? toAccountRef(row.toAccount) : null,
    category: row.category ? toCategoryRef(row.category) : null,
    countAsExpense: row.countAsExpense,
    scope: row.scope,
    description: row.description,
    notes: row.notes,
    frequency: row.frequency,
    startDate: fromDbDate(row.startDate),
    endDate: row.endDate ? fromDbDate(row.endDate) : null,
    nextOccurrence: row.nextOccurrence ? fromDbDate(row.nextOccurrence) : null,
    isActive: row.isActive,
    postedCount: row._count.transactions,
  }));
}

/** Upcoming occurrences of active rules within `days` days after today. */
export function upcomingOccurrences(rules: RecurringView[], today: ISODate, days = 30) {
  const until = addDays(today, days);
  const items: Array<{ rule: RecurringView; date: ISODate }> = [];
  for (const rule of rules) {
    if (!rule.isActive || !rule.nextOccurrence) continue;
    let index = firstIndexOnOrAfter(rule.startDate, rule.frequency, rule.nextOccurrence);
    for (let n = 0; n < 60; n++, index++) {
      const date = occurrenceDate(rule.startDate, rule.frequency, index);
      if (date > until || (rule.endDate && date > rule.endDate)) break;
      if (date > today) items.push({ rule, date });
    }
  }
  return items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function ruleData(input: RecurringInput) {
  const expenseLike = input.type === "EXPENSE" || (input.type === "TRANSFER" && input.countAsExpense);
  return {
    type: input.type,
    amount: input.amount,
    accountId: input.accountId,
    toAccountId: input.type === "TRANSFER" ? input.toAccountId : null,
    toAmount: input.type === "TRANSFER" ? input.toAmount : null,
    countAsExpense: input.type === "TRANSFER" && input.countAsExpense,
    categoryId: input.type === "TRANSFER" && !input.countAsExpense ? null : input.categoryId,
    scope: expenseLike ? input.scope : null,
    description: input.description,
    notes: input.notes,
    frequency: input.frequency,
    startDate: toDbDate(input.startDate),
    endDate: input.endDate ? toDbDate(input.endDate) : null,
    isActive: input.isActive,
  };
}

export async function createRecurring(input: RecurringInput, options: { today: ISODate; backfill: boolean }) {
  const { today, backfill } = options;
  const rule = await prisma.$transaction(async (tx) => {
    // Validate exactly like a transaction dated on the start date.
    await resolveEntry(tx, ruleToInput(input, input.startDate), { today });
    const index = backfill ? 0 : firstIndexOnOrAfter(input.startDate, input.frequency, today);
    return tx.recurringTransaction.create({
      data: { ...ruleData(input), ...scheduleState(input.startDate, input.frequency, input.endDate, index) },
      select: { id: true },
    });
  });
  await postDueForRule(rule.id, today);
  return rule;
}

export async function updateRecurring(id: string, input: RecurringInput, today: ISODate) {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.recurringTransaction.findUnique({
      where: { id },
      select: { frequency: true, startDate: true, occurrenceIndex: true, accountId: true, toAccountId: true, categoryId: true },
    });
    if (!existing) throw notFound("Recurring transaction");
    await resolveEntry(tx, ruleToInput(input, input.startDate), { today }, existing);

    const scheduleChanged = existing.frequency !== input.frequency || fromDbDate(existing.startDate) !== input.startDate;
    let index = existing.occurrenceIndex;
    if (scheduleChanged) {
      // Continue after the last posted occurrence; never re-post the past.
      const last = await tx.transaction.aggregate({ where: { recurringId: id }, _max: { occurrenceDate: true } });
      const lastPosted = last._max.occurrenceDate ? fromDbDate(last._max.occurrenceDate) : null;
      index = firstIndexOnOrAfter(input.startDate, input.frequency, today, lastPosted);
    }
    await tx.recurringTransaction.update({
      where: { id },
      data: { ...ruleData(input), ...scheduleState(input.startDate, input.frequency, input.endDate, index) },
    });
  });
  await postDueForRule(id, today);
}

/** Pause or resume. Resuming skips occurrences missed while paused. */
export async function setRecurringActive(id: string, isActive: boolean, today: ISODate) {
  await prisma.$transaction(async (tx) => {
    const rule = await loadRule(tx, id);
    if (!rule) throw notFound("Recurring transaction");
    const start = fromDbDate(rule.startDate);
    const end = rule.endDate ? fromDbDate(rule.endDate) : null;
    const index = isActive ? Math.max(rule.occurrenceIndex, firstIndexOnOrAfter(start, rule.frequency, today)) : rule.occurrenceIndex;
    await tx.recurringTransaction.update({ where: { id }, data: { isActive, ...scheduleState(start, rule.frequency, end, index) } });
  });
  if (isActive) await postDueForRule(id, today);
}

export async function skipNextOccurrence(id: string) {
  await prisma.$transaction(async (tx) => {
    const rule = await loadRule(tx, id);
    if (!rule) throw notFound("Recurring transaction");
    if (!rule.nextOccurrence) return;
    const start = fromDbDate(rule.startDate);
    await tx.recurringTransaction.update({
      where: { id },
      data: scheduleState(start, rule.frequency, rule.endDate ? fromDbDate(rule.endDate) : null, rule.occurrenceIndex + 1),
    });
  });
}

/** Deleting a rule keeps the transactions it already posted. */
export async function deleteRecurring(id: string) {
  const result = await prisma.recurringTransaction.deleteMany({ where: { id } });
  if (result.count === 0) throw notFound("Recurring transaction");
}

// ---------------------------------------------------------------------------
// Posting
// ---------------------------------------------------------------------------

/**
 * Post every due occurrence of one rule. Safe under concurrency: the rule row
 * is locked (SKIP LOCKED — a parallel run simply skips it) and each
 * occurrence is unique per (rule, date) in the database.
 */
export async function postDueForRule(id: string, today: ISODate): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "RecurringTransaction" WHERE "id" = ${id} FOR UPDATE SKIP LOCKED`;
    if (!locked.length) return 0;
    const rule = await loadRule(tx, id);
    if (!rule || !rule.isActive || !rule.nextOccurrence || fromDbDate(rule.nextOccurrence) > today) return 0;

    const start = fromDbDate(rule.startDate);
    const end = rule.endDate ? fromDbDate(rule.endDate) : null;
    let index = rule.occurrenceIndex;
    let posted = 0;
    let pause = false;

    while (posted < MAX_POSTS_PER_RUN) {
      const date = occurrenceDate(start, rule.frequency, index);
      if (date > today || (end && date > end)) break;
      try {
        // Validated as a brand-new entry: an inactive account or archived
        // category stops the rule rather than slipping through. No clock
        // time: a scheduled entry counts at the end of its day.
        const data = await resolveEntry(tx, ruleToInput(rule, date), { today });
        await tx.$executeRaw`SAVEPOINT occurrence`;
        try {
          await tx.transaction.create({ data: { ...data, recurringId: id, occurrenceDate: toDbDate(date) } });
          await tx.$executeRaw`RELEASE SAVEPOINT occurrence`;
          posted++;
        } catch (error) {
          await tx.$executeRaw`ROLLBACK TO SAVEPOINT occurrence`;
          if (!isUniqueViolation(error)) throw error;
          // Already posted (e.g. a concurrent run) — just move on.
        }
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        // The rule can no longer post validly (account deactivated, category
        // archived…). Pause it instead of writing bad data.
        console.warn(`[recurring] pausing ${id}: ${error.message}`);
        pause = true;
        break;
      }
      index++;
    }

    await tx.recurringTransaction.update({
      where: { id },
      data: { ...scheduleState(start, rule.frequency, end, index), ...(pause ? { isActive: false } : {}) },
    });
    return posted;
  });
}

export async function postAllDue(today: ISODate): Promise<number> {
  const due = await prisma.recurringTransaction.findMany({
    where: { isActive: true, nextOccurrence: { lte: toDbDate(today) } },
    select: { id: true },
  });
  let total = 0;
  for (const rule of due) total += await postDueForRule(rule.id, today);
  return total;
}

// Page loads trigger posting at most once a minute per server process; any
// concurrent callers await the same run.
let inflight: Promise<void> | null = null;
let lastRunAt = 0;
let lastRunDay: ISODate | null = null;

export function ensureRecurringPosted(today: ISODate): Promise<void> {
  if (inflight) return inflight;
  if (lastRunDay === today && Date.now() - lastRunAt < 60_000) return Promise.resolve();
  inflight = postAllDue(today)
    .then(() => undefined)
    .catch((error) => console.error("[recurring] posting failed", error))
    .finally(() => {
      lastRunAt = Date.now();
      lastRunDay = today;
      inflight = null;
    });
  return inflight;
}
