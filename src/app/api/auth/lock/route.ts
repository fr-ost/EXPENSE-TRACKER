import { lockSession } from "@/lib/server/auth/session";
import { authed, json } from "@/lib/server/http";

export const POST = authed(
  async ({ session }) => {
    await lockSession(session.id);
    return json({ ok: true });
  },
  { allowLocked: true },
);
