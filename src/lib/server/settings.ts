import "server-only";
import { cache } from "react";
import { todayInTimeZone, type ISODate } from "@/lib/dates";
import type { NumberFormat } from "@/lib/domain";
import { prisma } from "./db";

export interface AppSettings {
  displayName: string;
  baseCurrency: string;
  timezone: string;
  numberFormat: NumberFormat;
  autoLockMinutes: number;
}

/** The single user's preferences (memoised per request). */
export const getSettings = cache(async (): Promise<AppSettings> => {
  const user = await prisma.user.findFirst({
    select: { displayName: true, baseCurrency: true, timezone: true, numberFormat: true, autoLockMinutes: true },
  });
  if (!user) throw new Error("No user exists. Run the bootstrap step (see README).");
  return user;
});

export async function getToday(): Promise<ISODate> {
  const settings = await getSettings();
  return todayInTimeZone(settings.timezone);
}
