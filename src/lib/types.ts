/**
 * View models passed from the server to client components. Money is always a
 * decimal string (see lib/money.ts); dates are "YYYY-MM-DD".
 */
import type { ISODate, MonthKey } from "./dates";
import type { AccountType, CategoryKind, ExpenseScope, Frequency, TransactionType } from "./domain";
import type { Money } from "./money";

export interface AccountRef {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
  icon: string | null;
  color: string | null;
  isActive: boolean;
}

export interface AccountSummary extends AccountRef {
  openingBalance: Money;
  openingDate: ISODate;
  sortOrder: number;
  /** Opening balance + every ledger movement dated today or earlier. */
  balance: Money;
  inflow: Money;
  outflow: Money;
  transactionCount: number;
  lastActivity: ISODate | null;
  /** Net of transactions dated after today (not yet in the balance). */
  scheduledNet: Money;
}

export interface CategoryRef {
  id: string;
  name: string;
  kind: CategoryKind;
  icon: string;
  color: string;
  defaultScope: ExpenseScope | null;
  isArchived: boolean;
}

export interface CategoryWithUsage extends CategoryRef {
  sortOrder: number;
  transactionCount: number;
}

export interface TransactionView {
  id: string;
  type: TransactionType;
  amount: Money;
  toAmount: Money | null;
  date: ISODate;
  /** "HH:MM" when known. */
  time: string | null;
  description: string;
  notes: string | null;
  account: AccountRef;
  toAccount: AccountRef | null;
  category: CategoryRef | null;
  countAsExpense: boolean;
  scope: ExpenseScope | null;
  recurringId: string | null;
  /** Added from a bank or wallet SMS. */
  fromSms: boolean;
  createdAt: string;
}

export interface TransactionListSummary {
  /** Totals are for accounts in the base currency. */
  currency: string;
  income: Money;
  /** Expenses + transfers counted as expense. */
  expenses: Money;
  /** Transfers not counted as expense. */
  transfers: Money;
}

export interface TransactionPage {
  items: TransactionView[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  summary: TransactionListSummary;
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export interface PeriodSummary {
  from: ISODate;
  to: ISODate;
  currency: string;
  income: Money;
  /** Expense-classified outflow: direct expenses + transfers counted as expense. */
  expenses: Money;
  directExpenses: Money;
  transferExpenses: Money;
  /** Transfers between own accounts that are not counted as spending (pure movement). */
  transfers: Money;
  transferCount: number;
  adjustments: Money;
  /** income − expenses */
  netSavings: Money;
  /** netSavings / income × 100; null when there is no income. */
  savingsRate: number | null;
}

export interface MonthPoint {
  month: MonthKey;
  income: Money;
  expenses: Money;
  savings: Money;
  savingsRate: number | null;
}

export interface CategoryTotal {
  categoryId: string;
  name: string;
  icon: string;
  color: string;
  total: Money;
  count: number;
  /** Share of the period total, in percent. */
  share: number;
}

export interface ScopeTotal {
  scope: ExpenseScope;
  total: Money;
  count: number;
  share: number;
}

export interface DayPoint {
  date: ISODate;
  total: Money;
}

export interface AccountActivity extends AccountRef {
  openingBalance: Money;
  inflow: Money;
  outflow: Money;
  closingBalance: Money;
  transactionCount: number;
}

export interface BudgetLine {
  category: CategoryRef;
  budget: Money;
  spent: Money;
  remaining: Money;
  /** Percent used (can exceed 100). */
  percent: number;
  status: "ok" | "warning" | "reached" | "over";
  /** First month this budget amount applies from. */
  effectiveFrom: MonthKey;
}

export interface RecurringView {
  id: string;
  type: Exclude<TransactionType, "ADJUSTMENT">;
  amount: Money;
  toAmount: Money | null;
  account: AccountRef;
  toAccount: AccountRef | null;
  category: CategoryRef | null;
  countAsExpense: boolean;
  scope: ExpenseScope | null;
  description: string;
  notes: string | null;
  frequency: Frequency;
  startDate: ISODate;
  endDate: ISODate | null;
  nextOccurrence: ISODate | null;
  isActive: boolean;
  postedCount: number;
}

/** A signed-in device, as shown in Settings (no session identifiers). */
export interface SessionInfo {
  current: boolean;
  signedIn: string;
  lastActive: string;
  device: string;
}
