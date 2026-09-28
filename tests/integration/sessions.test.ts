import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { adminPassword, passwordMatches } from "@/lib/server/auth/password";
import { attemptUnlock, checkLoginPassword, MAX_UNLOCK_ATTEMPTS } from "@/lib/server/auth/password-check";
import { beginPasswordAttempt, checkPasswordAttempt, markPasswordAttemptSuccessful } from "@/lib/server/auth/rate-limit";
import { createSession, lockSession, readSession, touchSession, unlockSession } from "@/lib/server/auth/session";
import { prisma } from "@/lib/server/db";
import { ensureOwner } from "@/lib/server/settings";

async function makeUser(autoLockMinutes = 15) {
  await prisma.user.deleteMany();
  const user = await prisma.user.create({ data: { autoLockMinutes } });
  return user.id;
}

const ago = (ms: number) => new Date(Date.now() - ms);
const TEST_PASSWORD = "test-pass-1";

afterEach(() => {
  process.env.ADMIN_PASSWORD = TEST_PASSWORD;
});

describe("password", () => {
  it("comes from ADMIN_PASSWORD, ignoring surrounding whitespace", () => {
    process.env.ADMIN_PASSWORD = "  7a9k \n";
    expect(adminPassword()).toBe("7a9k");
    expect(passwordMatches("7a9k", "7a9k")).toBe(true);
    expect(passwordMatches(" 7a9k ", "7a9k")).toBe(true);
    expect(passwordMatches("7A9K", "7a9k")).toBe(false);
    expect(passwordMatches("", "7a9k")).toBe(false);
    process.env.ADMIN_PASSWORD = "   ";
    expect(adminPassword()).toBeNull();
  });

  it("accepts the right password and creates the owner on first sign-in", async () => {
    await prisma.session.deleteMany();
    await prisma.loginAttempt.deleteMany();
    await prisma.user.deleteMany();
    await expect(checkLoginPassword("192.0.2.1", "nope")).rejects.toMatchObject({ status: 401 });
    expect(await prisma.user.count()).toBe(0);
    const id = await checkLoginPassword("192.0.2.1", TEST_PASSWORD);
    const owner = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(owner.displayName).toBe("Shahriar Ahmed");
    // Concurrent first sign-ins still end with exactly one owner.
    await prisma.user.deleteMany();
    const ids = await Promise.all([ensureOwner(), ensureOwner(), ensureOwner()]);
    expect(new Set(ids.map((o) => o.id)).size).toBe(1);
    expect(await prisma.user.count()).toBe(1);
  });

  it("refuses to sign anyone in when ADMIN_PASSWORD is missing", async () => {
    delete process.env.ADMIN_PASSWORD;
    await expect(checkLoginPassword("192.0.2.2", "")).rejects.toMatchObject({ status: 503 });
  });
});

