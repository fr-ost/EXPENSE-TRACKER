import "server-only";
import { todayInTimeZone, type ISODate } from "@/lib/dates";
import { requirePageSession } from "./auth/guard";
import type { SessionState } from "./auth/session";
import { ensureRecurringPosted } from "./services/recurring";
import { getSettings, type AppSettings } from "./settings";
import type { UserId } from "./user-id";

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
 */
export async function loadPageContext(): Promise<PageContext> {
  const session = await requirePageSession();
  const userId = session.userId;
  const settings = await getSettings(userId);
  const today = todayInTimeZone(settings.timezone);
  await ensureRecurringPosted(userId, today);
  return { session, userId, settings, today };
}
