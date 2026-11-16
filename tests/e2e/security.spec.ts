import { expect, test } from "@playwright/test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { APP_ORIGIN as ORIGIN, asUser, continueWithGoogle, person, signInApi } from "./auth";
import { E2E_PORT } from "./env";

const PUBLIC_ROUTES = new Set(["/api/auth/google", "/api/auth/google/callback", "/api/auth/logout", "/api/health"]);

/** Every API route and the HTTP methods it exports, read from the filesystem. */
function apiRoutes(): Array<{ path: string; method: string }> {
  const root = path.join(process.cwd(), "src/app/api");
  const found: Array<{ path: string; method: string }> = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry === "route.ts") {
        const route = "/api/" + path.relative(root, dir).split(path.sep).join("/").replace(/\[(\w+)\]/g, "x");
        const source = readFileSync(full, "utf8");
        for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
          if (new RegExp(`export (const|async function) ${method}\\b`).test(source)) found.push({ path: route, method });
        }
      }
    }
  };
  walk(root);
  return found;
}

const routes = apiRoutes();

test("the route inventory is non-trivial", () => {
  expect(routes.length).toBeGreaterThan(25);
});

test("every protected API endpoint returns 401 without a session", async ({ request }) => {
  for (const { path: url, method } of routes.filter((r) => !PUBLIC_ROUTES.has(r.path))) {
    const response = await request.fetch(url, {
      method,
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      data: method === "GET" ? undefined : "{}",
    });
    expect(response.status(), `${method} ${url}`).toBe(401);
  }
});

test("every protected API endpoint rejects a forged session cookie (handler-level check)", async ({ request }) => {
  // A cookie is present, so the proxy lets the request through; each handler
  // must validate it against the database on its own.
  const cookie = "__Host-hisab_session=forged-token-value; hisab_session=forged-token-value";
  for (const { path: url, method } of routes.filter((r) => !PUBLIC_ROUTES.has(r.path))) {
    const response = await request.fetch(url, {
      method,
      headers: { Origin: ORIGIN, "Content-Type": "application/json", Cookie: cookie },
      data: method === "GET" ? undefined : "{}",
    });
    expect(response.status(), `${method} ${url}`).toBe(401);
  }
});

test("protected pages redirect to sign-in, even with a forged cookie", async ({ browser }) => {
  // Sent as a raw header: browsers won't store a __Host- cookie for plain http.
  const context = await browser.newContext({ extraHTTPHeaders: { Cookie: "__Host-hisab_session=forged-token-value" } });
  const page = await context.newPage();
  for (const url of ["/dashboard", "/transactions", "/accounts", "/budgets", "/recurring", "/reports", "/settings", "/lock"]) {
    await page.goto(url);
    await expect(page, url).toHaveURL(/\/login/);
  }
  await context.close();
});

