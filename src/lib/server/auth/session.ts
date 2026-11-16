import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { SESSION_COOKIE } from "@/lib/auth-cookie";
import { prisma } from "../db";
import { asUserId, type UserId } from "../user-id";

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
  /** Whose data this session may touch. */
  userId: UserId;
  createdAt: Date;
  expiresAt: Date;
  /** Waiting for the PIN. Always false for a user without one. */
  locked: boolean;
  /** Locked, and not opened with the PIN since signing in with Google (see `canResetPin`). */
  lockedSinceSignIn: boolean;
  /** The user has set an app-lock PIN. */
  hasPin: boolean;
  /** Minutes of inactivity before the app locks; 0 when it never does (no PIN, or turned off). */
  autoLockMinutes: number;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * A new session for someone Google has just signed in. With an app-lock PIN
 * it starts locked: signing out and in again is not a way around the PIN.
 */
export async function createSession(userId: UserId, userAgent: string | null) {
  const token = randomBytes(32).toString("base64url");
  const id = hashToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE_MS);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { pinHash: true } });
  await prisma.session.create({
    // Locked at the very moment it was created: that is how "not opened since signing in" is told apart.
    data: { id, userId, createdAt: now, expiresAt, userAgent: userAgent?.slice(0, 255) ?? null, lockedAt: user.pinHash ? now : null },
  });
  return { token, expiresAt };
}

/**
 * Resolve a cookie token to a session; expired sessions are deleted. With an
 * app-lock PIN, a session idle for longer than the user's auto-lock period
 * becomes locked server-side, so closing the tab does not bypass the lock.
 */
export async function readSession(token: string | undefined | null): Promise<SessionState | null> {
  if (!token || token.length > 100) return null;

  const id = hashToken(token);
  const session = await prisma.session.findUnique({
    where: { id },
    include: { user: { select: { autoLockMinutes: true, pinHash: true } } },
  });
  if (!session) return null;

  const now = Date.now();
  if (session.expiresAt.getTime() <= now || now - session.lastSeenAt.getTime() > SESSION_IDLE_TIMEOUT_MS) {
    await prisma.session.deleteMany({ where: { id } });
    return null;
  }

  const hasPin = session.user.pinHash !== null;
  const autoLockMinutes = hasPin ? session.user.autoLockMinutes : 0;
  let locked = hasPin && session.lockedAt !== null;
  const lockedSinceSignIn = locked && session.lockedAt!.getTime() === session.createdAt.getTime();
  if (!locked && autoLockMinutes > 0 && now - session.lastSeenAt.getTime() > autoLockMinutes * 60_000) {
    await prisma.session.update({ where: { id }, data: { lockedAt: new Date() } });
    locked = true;
  }

  return {
    id,
    userId: asUserId(session.userId),
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    locked,
    lockedSinceSignIn,
    hasPin,
    autoLockMinutes,
  };
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
  await prisma.session.updateMany({ where: { id }, data: { lockedAt: null, lastSeenAt: new Date() } });
}

export async function deleteSession(id: string): Promise<void> {
  await prisma.session.deleteMany({ where: { id } });
}

export async function deleteOtherSessions(userId: UserId, keepId: string): Promise<number> {
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
