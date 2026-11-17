import "server-only";
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { BACKUP_MAX_BYTES, DRIVE_BACKUPS_KEPT, summarizeBackup, type BackupFile, type BackupSummary, type DriveBackupFile, type DriveStatus, type RestoreResult } from "@/lib/backup";
import type { ISODate } from "@/lib/dates";
import { googleConfig, type GoogleConfig } from "../auth/google";
import { runHeavyInTurn } from "../busy";
import { prisma } from "../db";
import { AppError, conflict, invalid } from "../errors";
import { DriveError, accessToken, deleteFile, downloadFile, listFiles, revokeToken, uploadFile, type DriveFile } from "../drive/client";
import { openToken, sealToken } from "../drive/tokens";
import type { UserId } from "../user-id";
import { exportBackup, restoreBackup } from "./backup";

/**
 * Backups in the person's own Google Drive, in the app's hidden folder there.
 *
 * Once Drive is connected, Hisab saves a copy of the ledger there after it
 * has changed — at most once a day, when the person uses the app — and keeps
 * the last ten. The copies are theirs: they survive anything that happens to
 * this server, and can be restored into the account at any time.
 *
 * What is stored here is the permission (a Google refresh token for that one
 * folder, encrypted) and when a backup last got there. The backups themselves
 * are never kept on the server.
 */

/** An unchanged ledger is looked at again after this long. */
const DAILY_MS = 24 * 60 * 60 * 1000;
/** After a failure, an automatic backup waits this long before trying again. */
const RETRY_MS = 60 * 60 * 1000;
const RECONNECT = "reconnect";
const GZIP = "application/gzip";

function requireConfig(): GoogleConfig {
  const config = googleConfig();
  if (!config) throw new AppError(503, "not_configured", "Google sign-in isn't set up on this server.");
  return config;
}

/** Drive errors become answers the app can show. */
function asAppError(error: unknown): unknown {
  if (!(error instanceof DriveError)) return error;
  if (error.kind === "reconnect") return new AppError(409, "drive_reconnect", error.message);
  if (error.kind === "unavailable") return new AppError(503, "drive_unavailable", error.message);
  return new AppError(502, "drive_failed", error.message);
}

export async function getDriveStatus(userId: UserId): Promise<DriveStatus> {
  const link = await prisma.driveBackup.findUnique({ where: { userId } });
  return {
    available: googleConfig() !== null,
    connected: link !== null,
    lastBackupAt: link?.lastBackupAt?.toISOString() ?? null,
    lastCheckedAt: link?.lastAttemptAt?.toISOString() ?? null,
    needsReconnect: link?.lastError === RECONNECT,
    problem: link?.lastError && link.lastError !== RECONNECT ? link.lastError : null,
  };
}

/**
 * Keep the permission Google has just given, in place of an earlier one.
 *
 * The earlier token is simply forgotten, never revoked: Google withdraws
 * everything an app was granted by a person when any one of its tokens is
 * revoked — the new one included.
 */
export async function connectDrive(userId: UserId, refreshToken: string): Promise<void> {
  const sealed = sealToken(refreshToken, requireConfig().clientSecret);
  await prisma.driveBackup.upsert({
    where: { userId },
    create: { userId, refreshToken: sealed },
    update: { refreshToken: sealed, connectedAt: new Date(), lastError: null, lastAttemptAt: null },
  });
}

/** An access token for the person's Drive folder; notes it when Google has withdrawn the permission. */
async function driveAccess(userId: UserId): Promise<string> {
  const config = requireConfig();
  const link = await prisma.driveBackup.findUnique({ where: { userId }, select: { refreshToken: true } });
  if (!link) throw conflict("Connect Google Drive first.");
  const refreshToken = openToken(link.refreshToken, config.clientSecret);
  try {
    if (!refreshToken) throw new DriveError("reconnect", "Google Drive needs to be connected again.");
    return await accessToken(config, refreshToken);
  } catch (error) {
    if (error instanceof DriveError && error.kind === "reconnect") {
      await prisma.driveBackup.updateMany({ where: { userId }, data: { lastError: RECONNECT, lastAttemptAt: new Date() } });
    }
    throw error;
  }
}

