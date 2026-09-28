"use client";

import * as React from "react";
import type { ISODate } from "@/lib/dates";
import type { NumberFormat } from "@/lib/domain";
import { formatMoney, type FormatMoneyOptions, type Money } from "@/lib/money";
import type { AccountSummary, CategoryRef } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface ClientSettings {
  displayName: string;
  baseCurrency: string;
  timezone: string;
  numberFormat: NumberFormat;
  autoLockMinutes: number;
}

interface AppData {
  settings: ClientSettings;
  today: ISODate;
  accounts: AccountSummary[];
  categories: CategoryRef[];
}

const AppDataContext = React.createContext<AppData | null>(null);

export function AppDataProvider({ value, children }: { value: AppData; children: React.ReactNode }) {
  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData(): AppData {
  const value = React.useContext(AppDataContext);
  if (!value) throw new Error("useAppData must be used inside <AppDataProvider>.");
  return value;
}

export function useFormatMoney() {
  const { settings } = useAppData();
  return React.useCallback(
    (value: Money | bigint, options: FormatMoneyOptions = {}) =>
      formatMoney(value, { currency: settings.baseCurrency, grouping: settings.numberFormat, ...options }),
    [settings.baseCurrency, settings.numberFormat],
  );
}

/**
 * The one way money is rendered: tabular figures, the user's grouping
 * style, a true minus sign, and optional semantic colouring.
 */
export function Amount({
  value,
  currency,
  sign = "negative",
  decimals,
  tone = "none",
  tabular = true,
  className,
}: {
  value: Money | bigint;
  currency?: string;
  sign?: FormatMoneyOptions["sign"];
  decimals?: FormatMoneyOptions["decimals"];
  /** "signed": green when positive, red when negative. "income": green for positive only. */
  tone?: "none" | "signed" | "income";
  /** Equal-width digits for aligned columns; turn off for large standalone figures. */
  tabular?: boolean;
  className?: string;
}) {
  const format = useFormatMoney();
  const text = format(value, { currency, sign, decimals });
  const negative = typeof value === "bigint" ? value < 0n : value.trim().startsWith("-");
  const positive = !negative && !/^[0.]*$/.test(typeof value === "bigint" ? value.toString() : value);
  return (
    <span
      className={cn(
        "whitespace-nowrap",
        tabular && "tabular",
        tone === "signed" && negative && "text-negative-text",
        (tone === "signed" || tone === "income") && positive && "text-positive-text",
        className,
      )}
    >
      {text}
    </span>
  );
}
