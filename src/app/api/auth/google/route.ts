import { NextResponse, type NextRequest } from "next/server";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { beginSignIn, callbackUrl, googleConfig } from "@/lib/server/auth/google";
import { PENDING_COOKIE, encodePending, pendingCookieOptions } from "@/lib/server/auth/pending";
import { NO_STORE_HEADERS } from "@/lib/server/http";

/**
 * "Continue with Google": remember what this sign-in must match, then send
 * the browser to Google. (?next= where to go afterwards, ?tz= the browser's
 * timezone for a new user, ?reset=pin to come back and remove a forgotten PIN.)
 */
export function GET(request: NextRequest) {
  const config = googleConfig();
  // The sign-in page explains what to set up.
  if (!config) return new NextResponse(null, { status: 303, headers: { Location: "/login", ...NO_STORE_HEADERS } });

  const params = request.nextUrl.searchParams;
  const { url, pending } = beginSignIn(config, callbackUrl(request));
  const response = new NextResponse(null, { status: 303, headers: { Location: url, ...NO_STORE_HEADERS } });
  response.cookies.set(
    PENDING_COOKIE,
    encodePending({
      ...pending,
      next: safeRedirectPath(params.get("next")).slice(0, 600),
      timezone: params.get("tz")?.slice(0, 64) ?? null,
      resetPin: params.get("reset") === "pin",
    }),
    pendingCookieOptions(),
  );
  return response;
}
