import type { NextRequest } from "next/server";
import { checkLoginPassword } from "@/lib/server/auth/password-check";
import {
  SESSION_COOKIE,
  createSession,
  deleteSession,
  pruneExpiredSessions,
  readSession,
  sessionCookieOptions,
} from "@/lib/server/auth/session";
import { clientIp, errorResponse, json, readJson } from "@/lib/server/http";
import { passwordInput } from "@/lib/validation";

export async function POST(request: NextRequest) {
  try {
    const { password } = await readJson(request, passwordInput);
    const userId = await checkLoginPassword(clientIp(request), password);

    // Never reuse a pre-existing session id (session fixation).
    const previous = await readSession(request.cookies.get(SESSION_COOKIE)?.value);
    if (previous) await deleteSession(previous.id);
    await pruneExpiredSessions();

    const { token, expiresAt } = await createSession(userId, request.headers.get("user-agent"));
    const response = json({ ok: true });
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
