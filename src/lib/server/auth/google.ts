import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, errors as joseErrors, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { NextRequest } from "next/server";

/**
 * Sign in with Google: the OpenID Connect authorization-code flow with PKCE.
 *
 *   1. `beginSignIn` sends the browser to Google with a `state`, a `nonce`
 *      and a PKCE challenge, and returns what must be remembered meanwhile
 *      (kept in a short-lived HttpOnly cookie).
 *   2. Google sends the browser back with a one-time code. `completeSignIn`
 *      checks the `state`, swaps the code for an ID token (server to server,
 *      with the client secret and the PKCE verifier) and verifies the token.
 *
 * The app learns who signed in from the verified ID token alone; it never
 * sees a password and keeps no Google token.
 */

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
}

/** The OAuth client from the environment; null until both variables are set. */
export function googleConfig(): GoogleConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export interface Endpoints {
  authorization: string;
  token: string;
  revoke: string;
  jwks: string;
  issuers: string[];
  /** Google Drive: file metadata, and file contents. */
  drive: string;
  driveUpload: string;
}

const GOOGLE: Endpoints = {
  authorization: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  revoke: "https://oauth2.googleapis.com/revoke",
  jwks: "https://www.googleapis.com/oauth2/v3/certs",
  issuers: ["https://accounts.google.com", "accounts.google.com"],
  drive: "https://www.googleapis.com/drive/v3",
  driveUpload: "https://www.googleapis.com/upload/drive/v3",
};

/**
 * The one Drive permission Hisab asks for: its own hidden folder in the
 * person's Drive. It can't list, read or change any other file.
 */
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";

let warnedAboutStandIn = false;

/**
 * Google's endpoints — or, for the end-to-end tests only, a local stand-in
 * (GOOGLE_TEST_ORIGIN, see tests/e2e/fake-google.mjs). Never set that
 * variable on a real deployment: whoever runs that server can sign in as
 * anyone.
 */
export function googleEndpoints(): Endpoints {
  const test = process.env.GOOGLE_TEST_ORIGIN?.trim().replace(/\/+$/, "");
  if (!test) return GOOGLE;
  if (!warnedAboutStandIn) {
    warnedAboutStandIn = true;
    console.warn(`[auth] GOOGLE_TEST_ORIGIN is set: sign-in is NOT checked by Google but by ${test}. For tests only.`);
  }
  return {
    authorization: `${test}/o/oauth2/v2/auth`,
    token: `${test}/token`,
    revoke: `${test}/revoke`,
    jwks: `${test}/oauth2/v3/certs`,
    issuers: [test],
    drive: `${test}/drive/v3`,
    driveUpload: `${test}/upload/drive/v3`,
  };
}

const endpoints = googleEndpoints;

/**
 * The address people use to reach the app ("https://hisab.example"): APP_URL
 * when set, otherwise what the platform's proxy says the request arrived at.
 */
export function publicOrigin(request: Pick<NextRequest, "headers" | "nextUrl">): string {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  const first = (value: string | null) => value?.split(",")[0]?.trim() || null;
  const host = first(request.headers.get("x-forwarded-host")) ?? first(request.headers.get("host")) ?? request.nextUrl.host;
  const protocol = first(request.headers.get("x-forwarded-proto")) ?? request.nextUrl.protocol.replace(":", "");
  return `${protocol === "http" ? "http" : "https"}://${host}`;
}

/**
 * Where Google sends the browser back to. It must be listed, exactly, among
 * the OAuth client's authorised redirect URIs.
 */
export function callbackUrl(request: Pick<NextRequest, "headers" | "nextUrl">): string {
  return `${publicOrigin(request)}/api/auth/google/callback`;
}

/** What one sign-in must remember between leaving for Google and coming back. */
export interface PendingSignIn {
  state: string;
  nonce: string;
  /** PKCE: only whoever started this sign-in can finish it. */
  verifier: string;
}

/** Who Google says signed in. */
export interface GoogleProfile {
  /** Google's permanent id for the account. */
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

/** A sign-in that could not be completed; `reason` is for the log, never shown. */
export class SignInError extends Error {
  constructor(public readonly reason: string) {
    super(`Sign-in failed: ${reason}`);
    this.name = "SignInError";
  }
}

const randomToken = () => randomBytes(32).toString("base64url");

/**
 * Send the browser to Google. By default to sign in; with `drive`, to ask the
 * signed-in person for permission to keep backups in their Drive — and for a
 * token that lets the server do so later without them (`access_type=offline`).
 */
export function beginSignIn(
  config: GoogleConfig,
  redirectUri: string,
  options: { drive?: { email: string | null } } = {},
): { url: string; pending: PendingSignIn } {
  const pending: PendingSignIn = { state: randomToken(), nonce: randomToken(), verifier: randomToken() };
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: options.drive ? `openid email ${DRIVE_SCOPE}` : "openid email profile",
    state: pending.state,
    nonce: pending.nonce,
    code_challenge: createHash("sha256").update(pending.verifier).digest("base64url"),
    code_challenge_method: "S256",
  });
  if (options.drive) {
    params.set("access_type", "offline");
    // Google only hands out the lasting token when the consent screen is shown.
    params.set("prompt", "consent");
    params.set("include_granted_scopes", "true");
    // The same Google account they are signed in to Hisab with.
    if (options.drive.email) params.set("login_hint", options.drive.email);
  } else {
    // Always ask which account: a shared browser shouldn't sign the last person in again.
    params.set("prompt", "select_account");
  }
  const url = new URL(endpoints().authorization);
  url.search = params.toString();
  return { url: url.toString(), pending };
}

