import { authed, json, readJson } from "@/lib/server/http";
import { saveSmsBalances } from "@/lib/server/services/sms";
import { smsBalanceInput } from "@/lib/validation";

/** Up to 50 messages with their original text. */
const MAX_BYTES = 256 * 1024;

/** Record the balances reported by messages that were added earlier. */
export const POST = authed(async ({ request }) => {
  const { items } = await readJson(request, smsBalanceInput, MAX_BYTES);
  return json({ results: await saveSmsBalances(items) });
});
