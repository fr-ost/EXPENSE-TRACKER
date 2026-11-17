import { authed, json } from "@/lib/server/http";
import { disconnectDrive, getDriveStatus } from "@/lib/server/services/drive";

/** Where backups to Google Drive stand. */
export const GET = authed(async ({ userId }) => json(await getDriveStatus(userId)));

/** Disconnect Google Drive: no more backups there, and the permission is handed back. Backups already there stay. */
export const DELETE = authed(async ({ userId }) => {
  await disconnectDrive(userId);
  return json({ ok: true });
});
