import "server-only";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { prisma } from "../db";
import { AppError, invalid, tooManyRequests } from "../errors";
import type { UserId } from "../user-id";
import { formatRetryAfter } from "./rate-limit";
import { unlockSession, type SessionState } from "./session";

/**
 * The app lock. A user may set a PIN; the app then asks for it after a period
 * without activity, on "Lock now", and after every sign-in. It keeps someone
 * who picks up an unlocked phone or laptop out of the ledger.
 *
 * It is not a second password: whoever can sign in to the Google account can
 * remove a forgotten PIN (`resetPin`, shortly after signing in). The PIN is
 * stored only as a scrypt hash, and wrong guesses are counted per user, not
 * per device, so guessing can't be spread across sessions.
 */

interface ScryptCost {
  N: number;
  r: number;
  p: number;
  maxmem: number;
}

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number, options: ScryptCost) => Promise<Buffer>;

/**
 * scrypt cost: 16 MB and a few tens of milliseconds per check. A PIN has so
 * little entropy that no cost would protect a leaked hash for long; what
 * protects the PIN is the limit on tries (`checkPin`).
 */
const SCRYPT: ScryptCost = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_BYTES = 32;

export const PIN_PATTERN = /^\d{4,8}$/;

export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(pin, salt, KEY_BYTES, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function pinMatches(pin: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, key] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !key) return false;
  const expected = Buffer.from(key, "base64url");
  // The cost it was hashed with, so the cost can be raised later without locking anyone out.
  const cost = { N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem };
  if (![cost.N, cost.r, cost.p].every((value) => Number.isInteger(value) && value > 0)) return false;
  const actual = await scryptAsync(pin, Buffer.from(salt, "base64url"), expected.length, cost);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Wrong PINs allowed before a wait, and again after each wait. */
export const PIN_TRIES = 5;
/** The wait after the 5th, 10th, 15th… wrong PIN in a row: 1 min, 5 min, 30 min, then a day each time. */
const WAITS_MINUTES = [1, 5, 30, 24 * 60];

/** Minutes to wait after this many wrong PINs in a row (0: try again now). */
export function pinWaitMinutes(failures: number): number {
  if (failures <= 0 || failures % PIN_TRIES !== 0) return 0;
  return WAITS_MINUTES[Math.min(failures / PIN_TRIES, WAITS_MINUTES.length) - 1];
}

export type PinCheck = { status: "correct" } | { status: "incorrect"; remaining: number } | { status: "wait"; retryAfterSeconds: number };

const secondsUntil = (date: Date, now: number) => Math.max(1, Math.ceil((date.getTime() - now) / 1000));

/**
 * Check a PIN. A user's tries are taken one at a time (the row is locked), so
 * parallel guesses can't exceed the limit: the fifth wrong one in a row
 * starts a wait, and until it is over no PIN is looked at — not even the
 * right one.
 */
export async function checkPin(userId: UserId, pin: string): Promise<PinCheck> {
  return prisma.$transaction(async (tx) => {
    // NO KEY UPDATE: the user's own writes elsewhere (which lock this row for their foreign keys) carry on.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR NO KEY UPDATE`;
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { pinHash: true, pinFailures: true, pinLockedUntil: true },
    });
    // No PIN (removed meanwhile): there is nothing to get wrong.
    if (!user.pinHash) return { status: "correct" };

    const now = Date.now();
    if (user.pinLockedUntil && user.pinLockedUntil.getTime() > now) {
      return { status: "wait", retryAfterSeconds: secondsUntil(user.pinLockedUntil, now) };
    }

    if (await pinMatches(pin, user.pinHash)) {
      await tx.user.update({ where: { id: userId }, data: { pinFailures: 0, pinLockedUntil: null }, select: { id: true } });
      return { status: "correct" };
    }

    const failures = user.pinFailures + 1;
    const wait = pinWaitMinutes(failures);
    const lockedUntil = wait ? new Date(now + wait * 60_000) : null;
    await tx.user.update({ where: { id: userId }, data: { pinFailures: failures, pinLockedUntil: lockedUntil }, select: { id: true } });
    return lockedUntil
      ? { status: "wait", retryAfterSeconds: secondsUntil(lockedUntil, now) }
      : { status: "incorrect", remaining: PIN_TRIES - (failures % PIN_TRIES) };
  });
}

/** Throw the right error for a PIN that wasn't accepted. */
export function assertPinAccepted(check: PinCheck): asserts check is { status: "correct" } {
  if (check.status === "wait") {
    throw tooManyRequests(`Too many wrong PINs. Try again in ${formatRetryAfter(check.retryAfterSeconds)}.`, check.retryAfterSeconds);
  }
  if (check.status === "incorrect") {
    const tries = check.remaining === 1 ? "1 try" : `${check.remaining} tries`;
    throw new AppError(401, "invalid_credentials", `Incorrect PIN. ${tries} left before a wait.`, { pin: "Incorrect PIN." });
  }
}

/** Unlock a locked session with the PIN. */
export async function unlockWithPin(userId: UserId, sessionId: string, pin: string): Promise<void> {
  assertPinAccepted(await checkPin(userId, pin));
  await unlockSession(sessionId);
}

/** Turn the app lock on, or change the PIN (which needs the current one). */
export async function setPin(userId: UserId, pin: string, currentPin: string | null): Promise<void> {
  if (!PIN_PATTERN.test(pin)) throw invalid("Choose a PIN of 4 to 8 digits.", { pin: "Use 4 to 8 digits." });
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { pinHash: true } });
  if (user.pinHash) {
    if (!currentPin) throw invalid("Enter your current PIN.", { currentPin: "Enter your current PIN." });
    assertPinAccepted(await checkPin(userId, currentPin));
  }
  await prisma.user.update({
    where: { id: userId },
    data: { pinHash: await hashPin(pin), pinFailures: 0, pinLockedUntil: null },
    select: { id: true },
  });
}

/** Turn the app lock off, with the current PIN. */
export async function removePin(userId: UserId, currentPin: string): Promise<void> {
  assertPinAccepted(await checkPin(userId, currentPin));
  await clearPin(userId);
}

async function clearPin(userId: UserId): Promise<void> {
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { pinHash: null, pinFailures: 0, pinLockedUntil: null }, select: { id: true } }),
    // Nothing is locked without a PIN.
    prisma.session.updateMany({ where: { userId }, data: { lockedAt: null } }),
  ]);
}

/** How recently someone must have signed in with Google to remove a forgotten PIN. */
export const PIN_RESET_WINDOW_MS = 10 * 60 * 1000;

type SignedIn = Pick<SessionState, "createdAt" | "lockedSinceSignIn">;

/**
 * A forgotten PIN can be removed from a session that Google signed in within
 * the last ten minutes and that is still waiting for the PIN. Once the PIN
 * has opened it, a later lock (the device left lying about) can't be undone
 * this way: that takes signing in with Google again.
 */
export function canResetPin(session: SignedIn): boolean {
  return session.lockedSinceSignIn && Date.now() - session.createdAt.getTime() < PIN_RESET_WINDOW_MS;
}

/**
 * Forgotten PIN: someone who has just signed in with Google may remove it
 * (and set a new one in Settings). The Google account is what proves who
 * they are; the PIN only guards a device left unlocked.
 */
export async function resetPin(userId: UserId, session: SignedIn): Promise<void> {
  if (!canResetPin(session)) {
    throw new AppError(403, "reauthentication_required", "Sign in with Google again to remove your PIN.");
  }
  await clearPin(userId);
}
