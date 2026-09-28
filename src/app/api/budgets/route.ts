import { budgetsForMonth, setBudget } from "@/lib/server/services/budgets";
import { authed, json, readJson } from "@/lib/server/http";
import { getSettings, getToday } from "@/lib/server/settings";
import { monthKeyOf, isValidMonthKey } from "@/lib/dates";
import { budgetInput } from "@/lib/validation";

export const GET = authed(async ({ request }) => {
  const requested = request.nextUrl.searchParams.get("month");
  const month = requested && isValidMonthKey(requested) ? requested : monthKeyOf(await getToday());
  const settings = await getSettings();
  return json(await budgetsForMonth(month, settings.baseCurrency));
});

export const PUT = authed(async ({ request }) => {
  const input = await readJson(request, budgetInput);
  await setBudget(input.categoryId, input.month, input.amount);
  return json({ ok: true });
});
