import "server-only";
import { prisma } from "../db";
import type { UserId } from "../user-id";

/**
 * Sign-ins that come back from Google and fail (a made-up code, a stale or
 * forged answer) are limited per client address: 20 per 15 minutes. Each one
 * costs a request to Google, so a client that keeps failing is made to wait.
 *
 * There is nothing to guess here — Google checks the password — so there is
 * no overall limit: one client misbehaving never keeps other people out.
 *
 * Attempts are recorded as failures before the sign-in is checked and flipped
 * to success afterwards, so concurrent requests cannot race past the limit.
 */
const WINDOW_MS = 15 * 60 * 1000;
const PER_IP_LIMIT = 20;
const RETENTION_MS = 24 * 60 * 60 * 1000;

export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export async function checkSignInAttempt(ip: string): Promise<RateLimitResult> {
  const failures = await prisma.loginAttempt.findMany({
    where: { ip, success: false, createdAt: { gte: new Date(Date.now() - WINDOW_MS) } },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  if (failures.length < PER_IP_LIMIT) return { allowed: true };
  // The window reopens when enough of the oldest failures have aged out.
  const oldestRelevant = failures[failures.length - PER_IP_LIMIT].createdAt;
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((oldestRelevant.getTime() + WINDOW_MS - Date.now()) / 1000)) };
}

/** Record a pending attempt (counted as a failure until marked successful). */
export async function beginSignInAttempt(ip: string): Promise<string> {
  const attempt = await prisma.loginAttempt.create({ data: { ip, success: false }, select: { id: true } });
  return attempt.id;
}

export async function markSignInAttemptSuccessful(attemptId: string, ip: string): Promise<void> {
  await prisma.$transaction([
    prisma.loginAttempt.update({ where: { id: attemptId }, data: { success: true } }),
    // A successful sign-in clears this client's recent failures.
    prisma.loginAttempt.deleteMany({ where: { ip, success: false } }),
    prisma.loginAttempt.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - RETENTION_MS) } } }),
  ]);
}

export function formatRetryAfter(seconds: number): string {
  const minutes = Math.ceil(seconds / 60);
  if (minutes <= 1) return "a minute";
  if (minutes < 90) return `${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  return hours >= 24 ? "a day" : `${hours} hours`;
}

/**
 * Writes are limited per user: a burst of 120, refilled at 2 a second. Far
 * more than anyone types or imports, and enough to stop a runaway script
 * from filling the database. Kept in memory: it protects this server process
 * and starts afresh on a deploy.
 */
const WRITE_BURST = 120;
const WRITES_PER_SECOND = 2;
const buckets = new Map<UserId, { tokens: number; at: number }>();

/** Take one write for the user; `allowed: false` says how long until the next. */
export function takeWrite(userId: UserId, now = Date.now()): RateLimitResult {
  let bucket = buckets.get(userId);
  if (!bucket) {
    // Full buckets say nothing: drop them rather than let the map grow with every user.
    if (buckets.size >= 10_000) {
      for (const [id, b] of buckets) if (b.tokens + ((now - b.at) / 1000) * WRITES_PER_SECOND >= WRITE_BURST) buckets.delete(id);
    }
    bucket = { tokens: WRITE_BURST, at: now };
    buckets.set(userId, bucket);
  }
  bucket.tokens = Math.min(WRITE_BURST, bucket.tokens + ((now - bucket.at) / 1000) * WRITES_PER_SECOND);
  bucket.at = now;
  if (bucket.tokens < 1) return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((1 - bucket.tokens) / WRITES_PER_SECOND)) };
  bucket.tokens -= 1;
  return { allowed: true };
}
