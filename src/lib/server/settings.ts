import "server-only";
import { cache } from "react";
import { timeInTimeZone, todayInTimeZone, type ISODate } from "@/lib/dates";
import { OWNER_NAME, type NumberFormat } from "@/lib/domain";
import { prisma } from "./db";
import { createUser } from "./services/users";
import { asUserId, type UserId } from "./user-id";

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

/** Serialises the first sign-ins, so they create one owner between them. */
const OWNER_LOCK = 7_215_001;

/**
 * The owner: whoever the password signs in. Created on first use with default
 * preferences and the starter categories (all editable in Settings).
 */
export async function ensureOwner(): Promise<{ id: UserId }> {
  const first = (client: Pick<typeof prisma, "user">) =>
    client.user.findFirst({ orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true } });
  const existing = await first(prisma);
  if (existing) return { id: asUserId(existing.id) };
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${OWNER_LOCK})`;
    const created = await first(tx);
    return { id: created ? asUserId(created.id) : await createUser(tx, { displayName: OWNER_NAME }) };
  });
}

/** A user's preferences (memoised per request). */
export const getSettings = cache(
  (userId: UserId): Promise<AppSettings> => prisma.user.findUniqueOrThrow({ where: { id: userId }, select: settingsSelect }),
);

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
