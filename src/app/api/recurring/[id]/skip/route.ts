import { skipNextOccurrence } from "@/lib/server/services/recurring";
import { authed, json } from "@/lib/server/http";

export const POST = authed<{ id: string }>(async ({ params, userId }) => {
  await skipNextOccurrence(userId, params.id);
  return json({ ok: true });
});
