import "server-only";
import ExcelJS from "exceljs";
import { formatMonth } from "@/lib/dates";
import { SCOPE_META } from "@/lib/domain";
import { toChartNumber, type Money } from "@/lib/money";
import type { ReportData } from "../services/reports";
import { safeText } from "./csv";
import { EXPORT_COLUMNS, type ExportRow } from "./transaction-rows";

const MONEY_FORMAT = "#,##0.00;[Red]-#,##0.00";
const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F4F6" } };

// Spreadsheet cells are floating point by nature; values are exact to the
// cent when converted from our two-decimal strings.
const num = (value: Money) => toChartNumber(value);

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true };
  row.fill = HEADER_FILL;
  row.alignment = { vertical: "middle" };
}

function addTransactionsSheet(workbook: ExcelJS.Workbook, rows: ExportRow[]) {
  const sheet = workbook.addWorksheet("Transactions", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = EXPORT_COLUMNS.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.key === "description" || c.key === "notes" ? 32 : c.numeric ? 16 : 16,
    style: c.numeric ? { numFmt: MONEY_FORMAT } : undefined,
  }));
  styleHeader(sheet.getRow(1));
  for (const row of rows) {
    sheet.addRow(
      Object.fromEntries(
        EXPORT_COLUMNS.map(({ key, numeric }) => {
          const value = row[key];
          if (numeric) return [key, value === null ? null : num(value as Money)];
          if (typeof value === "boolean") return [key, value ? "Yes" : "No"];
          return [key, safeText(String(value ?? ""))];
        }),
      ),
    );
  }
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: EXPORT_COLUMNS.length } };
}

export async function transactionsWorkbook(rows: ExportRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Hisab";
  addTransactionsSheet(workbook, rows);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** A report workbook: summary, months (for a year), categories, accounts, and the transactions. */
export async function reportWorkbook(report: ReportData, rows: ExportRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Hisab";
  const s = report.summary;

  const summary = workbook.addWorksheet("Summary");
  summary.columns = [
    { header: `Report — ${report.label}`, key: "label", width: 42 },
    { header: report.currency, key: "value", width: 20, style: { numFmt: MONEY_FORMAT } },
  ];
  styleHeader(summary.getRow(1));
  summary.addRows([
    { label: "Income", value: num(s.income) },
    { label: "Spending (expenses + transfers counted as expense)", value: num(s.expenses) },
    { label: "   Direct expenses", value: num(s.directExpenses) },
    { label: "   Transfers counted as expense", value: num(s.transferExpenses) },
    { label: "Net savings (income − spending)", value: num(s.netSavings) },
    { label: "Savings rate", value: s.savingsRate === null ? "—" : `${s.savingsRate}%` },
    { label: "Transfers between accounts (not spending)", value: num(s.transfers) },
    { label: "Balance adjustments (not income or spending)", value: num(s.adjustments) },
  ]);
  summary.addRow({});
  for (const scope of report.scopes) summary.addRow({ label: `${SCOPE_META[scope.scope].label} spending`, value: num(scope.total) });

  if (report.months) {
    const months = workbook.addWorksheet("Months");
    months.columns = [
      { header: "Month", key: "month", width: 18 },
      { header: "Income", key: "income", width: 16, style: { numFmt: MONEY_FORMAT } },
      { header: "Spending", key: "expenses", width: 16, style: { numFmt: MONEY_FORMAT } },
      { header: "Savings", key: "savings", width: 16, style: { numFmt: MONEY_FORMAT } },
      { header: "Savings rate", key: "rate", width: 14 },
    ];
    styleHeader(months.getRow(1));
    for (const m of report.months) {
      months.addRow({
        month: formatMonth(m.month),
        income: num(m.income),
        expenses: num(m.expenses),
        savings: num(m.savings),
        rate: m.savingsRate === null ? "—" : `${m.savingsRate}%`,
      });
    }
  }

  const categories = workbook.addWorksheet("Categories");
  categories.columns = [
    { header: "Kind", key: "kind", width: 12 },
    { header: "Category", key: "name", width: 24 },
    { header: "Amount", key: "total", width: 16, style: { numFmt: MONEY_FORMAT } },
    { header: "Share", key: "share", width: 10 },
    { header: "Transactions", key: "count", width: 14 },
  ];
  styleHeader(categories.getRow(1));
  for (const c of report.categories) categories.addRow({ kind: "Spending", name: safeText(c.name), total: num(c.total), share: `${c.share.toFixed(1)}%`, count: c.count });
  for (const c of report.incomeCategories) categories.addRow({ kind: "Income", name: safeText(c.name), total: num(c.total), share: `${c.share.toFixed(1)}%`, count: c.count });

  const accounts = workbook.addWorksheet("Accounts");
  accounts.columns = [
    { header: "Account", key: "name", width: 24 },
    { header: "Currency", key: "currency", width: 10 },
    { header: "Opening", key: "opening", width: 16, style: { numFmt: MONEY_FORMAT } },
    { header: "Money in", key: "inflow", width: 16, style: { numFmt: MONEY_FORMAT } },
    { header: "Money out", key: "outflow", width: 16, style: { numFmt: MONEY_FORMAT } },
    { header: "Closing", key: "closing", width: 16, style: { numFmt: MONEY_FORMAT } },
  ];
  styleHeader(accounts.getRow(1));
  for (const a of report.accounts) {
    accounts.addRow({
      name: safeText(a.name),
      currency: a.currency,
      opening: num(a.openingBalance),
      inflow: num(a.inflow),
      outflow: num(a.outflow),
      closing: num(a.closingBalance),
    });
  }

  addTransactionsSheet(workbook, rows);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
