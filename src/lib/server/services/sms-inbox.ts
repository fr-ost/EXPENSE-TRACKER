import "server-only";
import {
  buildItem,
  isBalanceOnly,
  itemPayload,
  needsBalanceSaved,
  ownAccountId,
  reportedBalance,
  type ReceivedAt,
  type SmsItem,
} from "@/components/sms/sms-model";
import { rememberKey } from "@/components/sms/sms-suggest";
import { timeInTimeZone, todayInTimeZone, type Clock, type ISODate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { parseSms } from "@/lib/sms/parse";
import type { AccountSummary, CategoryRef } from "@/lib/types";
import { prisma } from "../db";
import { AppError } from "../errors";
import { getSettings, type AppSettings } from "../settings";
import type { UserId } from "../user-id";
import { listAccounts } from "./accounts";
import { listCategories } from "./categories";
import { checkSms, importSms, saveSmsBalances, smsFingerprint } from "./sms";

/**
 * Messages a linked phone hands in (the Android app, services/devices.ts).
 *
 * Each one is read exactly as the Import SMS page reads a pasted message —
 * the same parser, the same account and category suggestions, the same
 * duplicate checks — and then:
 *
 *   - not a transaction (a code, an advert, a failed payment): dropped, never
 *     stored;
 *   - complete and certain: added to the ledger, with its fee and the balance
 *     it reports, under the message's own key, so the same message handed in
 *     again (or pasted later) is never added twice;
 *   - anything else (no matching account, an unclear message, something
 *     similar already recorded): kept in "SmsInbox" until the user looks at
 *     it on the Import SMS page.
 */

export interface IncomingSms {
  text: string;
  /** Who sent it, as the phone shows it ("bKash", "16216"). */
  sender: string;
  /** When the phone received it: milliseconds since 1970. */
  receivedAt: number;
}

export type InboxOutcome =
  /** Its transaction is in the ledger; `title` and `detail` say which, for the phone's notification. */
  | { status: "added"; title: string; detail: string }
  /** It only reported a balance, which is now the account's. */
  | { status: "balance"; title: string; detail: string }
  /** Added earlier: the same message, from this phone or by hand. */
  | { status: "exists" }
  /** Waiting on the Import SMS page. */
  | { status: "review" }
  /** Not a transaction; not kept. */
  | { status: "ignored" };

/** A message waiting for the user. */
export interface WaitingSms {
  id: string;
  text: string;
  sender: string;
  /** When the phone received it, in the user's timezone. */
  receivedAt: ReceivedAt;
}

/** How many messages the Import SMS page takes at a time (the importer's own limit). */
export const WAITING_PAGE = 50;
/** Beyond this the oldest waiting messages give way to new ones. */
const MAX_WAITING = 500;

interface Reading {
  userId: UserId;
  deviceId: string;
  settings: AppSettings;
  clock: Required<Clock>;
  accounts: AccountSummary[];
  categories: CategoryRef[];
  remembered: Record<string, string>;
}

function localMoment(instant: Date, timeZone: string): ReceivedAt {
  return { date: todayInTimeZone(timeZone, instant), time: timeInTimeZone(timeZone, instant) };
}

/**
 * The account each bank or wallet's earlier messages were recorded on — what
 * the Import SMS page remembers in the browser, read here from the ledger:
 * every SMS transaction keeps its message as its note.
 */
async function rememberedAccounts(userId: UserId, today: ISODate): Promise<Record<string, string>> {
  const rows = await prisma.transaction.findMany({
    where: { userId, idempotencyKey: { startsWith: "sms:", endsWith: ":0" }, notes: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 300,
    select: { type: true, accountId: true, toAccountId: true, notes: true },
  });
  const remembered: Record<string, string> = {};
  // Oldest first, so the most recent choice wins.
  for (const row of rows.reverse()) {
    try {
      const parsed = parseSms(row.notes ?? "", { today });
      const own = row.type === "TRANSFER" && parsed.direction === "credit" ? row.toAccountId : row.accountId;
      const key = rememberKey(parsed);
      if (!key || !own) continue;
      remembered[key] = own;
      if (parsed.provider) remembered[`${parsed.provider.id}:`] = own;
    } catch {
      // A note that is no longer a message.
    }
  }
  return remembered;
}

async function keepForReview(reading: Reading, message: IncomingSms, receivedAt: Date): Promise<InboxOutcome> {
  const { userId, deviceId } = reading;
  await prisma.smsInbox.createMany({
    data: [{ userId, deviceId, fingerprint: smsFingerprint(message.text), text: message.text, sender: message.sender, receivedAt }],
    // Handed in before (by this phone or another): it waits once.
    skipDuplicates: true,
  });
  const extra = (await prisma.smsInbox.count({ where: { userId } })) - MAX_WAITING;
  if (extra > 0) {
    const oldest = await prisma.smsInbox.findMany({ where: { userId }, orderBy: { receivedAt: "asc" }, take: extra, select: { id: true } });
    await prisma.smsInbox.deleteMany({ where: { userId, id: { in: oldest.map((row) => row.id) } } });
  }
  return { status: "review" };
}

/** What was added, in a line or two (for the phone's notification). */
function describe(item: SmsItem, reading: Reading, balanceSaved: boolean): { title: string; detail: string } {
  const { accounts, settings } = reading;
  const own = accounts.find((a) => a.id === ownAccountId(item));
  const source = accounts.find((a) => a.id === item.draft.accountId) ?? own;
  const money = (value: string, currency: string | undefined) =>
    formatMoney(value, { currency: currency ?? settings.baseCurrency, grouping: settings.numberFormat });
  const verb = item.draft.type === "INCOME" ? "Received" : item.draft.type === "TRANSFER" ? "Moved" : "Spent";
  const title = [`${verb} ${money(item.draft.amount, source?.currency)}`, item.draft.description].filter(Boolean).join(" · ");
  const detail = [
    own?.name,
    item.fee && item.includeFee && item.fee.amount ? `fee ${money(item.fee.amount, own?.currency)}` : null,
    balanceSaved && item.parsed.balance ? `balance ${money(item.parsed.balance, own?.currency)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return { title, detail };
}

async function receiveOne(reading: Reading, message: IncomingSms, receivedAt: Date): Promise<InboxOutcome> {
  const { userId, settings, clock, accounts, categories, remembered } = reading;
  const context = { accounts, categories, today: clock.today, remembered, receivedAt: localMoment(receivedAt, settings.timezone) };
  const first = buildItem(message.text, context);

  if (isBalanceOnly(first)) {
    // "Your balance is Tk 8,000": nothing to add, but it is the account's balance — when the message says whose.
    const reported = first.ownMatched ? reportedBalance(first, accounts, clock.today) : null;
    if (!reported) return keepForReview(reading, message, receivedAt);
    const [{ saved }] = await saveSmsBalances(
      userId,
      [
        {
          text: message.text,
          balance: { accountId: reported.account.id, amount: reported.amount },
          reportedAt: { date: first.draft.date, time: first.draft.time || null },
        },
      ],
      clock,
    );
    if (!saved) return keepForReview(reading, message, receivedAt);
    return {
      status: "balance",
      title: `Balance ${formatMoney(reported.amount, { currency: reported.account.currency, grouping: settings.numberFormat })}`,
      detail: reported.account.name,
    };
  }
  if (first.parsed.ignored) return { status: "ignored" };

  // Was it added before, and how was the same description recorded last time?
  const [check] = await checkSms(userId, [{ text: message.text, description: first.draft.description }]);
  const item = buildItem(message.text, { ...context, check });

  if (item.status === "exists") {
    // Added earlier, perhaps without the balance it reports.
    const reported = needsBalanceSaved(item, accounts, clock.today) ? reportedBalance(item, accounts, clock.today) : null;
    if (reported) {
      await saveSmsBalances(userId, [{ text: message.text, balance: { accountId: reported.account.id, amount: reported.amount }, reportedAt: null }], clock);
    }
    await prisma.smsInbox.deleteMany({ where: { userId, fingerprint: smsFingerprint(message.text) } });
    return { status: "exists" };
  }

  if (item.status === "ready") {
    const payload = itemPayload(item, accounts, clock.today);
    if (payload.ok) {
      // A fee is always an expense (itemPayload builds it as one).
      const fee = payload.fee?.type === "EXPENSE" ? payload.fee : null;
      const [result] = await importSms(
        userId,
        { items: [{ text: message.text, transaction: payload.transaction, fee, balance: payload.balance, allowDuplicate: false, sameAs: null }] },
        clock.today,
        clock.time,
      );
      if (result.status === "added") return { status: "added", ...describe(item, reading, result.balanceSaved) };
      if (result.status === "exists") return { status: "exists" };
      // Something similar is already recorded, or the ledger's rules refuse it: the user decides.
    }
  }
  return keepForReview(reading, message, receivedAt);
}

/**
 * Take in messages from a phone, oldest first (a later message's balance and
 * duplicate check build on the earlier ones). Results are in the order given.
 */
export async function receiveSms(userId: UserId, deviceId: string, messages: IncomingSms[]): Promise<InboxOutcome[]> {
  const settings = await getSettings(userId);
  const now = new Date();
  const today = todayInTimeZone(settings.timezone, now);
  const clock = { today, time: timeInTimeZone(settings.timezone, now, true) };
  const [accounts, categories, remembered] = await Promise.all([
    listAccounts(userId, today),
    listCategories(userId),
    rememberedAccounts(userId, today),
  ]);
  const reading: Reading = { userId, deviceId, settings, clock, accounts, categories, remembered };

  const outcomes = new Array<InboxOutcome>(messages.length);
  const inOrder = messages.map((message, index) => ({ message, index })).sort((a, b) => a.message.receivedAt - b.message.receivedAt || a.index - b.index);
  for (const { message, index } of inOrder) {
    // A phone's clock can run ahead; a message can't arrive after now.
    const receivedAt = new Date(Math.min(message.receivedAt, now.getTime()));
    try {
      outcomes[index] = await receiveOne(reading, message, receivedAt);
    } catch (error) {
      // One message that can't be read must not lose the others, nor itself.
      if (!(error instanceof AppError)) console.error("[sms-inbox] a message couldn't be read", error instanceof Error ? error.message : error);
      outcomes[index] = await keepForReview(reading, message, receivedAt);
    }
  }
  return outcomes;
}

/** How many messages are waiting for the user. */
export function countWaitingSms(userId: UserId): Promise<number> {
  return prisma.smsInbox.count({ where: { userId } });
}

/** The messages waiting for the user, newest first, a page at a time. */
export async function listWaitingSms(userId: UserId): Promise<{ messages: WaitingSms[]; total: number }> {
  const settings = await getSettings(userId);
  const [rows, total] = await Promise.all([
    prisma.smsInbox.findMany({
      where: { userId },
      orderBy: [{ receivedAt: "desc" }, { id: "asc" }],
      take: WAITING_PAGE,
      select: { id: true, text: true, sender: true, receivedAt: true },
    }),
    countWaitingSms(userId),
  ]);
  return {
    messages: rows.map((row) => ({ id: row.id, text: row.text, sender: row.sender, receivedAt: localMoment(row.receivedAt, settings.timezone) })),
    total,
  };
}

/** The user doesn't want these: they stop waiting. */
export async function dismissWaitingSms(userId: UserId, ids: string[]): Promise<number> {
  const { count } = await prisma.smsInbox.deleteMany({ where: { userId, id: { in: ids } } });
  return count;
}
