import { beforeEach, describe, expect, it } from "vitest";
import { createSession, deleteOtherSessions } from "@/lib/server/auth/session";
import { prisma } from "@/lib/server/db";
import { exportTransactionRows } from "@/lib/server/export/transaction-rows";
import {
  balanceAsOf,
  balanceHistory,
  deleteAccount,
  getAccount,
  listAccounts,
  setAccountActive,
  updateAccount,
} from "@/lib/server/services/accounts";
import {
  accountActivity,
  categoryTotals,
  dailySpending,
  ledgerRange,
  monthlySeries,
  periodSummary,
  scopeTotals,
  yearReport,
} from "@/lib/server/services/analytics";
import { deleteBalanceUpdate, listBalanceUpdates, recordedBalanceAt, updateBalance } from "@/lib/server/services/balances";
import { budgetsForMonth, setBudget } from "@/lib/server/services/budgets";
import { createCategory, deleteCategory, listCategories, updateCategory } from "@/lib/server/services/categories";
import { loadCurrencies, setManualRate } from "@/lib/server/services/currency";
import {
  createRecurring,
  deleteRecurring,
  ensureRecurringPosted,
  listRecurring,
  postAllDue,
  postDueForRule,
  setRecurringActive,
  skipNextOccurrence,
  updateRecurring,
} from "@/lib/server/services/recurring";
import { buildReport } from "@/lib/server/services/reports";
import { listSessions, updateSettings } from "@/lib/server/services/settings";
import { checkSms, importSms, saveSmsBalances } from "@/lib/server/services/sms";
import {
  createTransaction,
  deleteTransaction,
  getTransaction,
  listTransactions,
  recentTransactions,
  updateTransaction,
} from "@/lib/server/services/transactions";
import { deleteUser, deleteUserData } from "@/lib/server/services/users";
import { getSettings } from "@/lib/server/settings";
import type { UserId } from "@/lib/server/user-id";
import {
  balanceUpdateInput,
  recurringInput,
  smsBalanceInput,
  smsImportInput,
  type AccountInput,
  type RecurringInput,
  type TransactionInput,
} from "@/lib/validation";
import { categoryId, makeAccount, makeUser, resetData } from "../support/fixtures";

/**
 * Two people use the same server. Whatever one of them asks for — by listing,
 * by guessing an id, or by naming the other's account in their own entry —
 * they only ever see and change their own ledger.
 */

const TODAY = "2026-09-28";
const SMS = "Payment Tk 350.00 to Daraz (01712345678) successful. Balance Tk 4,650.00. TrxID BIU1EF7G8H at 28/09/2026 12:00";

const expense = (accountId: string, category: string, amount: string, date: string, description = ""): TransactionInput => ({
  type: "EXPENSE",
  accountId,
  categoryId: category,
  amount,
  date,
  scope: "PERSONAL",
  description,
  notes: null,
});

const transfer = (accountId: string, toAccountId: string, amount: string, date: string, toAmount: string | null = null): TransactionInput => ({
  type: "TRANSFER",
  accountId,
  toAccountId,
  amount,
  toAmount,
  date,
  countAsExpense: false,
  categoryId: null,
  scope: null,
  description: "",
  notes: null,
});

const accountInput = (name: string): AccountInput => ({
  name,
  type: "CASH",
  currency: "BDT",
  openingBalance: "1",
  openingDate: "2025-01-01",
  icon: null,
  color: null,
  isActive: true,
});

/** Every row a user owns, to prove that nothing of theirs changed. */
async function everythingOf(userId: UserId) {
  const where = { userId };
  const byId = { orderBy: { id: "asc" } } as const;
  return {
    user: await prisma.user.findUnique({ where: { id: userId } }),
    accounts: await prisma.account.findMany({ where, ...byId }),
    categories: await prisma.category.findMany({ where, ...byId }),
    transactions: await prisma.transaction.findMany({ where, ...byId }),
    checkpoints: await prisma.balanceCheckpoint.findMany({ where, ...byId }),
    budgets: await prisma.scopeBudget.findMany({ where, ...byId }),
    rates: await prisma.exchangeRate.findMany({ where, orderBy: { currency: "asc" } }),
    recurring: await prisma.recurringTransaction.findMany({ where, ...byId }),
  };
}

