import { lockSession } from "@/lib/server/auth/session";
import { invalid } from "@/lib/server/errors";
import { authed, json } from "@/lib/server/http";

/** "Lock now". Only with a PIN: without one there would be no way back in. */
export const POST = authed(
  async ({ session }) => {
    if (!session.hasPin) throw invalid("Set a PIN in Settings to lock the app.");
    await lockSession(session.id);
    return json({ ok: true });
  },
  { allowLocked: true },
);
