import "server-only";
import { todayInTimeZone, type ISODate } from "@/lib/dates";
import { requirePageSession } from "./auth/guard";
import { ensureRecurringPosted } from "./services/recurring";
import { getSettings, type AppSettings } from "./settings";

export interface PageContext {
  settings: AppSettings;
  today: ISODate;
}

/**
 * Every protected page starts here: validates the session against the
 * database (independent of the proxy and the layout), resolves "today" in the
 * user's timezone, and posts any recurring transactions that have come due.
 */
export async function loadPageContext(): Promise<PageContext> {
  await requirePageSession();
  const settings = await getSettings();
  const today = todayInTimeZone(settings.timezone);
  await ensureRecurringPosted(today);
  return { settings, today };
}
