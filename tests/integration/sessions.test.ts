import { beforeEach, describe, expect, it } from "vitest";
import { hashPassword, isArgon2Hash, verifyPassword } from "@/lib/server/auth/password";
import { beginPasswordAttempt, checkPasswordAttempt, markPasswordAttemptSuccessful } from "@/lib/server/auth/rate-limit";
import { createSession, lockSession, readSession, touchSession, unlockSession } from "@/lib/server/auth/session";
import { prisma } from "@/lib/server/db";

async function makeUser(autoLockMinutes = 15) {
  await prisma.user.deleteMany();
  const user = await prisma.user.create({ data: { passwordHash: await hashPassword("a-long-test-password"), autoLockMinutes } });
  return user.id;
}

const ago = (ms: number) => new Date(Date.now() - ms);

describe("passwords", () => {
  it("hashes with Argon2id and verifies", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(isArgon2Hash(hash)).toBe(true);
    expect(await verifyPassword(hash, "correct horse battery staple")).toBe(true);
    expect(await verifyPassword(hash, "wrong")).toBe(false);
    expect(await verifyPassword(null, "anything")).toBe(false);
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
