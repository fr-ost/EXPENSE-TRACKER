import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/server/db";
import { getAccount, setAccountActive } from "@/lib/server/services/accounts";
import { budgetStatus, budgetsForMonth, setBudget } from "@/lib/server/services/budgets";
import {
  createRecurring,
  firstIndexOnOrAfter,
  listRecurring,
  occurrenceDate,
  postAllDue,
  setRecurringActive,
  skipNextOccurrence,
  updateRecurring,
} from "@/lib/server/services/recurring";
import { createTransaction } from "@/lib/server/services/transactions";
import type { RecurringInput } from "@/lib/validation";
import { categoryId, makeAccount, resetData } from "../support/fixtures";

describe("recurring schedule maths", () => {
  it("clamps month ends without drifting", () => {
    const dates = [0, 1, 2, 3].map((i) => occurrenceDate("2026-01-31", "MONTHLY", i));
    expect(dates).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(occurrenceDate("2024-02-29", "YEARLY", 1)).toBe("2025-02-28");
    expect(occurrenceDate("2024-02-29", "YEARLY", 4)).toBe("2028-02-29");
    expect(occurrenceDate("2026-09-01", "WEEKLY", 2)).toBe("2026-09-15");
  });

  it("finds the first occurrence on or after a date", () => {
    expect(firstIndexOnOrAfter("2026-01-05", "MONTHLY", "2026-09-28")).toBe(9); // 5 Oct
    expect(firstIndexOnOrAfter("2026-01-05", "MONTHLY", "2026-09-05")).toBe(8); // 5 Sep itself
    expect(firstIndexOnOrAfter("2020-01-01", "WEEKLY", "2026-09-28")).toBeGreaterThan(300);
    expect(firstIndexOnOrAfter("2026-01-05", "MONTHLY", "2026-01-01", "2026-03-05")).toBe(3);
  });
});

describe("recurring posting", () => {
  let bank: string;
  let rent: RecurringInput;

  beforeEach(async () => {
    await resetData();
    bank = await makeAccount({ name: "Bank", type: "BANK", openingBalance: "100000", openingDate: "2025-01-01" });
    rent = {
      type: "EXPENSE",
      amount: "22000",
      accountId: bank,
      toAccountId: null,
      toAmount: null,
      categoryId: await categoryId("EXPENSE", "Housing"),
      countAsExpense: false,
      scope: "PERSONAL",
      description: "Rent",
      notes: null,
      frequency: "MONTHLY",
      startDate: "2026-06-03",
      endDate: null,
      isActive: true,
    };
  });

  it("does not post the past unless asked to back-fill", async () => {
    await createRecurring(rent, { today: "2026-09-28", backfill: false });
    expect(await prisma.transaction.count()).toBe(0);
    const [rule] = await listRecurring();
    expect(rule.nextOccurrence).toBe("2026-10-03");
  });

  it("back-fills from a past start date", async () => {
    await createRecurring(rent, { today: "2026-09-28", backfill: true });
    const dates = (await prisma.transaction.findMany({ orderBy: { date: "asc" } })).map((t) => t.date.toISOString().slice(0, 10));
    expect(dates).toEqual(["2026-06-03", "2026-07-03", "2026-08-03", "2026-09-03"]);
    expect((await getAccount(bank, "2026-09-28")).balance).toBe(String(100000 - 4 * 22000) + ".00");
  });

  it("posts due occurrences exactly once, even when runs overlap", async () => {
    await createRecurring({ ...rent, startDate: "2026-10-03" }, { today: "2026-09-28", backfill: false });
    expect(await prisma.transaction.count()).toBe(0);

    await Promise.all([postAllDue("2026-12-05"), postAllDue("2026-12-05"), postAllDue("2026-12-05")]);
    await postAllDue("2026-12-05");
    expect(await prisma.transaction.count()).toBe(3); // Oct, Nov, Dec
    const [rule] = await listRecurring();
    expect(rule.nextOccurrence).toBe("2027-01-03");
    expect(rule.postedCount).toBe(3);
  });

  it("stops at the end date", async () => {
    await createRecurring({ ...rent, endDate: "2026-08-15" }, { today: "2026-09-28", backfill: true });
    expect(await prisma.transaction.count()).toBe(3);
    const [rule] = await listRecurring();
    expect(rule.nextOccurrence).toBeNull();
  });

  it("can skip the next occurrence", async () => {
    await createRecurring({ ...rent, startDate: "2026-10-03" }, { today: "2026-09-28", backfill: false });
    const [rule] = await listRecurring();
    await skipNextOccurrence(rule.id);
    await postAllDue("2026-11-10");
    const dates = (await prisma.transaction.findMany()).map((t) => t.date.toISOString().slice(0, 10));
    expect(dates).toEqual(["2026-11-03"]);
  });

  it("does not re-post the past when the schedule is edited", async () => {
    await createRecurring(rent, { today: "2026-09-28", backfill: true });
    const [rule] = await listRecurring();
    await updateRecurring(rule.id, { ...rent, startDate: "2026-06-10" }, "2026-09-28");
    await postAllDue("2026-09-28");
    expect(await prisma.transaction.count()).toBe(4);
    const [updated] = await listRecurring();
    expect(updated.nextOccurrence).toBe("2026-10-10");
  });

  it("skips occurrences missed while paused", async () => {
    await createRecurring({ ...rent, startDate: "2026-10-03" }, { today: "2026-09-28", backfill: false });
    const [rule] = await listRecurring();
    await setRecurringActive(rule.id, false, "2026-09-28");
    await postAllDue("2026-12-31");
    expect(await prisma.transaction.count()).toBe(0);
    await setRecurringActive(rule.id, true, "2026-12-31");
    expect(await prisma.transaction.count()).toBe(0);
    const [resumed] = await listRecurring();
    expect(resumed.nextOccurrence).toBe("2027-01-03");
  });

  it("pauses a rule whose account was deactivated instead of posting", async () => {
    await createRecurring({ ...rent, startDate: "2026-10-03" }, { today: "2026-09-28", backfill: false });
    await setAccountActive(bank, false);
    await postAllDue("2026-10-05");
    expect(await prisma.transaction.count()).toBe(0);
    const [rule] = await listRecurring();
    expect(rule.isActive).toBe(false);
  });
});

