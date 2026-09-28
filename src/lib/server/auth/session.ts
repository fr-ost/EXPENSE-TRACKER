import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { SESSION_COOKIE } from "@/lib/auth-cookie";
import { prisma } from "../db";
import { adminPassword, credentialMatches, requireAdminPassword, sessionCredential } from "./password";

export { SESSION_COOKIE };

/** Absolute lifetime of a session, regardless of activity. */
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** A session unused for this long is discarded entirely (not just locked). */
export const SESSION_IDLE_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;
/** `lastSeenAt` is only written when older than this, to avoid a write per request. */
const TOUCH_INTERVAL_MS = 30 * 1000;

const isProduction = process.env.NODE_ENV === "production";

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax" as const,
    path: "/",
    expires: expiresAt,
  };
}

export interface SessionState {
  id: string;
  userId: string;
  expiresAt: Date;
  locked: boolean;
  autoLockMinutes: number;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string, userAgent: string | null) {
  const token = randomBytes(32).toString("base64url");
  const id = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS);
  const credential = sessionCredential(id, requireAdminPassword());
  await prisma.session.create({
    data: { id, userId, credential, expiresAt, userAgent: userAgent?.slice(0, 255) ?? null },
  });
  return { token, expiresAt };
}

/**
 * Resolve a cookie token to a session. Expired sessions, and sessions created
 * with a different password, are deleted. A session idle for longer than the
 * user's auto-lock period becomes locked server-side, so closing the tab does
 * not bypass the lock.
 */
export async function readSession(token: string | undefined | null): Promise<SessionState | null> {
  if (!token || token.length > 100) return null;
  // Without a configured password nobody is signed in (sessions are kept, so
  // restoring the same variable brings them back).
  const password = adminPassword();
  if (!password) return null;

  const id = hashToken(token);
  const session = await prisma.session.findUnique({
    where: { id },
    include: { user: { select: { autoLockMinutes: true } } },
  });
  if (!session) return null;

  const now = Date.now();
  if (
    session.expiresAt.getTime() <= now ||
    now - session.lastSeenAt.getTime() > SESSION_IDLE_TIMEOUT_MS ||
    !credentialMatches(session.credential, id, password)
  ) {
    await prisma.session.deleteMany({ where: { id } });
    return null;
  }

  const autoLockMinutes = session.user.autoLockMinutes;
  let locked = session.lockedAt !== null;
  if (!locked && autoLockMinutes > 0 && now - session.lastSeenAt.getTime() > autoLockMinutes * 60_000) {
    await prisma.session.update({ where: { id }, data: { lockedAt: new Date() } });
    locked = true;
  }

  return { id, userId: session.userId, expiresAt: session.expiresAt, locked, autoLockMinutes };
}

/** Record activity (throttled). Only called for unlocked sessions. */
export async function touchSession(id: string): Promise<void> {
  await prisma.session.updateMany({
    where: { id, lockedAt: null, lastSeenAt: { lt: new Date(Date.now() - TOUCH_INTERVAL_MS) } },
    data: { lastSeenAt: new Date() },
  });
}

export async function lockSession(id: string): Promise<void> {
  await prisma.session.updateMany({ where: { id, lockedAt: null }, data: { lockedAt: new Date() } });
}

export async function unlockSession(id: string): Promise<void> {
  await prisma.session.update({ where: { id }, data: { lockedAt: null, lastSeenAt: new Date(), failedUnlocks: 0 } });
}

export async function deleteSession(id: string): Promise<void> {
  await prisma.session.deleteMany({ where: { id } });
}

export async function deleteOtherSessions(userId: string, keepId: string): Promise<number> {
  const result = await prisma.session.deleteMany({ where: { userId, id: { not: keepId } } });
  return result.count;
}

export async function pruneExpiredSessions(): Promise<void> {
  await prisma.session.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: new Date() } }, { lastSeenAt: { lt: new Date(Date.now() - SESSION_IDLE_TIMEOUT_MS) } }],
    },
  });
}
