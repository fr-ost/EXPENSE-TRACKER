import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/server/db";
import { balanceAsOf, getAccount, listAccounts, updateAccount } from "@/lib/server/services/accounts";
import {
  createTransaction,
  deleteTransaction,
  listTransactions,
  updateTransaction,
} from "@/lib/server/services/transactions";
import type { TransactionInput } from "@/lib/validation";
import { categoryId, makeAccount, resetData } from "../support/fixtures";

const TODAY = "2026-09-28";

async function balance(id: string) {
  return (await getAccount(id, TODAY)).balance;
}

function expense(accountId: string, category: string, amount: string, date: string): TransactionInput {
  return { type: "EXPENSE", accountId, categoryId: category, amount, date, scope: "PERSONAL", description: "", notes: null };
}

describe("ledger balances", () => {
  let cash: string;
  let bank: string;
  let food: string;

  beforeEach(async () => {
    await resetData();
    cash = await makeAccount({ name: "Cash", openingBalance: "20000", openingDate: "2025-01-01" });
    bank = await makeAccount({ name: "Bank", type: "BANK", openingBalance: "100000", openingDate: "2025-01-01" });
    food = await categoryId("EXPENSE", "Food");
  });

  it("derives balance from opening balance plus historical transactions", async () => {
    expect(await balance(cash)).toBe("20000.00");
    await createTransaction(expense(cash, food, "2000", "2025-03-05"), { today: TODAY });
    expect(await balance(cash)).toBe("18000.00");
  });

  it("keeps cents exact across many small amounts", async () => {
    for (let i = 0; i < 10; i++) {
      await createTransaction(expense(cash, food, "0.10", "2026-01-01"), { today: TODAY });
    }
    // 20000 − 10 × 0.10 — a float sum would drift.
    expect(await balance(cash)).toBe("19999.00");
  });

  it("moves money on transfer without recognising an expense", async () => {
    await createTransaction(
      {
        type: "TRANSFER",
        accountId: bank,
        toAccountId: cash,
        amount: "10000",
        toAmount: null,
        date: "2026-09-01",
        countAsExpense: false,
        categoryId: null,
        scope: null,
        description: "ATM",
        notes: null,
      },
      { today: TODAY },
    );
    expect(await balance(bank)).toBe("90000.00");
    expect(await balance(cash)).toBe("30000.00");

    const page = await listTransactions({ month: "2026-09" }, "BDT");
    expect(page.summary.expenses).toBe("0.00");
    expect(page.summary.transfers).toBe("10000.00");
  });

  it("recognises a transfer counted as expense exactly once", async () => {
    const familyWallet = await makeAccount({ name: "Family wallet", openingDate: "2025-01-01" });
    const family = await categoryId("EXPENSE", "Family");
    await createTransaction(
      {
        type: "TRANSFER",
        accountId: bank,
        toAccountId: familyWallet,
        amount: "10000",
        toAmount: null,
        date: "2026-09-10",
        countAsExpense: true,
        categoryId: family,
        scope: "FAMILY",
        description: "Monthly support",
        notes: null,
      },
      { today: TODAY },
    );
    expect(await balance(bank)).toBe("90000.00");
    expect(await balance(familyWallet)).toBe("10000.00");

    // Counted once as spending; not also reported as a plain transfer.
    const page = await listTransactions({ month: "2026-09" }, "BDT");
    expect(page.summary.expenses).toBe("10000.00");
    expect(page.summary.transfers).toBe("0.00");

    // Total money across accounts is unchanged by the transfer itself.
    const accounts = await listAccounts(TODAY);
    const totalMinor = accounts.reduce((sum, a) => sum + Math.round(Number(a.balance) * 100), 0);
    expect(totalMinor).toBe(120000 * 100);
  });

  it("updates balances when a transaction is edited or deleted", async () => {
    const { id } = await createTransaction(expense(cash, food, "2000", "2025-03-05"), { today: TODAY });
    await updateTransaction(id, expense(cash, food, "2500", "2025-03-05"), TODAY);
    expect(await balance(cash)).toBe("17500.00");

    // Moving the expense to another account moves the effect with it.
    await updateTransaction(id, expense(bank, food, "2500", "2025-03-05"), TODAY);
    expect(await balance(cash)).toBe("20000.00");
    expect(await balance(bank)).toBe("97500.00");

    await deleteTransaction(id);
    expect(await balance(bank)).toBe("100000.00");
  });

  it("excludes future-dated transactions from the current balance", async () => {
    await createTransaction(expense(cash, food, "500", "2026-10-15"), { today: TODAY });
    const account = await getAccount(cash, TODAY);
    expect(account.balance).toBe("20000.00");
    expect(account.scheduledNet).toBe("-500.00");
    expect(await balanceAsOf(cash, "2026-10-31")).toBe("19500.00");
  });

  it("rejects a transfer to the same account", async () => {
    await expect(
      createTransaction(
        {
          type: "TRANSFER",
          accountId: cash,
          toAccountId: cash,
          amount: "1",
          toAmount: null,
          date: TODAY,
          countAsExpense: false,
          categoryId: null,
          scope: null,
          description: "",
          notes: null,
        },
        { today: TODAY },
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("accepts dates before the opening date as history that doesn't change the balance", async () => {
    await createTransaction(expense(cash, food, "10", "2024-12-31"), { today: TODAY });
    expect(await balance(cash)).toBe("20000.00");
  });

  it("rejects an income category on an expense", async () => {
    const salary = await categoryId("INCOME", "Salary");
    await expect(createTransaction(expense(cash, salary, "10", TODAY), { today: TODAY })).rejects.toMatchObject({
      status: 400,
    });
  });

  it("does not duplicate on a repeated idempotency key", async () => {
    const key = "test-idempotency-key-1";
    const first = await createTransaction(expense(cash, food, "100", TODAY), { today: TODAY, idempotencyKey: key });
    const second = await createTransaction(expense(cash, food, "100", TODAY), { today: TODAY, idempotencyKey: key });
    expect(second).toEqual({ id: first.id, created: false });
    expect(await prisma.transaction.count()).toBe(1);
    expect(await balance(cash)).toBe("19900.00");
  });

  it("does not duplicate under concurrent submissions with one key", async () => {
    const key = "test-idempotency-key-2";
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        createTransaction(expense(cash, food, "100", TODAY), { today: TODAY, idempotencyKey: key }),
      ),
    );
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(await prisma.transaction.count()).toBe(1);
  });

  it("requires the received amount for a cross-currency transfer", async () => {
    const usd = await makeAccount({ name: "USD wallet", currency: "USD", openingDate: "2025-01-01" });
    const transfer: TransactionInput = {
      type: "TRANSFER",
      accountId: bank,
      toAccountId: usd,
      amount: "12000",
      toAmount: null,
      date: TODAY,
      countAsExpense: false,
      categoryId: null,
      scope: null,
      description: "",
      notes: null,
    };
    await expect(createTransaction(transfer, { today: TODAY })).rejects.toMatchObject({
      fieldErrors: { toAmount: expect.any(String) },
    });
    await createTransaction({ ...transfer, toAmount: "100" }, { today: TODAY });
    expect(await balance(bank)).toBe("88000.00");
    expect(await balance(usd)).toBe("100.00");
  });

  it("protects account history when editing the account", async () => {
    await createTransaction(expense(cash, food, "10", "2025-02-01"), { today: TODAY });
    const base = {
      name: "Cash",
      type: "CASH" as const,
      currency: "BDT",
      openingBalance: "20000",
      icon: null,
      color: null,
      isActive: true,
    };
    // Moving the opening balance after a transaction turns it into history.
    await updateAccount(cash, { ...base, openingDate: "2025-06-01" });
    expect(await balance(cash)).toBe("20000.00");
    await expect(updateAccount(cash, { ...base, openingDate: "2025-01-01", currency: "USD" })).rejects.toMatchObject({
      fieldErrors: { currency: expect.any(String) },
    });
    // Changing the opening balance re-derives the current balance.
    await updateAccount(cash, { ...base, openingDate: "2025-01-01", openingBalance: "25000" });
    expect(await balance(cash)).toBe("24990.00");
  });

  it("enforces invariants in the database itself", async () => {
    await expect(
      prisma.transaction.create({
        data: { type: "TRANSFER", amount: "5", date: new Date("2026-01-01"), accountId: cash, toAccountId: cash },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.transaction.create({
        data: { type: "EXPENSE", amount: "-5", date: new Date("2026-01-01"), accountId: cash, categoryId: food, scope: "PERSONAL" },
      }),
    ).rejects.toThrow();
  });
});
