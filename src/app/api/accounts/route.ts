import { createAccount, listAccounts } from "@/lib/server/services/accounts";
import { authed, json, readJson } from "@/lib/server/http";
import { getToday } from "@/lib/server/settings";
import { accountInput } from "@/lib/validation";

export const GET = authed(async () => json({ accounts: await listAccounts(await getToday()) }));

export const POST = authed(async ({ request }) => {
  const input = await readJson(request, accountInput);
  const account = await createAccount(input, await getToday());
  return json({ id: account.id }, 201);
});
