import "server-only";
import { fromDbDate } from "@/lib/dates";
import { SCOPE_META, TRANSACTION_TYPE_LABELS, isRecognizedExpense } from "@/lib/domain";
import type { Money } from "@/lib/money";
import type { TransactionFilters } from "@/lib/validation";
import { prisma } from "../db";
import { buildTransactionWhere, transactionOrderBy } from "../services/transactions";
import { money, moneyOrNull, transactionInclude } from "../services/mappers";

/** Exports are capped so a runaway query can't exhaust memory. */
export const EXPORT_ROW_LIMIT = 100_000;

export interface ExportRow {
  date: string;
  type: string;
  /** How the row counts in reports: Income, Spending, Transfer or Adjustment. */
  countsAs: string;
  description: string;
  category: string;
  classification: string;
  account: string;
  toAccount: string;
  amount: Money;
  currency: string;
  amountReceived: Money | null;
  receivedCurrency: string;
  notes: string;
  recurring: boolean;
}

export const EXPORT_COLUMNS: Array<{ key: keyof ExportRow; header: string; numeric?: boolean }> = [
  { key: "date", header: "Date" },
  { key: "type", header: "Type" },
  { key: "countsAs", header: "Counts as" },
  { key: "description", header: "Description" },
  { key: "category", header: "Category" },
  { key: "classification", header: "Classification" },
  { key: "account", header: "Account" },
  { key: "toAccount", header: "To account" },
  { key: "amount", header: "Amount", numeric: true },
  { key: "currency", header: "Currency" },
  { key: "amountReceived", header: "Amount received", numeric: true },
  { key: "receivedCurrency", header: "Received currency" },
  { key: "notes", header: "Notes" },
  { key: "recurring", header: "Recurring" },
];

/** Every transaction matching the filters (all pages), in the requested order. */
export async function exportTransactionRows(filters: TransactionFilters): Promise<ExportRow[]> {
  const rows = await prisma.transaction.findMany({
    where: buildTransactionWhere(filters),
    include: transactionInclude,
    orderBy: filters.sort ? transactionOrderBy(filters.sort) : [{ date: "asc" }, { createdAt: "asc" }],
    take: EXPORT_ROW_LIMIT,
  });
  return rows.map((row) => ({
    date: fromDbDate(row.date),
    type: TRANSACTION_TYPE_LABELS[row.type],
    countsAs:
      row.type === "INCOME"
        ? "Income"
        : isRecognizedExpense(row.type, row.countAsExpense)
          ? "Spending"
          : row.type === "TRANSFER"
            ? "Transfer"
            : "Adjustment",
    description: row.description,
    category: row.category?.name ?? "",
    classification: row.scope ? SCOPE_META[row.scope].label : "",
    account: row.account.name,
    toAccount: row.toAccount?.name ?? "",
    amount: money(row.amount),
    currency: row.account.currency,
    amountReceived: row.type === "TRANSFER" ? (moneyOrNull(row.toAmount) ?? money(row.amount)) : null,
    receivedCurrency: row.toAccount?.currency ?? "",
    notes: row.notes ?? "",
    recurring: row.recurringId !== null,
  }));
}
