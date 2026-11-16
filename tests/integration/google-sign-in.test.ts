import { createHash } from "node:crypto";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWK } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SignInError, beginSignIn, callbackUrl, completeSignIn, googleConfig, publicOrigin, verifyIdToken } from "@/lib/server/auth/google";
import { decodePending, encodePending } from "@/lib/server/auth/pending";
import { prisma } from "@/lib/server/db";
import { listAccounts } from "@/lib/server/services/accounts";
import { DEFAULT_CATEGORIES } from "@/lib/server/services/categories";
import { signInWithGoogle } from "@/lib/server/services/users";
import { getSettings } from "@/lib/server/settings";
import { makeAccount, resetData, wipeDatabase } from "../support/fixtures";

const CLIENT_ID = "hisab-test.apps.googleusercontent.com";
const ISSUER = "https://accounts.google.com";
const NONCE = "nonce-of-this-sign-in-0123456789";

describe("Google ID tokens", () => {
  let privateKey: CryptoKey;
  let otherPrivateKey: CryptoKey;
  let publicJwk: JWK;
  let keys: ReturnType<typeof createLocalJWKSet>;

  beforeAll(async () => {
    const pair = await generateKeyPair("RS256", { extractable: true });
    privateKey = pair.privateKey;
    otherPrivateKey = (await generateKeyPair("RS256")).privateKey;
    publicJwk = { ...(await exportJWK(pair.publicKey)), kid: "key-1", alg: "RS256", use: "sig" };
    keys = createLocalJWKSet({ keys: [publicJwk] });
  });

  /** A token as Google would issue it, with anything overridden. */
  const token = (claims: Record<string, unknown> = {}, options: { key?: CryptoKey; expiresIn?: string; issuedAt?: number } = {}) =>
    new SignJWT({ sub: "google-user-1", email: "rafi@example.com", email_verified: true, name: "Rafi Ahmed", nonce: NONCE, ...claims })
      .setProtectedHeader({ alg: "RS256", kid: "key-1" })
      .setIssuer((claims.iss as string) ?? ISSUER)
      .setAudience((claims.aud as string | string[]) ?? CLIENT_ID)
      .setIssuedAt(options.issuedAt)
      .setExpirationTime(options.expiresIn ?? "1h")
      .sign(options.key ?? privateKey);

  const verify = (jwt: string, nonce: string | null = NONCE) => verifyIdToken(jwt, { clientId: CLIENT_ID, nonce, keys, issuers: [ISSUER] });
  const refused = (promise: Promise<unknown>) => expect(promise).rejects.toBeInstanceOf(SignInError);

  it("says who signed in", async () => {
    expect(await verify(await token())).toEqual({ sub: "google-user-1", email: "rafi@example.com", emailVerified: true, name: "Rafi Ahmed" });
    // Missing or odd profile fields are simply absent; an unverified address is reported as such.
    expect(await verify(await token({ email: undefined, name: "  ", email_verified: false }))).toEqual({
      sub: "google-user-1",
      email: null,
      emailVerified: false,
      name: null,
    });
  });

  it("refuses a token for another app, from another issuer, or with several audiences", async () => {
    await refused(verify(await token({ aud: "someone-else.apps.googleusercontent.com" })));
    await refused(verify(await token({ iss: "https://accounts.example.com" })));
    await refused(verify(await token({ aud: [CLIENT_ID, "another-client"] })));
  });

  it("refuses a token that has expired or has been around too long", async () => {
    const now = Math.floor(Date.now() / 1000);
    await refused(verify(await token({}, { issuedAt: now - 7200, expiresIn: "-1h" })));
    // Still within its hour, but not from a sign-in that just happened.
    await refused(verify(await token({}, { issuedAt: now - 20 * 60 })));
  });

  it("refuses a token from a different sign-in (nonce)", async () => {
    await refused(verify(await token({ nonce: "another-nonce" })));
    await refused(verify(await token({ nonce: undefined })));
    await refused(verify(await token(), "what-this-browser-sent"));
  });

  it("refuses a token Google didn't sign", async () => {
    // Signed with someone else's key.
    await refused(verify(await token({}, { key: otherPrivateKey })));
    // Altered after signing.
    const [head, body, signature] = (await token()).split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), sub: "someone-else" })).toString("base64url");
    await refused(verify(`${head}.${forged}.${signature}`));
    // Unsigned ("alg: none").
    const none = Buffer.from(JSON.stringify({ alg: "none", kid: "key-1" })).toString("base64url");
    await refused(verify(`${none}.${body}.`));
    // "Signed" with the public key as an HMAC secret — the classic algorithm mix-up.
    const secret = new TextEncoder().encode(JSON.stringify(publicJwk));
    const hmac = await new SignJWT({ sub: "google-user-1", nonce: NONCE })
      .setProtectedHeader({ alg: "HS256", kid: "key-1" })
      .setIssuer(ISSUER)
      .setAudience(CLIENT_ID)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(secret);
    await refused(verify(hmac));
    await refused(verify("not.a.token"));
    await refused(verify(""));
  });

  it("refuses a token without a subject", async () => {
    await refused(verify(await token({ sub: "" })));
    await refused(verify(await token({ sub: "x".repeat(300) })));
  });
});

