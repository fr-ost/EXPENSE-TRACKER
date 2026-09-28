import { describe, expect, it } from "vitest";
import { parseSms, splitMessages } from "@/lib/sms/parse";

const today = "2026-09-28";
const parse = (text: string) => parseSms(text, { today });

describe("mobile wallets", () => {
  it("bKash: money received (no name in the message)", () => {
    const sms = parse(
      "You have received Tk 500.00 from 01712345678. Ref 12. Fee Tk 0.00. Balance Tk 1,010.14. TrxID BIR7ZX2T1B at 27/09/2026 20:03",
    );
    expect(sms).toMatchObject({
      direction: "credit",
      channel: "received",
      amount: "500.00",
      currency: "BDT",
      fee: null,
      balance: "1010.14",
      date: "2026-09-27",
      time: "20:03",
      counterparty: "01712345678",
      reference: "BIR7ZX2T1B",
      description: "Received from 01712345678",
      ignored: null,
      confidence: "high",
    });
    expect(sms.provider?.id).toBe("bkash");
  });

  it("bKash: send money with a fee", () => {
    const sms = parse(
      "Send Money Tk 1,000.00 to 01812345678 successful. Ref Rent. Fee Tk 5.00. Balance Tk 2,345.60. TrxID BIS8AB3C4D at 28/09/2026 09:15",
    );
    expect(sms).toMatchObject({
      direction: "debit",
      channel: "send_money",
      amount: "1000.00",
      fee: "5.00",
      balance: "2345.60",
      counterparty: "01812345678",
      description: "Sent to 01812345678",
      date: "2026-09-28",
      time: "09:15",
      confidence: "high",
    });
    expect(sms.categoryHints[0]).toBe("Housing");
  });

  it("bKash: cash out", () => {
    const sms = parse("Cash Out Tk 2,000.00 to 01912345678 successful. Fee Tk 37.00. Balance Tk 500.00. TrxID BIT9CD5E6F at 28/09/2026 10:05");
    expect(sms).toMatchObject({ direction: "debit", channel: "cash_out", amount: "2000.00", fee: "37.00", balance: "500.00", description: "Cash out" });
  });

  it("bKash: merchant payment", () => {
    const sms = parse("Payment Tk 350.00 to Daraz Bangladesh Ltd (01712345678) successful. Balance Tk 1,000.00. TrxID BIU1EF7G8H at 28/09/2026 12:00");
    expect(sms).toMatchObject({ direction: "debit", channel: "payment", amount: "350.00", counterparty: "Daraz Bangladesh Ltd", description: "Daraz Bangladesh Ltd" });
    expect(sms.categoryHints).toContain("Shopping");
  });

  it("bKash: cash in and add money from a bank", () => {
    expect(parse("Cash In Tk 5,000.00 from 01712345678 successful. Fee Tk 0.00. Balance Tk 6,000.00. TrxID BIV2GH9J0K at 27/09/2026 18:45")).toMatchObject({
      direction: "credit",
      channel: "cash_in",
      amount: "5000.00",
    });
    const added = parse(
      "You have received deposit from iBanking of Tk 10,000.00 from City Bank. Fee Tk 0.00. Balance Tk 12,000.00. TrxID BIW3JK1L2M at 26/09/2026 11:11",
    );
    expect(added).toMatchObject({ direction: "credit", channel: "add_money", amount: "10000.00", description: "Add money from City Bank" });
    expect(added.provider?.id).toBe("bkash");
    expect(added.otherProvider?.id).toBe("city");
  });

  it("Nagad: multi-line alert with labelled fields", () => {
    const sms = parse("Money Received.\nAmount: Tk 500.00\nSender: 01712345678\nRef: N/A\nTxnID: 71A2B3C4\nBalance: Tk 1,234.56\n28/09/2026 14:30");
    expect(sms).toMatchObject({
      direction: "credit",
      amount: "500.00",
      balance: "1234.56",
      counterparty: "01712345678",
      reference: "71A2B3C4",
      date: "2026-09-28",
      time: "14:30",
    });
    expect(sms.provider?.id).toBe("nagad");

    const cashOut = parse("Cash Out Successful.\nAmount: Tk 2,000.00\nFee: Tk 23.00\nTxnID: 72B3C4D5\nBalance: Tk 1,211.56\n28/09/2026 15:10");
    expect(cashOut).toMatchObject({ direction: "debit", channel: "cash_out", amount: "2000.00", fee: "23.00", ignored: null });
  });

  it("Rocket: amount glued to Tk, 12-hour time, sender's wallet after A/C", () => {
    const sms = parse(
      "Tk500.00 received from A/C:01712345678-9. Fee:Tk0, Your A/C Balance: Tk1,234.56 TxnId:1234567890 Date:28-SEP-26 02:30:45 pm.",
    );
    expect(sms).toMatchObject({
      direction: "credit",
      amount: "500.00",
      fee: null,
      balance: "1234.56",
      date: "2026-09-28",
      time: "14:30",
      counterparty: "01712345678",
      accountDigits: null,
    });
    expect(sms.provider?.id).toBe("rocket");
  });
});

