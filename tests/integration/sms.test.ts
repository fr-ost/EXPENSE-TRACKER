import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/server/db";
import { getAccount } from "@/lib/server/services/accounts";
import { checkSms, importSms, smsFingerprint } from "@/lib/server/services/sms";
import { createTransaction, getTransaction, updateTransaction } from "@/lib/server/services/transactions";
import { smsImportInput, type TransactionInput } from "@/lib/validation";
import { categoryId, makeAccount, resetData } from "../support/fixtures";

const TODAY = "2026-09-28";
const CASH_OUT = "Cash Out Tk 2,000.00 to 01912345678 successful. Fee Tk 37.00. Balance Tk 500.00. TrxID BIT9CD5E6F at 28/09/2026 10:05";
const PAYMENT = "Payment Tk 350.00 to Daraz (01712345678) successful. Balance Tk 150.00. TrxID BIU1EF7G8H at 28/09/2026 12:00";

describe("SMS import", () => {
  let cash: string;
  let bkash: string;
  let fees: string;
  let shopping: string;

  beforeEach(async () => {
    await resetData();
    cash = await makeAccount({ name: "Cash", openingBalance: "1000", openingDate: "2025-01-01" });
    bkash = await makeAccount({ name: "bKash", type: "MOBILE_WALLET", openingBalance: "2537", openingDate: "2025-01-01" });
    fees = await categoryId("EXPENSE", "Other");
    shopping = await categoryId("EXPENSE", "Shopping");
  });

  const cashOut = (overrides: Partial<{ allowDuplicate: boolean }> = {}) =>
    smsImportInput.parse({
      items: [
        {
          text: CASH_OUT,
          transaction: { type: "TRANSFER", amount: "2000.00", date: "2026-09-28", time: "10:05", accountId: bkash, toAccountId: cash, description: "Cash out", notes: CASH_OUT },
          fee: { type: "EXPENSE", amount: "37.00", date: "2026-09-28", time: "10:05", accountId: bkash, categoryId: fees, scope: "OTHER", description: "Cash out fee" },
          ...overrides,
        },
      ],
    });

  it("adds a transfer and its fee together, matching the balance in the SMS", async () => {
    const [result] = await importSms(cashOut(), TODAY);
    expect(result.status).toBe("added");
    expect(result.status === "added" && result.ids).toHaveLength(2);
    // bKash 2,537 − 2,000 − 37 = 500, exactly what the SMS reports.
    expect((await getAccount(bkash, TODAY)).balance).toBe("500.00");
    expect((await getAccount(cash, TODAY)).balance).toBe("3000.00");

    const main = await getTransaction(result.status === "added" ? result.ids[0] : "");
    expect(main).toMatchObject({ type: "TRANSFER", time: "10:05", fromSms: true, notes: CASH_OUT });
  });

  it("never adds the same message twice, even with different spacing", async () => {
    const [first] = await importSms(cashOut(), TODAY);
    const respaced = cashOut();
    respaced.items[0].text = `  ${CASH_OUT.replace(/ /g, "  ")}\n`;
    const [second] = await importSms(respaced, TODAY);
    expect(second).toEqual({ status: "exists", ids: first.status === "added" ? first.ids : [] });
    expect(await prisma.transaction.count()).toBe(2);
    expect(smsFingerprint(CASH_OUT)).toBe(smsFingerprint(CASH_OUT.toUpperCase()));
  });

  it("is safe when the same message is imported concurrently", async () => {
    const results = await Promise.all([importSms(cashOut(), TODAY), importSms(cashOut(), TODAY), importSms(cashOut(), TODAY)]);
    expect(results.flat().filter((r) => r.status === "added")).toHaveLength(1);
    expect(await prisma.transaction.count()).toBe(2);
  });

  it("flags a transaction that is probably already recorded, unless told to add anyway", async () => {
    const typedByHand: TransactionInput = { type: "EXPENSE", amount: "350", date: "2026-09-27", accountId: bkash, categoryId: shopping, scope: "PERSONAL", description: "Daraz order", notes: null };
    await createTransaction(typedByHand, { today: TODAY });

    const input = smsImportInput.parse({
      items: [{ text: PAYMENT, transaction: { ...typedByHand, date: "2026-09-28", time: "12:00", description: "Daraz" } }],
    });
    const [flagged] = await importSms(input, TODAY);
    expect(flagged).toMatchObject({ status: "possible_duplicate", similar: { description: "Daraz order", amount: "350.00", account: "bKash", date: "2026-09-27" } });
    expect(await prisma.transaction.count()).toBe(1);

    input.items[0].allowDuplicate = true;
    const [added] = await importSms(input, TODAY);
    expect(added.status).toBe("added");
  });

  it("recognises a transfer already imported from the other account's SMS", async () => {
    const bank = await makeAccount({ name: "City Bank", type: "BANK", openingBalance: "50000", openingDate: "2025-01-01" });
    const transfer = { type: "TRANSFER", amount: "2500", date: "2026-09-28", accountId: bank, toAccountId: bkash, description: "Add money" } as const;
    const bankSide = smsImportInput.parse({ items: [{ text: "Tk 2,500.00 transferred from your A/C **4567 to bKash", transaction: transfer }] });
    expect((await importSms(bankSide, TODAY))[0].status).toBe("added");

    const walletSide = smsImportInput.parse({
      items: [{ text: "You have received deposit from iBanking of Tk 2,500.00 from City Bank. TrxID X1 at 28/09/2026 12:11", transaction: transfer }],
    });
    expect((await importSms(walletSide, TODAY))[0].status).toBe("possible_duplicate");
  });

  it("reports entry-rule errors per message without blocking the others", async () => {
    const input = smsImportInput.parse({
      items: [
        { text: "old one", transaction: { type: "EXPENSE", amount: "10", date: "2020-01-01", accountId: bkash, categoryId: shopping, scope: "PERSONAL" } },
        { text: PAYMENT, transaction: { type: "EXPENSE", amount: "350", date: "2026-09-28", accountId: bkash, categoryId: shopping, scope: "PERSONAL" } },
      ],
    });
    const [bad, good] = await importSms(input, TODAY);
    expect(bad.status).toBe("error");
    expect(bad.status === "error" && bad.fieldErrors?.date).toMatch(/starts on/);
    expect(good.status).toBe("added");
  });

  it("reports what was already added and how similar messages were recorded before", async () => {
    await importSms(cashOut(), TODAY);
    const earlier = await createTransaction(
      { type: "EXPENSE", amount: "120", date: "2026-09-20", accountId: bkash, categoryId: shopping, scope: "FAMILY", description: "Sent to 01812345678", notes: null },
      { today: TODAY },
    );
    await updateTransaction(earlier.id, { type: "EXPENSE", amount: "120", date: "2026-09-20", accountId: bkash, categoryId: shopping, scope: "FAMILY", description: "Sent to 01812345678", notes: null }, TODAY);

    const [known, fresh] = await checkSms([
      { text: CASH_OUT, description: "Cash out" },
      { text: "Send Money Tk 500.00 to 01812345678 successful.", description: "sent to 01812345678" },
    ]);
    expect(known.existing).toHaveLength(2);
    expect(fresh.existing).toEqual([]);
    expect(fresh.learned).toMatchObject({ type: "EXPENSE", categoryId: shopping, scope: "FAMILY", accountId: bkash });
  });

  it("keeps a transaction's time when an edit doesn't mention it", async () => {
    const [result] = await importSms(cashOut(), TODAY);
    const id = result.status === "added" ? result.ids[1] : "";
    await updateTransaction(id, { type: "EXPENSE", amount: "40", date: "2026-09-28", accountId: bkash, categoryId: fees, scope: "OTHER", description: "Fee", notes: null }, TODAY);
    expect((await getTransaction(id)).time).toBe("10:05");
    await updateTransaction(id, { type: "EXPENSE", amount: "40", date: "2026-09-28", time: null, accountId: bkash, categoryId: fees, scope: "OTHER", description: "Fee", notes: null }, TODAY);
    expect((await getTransaction(id)).time).toBeNull();
  });
});
