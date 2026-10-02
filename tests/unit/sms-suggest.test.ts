import { describe, expect, it } from "vitest";
import { buildItem, itemPayload, missingAccount, rematch, reportedBalance, suggestAccount } from "@/components/sms/sms-model";
import { ownEffect, suggestFromSms, type SuggestContext } from "@/components/sms/sms-suggest";
import type { AccountType } from "@/lib/domain";
import { fromMinor, toMinor } from "@/lib/money";
import { parseSms } from "@/lib/sms/parse";
import type { AccountSummary, CategoryRef } from "@/lib/types";

const today = "2026-09-28";

function account(id: string, name: string, type: AccountType, balance = "0.00", currency = "BDT"): AccountSummary {
  return {
    id,
    name,
    type,
    currency,
    icon: null,
    color: null,
    isActive: true,
    openingBalance: "0.00",
    openingDate: "2025-01-01",
    sortOrder: 0,
    balance,
    inflow: "0.00",
    outflow: "0.00",
    transactionCount: 0,
    lastActivity: null,
    scheduledNet: "0.00",
    corrections: "0.00",
    lastUpdate: null,
  };
}

const category = (id: string, name: string, kind: "EXPENSE" | "INCOME", defaultScope: CategoryRef["defaultScope"] = null): CategoryRef => ({
  id,
  name,
  kind,
  icon: "circle-dashed",
  color: "gray",
  defaultScope,
  isArchived: false,
});

const categories = [
  category("c-family", "Family", "EXPENSE", "FAMILY"),
  category("c-shopping", "Shopping", "EXPENSE", "PERSONAL"),
  category("c-bills", "Bills", "EXPENSE", "PERSONAL"),
  category("c-other", "Other", "EXPENSE", "PERSONAL"),
  category("c-salary", "Salary", "INCOME"),
  category("c-other-in", "Other", "INCOME"),
];

const cash = account("a-cash", "Cash", "CASH", "1000.00");
const bkash = account("a-bkash", "bKash", "MOBILE_WALLET", "2537.00");
const city = account("a-city", "City Bank ••4567", "BANK", "50000.00");

function suggest(text: string, overrides: Partial<SuggestContext> = {}) {
  const parsed = parseSms(text, { today });
  return { parsed, ...suggestFromSms(parsed, { accounts: [cash, bkash, city], categories, today, remembered: {}, ...overrides }) };
}

const CASH_OUT = "Cash Out Tk 2,000.00 to 01912345678 successful. Fee Tk 37.00. Balance Tk 500.00. TrxID BIT9CD5E6F at 28/09/2026 10:05";

