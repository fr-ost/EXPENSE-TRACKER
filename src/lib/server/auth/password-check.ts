import "server-only";
import { prisma } from "../db";
import { AppError, tooManyRequests } from "../errors";
import { verifyPassword } from "./password";
import {
  beginPasswordAttempt,
  checkPasswordAttempt,
  formatRetryAfter,
  markPasswordAttemptSuccessful,
} from "./rate-limit";

/**
 * Rate-limited password verification shared by login, unlock and password
 * change. Returns the user id on success; throws a 401/429 AppError otherwise.
 * The error message never reveals anything beyond "incorrect".
 */
export async function checkPassword(ip: string, password: string): Promise<string> {
  const limit = await checkPasswordAttempt(ip);
  if (!limit.allowed) {
    throw tooManyRequests(
      `Too many attempts. Try again in ${formatRetryAfter(limit.retryAfterSeconds)}.`,
      limit.retryAfterSeconds,
    );
  }

  const attemptId = await beginPasswordAttempt(ip);
  const user = await prisma.user.findFirst({ select: { id: true, passwordHash: true } });
  const valid = await verifyPassword(user?.passwordHash, password);
  if (!valid || !user) throw new AppError(401, "invalid_credentials", "Incorrect password.");

  await markPasswordAttemptSuccessful(attemptId, ip);
  return user.id;
}
