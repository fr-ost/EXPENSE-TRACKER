import { NextResponse, type NextRequest } from "next/server";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { DRIVE_SCOPE, SignInError, callbackUrl, completeAuthorization, completeSignIn, googleConfig, type GoogleConfig } from "@/lib/server/auth/google";
import { PENDING_COOKIE, decodePending, pendingCookieOptions, type Pending } from "@/lib/server/auth/pending";
import { beginSignInAttempt, checkSignInAttempt, markSignInAttemptSuccessful } from "@/lib/server/auth/rate-limit";
import {
  SESSION_COOKIE,
  createSession,
  deleteSession,
  pruneExpiredSessions,
  readSession,
  sessionCookieOptions,
} from "@/lib/server/auth/session";
import { prisma } from "@/lib/server/db";
import { NO_STORE_HEADERS, clientIp } from "@/lib/server/http";
import { backupToDrive, connectDrive } from "@/lib/server/services/drive";
import { signInWithGoogle } from "@/lib/server/services/users";
import { getToday } from "@/lib/server/settings";

/** Why a sign-in didn't complete, as the sign-in page words it (see /login). */
type Failure = "cancelled" | "expired" | "failed" | "rate_limited";

function redirect(location: string): NextResponse {
  const response = new NextResponse(null, { status: 303, headers: { Location: location, ...NO_STORE_HEADERS } });
  // The pending sign-in is used up, whatever happened.
  response.cookies.set(PENDING_COOKIE, "", { ...pendingCookieOptions(), maxAge: 0 });
  return response;
}

const fail = (reason: Failure) => redirect(`/login?error=${reason}`);

/** How connecting Google Drive went, as Settings words it. */
type DriveOutcome = "connected" | "cancelled" | "failed" | "not-granted" | "other-account" | "problem";
const drive = (outcome: DriveOutcome) => redirect(`/settings?drive=${outcome}#backup`);

/**
 * The signed-in person comes back from allowing (or not) backups in their
 * Google Drive. The permission is kept only if it is for the Drive of the
 * Google account they sign in to Hisab with, and a first backup is made at
 * once — which also shows straight away whether Drive works.
 */
async function connectGoogleDrive(request: NextRequest, config: GoogleConfig, pending: Pending): Promise<NextResponse> {
  const session = await readSession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return redirect("/login");
  if (session.locked) return redirect("/lock");

  const params = request.nextUrl.searchParams;
  if (params.get("error")) return drive(params.get("error") === "access_denied" ? "cancelled" : "failed");

  const ip = clientIp(request);
  if (!(await checkSignInAttempt(ip)).allowed) return drive("failed");
  const attempt = await beginSignInAttempt(ip);
  let grant;
  try {
    grant = await completeAuthorization(config, callbackUrl(request), pending, { code: params.get("code"), state: params.get("state") });
  } catch (error) {
    if (!(error instanceof SignInError)) throw error;
    console.warn(`[drive] ${error.message}`);
    return drive("failed");
  }
  await markSignInAttemptSuccessful(attempt, ip);

  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.userId }, select: { googleSub: true } });
  if (user.googleSub !== grant.profile.sub) return drive("other-account");
  // The Drive permission can be unticked on Google's screen.
  if (!grant.refreshToken || !grant.scopes.includes(DRIVE_SCOPE)) return drive("not-granted");

  await connectDrive(session.userId, grant.refreshToken);
  try {
    await backupToDrive(session.userId, await getToday(session.userId));
  } catch (error) {
    console.warn("[drive] first backup failed", error instanceof Error ? error.message : error);
    return drive("problem");
  }
  return drive("connected");
}

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
    if (pending.drive) return await connectGoogleDrive(request, config, pending);

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
    return decodePending(request.cookies.get(PENDING_COOKIE)?.value)?.drive ? drive("failed") : fail("failed");
  }
}
