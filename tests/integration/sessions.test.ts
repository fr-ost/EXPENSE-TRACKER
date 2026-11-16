import { beforeEach, describe, expect, it } from "vitest";
import {
  PIN_TRIES,
  checkPin,
  hashPin,
  pinMatches,
  pinWaitMinutes,
  removePin,
  resetPin,
  setPin,
  unlockWithPin,
} from "@/lib/server/auth/pin";
import {
  beginSignInAttempt,
  checkSignInAttempt,
  formatRetryAfter,
  markSignInAttemptSuccessful,
  takeWrite,
} from "@/lib/server/auth/rate-limit";
import { createSession, lockSession, readSession, touchSession } from "@/lib/server/auth/session";
import { prisma } from "@/lib/server/db";
import type { UserId } from "@/lib/server/user-id";
import { makeUser, resetData } from "../support/fixtures";

const ago = (ms: number) => new Date(Date.now() - ms);
const PIN = "4821";

/** A user, optionally with an app-lock PIN and an auto-lock period. */
async function userWith(options: { pin?: string; autoLockMinutes?: number } = {}): Promise<UserId> {
  const userId = await resetData();
  if (options.autoLockMinutes !== undefined) {
    await prisma.user.update({ where: { id: userId }, data: { autoLockMinutes: options.autoLockMinutes } });
  }
  if (options.pin) await setPin(userId, options.pin, null);
  return userId;
}

describe("sessions", () => {
  it("stores only a hash of the token", async () => {
    const userId = await userWith();
    const { token } = await createSession(userId, "test");
    const stored = await prisma.session.findFirstOrThrow();
    expect(stored.id).not.toBe(token);
    expect(stored.id).toMatch(/^[0-9a-f]{64}$/);
    expect((await readSession(token))?.userId).toBe(userId);
    expect(await readSession("not-a-real-token")).toBeNull();
    expect(await readSession("")).toBeNull();
  });

  it("expires after the absolute lifetime or 7 idle days", async () => {
    const userId = await userWith();
    const expired = await createSession(userId, "test");
    await prisma.session.updateMany({ data: { expiresAt: ago(1000) } });
    expect(await readSession(expired.token)).toBeNull();

    const idle = await createSession(userId, "test");
    await prisma.session.updateMany({ where: { expiresAt: { gt: new Date() } }, data: { lastSeenAt: ago(8 * 24 * 60 * 60_000) } });
    expect(await readSession(idle.token)).toBeNull();
    expect(await prisma.session.count()).toBe(0);
  });

  it("belongs to the user it was created for", async () => {
    const alice = await userWith();
    const bob = await makeUser("Bob");
    const a = await createSession(alice, "test");
    const b = await createSession(bob, "test");
    expect((await readSession(a.token))?.userId).toBe(alice);
    expect((await readSession(b.token))?.userId).toBe(bob);
  });
});

