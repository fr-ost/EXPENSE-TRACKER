/**
 * Exact money handling.
 *
 * Money travels through the app as a decimal string with two fraction digits
 * (e.g. "-1234.50"), is stored as NUMERIC(14,2), and any arithmetic in
 * JavaScript happens on bigint minor units. Floating point is only ever used
 * to hand values to charts, via the explicitly named `toChartNumber`.
 */

export type Money = string;

const MONEY_PATTERN = /^(-)?(\d+)(?:\.(\d{1,2}))?$/;

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
  let cleaned = input.replace(/[^\d.]/g, "");
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

export function formatMoney(value: Money | bigint, options: FormatMoneyOptions = {}): string {
  const { currency = "BDT", grouping = "SOUTH_ASIAN", decimals = "auto", sign = "negative", plain = false } = options;
  const minor = toMinor(value);
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
