import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../db";
import { AppError, invalid } from "../errors";
import { asUserId, type UserId } from "../user-id";

/**
 * Phones that hand their bank and wallet SMS to an account (the Android app).
 *
 * Linking: the signed-in user asks for a one-time code in the app's browser
 * (`startDeviceLink`); the page passes it to the Android app, which exchanges
 * it for a token of its own (`completeDeviceLink`). The code is good for a
 * few minutes and for one phone.
 *
 * A token only lets a phone hand messages in (services/sms-inbox.ts). It
 * reads nothing, so a lost or copied token cannot show anyone the ledger; the
 * user removes the phone in Settings and the token is dead. Only hashes are
 * stored.
 */

/** How long a link code can be collected. */
export const LINK_CODE_MINUTES = 10;
/** More than anyone has; stops a script from filling the table. */
const MAX_DEVICES = 10;
const MAX_PENDING = 5;

const hash = (secret: string) => createHash("sha256").update(secret, "utf8").digest("hex");
const newSecret = () => randomBytes(32).toString("base64url");

export interface DeviceView {
  id: string;
  name: string;
  /** ISO instants. */
  linkedAt: string;
  lastSeenAt: string | null;
  appVersion: string | null;
}

/** The phones linked to this account, newest first. */
export async function listDevices(userId: UserId): Promise<DeviceView[]> {
  const devices = await prisma.device.findMany({
    where: { userId, pendingUntil: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, createdAt: true, lastSeenAt: true, appVersion: true },
  });
  return devices.map((d) => ({
    id: d.id,
    name: d.name,
    linkedAt: d.createdAt.toISOString(),
    lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
    appVersion: d.appVersion,
  }));
}

/** A one-time code the Android app on this phone turns into its token. */
export async function startDeviceLink(userId: UserId): Promise<{ code: string; expiresInSeconds: number }> {
  const now = new Date();
  // Codes nobody collected.
  await prisma.device.deleteMany({ where: { userId, pendingUntil: { lt: now } } });
  const [linked, pending] = await Promise.all([
    prisma.device.count({ where: { userId, pendingUntil: null } }),
    prisma.device.count({ where: { userId, pendingUntil: { not: null } } }),
  ]);
  if (linked >= MAX_DEVICES) throw invalid(`${MAX_DEVICES} phones are linked already. Remove one first.`);
  if (pending >= MAX_PENDING) throw new AppError(429, "rate_limited", "Too many tries just now. Wait a few minutes and try again.");

  const code = newSecret();
  await prisma.device.create({
    data: { userId, name: "Android phone", tokenHash: hash(code), pendingUntil: new Date(now.getTime() + LINK_CODE_MINUTES * 60_000) },
  });
  return { code, expiresInSeconds: LINK_CODE_MINUTES * 60 };
}

/**
 * The phone collects its token with the code it was handed. Whoever holds a
 * live code is the phone the user just linked: the code is the proof.
 */
export async function completeDeviceLink(code: string, phone: { name: string; appVersion: string | null }): Promise<{ token: string }> {
  const token = newSecret();
  const now = new Date();
  // One statement, so a code works once even if it is sent twice at the same moment.
  const { count } = await prisma.device.updateMany({
    // The code is the credential here: it names exactly one account's pending row.
    where: { tokenHash: hash(code), pendingUntil: { gt: now } },
    data: { tokenHash: hash(token), pendingUntil: null, name: phone.name, appVersion: phone.appVersion, createdAt: now },
  });
  if (count !== 1) throw invalid("That link has expired. Start again from Settings in Hisab.");
  return { token };
}

/** Whose phone a token belongs to, or null. */
export async function authenticateDevice(token: string): Promise<{ id: string; userId: UserId } | null> {
  if (!token || token.length > 200) return null;
  const device = await prisma.device.findUnique({
    where: { tokenHash: hash(token) },
    select: { id: true, userId: true, pendingUntil: true },
  });
  // A code that hasn't been exchanged is not a token.
  if (!device || device.pendingUntil) return null;
  return { id: device.id, userId: asUserId(device.userId) };
}

/** The phone handed something in. */
export async function touchDevice(userId: UserId, id: string, appVersion: string | null): Promise<void> {
  await prisma.device.updateMany({ where: { id, userId }, data: { lastSeenAt: new Date(), ...(appVersion ? { appVersion } : {}) } });
}

/** Unlink a phone: its token stops working at once. Messages it handed in stay. */
export async function removeDevice(userId: UserId, id: string): Promise<void> {
  const { count } = await prisma.device.deleteMany({ where: { id, userId } });
  if (count !== 1) throw new AppError(404, "not_found", "That phone isn't linked any more.");
}
