import { expect, test, type Page } from "@playwright/test";
import { E2E_PASSWORD } from "./env";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test.describe.configure({ mode: "serial" });

test("everything is private until signed in", async ({ page, request }) => {
  const api = await request.get("/api/accounts");
  expect(api.status()).toBe(401);

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  // No sign-up path exists.
  await expect(page.getByText(/sign up|register|create account/i)).toHaveCount(0);
});

test("a wrong password is rejected without detail", async ({ page }) => {
  await page.goto("/login");
  await page.getByPlaceholder("Password").fill("definitely-not-it");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Incorrect password." })).toBeVisible();
});

test("first run: add an account, then an expense updates the balance in place", async ({ page }) => {
  await signIn(page);
  // First sign-in creates the owner; the greeting uses the default name.
  await expect(page.getByRole("heading", { name: /^Good (morning|afternoon|evening), Shahriar Ahmed$/ })).toBeVisible();

  await page.getByRole("link", { name: "Add your first account" }).click();
  await page.getByLabel("Name").fill("Cash wallet");
  await page.getByPlaceholder("0").fill("20000");
  await page.getByLabel("Balance as of").fill("2025-01-01");
  await page.getByRole("button", { name: "Add account" }).last().click();
  await expect(page.getByText("Cash wallet added")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByRole("button", { name: "Add account" }).first().click();
  await page.getByLabel("Name").fill("City Bank");
  await page.getByRole("radio", { name: "Bank" }).click();
  await page.getByPlaceholder("0").fill("100000");
  await page.getByLabel("Balance as of").fill("2025-01-01");
  await page.getByRole("button", { name: "Add account" }).last().click();
  await expect(page.getByRole("link", { name: /City Bank/ })).toContainText("৳1,00,000");

  // Historical expense via the keyboard shortcut.
  await page.keyboard.press("n");
  const sheet = page.getByRole("dialog", { name: "New transaction" });
  await sheet.getByLabel(/Amount/).fill("2000");
  await sheet.getByRole("radio", { name: "Food" }).click();
  await sheet.getByLabel("Date").fill("2025-03-05");
  await sheet.getByPlaceholder("What was it for?").fill("Groceries");
  await sheet.getByRole("button", { name: /Add expense/ }).click();
  await expect(page.getByText("Expense added")).toBeVisible();

  // The account card re-renders with the ledger-derived balance (no reload).
  await expect(page.getByRole("link", { name: /Cash wallet/ })).toContainText("৳18,000");
});

test("a transfer counted as expense moves money once and counts as spending", async ({ page }) => {
  await signIn(page);
  await page.goto("/transactions");
  await page.getByRole("button", { name: "New transaction" }).last().click();
  const sheet = page.getByRole("dialog", { name: "New transaction" });
  await sheet.getByRole("radio", { name: "Transfer" }).click();
  await sheet.getByLabel(/Amount/).fill("10000");
  await sheet.getByRole("switch", { name: "Count this transfer as an expense" }).click();
  await sheet.getByRole("radio", { name: "Family" }).first().click();
  await sheet.getByRole("button", { name: /Add transfer/ }).click();
  await expect(page.getByText("Transfer added")).toBeVisible();

  await expect(page.getByText("Counted as expense").first()).toBeVisible();
  await page.goto("/accounts");
  // Cash 18,000 − 10,000 → 8,000; City Bank 1,00,000 + 10,000.
  await expect(page.getByRole("link", { name: /Cash wallet/ })).toContainText("৳8,000");
  await expect(page.getByRole("link", { name: /City Bank/ })).toContainText("৳1,10,000");
});

test("deleting a transaction restores the balance", async ({ page }) => {
  await signIn(page);
  await page.goto("/transactions?q=Groceries");
  await page.getByRole("button", { name: /Groceries/ }).click();
  await page.getByRole("button", { name: "Delete transaction" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Expense deleted")).toBeVisible();
  await page.goto("/accounts");
  await expect(page.getByRole("link", { name: /Cash wallet/ })).toContainText("৳10,000");
});

test("lock hides everything until the password is entered again", async ({ page }) => {
  await signIn(page);
  await page.goto("/accounts");
  await page.getByRole("button", { name: "Lock now" }).first().click();
  await expect(page).toHaveURL(/\/lock/);
  await expect(page.getByText("৳")).toHaveCount(0);

  const api = await page.request.get("/api/accounts");
  expect(api.status()).toBe(423);

  await page.getByPlaceholder("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page).toHaveURL(/\/accounts/);
});

test("an SMS is read and added once, and never twice", async ({ page }) => {
  await signIn(page);
  await page.goto("/accounts");
  await page.getByRole("button", { name: "Add account" }).first().click();
  await page.getByLabel("Name").fill("bKash");
  await page.getByRole("radio", { name: "Mobile wallet" }).click();
  await page.getByPlaceholder("0").fill("2537");
  await page.getByLabel("Balance as of").fill("2025-01-01");
  await page.getByRole("button", { name: "Add account" }).last().click();
  await expect(page.getByText("bKash added")).toBeVisible();

  const sms = "Cash Out Tk 2,000.00 to 01912345678 successful. Fee Tk 37.00. Balance Tk 500.00. TrxID BIT9CD5E6F at 20/09/2026 10:05";
  const paste = async () => {
    await page.goto("/sms");
    await page.getByLabel("Transaction messages").fill(sms);
    await page.getByRole("button", { name: "Analyze" }).click();
  };

  await paste();
  const card = page.getByRole("listitem", { name: /Cash out/ });
  await expect(card).toContainText("Ready");
  // bKash 2,537 − 2,000 − 37 fee = 500, which is what the SMS says.
  await expect(card).toContainText("Update bKash balance to ৳500.00");
  await expect(card).toContainText("Matches Hisab");
  await card.getByRole("button", { name: "Add", exact: true }).click();
  await expect(card).toContainText("Added");
  await expect(card).toContainText("bKash balance from the SMS saved: ৳500.00");

  await page.goto("/accounts");
  await expect(page.getByRole("link", { name: /bKash/ })).toContainText("৳500");
  // The cash out moved ৳2,000 into the Cash wallet (৳10,000 from the earlier tests).
  await expect(page.getByRole("link", { name: /Cash wallet/ })).toContainText("৳12,000");

  // Pasting the same message again recognises it.
  await paste();
  await expect(page.getByRole("listitem", { name: /Cash out/ })).toContainText("Already added");

  await page.goto("/transactions?q=Cash out");
  await expect(page.getByRole("button", { name: /Cash out fee/ })).toContainText("10:05 am");
  await expect(page.getByLabel("Added from SMS").first()).toBeVisible();
});

test("a balance update holds, older entries don't move it, and an entry can stay out of it", async ({ page }) => {
  await signIn(page);
  await page.goto("/accounts");
  await page.getByRole("link", { name: /bKash/ }).click();
  await expect(page.getByRole("heading", { name: "bKash" })).toBeVisible();

  // bKash shows ৳500; the app says ৳800.
  await page.getByRole("button", { name: "Update balance" }).click();
  const update = page.getByRole("dialog", { name: "Update bKash balance" });
  await update.getByLabel("Balance in BDT").fill("800");
  await expect(update.getByText("+৳300")).toBeVisible();
  await update.getByRole("button", { name: /Update balance/ }).click();
  await expect(page.getByText("bKash balance updated")).toBeVisible();
  await expect(page.getByText("Current balance").locator("..")).toContainText("৳800");
  await expect(page.getByRole("heading", { name: "Balance updates" })).toBeVisible();

  const addExpense = async (amount: string, date: string | null, options: { keepOut?: boolean; expectHistory?: boolean } = {}) => {
    await page.getByRole("button", { name: "Transaction", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "New transaction" });
    await sheet.getByLabel(/Amount/).fill(amount);
    await sheet.getByRole("radio", { name: "Food" }).click();
    if (date) await sheet.getByLabel("Date").fill(date);
    if (options.expectHistory) await expect(sheet.getByText(/already includes this date/)).toBeVisible();
    if (options.keepOut) await sheet.getByRole("switch", { name: "Don't change the balance" }).click();
    await sheet.getByRole("button", { name: /Add expense/ }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  };

  // Last year's spending, added now: the update already includes it.
  await addExpense("150", "2025-06-01", { expectHistory: true });
  await expect(page.getByText("Current balance").locator("..")).toContainText("৳800");
  // Kept out of the balance on purpose.
  await addExpense("40", null, { keepOut: true });
  await expect(page.getByText("Current balance").locator("..")).toContainText("৳800");
  await expect(page.getByText("Not in balance").first()).toBeVisible();
  // Today's spending after the update moves it.
  await addExpense("150", null);
  await expect(page.getByText("Current balance").locator("..")).toContainText("৳650");
});

test("an SMS from a wallet with no account: create it right there, and the SMS sets its balance", async ({ page }) => {
  await signIn(page);
  await page.goto("/sms");
  await page.getByLabel("Transaction messages").fill(
    "Tk500.00 received from A/C:01712345678-9. Fee:Tk0, Your A/C Balance: Tk1,234.56 TxnId:5566778899 Date:20-SEP-26 02:30:45 pm.",
  );
  await page.getByRole("button", { name: "Analyze" }).click();
  const card = page.getByRole("listitem", { name: /Received from 01712345678/ });
  await card.getByRole("button", { name: "Add Rocket account" }).click();

  const form = page.getByRole("dialog", { name: "New account" });
  await expect(form.getByLabel("Name")).toHaveValue("Rocket");
  // What it held just before this message: 1,234.56 − 500.
  await expect(form.getByPlaceholder("0")).toHaveValue("734.56");
  await form.getByRole("button", { name: "Add account" }).click();

  await expect(card).toContainText("Added");
  await expect(card).toContainText("Rocket balance from the SMS saved: ৳1,234.56");
  await page.goto("/accounts");
  await expect(page.getByRole("link", { name: /Rocket/ })).toContainText("৳1,234.56");
});

test("an SMS for something typed in by hand: confirm it's the same one and the balance follows the SMS", async ({ page }) => {
  await signIn(page);
  // An SMS time is to the minute; the previous test's balance update was
  // entered moments ago, so the message is stamped the minute after it.
  const sent = new Date(Date.now() + 60_000);
  const part = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dhaka", ...options }).format(sent);
  const smsDate = part({ day: "2-digit", month: "2-digit", year: "numeric" });
  const smsTime = part({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

  // bKash is at ৳650 from the previous test; ৳50 typed in by hand.
  await page.goto("/transactions");
  await page.getByRole("button", { name: "New transaction" }).last().click();
  const sheet = page.getByRole("dialog", { name: "New transaction" });
  await sheet.getByLabel(/Amount/).fill("50");
  await sheet.getByRole("radio", { name: "Shopping" }).click();
  await sheet.getByRole("combobox").first().click();
  await page.getByRole("option", { name: /bKash/ }).click();
  await sheet.getByRole("button", { name: /Add expense/ }).click();
  await expect(page.getByText("Expense added")).toBeVisible();

  await page.goto("/sms");
  await page.getByLabel("Transaction messages").fill(
    `Payment Tk 50.00 to Daraz (01712345678) successful. Balance Tk 600.00. TrxID BJXE2E0001 at ${smsDate} ${smsTime}`,
  );
  await page.getByRole("button", { name: "Analyze" }).click();
  const card = page.getByRole("listitem", { name: /Daraz/ });
  await card.getByRole("button", { name: "Add", exact: true }).click();
  await expect(card).toContainText("Possible duplicate");
  await card.getByRole("button", { name: "It’s the same one" }).click();
  await expect(page.getByText("Linked to the recorded transaction")).toBeVisible();
  await expect(card).toContainText("bKash balance from the SMS saved: ৳600.00");

  await page.goto("/accounts");
  await expect(page.getByRole("link", { name: /bKash/ })).toContainText("৳600");
});

test("income in dollars counts at your rate, in the total and the month; budgets are Personal and Family", async ({ page }) => {
  await signIn(page);
  const origin = new URL(page.url()).origin;
  const account = async (name: string, currency: string, openingBalance: string) => {
    const response = await page.request.post("/api/accounts", {
      headers: { Origin: origin },
      data: { name, type: "OTHER", currency, openingBalance, openingDate: "2025-01-01", icon: null, color: null, isActive: true },
    });
    expect(response.ok()).toBe(true);
  };
  await account("Dollar wallet", "USD", "0");
  await account("Taka wallet", "BDT", "1000");

  // Income usually arrives in dollars.
  await page.goto("/settings");
  await page.getByLabel("Income usually in").click();
  await page.getByRole("option", { name: /USD/ }).click();
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page.getByText("Preferences saved")).toBeVisible();

  // A new income starts on the dollar account.
  await page.goto("/dashboard");
  await page.keyboard.press("n");
  const sheet = page.getByRole("dialog", { name: "New transaction" });
  await sheet.getByRole("radio", { name: "Income" }).click();
  await expect(sheet.getByLabel("Received in")).toContainText("Dollar wallet");
  await sheet.getByLabel(/Amount/).fill("100");
  await sheet.getByRole("radio", { name: "Freelance" }).click();
  await sheet.getByRole("button", { name: /Add income/ }).click();
  await expect(page.getByText("Income added")).toBeVisible();

  // Without a rate the dollars are shown but not counted; with one they are.
  const total = page.getByRole("region", { name: "Total balance" });
  await expect(total).toContainText("$100 in USD (not counted)");
  const before = await total.locator(".sr-only").first().innerText();
  await total.getByLabel(/Add the USD rate/).fill("120");
  await total.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("USD now counts in your totals")).toBeVisible();
  await expect(total).toContainText("$1 = ৳120");
  const taka = (text: string) => Number(text.replace(/[^\d.-]/g, ""));
  await expect.poll(async () => taka(await total.locator(".sr-only").first().innerText())).toBe(taka(before) + 12000);
  // The month's income includes them, converted.
  await expect(page.getByRole("region", { name: /summary/ })).toContainText("incl. $100");

  // Budgets: a bill paid for the family counts against the Family budget.
  await page.goto("/budgets");
  const family = page.getByRole("region", { name: "Family budget" });
  await family.getByRole("button", { name: "Set budget" }).click();
  await page.getByRole("dialog", { name: "Family budget" }).getByLabel(/Monthly budget/).fill("50000");
  await page.getByRole("button", { name: "Save budget" }).click();
  await expect(page.getByText("Family: ৳50,000 a month")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.keyboard.press("n");
  await sheet.getByLabel(/Amount/).fill("3000");
  await sheet.getByRole("radio", { name: "Bills" }).click();
  await sheet.getByRole("radiogroup", { name: "Spent for" }).getByRole("radio", { name: "Family" }).click();
  await sheet.getByRole("button", { name: /Add expense/ }).click();
  await expect(page.getByText("Expense added")).toBeVisible();
  await expect(family).toContainText("/ ৳50,000");
  await expect(family.getByRole("listitem").filter({ hasText: "Bills" })).toContainText("৳3,000");
  await expect(page.getByRole("region", { name: "Personal budget" })).toContainText("Set budget");
});

test("a wrong password on the lock screen says how many tries are left", async ({ page }) => {
  await signIn(page);
  await page.goto("/budgets");
  await page.getByRole("button", { name: "Lock now" }).first().click();
  await expect(page).toHaveURL(/\/lock\?next=%2Fbudgets/);
  await page.getByPlaceholder("Password").fill("not-it");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "4 tries left" })).toBeVisible();
  await page.getByPlaceholder("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page).toHaveURL(/\/budgets/);
});

test("signing out ends the session", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Sign out" }).first().click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/transactions");
  await expect(page).toHaveURL(/\/login/);
});

test("@mobile phone layout: tab bar and bottom-sheet entry", async ({ page }) => {
  await signIn(page);
  // An account of its own, so the form shows even when this test runs alone.
  const created = await page.request.post("/api/accounts", {
    headers: { Origin: new URL(page.url()).origin },
    data: {
      name: "Phone wallet",
      type: "CASH",
      currency: "BDT",
      openingBalance: "500",
      openingDate: new Date().toISOString().slice(0, 10),
      icon: null,
      color: "green",
      isActive: true,
    },
  });
  expect(created.ok()).toBe(true);
  await page.goto("/dashboard");
  const tabs = page.getByRole("navigation", { name: "Main" }).last();
  const tabBar = page.locator("[data-tabbar]");
  await expect(tabs.getByRole("link", { name: "Activity" })).toBeVisible();
  await tabs.getByRole("button", { name: "New transaction" }).tap();
  const sheet = page.getByRole("dialog", { name: "New transaction" });
  await expect(sheet).toBeVisible();
  const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(hasOverflow).toBe(false);

  // Opening the sheet doesn't put the cursor in a field: the keyboard waits for a tap.
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("INPUT");
  // Typing a decimal point is fine (it once crashed the app), and the tab bar
  // steps aside while typing.
  await sheet.getByLabel(/Amount/).tap();
  await page.keyboard.type("5543.");
  await expect(sheet.getByLabel(/Amount/)).toHaveValue("5543.");
  await expect(tabBar).toBeHidden();
  await page.keyboard.type("51");
  await expect(sheet.getByRole("button", { name: /Add expense · ৳5,543\.51/ })).toBeVisible();
  await expect(page.getByText("Something went wrong")).toHaveCount(0);

  // A tap on the handle closes the sheet; the page stays usable.
  await sheet.locator("[data-vaul-handle]").tap();
  await expect(sheet).toBeHidden();
  await expect(tabBar).toBeVisible();
  await tabs.getByRole("link", { name: "Activity" }).tap();
  await expect(page).toHaveURL(/\/transactions/);

  // The same amount as an account's balance update.
  await page.goto(`/accounts/${(await created.json()).id}`);
  await page.getByRole("button", { name: "Update balance" }).first().tap();
  const update = page.getByRole("dialog");
  await update.getByLabel(/Balance in/).tap();
  await page.keyboard.type("5543.51");
  await expect(update.getByRole("button", { name: /Update balance · ৳5,543\.51/ })).toBeVisible();
  await expect(page.getByText(/Something went wrong|couldn.t load|hit a problem/)).toHaveCount(0);
});
