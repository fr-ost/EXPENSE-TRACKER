import { runHeavy } from "@/lib/server/busy";
import { authed, json } from "@/lib/server/http";
import { backupToDrive, listDriveBackups } from "@/lib/server/services/drive";
import { getToday } from "@/lib/server/settings";

/** The backups in your Google Drive, newest first. */
export const GET = authed(async ({ userId }) => json({ backups: await listDriveBackups(userId) }), { metered: true });

/** "Back up now": save a copy of the ledger to your Google Drive. */
export const POST = authed(async ({ userId }) =>
  runHeavy(userId, async () => json(await backupToDrive(userId, await getToday(userId), { always: true }))),
);
