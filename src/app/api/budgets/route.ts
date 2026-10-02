import { budgetsForMonth, setBudget } from "@/lib/server/services/budgets";
import { getCurrencies } from "@/lib/server/services/currency";
import { authed, json, readJson } from "@/lib/server/http";
import { getSettings, getToday } from "@/lib/server/settings";
import { monthKeyOf, isValidMonthKey } from "@/lib/dates";
import { budgetInput } from "@/lib/validation";

export const GET = authed(async ({ request }) => {
  const requested = request.nextUrl.searchParams.get("month");
  const month = requested && isValidMonthKey(requested) ? requested : monthKeyOf(await getToday());
  const settings = await getSettings();
  const { conversion } = await getCurrencies(settings.baseCurrency);
  return json(await budgetsForMonth(month, conversion));
});

export const PUT = authed(async ({ request }) => {
  const input = await readJson(request, budgetInput);
  await setBudget(input.scope, input.month, input.amount);
  return json({ ok: true });
});
