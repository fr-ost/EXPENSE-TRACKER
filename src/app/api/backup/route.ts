import { runHeavy } from "@/lib/server/busy";
import { download } from "@/lib/server/export/download";
import { authed } from "@/lib/server/http";
import { backupFileName, exportBackup } from "@/lib/server/services/backup";
import { getToday } from "@/lib/server/settings";

/** Everything you have recorded, as one backup file. */
export const GET = authed(
  async ({ userId }) =>
    runHeavy(userId, async () => {
      const today = await getToday(userId);
      return download(JSON.stringify(await exportBackup(userId, today)), backupFileName(today), "application/json; charset=utf-8");
    }),
  { metered: true },
);
