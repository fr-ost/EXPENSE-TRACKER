import { describe, expect, it } from "vitest";
import { addMonths, describeSchedule, formatDate, isValidISODate, todayInTimeZone } from "@/lib/dates";
import {
  addMoney,
  formatCompactNumber,
  formatMoney,
  fromMinor,
  groupAmountInput,
  normalizeMoney,
  percentOf,
  sanitizeAmountInput,
  subtractMoney,
  toMinor,
} from "@/lib/money";
import { parseTransactionFilters, positiveAmount, transactionInput } from "@/lib/validation";

describe("money", () => {
  it("round-trips through minor units exactly", () => {
    expect(toMinor("1234.5")).toBe(123450n);
    expect(toMinor("-0.07")).toBe(-7n);
    expect(fromMinor(123450n)).toBe("1234.50");
    expect(fromMinor(-7n)).toBe("-0.07");
    expect(normalizeMoney("12")).toBe("12.00");
    expect(() => toMinor("1.234")).toThrow();
    expect(() => toMinor("1e3")).toThrow();
  });

  it("adds without floating-point drift", () => {
    expect(addMoney("0.1", "0.2")).toBe("0.30");
    expect(addMoney(...Array(1000).fill("0.01"))).toBe("10.00");
    expect(subtractMoney("100", "0.01")).toBe("99.99");
  });

  it("computes percentages on integers", () => {
    expect(percentOf("45000", "80000")).toBe(56.25);
    expect(percentOf("1", "3")).toBe(33.33);
    expect(percentOf("5", "0")).toBeNull();
  });

  it("formats with South Asian or international grouping", () => {
    expect(formatMoney("1250000", { grouping: "SOUTH_ASIAN" })).toBe("৳12,50,000");
    expect(formatMoney("1250000", { grouping: "INTERNATIONAL" })).toBe("৳1,250,000");
    expect(formatMoney("-2000.5")).toBe("−৳2,000.50");
    expect(formatMoney("2000", { sign: "always" })).toBe("+৳2,000");
    expect(formatMoney("99", { currency: "USD", decimals: "always" })).toBe("$99.00");
    expect(formatMoney("0.00")).toBe("৳0");
  });

  it("formats compact axis labels", () => {
    expect(formatCompactNumber(125000, "SOUTH_ASIAN")).toBe("1.3L");
    expect(formatCompactNumber(12_000_000, "SOUTH_ASIAN")).toBe("1.2Cr");
    expect(formatCompactNumber(1_500_000, "INTERNATIONAL")).toBe("1.5M");
  });

  it("sanitises amount keystrokes", () => {
    expect(sanitizeAmountInput("1,200.555")).toBe("1200.55");
    expect(sanitizeAmountInput("00012")).toBe("12");
    expect(sanitizeAmountInput(".5")).toBe("0.5");
    expect(sanitizeAmountInput("1.2.3")).toBe("1.23");
    expect(sanitizeAmountInput("abc")).toBe("");
    expect(groupAmountInput("1234567.5", "SOUTH_ASIAN")).toBe("12,34,567.5");
  });
});

describe("dates", () => {
  it("validates calendar dates", () => {
    expect(isValidISODate("2024-02-29")).toBe(true);
    expect(isValidISODate("2025-02-29")).toBe(false);
    expect(isValidISODate("2025-13-01")).toBe(false);
    expect(isValidISODate("25-01-01")).toBe(false);
  });

  it("clamps month arithmetic to month ends", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonths("2026-11-15", 3)).toBe("2027-02-15");
  });

  it("resolves today in the user's timezone, not the server's", () => {
    const instant = new Date("2026-09-27T20:30:00Z"); // 02:30 on the 28th in Dhaka
    expect(todayInTimeZone("Asia/Dhaka", instant)).toBe("2026-09-28");
    expect(todayInTimeZone("UTC", instant)).toBe("2026-09-27");
  });

  it("formats deterministically", () => {
    expect(formatDate("2026-09-28", "long")).toBe("Monday, 28 September 2026");
    expect(formatDate("2026-09-28", "weekdayShort")).toBe("Mon, 28 Sep");
    expect(describeSchedule("MONTHLY", "2026-01-31")).toBe("Monthly on the 31st (or the month's last day)");
    expect(describeSchedule("MONTHLY", "2026-01-12")).toBe("Monthly on the 12th");
    expect(describeSchedule("WEEKLY", "2026-10-02")).toBe("Weekly on Friday");
  });
});

