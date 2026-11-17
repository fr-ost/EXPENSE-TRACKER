import { expect, type APIRequestContext, type APIResponse, type Page } from "@playwright/test";
import { E2E_PORT, FAKE_GOOGLE_ORIGIN } from "./env";

export const APP_ORIGIN = `http://localhost:${E2E_PORT}`;

/** A Google account, as the stand-in for Google will vouch for it. */
export interface Identity {
  sub: string;
  email: string;
  name: string;
  emailVerified?: boolean;
  /** The person unticks the Drive permission on Google's screen. */
  withoutDrive?: boolean;
  /** The person presses Cancel at Google. */
  deny?: boolean;
  /** Make the stand-in issue an ID token the app must refuse. */
  tamper?: "audience" | "nonce" | "issuer" | "expired" | "signature";
}

export function person(key: string, name: string, extra: Partial<Identity> = {}): Identity {
  return { sub: `google-${key}`, email: `${key}@example.com`, name, ...extra };
}

/** The main person in the app tests. */
export const RAFI = person("rafi", "Rafi Tester");

const identityCookie = (who: Identity) => Buffer.from(JSON.stringify(who), "utf8").toString("base64url");

/** Choose who the stand-in for Google will say is signing in from this browser. */
export async function actAs(page: Page, who: Identity) {
  await page.context().addCookies([{ name: "fake_google_user", value: identityCookie(who), url: FAKE_GOOGLE_ORIGIN }]);
}

/** On the sign-in page: Continue with Google, and wait to be back in the app. */
export async function continueWithGoogle(page: Page, who: Identity = RAFI) {
  await actAs(page, who);
  await page.getByRole("link", { name: "Continue with Google" }).click();
  await page.waitForURL((url) => url.origin === APP_ORIGIN && !url.pathname.startsWith("/login") && !url.pathname.startsWith("/api/"));
}

/** Sign in through the page, as a person would. */
export async function signIn(page: Page, who: Identity = RAFI) {
  await page.goto("/login");
  await continueWithGoogle(page, who);
}

/** A Cookie header that carries nothing the app knows. */
const NO_COOKIES = "no_cookies=1";

/** Every cookie a response sets, as "name=value" pairs (empty values are deletions). */
function cookiesSet(response: APIResponse): string[] {
  return response
    .headersArray()
    .filter((header) => header.name.toLowerCase() === "set-cookie")
    .map((header) => header.value.split(";")[0]);
}

export interface ApiSignIn {
  /** Where the app sent the browser at the end. */
  location: string;
  /** "Cookie" header for the new session, or null when nobody was signed in. */
  cookie: string | null;
  /** The raw Set-Cookie header of the session cookie. */
  setCookie: string | null;
}

/**
 * The same sign-in without a browser: start at the app, "be" the person at
 * the stand-in for Google, and bring its answer back. `alter` can change the
 * address Google sends the browser back to (to forge or replay an answer).
 */
export async function signInApi(
  request: APIRequestContext,
  who: Identity,
  options: { ip?: string; next?: string; alter?: (callback: URL) => void; withoutPending?: boolean } = {},
): Promise<ApiSignIn> {
  // Every request names its cookies: the test client would otherwise replay whatever it was last sent.
  const from: Record<string, string> = options.ip ? { "X-Forwarded-For": options.ip } : {};
  const start = await request.get(`/api/auth/google?next=${encodeURIComponent(options.next ?? "/dashboard")}`, {
    maxRedirects: 0,
    headers: { ...from, Cookie: NO_COOKIES },
  });
  expect(start.status(), "sign-in start").toBe(303);
  const pending = cookiesSet(start).find((cookie) => cookie.includes("hisab_signin="));
  expect(pending, "pending sign-in cookie").toBeTruthy();

  const atGoogle = await request.get(start.headers().location, { maxRedirects: 0, headers: { Cookie: `fake_google_user=${identityCookie(who)}` } });
  expect(atGoogle.status(), `stand-in for Google: ${await atGoogle.text()}`).toBe(302);
  const callback = new URL(atGoogle.headers().location);
  options.alter?.(callback);

  const back = await request.get(`${callback.pathname}${callback.search}`, {
    maxRedirects: 0,
    headers: { ...from, Cookie: options.withoutPending ? NO_COOKIES : pending! },
  });
  expect(back.status(), "sign-in callback").toBe(303);
  const session = cookiesSet(back).find((cookie) => cookie.includes("hisab_session=") && !cookie.endsWith("="));
  const setCookie = back.headersArray().find((h) => h.name.toLowerCase() === "set-cookie" && h.value.includes("hisab_session="))?.value ?? null;
  return { location: back.headers().location, cookie: session ?? null, setCookie: session ? setCookie : null };
}

/**
 * Connect Google Drive without a browser: start at the app as the signed-in
 * person, allow it at the stand-in for Google as `who`, and bring the answer
 * back. Returns where the app sent the browser at the end.
 */
export async function connectDriveApi(request: APIRequestContext, cookie: string, who: Identity & { withoutDrive?: boolean }): Promise<string> {
  const start = await request.get("/api/drive/connect", { maxRedirects: 0, headers: { Cookie: cookie } });
  expect(start.status(), "Drive connect start").toBe(303);
  const pending = cookiesSet(start).find((c) => c.includes("hisab_signin="));
  const atGoogle = await request.get(start.headers().location, { maxRedirects: 0, headers: { Cookie: `fake_google_user=${identityCookie(who)}` } });
  expect(atGoogle.status(), `stand-in for Google: ${await atGoogle.text()}`).toBe(302);
  const callback = new URL(atGoogle.headers().location);
  const back = await request.get(`${callback.pathname}${callback.search}`, { maxRedirects: 0, headers: { Cookie: `${cookie}; ${pending}` } });
  expect(back.status(), "Drive connect callback").toBe(303);
  return back.headers().location;
}

/** What the stand-in for Google holds for a person: the files in Hisab's Drive folder and the permissions granted. */
export async function driveOf(request: APIRequestContext, who: Identity) {
  const response = await request.post(`${FAKE_GOOGLE_ORIGIN}/__test/files?sub=${encodeURIComponent(who.sub)}`);
  return (await response.json()) as { files: Array<{ id: string; name: string; appProperties: Record<string, string> }>; grants: number };
}

/** Steer the stand-in: withdraw a person's permission, or make Drive fail ("down" | "disabled" | "full" | ""). */
export const steerGoogle = (request: APIRequestContext, path: string) => request.post(`${FAKE_GOOGLE_ORIGIN}/__test/${path}`);

/** Headers for an API call as a signed-in browser on the app's own pages. */
export const asUser = (cookie: string) => ({ Origin: APP_ORIGIN, "Content-Type": "application/json", Cookie: cookie });