/**
 * Stop backing up to Drive and hand the permission back to Google (which
 * forgets everything Hisab was allowed there; signing in is not affected,
 * beyond Google asking once more whether to share the name and address).
 * Backups already in Drive stay.
 */
export async function disconnectDrive(userId: UserId): Promise<void> {
  const link = await prisma.driveBackup.findUnique({ where: { userId }, select: { refreshToken: true } });
  if (!link) return;
  await prisma.driveBackup.deleteMany({ where: { userId } });
  const config = googleConfig();
  const refreshToken = config ? openToken(link.refreshToken, config.clientSecret) : null;
  if (refreshToken) await revokeToken(refreshToken);
}

/**
 * For someone deleting their account: remove Hisab's backups from their Drive
 * and hand the permission back. Best effort — what can't be reached is left
 * (and can be removed in Google Drive's own settings).
 */
export async function removeDriveBackups(userId: UserId): Promise<void> {
  const link = await prisma.driveBackup.findUnique({ where: { userId }, select: { userId: true } });
  if (!link) return;
  try {
    const token = await driveAccess(userId);
    for (const file of await listFiles(token)) await deleteFile(token, file.id);
  } catch (error) {
    console.warn("[drive] backups not removed on account deletion", error instanceof Error ? error.message : error);
  }
  await disconnectDrive(userId);
}

// ---------------------------------------------------------------------------
// Backups
// ---------------------------------------------------------------------------

