import "server-only";
import { prisma } from "../db";

/**
 * Brute-force protection for password checks (login and unlock).
 *
 * - Per client IP: 5 failures per 15 minutes.
 * - Globally: 30 failures per 15 minutes. There is only one account, so a
 *   distributed attack (many IPs) is capped too.
 *
 * Attempts are recorded as failures *before* the password is verified and
 * flipped to success afterwards, so concurrent requests cannot race past the
 * limit.
 */
const WINDOW_MS = 15 * 60 * 1000;
const PER_IP_LIMIT = 5;
const GLOBAL_LIMIT = 30;
const RETENTION_MS = 24 * 60 * 60 * 1000;

export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export async function checkPasswordAttempt(ip: string): Promise<RateLimitResult> {
  const since = new Date(Date.now() - WINDOW_MS);
  const [ipFailures, globalFailures] = await Promise.all([
    prisma.loginAttempt.findMany({
      where: { ip, success: false, createdAt: { gte: since } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    prisma.loginAttempt.findMany({
      where: { success: false, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: GLOBAL_LIMIT,
      select: { createdAt: true },
    }),
  ]);

  const retryAfter = (oldestRelevant: Date) =>
    Math.max(1, Math.ceil((oldestRelevant.getTime() + WINDOW_MS - Date.now()) / 1000));

  if (ipFailures.length >= PER_IP_LIMIT) {
    // The window reopens when enough of the oldest failures have aged out.
    return { allowed: false, retryAfterSeconds: retryAfter(ipFailures[ipFailures.length - PER_IP_LIMIT].createdAt) };
  }
  if (globalFailures.length >= GLOBAL_LIMIT) {
    return { allowed: false, retryAfterSeconds: retryAfter(globalFailures[GLOBAL_LIMIT - 1].createdAt) };
  }
  return { allowed: true };
}

/** Record a pending attempt (counted as a failure until marked successful). */
export async function beginPasswordAttempt(ip: string): Promise<string> {
  const attempt = await prisma.loginAttempt.create({ data: { ip, success: false }, select: { id: true } });
  return attempt.id;
}

export async function markPasswordAttemptSuccessful(attemptId: string, ip: string): Promise<void> {
  await prisma.$transaction([
    prisma.loginAttempt.update({ where: { id: attemptId }, data: { success: true } }),
    // A successful password clears this client's recent failures.
    prisma.loginAttempt.deleteMany({ where: { ip, success: false } }),
    prisma.loginAttempt.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - RETENTION_MS) } } }),
  ]);
}

export function formatRetryAfter(seconds: number): string {
  const minutes = Math.ceil(seconds / 60);
  return minutes <= 1 ? "a minute" : `${minutes} minutes`;
}
