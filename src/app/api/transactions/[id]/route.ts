import { deleteTransaction, getTransaction, updateTransaction } from "@/lib/server/services/transactions";
import { authed, json, readJson } from "@/lib/server/http";
import { getToday } from "@/lib/server/settings";
import { transactionInput } from "@/lib/validation";

type Params = { id: string };

export const GET = authed<Params>(async ({ params }) => json({ transaction: await getTransaction(params.id) }));

export const PUT = authed<Params>(async ({ request, params }) => {
  const input = await readJson(request, transactionInput);
  await updateTransaction(params.id, input, await getToday());
  return json({ id: params.id });
});

export const DELETE = authed<Params>(async ({ params }) => {
  await deleteTransaction(params.id);
  return json({ ok: true });
});
