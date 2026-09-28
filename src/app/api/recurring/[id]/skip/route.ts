import { skipNextOccurrence } from "@/lib/server/services/recurring";
import { authed, json } from "@/lib/server/http";

export const POST = authed<{ id: string }>(async ({ params }) => {
  await skipNextOccurrence(params.id);
  return json({ ok: true });
});
