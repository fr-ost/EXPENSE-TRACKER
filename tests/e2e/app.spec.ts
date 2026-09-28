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
  await card.getByRole("button", { name: "Add", exact: true }).click();
  await expect(card).toContainText("Added");
  // bKash 2,537 − 2,000 − 37 fee = 500, which is what the SMS says.
  await expect(card).toContainText("balance matches the SMS");

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
  await page.goto("/dashboard");
  const tabs = page.getByRole("navigation", { name: "Main" }).last();
  await expect(tabs.getByRole("link", { name: "Activity" })).toBeVisible();
  await tabs.getByRole("button", { name: "New transaction" }).click();
  await expect(page.getByRole("dialog", { name: "New transaction" })).toBeVisible();
  const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(hasOverflow).toBe(false);
});
