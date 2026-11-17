import { authed, json, readJson } from "@/lib/server/http";
import { dismissWaitingSms, listWaitingSms } from "@/lib/server/services/sms-inbox";
import { smsInboxDismissInput } from "@/lib/validation";

/** Messages a linked phone handed in that are waiting for the user. */
export const GET = authed(async ({ userId }) => json(await listWaitingSms(userId)));

/** The user doesn't want these messages: they stop waiting. */
export const DELETE = authed(async ({ request, userId }) => {
  const { ids } = await readJson(request, smsInboxDismissInput);
  return json({ dismissed: await dismissWaitingSms(userId, ids) });
});
