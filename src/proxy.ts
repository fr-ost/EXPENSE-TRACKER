import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth-cookie";

/**
 * First line of defence only: an optimistic cookie-presence check plus CSRF
 * origin validation. Every page and API handler still validates the session
 * against the database (see lib/server/auth/guard.ts).
 */

const PUBLIC_PAGES = new Set(["/login"]);
const PUBLIC_API = new Set(["/api/auth/login", "/api/auth/logout", "/api/health"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Reject cross-site state-changing requests. Browsers send Sec-Fetch-Site,
 * which doesn't depend on how the platform rewrites Host headers; the Origin
 * comparison covers older browsers. Requests with neither (curl, scripts)
 * aren't CSRF — they can't ride on a victim's cookies.
 */
function isCrossSite(request: NextRequest): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite) return fetchSite !== "same-origin" && fetchSite !== "none";

  const origin = request.headers.get("origin");
  if (!origin) return false;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return true;
  }
  const hosts = [request.headers.get("x-forwarded-host"), request.headers.get("host"), request.nextUrl.host];
  return !hosts.some((host) => host?.split(",")[0].trim().toLowerCase() === originHost.toLowerCase());
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");

  if (isApi && !SAFE_METHODS.has(request.method) && isCrossSite(request)) {
    return NextResponse.json({ error: "Cross-site request blocked.", code: "forbidden" }, { status: 403 });
  }

  const hasSession = request.cookies.has(SESSION_COOKIE);
  if (hasSession || PUBLIC_PAGES.has(pathname) || PUBLIC_API.has(pathname)) {
    return NextResponse.next();
  }

  if (isApi) {
    return NextResponse.json(
      { error: "Please sign in to continue.", code: "unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const loginUrl = new URL("/login", request.url);
  if (pathname !== "/" && pathname !== "/lock") loginUrl.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|robots.txt|manifest.webmanifest).*)"],
};
