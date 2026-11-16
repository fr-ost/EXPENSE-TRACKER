import "server-only";
import { cache } from "react";
import { timeInTimeZone, todayInTimeZone, type ISODate } from "@/lib/dates";
import type { NumberFormat } from "@/lib/domain";
import { prisma } from "./db";
import type { UserId } from "./user-id";

export interface AppSettings {
  displayName: string;
  baseCurrency: string;
  timezone: string;
  numberFormat: NumberFormat;
  autoLockMinutes: number;
  /** The currency a new income / expense starts in (null: the main currency). */
  incomeCurrency: string | null;
  expenseCurrency: string | null;
}

const settingsSelect = {
  displayName: true,
  baseCurrency: true,
  timezone: true,
  numberFormat: true,
  autoLockMinutes: true,
  incomeCurrency: true,
  expenseCurrency: true,
} as const;

/** A user's preferences (memoised per request). */
export const getSettings = cache(
  (userId: UserId): Promise<AppSettings> => prisma.user.findUniqueOrThrow({ where: { id: userId }, select: settingsSelect }),
);

/** The Google account a user signs in with (null for the owner from before Google sign-in). */
export async function getAccountEmail(userId: UserId): Promise<string | null> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
  return user.email;
}

export async function getToday(userId: UserId): Promise<ISODate> {
  const settings = await getSettings(userId);
  return todayInTimeZone(settings.timezone);
}

/** The user's local date and time of day (to the second), read together. */
export async function getClock(userId: UserId): Promise<{ today: ISODate; time: string }> {
  const settings = await getSettings(userId);
  const now = new Date();
  return { today: todayInTimeZone(settings.timezone, now), time: timeInTimeZone(settings.timezone, now, true) };
}
