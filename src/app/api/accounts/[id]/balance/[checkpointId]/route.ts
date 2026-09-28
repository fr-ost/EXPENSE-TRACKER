import { authed, json } from "@/lib/server/http";
import { deleteBalanceUpdate } from "@/lib/server/services/balances";

type Params = { id: string; checkpointId: string };

export const DELETE = authed<Params>(async ({ params }) => {
  await deleteBalanceUpdate(params.id, params.checkpointId);
  return json({ ok: true });
});