describe("app lock", () => {
  it("is off without a PIN: nothing locks, whatever the auto-lock period", async () => {
    const userId = await userWith({ autoLockMinutes: 5 });
    const { token } = await createSession(userId, "test");
    await prisma.session.updateMany({ data: { lastSeenAt: ago(3 * 24 * 60 * 60_000) } });
    const session = await readSession(token);
    expect(session).toMatchObject({ locked: false, hasPin: false, autoLockMinutes: 0 });
    // Even a session marked locked (the PIN was removed since) is open.
    await lockSession(session!.id);
    expect((await readSession(token))?.locked).toBe(false);
  });

  it("asks for the PIN after signing in", async () => {
    const userId = await userWith({ pin: PIN });
    const { token } = await createSession(userId, "test");
    const session = (await readSession(token))!;
    expect(session).toMatchObject({ locked: true, hasPin: true, autoLockMinutes: 15 });
    await unlockWithPin(userId, session.id, PIN);
    expect((await readSession(token))?.locked).toBe(false);
  });

  it("locks server-side after the inactivity period, even without the browser", async () => {
    const userId = await userWith({ pin: PIN, autoLockMinutes: 5 });
    const { token } = await createSession(userId, "test");
    const { id } = (await readSession(token))!;
    await unlockWithPin(userId, id, PIN);
    await prisma.session.updateMany({ data: { lastSeenAt: ago(6 * 60_000) } });
    expect((await readSession(token))?.locked).toBe(true);
    // Stays locked, and activity can't refresh a locked session.
    await touchSession(id);
    expect((await readSession(token))?.locked).toBe(true);
    await unlockWithPin(userId, id, PIN);
    expect((await readSession(token))?.locked).toBe(false);
  });

  it("with auto-lock off, locks only on demand", async () => {
    const userId = await userWith({ pin: PIN, autoLockMinutes: 0 });
    const { token } = await createSession(userId, "test");
    const { id } = (await readSession(token))!;
    await unlockWithPin(userId, id, PIN);
    await prisma.session.updateMany({ data: { lastSeenAt: ago(3 * 24 * 60 * 60_000) } });
    expect((await readSession(token))?.locked).toBe(false);
    await lockSession(id);
    expect((await readSession(token))?.locked).toBe(true);
  });

  it("stores the PIN only as a salted scrypt hash", async () => {
    const userId = await userWith({ pin: PIN });
    const { pinHash } = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(pinHash).toMatch(/^scrypt\$16384\$8\$1\$[\w-]{22}\$[\w-]{43}$/);
    expect(pinHash).not.toContain(PIN);
    expect(await pinMatches(PIN, pinHash!)).toBe(true);
    expect(await pinMatches("4822", pinHash!)).toBe(false);
    expect(await pinMatches(PIN, "not-a-hash")).toBe(false);
    expect(await pinMatches(PIN, "scrypt$x$8$1$c2FsdA$a2V5")).toBe(false);
    // The same PIN never hashes the same way twice.
    expect(await hashPin(PIN)).not.toBe(await hashPin(PIN));
  });

  it("allows five wrong PINs, then makes every try wait — the right PIN included", async () => {
    const userId = await userWith({ pin: PIN });
    for (let left = PIN_TRIES - 1; left >= 1; left--) {
      expect(await checkPin(userId, "0000")).toEqual({ status: "incorrect", remaining: left });
    }
    const fifth = await checkPin(userId, "0000");
    expect(fifth.status).toBe("wait");
    expect(fifth.status === "wait" && fifth.retryAfterSeconds).toBe(60);
    expect((await checkPin(userId, PIN)).status).toBe("wait");

    // When the wait is over the right PIN works, and the count starts again.
    await prisma.user.update({ where: { id: userId }, data: { pinLockedUntil: ago(1000) } });
    expect(await checkPin(userId, PIN)).toEqual({ status: "correct" });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: userId } })).toMatchObject({ pinFailures: 0, pinLockedUntil: null });
    expect(await checkPin(userId, "0000")).toEqual({ status: "incorrect", remaining: PIN_TRIES - 1 });
  });

  it("makes the wait longer each time: 1 minute, 5, 30, then a day", async () => {
    expect([1, 4, 5, 6, 10, 15, 20, 25, 500].map(pinWaitMinutes)).toEqual([0, 0, 1, 0, 5, 30, 1440, 1440, 1440]);
    expect([60, 300, 1800, 86_400].map(formatRetryAfter)).toEqual(["a minute", "5 minutes", "30 minutes", "a day"]);

    const userId = await userWith({ pin: PIN });
    await prisma.user.update({ where: { id: userId }, data: { pinFailures: 9 } });
    const tenth = await checkPin(userId, "0000");
    expect(tenth.status === "wait" && tenth.retryAfterSeconds).toBe(300);
  });

  it("counts wrong PINs per person, not per device, and never lets parallel guesses past the limit", async () => {
    const userId = await userWith({ pin: PIN });
    // Twelve guesses at once, as if from many sessions.
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => checkPin(userId, String(1000 + i))));
    expect(results.filter((r) => r.status === "incorrect")).toHaveLength(PIN_TRIES - 1);
    expect(results.filter((r) => r.status === "wait")).toHaveLength(12 - (PIN_TRIES - 1));
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).pinFailures).toBe(PIN_TRIES);

    // Someone else's PIN is unaffected.
    const other = await makeUser("Other");
    await setPin(other, "9999", null);
    expect(await checkPin(other, "9999")).toEqual({ status: "correct" });
  });

  it("changes or turns off only with the current PIN", async () => {
    const userId = await userWith({ pin: PIN });
    await expect(setPin(userId, "123", null)).rejects.toMatchObject({ status: 400 });
    await expect(setPin(userId, "12a4", null)).rejects.toMatchObject({ status: 400 });
    await expect(setPin(userId, "5555", null)).rejects.toMatchObject({ status: 400 });
    await expect(setPin(userId, "5555", "0000")).rejects.toMatchObject({ status: 401 });
    await setPin(userId, "5555", PIN);
    expect(await checkPin(userId, PIN)).toMatchObject({ status: "incorrect" });
    expect(await checkPin(userId, "5555")).toEqual({ status: "correct" });

    await expect(removePin(userId, PIN)).rejects.toMatchObject({ status: 401 });
    const { token } = await createSession(userId, "test");
    expect((await readSession(token))?.locked).toBe(true);
    await removePin(userId, "5555");
    // Without a PIN nothing is locked any more.
    expect(await readSession(token)).toMatchObject({ locked: false, hasPin: false });
  });

  it("a forgotten PIN can be removed only just after signing in with Google", async () => {
    const userId = await userWith({ pin: PIN });
    const { token } = await createSession(userId, "test");
    const session = (await readSession(token))!;

    expect(session.lockedSinceSignIn).toBe(true);
    // Not if that sign-in was a while ago…
    await expect(resetPin(userId, { ...session, createdAt: ago(11 * 60_000) })).rejects.toMatchObject({ status: 403 });
    expect((await readSession(token))?.locked).toBe(true);
    // …nor once the PIN has opened the session and it locked again (a device left lying about).
    await unlockWithPin(userId, session.id, PIN);
    await lockSession(session.id);
    const relocked = (await readSession(token))!;
    expect(relocked).toMatchObject({ locked: true, lockedSinceSignIn: false });
    await expect(resetPin(userId, relocked)).rejects.toMatchObject({ status: 403 });

    // Signing in with Google again does allow it. Wrong guesses and their wait go with the PIN.
    const again = await createSession(userId, "test");
    const fresh = (await readSession(again.token))!;
    for (let i = 0; i < PIN_TRIES; i++) await checkPin(userId, "0000");
    await resetPin(userId, fresh);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: userId } })).toMatchObject({ pinHash: null, pinFailures: 0, pinLockedUntil: null });
    expect(await readSession(token)).toMatchObject({ locked: false, hasPin: false });
  });
});