describe("banks and cards", () => {
  it("DBBL: account debit with masked account number", () => {
    const sms = parse("Dear Customer, your A/C 123.***.4567 has been debited by BDT 2,500.00 on 28-09-2026 13:05. Avl Bal BDT 45,000.00. Thank you. DBBL");
    expect(sms).toMatchObject({ direction: "debit", amount: "2500.00", balance: "45000.00", accountDigits: "4567", date: "2026-09-28", time: "13:05", confidence: "high" });
    expect(sms.provider?.id).toBe("dbbl");
  });

  it("card purchase at a merchant", () => {
    const sms = parse("Your Card ending 1234 has been used for BDT 1,250.00 at DARAZ BD on 28-Sep-2026 14:22:10. Available limit BDT 98,750.00");
    expect(sms).toMatchObject({
      direction: "debit",
      channel: "payment",
      amount: "1250.00",
      // An available limit is not what the card holds: it never becomes a balance.
      balance: null,
      limit: "98750.00",
      counterparty: "Daraz BD",
      accountDigits: "1234",
      isCard: true,
      date: "2026-09-28",
      time: "14:22",
      confidence: "high",
    });
  });

  it("ATM withdrawal", () => {
    const sms = parse("Your A/C ***4567 is debited with BDT 3,000.00 on 28-09-2026 at 10:22:15 (ATM Withdrawal). Available Balance: BDT 12,345.67. BRAC Bank");
    expect(sms).toMatchObject({ direction: "debit", channel: "atm", amount: "3000.00", balance: "12345.67", accountDigits: "4567", counterparty: null, description: "ATM withdrawal" });
    expect(sms.provider?.id).toBe("brac");
  });

  it("salary credit with lakh grouping", () => {
    const sms = parse("Dear Valued Customer, BDT 50,000.00 has been credited to your A/C **5678 on 28-SEP-2026 for Salary. Current balance is BDT 1,20,000.00. City Bank");
    expect(sms).toMatchObject({ direction: "credit", channel: "salary", amount: "50000.00", balance: "120000.00", accountDigits: "5678" });
    expect(sms.categoryHints[0]).toBe("Salary");
    expect(sms.provider?.id).toBe("city");
  });

  it("foreign-currency card charge", () => {
    const sms = parse("Dear Customer, Your EBL Card ****1234 has been charged USD 12.99 at NETFLIX.COM on 28/09/26 20:15. Avl limit BDT 1,50,000.00");
    expect(sms).toMatchObject({ direction: "debit", amount: "12.99", currency: "USD", counterparty: "netflix.com", accountDigits: "1234", date: "2026-09-28", time: "20:15" });
    expect(sms).toMatchObject({ balance: null, limit: "150000.00" });
    expect(sms.categoryHints[0]).toBe("Subscriptions");
    expect(sms.provider?.id).toBe("ebl");
  });

  it("Islami Bank: debit with the account number's last digits", () => {
    const sms = parse("Your A/C No. XXX12345 Debited BDT 5,000.00 on 28-SEP-2026 ATM Cash Withdrawal. Balance BDT 20,000.00 -IBBL");
    expect(sms).toMatchObject({ direction: "debit", channel: "atm", amount: "5000.00", balance: "20000.00", accountDigits: "2345" });
    expect(sms.provider?.id).toBe("ibbl");
  });

  it("refund to a card", () => {
    const sms = parse("Refund of BDT 850.00 from FOODPANDA has been credited to your card ending 1234 on 27-09-2026.");
    expect(sms).toMatchObject({ direction: "credit", channel: "refund", amount: "850.00", counterparty: "Foodpanda", description: "Refund from Foodpanda", date: "2026-09-27" });
  });

  it("Dr/Cr style statement line with a POS merchant", () => {
    const sms = parse("A/C *4567 Dr BDT 1,200.00 on 28/09/2026 POS SHWAPNO GULSHAN. Bal BDT 9,800.00 Cr");
    expect(sms).toMatchObject({ direction: "debit", amount: "1200.00", balance: "9800.00", counterparty: "Shwapno Gulshan", accountDigits: "4567" });
    expect(sms.categoryHints).toContain("Groceries");
  });

  it("withdrawal via ATM with a 3-digit account suffix and 2-digit year", () => {
    const sms = parse("Dear Sir, BDT 1,000.00 withdrawn from your A/C 0123***789 via ATM on 28-09-26 11:45. Bal: BDT 10,000.00");
    expect(sms).toMatchObject({ direction: "debit", channel: "atm", amount: "1000.00", accountDigits: "789", date: "2026-09-28", time: "11:45" });
  });

  it("Bengali alert with Bengali digits", () => {
    const sms = parse("আপনার অ্যাকাউন্ট থেকে ৫০০ টাকা উত্তোলন করা হয়েছে। তারিখ: ২৮/০৯/২০২৬");
    expect(sms).toMatchObject({ direction: "debit", amount: "500.00", currency: "BDT", date: "2026-09-28", ignored: null });
  });
});

