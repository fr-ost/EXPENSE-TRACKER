import { createAccount, listAccounts } from "@/lib/server/services/accounts";
import { authed, json, readJson } from "@/lib/server/http";
import { getToday } from "@/lib/server/settings";
import { accountInput } from "@/lib/validation";

export const GET = authed(async ({ userId }) => json({ accounts: await listAccounts(userId, await getToday(userId)) }));

export const POST = authed(async ({ request, userId }) => {
  const input = await readJson(request, accountInput);
  const account = await createAccount(userId, input, await getToday(userId));
  return json({ id: account.id }, 201);
});
