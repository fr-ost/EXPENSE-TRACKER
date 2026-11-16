import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/server/auth/session";
import { authed, json, readJson } from "@/lib/server/http";
import { deleteUser } from "@/lib/server/services/users";
import { deleteAccountInput } from "@/lib/validation";

/**
 * Delete the signed-in user's account and everything recorded in it, for
 * good. The body must say so ({ "confirm": "DELETE" }), so nothing but the
 * confirmation in Settings does this.
 */
export const DELETE = authed(async ({ request, userId }) => {
  await readJson(request, deleteAccountInput);
  await deleteUser(userId);
  const response = json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(new Date(0)), maxAge: 0 });
  return response;
});