describe("dates", () => {
  it("fills in the year for dates without one, never landing in the future", () => {
    expect(parse("BDT 100.00 debited from your A/C **1234 on 28 Sep at 10:15").date).toBe("2026-09-28");
    expect(parse("BDT 100.00 debited from your A/C **1234 on 30 Dec").date).toBe("2025-12-30");
  });

  it("reads month-first dates when day-first is impossible", () => {
    expect(parse("Tk 100 debited from your A/C **1234 on 09/28/2026").date).toBe("2026-09-28");
    expect(parse("Tk 100 debited from your A/C **1234 on 05/09/2026").date).toBe("2026-09-05");
  });

  it("leaves the date empty when the message has none", () => {
    expect(parse("Tk 500/- has been debited from your A/C **1234 for POS purchase.")).toMatchObject({ amount: "500.00", date: null, time: null });
  });
});

describe("messages that aren't transactions", () => {
  it("skips verification codes, adverts, failures, reminders and balance-only messages", () => {
    expect(parse("Your OTP for transaction of BDT 1,250.00 at DARAZ is 123456. Do not share it with anyone.").ignored).toBe("otp");
    expect(parse("Get 20% cashback on Daraz payment with bKash! Offer valid till 30 Sep. T&C apply. Dial *247#").ignored).toBe("promo");
    expect(parse("Your transaction of Tk 500.00 to 01712345678 has failed due to insufficient balance.").ignored).toBe("failed");
    expect(parse("Your credit card bill of BDT 12,500.00 is due on 05-Oct-2026. Minimum due BDT 1,250.00. Please pay by due date.").ignored).toBe("reminder");
    expect(parse("Your current balance is Tk 1,500.00.").ignored).toBe("no_amount");
    expect(parse("Hello! How are you?").ignored).toBe("no_amount");
  });

  it("treats a completed transaction with a cashback note as a transaction", () => {
    const sms = parse("Payment Tk 500.00 to Chaldal successful. Cashback Tk 10.00. Balance Tk 90.00. TrxID BIX4LM5N6P at 28/09/2026 16:00");
    expect(sms).toMatchObject({ ignored: null, direction: "debit", amount: "500.00", balance: "90.00" });
  });
});