describe("sessions", () => {
  beforeEach(async () => {
    await prisma.session.deleteMany();
    await prisma.loginAttempt.deleteMany();
  });

  it("stores only a hash of the token", async () => {
    const userId = await makeUser();
    const { token } = await createSession(userId, "test");
    const stored = await prisma.session.findFirstOrThrow();
    expect(stored.id).not.toBe(token);
    expect(stored.id).toMatch(/^[0-9a-f]{64}$/);
    expect((await readSession(token))?.userId).toBe(userId);
    expect(await readSession("not-a-real-token")).toBeNull();
  });

  it("locks server-side after the inactivity period, even without the browser", async () => {
    const userId = await makeUser(5);
    const { token } = await createSession(userId, "test");
    await prisma.session.updateMany({ data: { lastSeenAt: ago(6 * 60_000) } });
    const session = await readSession(token);
    expect(session?.locked).toBe(true);
    // Stays locked, and activity can't refresh a locked session.
    await touchSession(session!.id);
    expect((await readSession(token))?.locked).toBe(true);
    await unlockSession(session!.id);
    expect((await readSession(token))?.locked).toBe(false);
  });

  it("never auto-locks when auto-lock is off", async () => {
    const userId = await makeUser(0);
    const { token } = await createSession(userId, "test");
    await prisma.session.updateMany({ data: { lastSeenAt: ago(3 * 24 * 60 * 60_000) } });
    expect((await readSession(token))?.locked).toBe(false);
  });

  it("locks on demand", async () => {
    const userId = await makeUser();
    const { token } = await createSession(userId, "test");
    const session = await readSession(token);
    await lockSession(session!.id);
    expect((await readSession(token))?.locked).toBe(true);
  });

  it("signs out every session when ADMIN_PASSWORD changes", async () => {
    const userId = await makeUser();
    const { token } = await createSession(userId, "test");
    expect(await readSession(token)).not.toBeNull();

    // Removing the variable signs nobody in, but keeps the sessions.
    delete process.env.ADMIN_PASSWORD;
    expect(await readSession(token)).toBeNull();
    process.env.ADMIN_PASSWORD = TEST_PASSWORD;
    expect(await readSession(token)).not.toBeNull();

    process.env.ADMIN_PASSWORD = "a-new-password";
    expect(await readSession(token)).toBeNull();
    expect(await prisma.session.count()).toBe(0);
  });

  it("limits wrong passwords on the lock screen per session, then signs out", async () => {
    const userId = await makeUser();
    const { token } = await createSession(userId, "test");
    const { id } = (await readSession(token))!;
    await lockSession(id);

    expect(await attemptUnlock(id, "wrong")).toEqual({ status: "incorrect", remaining: MAX_UNLOCK_ATTEMPTS - 1 });
    expect(await attemptUnlock(id, TEST_PASSWORD)).toEqual({ status: "unlocked" });
    expect((await readSession(token))?.locked).toBe(false);

    // The counter restarts after a successful unlock.
    await lockSession(id);
    const results = await Promise.all(Array.from({ length: MAX_UNLOCK_ATTEMPTS + 3 }, () => attemptUnlock(id, "wrong")));
    expect(results.filter((r) => r.status === "incorrect")).toHaveLength(MAX_UNLOCK_ATTEMPTS - 1);
    expect(results.some((r) => r.status === "signed_out")).toBe(true);
    expect(await readSession(token)).toBeNull();
    expect(await attemptUnlock(id, TEST_PASSWORD)).toEqual({ status: "signed_out" });
  });

  it("expires sessions after the absolute lifetime or 7 idle days", async () => {
    const userId = await makeUser(0);
    const expired = await createSession(userId, "test");
    await prisma.session.updateMany({ data: { expiresAt: ago(1000) } });
    expect(await readSession(expired.token)).toBeNull();

    const idle = await createSession(userId, "test");
    await prisma.session.updateMany({ where: { expiresAt: { gt: new Date() } }, data: { lastSeenAt: ago(8 * 24 * 60 * 60_000) } });
    expect(await readSession(idle.token)).toBeNull();
    expect(await prisma.session.count()).toBe(0);
  });
});

describe("rate limiting", () => {
  beforeEach(async () => {
    await prisma.loginAttempt.deleteMany();
  });

  it("allows five failures per IP per window, then blocks", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await checkPasswordAttempt("1.2.3.4")).allowed).toBe(true);
      await beginPasswordAttempt("1.2.3.4");
    }
    const blocked = await checkPasswordAttempt("1.2.3.4");
    expect(blocked.allowed).toBe(false);
    expect(blocked.allowed === false && blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect((await checkPasswordAttempt("5.6.7.8")).allowed).toBe(true);
  });

  it("caps failures globally across IPs", async () => {
    for (let i = 0; i < 30; i++) await beginPasswordAttempt(`10.0.0.${i}`);
    expect((await checkPasswordAttempt("10.9.9.9")).allowed).toBe(false);
  });

  it("clears an IP's failures after a successful attempt", async () => {
    for (let i = 0; i < 4; i++) await beginPasswordAttempt("1.2.3.4");
    const attempt = await beginPasswordAttempt("1.2.3.4");
    await markPasswordAttemptSuccessful(attempt, "1.2.3.4");
    expect((await checkPasswordAttempt("1.2.3.4")).allowed).toBe(true);
  });
});
