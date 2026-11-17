import "server-only";
import { after } from "next/server";
import { cache } from "react";
import { todayInTimeZone, type ISODate } from "@/lib/dates";
import { requirePageSession } from "./auth/guard";
import type { SessionState } from "./auth/session";
import { ensureDailyBackup } from "./services/drive";
import { ensureRecurringPosted } from "./services/recurring";
import { getSettings, type AppSettings } from "./settings";
import type { UserId } from "./user-id";

/** Once per request, however many parts of the page ask (the layout and the page both do). */
const dailyBackup = cache((userId: UserId, today: ISODate) => ensureDailyBackup(userId, today));

export interface PageContext {
  session: SessionState;
  /** Whose data this page shows: pass it to every service call. */
  userId: UserId;
  settings: AppSettings;
  today: ISODate;
}

/**
 * Every protected page starts here: validates the session against the
 * database (independent of the proxy and the layout), resolves "today" in the
 * user's timezone, and posts any recurring transactions that have come due.
 * Once the page has been sent, the day's backup to Google Drive is made if
 * one is due.
 */
export async function loadPageContext(): Promise<PageContext> {
  const session = await requirePageSession();
  const userId = session.userId;
  const settings = await getSettings(userId);
  const today = todayInTimeZone(settings.timezone);
  await ensureRecurringPosted(userId, today);
  // After the page has been sent: one cheap question to the database, and a backup only when one is due.
  after(() => dailyBackup(userId, today));
  return { session, userId, settings, today };
}
