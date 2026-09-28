import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/server/db";
import { balanceAsOf, getAccount } from "@/lib/server/services/accounts";
import { accountActivity, periodSummary } from "@/lib/server/services/analytics";
import { deleteBalanceUpdate, listBalanceUpdates, recordedBalanceAt, updateBalance } from "@/lib/server/services/balances";
import { importSms } from "@/lib/server/services/sms";
import { createTransaction, getTransaction, updateTransaction } from "@/lib/server/services/transactions";
import { balanceUpdateInput, smsImportInput, type TransactionInput } from "@/lib/validation";
import { categoryId, makeAccount, resetData } from "../support/fixtures";

const TODAY = "2026-09-28";

function expense(accountId: string, category: string, amount: string, date: string, extra: Partial<TransactionInput> = {}): TransactionInput {
  return { type: "EXPENSE", accountId, categoryId: category, amount, date, scope: "PERSONAL", description: "", notes: null, ...extra } as TransactionInput;
}

const update = (accountId: string, balance: string, date: string, time: string | null = null, extra: Record<string, unknown> = {}) =>
  updateBalance(accountId, balanceUpdateInput.parse({ balance, date, time, ...extra }), TODAY);

const balance = async (id: string, date = TODAY) => balanceAsOf(id, date);

describe("balances with history and balance updates", () => {
  let wallet: string;
  let food: string;

  beforeEach(async () => {
    await resetData();
    food = await categoryId("EXPENSE", "Food");
  });

  it("back-filling transactions from before the opening balance never changes it", async () => {
    // "My bKash has 5,000 today" — then last month's spending is added.
    wallet = await makeAccount({ name: "bKash", type: "MOBILE_WALLET", openingBalance: "5000", openingDate: TODAY });
    await createTransaction(expense(wallet, food, "1000", "2026-08-15"), { today: TODAY });
    await createTransaction(expense(wallet, food, "250.50", "2026-09-01"), { today: TODAY });

    expect(await balance(wallet)).toBe("5000.00");
    // History is derived backwards from the known balance.
    expect(await balance(wallet, "2026-08-31")).toBe("5250.50");
    expect(await balance(wallet, "2026-08-14")).toBe("6250.50");
    // New spending from today on does move it.
    await createTransaction(expense(wallet, food, "100", TODAY), { today: TODAY });
    expect(await balance(wallet)).toBe("4900.00");
  });

  it("a balance update corrects the balance and absorbs anything added before it later", async () => {
    wallet = await makeAccount({ name: "Wallet", openingBalance: "5000", openingDate: "2026-01-01" });
    await createTransaction(expense(wallet, food, "1000", "2026-02-10"), { today: TODAY });
    expect(await balance(wallet)).toBe("4000.00");

    const result = await update(wallet, "5000", TODAY, "10:00");
    expect(result.difference).toBe("1000.00");
    expect(await balance(wallet)).toBe("5000.00");

    // Older spending recorded afterwards: the balance after the update stays put.
    await createTransaction(expense(wallet, food, "2000", "2026-03-05"), { today: TODAY });
    expect(await balance(wallet)).toBe("5000.00");
    // Earlier the same day (09:30, before the 10:00 update) is absorbed too.
    await createTransaction(expense(wallet, food, "200", TODAY, { time: "09:30" }), { today: TODAY });
    expect(await balance(wallet)).toBe("5000.00");
    // After the update (a later time, or no time: the end of the day) it counts.
    await createTransaction(expense(wallet, food, "300", TODAY, { time: "18:00" }), { today: TODAY });
    await createTransaction(expense(wallet, food, "150", TODAY), { today: TODAY });
    expect(await balance(wallet)).toBe("4550.00");

    const [latest] = await listBalanceUpdates(wallet);
    expect(latest).toMatchObject({ balance: "5000.00", time: "10:00", source: "MANUAL", correction: "3200.00", startingPoint: false });
  });

  it("each update only corrects what happened since the previous one", async () => {
    wallet = await makeAccount({ name: "Wallet", openingBalance: "0", openingDate: "2026-01-01" });
    await update(wallet, "1000", "2026-02-01");
    await createTransaction({ type: "INCOME", accountId: wallet, categoryId: await categoryId("INCOME", "Salary"), amount: "500", date: "2026-03-01", description: "", notes: null }, { today: TODAY });
    await update(wallet, "1500", "2026-04-01");
    await createTransaction(expense(wallet, food, "100", "2026-05-01"), { today: TODAY });
    await update(wallet, "1300", "2026-06-01");

    const updates = await listBalanceUpdates(wallet);
    expect(updates.map((u) => [u.date, u.correction])).toEqual([
      ["2026-06-01", "-100.00"],
      ["2026-04-01", "0.00"],
      ["2026-02-01", "1000.00"],
    ]);
    expect(await balance(wallet, "2026-01-31")).toBe("0.00");
    expect(await balance(wallet, "2026-03-15")).toBe("1500.00");
    expect(await balance(wallet, "2026-05-15")).toBe("1400.00");
    expect(await balance(wallet)).toBe("1300.00");

    // Deleting an update hands its correction to the next one.
    await deleteBalanceUpdate(wallet, updates[1].id);
    expect(await balance(wallet)).toBe("1300.00");
    expect((await listBalanceUpdates(wallet))[0].correction).toBe("-100.00");
    // Deleting all of them leaves the plain ledger.
    for (const u of await listBalanceUpdates(wallet)) await deleteBalanceUpdate(wallet, u.id);
    expect(await balance(wallet)).toBe("400.00");
  });

  it("can record the difference as spending that wasn't logged", async () => {
    wallet = await makeAccount({ name: "Cash", openingBalance: "4000", openingDate: "2026-01-01" });
    const result = await update(wallet, "3500", TODAY, "20:00", { recordAs: "CATEGORY", categoryId: food, scope: "FAMILY" });
    expect(result.difference).toBe("-500.00");
    expect(result.recorded?.type).toBe("EXPENSE");
    expect(await getTransaction(result.recorded!.id)).toMatchObject({ amount: "500.00", time: "20:00", scope: "FAMILY", description: "Unrecorded spending" });
    expect(await balance(wallet)).toBe("3500.00");
    expect((await listBalanceUpdates(wallet))[0].correction).toBe("0.00");
    expect((await periodSummary("2026-09-01", "2026-09-30", "BDT")).expenses).toBe("500.00");
  });

  it("refuses a balance for the future", async () => {
    wallet = await makeAccount({ name: "Wallet", openingDate: "2026-01-01" });
    await expect(update(wallet, "10", "2026-09-29")).rejects.toMatchObject({ status: 400 });
  });

  it("keeps opening + in − out + corrections equal to the balance, and reports corrections as adjustments", async () => {
    wallet = await makeAccount({ name: "Wallet", openingBalance: "1000", openingDate: "2026-09-01" });
    await createTransaction(expense(wallet, food, "300", "2026-09-05"), { today: TODAY });
    await createTransaction(expense(wallet, food, "999", "2026-08-20"), { today: TODAY }); // history
    await update(wallet, "900", "2026-09-20", "12:00");

    const account = await getAccount(wallet, TODAY);
    expect(account).toMatchObject({ balance: "900.00", openingBalance: "1000.00", inflow: "0.00", outflow: "300.00", corrections: "200.00", transactionCount: 2 });
    expect(account.lastUpdate).toMatchObject({ date: "2026-09-20", time: "12:00", balance: "900.00", source: "MANUAL" });

    const [activity] = await accountActivity("2026-09-01", "2026-09-30");
    expect(activity).toMatchObject({ openingBalance: "1000.00", inflow: "200.00", outflow: "300.00", closingBalance: "900.00" });
    expect((await periodSummary("2026-09-01", "2026-09-30", "BDT")).adjustments).toBe("200.00");
  });
});