describe("rate limiting", () => {
  beforeEach(async () => {
    await prisma.loginAttempt.deleteMany();
  });

  it("slows a client after twenty failed sign-ins, without keeping anyone else out", async () => {
    for (let i = 0; i < 20; i++) {
      expect((await checkSignInAttempt("1.2.3.4")).allowed).toBe(true);
      await beginSignInAttempt("1.2.3.4");
    }
    const blocked = await checkSignInAttempt("1.2.3.4");
    expect(blocked.allowed).toBe(false);
    expect(blocked.allowed === false && blocked.retryAfterSeconds).toBeGreaterThan(0);
    // However many clients are failing, another one can still sign in.
    for (let i = 0; i < 60; i++) await beginSignInAttempt(`10.0.0.${i}`);
    expect((await checkSignInAttempt("5.6.7.8")).allowed).toBe(true);
  });

  it("clears a client's failures after a successful sign-in", async () => {
    for (let i = 0; i < 19; i++) await beginSignInAttempt("1.2.3.4");
    const attempt = await beginSignInAttempt("1.2.3.4");
    await markSignInAttemptSuccessful(attempt, "1.2.3.4");
    expect((await checkSignInAttempt("1.2.3.4")).allowed).toBe(true);
    expect(await prisma.loginAttempt.count({ where: { ip: "1.2.3.4", success: false } })).toBe(0);
  });

  it("limits how fast one person can write: a burst of 120, then two a second", () => {
    const alice = "writer-a" as UserId;
    const bob = "writer-b" as UserId;
    const start = 1_000_000;
    for (let i = 0; i < 120; i++) expect(takeWrite(alice, start).allowed).toBe(true);
    const refused = takeWrite(alice, start);
    expect(refused).toEqual({ allowed: false, retryAfterSeconds: 1 });
    // Someone else is not affected.
    expect(takeWrite(bob, start).allowed).toBe(true);
    // Half a second later there is room for one more; a minute later the burst is back.
    expect(takeWrite(alice, start + 500).allowed).toBe(true);
    expect(takeWrite(alice, start + 500).allowed).toBe(false);
    for (let i = 0; i < 120; i++) expect(takeWrite(alice, start + 61_000).allowed).toBe(true);
    expect(takeWrite(alice, start + 61_000).allowed).toBe(false);
  });
});
