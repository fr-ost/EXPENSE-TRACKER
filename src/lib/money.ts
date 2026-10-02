/**
 * Exact money handling.
 *
 * Money travels through the app as a decimal string with two fraction digits
 * (e.g. "-1234.50"), is stored as NUMERIC(14,2), and any arithmetic in
 * JavaScript happens on bigint minor units. Floating point is only ever used
 * to hand values to charts, via the explicitly named `toChartNumber`.
 */

export type Money = string;

// A bare trailing point ("12.", mid-typing in an amount field) reads as whole units.
const MONEY_PATTERN = /^(-)?(\d+)(?:\.(\d{0,2}))?$/;

/** Upper bound of NUMERIC(14,2): 999,999,999,999.99 */
export const MAX_MINOR = 99_999_999_999_999n;

export const ZERO: Money = "0.00";

export function isMoneyString(value: string): boolean {
  return MONEY_PATTERN.test(value.trim());
}

export function toMinor(value: Money | bigint): bigint {
  if (typeof value === "bigint") return value;
  const match = MONEY_PATTERN.exec(value.trim());
  if (!match) throw new Error(`Invalid money value: "${value}"`);
  const [, negative, whole, fraction = ""] = match;
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return negative ? -minor : minor;
}

export function fromMinor(minor: bigint): Money {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const whole = abs / 100n;
  const fraction = (abs % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/** Canonicalise any accepted money string (e.g. "12", "12.5") to "12.50". */
export function normalizeMoney(value: Money | bigint): Money {
  return fromMinor(toMinor(value));
}

export function addMoney(...values: Array<Money | bigint>): Money {
  return fromMinor(values.reduce<bigint>((sum, v) => sum + toMinor(v), 0n));
}

export function subtractMoney(a: Money | bigint, b: Money | bigint): Money {
  return fromMinor(toMinor(a) - toMinor(b));
}

export function negateMoney(value: Money | bigint): Money {
  return fromMinor(-toMinor(value));
}

export function compareMoney(a: Money | bigint, b: Money | bigint): -1 | 0 | 1 {
  const diff = toMinor(a) - toMinor(b);
  return diff === 0n ? 0 : diff > 0n ? 1 : -1;
}

export function signOf(value: Money | bigint): -1 | 0 | 1 {
  return compareMoney(value, 0n);
}

export function isZero(value: Money | bigint): boolean {
  return toMinor(value) === 0n;
}

export function absMoney(value: Money | bigint): Money {
  const minor = toMinor(value);
  return fromMinor(minor < 0n ? -minor : minor);
}

/**
 * `part / whole` as a percentage with two decimals of precision, computed on
 * integers. Returns null when the ratio is undefined (whole is zero).
 */
export function percentOf(part: Money | bigint, whole: Money | bigint): number | null {
  const w = toMinor(whole);
  if (w === 0n) return null;
  const basisPoints = (toMinor(part) * 10_000n) / w;
  return Number(basisPoints) / 100;
}

// ---------------------------------------------------------------------------
// Exchange rates
// ---------------------------------------------------------------------------

/** Units of the main currency for one unit of another: up to 6 decimals ("122.45"). */
export type Rate = string;

const RATE_PATTERN = /^(\d{1,9})(?:\.(\d{1,6}))?$/;

/** A usable rate: a positive decimal with at most 6 decimals. */
export function isRate(value: string): boolean {
  return RATE_PATTERN.test(value.trim()) && /[1-9]/.test(value);
}

/** "0122.450000" → "122.45" */
export function normalizeRate(rate: Rate): Rate {
  const [whole, fraction = ""] = rate.trim().split(".");
  const kept = fraction.replace(/0+$/, "");
  return `${BigInt(whole || "0")}${kept ? `.${kept}` : ""}`;
}

/**
 * An amount in another currency, in the main one: exact, rounded to the
 * nearest paisa (halves away from zero, as Postgres ROUND does).
 */
export function convertMoney(value: Money | bigint, rate: Rate): Money {
  const match = RATE_PATTERN.exec(rate.trim());
  if (!match) throw new Error(`Invalid rate: "${rate}"`);
  const [, whole, fraction = ""] = match;
  const scale = 10n ** BigInt(fraction.length);
  const product = toMinor(value) * BigInt(whole + fraction);
  const quotient = product / scale;
  const remainder = product % scale;
  const away = (remainder < 0n ? -remainder : remainder) * 2n >= scale;
  return fromMinor(away ? quotient + (product < 0n ? -1n : 1n) : quotient);
}

/** For chart rendering only — never feed the result back into calculations. */
export function toChartNumber(value: Money | bigint): number {
  return Number(toMinor(value)) / 100;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export type GroupingStyle = "SOUTH_ASIAN" | "INTERNATIONAL";

export interface FormatMoneyOptions {
  currency?: string;
  grouping?: GroupingStyle;
  /** "auto" hides a zero fraction (৳2,000); "always" keeps it (৳2,000.00). */
  decimals?: "auto" | "always";
  /** "negative" shows − only for negatives; "always" also shows + for positives. */
  sign?: "negative" | "always" | "never";
  /** Omit the currency symbol. */
  plain?: boolean;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  BDT: "৳",
  USD: "$",
  EUR: "€",
  GBP: "£",
  INR: "₹",
  PKR: "Rs",
  AED: "AED ",
  SAR: "SAR ",
  MYR: "RM",
  SGD: "S$",
  CAD: "C$",
  AUD: "A$",
};

export function currencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency] ?? `${currency} `;
}

function groupDigits(digits: string, grouping: GroupingStyle): string {
  if (digits.length <= 3) return digits;
  const lastThree = digits.slice(-3);
  const rest = digits.slice(0, -3);
  const size = grouping === "SOUTH_ASIAN" ? 2 : 3;
  const groups: string[] = [];
  for (let end = rest.length; end > 0; end -= size) {
    groups.unshift(rest.slice(Math.max(0, end - size), end));
  }
  return `${groups.join(",")},${lastThree}`;
}

/**
 * Sanitise keyboard input for an amount field: digits and one decimal point,
 * at most 2 decimals and 12 integer digits. Returns the raw string (no
 * grouping) — it is never converted to a float.
 */
export function sanitizeAmountInput(input: string): string {
  // Bengali keyboards type ০-৯; `\d` only matches ASCII digits.
  let cleaned = input.replace(/[০-৯]/g, (digit) => String(digit.charCodeAt(0) - 0x09e6)).replace(/[^\d.]/g, "");
  const firstDot = cleaned.indexOf(".");
  if (firstDot !== -1) {
    cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, "");
  }
  let [whole, fraction] = cleaned.split(".") as [string, string | undefined];
  whole = whole.replace(/^0+(?=\d)/, "").slice(0, 12);
  if (fraction !== undefined) fraction = fraction.slice(0, 2);
  if (whole === "" && fraction !== undefined) whole = "0";
  return fraction === undefined ? whole : `${whole}.${fraction}`;
}