describe("where an entry without a time sits in its day", () => {
  let wallet: string;
  let food: string;

  beforeEach(async () => {
    await resetData();
    food = await categoryId("EXPENSE", "Food");
    wallet = await makeAccount({ name: "bKash", type: "MOBILE_WALLET", openingBalance: "5000", openingDate: "2026-01-01" });
  });

  const at = (time: string) => ({ today: TODAY, time });

  it("an update entered as 'now' sits between what was recorded before and after it, to the second", async () => {
    await createTransaction(expense(wallet, food, "100", TODAY), at("14:05:10"));
    const result = await updateBalance(wallet, balanceUpdateInput.parse({ balance: "4000", date: TODAY }), TODAY, "14:05:30");
    // The expense recorded 20 seconds earlier is part of what the update saw.
    expect(result.difference).toBe("-900.00");

    // Recorded later — even within the same minute — it counts.
    await createTransaction(expense(wallet, food, "250", TODAY), at("14:05:50"));
    expect(await balance(wallet)).toBe("3750.00");
    // Its shown time is when it was entered.
    expect((await listBalanceUpdates(wallet))[0]).toMatchObject({ time: "14:05", correction: "-900.00" });
  });

  it("an SMS balance without a time doesn't swallow what happens later that day", async () => {
    const salary = await categoryId("INCOME", "Salary");
    const input = smsImportInput.parse({
      items: [
        {
          text: "BDT 50,000.00 has been credited to your A/C **4567 on 28-SEP-2026 for Salary. Current balance is BDT 60,000.00.",
          transaction: { type: "INCOME", amount: "50000", date: TODAY, accountId: wallet, categoryId: salary, description: "Salary" },
          balance: { accountId: wallet, amount: "60000.00" },
        },
      ],
    });
    await importSms(input, TODAY, "12:00:00");
    expect(await balance(wallet)).toBe("60000.00");

    // Spent that afternoon: the balance moves.
    await createTransaction(expense(wallet, food, "300", TODAY), at("15:00:00"));
    expect(await balance(wallet)).toBe("59700.00");
    // Spent that morning (a time before the SMS was imported): already in the SMS balance.
    await createTransaction(expense(wallet, food, "80", TODAY, { time: "09:15" }), at("15:01:00"));
    expect(await balance(wallet)).toBe("59700.00");
    // The SMS carried no time, so none is shown.
    expect((await listBalanceUpdates(wallet))[0]).toMatchObject({ source: "SMS", time: null });
  });

  it("entries without a time recorded on a later day count at the end of their day", async () => {
    await updateBalance(wallet, balanceUpdateInput.parse({ balance: "4000", date: "2026-09-20", time: "12:00" }), TODAY, "10:00:00");
    // Back-filled today for the 20th, no time: after the 12:00 update.
    await createTransaction(expense(wallet, food, "100", "2026-09-20"), at("10:01:00"));
    expect(await balance(wallet)).toBe("3900.00");
  });

  it("keeps an entry's place when an edit leaves its date and time alone", async () => {
    const { id } = await createTransaction(expense(wallet, food, "100", TODAY), at("09:00:00"));
    await updateBalance(wallet, balanceUpdateInput.parse({ balance: "4900", date: TODAY }), TODAY, "10:00:00");
    await updateTransaction(id, expense(wallet, food, "120", TODAY), TODAY, "11:00:00");
    // Still before the update, so the correction absorbs the change.
    expect(await balance(wallet)).toBe("4900.00");
    expect(await prisma.transaction.findUniqueOrThrow({ where: { id }, select: { loggedTime: true } })).toEqual({ loggedTime: "09:00:00" });
  });

  it("previews what an update would be compared with", async () => {
    await createTransaction(expense(wallet, food, "100", "2026-09-10"), at("08:00:00"));
    await createTransaction(expense(wallet, food, "50", TODAY, { time: "11:00" }), at("08:00:00"));
    expect(await recordedBalanceAt(wallet, TODAY, "10:30", at("12:00:00"))).toEqual({ balance: "4900.00", startingPoint: false, nextBalance: null });
    expect(await recordedBalanceAt(wallet, TODAY, null, at("12:00:00"))).toEqual({ balance: "4850.00", startingPoint: false, nextBalance: null });

    const result = await updateBalance(wallet, balanceUpdateInput.parse({ balance: "4700", date: TODAY, time: "10:30" }), TODAY, "12:00:00");
    expect(result).toMatchObject({ difference: "-200.00", startingPoint: false });
    expect(await balance(wallet)).toBe("4650.00");

    // Earlier than that update, the balance from then on is already known.
    expect(await recordedBalanceAt(wallet, "2026-09-01", null, at("12:00:00"))).toMatchObject({
      balance: "5000.00",
      nextBalance: { date: TODAY, opening: false },
    });
  });

  it("an update before the opening balance only fills in history", async () => {
    await createTransaction(expense(wallet, food, "100", "2025-12-15"), { today: TODAY });
    expect(await recordedBalanceAt(wallet, "2025-12-01", null, { today: TODAY })).toEqual({
      balance: "5100.00",
      startingPoint: true,
      nextBalance: { date: "2026-01-01", opening: true },
    });

    const result = await updateBalance(wallet, balanceUpdateInput.parse({ balance: "7000", date: "2025-12-01" }), TODAY, "10:00:00");
    expect(result).toMatchObject({ difference: "1900.00", startingPoint: true });
    expect(await balance(wallet, "2025-12-01")).toBe("7000.00");
    expect(await balance(wallet, "2026-01-01")).toBe("5000.00");
    expect(await balance(wallet)).toBe("5000.00");
    // The opening balance now carries the correction; the earlier update is where history starts.
    expect(await listBalanceUpdates(wallet)).toMatchObject([{ date: "2025-12-01", startingPoint: true, correction: "0.00" }]);
  });

  it("refuses a time later today", async () => {
    const later = balanceUpdateInput.parse({ balance: "10", date: TODAY, time: "18:00" });
    await expect(updateBalance(wallet, later, TODAY, "10:00:00")).rejects.toMatchObject({ status: 400, fieldErrors: { time: expect.any(String) } });
    // A device clock a minute or two ahead is fine.
    const nearlyNow = balanceUpdateInput.parse({ balance: "10", date: TODAY, time: "10:03" });
    await expect(updateBalance(wallet, nearlyNow, TODAY, "10:00:00")).resolves.toMatchObject({ difference: "-4990.00" });
  });
});