describe("starting and finishing a sign-in", () => {
  const config = { clientId: CLIENT_ID, clientSecret: "secret" };
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("is off until both Google variables are set", () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    expect(googleConfig()).toBeNull();
    process.env.GOOGLE_CLIENT_ID = " id ";
    expect(googleConfig()).toBeNull();
    process.env.GOOGLE_CLIENT_SECRET = " secret\n";
    expect(googleConfig()).toEqual({ clientId: "id", clientSecret: "secret" });
  });

  it("sends the browser to Google with a state, a nonce and a PKCE challenge", () => {
    const { url, pending } = beginSignIn(config, "https://hisab.example/api/auth/google/callback");
    const sent = new URL(url);
    expect(`${sent.origin}${sent.pathname}`).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(sent.searchParams)).toEqual({
      client_id: CLIENT_ID,
      redirect_uri: "https://hisab.example/api/auth/google/callback",
      response_type: "code",
      scope: "openid email profile",
      state: pending.state,
      nonce: pending.nonce,
      code_challenge: createHash("sha256").update(pending.verifier).digest("base64url"),
      code_challenge_method: "S256",
      prompt: "select_account",
    });
    // Unguessable, and different every time.
    const again = beginSignIn(config, "https://hisab.example/api/auth/google/callback").pending;
    for (const key of ["state", "nonce", "verifier"] as const) {
      expect(pending[key]).toMatch(/^[\w-]{43}$/);
      expect(again[key]).not.toBe(pending[key]);
    }
  });

  it("refuses an answer that doesn't belong to the sign-in this browser started", async () => {
    const { pending } = beginSignIn(config, "https://hisab.example/cb");
    await expect(completeSignIn(config, "https://hisab.example/cb", pending, { code: "c", state: "someone-else's" })).rejects.toThrow(/state mismatch/);
    await expect(completeSignIn(config, "https://hisab.example/cb", pending, { code: "c", state: null })).rejects.toThrow(/state mismatch/);
    await expect(completeSignIn(config, "https://hisab.example/cb", pending, { code: null, state: pending.state })).rejects.toThrow(/no code/);
  });

  it("keeps the pending sign-in in a cookie only it can read back", () => {
    const { pending } = beginSignIn(config, "https://hisab.example/cb");
    const full = { ...pending, next: "/transactions?month=2026-09", timezone: "Asia/Dhaka", resetPin: false };
    expect(decodePending(encodePending(full))).toEqual(full);
    expect(decodePending(undefined)).toBeNull();
    expect(decodePending("garbage")).toBeNull();
    expect(decodePending(Buffer.from(JSON.stringify({ state: "short" })).toString("base64url"))).toBeNull();
    expect(decodePending("x".repeat(5000))).toBeNull();
  });

  it("builds the callback address from where the request arrived, or APP_URL", () => {
    const request = (headers: Record<string, string>) => ({ headers: new Headers(headers), nextUrl: new URL("http://localhost:3000/api/auth/google") }) as never;
    delete process.env.APP_URL;
    expect(publicOrigin(request({}))).toBe("http://localhost:3000");
    expect(publicOrigin(request({ host: "hisab.up.railway.app", "x-forwarded-proto": "https" }))).toBe("https://hisab.up.railway.app");
    expect(callbackUrl(request({ "x-forwarded-host": "hisab.example, internal", "x-forwarded-proto": "https,http", host: "10.0.0.5:8080" }))).toBe(
      "https://hisab.example/api/auth/google/callback",
    );
    process.env.APP_URL = "https://money.example/";
    expect(callbackUrl(request({ host: "anything.else" }))).toBe("https://money.example/api/auth/google/callback");
  });
});

