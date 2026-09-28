import { CONTENT_TYPES, download } from "@/lib/server/export/download";
import { reportPdf } from "@/lib/server/export/pdf";
import { exportTransactionRows } from "@/lib/server/export/transaction-rows";
import { reportWorkbook } from "@/lib/server/export/xlsx";
import { invalid } from "@/lib/server/errors";
import { authed } from "@/lib/server/http";
import { buildReport, parseReportPeriod } from "@/lib/server/services/reports";
import { getSettings, getToday } from "@/lib/server/settings";

/** The report for a month or year, as an Excel workbook or a PDF. */
export const GET = authed(async ({ request }) => {
  const params = request.nextUrl.searchParams;
  const format = params.get("format") ?? "pdf";
  if (format !== "pdf" && format !== "xlsx") throw invalid("Choose pdf or xlsx.");
  const [settings, today] = await Promise.all([getSettings(), getToday()]);
  const period = parseReportPeriod(params, today);
  const report = await buildReport(period, settings.baseCurrency, today);
  const name = period.kind === "month" ? period.month : String(period.year);

  if (format === "pdf") {
    const pdf = await reportPdf(report, { grouping: settings.numberFormat, generatedOn: today });
    return download(pdf, `hisab-report-${name}.pdf`, CONTENT_TYPES.pdf);
  }
  const rows = await exportTransactionRows({ from: report.from, to: report.to });
  return download(await reportWorkbook(report, rows), `hisab-report-${name}.xlsx`, CONTENT_TYPES.xlsx);
});