describe("transactions that don't change the balance", () => {
  let cash: string;
  let bank: string;
  let food: string;

  beforeEach(async () => {
    await resetData();
    food = await categoryId("EXPENSE", "Food");
    cash = await makeAccount({ name: "Cash", openingBalance: "1000", openingDate: "2026-01-01" });
    bank = await makeAccount({ name: "Bank", type: "BANK", openingBalance: "5000", openingDate: "2026-01-01" });
  });

  it("still count as spending but leave balances alone", async () => {
    const { id } = await createTransaction(expense(cash, food, "400", "2026-09-10", { affectsBalance: false }), { today: TODAY });
    expect(await balance(cash)).toBe("1000.00");
    expect((await periodSummary("2026-09-01", "2026-09-30", "BDT")).expenses).toBe("400.00");
    expect((await getTransaction(id)).affectsBalance).toBe(false);

    // Editing without mentioning it keeps it out; switching it on moves the balance.
    await updateTransaction(id, expense(cash, food, "450", "2026-09-10"), TODAY);
    expect(await balance(cash)).toBe("1000.00");
    await updateTransaction(id, expense(cash, food, "450", "2026-09-10", { affectsBalance: true }), TODAY);
    expect(await balance(cash)).toBe("550.00");
  });

  it("moves neither side of a transfer", async () => {
    await createTransaction(
      { type: "TRANSFER", accountId: bank, toAccountId: cash, amount: "2000", toAmount: null, date: "2026-09-10", countAsExpense: false, categoryId: null, scope: null, description: "", notes: null, affectsBalance: false },
      { today: TODAY },
    );
    expect(await balance(bank)).toBe("5000.00");
    expect(await balance(cash)).toBe("1000.00");
    expect((await periodSummary("2026-09-01", "2026-09-30", "BDT")).transfers).toBe("2000.00");
  });

  it("can't be an adjustment (the database refuses)", async () => {
    await expect(
      prisma.transaction.create({ data: { type: "ADJUSTMENT", amount: "5", date: new Date("2026-09-01"), accountId: cash, affectsBalance: false } }),
    ).rejects.toThrow();
  });
});
