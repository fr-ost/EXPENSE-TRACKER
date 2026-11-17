import { deviceAuthed, json, readJson } from "@/lib/server/http";
import { touchDevice } from "@/lib/server/services/devices";
import { countWaitingSms, receiveSms } from "@/lib/server/services/sms-inbox";
import { deviceInboxInput } from "@/lib/validation";

/** Up to 25 messages with their text. */
const MAX_BYTES = 256 * 1024;

/**
 * A linked phone hands in bank and wallet messages. Each answer says what
 * became of one: added, already there, waiting for the user, or not a
 * transaction. Handing the same message in again changes nothing.
 */
export const POST = deviceAuthed(async ({ request, userId, deviceId }) => {
  const input = await readJson(request, deviceInboxInput, MAX_BYTES);
  const results = await receiveSms(userId, deviceId, input.messages);
  await touchDevice(userId, deviceId, input.appVersion);
  return json({ results, waiting: await countWaitingSms(userId) });
});
