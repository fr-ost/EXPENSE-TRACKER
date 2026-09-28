import { attemptUnlock } from "@/lib/server/auth/password-check";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/server/auth/session";
import { AppError } from "@/lib/server/errors";
import { authed, json, readJson } from "@/lib/server/http";
import { passwordInput } from "@/lib/validation";

export const POST = authed(
  async ({ request, session }) => {
    const { password } = await readJson(request, passwordInput);
    const result = await attemptUnlock(session.id, password);
    if (result.status === "incorrect") {
      const tries = result.remaining === 1 ? "1 try" : `${result.remaining} tries`;
      throw new AppError(401, "invalid_credentials", `Incorrect password. ${tries} left before you're signed out.`);
    }
    if (result.status === "signed_out") {
      const response = json({ error: "Too many incorrect attempts. Please sign in again.", code: "signed_out" }, 401);
      response.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(new Date(0)), maxAge: 0 });
      return response;
    }
    return json({ ok: true });
  },
  { allowLocked: true },
);
