import { createTransaction, listTransactions } from "@/lib/server/services/transactions";
import { authed, json, readJson } from "@/lib/server/http";
import { getSettings, getToday } from "@/lib/server/settings";
import { createTransactionInput, parseTransactionFilters } from "@/lib/validation";

export const GET = authed(async ({ request }) => {
  const filters = parseTransactionFilters(request.nextUrl.searchParams);
  const settings = await getSettings();
  return json(await listTransactions(filters, settings.baseCurrency));
});

export const POST = authed(async ({ request }) => {
  const { transaction, idempotencyKey } = await readJson(request, createTransactionInput);
  const result = await createTransaction(transaction, { today: await getToday(), idempotencyKey });
  return json(result, result.created ? 201 : 200);
});
