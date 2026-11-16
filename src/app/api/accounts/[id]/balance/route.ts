import { invalid } from "@/lib/server/errors";
import { authed, json, readJson } from "@/lib/server/http";
import { recordedBalanceAt, updateBalance } from "@/lib/server/services/balances";
import { getClock } from "@/lib/server/settings";
import { balanceAtQuery, balanceUpdateInput } from "@/lib/validation";

type Params = { id: string };

/** The balance recorded at a moment (?date=&time=) — what an update there would be compared with. */
export const GET = authed<Params>(async ({ request, params, userId }) => {
  const query = balanceAtQuery.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!query.success) throw invalid("Choose a valid date and time.");
  return json(await recordedBalanceAt(userId, params.id, query.data.date, query.data.time, await getClock(userId)));
});

/** "This account holds exactly this much" — see services/balances.ts. */
export const POST = authed<Params>(async ({ request, params, userId }) => {
  const input = await readJson(request, balanceUpdateInput);
  const { today, time } = await getClock(userId);
  return json(await updateBalance(userId, params.id, input, today, time), 201);
});