test("cross-site and non-JSON writes are refused", async ({ request }) => {
  const { cookie } = await signInApi(request, person("csrf", "Csrf Tester"));
  const body = JSON.stringify({ name: "Sneaky", type: "CASH", currency: "BDT", openingBalance: "0", openingDate: "2025-01-01", icon: null, color: null, isActive: true });

  // Another site, riding on the signed-in browser's cookie.
  const crossSite: Array<Record<string, string>> = [
    { Origin: "https://evil.example", "Content-Type": "application/json", Cookie: cookie! },
    { "Sec-Fetch-Site": "cross-site", "Content-Type": "application/json", Cookie: cookie! },
    { "Sec-Fetch-Site": "same-site", "Content-Type": "application/json", Cookie: cookie! },
  ];
  for (const headers of crossSite) {
    expect((await request.post("/api/accounts", { headers, data: body })).status()).toBe(403);
    expect((await request.delete("/api/account", { headers, data: JSON.stringify({ confirm: "DELETE" }) })).status()).toBe(403);
  }
  expect((await request.post("/api/auth/logout", { headers: { Origin: "https://evil.example" } })).status()).toBe(403);

  // A plain HTML form can't post JSON.
  const formPost = await request.post("/api/accounts", {
    headers: { Origin: ORIGIN, "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie! },
    data: "name=Sneaky",
  });
  expect(formPost.status()).toBe(415);

  const accounts = await (await request.get("/api/accounts", { headers: asUser(cookie!) })).json();
  expect(accounts.accounts).toEqual([]);
});

test("session and sign-in cookies are HttpOnly, Secure, SameSite and host-only", async ({ request }) => {
  const start = await request.get("/api/auth/google", { maxRedirects: 0 });
  const pending = start.headers()["set-cookie"];
  const { setCookie } = await signInApi(request, person("cookie", "Cookie Tester"));
  for (const [cookie, name] of [
    [pending, "__Host-hisab_signin"],
    [setCookie!, "__Host-hisab_session"],
  ] as const) {
    expect(cookie).toMatch(new RegExp(`^${name}=`));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Path=\//i);
    expect(cookie).not.toMatch(/Domain=/i);
  }
  // The sign-in in progress is short-lived.
  expect(pending).toMatch(/Max-Age=600/i);
  // The browser is sent to Google with a state, a nonce and a PKCE challenge — never the client secret.
  const sent = new URL(start.headers().location);
  expect(Object.fromEntries(sent.searchParams)).toMatchObject({
    response_type: "code",
    scope: "openid email profile",
    code_challenge_method: "S256",
    redirect_uri: `${ORIGIN}/api/auth/google/callback`,
  });
  for (const key of ["state", "nonce", "code_challenge"]) expect(sent.searchParams.get(key)).toMatch(/^[\w-]{43}$/);
  expect(start.headers().location).not.toContain("secret");
});

test("a sign-in that Google didn't vouch for signs nobody in", async ({ request }) => {
  // Cancelled at Google.
  expect(await signInApi(request, person("quitter", "Quitter", { deny: true }))).toMatchObject({ location: "/login?error=cancelled", cookie: null });

  // ID tokens that are for another app, from another issuer, for another sign-in, expired, or not signed by Google.
  for (const tamper of ["audience", "issuer", "nonce", "expired", "signature"] as const) {
    const result = await signInApi(request, person(`forged-${tamper}`, "Forger", { tamper }));
    expect(result, tamper).toMatchObject({ location: "/login?error=failed", cookie: null });
  }

  // An answer that doesn't match the sign-in this browser started…
  const mallory = person("mallory", "Mallory");
  expect(await signInApi(request, mallory, { alter: (url) => url.searchParams.set("state", "x".repeat(43)) })).toMatchObject({ location: "/login?error=failed", cookie: null });
  expect(await signInApi(request, mallory, { alter: (url) => url.searchParams.set("code", "made-up-code") })).toMatchObject({ location: "/login?error=failed", cookie: null });
  // …or that arrives in a browser that never started one (the classic sign-in CSRF).
  expect(await signInApi(request, mallory, { withoutPending: true })).toMatchObject({ location: "/login?error=expired", cookie: null });

  // The sign-in page says so, without detail.
  expect(await (await request.get("/login?error=failed")).text()).toMatch(/Google sign-in didn(&#x27;|')t complete/);
  expect(await (await request.get("/login?error=cancelled")).text()).toContain("Sign-in was cancelled.");
});

test("security headers are set", async ({ request }) => {
  const response = await request.get("/login");
  const headers = response.headers();
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["strict-transport-security"]).toContain("max-age=");
  expect(headers["x-robots-tag"]).toContain("noindex");
  expect(headers["x-powered-by"]).toBeUndefined();
});

test("post-login redirects cannot leave the site", async ({ page, request }) => {
  await page.goto("/login?next=//evil.example/steal");
  await continueWithGoogle(page, person("redirect", "Redirect Tester"));
  expect(new URL(page.url()).host).toBe(`localhost:${E2E_PORT}`);
  expect(new URL(page.url()).pathname).toBe("/dashboard");

  for (const next of ["https://evil.example/", "//evil.example", "/\\evil.example", "/api/account", "/login"]) {
    const { location } = await signInApi(request, person("redirect", "Redirect Tester"), { next });
    expect(location, next).toBe("/dashboard");
  }
  expect((await signInApi(request, person("redirect", "Redirect Tester"), { next: "/reports?period=year" })).location).toBe("/reports?period=year");
});

test("app-install files are public; everything else still needs a session", async ({ request }) => {
  for (const [url, type] of [
    ["/manifest.webmanifest", "application/manifest+json"],
    ["/sw.js", "javascript"],
    ["/offline.html", "text/html"],
    ["/icons/icon-192.png", "image/png"],
    ["/icons/icon-maskable-512.png", "image/png"],
    ["/favicon.ico", "image/"],
    ["/icon.svg", "image/svg+xml"],
    ["/apple-icon.png", "image/png"],
  ] as const) {
    const response = await request.get(url, { maxRedirects: 0 });
    expect(response.status(), url).toBe(200);
    expect(response.headers()["content-type"], url).toContain(type);
  }
  const worker = await request.get("/sw.js");
  expect(worker.headers()["cache-control"]).toContain("no-cache");
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest).toMatchObject({ short_name: "Hisab", display: "standalone", start_url: "/dashboard" });
  expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === "maskable")).toBe(true);
});

