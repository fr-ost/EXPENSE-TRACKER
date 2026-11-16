import { resetPin } from "@/lib/server/auth/pin";
import { authed, json } from "@/lib/server/http";

/** Remove a forgotten PIN — only just after signing in with Google again. */
export const POST = authed(
  async ({ session, userId }) => {
    await resetPin(userId, session);
    return json({ ok: true });
  },
  { allowLocked: true },
);
