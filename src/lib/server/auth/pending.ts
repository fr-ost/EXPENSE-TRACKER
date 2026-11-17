import "server-only";
import { z } from "zod";
import type { PendingSignIn } from "./google";

/**
 * What a sign-in remembers while the browser is at Google: the checks from
 * `beginSignIn`, and where the person was going. Kept in an HttpOnly cookie
 * for ten minutes — only this browser can finish the sign-in it started.
 */
export const PENDING_COOKIE = process.env.NODE_ENV === "production" ? "__Host-hisab_signin" : "hisab_signin";

const PENDING_MAX_AGE_SECONDS = 10 * 60;

const pendingSchema = z.object({
  state: z.string().min(20).max(100),
  nonce: z.string().min(20).max(100),
  verifier: z.string().min(40).max(130),
  /** Where to go afterwards (already checked to be a path on this site). */
  next: z.string().max(600),
  /** The browser's timezone, for a new user's "today". */
  timezone: z.string().max(64).nullable(),
  /** Coming back to remove a forgotten PIN. */
  resetPin: z.boolean(),
  /** Not a sign-in: the signed-in person is connecting their Google Drive for backups. */
  drive: z.boolean().default(false),
});

export type Pending = z.infer<typeof pendingSchema> & PendingSignIn;

export function pendingCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // Lax: sent when Google sends the browser back (a top-level navigation).
    sameSite: "lax" as const,
    path: "/",
    maxAge: PENDING_MAX_AGE_SECONDS,
  };
}

export function encodePending(pending: Pending): string {
  return Buffer.from(JSON.stringify(pending), "utf8").toString("base64url");
}

export function decodePending(value: string | undefined): Pending | null {
  if (!value || value.length > 2000) return null;
  try {
    const parsed = pendingSchema.safeParse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
