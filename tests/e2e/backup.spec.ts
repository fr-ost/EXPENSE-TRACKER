import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { asUser, person, signIn, signInApi } from "./auth";

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