describe("SMS suggestions", () => {
  it("a wallet cash out moves money to Cash, with the fee as a separate expense", () => {
    const { draft, fee, ready, issues, parsed } = suggest(CASH_OUT);
    expect(issues).toEqual([]);
    expect(ready).toBe(true);
    expect(draft).toMatchObject({ type: "TRANSFER", accountId: "a-bkash", toAccountId: "a-cash", amount: "2000", date: "2026-09-28", time: "10:05", notes: CASH_OUT });
    expect(fee).toMatchObject({ type: "EXPENSE", accountId: "a-bkash", amount: "37", expenseCategoryId: "c-other", description: "Cash out fee" });
    // bKash 2,537 − 2,000 − 37 = 500, as the SMS says.
    const effect = ownEffect(parsed, draft, fee);
    expect(effect?.accountId).toBe("a-bkash");
    expect(fromMinor(toMinor(bkash.balance) + effect!.delta)).toBe(parsed.balance);
  });

  it("a merchant payment is an expense in a matching category", () => {
    const { draft, ready } = suggest("Payment Tk 350.00 to Daraz (01712345678) successful. Balance Tk 150.00. TrxID BIU1EF7G8H at 28/09/2026 12:00");
    expect(ready).toBe(true);
    expect(draft).toMatchObject({ type: "EXPENSE", accountId: "a-bkash", expenseCategoryId: "c-shopping", scope: "PERSONAL", description: "Daraz" });
  });

  it("matches a bank account by the digits in its name", () => {
    const { draft, ready } = suggest("Dear Customer, BDT 50,000.00 has been credited to your A/C **4567 on 28-SEP-2026 for Salary. Current balance is BDT 1,00,000.00.");
    expect(ready).toBe(true);
    expect(draft).toMatchObject({ type: "INCOME", accountId: "a-city", incomeCategoryId: "c-salary" });
  });

  it("money added to bKash from your bank is a transfer between your accounts", () => {
    const { draft } = suggest("You have received deposit from iBanking of Tk 10,000.00 from City Bank. Fee Tk 0.00. Balance Tk 12,537.00. TrxID BIW3JK1L2M at 28/09/2026 11:11");
    expect(draft).toMatchObject({ type: "TRANSFER", accountId: "a-city", toAccountId: "a-bkash" });
  });

  it("a bank alert for money sent to your own bKash is a transfer too", () => {
    const { draft } = suggest("Tk 2,500.00 has been transferred from your A/C **4567 to bKash A/C 01712345678 on 28-09-2026 12:10. Avl Bal BDT 47,500.00. City Bank");
    expect(draft).toMatchObject({ type: "TRANSFER", accountId: "a-city", toAccountId: "a-bkash" });
  });

  it("doesn't guess an account for a wallet you don't track", () => {
    const { draft, ready, issues } = suggest("Money Received.\nAmount: Tk 500.00\nSender: 01712345678\nTxnID: 71A2B3C4\nBalance: Tk 1,234.56\n28/09/2026 14:30");
    expect(draft.accountId).toBe("");
    expect(ready).toBe(false);
    expect(issues).toContain("Choose the account for Nagad.");
  });

  it("remembers the account you chose for a wallet", () => {
    const { draft, ready } = suggest("Money Received.\nAmount: Tk 500.00\nSender: 01712345678\nTxnID: 71A2B3C4\nBalance: Tk 1,234.56\n28/09/2026 14:30", {
      remembered: { "nagad:": "a-bkash" },
    });
    expect(draft.accountId).toBe("a-bkash");
    expect(ready).toBe(true);
  });

  it("asks for a Cash account when a withdrawal has nowhere to go", () => {
    const { draft, ready, issues } = suggest(CASH_OUT, { accounts: [bkash, city] });
    expect(draft).toMatchObject({ type: "TRANSFER", accountId: "a-bkash", toAccountId: "" });
    expect(ready).toBe(false);
    expect(issues[0]).toMatch(/Cash account/);
  });

  it("repeats how the same description was recorded before", () => {
    const text = "Send Money Tk 1,000.00 to 01812345678 successful. Fee Tk 5.00. Balance Tk 1,532.00. TrxID BIS8AB3C4D at 28/09/2026 09:15";
    const { draft } = suggest(text, {
      learned: { type: "EXPENSE", accountId: "a-bkash", toAccountId: null, categoryId: "c-family", scope: "FAMILY", countAsExpense: false },
    });
    expect(draft).toMatchObject({ type: "EXPENSE", expenseCategoryId: "c-family", scope: "FAMILY" });

    const counted = suggest(text, {
      learned: { type: "TRANSFER", accountId: "a-bkash", toAccountId: "a-cash", categoryId: "c-family", scope: "FAMILY", countAsExpense: true },
    });
    expect(counted.draft).toMatchObject({ type: "TRANSFER", accountId: "a-bkash", toAccountId: "a-cash", countAsExpense: true, expenseCategoryId: "c-family" });

    // A past choice in the other direction is ignored.
    const ignored = suggest(text, {
      learned: { type: "INCOME", accountId: "a-bkash", toAccountId: null, categoryId: "c-salary", scope: null, countAsExpense: false },
    });
    expect(ignored.draft.type).toBe("EXPENSE");
  });

  it("sends the balance in the message along with it, unless switched off", () => {
    const item = buildItem(CASH_OUT, { accounts: [cash, bkash, city], categories, today, remembered: {} });
    expect(reportedBalance(item, [cash, bkash, city], today)).toEqual({ account: bkash, amount: "500.00" });
    expect(item.includeBalance).toBe(true);
    const payload = itemPayload(item, [cash, bkash, city], today);
    expect(payload.ok && payload.balance).toEqual({ accountId: "a-bkash", amount: "500.00" });

    const off = itemPayload({ ...item, includeBalance: false }, [cash, bkash, city], today);
    expect(off.ok && off.balance).toBeNull();
  });

  it("offers to create the account a message needs, with the balance before it", () => {
    const nagad = "Money Received.\nAmount: Tk 500.00\nSender: 01712345678\nTxnID: 71A2B3C4\nBalance: Tk 1,234.56\n28/09/2026 14:30";
    const item = buildItem(nagad, { accounts: [cash, bkash, city], categories, today, remembered: {} });
    expect(missingAccount(item)).toBe("own");
    // 1,234.56 after receiving 500 → 734.56 before.
    expect(suggestAccount(item, "BDT")).toEqual({ name: "Nagad", type: "MOBILE_WALLET", openingBalance: "734.56", openingDate: "2026-09-28" });

    // Once it exists, the message matches it and can set its balance.
    const created = account("a-nagad", "Nagad", "MOBILE_WALLET", "734.56");
    const again = rematch(item, { accounts: [cash, bkash, city, created], categories, today, remembered: {} });
    expect(again).toMatchObject({ id: item.id, status: "ready", draft: { accountId: "a-nagad" } });
    expect(missingAccount(again)).toBeNull();
    expect(reportedBalance(again, [cash, bkash, city, created], today)).toMatchObject({ amount: "1234.56" });

    // A bank named with its digits; a withdrawal with no Cash account gets one.
    const bank = buildItem("Your A/C ***9876 at BRAC Bank is debited with BDT 3,000.00 on 28-09-2026 10:22 for bills. Available Balance: BDT 12,000.00", {
      accounts: [bkash],
      categories,
      today,
      remembered: {},
    });
    expect(suggestAccount(bank, "BDT")).toMatchObject({ name: "BRAC Bank 9876", type: "BANK", openingBalance: "15000.00" });
    const withdrawal = buildItem(CASH_OUT, { accounts: [bkash, city], categories, today, remembered: {} });
    expect(suggestAccount(withdrawal, "BDT")).toMatchObject({ name: "Cash", type: "CASH" });
  });

  it("never takes a card's limit, a card SMS or another currency as a balance", () => {
    const card = account("a-card", "EBL Card ••1234", "CARD", "-5000.00");
    const context = { accounts: [cash, bkash, city, card], categories, today, remembered: {} };
    const limit = buildItem("Your EBL Card ****1234 has been used for BDT 1,250.00 at DARAZ BD on 28-Sep-2026 14:22. Avl limit BDT 98,750.00", context);
    expect(limit.parsed.balance).toBeNull();
    expect(reportedBalance(limit, context.accounts, today)).toBeNull();

    const cardBalance = buildItem("Your EBL Card ****1234 has been used for BDT 1,250.00 at DARAZ BD on 28-Sep-2026 14:22. Balance BDT 6,250.00", context);
    expect(cardBalance.draft.accountId).toBe("a-card");
    expect(reportedBalance(cardBalance, context.accounts, today)).toBeNull();

    const usd = buildItem("Dear Customer, your A/C **4567 has been debited by BDT 1,300.00 on 28-09-2026. Avl Bal USD 12.00", context);
    expect(usd.parsed.balanceCurrency).toBe("USD");
    expect(reportedBalance(usd, context.accounts, today)).toBeNull();
  });

  it("flags a foreign-currency amount and an unknown date", () => {
    const usd = suggest("Your City Bank Card ****4567 has been charged USD 12.99 at NETFLIX.COM on 28/09/26 20:15.");
    expect(usd.ready).toBe(false);
    expect(usd.issues.join(" ")).toMatch(/in USD/);

    const undated = suggest("Tk 500/- has been debited from your A/C **4567 for POS purchase.");
    expect(undated.draft.date).toBe(today);
    expect(undated.issues).toContain("No date in the message — using today.");
    expect(undated.ready).toBe(false);
  });
});

describe("balance-only messages", () => {
  it("are kept for their balance, not added", async () => {
    const { buildItem, isBalanceOnly, needsBalanceSaved } = await import("@/components/sms/sms-model");
    const bkash = account("a-bkash", "bKash", "MOBILE_WALLET", "5000.00");
    const item = buildItem("Your bKash account balance is Tk 8,000.00.", { accounts: [bkash], categories, today, remembered: {} });
    expect(item.status).toBe("ignored");
    expect(isBalanceOnly(item)).toBe(true);
    expect(needsBalanceSaved(item, [bkash], today)).toBe(true);
    expect(needsBalanceSaved({ ...item, balanceSaved: true }, [bkash], today)).toBe(false);
    const otp = buildItem("Your bKash verification code is 123456.", { accounts: [bkash], categories, today, remembered: {} });
    expect(isBalanceOnly(otp)).toBe(false);
  });
});
