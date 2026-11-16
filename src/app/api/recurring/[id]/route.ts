import { z } from "zod";
import { deleteRecurring, setRecurringActive, updateRecurring } from "@/lib/server/services/recurring";
import { authed, json, readJson } from "@/lib/server/http";
import { getToday } from "@/lib/server/settings";
import { recurringInput } from "@/lib/validation";

type Params = { id: string };

export const PUT = authed<Params>(async ({ request, params, userId }) => {
  const input = await readJson(request, recurringInput);
  await updateRecurring(userId, params.id, input, await getToday(userId));
  return json({ id: params.id });
});

export const PATCH = authed<Params>(async ({ request, params, userId }) => {
  const { isActive } = await readJson(request, z.object({ isActive: z.boolean() }));
  await setRecurringActive(userId, params.id, isActive, await getToday(userId));
  return json({ id: params.id });
});

export const DELETE = authed<Params>(async ({ params, userId }) => {
  await deleteRecurring(userId, params.id);
  return json({ ok: true });
});
