import { expect, test } from "@playwright/test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { E2E_PASSWORD, E2E_PORT } from "./env";

const ORIGIN = `http://localhost:${E2E_PORT}`;
const PUBLIC_ROUTES = new Set(["/api/auth/login", "/api/auth/logout", "/api/health"]);

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
  const crossSite = await request.post("/api/auth/login", {
    headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
    data: { password: E2E_PASSWORD },
  });
  expect(crossSite.status()).toBe(403);

  const formPost = await request.post("/api/auth/login", {
    headers: { Origin: ORIGIN, "Content-Type": "application/x-www-form-urlencoded" },
    data: `password=${E2E_PASSWORD}`,
  });
  expect(formPost.status()).toBe(415);
});

test("session cookie is HttpOnly, Secure, SameSite and host-only", async ({ request }) => {
  const response = await request.post("/api/auth/login", {
    headers: { Origin: ORIGIN, "Content-Type": "application/json", "X-Real-IP": "198.51.100.1" },
    data: { password: E2E_PASSWORD },
  });
  expect(response.status()).toBe(200);
  const setCookie = response.headers()["set-cookie"];
  expect(setCookie).toMatch(/^__Host-hisab_session=/);
  expect(setCookie).toMatch(/HttpOnly/i);
  expect(setCookie).toMatch(/Secure/i);
  expect(setCookie).toMatch(/SameSite=lax/i);
  expect(setCookie).not.toMatch(/Domain=/i);
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

test("post-login redirects cannot leave the site", async ({ page }) => {
  await page.goto("/login?next=//evil.example/steal");
  await page.getByPlaceholder("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  expect(new URL(page.url()).host).toBe(`localhost:${E2E_PORT}`);
});

test("the health check is public but reveals nothing", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: "ok" });
});

test("password guessing is rate limited, and the limit hides whether a guess was right", async ({ request }) => {
  const attempt = (password: string) =>
    request.post("/api/auth/login", {
      headers: { Origin: ORIGIN, "Content-Type": "application/json", "X-Real-IP": "203.0.113.77" },
      data: { password },
    });
  for (let i = 0; i < 5; i++) expect((await attempt(`wrong-${i}`)).status()).toBe(401);
  const limited = await attempt("wrong-again");
  expect(limited.status()).toBe(429);
  expect(Number(limited.headers()["retry-after"])).toBeGreaterThan(0);
  // Even the correct password is refused while limited.
  expect((await attempt(E2E_PASSWORD)).status()).toBe(429);
});

test("invalid input is a 400 with field errors, never a server error", async ({ request }) => {
  const login = await request.post("/api/auth/login", {
    headers: { Origin: ORIGIN, "Content-Type": "application/json", "X-Real-IP": "198.51.100.9" },
    data: { password: E2E_PASSWORD },
  });
  const cookie = (login.headers()["set-cookie"] ?? "").split(";")[0];
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
});
