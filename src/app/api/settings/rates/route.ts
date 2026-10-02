import { setManualRate } from "@/lib/server/services/currency";
import { authed, json, readJson } from "@/lib/server/http";
import { getSettings } from "@/lib/server/settings";
import { normalizeRate } from "@/lib/money";
import { rateInput } from "@/lib/validation";

/** Your own rate for a currency, or `rate: null` to use the latest conversion again. */
export const PUT = authed(async ({ request }) => {
  const input = await readJson(request, rateInput);
  const settings = await getSettings();
  await setManualRate(settings.baseCurrency, input.currency, input.rate === null ? null : normalizeRate(input.rate));
  return json({ ok: true });
});