describe("one user's data is invisible and untouchable to another", () => {
  let alice: UserId;
  let bob: UserId;
  /** Alice's ledger. */
  const a = { cash: "", bank: "", usd: "", food: "", salary: "", expense: "", checkpoint: "", rule: "", sms: "" };
  /** Bob's own, smaller one. */
  const b = { cash: "", usd: "", food: "", expense: "" };

  const rent = (accountId: string, category: string): RecurringInput =>
    recurringInput.parse({
      type: "EXPENSE",
      amount: "9000",
      accountId,
      categoryId: category,
      scope: "PERSONAL",
      description: "Rent",
      frequency: "MONTHLY",
      startDate: "2026-10-05",
    });

  const aliceSms = (accountId = a.bank, category = a.food) =>
    smsImportInput.parse({
      items: [
        {
          text: SMS,
          transaction: { type: "EXPENSE", amount: "350.00", date: "2026-09-28", time: "12:00", accountId, categoryId: category, scope: "PERSONAL", description: "Daraz" },
          balance: { accountId, amount: "4650.00" },
          allowDuplicate: true,
        },
      ],
    });

  beforeEach(async () => {
    alice = await resetData();
    bob = await makeUser("Bob");

    a.cash = await makeAccount({ name: "Cash", openingBalance: "20000", openingDate: "2025-01-01" }, alice);
    a.bank = await makeAccount({ name: "Bank", type: "BANK", openingBalance: "5000", openingDate: "2025-01-01" }, alice);
    a.usd = await makeAccount({ name: "Payoneer", type: "EXCHANGE", currency: "USD", openingBalance: "100", openingDate: "2025-01-01" }, alice);
    a.food = await categoryId("EXPENSE", "Food", alice);
    a.salary = await categoryId("INCOME", "Salary", alice);
    a.expense = (await createTransaction(alice, expense(a.cash, a.food, "1500", "2026-09-10", "Groceries"), { today: TODAY })).id;
    await createTransaction(
      alice,
      { type: "INCOME", accountId: a.bank, categoryId: a.salary, amount: "80000", date: "2026-09-01", description: "Pay", notes: null },
      { today: TODAY },
    );
    // Money moved between her accounts, and converted both ways.
    await createTransaction(alice, transfer(a.bank, a.cash, "2000", "2026-09-05"), { today: TODAY });
    await createTransaction(alice, transfer(a.usd, a.bank, "10", "2026-09-06", "1210"), { today: TODAY });
    await createTransaction(alice, transfer(a.bank, a.usd, "2440", "2026-09-07", "20"), { today: TODAY });
    a.checkpoint = (await updateBalance(alice, a.cash, balanceUpdateInput.parse({ balance: "18000", date: "2026-09-20" }), TODAY)).id;
    a.rule = (await createRecurring(alice, rent(a.bank, a.food), { today: TODAY, backfill: false })).id;
    await setBudget(alice, "PERSONAL", "2026-09", "30000");
    await setManualRate(alice, "BDT", "USD", "120");
    const [imported] = await importSms(alice, aliceSms(), TODAY, "12:30:00");
    a.sms = imported.status === "added" ? imported.ids[0] : "";
    expect(a.sms).not.toBe("");

    b.cash = await makeAccount({ name: "Cash", openingBalance: "700", openingDate: "2025-01-01" }, bob);
    b.usd = await makeAccount({ name: "Dollars", currency: "USD", openingBalance: "5", openingDate: "2025-01-01" }, bob);
    b.food = await categoryId("EXPENSE", "Food", bob);
    b.expense = (await createTransaction(bob, expense(b.cash, b.food, "50", "2026-09-12", "Tea"), { today: TODAY })).id;
  });

  it("lists show only what you recorded", async () => {
    expect((await listAccounts(bob, TODAY)).map((x) => x.id)).toEqual([b.cash, b.usd]);
    expect((await listAccounts(alice, TODAY)).map((x) => x.id).sort()).toEqual([a.cash, a.bank, a.usd].sort());
    // Each person's accounts are ordered among their own.
    expect((await prisma.account.findMany({ where: { userId: bob }, orderBy: { sortOrder: "asc" } })).map((x) => x.sortOrder)).toEqual([10, 20]);

    const bobCategories = await listCategories(bob);
    expect(bobCategories.some((c) => c.id === a.food)).toBe(false);
    expect(bobCategories.find((c) => c.id === b.food)?.transactionCount).toBe(1);

    expect((await listTransactions(bob, {}, "BDT")).items.map((t) => t.id)).toEqual([b.expense]);
    expect((await listTransactions(bob, {}, "BDT")).summary).toMatchObject({ income: "0.00", expenses: "50.00" });
    // Naming someone else's account or category in a filter finds nothing.
    expect((await listTransactions(bob, { accountId: a.cash }, "BDT")).total).toBe(0);
    expect((await listTransactions(bob, { categoryId: a.food }, "BDT")).total).toBe(0);
    expect((await listTransactions(bob, { q: "Groceries" }, "BDT")).total).toBe(0);
    expect((await recentTransactions(bob, 10, TODAY)).map((t) => t.id)).toEqual([b.expense]);
    expect((await exportTransactionRows(bob, {})).map((r) => r.description)).toEqual(["Tea"]);
    expect((await exportTransactionRows(bob, { accountId: a.bank })).length).toBe(0);

    expect(await listRecurring(bob)).toEqual([]);
    expect(await listBalanceUpdates(bob, a.cash)).toEqual([]);
    expect((await listBalanceUpdates(alice, a.cash)).length).toBe(1);
  });

  it("totals and reports count only your own entries", async () => {
    const sept = ["2026-09-01", "2026-09-30"] as const;
    expect(await periodSummary(bob, ...sept, "BDT")).toMatchObject({ income: "0.00", expenses: "50.00", transfers: "0.00", adjustments: "0.00" });
    expect(await periodSummary(alice, ...sept, "BDT")).toMatchObject({ income: "80000.00", expenses: "1850.00" });

    expect((await monthlySeries(bob, "2026-09", "2026-09", "BDT"))[0]).toMatchObject({ income: "0.00", expenses: "50.00" });
    expect((await categoryTotals(bob, ...sept, "BDT")).map((c) => [c.categoryId, c.total])).toEqual([[b.food, "50.00"]]);
    expect((await categoryTotals(bob, ...sept, "BDT", "INCOME"))).toEqual([]);
    expect((await scopeTotals(bob, ...sept, "BDT")).find((s) => s.scope === "PERSONAL")?.total).toBe("50.00");
    expect((await dailySpending(bob, ...sept, "BDT")).filter((d) => d.total !== "0.00")).toEqual([{ date: "2026-09-12", total: "50.00" }]);
    expect((await accountActivity(bob, ...sept)).map((x) => x.id)).toEqual([b.cash, b.usd]);
    expect((await yearReport(bob, 2026, "BDT")).summary).toMatchObject({ income: "0.00", expenses: "50.00" });
    expect(await ledgerRange(bob)).toEqual({ first: "2026-09-12", last: "2026-09-12" });

    const report = await buildReport(bob, { kind: "month", month: "2026-09" }, "BDT", TODAY);
    expect(report.summary.expenses).toBe("50.00");
    expect(report.accounts.map((x) => x.id)).toEqual([b.cash, b.usd]);
    expect(report.summary).toMatchObject({ transfers: "0.00", transferCount: 0 });
    expect((await periodSummary(alice, ...sept, "BDT")).transferCount).toBe(2);

    // Budgets and exchange rates are each person's own.
    expect((await budgetsForMonth(bob, "2026-09", "BDT")).lines.every((l) => l.budget === null)).toBe(true);
    expect((await budgetsForMonth(alice, "2026-09", "BDT")).lines.find((l) => l.scope === "PERSONAL")?.budget).toBe("30000.00");
    // Bob holds dollars too, but has set no rate and converted nothing: her rate and conversions aren't his,
    // nor is a currency only she holds.
    await makeAccount({ name: "Euros", currency: "EUR" }, alice);
    expect(await loadCurrencies(bob, "BDT")).toEqual({
      conversion: { base: "BDT", rates: { BDT: "1" } },
      foreign: [{ currency: "USD", rate: null, source: null, manualRate: null, lastConversion: null }],
    });
    const hers = await loadCurrencies(alice, "BDT");
    expect(hers.conversion.rates).toEqual({ BDT: "1", USD: "120" });
    expect(hers.foreign.map((f) => f.currency)).toEqual(["EUR", "USD"]);
    expect(hers.foreign[1].lastConversion).toEqual({ rate: "122", date: "2026-09-07" });
    // With only one direction of conversion on record, it is still hers alone.
    await prisma.transaction.deleteMany({ where: { userId: alice, date: new Date("2026-09-06") } });
    expect((await loadCurrencies(bob, "BDT")).foreign[0].lastConversion).toBeNull();
  });

  it("someone else's ids are simply not found", async () => {
    const missing = { status: 404 };
    await expect(getAccount(bob, a.cash, TODAY)).rejects.toMatchObject(missing);
    await expect(balanceAsOf(bob, a.cash, TODAY)).rejects.toMatchObject(missing);
    await expect(balanceHistory(bob, a.cash, "2026-09-01", TODAY)).rejects.toMatchObject(missing);
    await expect(recordedBalanceAt(bob, a.cash, TODAY, null, { today: TODAY })).rejects.toMatchObject(missing);
    await expect(getTransaction(bob, a.expense)).rejects.toMatchObject(missing);
    await expect(getTransaction(bob, a.sms)).rejects.toMatchObject(missing);
    // …while the owner still reads them.
    expect((await getAccount(alice, a.cash, TODAY)).balance).toBe("18000.00");
    expect((await getTransaction(alice, a.expense)).description).toBe("Groceries");
  });

  it("nothing of someone else's can be changed or deleted", async () => {
    const before = await everythingOf(alice);
    // Refused as "not found": the answer never says the thing exists, is in use, or how much it holds.
    const refused = (promise: Promise<unknown>) =>
      expect(promise).rejects.toSatisfy((error: { status?: number; code?: string }) => error.status === 404 || error.code === "P2025");

    // Accounts and balance updates.
    await refused(updateAccount(bob, a.cash, accountInput("Mine now"), TODAY));
    await refused(updateAccount(bob, a.cash, { ...accountInput("Mine now"), currency: "USD" }, TODAY));
    await refused(setAccountActive(bob, a.cash, false));
    // …whether it has transactions (cash), a recurring rule (bank) or nothing in the way (dollars).
    await refused(deleteAccount(bob, a.cash));
    await refused(deleteAccount(bob, a.bank));
    await refused(deleteAccount(bob, a.usd));
    await refused(updateBalance(bob, a.cash, balanceUpdateInput.parse({ balance: "1", date: TODAY }), TODAY));
    await refused(deleteBalanceUpdate(bob, a.cash, a.checkpoint));
    // The right checkpoint under one of Bob's own accounts is still not his.
    await refused(deleteBalanceUpdate(bob, b.cash, a.checkpoint));

    // Transactions.
    await refused(updateTransaction(bob, a.expense, expense(b.cash, b.food, "1", TODAY), TODAY));
    await refused(deleteTransaction(bob, a.expense));
    await refused(deleteTransaction(bob, a.sms));

    // Categories.
    await refused(updateCategory(bob, a.food, { name: "Hacked", kind: "EXPENSE", defaultScope: "PERSONAL", icon: "user", color: "gray", isArchived: true }));
    await refused(updateCategory(bob, a.food, { name: "Hacked", kind: "INCOME", defaultScope: null, icon: "user", color: "gray", isArchived: false }));
    await refused(deleteCategory(bob, a.salary));
    await refused(deleteCategory(bob, a.food));

    // Recurring rules.
    await refused(updateRecurring(bob, a.rule, rent(b.cash, b.food), TODAY));
    await refused(setRecurringActive(bob, a.rule, false, TODAY));
    await refused(skipNextOccurrence(bob, a.rule));
    await refused(deleteRecurring(bob, a.rule));
    expect(await postDueForRule(bob, a.rule, "2027-01-01")).toBe(0);
    expect(await postAllDue(bob, "2027-01-01")).toBe(0);

    expect(await everythingOf(alice)).toEqual(before);
  });

  it("your own entries can't point at someone else's account or category", async () => {
    const before = await everythingOf(alice);
    const invalid = { status: 400 };

    await expect(createTransaction(bob, expense(a.cash, b.food, "10", TODAY), { today: TODAY })).rejects.toMatchObject(invalid);
    await expect(createTransaction(bob, expense(b.cash, a.food, "10", TODAY), { today: TODAY })).rejects.toMatchObject(invalid);
    await expect(createTransaction(bob, transfer(b.cash, a.cash, "10", TODAY), { today: TODAY })).rejects.toMatchObject(invalid);
    await expect(createTransaction(bob, transfer(a.bank, b.cash, "10", TODAY), { today: TODAY })).rejects.toMatchObject(invalid);
    await expect(updateTransaction(bob, b.expense, expense(a.cash, b.food, "10", TODAY), TODAY)).rejects.toMatchObject(invalid);
    await expect(updateTransaction(bob, b.expense, expense(b.cash, a.food, "10", TODAY), TODAY)).rejects.toMatchObject(invalid);
    await expect(createRecurring(bob, rent(a.bank, b.food), { today: TODAY, backfill: false })).rejects.toMatchObject(invalid);
    await expect(createRecurring(bob, rent(b.cash, a.food), { today: TODAY, backfill: false })).rejects.toMatchObject(invalid);
    await expect(
      updateBalance(bob, b.cash, balanceUpdateInput.parse({ balance: "1", date: TODAY, recordAs: "CATEGORY", categoryId: a.food }), TODAY),
    ).rejects.toMatchObject(invalid);

    // An imported message can't land on someone else's account, be merged into
    // their transaction, or set their balance.
    const [onTheirs] = await importSms(bob, aliceSms(a.bank, b.food), TODAY);
    expect(onTheirs.status).toBe("error");
    const merge = aliceSms(b.cash, b.food);
    merge.items[0].sameAs = a.expense;
    merge.items[0].text = `${SMS} (again)`;
    expect((await importSms(bob, merge, TODAY))[0].status).toBe("error");
    await expect(
      saveSmsBalances(bob, smsBalanceInput.parse({ items: [{ text: "Your balance is Tk 9", balance: { accountId: a.cash, amount: "9" }, reportedAt: { date: TODAY, time: null } }] }).items, { today: TODAY }),
    ).rejects.toMatchObject(invalid);

    // Even past the application, the database refuses the reference.
    await expect(
      prisma.transaction.create({ data: { userId: bob, type: "EXPENSE", amount: "5", date: new Date("2026-09-01"), accountId: a.cash, categoryId: b.food, scope: "PERSONAL" } }),
    ).rejects.toThrow();
    await expect(
      prisma.transaction.create({ data: { userId: bob, type: "EXPENSE", amount: "5", date: new Date("2026-09-01"), accountId: b.cash, categoryId: a.food, scope: "PERSONAL" } }),
    ).rejects.toThrow();
    await expect(
      prisma.balanceCheckpoint.create({ data: { userId: bob, accountId: a.cash, date: new Date("2026-09-01"), balance: "5" } }),
    ).rejects.toThrow();
    await expect(prisma.transaction.update({ where: { id: b.expense }, data: { recurringId: a.rule } })).rejects.toThrow();

    expect(await everythingOf(alice)).toEqual(before);
    expect((await listTransactions(bob, {}, "BDT")).total).toBe(1);
  });

  it("the same names, keys and messages belong to each person separately", async () => {
    // Both already have a "Cash" account and a "Food" category; a new clash is only within your own.
    const pets = { name: "Pets", kind: "EXPENSE", defaultScope: "PERSONAL", icon: "paw-print", color: "gray", isArchived: false } as const;
    await expect(createCategory(bob, { ...pets, name: "Food" })).rejects.toMatchObject({ status: 400 });
    await makeAccount({ name: "Bank" }, bob);
    await createCategory(alice, { ...pets, name: "Garden" });
    await createCategory(alice, pets);
    const bobsPets = await createCategory(bob, pets);
    // …and it takes the next place among his own categories, not hers.
    expect((await prisma.category.findUniqueOrThrow({ where: { id: bobsPets.id } })).sortOrder).toBe(150);
    expect((await prisma.category.findFirstOrThrow({ where: { userId: alice, name: "Pets" } })).sortOrder).toBe(160);

    // The same idempotency key is a different entry for each of them.
    const first = await createTransaction(alice, expense(a.cash, a.food, "5", "2026-09-15"), { today: TODAY, idempotencyKey: "same-key" });
    const second = await createTransaction(bob, expense(b.cash, b.food, "7", "2026-09-15"), { today: TODAY, idempotencyKey: "same-key" });
    expect(second).toMatchObject({ created: true });
    expect(second.id).not.toBe(first.id);
    expect(await createTransaction(bob, expense(b.cash, b.food, "7", "2026-09-15"), { today: TODAY, idempotencyKey: "same-key" })).toEqual({ id: second.id, created: false });

    // Alice imported this message; for Bob it is new, and says nothing about hers.
    const [check] = await checkSms(bob, [{ text: SMS, description: "Daraz" }]);
    expect(check).toEqual({ existing: [], balanceSaved: false, learned: null });
    expect((await checkSms(alice, [{ text: SMS, description: "Daraz" }]))[0]).toMatchObject({ existing: [a.sms], balanceSaved: true });
    const [mine] = await importSms(bob, aliceSms(b.cash, b.food), TODAY, "13:00:00");
    expect(mine).toMatchObject({ status: "added", balanceSaved: true });
    expect(mine.status === "added" && mine.ids[0]).not.toBe(a.sms);
    expect((await getAccount(bob, b.cash, TODAY)).balance).toBe("4650.00");
    // Deleting his copy (and its balance) leaves hers.
    await deleteTransaction(bob, mine.status === "added" ? mine.ids[0] : "");
    expect((await checkSms(alice, [{ text: SMS, description: "" }]))[0]).toMatchObject({ existing: [a.sms], balanceSaved: true });
    expect((await getAccount(alice, a.bank, TODAY)).balance).toBe("4650.00");

    // Budgets and rates for the same month and currency don't overwrite each other.
    await setBudget(bob, "PERSONAL", "2026-09", "100");
    await setManualRate(bob, "BDT", "USD", "99");
    expect((await budgetsForMonth(alice, "2026-09", "BDT")).lines.find((l) => l.scope === "PERSONAL")?.budget).toBe("30000.00");
    expect((await loadCurrencies(alice, "BDT")).conversion.rates.USD).toBe("120");
    // Clearing his leaves hers.
    await setManualRate(bob, "BDT", "USD", null);
    expect((await loadCurrencies(bob, "BDT")).conversion.rates).toEqual({ BDT: "1" });
    expect((await loadCurrencies(alice, "BDT")).conversion.rates.USD).toBe("120");
    // "No budget" with nothing of his own before it leaves no row — her earlier budget doesn't count as his.
    await setBudget(bob, "FAMILY", "2026-10", "0");
    expect(await prisma.scopeBudget.count({ where: { userId: bob, scope: "FAMILY" } })).toBe(0);
    await setBudget(alice, "FAMILY", "2026-08", "500");
    await setBudget(bob, "FAMILY", "2026-10", "0");
    expect(await prisma.scopeBudget.count({ where: { userId: bob, scope: "FAMILY" } })).toBe(0);
  });

  it("recurring rules post for their owner only", async () => {
    await createRecurring(bob, { ...rent(b.cash, b.food), amount: "10", startDate: "2026-10-01" }, { today: TODAY, backfill: false });
    expect(await postAllDue(bob, "2026-10-10")).toBe(1);
    // Alice's rent (due 5 October) waits for her own next visit.
    expect(await prisma.transaction.count({ where: { userId: alice, recurringId: a.rule } })).toBe(0);
    await ensureRecurringPosted(bob, "2026-10-10");
    expect(await prisma.transaction.count({ where: { userId: alice, recurringId: a.rule } })).toBe(0);
    await ensureRecurringPosted(alice, "2026-10-10");
    expect(await prisma.transaction.count({ where: { userId: alice, recurringId: a.rule } })).toBe(1);
    expect(await prisma.transaction.count({ where: { userId: bob, recurringId: { not: null } } })).toBe(1);
  });

  it("deleting a rule keeps what it posted", async () => {
    await postAllDue(alice, "2026-11-10");
    expect(await prisma.transaction.count({ where: { recurringId: a.rule } })).toBe(2);
    await deleteRecurring(alice, a.rule);
    expect(await listRecurring(alice)).toEqual([]);
    expect(await prisma.transaction.count({ where: { userId: alice, description: "Rent", recurringId: null } })).toBe(2);
  });

  it("preferences and signed-in devices are per person", async () => {
    await updateSettings(bob, { displayName: "Bob", baseCurrency: "USD", timezone: "Europe/London", numberFormat: "INTERNATIONAL", autoLockMinutes: 5, incomeCurrency: null, expenseCurrency: null });
    expect(await getSettings(bob)).toMatchObject({ displayName: "Bob", baseCurrency: "USD", timezone: "Europe/London" });
    expect(await getSettings(alice)).toMatchObject({ displayName: "Test user", baseCurrency: "BDT", timezone: "Asia/Dhaka" });

    await createSession(alice, "Alice's phone");
    await createSession(alice, "Alice's laptop");
    await createSession(bob, "Bob's phone");
    const bobSession = (await prisma.session.findFirstOrThrow({ where: { userId: bob } })).id;
    expect((await listSessions(bob, bobSession)).map((s) => s.current)).toEqual([true]);
    expect(await listSessions(alice, bobSession)).toHaveLength(2);
    // "Sign out other sessions" never reaches another person's devices.
    expect(await deleteOtherSessions(bob, bobSession)).toBe(0);
    expect(await prisma.session.count({ where: { userId: alice } })).toBe(2);
  });

  it("deleting an account removes that person's data and nobody else's", async () => {
    const before = await everythingOf(alice);
    await createSession(bob, "Bob's phone");
    await deleteUser(bob);
    expect(await prisma.user.findUnique({ where: { id: bob } })).toBeNull();
    for (const table of ["Account", "Category", "Transaction", "BalanceCheckpoint", "ScopeBudget", "ExchangeRate", "RecurringTransaction", "Session"]) {
      const [{ count }] = await prisma.$queryRawUnsafe<Array<{ count: number }>>(`SELECT COUNT(*)::int AS "count" FROM "${table}" WHERE "userId" = $1`, bob);
      expect(count, table).toBe(0);
    }
    expect(await everythingOf(alice)).toEqual(before);

    // Clearing the data alone keeps the person and their preferences.
    await prisma.$transaction((tx) => deleteUserData(tx, alice));
    const after = await everythingOf(alice);
    expect(after.user).toEqual(before.user);
    expect([after.accounts, after.categories, after.transactions, after.checkpoints, after.budgets, after.rates, after.recurring].flat()).toEqual([]);
  });
});