describe("budgets", () => {
  let cash: string;
  let bank: string;
  let food: string;
  let bills: string;
  let family: string;

  beforeEach(async () => {
    await resetData();
    cash = await makeAccount({ name: "Cash", openingBalance: "100000", openingDate: "2025-01-01" });
    bank = await makeAccount({ name: "Bank", type: "BANK", openingBalance: "100000", openingDate: "2025-01-01" });
    food = await categoryId("EXPENSE", "Food");
    bills = await categoryId("EXPENSE", "Bills");
    family = await categoryId("EXPENSE", "Family");
  });

  const spend = (category: string, amount: string, date: string, scope: "PERSONAL" | "FAMILY" = "PERSONAL", accountId = cash) =>
    createTransaction(
      { type: "EXPENSE", accountId, categoryId: category, amount, date, scope, description: "", notes: null },
      { today: "2026-12-31" },
    );
  const line = async (month: string, scope: "PERSONAL" | "FAMILY", fx: Parameters<typeof budgetsForMonth>[1] = "BDT") =>
    (await budgetsForMonth(month, fx)).lines.find((l) => l.scope === scope)!;

  it("has a Personal and a Family budget, applied from their month onward without rewriting history", async () => {
    expect((await budgetsForMonth("2026-09", "BDT")).lines.map((l) => [l.scope, l.budget, l.status])).toEqual([
      ["PERSONAL", null, "none"],
      ["FAMILY", null, "none"],
    ]);
    await setBudget("FAMILY", "2026-01", "9000");
    await setBudget("FAMILY", "2026-06", "12000");
    expect((await line("2025-12", "FAMILY")).budget).toBeNull();
    expect((await line("2026-03", "FAMILY")).budget).toBe("9000.00");
    expect(await line("2026-09", "FAMILY")).toMatchObject({ budget: "12000.00", effectiveFrom: "2026-06" });
    expect((await line("2026-09", "PERSONAL")).budget).toBeNull();

    await setBudget("FAMILY", "2026-10", "0");
    expect((await line("2026-11", "FAMILY")).budget).toBeNull();
    expect((await line("2026-09", "FAMILY")).budget).toBe("12000.00");
  });

  it("warns at 80%, flags 100%, and reports overspending", async () => {
    expect([budgetStatus(79.99), budgetStatus(80), budgetStatus(100), budgetStatus(100.01)]).toEqual(["ok", "warning", "reached", "over"]);

    await setBudget("PERSONAL", "2026-09", "10000");
    await spend(food, "8000", "2026-09-05");
    expect(await line("2026-09", "PERSONAL")).toMatchObject({ spent: "8000.00", remaining: "2000.00", percent: 80, status: "warning" });

    await spend(food, "2500", "2026-09-20");
    expect(await line("2026-09", "PERSONAL")).toMatchObject({ spent: "10500.00", remaining: "-500.00", status: "over" });
  });

  it("counts everything marked Family against the Family budget, whatever the category", async () => {
    await setBudget("FAMILY", "2026-09", "20000");
    await setBudget("PERSONAL", "2026-09", "20000");
    // A bill paid for the family is family spending, even though it's "Bills".
    await spend(bills, "3000", "2026-09-02", "FAMILY");
    await spend(food, "2000", "2026-09-03", "FAMILY");
    await spend(food, "1000", "2026-09-04", "PERSONAL");
    const familyWallet = await makeAccount({ name: "Family wallet", openingDate: "2025-01-01" });
    await createTransaction(
      {
        type: "TRANSFER",
        accountId: bank,
        toAccountId: familyWallet,
        amount: "4000",
        toAmount: null,
        countAsExpense: true,
        categoryId: family,
        scope: "FAMILY",
        date: "2026-09-05",
        description: "",
        notes: null,
      },
      { today: "2026-12-31" },
    );

    const familyLine = await line("2026-09", "FAMILY");
    expect(familyLine).toMatchObject({ spent: "9000.00", remaining: "11000.00", percent: 45, status: "ok" });
    expect(familyLine.categories.map((c) => [c.name, c.total])).toEqual([
      ["Family", "4000.00"],
      ["Bills", "3000.00"],
      ["Food", "2000.00"],
    ]);
    expect(await line("2026-09", "PERSONAL")).toMatchObject({ spent: "1000.00" });
    const month = await budgetsForMonth("2026-09", "BDT");
    expect([month.totalBudget, month.totalSpent]).toEqual(["40000.00", "10000.00"]);
  });

  it("counts spending in other currencies at their rate", async () => {
    const usd = await makeAccount({ name: "Card USD", currency: "USD", openingBalance: "500", openingDate: "2025-01-01" });
    await setBudget("PERSONAL", "2026-09", "5000");
    await spend(food, "1000", "2026-09-02");
    await spend(food, "12.50", "2026-09-03", "PERSONAL", usd);
    // Without a rate, the dollars can't be counted…
    expect((await line("2026-09", "PERSONAL")).spent).toBe("1000.00");
    // …at ৳120 per dollar they are: 12.50 × 120 = 1,500.
    expect((await line("2026-09", "PERSONAL", { base: "BDT", rates: { BDT: "1", USD: "120" } })).spent).toBe("2500.00");
  });
});
