import { deleteAccount, getAccount, updateAccount } from "@/lib/server/services/accounts";
import { authed, json, readJson } from "@/lib/server/http";
import { getToday } from "@/lib/server/settings";
import { accountInput } from "@/lib/validation";

type Params = { id: string };

export const GET = authed<Params>(async ({ params }) => json({ account: await getAccount(params.id, await getToday()) }));

export const PUT = authed<Params>(async ({ request, params }) => {
  const input = await readJson(request, accountInput);
  await updateAccount(params.id, input, await getToday());
  return json({ id: params.id });
});

export const DELETE = authed<Params>(async ({ params }) => {
  await deleteAccount(params.id);
  return json({ ok: true });
});
