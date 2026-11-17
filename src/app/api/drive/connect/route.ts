import { NextResponse } from "next/server";
import { beginSignIn, callbackUrl, googleConfig } from "@/lib/server/auth/google";
import { PENDING_COOKIE, encodePending, pendingCookieOptions } from "@/lib/server/auth/pending";
import { NO_STORE_HEADERS, authed } from "@/lib/server/http";
import { getAccountEmail } from "@/lib/server/settings";

/**
 * "Connect Google Drive": send the signed-in person to Google to allow Hisab
 * to keep backups in its own folder of their Drive. Google sends them back
 * to the same address as after signing in (api/auth/google/callback).
 */
export const GET = authed(async ({ request, userId }) => {
  const config = googleConfig();
  if (!config) return new NextResponse(null, { status: 303, headers: { Location: "/settings#backup", ...NO_STORE_HEADERS } });

  const { url, pending } = beginSignIn(config, callbackUrl(request), { drive: { email: await getAccountEmail(userId) } });
  const response = new NextResponse(null, { status: 303, headers: { Location: url, ...NO_STORE_HEADERS } });
  response.cookies.set(
    PENDING_COOKIE,
    encodePending({ ...pending, next: "/settings", timezone: null, resetPin: false, drive: true }),
    pendingCookieOptions(),
  );
  return response;
});
