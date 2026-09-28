import { checkPassword } from "@/lib/server/auth/password-check";
import { unlockSession } from "@/lib/server/auth/session";
import { authed, clientIp, json, readJson } from "@/lib/server/http";
import { passwordInput } from "@/lib/validation";

export const POST = authed(
  async ({ request, session }) => {
    const { password } = await readJson(request, passwordInput);
    await checkPassword(clientIp(request), password);
    await unlockSession(session.id);
    return json({ ok: true });
  },
  { allowLocked: true },
);
