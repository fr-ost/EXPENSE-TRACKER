import { reconcileAccount } from "@/lib/server/services/accounts";
import { authed, json, readJson } from "@/lib/server/http";
import { getToday } from "@/lib/server/settings";
import { reconcileInput } from "@/lib/validation";

export const POST = authed<{ id: string }>(async ({ request, params }) => {
  const input = await readJson(request, reconcileInput);
  return json(await reconcileAccount(params.id, input, await getToday()));
});
