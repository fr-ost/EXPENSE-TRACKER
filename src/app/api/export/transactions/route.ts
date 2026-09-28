import { transactionsCsv } from "@/lib/server/export/csv";
import { CONTENT_TYPES, download } from "@/lib/server/export/download";
import { exportTransactionRows } from "@/lib/server/export/transaction-rows";
import { transactionsWorkbook } from "@/lib/server/export/xlsx";
import { invalid } from "@/lib/server/errors";
import { authed } from "@/lib/server/http";
import { getToday } from "@/lib/server/settings";
import { parseTransactionFilters } from "@/lib/validation";

/** Exports every transaction matching the same filters as the Transactions page. */
export const GET = authed(async ({ request }) => {
  const params = request.nextUrl.searchParams;
  const format = params.get("format") ?? "csv";
  if (format !== "csv" && format !== "xlsx") throw invalid("Choose csv or xlsx.");
  const filters = parseTransactionFilters(params);
  const rows = await exportTransactionRows(filters);
  const scope = filters.month ?? (filters.year ? String(filters.year) : "all");
  const filename = `hisab-transactions-${scope}-${await getToday()}.${format}`;
  return format === "csv"
    ? download(transactionsCsv(rows), filename, CONTENT_TYPES.csv)
    : download(await transactionsWorkbook(rows), filename, CONTENT_TYPES.xlsx);
});
