import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { Client } from "pg";
import { asUser, connectDriveApi, driveOf, person, signIn, signInApi, steerGoogle } from "./auth";
import { E2E_DATABASE_URL } from "./env";

const account = (name: string, openingBalance: string) => ({ name, type: "CASH", currency: "BDT", openingBalance, openingDate: "2025-01-01", icon: null, color: null, isActive: true });

test("backup and restore: download a backup, change things, and put it all back from the file", async ({ page }, testInfo) => {
  await signIn(page, person("archivist", "Archivist"));
  const origin = new URL(page.url()).origin;
  const post = (url: string, data: unknown) => page.request.post(url, { headers: { Origin: origin }, data });

  // A small ledger: an account, an expense, a balance update.
  const wallet = (await (await post("/api/accounts", account("Wallet", "5000"))).json()).id as string;
  const food = ((await (await page.request.get("/api/categories")).json()).categories as Array<{ id: string; name: string; kind: string }>).find(
    (c) => c.kind === "EXPENSE" && c.name === "Food",
  )!.id;
  const expense = { type: "EXPENSE", amount: "1200", date: "2026-09-10", accountId: wallet, categoryId: food, scope: "PERSONAL", description: "Groceries", notes: null };
  expect((await post("/api/transactions", { transaction: expense })).status()).toBe(201);
  expect((await post(`/api/accounts/${wallet}/balance`, { balance: "3500", date: "2026-09-20" })).status()).toBe(201);

  // Download the backup.
  await page.goto("/settings");
  const section = page.locator("#backup");
  const [download] = await Promise.all([page.waitForEvent("download"), section.getByRole("link", { name: "Download a backup" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^hisab-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const saved = testInfo.outputPath("backup.json");
  await download.saveAs(saved);
  const file = JSON.parse(readFileSync(saved, "utf8"));
  expect(file).toMatchObject({ format: "hisab-backup", version: 1 });
  expect([file.accounts.length, file.transactions.length, file.balanceUpdates.length, file.categories.length]).toEqual([1, 1, 1, 20]);
  expect(file.accounts[0]).toMatchObject({ name: "Wallet", balance: "3500.00" });

  // Things change afterwards: the account is renamed, more is spent, another account appears.
  expect((await page.request.put(`/api/accounts/${wallet}`, { headers: { Origin: origin }, data: account("Renamed", "5000") })).status()).toBe(200);
  expect((await post("/api/transactions", { transaction: { ...expense, amount: "999", date: "2026-09-25", description: "After the backup" } })).status()).toBe(201);
  expect((await post("/api/accounts", account("Second", "1"))).status()).toBe(201);

  // A file that isn't a backup is turned away at once.
  const notABackup = testInfo.outputPath("notes.json");
  writeFileSync(notABackup, JSON.stringify({ hello: "world" }));
  await section.getByLabel("Backup file to restore").setInputFiles(notABackup);
  await expect(section.getByRole("alert")).toHaveText("This isn't a Hisab backup file.");
  // …and so is one that was tampered with, saying where.
  const tampered = testInfo.outputPath("tampered.json");
  writeFileSync(tampered, JSON.stringify({ ...file, transactions: [{ ...file.transactions[0], amount: "-5" }] }));
  await section.getByLabel("Backup file to restore").setInputFiles(tampered);
  await expect(section.getByRole("alert")).toContainText("transaction 1: amount must be greater than zero");

  // Restore the real one.
  await section.getByLabel("Backup file to restore").setInputFiles(saved);
  const dialog = page.getByRole("dialog", { name: "Restore this backup?" });
  await expect(dialog).toContainText("1 account, 1 transaction, 1 balance update");
  await expect(dialog).toContainText("replaces everything");
  await dialog.getByRole("button", { name: "Replace my data" }).click();
  const done = page.getByRole("dialog", { name: "Backup restored" });
  await expect(done).toContainText("Every account balance matches the backup.");
  await done.getByRole("button", { name: "Open Hisab" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  // Everything is as it was when the backup was made.
  const accounts = (await (await page.request.get("/api/accounts")).json()).accounts as Array<{ name: string; balance: string }>;
  expect(accounts.map((a) => [a.name, a.balance])).toEqual([["Wallet", "3500.00"]]);
  const transactions = (await (await page.request.get("/api/transactions")).json()).items as Array<{ description: string }>;
  expect(transactions.map((t) => t.description)).toEqual(["Groceries"]);
  await page.goto("/accounts");
  await expect(page.getByRole("link", { name: /Wallet/ })).toContainText("৳3,500");
});

test("restore over the API: only with the word, only your own account, all or nothing", async ({ request }) => {
  const alice = (await signInApi(request, person("backup-alice", "Alice"))).cookie!;
  const bob = (await signInApi(request, person("backup-bob", "Bob"))).cookie!;
  const call = async (cookie: string, method: string, url: string, data?: unknown) => {
    const response = await request.fetch(url, { method, headers: asUser(cookie), data: data === undefined ? undefined : JSON.stringify(data) });
    return { status: response.status(), headers: response.headers(), body: await response.json().catch(() => ({})) };
  };

  const hers = (await call(alice, "POST", "/api/accounts", account("Alice savings", "70000"))).body.id as string;
  expect((await call(bob, "POST", "/api/accounts", account("Bob cash", "10"))).status).toBe(201);

  // A backup is a file download of your own data, never cached.
  const backup = await call(alice, "GET", "/api/backup");
  expect(backup.status).toBe(200);
  expect(backup.headers["content-disposition"]).toMatch(/attachment; filename="hisab-backup-\d{4}-\d{2}-\d{2}\.json"/);
  expect(backup.headers["cache-control"]).toContain("no-store");
  expect(backup.body.accounts.map((a: { name: string }) => a.name)).toEqual(["Alice savings"]);
  const bobs = await call(bob, "GET", "/api/backup");
  expect(JSON.stringify(bobs.body)).not.toContain("Alice");

  // Not without saying so.
  expect((await call(bob, "POST", "/api/backup/restore", backup.body)).status).toBe(400);
  expect((await call(bob, "POST", "/api/backup/restore", { confirm: "yes", backup: backup.body })).status).toBe(400);
  // A file that points at her real account can't be restored — and changes nothing of his.
  const pointing = { ...bobs.body, transactions: [{ type: "INCOME", amount: "5", date: "2026-09-01", accountId: hers, categoryId: bobs.body.categories.find((c: { kind: string }) => c.kind === "INCOME").id, countAsExpense: false, description: "", affectsBalance: true, createdAt: new Date().toISOString() }] };
  const refused = await call(bob, "POST", "/api/backup/restore", { confirm: "REPLACE", backup: pointing });
  expect(refused.status).toBe(400);
  expect(refused.body.error).toContain("transaction 1 is on an account that isn't in the backup");
  expect((await call(bob, "GET", "/api/accounts")).body.accounts.map((a: { name: string }) => a.name)).toEqual(["Bob cash"]);

  // Restoring her file into his account gives him a copy; hers is untouched and stays hers.
  const copied = await call(bob, "POST", "/api/backup/restore", { confirm: "REPLACE", backup: backup.body });
  expect(copied.status).toBe(200);
  expect(copied.body).toMatchObject({ accounts: 1, transactions: 0, balanceDifferences: [] });
  const his = (await call(bob, "GET", "/api/accounts")).body.accounts as Array<{ id: string; name: string }>;
  expect(his.map((a) => a.name)).toEqual(["Alice savings"]);
  expect(his[0].id).not.toBe(hers);
  expect((await call(bob, "GET", `/api/accounts/${hers}`)).status).toBe(404);
  expect((await call(alice, "GET", `/api/accounts/${hers}`)).status).toBe(200);
  expect((await call(alice, "GET", `/api/accounts/${his[0].id}`)).status).toBe(404);
});

test("Google Drive: connect, back up, restore from a backup there, and disconnect", async ({ page, request }) => {
  const who = person("drive-user", "Drive User");
  await signIn(page, who);
  const origin = new URL(page.url()).origin;
  const post = (url: string, data: unknown) => page.request.post(url, { headers: { Origin: origin }, data });
  const wallet = (await (await post("/api/accounts", account("Wallet", "5000"))).json()).id as string;
  const food = ((await (await page.request.get("/api/categories")).json()).categories as Array<{ id: string; name: string; kind: string }>).find(
    (c) => c.kind === "EXPENSE" && c.name === "Food",
  )!.id;
  const spend = (amount: string, description: string) =>
    post("/api/transactions", { transaction: { type: "EXPENSE", amount, date: "2026-09-10", accountId: wallet, categoryId: food, scope: "PERSONAL", description, notes: null } });
  await spend("1000", "Groceries");

  // Connect: off to Google and back, with a first backup made at once.
  await page.goto("/settings");
  const section = page.locator("#backup");
  await expect(section).toContainText("Connect your Google Drive and Hisab keeps a backup there on its own");
  await section.getByRole("link", { name: "Connect Google Drive" }).click();
  await expect(page).toHaveURL(/\/settings\?drive=connected#backup$/);
  await expect(section.getByRole("status")).toHaveText("Google Drive is connected. Hisab will keep a backup there from now on.");
  await expect(section).toContainText(/Last backup \d+ \w+ \d{4}/);
  expect((await driveOf(request, who)).files.map((f) => f.appProperties.transactions)).toEqual(["1"]);

  // Back up now, after recording more.
  await spend("200", "Tea");
  await section.getByRole("button", { name: "Back up now" }).click();
  await expect(page.getByText("Backed up to Google Drive")).toBeVisible();
  expect((await driveOf(request, who)).files).toHaveLength(2);

  // A mistake, then back to the backup from before it.
  await spend("4000", "A mistake");
  await section.getByRole("button", { name: "Restore from Google Drive" }).click();
  const list = page.getByRole("dialog", { name: "Backups in your Google Drive" });
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expect(list.getByRole("listitem").first()).toContainText("1 account, 2 transactions");
  await list.getByRole("listitem").first().getByRole("button", { name: "Restore" }).click();
  const confirm = page.getByRole("dialog", { name: "Restore this backup?" });
  await expect(confirm).toContainText("1 account, 2 transactions");
  await confirm.getByRole("button", { name: "Replace my data" }).click();
  const done = page.getByRole("dialog", { name: "Backup restored" });
  await expect(done).toContainText("Every account balance matches the backup.");
  await done.getByRole("button", { name: "Open Hisab" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  const descriptions = async () => ((await (await page.request.get("/api/transactions")).json()).items as Array<{ description: string }>).map((t) => t.description).sort();
  expect(await descriptions()).toEqual(["Groceries", "Tea"]);
  // What was there before the restore — the mistake included — was saved first.
  expect((await driveOf(request, who)).files.map((f) => f.appProperties.transactions).sort()).toEqual(["1", "2", "3"]);

  // Google withdraws the permission: Hisab says so and offers to connect again.
  await steerGoogle(request, `revoke?sub=${who.sub}`);
  await page.goto("/settings");
  await section.getByRole("button", { name: "Back up now" }).click();
  await expect(page.getByText("Google Drive needs to be connected again.").first()).toBeVisible();
  await expect(section.getByRole("alert")).toContainText("Connect it again to carry on backing up");
  await section.getByRole("link", { name: "Connect Google Drive again" }).click();
  await expect(page).toHaveURL(/drive=connected/);
  await expect(section.getByRole("button", { name: "Back up now" })).toBeVisible();

  // Disconnect: the permission goes back to Google, the backups stay in Drive.
  await section.getByRole("button", { name: "Disconnect" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByText("Google Drive disconnected")).toBeVisible();
  await expect(section.getByRole("link", { name: "Connect Google Drive" })).toBeVisible();
  // (Four: reconnecting saved the ledger as it stood after the restore.)
  const after = await driveOf(request, who);
  expect([after.grants, after.files.length]).toEqual([0, 4]);
});

test("Google Drive: the day's backup is made on its own, after a page has loaded", async ({ page, request }) => {
  const who = person("drive-daily", "Daily");
  await signIn(page, who);
  const origin = new URL(page.url()).origin;
  const post = (url: string, data: unknown) => page.request.post(url, { headers: { Origin: origin }, data });
  expect((await post("/api/accounts", account("Wallet", "100"))).status()).toBe(201);
  await page.goto("/settings");
  await page.locator("#backup").getByRole("link", { name: "Connect Google Drive" }).click();
  await expect(page).toHaveURL(/drive=connected/);
  expect((await driveOf(request, who)).files).toHaveLength(1);

  // More is recorded; opening pages the same day uploads nothing more.
  expect((await post("/api/accounts", account("Second wallet", "5"))).status()).toBe(201);
  await page.goto("/accounts");
  await page.goto("/dashboard");
  expect((await driveOf(request, who)).files).toHaveLength(1);

  // A day later, simply opening the app saves the new state.
  const database = new Client({ connectionString: E2E_DATABASE_URL });
  await database.connect();
  await database.query(`UPDATE "DriveBackup" SET "lastAttemptAt" = now() - interval '25 hours' WHERE "userId" = (SELECT "id" FROM "User" WHERE "googleSub" = $1)`, [who.sub]);
  await database.end();
  await page.goto("/accounts");
  await expect.poll(async () => (await driveOf(request, who)).files.map((f) => f.appProperties.accounts).sort(), { timeout: 15_000 }).toEqual(["1", "2"]);
});

test("Google Drive: only your own Drive, only with the permission, and gone with the account", async ({ request }) => {
  const who = person("drive-api", "Drive Api");
  const cookie = (await signInApi(request, who)).cookie!;
  const call = async (method: string, url: string, data?: unknown) => {
    const response = await request.fetch(url, { method, headers: asUser(cookie), data: data === undefined ? undefined : JSON.stringify(data) });
    return { status: response.status(), body: await response.json().catch(() => ({})) };
  };
  expect((await call("POST", "/api/accounts", account("Savings", "70000"))).status).toBe(201);

  // Nothing works before Drive is connected.
  expect((await call("GET", "/api/drive")).body).toMatchObject({ available: true, connected: false });
  expect((await call("POST", "/api/drive/backups")).status).toBe(409);
  expect((await call("GET", "/api/drive/backups")).status).toBe(409);

  // Cancelled at Google, the permission left unticked, or another Google account: not connected.
  expect(await connectDriveApi(request, cookie, { ...who, deny: true })).toBe("/settings?drive=cancelled#backup");
  expect(await connectDriveApi(request, cookie, { ...who, withoutDrive: true })).toBe("/settings?drive=not-granted#backup");
  expect(await connectDriveApi(request, cookie, person("someone-else", "Someone Else"))).toBe("/settings?drive=other-account#backup");
  expect((await call("GET", "/api/drive")).body.connected).toBe(false);
  expect((await driveOf(request, person("someone-else", "Someone Else"))).files).toEqual([]);

  // Drive not switched on for the app: connected, and the problem is named.
  await steerGoogle(request, "trouble?kind=disabled");
  expect(await connectDriveApi(request, cookie, who)).toBe("/settings?drive=problem#backup");
  expect((await call("GET", "/api/drive")).body).toMatchObject({ connected: true, problem: expect.stringMatching(/Google Drive API must be enabled/) });
  await steerGoogle(request, "trouble");

  expect(await connectDriveApi(request, cookie, who)).toBe("/settings?drive=connected#backup");
  const status = (await call("GET", "/api/drive")).body;
  expect(status).toMatchObject({ connected: true, needsReconnect: false, problem: null });
  expect(JSON.stringify(status)).not.toMatch(/refresh|token/i);
  const { backups } = (await call("GET", "/api/drive/backups")).body as { backups: Array<{ id: string; summary: { accounts: number } }> };
  expect(backups.map((b) => b.summary.accounts)).toEqual([1]);

  // A restore needs the word, and a backup that is in this person's Drive.
  expect((await call("POST", "/api/drive/restore", { fileId: backups[0].id })).status).toBe(400);
  const other = person("drive-other", "Other");
  const otherCookie = (await signInApi(request, other)).cookie!;
  const asOther = async (method: string, url: string, data?: unknown) => (await request.fetch(url, { method, headers: asUser(otherCookie), data: data === undefined ? undefined : JSON.stringify(data) })).status();
  expect(await connectDriveApi(request, otherCookie, other)).toBe("/settings?drive=connected#backup");
  expect(await asOther("POST", "/api/drive/restore", { confirm: "REPLACE", fileId: backups[0].id })).toBe(502);
  expect((await call("POST", "/api/drive/restore", { confirm: "REPLACE", fileId: backups[0].id })).body).toMatchObject({ accounts: 1, balanceDifferences: [] });

  // Deleting the account removes Hisab's backups from the person's Drive and hands the permission back.
  expect((await driveOf(request, who)).files.length).toBeGreaterThan(0);
  expect((await call("DELETE", "/api/account", { confirm: "DELETE" })).status).toBe(200);
  expect(await driveOf(request, who)).toMatchObject({ files: [], grants: 0 });
});
