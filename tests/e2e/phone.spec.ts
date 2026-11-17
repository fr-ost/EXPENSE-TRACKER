import { expect, test, type APIRequestContext } from "@playwright/test";
import { asUser, person, signIn, signInApi } from "./auth";

/**
 * Automatic SMS import, from the Android app's side of the wire: a phone is
 * linked with a one-time code, hands in messages with its own token, and can
 * do nothing else with it.
 */

const JSON_HEADERS = { "Content-Type": "application/json" };
/** The Android app's requests: its token, and no cookies at all. */
const asPhone = (token: string) => ({ ...JSON_HEADERS, Authorization: `Bearer ${token}`, Cookie: "no_cookies=1" });

const CASH_OUT = "Cash Out Tk 2,000.00 to 01912345678 successful. Fee Tk 37.00. Balance Tk 500.00. TrxID BIT9CD5E6F at 28/09/2026 10:05";
const NAGAD = "Money Received.\nAmount: Tk 1,000.00\nSender: 01712345678\nRef: lunch\nTxnID: 7A1B2C3D\nBalance: Tk 1,500.00\n28/09/2026 09:15";
const OTP = "Your bKash verification code is 123456. Never share your code and PIN with anyone.";
const RECEIVED = new Date("2026-09-28T10:06:00+06:00").getTime();

const account = (name: string, extra = {}) => ({ name, type: "CASH", currency: "BDT", openingBalance: "0", openingDate: "2025-01-01", icon: null, color: null, isActive: true, ...extra });

/** Link a phone as the Android app does, and return its token. */
async function linkPhone(request: APIRequestContext, cookie: string, name = "Pixel 8", ip = "198.51.100.7") {
  const started = await request.post("/api/devices/link", { headers: asUser(cookie) });
  expect(started.status()).toBe(200);
  const { code, expiresInSeconds } = await started.json();
  expect(expiresInSeconds).toBe(600);
  const collected = await request.post("/api/devices/token", {
    headers: { ...JSON_HEADERS, "X-Forwarded-For": ip, Cookie: "no_cookies=1" },
    data: JSON.stringify({ code, name, appVersion: "1.0.5" }),
  });
  expect(collected.status(), await collected.text()).toBe(200);
  const { token } = await collected.json();
  return { code, token: token as string };
}

async function setUp(request: APIRequestContext, key: string, name: string) {
  const { cookie } = await signInApi(request, person(key, name));
  for (const body of [account("Cash", { openingBalance: "1000" }), account("bKash", { type: "MOBILE_WALLET", openingBalance: "2537" })]) {
    expect((await request.post("/api/accounts", { headers: asUser(cookie!), data: JSON.stringify(body) })).status()).toBe(201);
  }
  return cookie!;
}

test("a linked phone hands in messages; clear ones are added, unclear ones wait", async ({ request }) => {
  const cookie = await setUp(request, "phone-owner", "Phone Owner");
  const { token } = await linkPhone(request, cookie);

  const handedIn = await request.post("/api/devices/inbox", {
    headers: asPhone(token),
    data: JSON.stringify({
      appVersion: "1.0.5",
      messages: [
        { text: CASH_OUT, sender: "bKash", receivedAt: RECEIVED },
        { text: OTP, sender: "bKash", receivedAt: RECEIVED + 60_000 },
        { text: NAGAD, sender: "NAGAD", receivedAt: RECEIVED + 120_000 },
      ],
    }),
  });
  expect(handedIn.status(), await handedIn.text()).toBe(200);
  expect(await handedIn.json()).toEqual({
    results: [{ status: "added", title: "Moved ৳2,000 · Cash out", detail: "bKash · fee ৳37 · balance ৳500" }, { status: "ignored" }, { status: "review" }],
    waiting: 1,
  });

  // The ledger has the transfer and its fee, and the wallet shows what the message said.
  const ledger = await (await request.get("/api/transactions", { headers: asUser(cookie) })).json();
  expect(ledger.items.map((t: { description: string }) => t.description).sort()).toEqual(["Cash out", "Cash out fee"]);
  const accounts = (await (await request.get("/api/accounts", { headers: asUser(cookie) })).json()).accounts as Array<{ name: string; balance: string }>;
  expect(accounts.find((a) => a.name === "bKash")?.balance).toBe("500.00");

  // Handing the same messages in again changes nothing.
  const again = await request.post("/api/devices/inbox", {
    headers: asPhone(token),
    data: JSON.stringify({ messages: [{ text: CASH_OUT, sender: "bKash", receivedAt: RECEIVED }, { text: NAGAD, sender: "NAGAD", receivedAt: RECEIVED + 120_000 }] }),
  });
  expect(await again.json()).toEqual({ results: [{ status: "exists" }, { status: "review" }], waiting: 1 });
  expect((await (await request.get("/api/transactions", { headers: asUser(cookie) })).json()).total).toBe(2);

  // The phone can ask whether it is still linked…
  const self = await request.get("/api/devices/self", { headers: asPhone(token) });
  expect(await self.json()).toEqual({ linked: true, waiting: 1 });
  // …and unlink itself; then its token is nobody's.
  expect((await request.delete("/api/devices/self", { headers: asPhone(token) })).status()).toBe(200);
  expect((await request.get("/api/devices/self", { headers: asPhone(token) })).status()).toBe(401);
  expect((await request.post("/api/devices/inbox", { headers: asPhone(token), data: JSON.stringify({ messages: [{ text: OTP, sender: "x", receivedAt: RECEIVED }] }) })).status()).toBe(401);
  expect((await (await request.get("/api/devices", { headers: asUser(cookie) })).json()).devices).toEqual([]);
});

