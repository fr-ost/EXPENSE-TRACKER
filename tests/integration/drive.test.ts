import { gunzipSync, gzipSync } from "node:zlib";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DRIVE_BACKUPS_KEPT, parseBackup } from "@/lib/backup";
import { DRIVE_SCOPE, beginSignIn, completeAuthorization, googleConfig } from "@/lib/server/auth/google";
import { prisma } from "@/lib/server/db";
import { openToken, sealToken } from "@/lib/server/drive/tokens";
import { listAccounts } from "@/lib/server/services/accounts";
import {
  backupToDrive,
  connectDrive,
  disconnectDrive,
  ensureDailyBackup,
  getDriveStatus,
  listDriveBackups,
  removeDriveBackups,
  restoreFromDrive,
} from "@/lib/server/services/drive";
import { createTransaction } from "@/lib/server/services/transactions";
import type { UserId } from "@/lib/server/user-id";
import type { TransactionInput } from "@/lib/validation";
import { startFakeGoogle } from "../e2e/fake-google.mjs";
import { categoryId, makeAccount, makeUser, resetData } from "../support/fixtures";

const TODAY = "2026-09-28";
const PORT = 3291;
const REDIRECT = "http://localhost:3000/api/auth/google/callback";
const HOUR = 60 * 60 * 1000;

interface Person {
  sub: string;
  email: string;
  name: string;
  withoutDrive?: boolean;
}

