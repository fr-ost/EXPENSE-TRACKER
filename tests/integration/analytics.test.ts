import { beforeAll, describe, expect, it } from "vitest";
import {
  accountActivity,
  categoryTotals,
  cumulative,
  dailySpending,
  monthlySeries,
  periodSummary,
  scopeTotals,
  yearReport,
} from "@/lib/server/services/analytics";
import { createTransaction } from "@/lib/server/services/transactions";
import type { TransactionInput } from "@/lib/validation";
import { categoryId, makeAccount, resetData } from "../support/fixtures";

const TODAY = "2026-09-30";

describe("analytics — the specification's September 2026 example", () => {
  let bank: string;
  let cash: string;
  let familyAccount: string;
  let usd: string;

  beforeAll(async () => {
    await resetData();
    bank = await makeAccount({ name: "Bank", type: "BANK", openingBalance: "100000", openingDate: "2026-01-01" });
    cash = await makeAccount({ name: "Cash", openingBalance: "5000", openingDate: "2026-01-01" });
    familyAccount = await makeAccount({ name: "Family", type: "OTHER", openingDate: "2026-01-01" });
    usd = await makeAccount({ name: "USD", currency: "USD", openingDate: "2026-01-01" });

    const salary = await categoryId("INCOME", "Salary");
    const food = await categoryId("EXPENSE", "Food");
    const housing = await categoryId("EXPENSE", "Housing");
    const family = await categoryId("EXPENSE", "Family");
    const add = (t: TransactionInput) => createTransaction(t, { today: TODAY });
    const base = { description: "", notes: null };

    // September: income 80,000; direct expenses 25,000; plain transfer 20,000;
    // transfer counted as expense 10,000.
    await add({ ...base, type: "INCOME", accountId: bank, categoryId: salary, amount: "80000", date: "2026-09-01" });
    await add({ ...base, type: "EXPENSE", accountId: bank, categoryId: housing, amount: "20000", date: "2026-09-03", scope: "OTHER" });
    await add({ ...base, type: "EXPENSE", accountId: cash, categoryId: food, amount: "3000", date: "2026-09-10", scope: "PERSONAL" });
    await add({ ...base, type: "EXPENSE", accountId: cash, categoryId: food, amount: "2000", date: "2026-09-12", scope: "FAMILY" });
    await add({ ...base, type: "TRANSFER", accountId: bank, toAccountId: cash, amount: "20000", toAmount: null, countAsExpense: false, categoryId: null, scope: null, date: "2026-09-05" });
    await add({ ...base, type: "TRANSFER", accountId: bank, toAccountId: familyAccount, amount: "10000", toAmount: null, countAsExpense: true, categoryId: family, scope: "FAMILY", date: "2026-09-06" });

    // August, for trends; and a USD expense that must never mix into BDT totals.
    await add({ ...base, type: "INCOME", accountId: bank, categoryId: salary, amount: "80000", date: "2026-08-01" });
    await add({ ...base, type: "EXPENSE", accountId: cash, categoryId: food, amount: "4000", date: "2026-08-15", scope: "PERSONAL" });
    await add({ ...base, type: "EXPENSE", accountId: usd, categoryId: food, amount: "999", date: "2026-09-15", scope: "PERSONAL" });
  });

  it("classifies income, expenses and transfers without double counting", async () => {
    const s = await periodSummary("2026-09-01", "2026-09-30", "BDT");
    expect(s.income).toBe("80000.00");
    expect(s.expenses).toBe("35000.00");
    expect(s.directExpenses).toBe("25000.00");
    expect(s.transferExpenses).toBe("10000.00");
    expect(s.transfers).toBe("20000.00");
    expect(s.transferCount).toBe(1);
    expect(s.netSavings).toBe("45000.00");
    expect(s.savingsRate).toBe(56.25);
  });

  it("keeps other currencies out of base-currency totals", async () => {
    const usdSummary = await periodSummary("2026-09-01", "2026-09-30", "USD");
    expect(usdSummary.expenses).toBe("999.00");
    expect(usdSummary.savingsRate).toBeNull();
  });

  it("builds a monthly series", async () => {
    const series = await monthlySeries("2026-07", "2026-09", "BDT");
    expect(series.map((m) => m.month)).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(series[0]).toMatchObject({ income: "0.00", expenses: "0.00", savingsRate: null });
    expect(series[1]).toMatchObject({ income: "80000.00", expenses: "4000.00", savings: "76000.00", savingsRate: 95 });
    expect(series[2]).toMatchObject({ expenses: "35000.00", savings: "45000.00" });
  });

  it("splits spending by category and by family / personal", async () => {
    const categories = await categoryTotals("2026-09-01", "2026-09-30", "BDT");
    expect(categories.map((c) => [c.name, c.total])).toEqual([
      ["Housing", "20000.00"],
      ["Family", "10000.00"],
      ["Food", "5000.00"],
    ]);
    expect(categories.reduce((sum, c) => sum + c.share, 0)).toBeCloseTo(100, 1);

    const scopes = await scopeTotals("2026-09-01", "2026-09-30", "BDT");
    expect(Object.fromEntries(scopes.map((s) => [s.scope, s.total]))).toEqual({
      FAMILY: "12000.00",
      PERSONAL: "3000.00",
      OTHER: "20000.00",
    });

    const familyOnly = await categoryTotals("2026-09-01", "2026-09-30", "BDT", "EXPENSE", "FAMILY");
    expect(familyOnly.map((c) => [c.name, c.total])).toEqual([
      ["Family", "10000.00"],
      ["Food", "2000.00"],
    ]);
  });

  it("computes daily and cumulative spending exactly", async () => {
    const days = await dailySpending("2026-09-01", "2026-09-30", "BDT");
    expect(days).toHaveLength(30);
    expect(days.find((d) => d.date === "2026-09-06")?.total).toBe("10000.00");
    expect(cumulative(days).at(-1)?.total).toBe("35000.00");
  });

  it("reports account activity with opening and closing balances", async () => {
    const activity = await accountActivity("2026-09-01", "2026-09-30");
    const bankRow = activity.find((a) => a.name === "Bank")!;
    // Opening: 100,000 + 80,000 (Aug salary). Sept: +80,000 in; −20,000 −20,000 −10,000 out.
    expect(bankRow).toMatchObject({ openingBalance: "180000.00", inflow: "80000.00", outflow: "50000.00", closingBalance: "210000.00" });
    const familyRow = activity.find((a) => a.name === "Family")!;
    expect(familyRow).toMatchObject({ inflow: "10000.00", closingBalance: "10000.00" });
  });

  it("summarises a year with its highest category and month", async () => {
    const report = await yearReport(2026, "BDT");
    expect(report.summary.income).toBe("160000.00");
    expect(report.summary.expenses).toBe("39000.00");
    expect(report.months).toHaveLength(12);
    expect(report.highestCategory?.name).toBe("Housing");
    expect(report.highestSpendingMonth?.month).toBe("2026-09");
    expect(report.scopes.find((s) => s.scope === "FAMILY")?.total).toBe("12000.00");
  });
});
