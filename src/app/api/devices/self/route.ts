import { deviceAuthed, json } from "@/lib/server/http";
import { deviceAccount, removeDevice } from "@/lib/server/services/devices";
import { countWaitingSms } from "@/lib/server/services/sms-inbox";

/** Is this phone still linked, to whom, and is anything waiting for the user? */
export const GET = deviceAuthed(async ({ userId }) =>
  json({ linked: true, account: await deviceAccount(userId), waiting: await countWaitingSms(userId) }),
);

/** The phone unlinks itself ("Turn off" in the app). */
export const DELETE = deviceAuthed(async ({ userId, deviceId }) => {
  await removeDevice(userId, deviceId);
  return json({ ok: true });
});
