import { beforeEach, describe, expect, it } from "vitest";
import { BACKUP_VERSION, parseBackup, type BackupFile } from "@/lib/backup";
import { prisma } from "@/lib/server/db";
import { createAccount, listAccounts, updateAccount } from "@/lib/server/services/accounts";
import { periodSummary } from "@/lib/server/services/analytics";
import { exportBackup, restoreBackup } from "@/lib/server/services/backup";
import { updateBalance } from "@/lib/server/services/balances";
import { budgetsForMonth, setBudget } from "@/lib/server/services/budgets";
import { createCategory, updateCategory } from "@/lib/server/services/categories";
import { loadCurrencies, setManualRate } from "@/lib/server/services/currency";
import { createRecurring, deleteRecurring, listRecurring, postAllDue } from "@/lib/server/services/recurring";
import { updateSettings } from "@/lib/server/services/settings";
import { checkSms, importSms } from "@/lib/server/services/sms";
import { createTransaction } from "@/lib/server/services/transactions";
import { setPin } from "@/lib/server/auth/pin";
import type { UserId } from "@/lib/server/user-id";
import { balanceUpdateInput, recurringInput, smsImportInput, type TransactionInput } from "@/lib/validation";
import { categoryId, makeAccount, makeUser, resetData } from "../support/fixtures";

const TODAY = "2026-09-28";
const SMS = "Payment Tk 350.00 to Daraz (01712345678) successful. Fee Tk 5.00. Balance Tk 4,645.00. TrxID BIU1EF7G8H at 28/09/2026 12:00";

/** A backup as it comes back from a file: plain JSON, nothing shared with what was exported. */
const throughFile = (backup: BackupFile): BackupFile => JSON.parse(JSON.stringify(backup));

/**
 * Everything a person has recorded, without ids: rows name the account,
 * category and rule they belong to. Two ledgers that print the same here are
 * the same ledger. The derived figures (balances, totals, budgets) come from
 * the ledger views, so a restore that reordered anything would show up.
 */
async function ledgerOf(userId: UserId) {
  const where = { userId };
  const [user, accounts, categories, recurring, transactions, checkpoints, budgets, rates] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    prisma.account.findMany({ where }),
    prisma.category.findMany({ where }),
    prisma.recurringTransaction.findMany({ where }),
    prisma.transaction.findMany({ where }),
    prisma.balanceCheckpoint.findMany({ where }),
    prisma.scopeBudget.findMany({ where }),
    prisma.exchangeRate.findMany({ where }),
  ]);
  const account = new Map(accounts.map((a) => [a.id, a.name]));
  const category = new Map(categories.map((c) => [c.id, `${c.kind}:${c.name}`]));
  const rule = new Map(recurring.map((r) => [r.id, r.description]));
  const named = (id: string | null, names: Map<string, string>) => (id === null ? null : (names.get(id) ?? `?${id}`));
  const sorted = <T>(rows: T[]) => rows.map((row) => JSON.stringify(row)).sort();
  const without = (row: Record<string, unknown>, ...keys: string[]) => Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key)));
  // What a restore gives new values to: ids, the owner, and "last changed".
  const bare = (row: Record<string, unknown>) => without(row, "id", "userId", "updatedAt");

  return {
    settings: {
      displayName: user.displayName,
      baseCurrency: user.baseCurrency,
      timezone: user.timezone,
      numberFormat: user.numberFormat,
      autoLockMinutes: user.autoLockMinutes,
      incomeCurrency: user.incomeCurrency,
      expenseCurrency: user.expenseCurrency,
    },
    accounts: sorted(accounts.map(bare)),
    categories: sorted(categories.map(bare)),
    recurring: sorted(
      recurring.map((r) => ({ ...bare(r), accountId: named(r.accountId, account), toAccountId: named(r.toAccountId, account), categoryId: named(r.categoryId, category) })),
    ),
    transactions: sorted(
      transactions.map((t) => ({
        ...bare(t),
        accountId: named(t.accountId, account),
        toAccountId: named(t.toAccountId, account),
        categoryId: named(t.categoryId, category),
        recurringId: named(t.recurringId, rule),
      })),
    ),
    balanceUpdates: sorted(checkpoints.map((c) => ({ ...bare(c), accountId: named(c.accountId, account) }))),
    // When a budget row was written says nothing: the month it takes effect does.
    budgets: sorted(budgets.map((budget) => without(bare(budget), "createdAt"))),
    rates: sorted(rates.map(bare)),
    // Derived by the ledger views.
    balances: (await listAccounts(userId, TODAY)).map((a) => [a.name, a.balance, a.inflow, a.outflow, a.corrections, a.transactionCount, a.scheduledNet]).sort(),
    year: await periodSummary(userId, "2026-01-01", "2026-12-31", (await loadCurrencies(userId, user.baseCurrency)).conversion),
    budgetLines: (await budgetsForMonth(userId, "2026-09", "BDT")).lines.map((l) => [l.scope, l.budget, l.spent, l.status]),
    rules: (await listRecurring(userId)).map((r) => [r.description, r.nextOccurrence, r.postedCount, r.isActive]).sort(),
  };
}

