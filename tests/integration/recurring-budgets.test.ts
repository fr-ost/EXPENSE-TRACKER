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
      scope: "OTHER",
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
  let family: string;

  beforeEach(async () => {
    await resetData();
    cash = await makeAccount({ name: "Cash", openingBalance: "100000", openingDate: "2025-01-01" });
    bank = await makeAccount({ name: "Bank", type: "BANK", openingBalance: "100000", openingDate: "2025-01-01" });
    food = await categoryId("EXPENSE", "Food");
    family = await categoryId("EXPENSE", "Family");
  });

  const spend = (category: string, amount: string, date: string) =>
    createTransaction(
      { type: "EXPENSE", accountId: cash, categoryId: category, amount, date, scope: "PERSONAL", description: "", notes: null },
      { today: "2026-12-31" },
    );

  it("applies a budget from its month onward without rewriting history", async () => {
    await setBudget(food, "2026-01", "9000");
    await setBudget(food, "2026-06", "12000");
    expect((await budgetsForMonth("2025-12", "BDT")).lines).toHaveLength(0);
    expect((await budgetsForMonth("2026-03", "BDT")).lines[0].budget).toBe("9000.00");
    expect((await budgetsForMonth("2026-09", "BDT")).lines[0]).toMatchObject({ budget: "12000.00", effectiveFrom: "2026-06" });

    await setBudget(food, "2026-10", "0");
    expect((await budgetsForMonth("2026-11", "BDT")).lines).toHaveLength(0);
    expect((await budgetsForMonth("2026-09", "BDT")).lines).toHaveLength(1);
  });

  it("warns at 80%, flags 100%, and reports overspending", async () => {
    expect([budgetStatus(79.99), budgetStatus(80), budgetStatus(100), budgetStatus(100.01)]).toEqual(["ok", "warning", "reached", "over"]);

    await setBudget(food, "2026-09", "10000");
    await spend(food, "8000", "2026-09-05");
    let [line] = (await budgetsForMonth("2026-09", "BDT")).lines;
    expect(line).toMatchObject({ spent: "8000.00", remaining: "2000.00", percent: 80, status: "warning" });

    await spend(food, "2500", "2026-09-20");
    [line] = (await budgetsForMonth("2026-09", "BDT")).lines;
    expect(line).toMatchObject({ spent: "10500.00", remaining: "-500.00", status: "over" });
  });

  it("counts transfers marked as expense against the category budget", async () => {
    const familyWallet = await makeAccount({ name: "Family wallet", openingDate: "2025-01-01" });
    await setBudget(family, "2026-09", "10000");
    await createTransaction(
      {
        type: "TRANSFER",
        accountId: bank,
        toAccountId: familyWallet,
        amount: "10000",
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
    const month = await budgetsForMonth("2026-09", "BDT");
    expect(month.lines[0]).toMatchObject({ spent: "10000.00", status: "reached" });
  });

  it("lists unbudgeted spending separately", async () => {
    await setBudget(food, "2026-09", "10000");
    await spend(await categoryId("EXPENSE", "Transport"), "300", "2026-09-02");
    const month = await budgetsForMonth("2026-09", "BDT");
    expect(month.unbudgeted.map((c) => c.name)).toEqual(["Transport"]);
  });
});
