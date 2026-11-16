import { removePin, setPin } from "@/lib/server/auth/pin";
import { authed, json, readJson } from "@/lib/server/http";
import { removePinInput, setPinInput } from "@/lib/validation";

/** Turn the app lock on, or change the PIN (with the current one). */
export const PUT = authed(async ({ request, userId }) => {
  const { pin, currentPin } = await readJson(request, setPinInput);
  await setPin(userId, pin, currentPin);
  return json({ ok: true });
});

/** Turn the app lock off, with the current PIN. */
export const DELETE = authed(async ({ request, userId }) => {
  const { currentPin } = await readJson(request, removePinInput);
  await removePin(userId, currentPin);
  return json({ ok: true });
});
