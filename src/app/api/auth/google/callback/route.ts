import { NextResponse, type NextRequest } from "next/server";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { SignInError, callbackUrl, completeSignIn, googleConfig } from "@/lib/server/auth/google";
import { PENDING_COOKIE, decodePending, pendingCookieOptions } from "@/lib/server/auth/pending";
import { beginSignInAttempt, checkSignInAttempt, markSignInAttemptSuccessful } from "@/lib/server/auth/rate-limit";
import {
  SESSION_COOKIE,
  createSession,
  deleteSession,
  pruneExpiredSessions,
  readSession,
  sessionCookieOptions,
} from "@/lib/server/auth/session";
import { NO_STORE_HEADERS, clientIp } from "@/lib/server/http";
import { signInWithGoogle } from "@/lib/server/services/users";

/** Why a sign-in didn't complete, as the sign-in page words it (see /login). */
type Failure = "cancelled" | "expired" | "failed" | "rate_limited";

function redirect(location: string): NextResponse {
  const response = new NextResponse(null, { status: 303, headers: { Location: location, ...NO_STORE_HEADERS } });
  // The pending sign-in is used up, whatever happened.
  response.cookies.set(PENDING_COOKIE, "", { ...pendingCookieOptions(), maxAge: 0 });
  return response;
}

const fail = (reason: Failure) => redirect(`/login?error=${reason}`);

/**
 * Google sends the browser back here. Check that the answer belongs to the
 * sign-in this browser started, learn who it is from Google, find or create
 * their user, and start a session.
 */
export async function GET(request: NextRequest) {
  try {
    const config = googleConfig();
    if (!config) return redirect("/login");

    const pending = decodePending(request.cookies.get(PENDING_COOKIE)?.value);
    // No sign-in in progress in this browser: started elsewhere, or over ten minutes ago.
    if (!pending) return fail("expired");

    const params = request.nextUrl.searchParams;
    if (params.get("error")) return fail(params.get("error") === "access_denied" ? "cancelled" : "failed");

    const ip = clientIp(request);
    if (!(await checkSignInAttempt(ip)).allowed) return fail("rate_limited");
    const attempt = await beginSignInAttempt(ip);

    let profile;
    try {
      profile = await completeSignIn(config, callbackUrl(request), pending, { code: params.get("code"), state: params.get("state") });
    } catch (error) {
      if (!(error instanceof SignInError)) throw error;
      console.warn(`[auth] ${error.message}`);
      return fail("failed");
    }
    await markSignInAttemptSuccessful(attempt, ip);

    const { userId } = await signInWithGoogle(profile, { timezone: pending.timezone });

    // Never reuse a pre-existing session id (session fixation).
    const previous = await readSession(request.cookies.get(SESSION_COOKIE)?.value);
    if (previous) await deleteSession(previous.id);
    await pruneExpiredSessions();

    const { token, expiresAt } = await createSession(userId, request.headers.get("user-agent"));
    // Checked when it was stored, and again now: only ever a path on this site.
    const response = redirect(pending.resetPin ? "/lock?forgot=1" : safeRedirectPath(pending.next));
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
    return response;
  } catch (error) {
    console.error("[auth] sign-in failed unexpectedly", error);
    return fail("failed");
  }
}
