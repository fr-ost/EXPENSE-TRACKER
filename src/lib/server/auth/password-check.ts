import "server-only";
import { prisma } from "../db";
import { AppError, tooManyRequests } from "../errors";
import { ensureOwner } from "../settings";
import { passwordMatches, requireAdminPassword } from "./password";
import {
  beginPasswordAttempt,
  checkPasswordAttempt,
  formatRetryAfter,
  markPasswordAttemptSuccessful,
} from "./rate-limit";

/**
 * Rate-limited sign-in check (per IP and globally). Returns the owner's id on
 * success; throws a 401/429/503 AppError otherwise. The error never reveals
 * anything beyond "incorrect".
 */
export async function checkLoginPassword(ip: string, password: string): Promise<string> {
  const expected = requireAdminPassword();
  const limit = await checkPasswordAttempt(ip);
  if (!limit.allowed) {
    throw tooManyRequests(
      `Too many attempts. Try again in ${formatRetryAfter(limit.retryAfterSeconds)}.`,
      limit.retryAfterSeconds,
    );
  }

  const attemptId = await beginPasswordAttempt(ip);
  if (!passwordMatches(password, expected)) throw new AppError(401, "invalid_credentials", "Incorrect password.");

  await markPasswordAttemptSuccessful(attemptId, ip);
  const owner = await ensureOwner();
  return owner.id;
}

/** Wrong passwords allowed on the lock screen before the session is signed out. */
export const MAX_UNLOCK_ATTEMPTS = 5;

export type UnlockResult = { status: "unlocked" } | { status: "incorrect"; remaining: number } | { status: "signed_out" };

/**
 * Unlock a locked session. Limited per session rather than per IP: someone
 * holding a locked device gets a few guesses before the session ends, while
 * guessing at the sign-in page (from anywhere) never locks the owner out of
 * devices that are already signed in.
 */
export async function attemptUnlock(sessionId: string, password: string): Promise<UnlockResult> {
  const expected = requireAdminPassword();
  // Count the attempt before checking it, so parallel guesses can't exceed the limit.
  const [counted] = await prisma.$queryRaw<Array<{ failedUnlocks: number }>>`
    UPDATE "Session" SET "failedUnlocks" = "failedUnlocks" + 1
    WHERE "id" = ${sessionId} AND "failedUnlocks" < ${MAX_UNLOCK_ATTEMPTS}
    RETURNING "failedUnlocks"`;

  if (counted && passwordMatches(password, expected)) {
    await prisma.session.update({
      where: { id: sessionId },
      data: { lockedAt: null, lastSeenAt: new Date(), failedUnlocks: 0 },
    });
    return { status: "unlocked" };
  }
  if (!counted || counted.failedUnlocks >= MAX_UNLOCK_ATTEMPTS) {
    await prisma.session.deleteMany({ where: { id: sessionId } });
    return { status: "signed_out" };
  }
  return { status: "incorrect", remaining: MAX_UNLOCK_ATTEMPTS - counted.failedUnlocks };
}
