import "server-only";
import { tooManyRequests } from "./errors";

/**
 * Work that holds a whole ledger in memory (a backup, a restore) runs a few
 * at a time, so a burst of them can't exhaust the server. More than that are
 * asked to come back in a moment rather than queued.
 */
const MAX_AT_ONCE = 3;
let running = 0;

export async function runHeavy<T>(work: () => Promise<T>): Promise<T> {
  if (running >= MAX_AT_ONCE) throw tooManyRequests("Hisab is busy with other backups. Try again in a moment.", 5);
  running++;
  try {
    return await work();
  } finally {
    running--;
  }
}
