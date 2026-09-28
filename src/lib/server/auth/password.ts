import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { AppError } from "../errors";

/**
 * The password is a plain environment variable, ADMIN_PASSWORD (a Railway
 * service variable). It is never stored in the database, logged, or sent to
 * the browser. Surrounding whitespace is ignored, so a stray space or newline
 * pasted into the variable doesn't lock you out.
 */
export function adminPassword(): string | null {
  const value = process.env.ADMIN_PASSWORD?.trim();
  return value ? value : null;
}

export function requireAdminPassword(): string {
  const password = adminPassword();
  if (!password) {
    throw new AppError(
      503,
      "not_configured",
      "Sign-in isn't set up yet. Add an ADMIN_PASSWORD variable to the server, then redeploy.",
    );
  }
  return password;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Constant-time comparison; hashing first makes both sides the same length. */
export function passwordMatches(candidate: string, expected: string): boolean {
  return timingSafeEqual(digest(candidate.trim()), digest(expected));
}

/**
 * Binds a session to the password it was created with. When ADMIN_PASSWORD
 * changes, every existing session stops matching and is signed out.
 */
export function sessionCredential(sessionId: string, password: string): string {
  return createHmac("sha256", password).update(sessionId).digest("hex");
}

export function credentialMatches(stored: string, sessionId: string, password: string): boolean {
  const expected = Buffer.from(sessionCredential(sessionId, password), "utf8");
  const actual = Buffer.from(stored, "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
