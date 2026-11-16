import { createRecurring, listRecurring } from "@/lib/server/services/recurring";
import { authed, json, readJson } from "@/lib/server/http";
import { getToday } from "@/lib/server/settings";
import { createRecurringInput } from "@/lib/validation";

export const GET = authed(async ({ userId }) => json({ recurring: await listRecurring(userId) }));

export const POST = authed(async ({ request, userId }) => {
  const { rule, backfill } = await readJson(request, createRecurringInput);
  const created = await createRecurring(userId, rule, { today: await getToday(userId), backfill });
  return json({ id: created.id }, 201);
});