/** What the ledger holds, as a fingerprint: the same after a day in which nothing was recorded. */
function contentHash(backup: BackupFile): string {
  const { settings, accounts, categories, recurring, transactions, balanceUpdates, budgets, exchangeRates } = backup;
  // Without when it was made and the balances derived that day.
  const content = { settings, accounts: accounts.map((account) => ({ ...account, balance: null })), categories, recurring, transactions, balanceUpdates, budgets, exchangeRates };
  return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

const SUMMARY_KEYS = ["accounts", "categories", "transactions", "balanceUpdates", "budgets", "exchangeRates", "recurring"] as const;

function toProperties(summary: BackupSummary, hash: string): Record<string, string> {
  return { exportedAt: summary.exportedAt, hash, ...Object.fromEntries(SUMMARY_KEYS.map((key) => [key, String(summary[key])])) };
}

function toBackupFile(file: DriveFile): DriveBackupFile {
  const counts = SUMMARY_KEYS.map((key) => Number(file.properties[key]));
  const known = file.properties.exportedAt && counts.every((n) => Number.isInteger(n) && n >= 0);
  return {
    id: file.id,
    createdAt: file.properties.exportedAt || file.createdTime,
    size: file.size,
    summary: known
      ? ({ exportedAt: file.properties.exportedAt, ...Object.fromEntries(SUMMARY_KEYS.map((key, i) => [key, counts[i]])) } as unknown as BackupSummary)
      : null,
  };
}

const isBackup = (file: DriveFile) => file.name.startsWith("hisab-backup-");

export type DriveBackupOutcome =
  | { status: "saved"; backup: DriveBackupFile }
  /** The ledger is exactly as in the last backup. */
  | { status: "unchanged" }
  /** There is nothing recorded yet. */
  | { status: "empty" };

/**
 * Save a copy of the ledger to Drive. Skipped when nothing has been recorded
 * yet, or — unless `always` — when nothing has changed since the last copy.
 * Afterwards only the newest ten copies are kept.
 */
export async function backupToDrive(userId: UserId, today: ISODate, options: { always?: boolean } = {}): Promise<DriveBackupOutcome> {
  const attempted = new Date();
  try {
    const token = await driveAccess(userId);
    const backup = await exportBackup(userId, today);
    const hash = contentHash(backup);
    const link = await prisma.driveBackup.findUnique({ where: { userId }, select: { lastBackupHash: true } });

    let outcome: DriveBackupOutcome;
    if (backup.accounts.length === 0 && backup.transactions.length === 0) outcome = { status: "empty" };
    else if (!options.always && link?.lastBackupHash === hash) outcome = { status: "unchanged" };
    else {
      const contents = gzipSync(Buffer.from(JSON.stringify(backup), "utf8"));
      const name = `hisab-backup-${backup.exportedAt.replace(/[:.]/g, "-")}.json.gz`;
      const properties = toProperties(summarizeBackup(backup), hash);
      const id = await uploadFile(token, { name, mimeType: GZIP, contents, properties });
      outcome = { status: "saved", backup: { id, createdAt: backup.exportedAt, size: contents.length, summary: summarizeBackup(backup) } };

      // Keep the newest few. A failure here leaves an extra copy, never a missing one.
      try {
        const backups = (await listFiles(token)).filter(isBackup);
        for (const old of backups.slice(DRIVE_BACKUPS_KEPT)) await deleteFile(token, old.id);
      } catch (error) {
        console.warn("[drive] older backups not removed", error instanceof Error ? error.message : error);
      }
    }

    await prisma.driveBackup.updateMany({
      where: { userId },
      data: { lastAttemptAt: attempted, lastError: null, ...(outcome.status === "saved" ? { lastBackupAt: attempted, lastBackupHash: hash } : {}) },
    });
    return outcome;
  } catch (error) {
    if (!(error instanceof DriveError && error.kind === "reconnect")) {
      const problem = error instanceof DriveError || error instanceof AppError ? error.message : "The backup couldn't be made.";
      await prisma.driveBackup.updateMany({ where: { userId }, data: { lastAttemptAt: attempted, lastError: problem.slice(0, 200) } });
    }
    throw asAppError(error);
  }
}

/**
 * The automatic backup: at most one a day per person, an hour after a failed
 * try, and not at all while Drive needs reconnecting. Claims its turn in the
 * database, so two page loads at once make one backup. Never throws.
 */
export async function ensureDailyBackup(userId: UserId, today: ISODate): Promise<void> {
  try {
    const now = Date.now();
    const claimed = await prisma.driveBackup.updateMany({
      where: {
        userId,
        OR: [
          { lastAttemptAt: null },
          { lastError: null, lastAttemptAt: { lt: new Date(now - DAILY_MS) } },
          { lastError: { not: null }, NOT: { lastError: RECONNECT }, lastAttemptAt: { lt: new Date(now - RETRY_MS) } },
        ],
      },
      data: { lastAttemptAt: new Date(now) },
    });
    if (claimed.count === 1) await runHeavyInTurn(() => backupToDrive(userId, today));
  } catch (error) {
    console.warn("[drive] automatic backup failed", error instanceof Error ? error.message : error);
  }
}

/** The backups in the person's Drive, newest first. */
export async function listDriveBackups(userId: UserId): Promise<DriveBackupFile[]> {
  try {
    const token = await driveAccess(userId);
    return (await listFiles(token)).filter(isBackup).map(toBackupFile);
  } catch (error) {
    throw asAppError(error);
  }
}

/**
 * Replace everything in the account with a backup from the person's Drive.
 * What is there now is saved to Drive first (unless it already is), so a
 * restore can itself be undone by restoring that copy.
 */
export async function restoreFromDrive(userId: UserId, fileId: string, today: ISODate): Promise<RestoreResult> {
  let contents: Buffer;
  try {
    const token = await driveAccess(userId);
    // Only files in Hisab's own folder: the id comes from the person's request.
    if (!(await listFiles(token)).some((file) => file.id === fileId && isBackup(file))) {
      throw new DriveError("failed", "That backup is no longer in your Google Drive.");
    }
    contents = await downloadFile(token, fileId, BACKUP_MAX_BYTES);
  } catch (error) {
    throw asAppError(error);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(gunzipSync(contents, { maxOutputLength: BACKUP_MAX_BYTES }).toString("utf8"));
  } catch {
    throw invalid("That backup in Google Drive can't be read.");
  }

  try {
    await backupToDrive(userId, today);
  } catch (error) {
    const reason = error instanceof AppError ? ` (${error.message})` : "";
    throw new AppError(502, "drive_failed", `Hisab couldn't save what you have now to Google Drive first${reason}, so nothing was changed. Download a backup file, then try again.`);
  }
  return restoreBackup(userId, parsed);
}