test("shared SMS: only from the share sheet, only with a session, never in a URL the server sees", async ({ request }) => {
  const form = { text: "Payment Tk 350.00 to Daraz successful. TrxID X at 28/09/2026 12:00" };
  const signedOut = await request.post("/sms/share", { multipart: form, maxRedirects: 0 });
  expect(signedOut.status()).toBe(303);
  expect(signedOut.headers().location).toMatch(/\/login\?next=%2Fsms$/);

  const cookie = (await signInApi(request, person("sharer", "Sharer"))).cookie!;
  const shared = await request.post("/sms/share", { multipart: form, headers: { Cookie: cookie, "Sec-Fetch-Site": "none" }, maxRedirects: 0 });
  expect(shared.status()).toBe(303);
  expect(shared.headers().location).toBe(`/sms#shared=${encodeURIComponent(form.text)}`);

  const crossSite = await request.post("/sms/share", { multipart: form, headers: { Cookie: cookie, "Sec-Fetch-Site": "cross-site" }, maxRedirects: 0 });
  expect(crossSite.headers().location).toBe("/sms");
});

test("the health check is public but reveals nothing", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: "ok" });
});

test("a client that keeps failing to sign in is made to wait; others are not", async ({ request }) => {
  const who = person("limited", "Limited");
  const noisy = "203.0.113.77";
  for (let i = 0; i < 20; i++) {
    const failed = await signInApi(request, who, { ip: noisy, alter: (url) => url.searchParams.set("code", `guess-${i}`) });
    expect(failed.location).toBe("/login?error=failed");
  }
  // Now even a genuine sign-in from there waits…
  expect(await signInApi(request, who, { ip: noisy })).toMatchObject({ location: "/login?error=rate_limited", cookie: null });
  // …while the same person, and everyone else, can sign in from anywhere else.
  expect((await signInApi(request, who, { ip: "203.0.113.78" })).cookie).toBeTruthy();
});

test("invalid input is a 400 with field errors, never a server error", async ({ request }) => {
  const cookie = (await signInApi(request, person("typo", "Typo Tester"))).cookie!;
  const post = (data: string) =>
    request.post("/api/transactions", { headers: { Origin: ORIGIN, "Content-Type": "application/json", Cookie: cookie }, data });
  const expense = (overrides: Record<string, unknown>) =>
    JSON.stringify({
      transaction: { type: "EXPENSE", amount: "10", date: "2026-01-01", accountId: "x", categoryId: "y", scope: "PERSONAL", description: "", notes: null, ...overrides },
    });

  for (const [label, body] of [
    ["three decimals", expense({ amount: "1.234" })],
    ["negative", expense({ amount: "-5" })],
    ["exponent", expense({ amount: "1e9" })],
    ["impossible date", expense({ date: "2026-02-30" })],
    ["unknown type", expense({ type: "GIFT" })],
    ["unknown account", expense({})],
    ["malformed JSON", "{not json"],
  ] as const) {
    const response = await post(body);
    expect(response.status(), label).toBe(400);
    expect((await response.json()).error, label).toBeTruthy();
  }

  const huge = await post(expense({ notes: "x".repeat(100_000) }));
  expect(huge.status()).toBe(413);

  // Balance updates: bad input is a 400, an unknown account a 404.
  const headers = { Origin: ORIGIN, "Content-Type": "application/json", Cookie: cookie };
  for (const [label, data, status] of [
    ["not a number", { balance: "abc", date: "2026-01-01" }, 400],
    ["impossible date", { balance: "10", date: "2026-02-30" }, 400],
    ["bad time", { balance: "10", date: "2026-01-01", time: "25:00" }, 400],
    ["unknown account", { balance: "10", date: "2026-01-01" }, 404],
  ] as const) {
    const response = await request.post("/api/accounts/nope/balance", { headers, data });
    expect(response.status(), label).toBe(status);
  }
  expect((await request.get("/api/accounts/nope/balance?date=2026-02-30", { headers })).status()).toBe(400);
  expect((await request.get("/api/accounts/nope/balance?date=2026-01-01&time=9am", { headers })).status()).toBe(400);
  expect((await request.get("/api/accounts/nope/balance?date=2026-01-01", { headers })).status()).toBe(404);
  expect((await request.delete("/api/accounts/nope/balance/nope", { headers })).status()).toBe(404);
});
