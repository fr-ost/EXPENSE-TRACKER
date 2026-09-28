import type { NextRequest } from "next/server";
import { SESSION_COOKIE, deleteSession, readSession, sessionCookieOptions } from "@/lib/server/auth/session";
import { errorResponse, json } from "@/lib/server/http";

/** Always succeeds and clears the cookie, even for an expired or locked session. */
export async function POST(request: NextRequest) {
  try {
    const session = await readSession(request.cookies.get(SESSION_COOKIE)?.value);
    if (session) await deleteSession(session.id);
    const response = json({ ok: true });
    response.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(new Date(0)), maxAge: 0 });
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
