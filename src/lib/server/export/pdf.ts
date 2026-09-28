import "server-only";
import PDFDocument from "pdfkit";
import { formatDate, formatMonth } from "@/lib/dates";
import { APP_NAME, SCOPE_META, type NumberFormat } from "@/lib/domain";
import { formatMoney, type Money } from "@/lib/money";
import type { ReportData } from "../services/reports";

const INK = "#0e0e12";
const MUTED = "#5c5c69";
const FAINT = "#8a8a97";
const RULE = "#e6e6ea";
const MARGIN = 48;

interface Column {
  header: string;
  width: number;
  align?: "left" | "right";
}

/**
 * A printable report. Helvetica (built into every PDF reader) has no taka
 * sign, so amounts are printed with the currency code in the headings.
 */
export function reportPdf(report: ReportData, options: { grouping: NumberFormat; generatedOn: string }): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: MARGIN, bufferPages: true, info: { Title: `${APP_NAME} report — ${report.label}`, Author: APP_NAME } });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const width = doc.page.width - MARGIN * 2;
  const bottom = () => doc.page.height - MARGIN - 24;
  // Helvetica's WinAnsi encoding has no U+2212, so use an ASCII minus here.
  const amount = (value: Money, currency = report.currency) =>
    `${currency === report.currency ? "" : `${currency} `}${formatMoney(value, { grouping: options.grouping, plain: true, decimals: "always" }).replace("\u2212", "-")}`;

  const ensureSpace = (height: number) => {
    if (doc.y + height > bottom()) doc.addPage();
  };

  const heading = (text: string, note?: string) => {
    ensureSpace(60);
    doc.moveDown(1.2);
    doc.font("Helvetica-Bold").fontSize(12).fillColor(INK).text(text, MARGIN, doc.y);
    if (note) doc.font("Helvetica").fontSize(8.5).fillColor(FAINT).text(note, MARGIN, doc.y + 2);
    doc.moveDown(0.6);
  };

  const table = (columns: Column[], rows: string[][], options: { boldLast?: boolean } = {}) => {
    const rowHeight = 18;
    const drawHeader = () => {
      let x = MARGIN;
      const y = doc.y;
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor(MUTED);
      for (const col of columns) {
        doc.text(col.header, x + 2, y, { width: col.width - 4, align: col.align ?? "left", lineBreak: false });
        x += col.width;
      }
      doc.moveTo(MARGIN, y + 13).lineTo(MARGIN + width, y + 13).lineWidth(0.6).strokeColor(RULE).stroke();
      doc.y = y + rowHeight;
    };
    drawHeader();
    rows.forEach((row, index) => {
      if (doc.y + rowHeight > bottom()) {
        doc.addPage();
        drawHeader();
      }
      const y = doc.y;
      const bold = options.boldLast && index === rows.length - 1;
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9.5).fillColor(INK);
      let x = MARGIN;
      row.forEach((cell, i) => {
        const col = columns[i];
        doc.text(cell, x + 2, y, { width: col.width - 4, align: col.align ?? "left", lineBreak: false, ellipsis: true });
        x += col.width;
      });
      doc.moveTo(MARGIN, y + 13.5).lineTo(MARGIN + width, y + 13.5).lineWidth(0.4).strokeColor(RULE).stroke();
      doc.y = y + rowHeight;
    });
    doc.x = MARGIN;
  };

  // Title
  const s = report.summary;
  doc.font("Helvetica").fontSize(9).fillColor(FAINT).text(APP_NAME.toUpperCase(), { characterSpacing: 1.2 });
  doc.moveDown(0.4);
  doc
    .font("Helvetica-Bold")
    .fontSize(20)
    .fillColor(INK)
    .text(report.period.kind === "month" ? `Monthly report — ${report.label}` : `Annual report — ${report.label}`);
  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor(MUTED)
    .text(`${formatDate(report.from)} – ${formatDate(report.to)}  ·  Amounts in ${report.currency}  ·  Generated ${formatDate(options.generatedOn)}`);

  // Key figures
  doc.moveDown(1.2);
  const figures: Array<[string, string]> = [
    ["Income", amount(s.income)],
    ["Spending", amount(s.expenses)],
    ["Net savings", amount(s.netSavings)],
    ["Savings rate", s.savingsRate === null ? "—" : `${s.savingsRate.toFixed(1)}%`],
  ];
  const boxY = doc.y;
  const cell = width / figures.length;
  doc.roundedRect(MARGIN, boxY, width, 58, 8).fillColor("#f7f7f9").fill();
  figures.forEach(([label, value], i) => {
    const x = MARGIN + cell * i + 14;
    doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text(label, x, boxY + 13, { width: cell - 20, lineBreak: false });
    doc.font("Helvetica-Bold").fontSize(13).fillColor(INK).text(value, x, boxY + 28, { width: cell - 20, lineBreak: false });
  });
  doc.y = boxY + 58;

  heading("Statement", "Transfers between your own accounts move balances but are not spending, unless you marked them as an expense.");
  table(
    [
      { header: "", width: width - 140 },
      { header: report.currency, width: 140, align: "right" },
    ],
    [
      ["Income", amount(s.income)],
      ["Direct expenses", amount(s.directExpenses)],
      ["Transfers counted as expense", amount(s.transferExpenses)],
      ["Total spending", amount(s.expenses)],
      ["Net savings", amount(s.netSavings)],
      ["Transfers between accounts (not spending)", amount(s.transfers)],
      ["Balance adjustments (not income or spending)", amount(s.adjustments)],
    ],
  );

  heading("Family, personal and other spending");
  table(
    [
      { header: "Classification", width: width - 220 },
      { header: "Share", width: 80, align: "right" },
      { header: report.currency, width: 140, align: "right" },
    ],
    report.scopes.map((scope) => [SCOPE_META[scope.scope].label, `${scope.share.toFixed(1)}%`, amount(scope.total)]),
  );

  if (report.months) {
    heading("Month by month");
    table(
      [
        { header: "Month", width: width - 400 },
        { header: "Income", width: 110, align: "right" },
        { header: "Spending", width: 110, align: "right" },
        { header: "Savings", width: 110, align: "right" },
        { header: "Rate", width: 70, align: "right" },
      ],
      report.months.map((m) => [
        formatMonth(m.month),
        amount(m.income),
        amount(m.expenses),
        amount(m.savings),
        m.savingsRate === null ? "—" : `${m.savingsRate.toFixed(1)}%`,
      ]),
    );
    if (report.highestSpendingMonth) {
      doc.moveDown(0.4);
      doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text(
        `Highest spending month: ${formatMonth(report.highestSpendingMonth.month)} (${amount(report.highestSpendingMonth.expenses)}).`,
      );
    }
  }

  if (report.categories.length) {
    heading("Spending by category");
    table(
      [
        { header: "Category", width: width - 280 },
        { header: "Entries", width: 60, align: "right" },
        { header: "Share", width: 80, align: "right" },
        { header: report.currency, width: 140, align: "right" },
      ],
      report.categories.map((c) => [c.name, String(c.count), `${c.share.toFixed(1)}%`, amount(c.total)]),
    );
  }

  if (report.incomeCategories.length) {
    heading("Income by source");
    table(
      [
        { header: "Source", width: width - 280 },
        { header: "Entries", width: 60, align: "right" },
        { header: "Share", width: 80, align: "right" },
        { header: report.currency, width: 140, align: "right" },
      ],
      report.incomeCategories.map((c) => [c.name, String(c.count), `${c.share.toFixed(1)}%`, amount(c.total)]),
    );
  }

  const accounts = report.accounts.filter((a) => a.isActive || a.transactionCount > 0);
  if (accounts.length) {
    heading("Account activity", "Opening and closing balances for the period, in each account's own currency.");
    table(
      [
        { header: "Account", width: width - 400 },
        { header: "Opening", width: 100, align: "right" },
        { header: "In", width: 100, align: "right" },
        { header: "Out", width: 100, align: "right" },
        { header: "Closing", width: 100, align: "right" },
      ],
      accounts.map((a) => [
        a.name,
        amount(a.openingBalance, a.currency),
        amount(a.inflow, a.currency),
        amount(a.outflow, a.currency),
        amount(a.closingBalance, a.currency),
      ]),
    );
  }

  // Page footers
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Writing inside the bottom margin would otherwise make pdfkit add a page.
    doc.page.margins.bottom = 0;
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor(FAINT)
      .text(`${APP_NAME} · ${report.label} · Page ${i + 1} of ${range.count}`, MARGIN, doc.page.height - MARGIN + 8, {
        width,
        align: "center",
        lineBreak: false,
      });
  }

  doc.end();
  return done;
}
