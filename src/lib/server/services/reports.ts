import "server-only";
import { formatMonth, isValidMonthKey, monthEnd, monthKeyOf, monthStart, type ISODate, type MonthKey } from "@/lib/dates";
import { EXPENSE_SCOPES, type ExpenseScope } from "@/lib/domain";
import type { Rate } from "@/lib/money";
import type { AccountActivity, CategoryTotal, DayPoint, MonthPoint, PeriodSummary, ScopeTotal } from "@/lib/types";
import {
  accountActivity,
  categoryTotals,
  dailySpending,
  periodSummary,
  scopeTotals,
  yearReport,
} from "./analytics";
import { asConversion, type CurrencyBasis } from "./currency";

export type ReportPeriod = { kind: "month"; month: MonthKey } | { kind: "year"; year: number };

export interface ReportData {
  period: ReportPeriod;
  label: string;
  from: ISODate;
  to: ISODate;
  /** The main currency every total is in. */
  currency: string;
  /** Other currencies counted, at these rates (main-currency units for one). */
  rates: Array<{ currency: string; rate: Rate }>;
  summary: PeriodSummary;
  /** Year reports: one point per month. */
  months: MonthPoint[] | null;
  /** Month reports: spending per day. */
  daily: DayPoint[] | null;
  categories: CategoryTotal[];
  incomeCategories: CategoryTotal[];
  scopes: ScopeTotal[];
  /** Leading categories within Personal / Family. */
  scopeCategories: Record<ExpenseScope, CategoryTotal[]>;
  accounts: AccountActivity[];
  highestCategory: CategoryTotal | null;
  highestSpendingMonth: MonthPoint | null;
}

/** Read the period from search params; invalid values fall back to the current month. */
export function parseReportPeriod(params: Record<string, string | string[] | undefined> | URLSearchParams, today: ISODate): ReportPeriod {
  const get = (key: string) => {
    const value = params instanceof URLSearchParams ? params.get(key) : params[key];
    return (Array.isArray(value) ? value[0] : value) ?? undefined;
  };
  const currentYear = Number(today.slice(0, 4));
  if (get("period") === "year") {
    const year = Number(get("year"));
    return { kind: "year", year: Number.isInteger(year) && year >= 1900 && year <= currentYear ? year : currentYear };
  }
  const month = get("month");
  const currentMonth = monthKeyOf(today);
  return { kind: "month", month: month && isValidMonthKey(month) && month <= currentMonth ? month : currentMonth };
}

export function periodRange(period: ReportPeriod): { from: ISODate; to: ISODate; label: string } {
  return period.kind === "month"
    ? { from: monthStart(period.month), to: monthEnd(period.month), label: formatMonth(period.month) }
    : { from: `${period.year}-01-01`, to: `${period.year}-12-31`, label: String(period.year) };
}

export async function buildReport(period: ReportPeriod, fx: CurrencyBasis, today: ISODate): Promise<ReportData> {
  const { from, to, label } = periodRange(period);
  const currentMonth = monthKeyOf(today);
  const conversion = asConversion(fx);
  const currency = conversion.base;
  const rates = Object.entries(conversion.rates)
    .filter(([code]) => code !== currency)
    .map(([code, rate]) => ({ currency: code, rate }));

  const [scopeCategoryLists, accounts, incomeCategories] = await Promise.all([
    Promise.all(EXPENSE_SCOPES.map((scope) => categoryTotals(from, to, fx, "EXPENSE", scope))),
    accountActivity(from, to),
    categoryTotals(from, to, fx, "INCOME"),
  ]);
  const scopeCategories = Object.fromEntries(EXPENSE_SCOPES.map((scope, i) => [scope, scopeCategoryLists[i]])) as Record<
    ExpenseScope,
    CategoryTotal[]
  >;

  if (period.kind === "year") {
    const year = await yearReport(period.year, fx);
    // The current year is reported "to date": future months are omitted.
    const isCurrentYear = String(period.year) === today.slice(0, 4);
    return {
      period,
      label: isCurrentYear ? `${label} (year to date)` : label,
      from,
      to,
      currency,
      rates,
      summary: year.summary,
      months: isCurrentYear ? year.months.filter((m) => m.month <= currentMonth) : year.months,
      daily: null,
      categories: year.categories,
      incomeCategories,
      scopes: year.scopes,
      scopeCategories,
      accounts,
      highestCategory: year.highestCategory,
      highestSpendingMonth: year.highestSpendingMonth,
    };
  }

  const [summary, daily, categories, scopes] = await Promise.all([
    periodSummary(from, to, fx),
    dailySpending(from, to, fx),
    categoryTotals(from, to, fx, "EXPENSE"),
    scopeTotals(from, to, fx),
  ]);
  return {
    period,
    label,
    from,
    to,
    currency,
    rates,
    summary,
    months: null,
    daily,
    categories,
    incomeCategories,
    scopes,
    scopeCategories,
    accounts,
    highestCategory: categories[0] ?? null,
    highestSpendingMonth: null,
  };
}
