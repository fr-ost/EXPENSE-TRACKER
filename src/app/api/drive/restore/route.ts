import { runHeavy } from "@/lib/server/busy";
import { authed, json, readJson } from "@/lib/server/http";
import { restoreFromDrive } from "@/lib/server/services/drive";
import { getToday } from "@/lib/server/settings";
import { driveRestoreInput } from "@/lib/validation";

/**
 * Replace everything in your account with one of the backups in your Google
 * Drive. What is there now is saved to Drive first; all or nothing.
 */
export const POST = authed(async ({ request, userId }) => {
  const { fileId } = await readJson(request, driveRestoreInput);
  return runHeavy(userId, async () => json(await restoreFromDrive(userId, fileId, await getToday(userId))));
});
