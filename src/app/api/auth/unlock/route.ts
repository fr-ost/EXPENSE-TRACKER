import { unlockWithPin } from "@/lib/server/auth/pin";
import { authed, json, readJson } from "@/lib/server/http";
import { unlockInput } from "@/lib/validation";

/** Unlock with the app-lock PIN. Wrong PINs are counted per user (auth/pin.ts). */
export const POST = authed(
  async ({ request, session, userId }) => {
    const { pin } = await readJson(request, unlockInput);
    await unlockWithPin(userId, session.id, pin);
    return json({ ok: true });
  },
  { allowLocked: true },
);
