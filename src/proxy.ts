import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth-cookie";

/**
 * First line of defence only: an optimistic cookie-presence check plus CSRF
 * origin validation. Every page and API handler still validates the session
 * against the database (see lib/server/auth/guard.ts).
 */

const PUBLIC_PAGES = new Set(["/login"]);
const PUBLIC_API = new Set(["/api/auth/login", "/api/auth/logout"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function expectedHost(request: NextRequest): string | null {
  return request.headers.get("x-forwarded-host") ?? request.headers.get("host");
}

/** Reject cross-site state-changing requests. */
function isCrossSite(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).host !== expectedHost(request);
    } catch {
      return true;
    }
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  return fetchSite !== null && fetchSite !== "same-origin" && fetchSite !== "none";
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
