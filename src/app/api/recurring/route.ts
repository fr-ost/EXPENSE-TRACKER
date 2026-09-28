import { createRecurring, listRecurring } from "@/lib/server/services/recurring";
import { authed, json, readJson } from "@/lib/server/http";
import { getToday } from "@/lib/server/settings";
import { createRecurringInput } from "@/lib/validation";

export const GET = authed(async () => json({ recurring: await listRecurring() }));

export const POST = authed(async ({ request }) => {
  const { rule, backfill } = await readJson(request, createRecurringInput);
  const created = await createRecurring(rule, { today: await getToday(), backfill });
  return json({ id: created.id }, 201);
});
