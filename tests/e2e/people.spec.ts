import { expect, test, type APIRequestContext } from "@playwright/test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { actAs, asUser, person, signIn, signInApi } from "./auth";
import { E2E_OWNER_EMAIL } from "./env";

/**
 * More than one person uses the app. Each has their own ledger; nobody can
 * reach another's through any API route, whatever ids they send.
 */

/** Every API route with an id in its path, and the HTTP methods it exports. */
function routesWithIds(): Array<{ route: string; method: string }> {
  const root = path.join(process.cwd(), "src/app/api");
  const found: Array<{ route: string; method: string }> = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry === "route.ts") {
        const route = "/api/" + path.relative(root, dir).split(path.sep).join("/");
        if (!route.includes("[")) continue;
        const source = readFileSync(full, "utf8");
        for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
          if (new RegExp(`export (const|async function) ${method}\\b`).test(source)) found.push({ route, method });
        }
      }
    }
  };
  walk(root);
  return found;
}

const json = async (request: APIRequestContext, cookie: string, method: string, url: string, data?: unknown) => {
  const response = await request.fetch(url, { method, headers: asUser(cookie), data: data === undefined ? undefined : JSON.stringify(data) });
  return { status: response.status(), body: await response.json().catch(() => ({})) };
};

test("each person has their own ledger, and no API route reaches into another's", async ({ request }) => {
  const alice = (await signInApi(request, person("alice", "Alice")))!.cookie!;
  const bob = (await signInApi(request, person("bob", "Bob")))!.cookie!;
  const as = (cookie: string) => (method: string, url: string, data?: unknown) => json(request, cookie, method, url, data);
  const [a, b] = [as(alice), as(bob)];

  // Alice records a little of everything.
  const account = (name: string, extra = {}) => ({ name, type: "CASH", currency: "BDT", openingBalance: "5000", openingDate: "2025-01-01", icon: null, color: null, isActive: true, ...extra });
  const cash = (await a("POST", "/api/accounts", account("Alice cash"))).body.id as string;
  const bank = (await a("POST", "/api/accounts", account("Alice bank", { type: "BANK" }))).body.id as string;
  const categories = (await a("GET", "/api/categories")).body.categories as Array<{ id: string; name: string; kind: string }>;
  const food = categories.find((c) => c.kind === "EXPENSE" && c.name === "Food")!.id;
  const expense = { type: "EXPENSE", amount: "750", date: "2026-09-10", accountId: cash, categoryId: food, scope: "PERSONAL", description: "Alice's groceries", notes: null };
  const transaction = (await a("POST", "/api/transactions", { transaction: expense, idempotencyKey: "shared-key-1" })).body.id as string;
  const checkpoint = (await a("POST", `/api/accounts/${cash}/balance`, { balance: "4000", date: "2026-09-20" })).body.id as string;
  const rule = { type: "EXPENSE", amount: "9000", accountId: bank, categoryId: food, scope: "PERSONAL", description: "Alice's rent", notes: null, frequency: "MONTHLY", startDate: "2027-01-05" };
  const recurring = (await a("POST", "/api/recurring", { rule, backfill: false })).body.id as string;
  expect((await a("PUT", "/api/budgets", { scope: "PERSONAL", month: "2026-09", amount: "30000" })).status).toBe(200);
  // …and links her phone, which has a message waiting for her.
  const { code } = (await a("POST", "/api/devices/link")).body as { code: string };
  const collected = await request.post("/api/devices/token", { headers: { "Content-Type": "application/json", "X-Forwarded-For": "198.51.100.21" }, data: JSON.stringify({ code, name: "Alice's phone" }) });
  const phoneToken = (await collected.json()).token as string;
  const phone = ((await a("GET", "/api/devices")).body.devices as Array<{ id: string }>)[0].id;
  await request.post("/api/devices/inbox", {
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${phoneToken}` },
    data: JSON.stringify({ messages: [{ text: "Money Received.\nAmount: Tk 1,000.00\nSender: 01712345678\nTxnID: 7A1B2C3D\nBalance: Tk 1,500.00\n10/09/2026 09:15", sender: "NAGAD", receivedAt: Date.parse("2026-09-10T03:16:00Z") }] }),
  });
  const waitingId = ((await a("GET", "/api/sms/inbox")).body.messages as Array<{ id: string }>)[0].id;
  for (const id of [cash, bank, food, transaction, checkpoint, recurring, phone, waitingId]) expect(id, "Alice's setup").toBeTruthy();

  const snapshot = async () => ({
    accounts: (await a("GET", "/api/accounts")).body,
    categories: (await a("GET", "/api/categories")).body,
    transactions: (await a("GET", "/api/transactions")).body,
    recurring: (await a("GET", "/api/recurring")).body,
    budgets: (await a("GET", "/api/budgets?month=2026-09")).body,
    balance: (await a("GET", `/api/accounts/${cash}/balance?date=2026-09-28`)).body,
    phones: (await a("GET", "/api/devices")).body,
    waiting: (await a("GET", "/api/sms/inbox")).body,
  });
  const before = await snapshot();
  expect(before.transactions.total).toBe(1);

  // Bob starts with nothing of hers: his own empty ledger and his own starter categories.
  expect((await b("GET", "/api/accounts")).body.accounts).toEqual([]);
  expect((await b("GET", "/api/transactions")).body).toMatchObject({ total: 0, items: [] });
  expect((await b("GET", `/api/transactions?accountId=${cash}`)).body.total).toBe(0);
  expect((await b("GET", "/api/transactions?q=groceries")).body.total).toBe(0);
  expect((await b("GET", "/api/recurring")).body.recurring).toEqual([]);
  expect((await b("GET", "/api/devices")).body.devices).toEqual([]);
  expect((await b("GET", "/api/sms/inbox")).body).toEqual({ messages: [], total: 0 });
  // Her waiting message is not his to dismiss.
  expect((await b("DELETE", "/api/sms/inbox", { ids: [waitingId] })).body).toEqual({ dismissed: 0 });
  expect((await b("GET", "/api/budgets?month=2026-09")).body.lines.every((line: { budget: string | null }) => line.budget === null)).toBe(true);
  const bobCategories = (await b("GET", "/api/categories")).body.categories as Array<{ id: string; name: string; kind: string }>;
  expect(bobCategories.length).toBe(categories.length);
  expect(bobCategories.some((c) => categories.some((hers) => hers.id === c.id))).toBe(false);
  for (const format of ["csv", "xlsx"]) {
    const exported = await request.get(`/api/export/transactions?format=${format}`, { headers: asUser(bob) });
    expect(exported.status()).toBe(200);
    if (format === "csv") expect(await exported.text()).not.toContain("groceries");
  }

  // Every route that takes an id, with Alice's ids, as Bob: never a success, and nothing of hers changes.
  const ids: Record<string, string> = {
    "/api/accounts/[id]": `/api/accounts/${cash}`,
    "/api/accounts/[id]/balance": `/api/accounts/${cash}/balance`,
    "/api/accounts/[id]/balance/[checkpointId]": `/api/accounts/${cash}/balance/${checkpoint}`,
    "/api/categories/[id]": `/api/categories/${food}`,
    "/api/devices/[id]": `/api/devices/${phone}`,
    "/api/recurring/[id]": `/api/recurring/${recurring}`,
    "/api/recurring/[id]/skip": `/api/recurring/${recurring}/skip`,
    "/api/transactions/[id]": `/api/transactions/${transaction}`,
  };
  const bobCash = (await b("POST", "/api/accounts", account("Bob cash"))).body.id as string;
  const bobFood = bobCategories.find((c) => c.kind === "EXPENSE" && c.name === "Food")!.id;
  // A well-formed body for each write, so the only thing wrong is whose it is.
  const bodies: Record<string, unknown> = {
    "PUT /api/accounts/[id]": account("Taken over"),
    "POST /api/accounts/[id]/balance": { balance: "1", date: "2026-09-21" },
    "PUT /api/categories/[id]": { name: "Taken over", kind: "EXPENSE", defaultScope: "PERSONAL", icon: "user", color: "gray", isArchived: true },
    "PUT /api/recurring/[id]": { ...rule, accountId: bobCash, categoryId: bobFood },
    "PATCH /api/recurring/[id]": { isActive: false },
    "PUT /api/transactions/[id]": { ...expense, accountId: bobCash, categoryId: bobFood },
  };
  const tried = routesWithIds();
  expect(tried.length).toBeGreaterThanOrEqual(14);
  for (const { route, method } of tried) {
    // A new route with an id must be added here, so it is tried too.
    expect(ids[route], `add ${route} to this test`).toBeTruthy();
    const url = method === "GET" && route === "/api/accounts/[id]/balance" ? `${ids[route]}?date=2026-09-28` : ids[route];
    const { status, body } = await b(method, url, bodies[`${method} ${route}`]);
    expect(status, `${method} ${route} as someone else → ${JSON.stringify(body)}`).toBe(404);
    // "Not found" — never her balance, her figures, or that it exists.
    expect(JSON.stringify(body)).not.toMatch(/4000|5000|750|groceries|rent\b|in use|\d transactions?/i);
  }

  // His own entries can't point at her account or category either.
  const onHers = await b("POST", "/api/transactions", { transaction: { ...expense, categoryId: bobFood } });
  expect(onHers.status).toBe(400);
  const withHers = await b("POST", "/api/transactions", { transaction: { ...expense, accountId: bobCash } });
  expect(withHers.status).toBe(400);
  const toHers = await b("POST", "/api/transactions", {
    transaction: { type: "TRANSFER", amount: "10", date: "2026-09-10", accountId: bobCash, toAccountId: cash, toAmount: null, countAsExpense: false, categoryId: null, scope: null, description: "", notes: null },
  });
  expect(toHers.status).toBe(400);
  expect((await b("POST", "/api/recurring", { rule, backfill: false })).status).toBe(400);
  const sms = "Payment Tk 350.00 to Daraz (01712345678) successful. Balance Tk 150.00. TrxID BIU1EF7G8H at 28/09/2026 12:00";
  const imported = await b("POST", "/api/sms/import", {
    items: [{ text: sms, transaction: { ...expense, amount: "350", categoryId: bobFood }, balance: { accountId: cash, amount: "150" }, allowDuplicate: true }],
  });
  expect(imported.body.results[0].status).toBe("error");
  const linked = await b("POST", "/api/sms/import", {
    items: [{ text: sms, transaction: { ...expense, accountId: bobCash, categoryId: bobFood, amount: "350" }, sameAs: transaction }],
  });
  expect(linked.body.results[0].status).toBe("error");
  expect((await b("POST", "/api/sms/balance", { items: [{ text: "Your balance is Tk 9", balance: { accountId: cash, amount: "9" }, reportedAt: { date: "2026-09-27", time: null } }] })).status).toBe(400);

  // The same key or the same message is his own, not a way to find hers.
  const bobsTea = { ...expense, accountId: bobCash, categoryId: bobFood, amount: "20", description: "Bob's tea" };
  const sameKey = await b("POST", "/api/transactions", { transaction: bobsTea, idempotencyKey: "shared-key-1" });
  expect(sameKey.status).toBe(201);
  expect(sameKey.body.id).not.toBe(transaction);
  // …and what she chose for a description is not suggested to him.
  expect((await b("POST", "/api/sms/check", { items: [{ text: sms, description: "Alice's groceries" }] })).body.results).toEqual([{ existing: [], balanceSaved: false, learned: null }]);
  expect((await a("POST", "/api/sms/check", { items: [{ text: sms, description: "Alice's groceries" }] })).body.results[0].learned).toMatchObject({ accountId: cash, categoryId: food });

  expect(await snapshot()).toEqual(before);
  expect((await b("GET", "/api/transactions")).body.total).toBe(1);
});

test("the ledger from before Google sign-in goes to its owner's Google account, and to nobody else", async ({ request }) => {
  // A stranger signing in first gets a fresh account — in a new database there
  // is no earlier ledger, and OWNER_EMAIL alone gives nobody anything.
  const stranger = (await signInApi(request, person("stranger", "Stranger"))).cookie!;
  expect((await json(request, stranger, "GET", "/api/accounts")).body.accounts).toEqual([]);
  const owner = (await signInApi(request, { sub: "google-owner", email: E2E_OWNER_EMAIL, name: "Owner" })).cookie!;
  expect((await json(request, owner, "GET", "/api/accounts")).body.accounts).toEqual([]);
});

test("a new account starts in the browser's timezone", async ({ browser }) => {
  const context = await browser.newContext({ timezoneId: "Europe/London" });
  const page = await context.newPage();
  await actAs(page, person("londoner", "Londoner"));
  await page.goto("/login");
  const link = page.getByRole("link", { name: "Continue with Google" });
  // Once the page is live, the link carries the timezone.
  await expect(link).toHaveAttribute("href", /tz=Europe%2FLondon/);
  await link.click();
  await page.waitForURL(/\/dashboard/);
  await page.goto("/settings");
  await expect(page.getByLabel("Timezone")).toContainText("Europe/London");
  await context.close();
});

test("delete account: gone for good, for that person only", async ({ page, request }) => {
  // Anyone can read how, without signing in.
  const publicPage = await request.get("/delete-account", { maxRedirects: 0 });
  expect(publicPage.status()).toBe(200);
  expect(await publicPage.text()).toContain("Delete your Hisab account");

  const keeper = (await signInApi(request, person("keeper", "Keeper"))).cookie!;
  const account = { name: "Keeper cash", type: "CASH", currency: "BDT", openingBalance: "100", openingDate: "2025-01-01", icon: null, color: null, isActive: true };
  expect((await json(request, keeper, "POST", "/api/accounts", account)).status).toBe(201);

  const leaver = person("leaver", "Leaver");
  await signIn(page, leaver);
  const origin = new URL(page.url()).origin;
  expect((await page.request.post("/api/accounts", { headers: { Origin: origin }, data: { ...account, name: "Leaver cash" } })).status()).toBe(201);
  // Not without saying so.
  expect((await page.request.delete("/api/account", { headers: { Origin: origin }, data: {} })).status()).toBe(400);
  expect((await page.request.delete("/api/account", { headers: { Origin: origin }, data: { confirm: "delete" } })).status()).toBe(400);

  await page.goto("/settings");
  const section = page.locator("#delete-account");
  const button = section.getByRole("button", { name: "Delete my account" });
  await expect(button).toBeDisabled();
  await section.getByLabel("Type DELETE to continue").fill("DELETE");
  await button.click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete everything" }).click();
  await expect(page).toHaveURL(/\/login\?reason=deleted/);
  await expect(page.getByText("Your account and everything in it has been deleted.")).toBeVisible();

  // The session went with it, and signing in again starts from nothing.
  expect((await page.request.get("/api/accounts")).status()).toBe(401);
  await signIn(page, leaver);
  await expect(page.getByRole("link", { name: "Add your first account" })).toBeVisible();
  // Nobody else lost anything.
  expect((await json(request, keeper, "GET", "/api/accounts")).body.accounts.map((a: { name: string }) => a.name)).toEqual(["Keeper cash"]);
});

test("the PIN is each person's own, and wrong guesses are limited across devices", async ({ request }) => {
  const who = person("pinner", "Pinner");
  const first = (await signInApi(request, who)).cookie!;
  expect((await json(request, first, "PUT", "/api/settings/pin", { pin: "12" })).status).toBe(400);
  expect((await json(request, first, "PUT", "/api/settings/pin", { pin: "2468" })).status).toBe(200);
  // Changing or removing it needs the current PIN.
  expect((await json(request, first, "PUT", "/api/settings/pin", { pin: "1357" })).status).toBe(400);
  expect((await json(request, first, "DELETE", "/api/settings/pin", { currentPin: "0000" })).status).toBe(401);

  // A second device signs in: locked until the PIN, and it can't simply remove the PIN.
  const second = (await signInApi(request, who)).cookie!;
  expect((await json(request, second, "GET", "/api/accounts")).status).toBe(423);
  expect((await json(request, second, "PUT", "/api/settings/pin", { pin: "1111" })).status).toBe(423);
  expect((await json(request, second, "DELETE", "/api/account", { confirm: "DELETE" })).status).toBe(423);

  // Wrong PINs from both devices count together: four more, then a wait — for the right PIN too.
  for (const [cookie, left] of [
    [second, 3],
    [first, 2],
    [second, 1],
  ] as const) {
    const wrong = await json(request, cookie, "POST", "/api/auth/unlock", { pin: "0000" });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error).toContain(`${left} ${left === 1 ? "try" : "tries"} left`);
  }
  const fifth = await request.post("/api/auth/unlock", { headers: asUser(second), data: JSON.stringify({ pin: "0000" }) });
  expect(fifth.status()).toBe(429);
  expect(Number(fifth.headers()["retry-after"])).toBeGreaterThan(0);
  expect((await json(request, second, "POST", "/api/auth/unlock", { pin: "2468" })).status).toBe(429);
  expect((await json(request, second, "GET", "/api/accounts")).status).toBe(423);

  // Someone else is not locked out, and has no PIN to enter.
  const other = (await signInApi(request, person("other", "Other"))).cookie!;
  expect((await json(request, other, "GET", "/api/accounts")).status).toBe(200);
  expect((await json(request, other, "POST", "/api/auth/lock")).status).toBe(400);

  // Forgotten: having just signed in with Google, the PIN can be removed — which opens the app.
  expect((await json(request, second, "POST", "/api/auth/pin/reset")).status).toBe(200);
  expect((await json(request, second, "GET", "/api/accounts")).status).toBe(200);
});