describe("splitting pasted text", () => {
  it("splits on blank lines and on lines that are complete alerts", () => {
    const text = [
      "Cash Out Tk 2,000.00 to 01912345678 successful. Fee Tk 37.00. Balance Tk 500.00. TrxID BIT9CD5E6F at 28/09/2026 10:05",
      "Payment Tk 350.00 to Daraz (01712345678) successful. Balance Tk 150.00. TrxID BIU1EF7G8H at 28/09/2026 12:00",
      "",
      "Money Received.\nAmount: Tk 500.00\nSender: 01712345678\nTxnID: 71A2B3C4\nBalance: Tk 650.00\n28/09/2026 14:30",
    ].join("\n");
    const messages = splitMessages(text);
    expect(messages).toHaveLength(3);
    expect(messages[2]).toContain("Sender: 01712345678");
  });

  it("keeps a wrapped bank alert together", () => {
    const text = "Dear Customer,\nYour A/C ***4567 has been debited BDT 500.00\non 28-09-2026.\nAvl Bal BDT 1,000.00";
    expect(splitMessages(text)).toEqual([text]);
  });
});

describe("more formats", () => {
  it("mobile recharge isn't mistaken for a fee", () => {
    expect(parse("Mobile Recharge Tk 50.00 to 01712345678 successful. Balance Tk 450.00. TrxID BIY5NP6Q7R at 28/09/2026 08:00")).toMatchObject({
      direction: "debit",
      channel: "recharge",
      amount: "50.00",
      fee: null,
      balance: "450.00",
    });
  });

  it("wallet bill payment: the biller's customer number isn't your account", () => {
    const sms = parse(
      "Bill payment successful. Biller: DESCO Postpaid, Account: 12345678, Amount: Tk 1,245.00, Fee: Tk 0.00, TrxID: BIZ6PQ7R8S at 28/09/2026 19:30. Balance Tk 2,000.00",
    );
    expect(sms).toMatchObject({ direction: "debit", channel: "bill", amount: "1245.00", accountDigits: null, counterparty: "DESCO Postpaid", confidence: "high" });
    expect(sms.categoryHints[0]).toBe("Bills");
  });

  it("bank to wallet transfer names both sides", () => {
    const sms = parse(
      "Tk 2,500.00 has been transferred from your A/C **4567 to bKash A/C 01712345678 on 28-09-2026 12:10. Avl Bal BDT 7,500.00. City Bank",
    );
    expect(sms).toMatchObject({ direction: "debit", channel: "transfer", amount: "2500.00", accountDigits: "4567" });
    expect(sms.provider?.id).toBe("city");
    expect(sms.otherProvider?.id).toBe("bkash");
  });

  it("fund transfer between two masked accounts", () => {
    expect(parse("Fund Transfer of BDT 5,000.00 from your A/C ***4567 to A/C ***8910 is successful on 28/09/2026.")).toMatchObject({
      direction: "debit",
      accountDigits: "4567",
      counterpartyDigits: "8910",
    });
  });

  it("cashback received", () => {
    expect(parse("Congratulations! You got Tk 25.00 cashback for your payment at Shwapno. TrxID BJB8ST9U0V at 28/09/2026 18:02. Balance Tk 525.00")).toMatchObject({
      direction: "credit",
      channel: "cashback",
      amount: "25.00",
      description: "Cashback",
    });
  });

  it("merchant inside (POS/…) and own account after 'debited from'", () => {
    expect(parse("Your a/c 1234 debited for Tk 1500 on 28-Sep-2026 (POS/DARAZ). Current Bal Tk 3,500")).toMatchObject({ counterparty: "Daraz", accountDigits: "1234" });
    expect(parse("INR 1,500.00 debited from A/c XX1234 on 28-09-26 for UPI txn to swiggy@icici. Avl bal INR 10,000.00")).toMatchObject({
      currency: "INR",
      accountDigits: "1234",
    });
  });
});