test("a phone's token hands messages in and does nothing else", async ({ request, browser }) => {
  const cookie = await setUp(request, "token-owner", "Token Owner");
  const { token, code } = await linkPhone(request, cookie);

  // It is not a session: no page and no other API route answers to it.
  for (const url of ["/api/accounts", "/api/transactions", "/api/categories", "/api/settings", "/api/backup", "/api/devices", "/api/sms/inbox"]) {
    expect((await request.get(url, { headers: asPhone(token) })).status(), url).toBe(401);
  }
  expect((await request.post("/api/devices/link", { headers: asPhone(token) })).status()).toBe(401);
  const context = await browser.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
  const page = await context.newPage();
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
  await context.close();

  // Its answers say what became of each message, never anything else in the ledger.
  const empty = await request.post("/api/devices/inbox", { headers: asPhone(token), data: JSON.stringify({ messages: [{ text: OTP, sender: "bKash", receivedAt: RECEIVED }] }) });
  expect(await empty.json()).toEqual({ results: [{ status: "ignored" }], waiting: 0 });

  // A code is spent once collected, and a code is never a token.
  const reused = await request.post("/api/devices/token", { headers: { ...JSON_HEADERS, "X-Forwarded-For": "198.51.100.8" }, data: JSON.stringify({ code, name: "Copycat" }) });
  expect(reused.status()).toBe(400);
  expect((await request.get("/api/devices/self", { headers: asPhone(code) })).status()).toBe(401);

  // Requests the Android app would never send are refused.
  const inbox = (headers: Record<string, string>, body: unknown) => request.post("/api/devices/inbox", { headers, data: typeof body === "string" ? body : JSON.stringify(body) });
  const good = { messages: [{ text: OTP, sender: "bKash", receivedAt: RECEIVED }] };
  expect((await inbox(JSON_HEADERS, good)).status()).toBe(401);
  expect((await inbox({ ...JSON_HEADERS, Authorization: "Bearer not-a-token" }, good)).status()).toBe(401);
  expect((await inbox({ ...JSON_HEADERS, Authorization: `Basic ${token}` }, good)).status()).toBe(401);
  expect((await inbox({ ...asPhone(token), "Content-Type": "text/plain" }, good)).status()).toBe(415);
  expect((await inbox(asPhone(token), "{")).status()).toBe(400);
  expect((await inbox(asPhone(token), { messages: [] })).status()).toBe(400);
  expect((await inbox(asPhone(token), { messages: Array.from({ length: 26 }, () => good.messages[0]) })).status()).toBe(400);
  expect((await inbox(asPhone(token), { messages: [{ text: "x".repeat(2001), sender: "bKash", receivedAt: RECEIVED }] })).status()).toBe(400);
  expect((await inbox(asPhone(token), { messages: [{ text: OTP, sender: "bKash", receivedAt: "yesterday" }] })).status()).toBe(400);
  // Another site can't make a signed-in browser hand anything in, or collect a token.
  expect((await inbox({ ...asPhone(token), "Sec-Fetch-Site": "cross-site" }, good)).status()).toBe(403);
  expect((await request.post("/api/devices/token", { headers: { ...JSON_HEADERS, Origin: "https://evil.example" }, data: JSON.stringify({ code, name: "x" }) })).status()).toBe(403);
});

