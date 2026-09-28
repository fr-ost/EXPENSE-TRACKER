import "server-only";
import { cache } from "react";
import { timeInTimeZone, todayInTimeZone, type ISODate } from "@/lib/dates";
import { OWNER_NAME, type NumberFormat } from "@/lib/domain";
import { prisma } from "./db";
import { isUniqueViolation } from "./services/mappers";

export interface AppSettings {
  displayName: string;
  baseCurrency: string;
  timezone: string;
  numberFormat: NumberFormat;
  autoLockMinutes: number;
}

const settingsSelect = {
  displayName: true,
  baseCurrency: true,
  timezone: true,
  numberFormat: true,
  autoLockMinutes: true,
} as const;

/**
 * The owner's row, created on first use with default preferences (all
 * editable in Settings). There is no sign-up: this is the only row that can
 * ever exist, enforced by the database.
 */
export async function ensureOwner(): Promise<{ id: string }> {
  const existing = await prisma.user.findFirst({ select: { id: true } });
  if (existing) return existing;
  try {
    return await prisma.user.create({ data: { singleton: true, displayName: OWNER_NAME }, select: { id: true } });
  } catch (error) {
    // Another request created it at the same moment.
    if (isUniqueViolation(error)) return prisma.user.findFirstOrThrow({ select: { id: true } });
    throw error;
  }
}

/** The owner's preferences (memoised per request). */
export const getSettings = cache(async (): Promise<AppSettings> => {
  const user = await prisma.user.findFirst({ select: settingsSelect });
  if (user) return user;
  await ensureOwner();
  return prisma.user.findFirstOrThrow({ select: settingsSelect });
});

export async function getToday(): Promise<ISODate> {
  const settings = await getSettings();
  return todayInTimeZone(settings.timezone);
}

/** The owner's local date and time of day (to the second), read together. */
export async function getClock(): Promise<{ today: ISODate; time: string }> {
  const settings = await getSettings();
  const now = new Date();
  return { today: todayInTimeZone(settings.timezone, now), time: timeInTimeZone(settings.timezone, now, true) };
}
