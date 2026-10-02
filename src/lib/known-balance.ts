import type { ISODate } from "./dates";
import type { AccountSummary } from "./types";

/**
 * Where an entry lands relative to an account's latest known balance, on the
 * client. The ledger views are the authority; this mirrors their order within
 * a day to explain it before saving.
 */

export interface KnownBalance {
  date: ISODate;
  /** As shown ("HH:MM"), or null when not known. */
  time: string | null;
  /** The opening balance (start of its day) rather than a balance update. */
  opening: boolean;
}

/** The latest balance Hisab knows for an account: its last balance update, or the opening balance. */
export function latestKnownBalance(account: Pick<AccountSummary, "openingDate" | "lastUpdate">): KnownBalance {
  const update = account.lastUpdate;
  if (!update || update.date < account.openingDate) return { date: account.openingDate, time: "00:00", opening: true };
  return { date: update.date, time: update.time, opening: false };
}

/**
 * The latest moment Hisab knows a balance was true — for an SMS, when it was
 * sent. A message older than this doesn't become the current balance.
 */
export function latestReportedBalance(account: Pick<AccountSummary, "openingDate" | "lastUpdate">): KnownBalance {
  const update = account.lastUpdate;
  if (!update || update.reportedDate < account.openingDate) return { date: account.openingDate, time: "00:00", opening: true };
  return { date: update.reportedDate, time: update.reportedTime, opening: false };
}

/**
 * Whether something dated `date` (at `time`, "" when none) lands before a
 * known balance, which then already includes it: it only shapes the history
 * before it. Without a time, an entry recorded today counts from now, and one
 * for an earlier day from the end of that day.
 */
export function landsBefore(date: ISODate, time: string, known: KnownBalance, today: ISODate): boolean {
  if (date !== known.date) return date < known.date;
  if (known.opening) return false;
  if (time) return known.time ? time <= known.time : known.date !== today;
  return date !== today && !known.time;
}
