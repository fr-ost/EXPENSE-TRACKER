import { BACKUP_MAX_BYTES } from "@/lib/backup";
import { runHeavy } from "@/lib/server/busy";
import { AppError } from "@/lib/server/errors";
import { authed, json, readJson } from "@/lib/server/http";
import { restoreBackup } from "@/lib/server/services/backup";
import { restoreInput } from "@/lib/validation";

/**
 * Replace everything in your account with the contents of a backup file.
 * All or nothing: if the file can't be restored, nothing changes. The body
 * must say so ({ "confirm": "REPLACE", "backup": … }).
 */
export const POST = authed(async ({ request, userId }) => {
  // Refuse an oversized upload before reading any of it.
  if (Number(request.headers.get("content-length") ?? 0) > BACKUP_MAX_BYTES) {
    throw new AppError(413, "payload_too_large", "That file is too large to be a Hisab backup.");
  }
  return runHeavy(userId, async () => {
    const { backup } = await readJson(request, restoreInput, BACKUP_MAX_BYTES);
    return json(await restoreBackup(userId, backup));
  });
});