/** Group the digits of a raw amount for display ("1234567.5" → "12,34,567.5"). */
export function groupAmountInput(raw: string, grouping: GroupingStyle): string {
  if (!raw) return raw;
  const [whole, fraction] = raw.split(".");
  const grouped = groupDigits(whole || "0", grouping);
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

/**
 * Minor units of whatever an amount field can hold while typing ("", ".",
 * "12.", "1,200"), or null if it isn't a number at all. Showing an amount
 * must never throw: it runs while rendering.
 */
function displayMinor(value: Money | bigint): bigint | null {
  if (typeof value === "bigint") return value;
  const cleaned = value.replace(/[,\s]/g, "").replace(/^(-?)\./, "$10.");
  if (cleaned === "" || cleaned === "-" || cleaned === "0.") return 0n;
  return isMoneyString(cleaned) ? toMinor(cleaned) : null;
}

export function formatMoney(value: Money | bigint, options: FormatMoneyOptions = {}): string {
  const { currency = "BDT", grouping = "SOUTH_ASIAN", decimals = "auto", sign = "negative", plain = false } = options;
  const minor = displayMinor(value);
  if (minor === null) return `${plain ? "" : currencySymbol(currency)}${String(value)}`;
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const whole = groupDigits((abs / 100n).toString(), grouping);
  const fractionMinor = abs % 100n;
  const fraction = decimals === "always" || fractionMinor !== 0n ? `.${fractionMinor.toString().padStart(2, "0")}` : "";

  let prefix = "";
  if (sign !== "never") {
    if (negative) prefix = "−";
    else if (sign === "always" && minor > 0n) prefix = "+";
  }
  return `${prefix}${plain ? "" : currencySymbol(currency)}${whole}${fraction}`;
}

/** Compact axis labels: 12.5K / 3.2L / 1.1Cr (South Asian) or K / M / B. */
export function formatCompactNumber(value: number, grouping: GroupingStyle = "SOUTH_ASIAN"): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  const units: Array<[number, string]> =
    grouping === "SOUTH_ASIAN"
      ? [
          [1e7, "Cr"],
          [1e5, "L"],
          [1e3, "K"],
        ]
      : [
          [1e9, "B"],
          [1e6, "M"],
          [1e3, "K"],
        ];
  for (const [size, suffix] of units) {
    if (abs >= size) {
      const scaled = abs / size;
      const text = scaled >= 100 ? scaled.toFixed(0) : scaled.toFixed(1).replace(/\.0$/, "");
      return `${sign}${text}${suffix}`;
    }
  }
  return `${sign}${Math.round(abs)}`;
}
