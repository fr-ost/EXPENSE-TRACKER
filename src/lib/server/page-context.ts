import "server-only";
import { todayInTimeZone, type ISODate } from "@/lib/dates";
import { requirePageSession } from "./auth/guard";
import { getSettings, type AppSettings } from "./settings";

export interface PageContext {
  settings: AppSettings;
  today: ISODate;
}

/**
 * Every protected page starts here: validates the session against the
 * database (independent of the proxy and the layout) and resolves "today"
 * in the user's timezone.
 */
export async function loadPageContext(): Promise<PageContext> {
  await requirePageSession();
  const settings = await getSettings();
  return { settings, today: todayInTimeZone(settings.timezone) };
}
