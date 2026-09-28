import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { locked, unauthorized } from "../errors";
import { SESSION_COOKIE, readSession, touchSession, type SessionState } from "./session";

/** The current request's session (memoised per request). */
export const getSession = cache(async (): Promise<SessionState | null> => {
  const store = await cookies();
  return readSession(store.get(SESSION_COOKIE)?.value);
});

/**
 * For Server Components. Every protected page calls this (via
 * `loadPageContext`), independent of the proxy's cookie check.
 */
export async function requirePageSession(): Promise<SessionState> {
  const session = await getSession();
  if (!session || session.locked) {
    // Come back to this page afterwards (the proxy passes the requested path along).
    const path = safeRedirectPath((await headers()).get("x-hisab-path"), "");
    const next = path ? `?next=${encodeURIComponent(path)}` : "";
    redirect(session ? `/lock${next}` : `/login${next}`);
  }
  await touchSession(session.id);
  return session;
}

/**
 * For Route Handlers. Throws 401 without a valid session and 423 when the
 * session is locked (unless the endpoint is part of the lock flow).
 */
export async function requireApiSession(options: { allowLocked?: boolean } = {}): Promise<SessionState> {
  const session = await getSession();
  if (!session) throw unauthorized();
  if (session.locked && !options.allowLocked) throw locked();
  if (!session.locked) await touchSession(session.id);
  return session;
}