const ids = async (userId: UserId) =>
  (
    await Promise.all([
      prisma.account.findMany({ where: { userId }, select: { id: true } }),
      prisma.category.findMany({ where: { userId }, select: { id: true } }),
      prisma.transaction.findMany({ where: { userId }, select: { id: true } }),
      prisma.recurringTransaction.findMany({ where: { userId }, select: { id: true } }),
      prisma.balanceCheckpoint.findMany({ where: { userId }, select: { id: true } }),
    ])
  ).flatMap((rows) => rows.map((row) => row.id));

describe("backup and restore", () => {
  let me: UserId;
  let cash: string;
  let bank: string;
  let food: string;

  const expense = (accountId: string, category: string, amount: string, date: string, extra: Partial<TransactionInput> = {}): TransactionInput =>
    ({ type: "EXPENSE", accountId, categoryId: category, amount, date, scope: "PERSONAL", description: "", notes: null, ...extra }) as TransactionInput;

  /** A ledger with one of everything the app can record. */
  beforeEach(async () => {
    me = await resetData();
    cash = await makeAccount({ name: "Cash", openingBalance: "20000", openingDate: "2025-01-01", icon: "banknote", color: "green" });
    bank = await makeAccount({ name: "City Bank 4567", type: "BANK", openingBalance: "5000.50", openingDate: "2025-01-01" });
    const usd = await makeAccount({ name: "Payoneer", type: "EXCHANGE", currency: "USD", openingBalance: "100", openingDate: "2025-06-01" });
    const card = await makeAccount({ name: "Credit card", type: "CARD", openingBalance: "-1500", openingDate: "2026-01-01" });
    const old = await makeAccount({ name: "Old wallet", openingBalance: "0", openingDate: "2024-01-01" });
    food = await categoryId("EXPENSE", "Food");
    const family = await categoryId("EXPENSE", "Family");
    const salary = await categoryId("INCOME", "Salary");
    const fees = await categoryId("EXPENSE", "Other");
    const pets = (await createCategory(me, { name: "Pets", kind: "EXPENSE", defaultScope: "FAMILY", icon: "paw-print", color: "lime", isArchived: false })).id;

    // Every kind of entry: with a time, at the moment it was recorded, undated-in-day, kept out of the balance…
    await createTransaction(me, expense(cash, food, "1500.25", "2026-09-10", { time: "09:15", description: "Groceries", notes: "weekly\nshop" }), { today: TODAY });
    await createTransaction(me, expense(cash, food, "80", TODAY, { description: "Tea" }), { today: TODAY, time: "08:30:15" });
    await createTransaction(me, expense(cash, pets, "999.99", "2024-12-31", { scope: "FAMILY", description: "Before the opening balance" }), { today: TODAY });
    await createTransaction(me, expense(card, food, "450", "2026-09-12", { affectsBalance: false, description: "Already on the statement" }), { today: TODAY });
    await createTransaction(me, expense(old, food, "5", "2024-02-02", { description: "On the old wallet" }), { today: TODAY });
    await createTransaction(me, { type: "INCOME", accountId: bank, categoryId: salary, amount: "80000", date: "2026-09-01", description: "Pay", notes: null }, { today: TODAY, idempotencyKey: "client-key-0001" });
    await createTransaction(me, { type: "INCOME", accountId: usd, categoryId: salary, amount: "250.75", date: "2026-09-03", description: "Freelance", notes: null }, { today: TODAY });
    // …transfers: plain, between currencies, counted as spending, and one dated ahead.
    const transfer = (from: string, to: string, amount: string, date: string, extra: Record<string, unknown> = {}): TransactionInput =>
      ({ type: "TRANSFER", accountId: from, toAccountId: to, amount, toAmount: null, date, countAsExpense: false, categoryId: null, scope: null, description: "", notes: null, ...extra }) as TransactionInput;
    await createTransaction(me, transfer(bank, cash, "3000", "2026-09-05"), { today: TODAY });
    await createTransaction(me, transfer(usd, bank, "100", "2026-09-06", { toAmount: "12250" }), { today: TODAY });
    await createTransaction(me, transfer(bank, cash, "10000", "2026-09-07", { countAsExpense: true, categoryId: family, scope: "FAMILY", description: "Sent home" }), { today: TODAY });
    await createTransaction(me, transfer(bank, cash, "700", "2026-12-01", { description: "Planned" }), { today: TODAY });
    // …an adjustment from before balance updates existed.
    await prisma.transaction.create({ data: { userId: me, type: "ADJUSTMENT", amount: "-12.34", date: new Date("2025-03-01"), accountId: cash, description: "Old correction" } });

    // Balance updates: a correction, one recorded as spending, and one from an SMS (with its fee).
    await updateBalance(me, cash, balanceUpdateInput.parse({ balance: "18000", date: "2026-09-20", time: "21:00", note: "Counted" }), TODAY);
    await updateBalance(me, bank, balanceUpdateInput.parse({ balance: "70000", date: "2026-09-21", recordAs: "CATEGORY", categoryId: food }), TODAY);
    const sms = smsImportInput.parse({
      items: [
        {
          text: SMS,
          transaction: { type: "EXPENSE", amount: "350.00", date: "2026-09-28", time: "12:00", accountId: bank, categoryId: food, scope: "PERSONAL", description: "Daraz", notes: SMS },
          fee: { type: "EXPENSE", amount: "5.00", date: "2026-09-28", time: "12:00", accountId: bank, categoryId: fees, scope: "PERSONAL", description: "Fee" },
          balance: { accountId: bank, amount: "4645.00" },
        },
      ],
    });
    expect((await importSms(me, sms, TODAY, "12:30:00"))[0]).toMatchObject({ status: "added", balanceSaved: true });

    // Recurring: one still running (three occurrences posted), one deleted after posting.
    const rent = recurringInput.parse({ type: "EXPENSE", amount: "9000", accountId: bank, categoryId: food, scope: "PERSONAL", description: "Rent", frequency: "MONTHLY", startDate: "2026-07-05" });
    await createRecurring(me, rent, { today: TODAY, backfill: true });
    const gym = await createRecurring(me, { ...rent, amount: "500", description: "Gym", startDate: "2026-09-01" }, { today: TODAY, backfill: true });
    await deleteRecurring(me, gym.id);

    await setBudget(me, "PERSONAL", "2026-01", "20000");
    await setBudget(me, "PERSONAL", "2026-09", "30000");
    await setBudget(me, "FAMILY", "2026-09", "15000");
    await setManualRate(me, "BDT", "USD", "121.5");
    await updateCategory(me, pets, { name: "Pets", kind: "EXPENSE", defaultScope: "FAMILY", icon: "paw-print", color: "lime", isArchived: true });
    await updateAccount(me, old, { name: "Old wallet", type: "CASH", currency: "BDT", openingBalance: "0", openingDate: "2024-01-01", icon: null, color: null, isActive: false });
    await updateSettings(me, { displayName: "Rafi", baseCurrency: "BDT", timezone: "Asia/Dhaka", numberFormat: "INTERNATIONAL", autoLockMinutes: 30, incomeCurrency: "USD", expenseCurrency: null });
  });

  it("a backup holds everything recorded, and nothing about how to get in", async () => {
    await setPin(me, "4821", null);
    const backup = throughFile(await exportBackup(me, TODAY));
    expect(backup).toMatchObject({ format: "hisab-backup", version: BACKUP_VERSION, asOf: TODAY });
    expect(Date.now() - new Date(backup.exportedAt).getTime()).toBeLessThan(60_000);
    expect(backup.settings).toEqual({ displayName: "Rafi", baseCurrency: "BDT", timezone: "Asia/Dhaka", numberFormat: "INTERNATIONAL", autoLockMinutes: 30, incomeCurrency: "USD", expenseCurrency: null });
    expect([backup.accounts.length, backup.categories.length, backup.recurring.length, backup.budgets.length, backup.exchangeRates.length]).toEqual([5, 21, 1, 3, 1]);
    expect(backup.transactions.length).toBe(await prisma.transaction.count({ where: { userId: me } }));
    expect(backup.balanceUpdates.length).toBe(3);
    // Balances as the ledger derives them, to check a restore against.
    expect(Object.fromEntries(backup.accounts.map((a) => [a.name, a.balance]))).toEqual(Object.fromEntries((await listAccounts(me, TODAY)).map((a) => [a.name, a.balance])));
    // The PIN, the Google account and sign-ins stay on the server.
    const text = JSON.stringify(backup);
    for (const secret of ["pinHash", "scrypt$", "googleSub", "pinFailures", "session"]) expect(text).not.toContain(secret);
    // It is a file anyone can read back.
    expect(parseBackup(backup).ok).toBe(true);
  });

  it("restoring it into the same account gives the same ledger, to the cent and in the same order", async () => {
    const before = await ledgerOf(me);
    const oldIds = await ids(me);
    const backup = throughFile(await exportBackup(me, TODAY));

    // Things change after the backup…
    await createTransaction(me, expense(cash, food, "777", TODAY, { description: "After the backup" }), { today: TODAY });
    await createAccount(me, { name: "New account", type: "CASH", currency: "BDT", openingBalance: "1", openingDate: TODAY, icon: null, color: null, isActive: true });
    await setBudget(me, "FAMILY", "2026-09", "1");
    await updateSettings(me, { displayName: "Someone else", baseCurrency: "USD", timezone: "Europe/London", numberFormat: "SOUTH_ASIAN", autoLockMinutes: 0, incomeCurrency: null, expenseCurrency: "USD" });
    expect(await ledgerOf(me)).not.toEqual(before);

    // …and the restore puts everything back as it was.
    const result = await restoreBackup(me, backup);
    expect(result).toMatchObject({ accounts: 5, categories: 21, recurring: 1, balanceUpdates: 3, budgets: 3, exchangeRates: 1, balanceDifferences: [] });
    expect(result.transactions).toBe(backup.transactions.length);
    expect(await ledgerOf(me)).toEqual(before);

    // Every row has a new id: nothing in a file decides where it is stored.
    const newIds = new Set(await ids(me));
    expect(oldIds.some((id) => newIds.has(id))).toBe(false);

    // Restoring again changes nothing, and a second backup says the same as the first.
    await restoreBackup(me, backup);
    expect(await ledgerOf(me)).toEqual(before);
    const again = await exportBackup(me, TODAY);
    const comparable = (file: BackupFile) => JSON.stringify({ ...file, exportedAt: null }).replace(/"(id|accountId|toAccountId|categoryId|recurringId)":"[^"]+"/g, '"$1":"…"').length;
    expect(comparable(again)).toBe(comparable(backup));
  });

  it("the restored ledger carries on where it left off", async () => {
    await restoreBackup(me, throughFile(await exportBackup(me, TODAY)));
    const bankId = (await prisma.account.findFirstOrThrow({ where: { userId: me, name: "City Bank 4567" } })).id;
    const foodId = await categoryId("EXPENSE", "Food", me);

    // The same message is still known, and a retried entry is still the same entry.
    expect((await checkSms(me, [{ text: SMS, description: "Daraz" }]))[0]).toMatchObject({ balanceSaved: true, learned: { accountId: bankId, categoryId: foodId } });
    expect((await checkSms(me, [{ text: SMS, description: "" }]))[0].existing).toHaveLength(2);
    const retried = await createTransaction(me, { type: "INCOME", accountId: bankId, categoryId: await categoryId("INCOME", "Salary", me), amount: "80000", date: "2026-09-01", description: "Pay", notes: null }, { today: TODAY, idempotencyKey: "client-key-0001" });
    expect(retried.created).toBe(false);

    // The rent keeps posting, once per month, without repeating what was posted before the backup.
    expect(await postAllDue(me, TODAY)).toBe(0);
    expect(await postAllDue(me, "2026-11-10")).toBe(2);
    expect(await prisma.transaction.count({ where: { userId: me, description: "Rent" } })).toBe(5);
    // What a deleted rule had posted stays, belonging to no rule.
    expect(await prisma.transaction.count({ where: { userId: me, description: "Gym", recurringId: null, occurrenceDate: { not: null } } })).toBe(1);
  });

  it("a backup can be restored into another account, which leaves the first untouched", async () => {
    const before = await ledgerOf(me);
    const mine = await ids(me);
    const backup = throughFile(await exportBackup(me, TODAY));

    const other = await makeUser("Someone new");
    await makeAccount({ name: "Their own", openingBalance: "5" }, other);
    await setPin(other, "9999", null);
    const result = await restoreBackup(other, backup);
    expect(result.balanceDifferences).toEqual([]);

    // The same ledger, in rows of their own…
    expect(await ledgerOf(other)).toEqual(before);
    const theirs = new Set(await ids(other));
    expect(mine.some((id) => theirs.has(id))).toBe(false);
    expect(await prisma.account.count({ where: { userId: other, name: "Their own" } })).toBe(0);
    // …while who they are and how they get in stay theirs.
    const user = await prisma.user.findUniqueOrThrow({ where: { id: other } });
    expect(user.pinHash).not.toBeNull();
    // Nothing of mine moved or changed.
    expect(await ledgerOf(me)).toEqual(before);
    expect(await ids(me)).toEqual(mine);
  });

  it("an empty account backs up and restores too", async () => {
    const empty = await makeUser("Empty");
    const backup = throughFile(await exportBackup(empty, TODAY));
    expect([backup.accounts, backup.transactions, backup.balanceUpdates, backup.recurring]).toEqual([[], [], [], []]);
    // Restoring it elsewhere empties that account: a restore replaces, it doesn't merge.
    expect(await restoreBackup(me, backup)).toMatchObject({ accounts: 0, transactions: 0, categories: 20 });
    expect(await prisma.transaction.count({ where: { userId: me } })).toBe(0);
    expect(await listAccounts(me, TODAY)).toEqual([]);
  });

  describe("a file that isn't a sound backup is refused, and nothing changes", () => {
    let good: BackupFile;
    let before: Awaited<ReturnType<typeof ledgerOf>>;

    beforeEach(async () => {
      good = throughFile(await exportBackup(me, TODAY));
      before = await ledgerOf(me);
    });

    /** Restore an altered copy of the good backup; it must be refused with a reason, leaving the ledger alone. */
    async function refused(alter: (file: BackupFile) => unknown, reason: RegExp) {
      const file = throughFile(good);
      const altered = alter(file);
      await expect(restoreBackup(me, altered === undefined ? file : altered), String(reason)).rejects.toMatchObject({
        status: 400,
        message: expect.stringMatching(reason),
      });
      expect(await ledgerOf(me), String(reason)).toEqual(before);
    }
    const tx = (file: BackupFile, where: (t: BackupFile["transactions"][number]) => boolean) => file.transactions.find(where)!;

    it("something else entirely", async () => {
      for (const junk of [null, 42, "backup", [], {}, { format: "other-app", version: 1 }, { format: "hisab-backup" }]) {
        await refused(() => junk, /isn't a Hisab backup file/);
      }
      await refused((f) => void (f.version = BACKUP_VERSION + 1), /newer version of Hisab/);
      await refused((f) => void delete (f as Partial<BackupFile>).transactions, /the list of transactions is missing/);
      await refused((f) => void ((f as { accounts: unknown }).accounts = "all of them"), /the list of accounts is missing/);
      await refused((f) => void delete (f as Partial<BackupFile>).settings, /settings is not valid/);
      await refused((f) => void ((f as { asOf: unknown }).asOf = 20260928), /asOf is not valid/);
    });

    it("entries that break the ledger's rules", async () => {
      const expenseRow = (f: BackupFile) => tx(f, (t) => t.description === "Groceries");
      const transferRow = (f: BackupFile) => tx(f, (t) => t.type === "TRANSFER" && !t.toAmount && !t.countAsExpense);
      const conversion = (f: BackupFile) => tx(f, (t) => t.type === "TRANSFER" && !!t.toAmount);

      await refused((f) => void (expenseRow(f).amount = "-5"), /transaction \d+: amount must be greater than zero/);
      await refused((f) => void (expenseRow(f).amount = "0"), /amount must be greater than zero/);
      await refused((f) => void (expenseRow(f).amount = "12.345"), /amount is not an amount/);
      await refused((f) => void (expenseRow(f).amount = "1e9"), /amount is not an amount/);
      await refused((f) => void (expenseRow(f).amount = "9999999999999"), /amount is not an amount/);
      await refused((f) => void (expenseRow(f).date = "2026-02-30"), /date is not a valid date/);
      await refused((f) => void (expenseRow(f).time = "25:00"), /time is not a time/);
      await refused((f) => void (expenseRow(f).loggedTime = "09:15:00"), /loggedTime can't be set together with a time/);
      await refused((f) => void (expenseRow(f).categoryId = null), /categoryId is missing/);
      await refused((f) => void (expenseRow(f).scope = null), /scope is missing/);
      await refused((f) => void (expenseRow(f).toAccountId = f.accounts[1].id), /only a transfer has a destination/);
      await refused((f) => void (expenseRow(f).description = "x".repeat(141)), /description/);
      await refused((f) => void ((expenseRow(f) as { type: string }).type = "GIFT"), /transaction \d+: type/);
      await refused((f) => void (transferRow(f).toAccountId = transferRow(f).accountId), /is the account the transfer comes from/);
      await refused((f) => void (transferRow(f).categoryId = f.categories[0].id), /categoryId doesn't belong on this entry/);
      await refused((f) => void (transferRow(f).toAmount = "3000"), /both accounts use the same currency/);
      await refused((f) => void (conversion(f).toAmount = null), /between currencies without the amount received/);
      await refused((f) => void (tx(f, (t) => t.type === "ADJUSTMENT").affectsBalance = false), /an adjustment always counts/);
      await refused((f) => void (tx(f, (t) => t.type === "ADJUSTMENT").amount = "0"), /amount can't be zero/);
      // An income category on an expense, and the other way round.
      await refused((f) => void (expenseRow(f).categoryId = f.categories.find((c) => c.kind === "INCOME")!.id), /transaction \d+ has an income category/);
      await refused((f) => void (tx(f, (t) => t.type === "INCOME").categoryId = f.categories.find((c) => c.kind === "EXPENSE")!.id), /has an expense category/);

      await refused((f) => void (f.accounts[0].name = "   "), /account 1: name is empty/);
      await refused((f) => void (f.accounts[0].currency = "taka"), /account 1: currency is not a currency code/);
      await refused((f) => void (f.accounts[0].openingBalance = "lots"), /openingBalance is not an amount/);
      await refused((f) => void (f.categories.find((c) => c.kind === "EXPENSE")!.defaultScope = null), /defaultScope must be set for expense categories only/);
      await refused((f) => void (f.recurring[0].endDate = "2026-01-01"), /recurring transaction 1: endDate is before the start date/);
      await refused((f) => void (f.recurring[0].occurrenceIndex = -1), /recurring transaction 1: occurrenceIndex/);
      await refused((f) => void (f.balanceUpdates.find((c) => c.source === "SMS")!.messageDate = null), /balance update \d+: messageDate/);
      await refused((f) => void (f.balanceUpdates.find((c) => c.source === "MANUAL")!.messageDate = "2026-09-20"), /balance update \d+: messageDate/);
      await refused((f) => void (f.budgets[0].effectiveFrom = "2026-01-15"), /budget 1: effectiveFrom is not the first day of a month/);
      await refused((f) => void (f.budgets[0].amount = "-1"), /budget 1: amount can't be negative/);
      await refused((f) => void (f.exchangeRates[0].rate = "0"), /exchange rate 1: rate is not a rate above 0/);
      await refused((f) => void (f.exchangeRates[0].currency = f.exchangeRates[0].base), /is the same as the main currency/);
      await refused((f) => void ((f.settings as { numberFormat: string }).numberFormat = "ROMAN"), /settings: numberFormat/);
    });

    it("entries that point outside the file, or twice at the same thing", async () => {
      // Another person's real account and category: the file can't reach them.
      const other = await makeUser("Other");
      const theirAccount = await makeAccount({ name: "Theirs", openingBalance: "9000" }, other);
      const theirCategory = await categoryId("EXPENSE", "Food", other);
      const theirs = await ledgerOf(other);

      await refused((f) => void (f.transactions[0].accountId = theirAccount), /transaction 1 is on an account that isn't in the backup/);
      await refused((f) => void (tx(f, (t) => t.type === "TRANSFER").toAccountId = theirAccount), /goes to an account that isn't in the backup/);
      await refused((f) => void (tx(f, (t) => t.type === "EXPENSE").categoryId = theirCategory), /has a category that isn't in the backup/);
      await refused((f) => void (f.recurring[0].accountId = theirAccount), /recurring transaction 1 is on an account that isn't in the backup/);
      await refused((f) => void (f.balanceUpdates[0].accountId = theirAccount), /balance update 1 is for an account that isn't in the backup/);
      await refused((f) => void (tx(f, (t) => t.type === "EXPENSE").recurringId = "no-such-rule"), /posted by a recurring transaction that isn't in the backup/);
      expect(await ledgerOf(other)).toEqual(theirs);

      await refused((f) => void (f.accounts[1].id = f.accounts[0].id), /account 2 repeats an id/);
      await refused((f) => void (f.accounts[1].name = f.accounts[0].name.toUpperCase()), /account 2 repeats the name/);
      await refused((f) => void f.categories.push({ ...f.categories[0], id: "another" }), /category \d+ repeats the name/);
      await refused((f) => void f.transactions.push({ ...tx(f, (t) => t.idempotencyKey === "client-key-0001") }), /transaction \d+ repeats the key/);
      await refused((f) => void f.transactions.push({ ...tx(f, (t) => !!t.recurringId), idempotencyKey: null }), /repeats an occurrence already posted/);
      await refused((f) => void f.balanceUpdates.push({ ...f.balanceUpdates.find((c) => c.smsKey)! }), /balance update \d+ repeats the message/);
      await refused((f) => void f.budgets.push({ ...f.budgets[0] }), /budget \d+ repeats the month/);
      await refused((f) => void f.exchangeRates.push({ ...f.exchangeRates[0] }), /exchange rate 2 repeats an earlier rate/);
      await refused((f) => void (f.accounts = Array.from({ length: 501 }, (_, i) => ({ ...f.accounts[0], id: `a${i}`, name: `Account ${i}` }))), /the list of accounts has more than 500 entries/);
    });

    it("a bad entry at the very end undoes everything before it", async () => {
      // Sound in every way the file can be checked — but text the database can't store.
      await refused((f) => void (f.transactions[f.transactions.length - 1].notes = "nul\u0000byte"), /can't be restored/);
      await refused((f) => void (f.exchangeRates[0].currency = "A\u0000B"), /can't be restored/);
    });

    it("what a file can't decide is left alone or made safe", async () => {
      const file = throughFile(good) as BackupFile & { settings: Record<string, unknown> };
      // Not a way to set a PIN, become someone else, or own rows elsewhere.
      Object.assign(file.settings, { pinHash: "scrypt$1$1$1$AAAA$AAAA", googleSub: "someone-else", email: "x@example.com", timezone: "Mars/Olympus", autoLockMinutes: 7 });
      Object.assign(file.accounts[0], { userId: "another-user", icon: "not-an-icon", color: "not-a-colour" });
      Object.assign(file.categories[0], { icon: "nope", color: "nope" });
      Object.assign(file.transactions[0], { userId: "another-user", id: "chosen-by-the-file" });
      const user = await prisma.user.findUniqueOrThrow({ where: { id: me } });

      await restoreBackup(me, file);
      const after = await prisma.user.findUniqueOrThrow({ where: { id: me } });
      expect(after).toMatchObject({ pinHash: null, googleSub: user.googleSub, email: user.email, timezone: "Asia/Dhaka", autoLockMinutes: 15 });
      expect(await prisma.transaction.count({ where: { id: "chosen-by-the-file" } })).toBe(0);
      expect(await prisma.transaction.count({ where: { userId: me } })).toBe(file.transactions.length);
      const account = await prisma.account.findFirstOrThrow({ where: { userId: me, name: file.accounts[0].name } });
      expect([account.icon, account.color]).toEqual([null, null]);
      const category = await prisma.category.findFirstOrThrow({ where: { userId: me, name: file.categories[0].name, kind: file.categories[0].kind } });
      expect([category.icon, category.color]).toEqual(["circle-dashed", "gray"]);
    });

    it("says when the restored balances aren't the ones the backup recorded", async () => {
      const file = throughFile(good);
      file.accounts.find((a) => a.name === "Cash")!.balance = "123.45";
      const result = await restoreBackup(me, file);
      const cash = (await listAccounts(me, TODAY)).find((a) => a.name === "Cash")!;
      expect(result.balanceDifferences).toEqual([{ account: "Cash", currency: "BDT", inBackup: "123.45", restored: cash.balance }]);
      // An older file without balances has nothing to compare.
      for (const account of file.accounts) account.balance = null;
      expect((await restoreBackup(me, file)).balanceDifferences).toEqual([]);
    });
  });
});
