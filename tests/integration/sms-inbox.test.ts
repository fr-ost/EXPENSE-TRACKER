import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/server/db";
import { getAccount } from "@/lib/server/services/accounts";
import { authenticateDevice, completeDeviceLink, listDevices, removeDevice, startDeviceLink, touchDevice } from "@/lib/server/services/devices";
import { importSms } from "@/lib/server/services/sms";
import { countWaitingSms, dismissWaitingSms, listWaitingSms, receiveSms, type IncomingSms } from "@/lib/server/services/sms-inbox";
import { createTransaction } from "@/lib/server/services/transactions";
import { smsImportInput } from "@/lib/validation";
import { categoryId, makeAccount, makeUser, me, resetData } from "../support/fixtures";

// 28 September 2026, 14:30 in Dhaka (new users are in Asia/Dhaka).
const NOW = new Date("2026-09-28T08:30:00Z");
const TODAY = "2026-09-28";
/** A moment that day, Dhaka time, as the phone reports it. */
const at = (time: string, date = TODAY) => new Date(`${date}T${time}:00+06:00`).getTime();

const CASH_OUT = "Cash Out Tk 2,000.00 to 01912345678 successful. Fee Tk 37.00. Balance Tk 500.00. TrxID BIT9CD5E6F at 28/09/2026 10:05";
const PAYMENT = "Payment Tk 350.00 to Daraz (01712345678) successful. Balance Tk 150.00. TrxID BIU1EF7G8H at 28/09/2026 12:00";
const NAGAD = "Money Received.\nAmount: Tk 1,000.00\nSender: 01712345678\nRef: lunch\nTxnID: 7A1B2C3D\nBalance: Tk 1,500.00\n28/09/2026 09:15";
const OTP = "Your bKash verification code is 123456. Never share your code and PIN with anyone.";
const PROMO = "Get up to 20% cashback on bKash payment at Daraz! Offer valid till 30 Sep. T&C: https://bka.sh/offer";
const CARD_SPEND = "Tk 500.00 spent at SHWAPNO on your A/C **4567. Avl Bal Tk 9,500.00";
const BALANCE_ONLY = "Dear customer, your bKash account balance is Tk 8,000.00 as of 28/09/2026 13:00.";

const sms = (text: string, time: string, sender = "bKash"): IncomingSms => ({ text, sender, receivedAt: at(time) });

async function linkPhone(userId = me, name = "Pixel 8") {
  const { code } = await startDeviceLink(userId);
  const { token } = await completeDeviceLink(code, { name, appVersion: "1.0.5" });
  const device = await authenticateDevice(token);
  return { code, token, id: device!.id };
}

