/**
 * Calendar dates as "YYYY-MM-DD" strings.
 *
 * Transactions happen on a calendar day, not an instant, so the app never
 * stores times for them. Arithmetic uses UTC so it is immune to the server's
 * timezone; "today" is resolved in the user's configured timezone.
 */

export type ISODate = string;
/** "YYYY-MM" */
export type MonthKey = string;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;

export function isValidISODate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  if (y < 1900 || y > 2200 || m < 1 || m > 12) return false;
  return d >= 1 && d <= daysInMonth(y, m);
}

export function parseISODate(value: ISODate): { year: number; month: number; day: number } {
  const match = DATE_PATTERN.exec(value);
  if (!match) throw new Error(`Invalid date: "${value}"`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function makeISODate(year: number, month: number, day: number): ISODate {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Prisma maps @db.Date columns to Date objects at UTC midnight. */
export function toDbDate(value: ISODate): Date {
  if (!isValidISODate(value)) throw new Error(`Invalid date: "${value}"`);
  return new Date(`${value}T00:00:00.000Z`);
}

export function fromDbDate(value: Date): ISODate {
  return value.toISOString().slice(0, 10);
}

export function todayInTimeZone(timeZone: string, now: Date = new Date()): ISODate {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

function toUTC(value: ISODate): Date {
  const { year, month, day } = parseISODate(value);
  return new Date(Date.UTC(year, month - 1, day));
}

function fromUTC(date: Date): ISODate {
  return date.toISOString().slice(0, 10);
}

export function addDays(value: ISODate, days: number): ISODate {
  const date = toUTC(value);
  date.setUTCDate(date.getUTCDate() + days);
  return fromUTC(date);
}

/** Adds months, clamping to month end (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(value: ISODate, months: number): ISODate {
  const { year, month, day } = parseISODate(value);
  const total = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(total / 12);
  const targetMonth = (total % 12) + 1;
  return makeISODate(targetYear, targetMonth, Math.min(day, daysInMonth(targetYear, targetMonth)));
}

export function addYears(value: ISODate, years: number): ISODate {
  return addMonths(value, years * 12);
}

export function diffInDays(later: ISODate, earlier: ISODate): number {
  return Math.round((toUTC(later).getTime() - toUTC(earlier).getTime()) / 86_400_000);
}

export function startOfMonth(value: ISODate): ISODate {
  const { year, month } = parseISODate(value);
  return makeISODate(year, month, 1);
}

export function endOfMonth(value: ISODate): ISODate {
  const { year, month } = parseISODate(value);
  return makeISODate(year, month, daysInMonth(year, month));
}

export function minDate(a: ISODate, b: ISODate): ISODate {
  return a < b ? a : b;
}

export function maxDate(a: ISODate, b: ISODate): ISODate {
  return a > b ? a : b;
}

// ---------------------------------------------------------------------------
// Months
// ---------------------------------------------------------------------------

export function isValidMonthKey(value: string): boolean {
  const match = MONTH_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  return year >= 1900 && year <= 2200 && month >= 1 && month <= 12;
}

export function monthKeyOf(value: ISODate): MonthKey {
  return value.slice(0, 7);
}

export function monthStart(key: MonthKey): ISODate {
  return `${key}-01`;
}

export function monthEnd(key: MonthKey): ISODate {
  return endOfMonth(monthStart(key));
}

export function shiftMonth(key: MonthKey, months: number): MonthKey {
  return monthKeyOf(addMonths(monthStart(key), months));
}

export function monthKeysOfYear(year: number): MonthKey[] {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
}

// ---------------------------------------------------------------------------
// Formatting — deterministic (no Intl), so server and browser render the same
// text regardless of their ICU versions.
// ---------------------------------------------------------------------------

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export type DateStyle = "short" | "medium" | "long" | "weekdayShort" | "monthYear" | "monthShortYear" | "monthShort" | "monthLong";

export function formatDate(value: ISODate, style: DateStyle = "medium"): string {
  const { year, month, day } = parseISODate(value);
  const monthLong = MONTHS[month - 1];
  const monthShort = monthLong.slice(0, 3);
  const weekday = WEEKDAYS[toUTC(value).getUTCDay()];
  switch (style) {
    case "short":
      return `${day} ${monthShort}`;
    case "medium":
      return `${day} ${monthShort} ${year}`;
    case "long":
      return `${weekday}, ${day} ${monthLong} ${year}`;
    case "weekdayShort":
      return `${weekday.slice(0, 3)}, ${day} ${monthShort}`;
    case "monthYear":
      return `${monthLong} ${year}`;
    case "monthShortYear":
      return `${monthShort} ${year}`;
    case "monthShort":
      return monthShort;
    case "monthLong":
      return monthLong;
  }
}

export function formatMonth(key: MonthKey, style: "long" | "short" = "long"): string {
  return formatDate(monthStart(key), style === "long" ? "monthYear" : "monthShortYear");
}

/** "today", "yesterday" or "on 22 Sep" — for use inside a sentence. */
export function describeDay(value: ISODate, today: ISODate): string {
  const diff = diffInDays(today, value);
  if (diff === 0) return "today";
  if (diff === 1) return "yesterday";
  return `on ${formatDate(value, value.slice(0, 4) === today.slice(0, 4) ? "short" : "medium")}`;
}

/** "Today", "Yesterday", or a formatted date, relative to `today`. */
export function formatRelativeDay(value: ISODate, today: ISODate): string {
  const diff = diffInDays(today, value);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff === -1) return "Tomorrow";
  const sameYear = value.slice(0, 4) === today.slice(0, 4);
  return sameYear ? formatDate(value, "weekdayShort") : formatDate(value, "medium");
}

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** "Monthly on the 3rd", "Weekly on Monday", "Yearly on 3 June". */
export function describeSchedule(frequency: "WEEKLY" | "MONTHLY" | "YEARLY", startDate: ISODate): string {
  const { day } = parseISODate(startDate);
  switch (frequency) {
    case "WEEKLY":
      return `Weekly on ${formatDate(startDate, "long").split(",")[0]}`;
    case "MONTHLY":
      return day >= 29 ? `Monthly on the ${ordinal(day)} (or the month's last day)` : `Monthly on the ${ordinal(day)}`;
    case "YEARLY":
      return `Yearly on ${day} ${formatDate(startDate, "monthLong")}`;
  }
}