describe("validation", () => {
  it("accepts only positive amounts with at most two decimals", () => {
    expect(positiveAmount.safeParse("10.50").success).toBe(true);
    for (const bad of ["0", "-5", "1.234", "1e5", "", "abc", "1234567890123"]) {
      expect(positiveAmount.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("rejects transfers to the same account and incomplete expense transfers", () => {
    const base = { type: "TRANSFER", amount: "10", date: "2026-09-01", description: "", notes: null, accountId: "a", toAmount: null, categoryId: null, scope: null };
    expect(transactionInput.safeParse({ ...base, toAccountId: "a", countAsExpense: false }).success).toBe(false);
    expect(transactionInput.safeParse({ ...base, toAccountId: "b", countAsExpense: true }).success).toBe(false);
    expect(transactionInput.safeParse({ ...base, toAccountId: "b", countAsExpense: false }).success).toBe(true);
  });

  it("drops invalid URL filters instead of failing", () => {
    const filters = parseTransactionFilters(new URLSearchParams("type=BOGUS&month=2026-13&min=abc&sort=newest&page=0&q=food"));
    expect(filters).toEqual({ sort: "newest", q: "food" });
  });
});

describe("greeting and times", () => {
  it("greets by the time of day in the owner's timezone", async () => {
    const { dayPart, greeting } = await import("@/lib/greeting");
    expect([4, 5, 11, 12, 16, 17, 23].map(dayPart)).toEqual(["evening", "morning", "morning", "afternoon", "afternoon", "evening", "evening"]);
    // 03:30 UTC is 09:30 in Dhaka (UTC+6) and 23:30 the day before in New York.
    const instant = new Date("2026-09-28T03:30:00Z");
    expect(greeting("Asia/Dhaka", instant)).toBe("Good morning");
    expect(greeting("America/New_York", instant)).toBe("Good evening");
    expect(greeting("Not/AZone", new Date("2026-09-28T13:00:00Z"))).toBe("Good afternoon");
  });

  it("formats times of day on a 12-hour clock", async () => {
    const { formatTime } = await import("@/lib/dates");
    expect(["00:05", "09:30", "12:00", "13:45", "23:59"].map(formatTime)).toEqual(["12:05 am", "9:30 am", "12:00 pm", "1:45 pm", "11:59 pm"]);
  });
});

describe("PDF text runs", () => {
  it("splits Bengali from Western text and replaces what neither font can show", async () => {
    const { textRuns } = await import("@/lib/server/export/pdf-text");
    expect(textRuns("bKash বিকাশ", true)).toEqual([
      { text: "bKash ", bengali: false },
      { text: "বিকাশ", bengali: true },
    ]);
    expect(textRuns("Café – 🍔 中", true)).toEqual([{ text: "Café – ? ?", bengali: false }]);
    // Without the font, Bengali degrades to "?" rather than corrupting the PDF.
    expect(textRuns("বাজার", false)).toEqual([{ text: "?????", bengali: false }]);
    expect(textRuns("−5.00", true)).toEqual([{ text: "-5.00", bengali: false }]);
  });

  it("accepts Bengali digits typed into amount fields", async () => {
    const { sanitizeAmountInput } = await import("@/lib/money");
    expect(sanitizeAmountInput("১,২৫০.৫০")).toBe("1250.50");
  });
});
