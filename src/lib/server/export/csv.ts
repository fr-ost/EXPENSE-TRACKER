import "server-only";
import { EXPORT_COLUMNS, type ExportRow } from "./transaction-rows";

/**
 * Neutralise spreadsheet formula injection: a text cell starting with = + - @
 * (or a tab / carriage return) is prefixed with an apostrophe. Numeric
 * columns are written as plain decimals and never prefixed.
 */
export function safeText(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function quote(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function transactionsCsv(rows: ExportRow[]): string {
  const lines = [EXPORT_COLUMNS.map((c) => c.header).join(",")];
  for (const row of rows) {
    lines.push(
      EXPORT_COLUMNS.map(({ key, numeric }) => {
        const value = row[key];
        if (value === null || value === "") return "";
        if (typeof value === "boolean") return value ? "Yes" : "No";
        return quote(numeric ? value : safeText(value));
      }).join(","),
    );
  }
  // BOM so Excel opens UTF-8 (e.g. Bengali text) correctly.
  return `﻿${lines.join("\r\n")}\r\n`;
}