describe("who a Google account is here", () => {
  const rafi = { sub: "google-rafi", email: "rafi@example.com", emailVerified: true, name: "Rafi Ahmed" };
  const saved = process.env.OWNER_EMAIL;

  beforeEach(async () => {
    await wipeDatabase();
    delete process.env.OWNER_EMAIL;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.OWNER_EMAIL;
    else process.env.OWNER_EMAIL = saved;
  });

  it("creates the account on the first sign-in, with the starter categories", async () => {
    const first = await signInWithGoogle(rafi, { timezone: "Europe/London" });
    expect(first.created).toBe(true);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: first.userId } })).toMatchObject({
      googleSub: "google-rafi",
      email: "rafi@example.com",
      displayName: "Rafi Ahmed",
      timezone: "Europe/London",
      baseCurrency: "BDT",
      pinHash: null,
    });
    expect(await prisma.category.count({ where: { userId: first.userId } })).toBe(DEFAULT_CATEGORIES.length);
    expect(await listAccounts(first.userId, "2026-09-28")).toEqual([]);

    // Later sign-ins are the same person; a changed address is noted.
    const again = await signInWithGoogle({ ...rafi, email: "rafi.new@example.com" });
    expect(again).toEqual({ userId: first.userId, created: false });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: first.userId } })).email).toBe("rafi.new@example.com");
    expect(await prisma.user.count()).toBe(1);
  });

  it("tells people apart by Google's id, never by address or name", async () => {
    const one = await signInWithGoogle(rafi);
    const two = await signInWithGoogle({ ...rafi, sub: "google-impostor" });
    expect(two.created).toBe(true);
    expect(two.userId).not.toBe(one.userId);
  });

  it("falls back for a missing name or an unknown timezone", async () => {
    const { userId } = await signInWithGoogle({ ...rafi, name: null }, { timezone: "Mars/Olympus" });
    expect(await getSettings(userId)).toMatchObject({ displayName: "rafi", timezone: "Asia/Dhaka" });
    const anonymous = await signInWithGoogle({ sub: "google-anon", email: null, emailVerified: false, name: null });
    expect((await getSettings(anonymous.userId)).displayName).toBe("");
  });

  it("creates one account when the first sign-ins arrive together", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => signInWithGoogle(rafi)));
    expect(new Set(results.map((r) => r.userId)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.category.count()).toBe(DEFAULT_CATEGORIES.length);
  });

  describe("the ledger from before Google sign-in", () => {
    let owner: string;
    beforeEach(async () => {
      // The owner as the migration leaves them: data, but no Google account yet.
      owner = await resetData();
      await makeAccount({ name: "Cash", openingBalance: "20000" });
      process.env.OWNER_EMAIL = "Owner@Example.com ";
    });

    it("goes to the Google account named by OWNER_EMAIL", async () => {
      const result = await signInWithGoogle({ sub: "google-owner", email: "owner@example.com", emailVerified: true, name: "Someone" });
      expect(result).toEqual({ userId: owner, created: false });
      expect(await prisma.user.findUniqueOrThrow({ where: { id: owner } })).toMatchObject({
        googleSub: "google-owner",
        email: "owner@example.com",
        // Their own name and data stay as they were.
        displayName: "Test user",
      });
      expect((await listAccounts(result.userId, "2026-09-28")).map((a) => a.name)).toEqual(["Cash"]);
      // From then on it is theirs by Google's id, whatever the variable says.
      process.env.OWNER_EMAIL = "someone.else@example.com";
      expect((await signInWithGoogle({ sub: "google-owner", email: "owner@example.com", emailVerified: true, name: null })).userId).toBe(owner);
    });

    it("goes to nobody else", async () => {
      const stranger = await signInWithGoogle(rafi);
      expect(stranger.created).toBe(true);
      // The right address, but Google hasn't verified it.
      const unverified = await signInWithGoogle({ sub: "google-unverified", email: "owner@example.com", emailVerified: false, name: null });
      expect(unverified.created).toBe(true);
      for (const { userId } of [stranger, unverified]) {
        expect(userId).not.toBe(owner);
        expect(await listAccounts(userId, "2026-09-28")).toEqual([]);
      }
      expect((await prisma.user.findUniqueOrThrow({ where: { id: owner } })).googleSub).toBeNull();

      // Without the variable, nobody can take it over.
      delete process.env.OWNER_EMAIL;
      expect((await signInWithGoogle({ sub: "google-owner", email: "owner@example.com", emailVerified: true, name: null })).created).toBe(true);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: owner } })).googleSub).toBeNull();
    });

    it("is taken over once: a second Google account with that address starts fresh", async () => {
      const [first, second] = await Promise.all([
        signInWithGoogle({ sub: "google-owner-a", email: "owner@example.com", emailVerified: true, name: null }),
        signInWithGoogle({ sub: "google-owner-b", email: "owner@example.com", emailVerified: true, name: null }),
      ]);
      expect([first.userId, second.userId].filter((id) => id === owner)).toHaveLength(1);
      expect(first.userId).not.toBe(second.userId);
      expect(await prisma.user.count()).toBe(2);
    });
  });
});