function sameToken(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Google's request to our token endpoint must not hang a sign-in forever. */
const TOKEN_TIMEOUT_MS = 10_000;

/** What Google granted when the browser came back. */
export interface Grant {
  profile: GoogleProfile;
  /** The permissions actually given (a person can untick some on Google's screen). */
  scopes: string[];
  /** For acting later without the person; only sent when asked for (`drive`). */
  refreshToken: string | null;
}

export async function completeSignIn(
  config: GoogleConfig,
  redirectUri: string,
  pending: PendingSignIn,
  returned: { code: string | null; state: string | null },
): Promise<GoogleProfile> {
  return (await completeAuthorization(config, redirectUri, pending, returned)).profile;
}

export async function completeAuthorization(
  config: GoogleConfig,
  redirectUri: string,
  pending: PendingSignIn,
  returned: { code: string | null; state: string | null },
): Promise<Grant> {
  // The answer must belong to the sign-in this browser started.
  if (!returned.state || !sameToken(returned.state, pending.state)) throw new SignInError("state mismatch");
  if (!returned.code) throw new SignInError("no code");

  let response: Response;
  try {
    response = await fetch(endpoints().token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: returned.code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: redirectUri,
        code_verifier: pending.verifier,
      }),
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new SignInError("token endpoint unreachable");
  }
  if (!response.ok) throw new SignInError(`token endpoint answered ${response.status}`);
  const body = (await response.json().catch(() => null)) as { id_token?: unknown; scope?: unknown; refresh_token?: unknown } | null;
  if (typeof body?.id_token !== "string") throw new SignInError("no ID token");

  return {
    profile: await verifyIdToken(body.id_token, { clientId: config.clientId, nonce: pending.nonce }),
    scopes: typeof body.scope === "string" ? body.scope.split(/\s+/).filter(Boolean) : [],
    refreshToken: typeof body.refresh_token === "string" && body.refresh_token ? body.refresh_token : null,
  };
}

const remoteKeys = new Map<string, JWTVerifyGetKey>();

/** Google's signing keys, fetched once and refreshed when they rotate. */
function signingKeys(url: string): JWTVerifyGetKey {
  let keys = remoteKeys.get(url);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(url), { timeoutDuration: 5_000 });
    remoteKeys.set(url, keys);
  }
  return keys;
}

export interface VerifyOptions {
  /** Our OAuth client id: the token must have been issued for this app. */
  clientId: string;
  /** The nonce sent with the sign-in request; null only for tokens that never had one. */
  nonce: string | null;
  /** Tests: keys and issuers to trust instead of Google's. */
  keys?: JWTVerifyGetKey;
  issuers?: string[];
}

/**
 * Check an ID token and return who it is for. Throws SignInError unless it is
 * signed by Google (RS256, a current key), issued by Google, for this app,
 * not expired, and carries the nonce of this sign-in.
 */
export async function verifyIdToken(token: string, options: VerifyOptions): Promise<GoogleProfile> {
  const { issuers, jwks } = endpoints();
  let payload: Record<string, unknown>;
  try {
    const verified = await jwtVerify(token, options.keys ?? signingKeys(jwks), {
      algorithms: ["RS256"],
      issuer: options.issuers ?? issuers,
      audience: options.clientId,
      requiredClaims: ["sub", "exp", "iat"],
      clockTolerance: 30,
      // A token that has been around for a while is not from this sign-in.
      maxTokenAge: "10 minutes",
    });
    payload = verified.payload;
  } catch (error) {
    throw new SignInError(error instanceof joseErrors.JOSEError ? `ID token: ${error.code}` : "ID token could not be checked");
  }

  // One audience only: a token shared with another client isn't just ours.
  if (Array.isArray(payload.aud) && payload.aud.length !== 1) throw new SignInError("ID token: several audiences");
  if (options.nonce !== null && (typeof payload.nonce !== "string" || !sameToken(payload.nonce, options.nonce))) {
    throw new SignInError("ID token: nonce mismatch");
  }
  const sub = payload.sub;
  if (typeof sub !== "string" || sub.length === 0 || sub.length > 255) throw new SignInError("ID token: no subject");

  const text = (value: unknown, max: number) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);
  return {
    sub,
    email: text(payload.email, 320),
    // Google sends a boolean; some providers send the string "true".
    emailVerified: payload.email_verified === true || payload.email_verified === "true",
    name: text(payload.name, 200),
  };
}
