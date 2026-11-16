import { deleteAccount, getAccount, updateAccount } from "@/lib/server/services/accounts";
import { authed, json, readJson } from "@/lib/server/http";
import { getToday } from "@/lib/server/settings";
import { accountInput } from "@/lib/validation";

type Params = { id: string };

export const GET = authed<Params>(async ({ params, userId }) =>
  json({ account: await getAccount(userId, params.id, await getToday(userId)) }),
);

export const PUT = authed<Params>(async ({ request, params, userId }) => {
  const input = await readJson(request, accountInput);
  await updateAccount(userId, params.id, input, await getToday(userId));
  return json({ id: params.id });
});

export const DELETE = authed<Params>(async ({ params, userId }) => {
  await deleteAccount(userId, params.id);
  return json({ ok: true });
});