test("a client that keeps sending bad link codes is made to wait; others are not", async ({ request }) => {
  const guess = (ip: string) =>
    request.post("/api/devices/token", { headers: { ...JSON_HEADERS, "X-Forwarded-For": ip }, data: JSON.stringify({ code: "x".repeat(43), name: "Guesser" }) });
  for (let i = 0; i < 20; i++) expect((await guess("203.0.113.150")).status()).toBe(400);
  const blocked = await guess("203.0.113.150");
  expect(blocked.status()).toBe(429);
  expect(Number(blocked.headers()["retry-after"])).toBeGreaterThan(0);

  // Someone else links their phone meanwhile.
  const cookie = await setUp(request, "patient", "Patient Person");
  await linkPhone(request, cookie, "Their phone", "203.0.113.151");
});

test("waiting messages are reviewed on Import SMS, and phones are managed in Settings", async ({ page, request }) => {
  const who = person("reviewer", "Reviewer");
  await signIn(page, who);
  const cookie = (await page.context().cookies()).filter((c) => c.name.includes("hisab_session")).map((c) => `${c.name}=${c.value}`).join("; ");
  for (const body of [account("Cash", { openingBalance: "1000" }), account("bKash", { type: "MOBILE_WALLET", openingBalance: "2537" })]) {
    expect((await request.post("/api/accounts", { headers: asUser(cookie), data: JSON.stringify(body) })).status()).toBe(201);
  }
  const { token } = await linkPhone(request, cookie, "Pixel 8");
  await request.post("/api/devices/inbox", {
    headers: asPhone(token),
    data: JSON.stringify({ messages: [{ text: CASH_OUT, sender: "bKash", receivedAt: RECEIVED }, { text: NAGAD, sender: "NAGAD", receivedAt: RECEIVED + 120_000 }] }),
  });

  // The Overview says something is waiting, and so does the menu.
  await page.goto("/dashboard");
  await page.getByRole("link", { name: /1 message from your phone needs a look/ }).click();
  await expect(page).toHaveURL(/\/sms$/);
  await expect(page.getByRole("status").filter({ hasText: "1 message from your phone needs a look" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" }).first().getByLabel("1 waiting")).toBeVisible();

  // The message is there to review, read exactly as a pasted one: it needs a Nagad account.
  const card = page.getByRole("listitem", { name: /Received from 01712345678/ });
  await expect(card).toBeVisible();
  await expect(card.getByText("No account for Nagad yet.")).toBeVisible();
  await expect(card.getByText("28 Sep 2026 · 9:15 am")).toBeVisible();

  // Not wanted: it stops waiting, here and on the server.
  await card.getByRole("button", { name: /dismiss|remove/i }).click();
  await expect(card).toBeHidden();
  await expect.poll(async () => (await (await request.get("/api/sms/inbox", { headers: asUser(cookie) })).json()).total).toBe(0);
  await page.reload();
  await expect(page.getByText(/from your phone need/)).toBeHidden();

  // Settings lists the phone; removing it kills its token.
  await page.goto("/settings#sms-phones");
  const phones = page.getByRole("list", { name: "Linked phones" });
  await expect(phones.getByText("Pixel 8")).toBeVisible();
  await expect(phones.getByText(/last message/)).toBeVisible();
  // A desktop browser can't be linked: it says where to go instead.
  await expect(page.getByText("To set it up, open this page in the Hisab app on your Android phone.")).toBeVisible();
  await phones.getByRole("button", { name: "Remove" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText("Pixel 8 removed")).toBeVisible();
  await expect(phones).toBeHidden();
  expect((await request.get("/api/devices/self", { headers: asPhone(token) })).status()).toBe(401);
});

test("on an Android phone, Settings offers to set this phone up @mobile", async ({ page }) => {
  await signIn(page, person("android-user", "Android User"));
  await page.goto("/settings#sms-phones");
  const setUpButton = page.getByRole("button", { name: "Set up on this phone" });
  await expect(setUpButton).toBeVisible();

  // Pressing it asks for a one-time code to hand to the app (which this browser doesn't have).
  const [linked] = await Promise.all([page.waitForResponse((response) => response.url().endsWith("/api/devices/link")), setUpButton.click()]);
  expect(linked.status()).toBe(200);
  expect((await linked.json()).code).toMatch(/^[\w-]{43}$/);

  // Back from a phone without the app: the page says so.
  await page.goto("/settings?phone=missing#sms-phones");
  await expect(page.getByText("The Hisab app isn't on this phone yet.")).toBeVisible();
  await page.goto("/settings?phone=linked#sms-phones");
  await expect(page.getByText("This phone is linked.")).toBeVisible();
});
