import { authed, json } from "@/lib/server/http";
import { removeDevice } from "@/lib/server/services/devices";

/** Unlink a phone: it can hand nothing more in. */
export const DELETE = authed<{ id: string }>(async ({ params, userId }) => {
  await removeDevice(userId, params.id);
  return json({ ok: true });
});
