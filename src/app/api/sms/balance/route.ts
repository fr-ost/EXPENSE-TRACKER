import { authed, json, readJson } from "@/lib/server/http";
import { saveSmsBalances } from "@/lib/server/services/sms";
import { getClock } from "@/lib/server/settings";
import { smsBalanceInput } from "@/lib/validation";

/** Up to 50 messages with their original text. */
const MAX_BYTES = 256 * 1024;

/** Record the balances messages report: ones added earlier, and ones that only report a balance. */
export const POST = authed(async ({ request }) => {
  const { items } = await readJson(request, smsBalanceInput, MAX_BYTES);
  return json({ results: await saveSmsBalances(items, await getClock()) });
});