describe("messages handed in by a linked phone", () => {
  let cash: string;
  let bkash: string;
  let phone: string;

  beforeEach(async () => {
    // The clock starts at NOW and runs on: two balances recorded one after the other are in that order.
    vi.useFakeTimers({ toFake: ["Date"], now: NOW, shouldAdvanceTime: true, advanceTimeDelta: 1 });
    await resetData();
    cash = await makeAccount({ name: "Cash", openingBalance: "1000", openingDate: "2025-01-01" });
    bkash = await makeAccount({ name: "bKash", type: "MOBILE_WALLET", openingBalance: "2537", openingDate: "2025-01-01" });
    phone = (await linkPhone()).id;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("adds a message that is complete and certain, with its fee and the balance it reports", async () => {
    const [outcome] = await receiveSms(me, phone, [sms(CASH_OUT, "10:06")]);
    expect(outcome).toEqual({ status: "added", title: "Moved ৳2,000 · Cash out", detail: "bKash · fee ৳37 · balance ৳500" });

    const added = await prisma.transaction.findMany({ where: { userId: me }, orderBy: { idempotencyKey: "asc" } });
    expect(added.map((t) => [t.type, t.amount.toFixed(2), t.accountId, t.toAccountId, t.time])).toEqual([
      ["TRANSFER", "2000.00", bkash, cash, "10:05"],
      ["EXPENSE", "37.00", bkash, null, "10:05"],
    ]);
    // The message is the transaction's record, as when it is pasted.
    expect(added[0].notes).toBe(CASH_OUT);
    expect((await getAccount(me, bkash, TODAY)).balance).toBe("500.00");
    expect((await getAccount(me, cash, TODAY)).balance).toBe("3000.00");
    expect(await countWaitingSms(me)).toBe(0);
  });

  it("never adds the same message twice: handed in again, by another phone, or pasted earlier", async () => {
    await receiveSms(me, phone, [sms(CASH_OUT, "10:06")]);
    expect(await receiveSms(me, phone, [sms(CASH_OUT, "10:06")])).toEqual([{ status: "exists" }]);
    const tablet = (await linkPhone(me, "Galaxy Tab")).id;
    expect(await receiveSms(me, tablet, [sms(`  ${CASH_OUT.toLowerCase()} `, "10:07")])).toEqual([{ status: "exists" }]);
    expect(await prisma.transaction.count()).toBe(2);

    // Pasted on the Import SMS page before the phone hands it in.
    const pasted = smsImportInput.parse({
      items: [{ text: PAYMENT, transaction: { type: "EXPENSE", amount: "350", date: TODAY, time: "12:00", accountId: bkash, categoryId: await categoryId("EXPENSE", "Shopping"), scope: "PERSONAL", description: "Daraz" } }],
    });
    await importSms(me, pasted, TODAY);
    expect(await receiveSms(me, phone, [sms(PAYMENT, "12:01")])).toEqual([{ status: "exists" }]);
    expect(await prisma.transaction.count()).toBe(3);
    // …and the balance that message reports is recorded now.
    expect((await getAccount(me, bkash, TODAY)).balance).toBe("150.00");
  });

  it("drops messages that aren't transactions without keeping them anywhere", async () => {
    const outcomes = await receiveSms(me, phone, [sms(OTP, "09:00"), sms(PROMO, "09:01")]);
    expect(outcomes).toEqual([{ status: "ignored" }, { status: "ignored" }]);
    expect(await prisma.transaction.count()).toBe(0);
    expect(await prisma.smsInbox.count()).toBe(0);
    expect(await prisma.balanceCheckpoint.count()).toBe(0);
  });

  it("keeps a message it can't place for the user, once, until it is dealt with", async () => {
    // There is no Nagad account.
    expect(await receiveSms(me, phone, [sms(NAGAD, "09:16", "NAGAD")])).toEqual([{ status: "review" }]);
    expect(await receiveSms(me, phone, [sms(NAGAD, "09:16", "NAGAD")])).toEqual([{ status: "review" }]);
    expect(await prisma.transaction.count()).toBe(0);

    const { messages, total } = await listWaitingSms(me);
    expect(total).toBe(1);
    expect(messages).toEqual([{ id: expect.any(String), text: NAGAD, sender: "NAGAD", receivedAt: { date: TODAY, time: "09:16" } }]);

    // The user makes the account and adds it on the Import SMS page: it stops waiting.
    const nagad = await makeAccount({ name: "Nagad", type: "MOBILE_WALLET", openingBalance: "500", openingDate: "2025-01-01" });
    const byHand = smsImportInput.parse({
      items: [{ text: NAGAD, transaction: { type: "INCOME", amount: "1000", date: TODAY, time: "09:15", accountId: nagad, categoryId: await categoryId("INCOME", "Other"), description: "Received from 01712345678" } }],
    });
    expect((await importSms(me, byHand, TODAY))[0].status).toBe("added");
    expect(await countWaitingSms(me)).toBe(0);
  });

  it("leaves a message for the user when something similar is already recorded", async () => {
    await createTransaction(
      me,
      { type: "EXPENSE", amount: "350", date: "2026-09-27", accountId: bkash, categoryId: await categoryId("EXPENSE", "Shopping"), scope: "PERSONAL", description: "Daraz order", notes: null },
      { today: TODAY },
    );
    expect(await receiveSms(me, phone, [sms(PAYMENT, "12:01")])).toEqual([{ status: "review" }]);
    expect(await prisma.transaction.count()).toBe(1);
    expect(await countWaitingSms(me)).toBe(1);
    // The balance it reports isn't recorded until the user says what the message is.
    expect(await prisma.balanceCheckpoint.count()).toBe(0);
  });

  it("dates and times a message that states neither by when the phone received it", async () => {
    const bank = await makeAccount({ name: "City Bank 4567", type: "BANK", openingBalance: "10000", openingDate: "2025-01-01" });
    // Received the evening before; handed in today.
    const [outcome] = await receiveSms(me, phone, [{ text: CARD_SPEND, sender: "CityBank", receivedAt: at("21:40", "2026-09-27") }]);
    expect(outcome).toMatchObject({ status: "added", title: "Spent ৳500 · Shwapno", detail: "City Bank 4567 · balance ৳9,500" });
    const spent = await prisma.transaction.findFirstOrThrow({ where: { userId: me, accountId: bank } });
    expect(spent.date.toISOString().slice(0, 10)).toBe("2026-09-27");
    expect(spent.time).toBe("21:40");
  });

  it("takes a message that only reports a balance as the account's balance, when it says whose", async () => {
    expect(await receiveSms(me, phone, [sms(BALANCE_ONLY, "13:01")])).toEqual([{ status: "balance", title: "Balance ৳8,000", detail: "bKash" }]);
    expect((await getAccount(me, bkash, TODAY)).balance).toBe("8000.00");
    expect(await prisma.transaction.count()).toBe(0);
    // Again: nothing more.
    expect(await receiveSms(me, phone, [sms(BALANCE_ONLY, "13:01")])).toMatchObject([{ status: "balance" }]);
    expect(await prisma.balanceCheckpoint.count()).toBe(1);

    // No account it could belong to: the user decides.
    expect(await receiveSms(me, phone, [sms("Your Nagad account balance is Tk 300.00.", "13:05", "NAGAD")])).toEqual([{ status: "review" }]);
    expect(await countWaitingSms(me)).toBe(1);
  });

  it("learns which account a wallet's messages belong to from what the user did before", async () => {
    const wallet = await makeAccount({ name: "Daily spending", type: "MOBILE_WALLET", openingBalance: "5000", openingDate: "2025-01-01" });
    await prisma.account.update({ where: { id: bkash, userId: me }, data: { name: "Old wallet" } });
    // Nothing says "Daily spending" is the bKash account.
    expect(await receiveSms(me, phone, [sms(CASH_OUT, "10:06")])).toEqual([{ status: "review" }]);

    // The user adds it by hand, choosing the account…
    const byHand = smsImportInput.parse({
      items: [{ text: CASH_OUT, transaction: { type: "TRANSFER", amount: "2000", date: TODAY, time: "10:05", accountId: wallet, toAccountId: cash, description: "Cash out", notes: CASH_OUT } }],
    });
    expect((await importSms(me, byHand, TODAY))[0].status).toBe("added");

    // …and the next bKash message goes there on its own.
    expect(await receiveSms(me, phone, [sms(PAYMENT, "12:01")])).toMatchObject([{ status: "added", detail: "Daily spending · balance ৳150" }]);
    const payment = await prisma.transaction.findFirstOrThrow({ where: { userId: me, description: "Daraz" } });
    expect(payment.accountId).toBe(wallet);
  });

  it("reads a batch oldest first and answers in the order given", async () => {
    const outcomes = await receiveSms(me, phone, [sms(PAYMENT, "12:01"), sms(OTP, "11:00"), sms(CASH_OUT, "10:06")]);
    expect(outcomes.map((o) => o.status)).toEqual(["added", "ignored", "added"]);
    // The newest message's balance is the account's.
    expect((await getAccount(me, bkash, TODAY)).balance).toBe("150.00");
    const created = await prisma.transaction.findMany({ where: { userId: me }, select: { description: true } });
    expect(created.map((t) => t.description).sort()).toEqual(["Cash out", "Cash out fee", "Daraz"]);
  });

  it("a phone whose clock runs ahead can't date a message in the future", async () => {
    await makeAccount({ name: "City Bank 4567", type: "BANK", openingBalance: "10000", openingDate: "2025-01-01" });
    const [outcome] = await receiveSms(me, phone, [{ text: CARD_SPEND, sender: "CityBank", receivedAt: at("09:00", "2026-10-03") }]);
    expect(outcome.status).toBe("added");
    const spent = await prisma.transaction.findFirstOrThrow({ where: { userId: me } });
    expect([spent.date.toISOString().slice(0, 10), spent.time]).toEqual([TODAY, "14:30"]);
  });

  it("keeps the newest waiting messages when far too many pile up", async () => {
    await prisma.smsInbox.createMany({
      data: Array.from({ length: 500 }, (_, i) => ({
        userId: me,
        deviceId: phone,
        fingerprint: i.toString(16).padStart(40, "0"),
        text: `waiting ${i}`,
        sender: "NAGAD",
        receivedAt: new Date(at("00:00", "2026-09-01") + i * 60_000),
      })),
    });
    expect(await receiveSms(me, phone, [sms(NAGAD, "09:16", "NAGAD")])).toEqual([{ status: "review" }]);
    expect(await countWaitingSms(me)).toBe(500);
    expect(await prisma.smsInbox.count({ where: { text: "waiting 0" } })).toBe(0);
    const { messages, total } = await listWaitingSms(me);
    expect([messages.length, total, messages[0].text]).toEqual([50, 500, NAGAD]);
  });

  it("lets the user dismiss what is waiting", async () => {
    await receiveSms(me, phone, [sms(NAGAD, "09:16", "NAGAD")]);
    const { messages } = await listWaitingSms(me);
    expect(await dismissWaitingSms(me, [messages[0].id, "no-such-id"])).toBe(1);
    expect(await countWaitingSms(me)).toBe(0);
  });
});

describe("linking a phone", () => {
  beforeEach(async () => {
    await resetData();
  });

  it("turns a one-time code into the phone's own token", async () => {
    const { code, expiresInSeconds } = await startDeviceLink(me);
    expect(code).toMatch(/^[\w-]{43}$/);
    expect(expiresInSeconds).toBe(600);
    // Until the phone collects it there is no phone, and the code is no token.
    expect(await listDevices(me)).toEqual([]);
    expect(await authenticateDevice(code)).toBeNull();

    const { token } = await completeDeviceLink(code, { name: "Pixel 8", appVersion: "1.0.5" });
    expect(token).toMatch(/^[\w-]{43}$/);
    expect(token).not.toBe(code);
    const device = await authenticateDevice(token);
    expect(device?.userId).toBe(me);
    expect(await listDevices(me)).toEqual([{ id: device!.id, name: "Pixel 8", linkedAt: expect.any(String), lastSeenAt: null, appVersion: "1.0.5" }]);

    // Only hashes are stored.
    const stored = await prisma.device.findUniqueOrThrow({ where: { id: device!.id, userId: me } });
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(token);

    await touchDevice(me, device!.id, "1.0.6");
    expect((await listDevices(me))[0]).toMatchObject({ appVersion: "1.0.6", lastSeenAt: expect.any(String) });
  });

  it("a code works once, for a few minutes, and never as a token", async () => {
    const { code } = await startDeviceLink(me);
    const { token } = await completeDeviceLink(code, { name: "Pixel 8", appVersion: null });
    await expect(completeDeviceLink(code, { name: "Another phone", appVersion: null })).rejects.toThrow(/expired/);
    // The token can't be exchanged like a code either.
    await expect(completeDeviceLink(token, { name: "Another phone", appVersion: null })).rejects.toThrow(/expired/);
    expect(await listDevices(me)).toHaveLength(1);

    const late = await startDeviceLink(me);
    await prisma.device.updateMany({ where: { userId: me, pendingUntil: { not: null } }, data: { pendingUntil: new Date(Date.now() - 1000) } });
    await expect(completeDeviceLink(late.code, { name: "Slow phone", appVersion: null })).rejects.toThrow(/expired/);
    // Asking again clears the codes nobody collected.
    await startDeviceLink(me);
    expect(await prisma.device.count({ where: { userId: me, pendingUntil: { not: null } } })).toBe(1);
  });

  it("two requests with the same code link one phone", async () => {
    const { code } = await startDeviceLink(me);
    const results = await Promise.allSettled([
      completeDeviceLink(code, { name: "A", appVersion: null }),
      completeDeviceLink(code, { name: "B", appVersion: null }),
      completeDeviceLink(code, { name: "C", appVersion: null }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await listDevices(me)).toHaveLength(1);
  });

  it("limits how many codes and phones an account can have", async () => {
    for (let i = 0; i < 5; i++) await startDeviceLink(me);
    await expect(startDeviceLink(me)).rejects.toThrow(/Too many tries/);
    await prisma.device.deleteMany({ where: { userId: me } });
    for (let i = 0; i < 10; i++) await linkPhone(me, `Phone ${i}`);
    await expect(startDeviceLink(me)).rejects.toThrow(/10 phones/);
  });

  it("a removed phone's token is dead; what it handed in stays", async () => {
    await makeAccount({ name: "bKash", type: "MOBILE_WALLET", openingBalance: "2537", openingDate: "2025-01-01" });
    await makeAccount({ name: "Cash", openingBalance: "0", openingDate: "2025-01-01" });
    const { token, id } = await linkPhone();
    await receiveSms(me, id, [{ text: CASH_OUT, sender: "bKash", receivedAt: Date.now() }, { text: NAGAD, sender: "NAGAD", receivedAt: Date.now() }]);

    await removeDevice(me, id);
    expect(await authenticateDevice(token)).toBeNull();
    expect(await listDevices(me)).toEqual([]);
    await expect(removeDevice(me, id)).rejects.toThrow(/isn't linked/);
    expect(await prisma.transaction.count({ where: { userId: me } })).toBe(2);
    expect(await countWaitingSms(me)).toBe(1);
  });

  it("tokens that were never issued are nobody's", async () => {
    for (const junk of ["", "x", "a".repeat(43), "a".repeat(500)]) expect(await authenticateDevice(junk)).toBeNull();
  });

  it("one person's phone feeds only their own ledger", async () => {
    const ann = me;
    const bob = await makeUser("Bob");
    for (const user of [ann, bob]) {
      await makeAccount({ name: "bKash", type: "MOBILE_WALLET", openingBalance: "2537", openingDate: "2025-01-01" }, user);
      await makeAccount({ name: "Cash", openingBalance: "0", openingDate: "2025-01-01" }, user);
    }
    const annPhone = await linkPhone(ann, "Ann's phone");
    const bobPhone = await linkPhone(bob, "Bob's phone");
    expect((await authenticateDevice(bobPhone.token))?.userId).toBe(bob);

    // The same message on both phones: each ledger gets its own copy, and only its own.
    const message = [{ text: CASH_OUT, sender: "bKash", receivedAt: Date.now() }, { text: NAGAD, sender: "NAGAD", receivedAt: Date.now() }];
    expect((await receiveSms(bob, bobPhone.id, message)).map((o) => o.status)).toEqual(["added", "review"]);
    expect(await prisma.transaction.count({ where: { userId: ann } })).toBe(0);
    expect(await countWaitingSms(ann)).toBe(0);
    expect((await receiveSms(ann, annPhone.id, message)).map((o) => o.status)).toEqual(["added", "review"]);
    expect(await prisma.transaction.count({ where: { userId: bob } })).toBe(2);

    // Ann sees and touches only her own phones and waiting messages.
    expect((await listDevices(ann)).map((d) => d.name)).toEqual(["Ann's phone"]);
    const bobWaiting = (await listWaitingSms(bob)).messages[0].id;
    expect(await dismissWaitingSms(ann, [bobWaiting])).toBe(0);
    await expect(removeDevice(ann, bobPhone.id)).rejects.toThrow(/isn't linked/);
    await touchDevice(ann, bobPhone.id, "9.9.9");
    expect((await listDevices(bob))[0]).toMatchObject({ name: "Bob's phone", appVersion: "1.0.5", lastSeenAt: null });
    expect(await countWaitingSms(bob)).toBe(1);
    expect(await authenticateDevice(bobPhone.token)).not.toBeNull();
  });
});