describe("backups in Google Drive", () => {
  let google: Awaited<ReturnType<typeof startFakeGoogle>>;
  let me: UserId;
  let cash: string;
  let food: string;
  const rafi: Person = { sub: "google-rafi", email: "rafi@example.com", name: "Rafi" };

  beforeAll(async () => {
    process.env.GOOGLE_CLIENT_ID = "hisab-drive-test.apps.googleusercontent.com";
    process.env.GOOGLE_CLIENT_SECRET = "drive-test-secret";
    google = await startFakeGoogle({ port: PORT, clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET });
    process.env.GOOGLE_TEST_ORIGIN = google.origin;
  });
  afterAll(async () => {
    await google.close();
    delete process.env.GOOGLE_TEST_ORIGIN;
  });

  /** Steer the stand-in, or look inside a person's Drive folder. */
  const steer = async (path: string, body?: unknown) =>
    (await fetch(`${google.origin}/__test/${path}`, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) })).json();
  const folder = async (who: Person) =>
    (await steer(`files?sub=${who.sub}`)) as { files: Array<{ id: string; name: string; createdTime: string; size: string; appProperties: Record<string, string>; base64: string }>; grants: number };

  /** Go through Google's consent as `who` and keep the permission for `userId`, as the callback does. */
  async function connect(userId: UserId, who: Person) {
    const config = googleConfig()!;
    const { url, pending } = beginSignIn(config, REDIRECT, { drive: { email: who.email } });
    const consent = await fetch(url, { redirect: "manual", headers: { cookie: `fake_google_user=${Buffer.from(JSON.stringify(who)).toString("base64url")}` } });
    expect(consent.status, await consent.text()).toBe(302);
    const back = new URL(consent.headers.get("location")!);
    const grant = await completeAuthorization(config, REDIRECT, pending, { code: back.searchParams.get("code"), state: back.searchParams.get("state") });
    if (grant.refreshToken) await connectDrive(userId, grant.refreshToken);
    return grant;
  }

  const spend = (amount: string, description = "") =>
    createTransaction(me, { type: "EXPENSE", accountId: cash, categoryId: food, amount, date: "2026-09-10", scope: "PERSONAL", description, notes: null } as TransactionInput, { today: TODAY });
  const balance = async (userId: UserId = me) => (await listAccounts(userId, TODAY))[0]?.balance;
  const link = () => prisma.driveBackup.findUniqueOrThrow({ where: { userId: me } });
  /** Pretend the last try was this long ago. */
  const age = (ms: number) => prisma.driveBackup.update({ where: { userId: me }, data: { lastAttemptAt: new Date(Date.now() - ms) } });

  beforeEach(async () => {
    await steer("trouble");
    await steer(`revoke?sub=${rafi.sub}`);
    // A Drive folder of its own for every test.
    rafi.sub = `google-rafi-${Math.random().toString(36).slice(2)}`;
    me = await resetData();
    await prisma.user.update({ where: { id: me }, data: { googleSub: rafi.sub, email: rafi.email } });
    cash = await makeAccount({ name: "Cash", openingBalance: "20000", openingDate: "2025-01-01" });
    food = await categoryId("EXPENSE", "Food");
    await spend("1500", "Groceries");
  });

  it("the permission is asked for Hisab's own folder only, and kept encrypted", async () => {
    const config = googleConfig()!;
    const asked = new URL(beginSignIn(config, REDIRECT, { drive: { email: rafi.email } }).url).searchParams;
    expect(asked.get("scope")).toBe(`openid email ${DRIVE_SCOPE}`);
    expect(DRIVE_SCOPE).toBe("https://www.googleapis.com/auth/drive.appdata");
    expect(Object.fromEntries(asked)).toMatchObject({ access_type: "offline", prompt: "consent", login_hint: rafi.email });
    // Signing in asks for nothing of the sort.
    const signIn = new URL(beginSignIn(config, REDIRECT).url).searchParams;
    expect([signIn.get("scope"), signIn.get("access_type")]).toEqual(["openid email profile", null]);

    const grant = await connect(me, rafi);
    expect(grant.scopes).toContain(DRIVE_SCOPE);
    expect(grant.refreshToken).toBeTruthy();
    const stored = (await link()).refreshToken;
    expect(stored).not.toContain(grant.refreshToken!);
    expect(stored).toMatch(/^v1:[\w-]{16}:[\w-]{22}:[\w-]+$/);
    expect(openToken(stored, config.clientSecret)).toBe(grant.refreshToken);
    // Sealed afresh each time; opened only with the right secret and untouched.
    expect(sealToken("token", "secret")).not.toBe(sealToken("token", "secret"));
    expect(openToken(sealToken("token", "secret"), "another secret")).toBeNull();
    expect(openToken(stored.slice(0, -2) + "AA", config.clientSecret)).toBeNull();
    expect(openToken("not-sealed", config.clientSecret)).toBeNull();

    // Someone who unticks the Drive permission has given none.
    const other = await makeUser("Other");
    const refused = await connect(other, { sub: "google-unticked", email: "u@example.com", name: "U", withoutDrive: true });
    expect(refused.scopes).not.toContain(DRIVE_SCOPE);
  });

  it("saves the ledger to Drive: a compressed backup file that says what it holds", async () => {
    expect(await getDriveStatus(me)).toMatchObject({ available: true, connected: false, lastBackupAt: null });
    await connect(me, rafi);
    const outcome = await backupToDrive(me, TODAY);
    expect(outcome.status).toBe("saved");

    const { files } = await folder(rafi);
    expect(files).toHaveLength(1);
    expect(files[0].name).toMatch(/^hisab-backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json\.gz$/);
    expect(files[0].appProperties).toMatchObject({ accounts: "1", transactions: "1", categories: "20", balanceUpdates: "0" });
    // The file is a whole backup, readable without Hisab's server.
    const parsed = parseBackup(JSON.parse(gunzipSync(Buffer.from(files[0].base64, "base64")).toString("utf8")));
    expect(parsed.ok && parsed.backup.accounts.map((a) => [a.name, a.balance])).toEqual([["Cash", "18500.00"]]);
    expect(parsed.ok && parsed.backup.transactions.map((t) => t.description)).toEqual(["Groceries"]);

    const status = await getDriveStatus(me);
    expect(status).toMatchObject({ connected: true, needsReconnect: false, problem: null });
    expect(Date.now() - new Date(status.lastBackupAt!).getTime()).toBeLessThan(60_000);
    expect(await listDriveBackups(me)).toMatchObject([{ id: files[0].id, size: Number(files[0].size), summary: { accounts: 1, transactions: 1 } }]);
  });

  it("doesn't upload the same ledger twice, or an empty one", async () => {
    await connect(me, rafi);
    expect((await backupToDrive(me, TODAY)).status).toBe("saved");
    // Nothing recorded since — even on another day.
    expect((await backupToDrive(me, TODAY)).status).toBe("unchanged");
    expect((await backupToDrive(me, "2026-09-29")).status).toBe("unchanged");
    expect((await folder(rafi)).files).toHaveLength(1);
    // "Back up now" always makes a copy; so does any change.
    expect((await backupToDrive(me, TODAY, { always: true })).status).toBe("saved");
    await spend("20", "Tea");
    expect((await backupToDrive(me, TODAY)).status).toBe("saved");
    expect((await folder(rafi)).files).toHaveLength(3);

    const empty = await makeUser("Empty");
    const nobody: Person = { sub: `google-empty-${Date.now()}`, email: "empty@example.com", name: "Empty" };
    await connect(empty, nobody);
    expect((await backupToDrive(empty, TODAY, { always: true })).status).toBe("empty");
    expect((await folder(nobody)).files).toEqual([]);
  });

  it(`keeps the newest ${DRIVE_BACKUPS_KEPT} backups`, async () => {
    await connect(me, rafi);
    for (let i = 1; i <= DRIVE_BACKUPS_KEPT + 3; i++) {
      await spend(String(i), `Entry ${i}`);
      await backupToDrive(me, TODAY);
    }
    const backups = await listDriveBackups(me);
    expect(backups).toHaveLength(DRIVE_BACKUPS_KEPT);
    // Newest first: the last one holds every entry, the oldest kept one is the fourth made.
    expect(backups.map((b) => b.summary?.transactions)).toEqual(Array.from({ length: DRIVE_BACKUPS_KEPT }, (_, i) => DRIVE_BACKUPS_KEPT + 4 - i));
    // Other files in the folder are left alone and not offered.
    await steer(`put-file?sub=${rafi.sub}`, { name: "something-else.txt", base64: Buffer.from("hello").toString("base64") });
    expect(await listDriveBackups(me)).toHaveLength(DRIVE_BACKUPS_KEPT);
    expect((await folder(rafi)).files).toHaveLength(DRIVE_BACKUPS_KEPT + 1);
  });

  it("backs up on its own once a day, when something has changed", async () => {
    await connect(me, rafi);
    await ensureDailyBackup(me, TODAY);
    expect((await folder(rafi)).files).toHaveLength(1);
    const first = await link();

    // Later the same day: nothing happens, not even a look.
    await spend("20", "Tea");
    await age(3 * HOUR);
    const waiting = (await link()).lastAttemptAt;
    await ensureDailyBackup(me, TODAY);
    expect((await folder(rafi)).files).toHaveLength(1);
    expect((await link()).lastAttemptAt).toEqual(waiting);

    // A day later the change is saved…
    await age(25 * HOUR);
    await ensureDailyBackup(me, "2026-09-29");
    expect((await folder(rafi)).files).toHaveLength(2);
    expect((await link()).lastBackupAt!.getTime()).toBeGreaterThan(first.lastBackupAt!.getTime());
    // …and a day after that, with nothing new, Hisab looks but uploads nothing.
    const saved = (await link()).lastBackupAt;
    await age(25 * HOUR);
    await ensureDailyBackup(me, "2026-09-30");
    expect((await folder(rafi)).files).toHaveLength(2);
    expect((await link()).lastBackupAt).toEqual(saved);
    expect(Date.now() - (await link()).lastAttemptAt!.getTime()).toBeLessThan(60_000);

    // Several pages loading at once make one backup between them.
    await spend("30", "Lunch");
    await age(25 * HOUR);
    await Promise.all(Array.from({ length: 6 }, () => ensureDailyBackup(me, "2026-10-01")));
    expect((await folder(rafi)).files).toHaveLength(3);
    // Someone who never connected Drive is simply skipped.
    await expect(ensureDailyBackup(await makeUser("No Drive"), TODAY)).resolves.toBeUndefined();
  });

  it("restores a backup from Drive, after saving what is there now", async () => {
    await connect(me, rafi);
    await backupToDrive(me, TODAY);
    const [original] = await listDriveBackups(me);
    await spend("500", "After the backup");
    expect(await balance()).toBe("18000.00");

    const result = await restoreFromDrive(me, original.id, TODAY);
    expect(result).toMatchObject({ accounts: 1, transactions: 1, balanceDifferences: [] });
    expect(await balance()).toBe("18500.00");

    // What was there before the restore is the newest backup now: the restore can be undone.
    const [safety, earlier] = await listDriveBackups(me);
    expect(earlier.id).toBe(original.id);
    expect(safety.summary?.transactions).toBe(2);
    await restoreFromDrive(me, safety.id, TODAY);
    expect(await balance()).toBe("18000.00");
    expect(await prisma.transaction.count({ where: { userId: me, description: "After the backup" } })).toBe(1);
  });

  it("only ever reaches the folder of the person's own Google account", async () => {
    await connect(me, rafi);
    await backupToDrive(me, TODAY);
    const [mine] = await listDriveBackups(me);

    const other = await makeUser("Other");
    const theirs: Person = { sub: `google-other-${Date.now()}`, email: "other@example.com", name: "Other" };
    await makeAccount({ name: "Their wallet", openingBalance: "7" }, other);
    await connect(other, theirs);
    await backupToDrive(other, TODAY);

    expect((await listDriveBackups(other)).map((b) => b.id)).not.toContain(mine.id);
    expect(await listDriveBackups(other)).toHaveLength(1);
    // Asking for my backup by its id gets nowhere, and changes nothing of theirs.
    await expect(restoreFromDrive(other, mine.id, TODAY)).rejects.toMatchObject({ status: 502, message: expect.stringMatching(/no longer in your Google Drive/) });
    expect(await balance(other)).toBe("7.00");
    expect((await folder(theirs)).files).toHaveLength(1);
    // Without Drive connected there is nothing to list or restore from.
    const unconnected = await makeUser("Unconnected");
    await expect(listDriveBackups(unconnected)).rejects.toMatchObject({ status: 409 });
    await expect(backupToDrive(unconnected, TODAY)).rejects.toMatchObject({ status: 409 });
  });

  it("a file in Drive that isn't a sound backup is refused, and nothing changes", async () => {
    await connect(me, rafi);
    await backupToDrive(me, TODAY);
    const put = (name: string, content: Buffer) => steer(`put-file?sub=${rafi.sub}`, { name, base64: content.toString("base64") });
    await put("hisab-backup-garbage.json.gz", Buffer.from("this is not gzip"));
    await put("hisab-backup-not-a-backup.json.gz", gzipSync(JSON.stringify({ hello: "world" })));
    // A small file that would unpack to far more than any backup.
    await put("hisab-backup-bomb.json.gz", gzipSync(Buffer.alloc(40 * 1024 * 1024, 0x20)));
    const [bomb, notBackup, garbage] = await listDriveBackups(me);

    await expect(restoreFromDrive(me, garbage.id, TODAY)).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/can't be read/) });
    await expect(restoreFromDrive(me, bomb.id, TODAY)).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/can't be read/) });
    await expect(restoreFromDrive(me, notBackup.id, TODAY)).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/isn't a Hisab backup file/) });
    expect(await balance()).toBe("18500.00");
    expect(await prisma.transaction.count({ where: { userId: me } })).toBe(1);
  });

  it("says so when Google has withdrawn the permission, and waits to be connected again", async () => {
    await connect(me, rafi);
    await backupToDrive(me, TODAY);
    await steer(`revoke?sub=${rafi.sub}`);
    await spend("20", "Tea");

    await expect(backupToDrive(me, TODAY)).rejects.toMatchObject({ status: 409, code: "drive_reconnect" });
    expect(await getDriveStatus(me)).toMatchObject({ connected: true, needsReconnect: true, problem: null });
    await expect(listDriveBackups(me)).rejects.toMatchObject({ code: "drive_reconnect" });
    // No automatic tries until then, however long it takes.
    await age(72 * HOUR);
    const waiting = (await link()).lastAttemptAt;
    await ensureDailyBackup(me, TODAY);
    expect((await link()).lastAttemptAt).toEqual(waiting);

    // Connecting again picks up where it left off.
    await connect(me, rafi);
    expect(await getDriveStatus(me)).toMatchObject({ needsReconnect: false });
    await ensureDailyBackup(me, TODAY);
    expect((await folder(rafi)).files).toHaveLength(2);

    // A changed client secret makes the stored permission unreadable: the same answer.
    const secret = process.env.GOOGLE_CLIENT_SECRET;
    process.env.GOOGLE_CLIENT_SECRET = "rotated";
    await expect(backupToDrive(me, TODAY, { always: true })).rejects.toMatchObject({ code: "drive_reconnect" });
    process.env.GOOGLE_CLIENT_SECRET = secret;
  });

  it("says what went wrong when Drive doesn't work, and tries again later", async () => {
    await connect(me, rafi);
    for (const [kind, status, message] of [
      ["down", 503, /busy/],
      ["disabled", 502, /Google Drive API must be enabled/],
      ["full", 502, /Your Google Drive is full/],
    ] as const) {
      await steer(`trouble?kind=${kind}`);
      await expect(backupToDrive(me, TODAY, { always: true }), kind).rejects.toMatchObject({ status, message: expect.stringMatching(message) });
      expect((await getDriveStatus(me)).problem, kind).toMatch(message);
    }
    expect((await folder(rafi)).files).toEqual([]);

    // The automatic backup waits an hour after a failure, then tries again.
    await age(30 * 60 * 1000);
    const waiting = (await link()).lastAttemptAt;
    await ensureDailyBackup(me, TODAY);
    expect((await link()).lastAttemptAt).toEqual(waiting);
    await steer("trouble");
    await age(2 * HOUR);
    await ensureDailyBackup(me, TODAY);
    expect((await folder(rafi)).files).toHaveLength(1);
    expect(await getDriveStatus(me)).toMatchObject({ problem: null, needsReconnect: false });
  });

  it("disconnecting hands the permission back and leaves the backups; deleting the account removes them", async () => {
    await connect(me, rafi);
    await backupToDrive(me, TODAY);
    expect((await folder(rafi)).grants).toBe(1);

    await disconnectDrive(me);
    expect(await getDriveStatus(me)).toMatchObject({ connected: false, lastBackupAt: null });
    expect(await folder(rafi)).toMatchObject({ grants: 0, files: [{ name: expect.stringMatching(/^hisab-backup-/) }] });
    await disconnectDrive(me);

    // Connecting again finds the earlier backups. Connecting twice keeps working: the earlier
    // permission is forgotten, not revoked (revoking it would take the new one with it).
    await connect(me, rafi);
    await connect(me, rafi);
    expect((await folder(rafi)).grants).toBe(2);
    expect(await listDriveBackups(me)).toHaveLength(1);
    expect((await backupToDrive(me, TODAY, { always: true })).status).toBe("saved");

    // Deleting the account: every backup removed, and everything Hisab was allowed handed back.
    await removeDriveBackups(me);
    expect(await folder(rafi)).toMatchObject({ grants: 0, files: [] });
    expect(await prisma.driveBackup.count({ where: { userId: me } })).toBe(0);
    // Nothing to do for someone who never connected, and no harm when Drive can't be reached.
    await removeDriveBackups(me);
    await connect(me, rafi);
    await steer("trouble?kind=down");
    await removeDriveBackups(me);
    expect(await prisma.driveBackup.count({ where: { userId: me } })).toBe(0);
  });
});
