import "server-only";
import { tooManyRequests } from "./errors";
import type { UserId } from "./user-id";

/**
 * Work that holds a whole ledger in memory — a backup, a restore — runs a few
 * at a time, so a burst of it can't exhaust the server.
 *
 * Asked for by a person (`runHeavy`): one at a time each, three at once
 * overall; beyond that they are told to try again in a moment rather than
 * kept waiting. In the background (`runHeavyInTurn`, the automatic backups):
 * two at once, the rest wait their turn.
 */
const MAX_AT_ONCE = 3;
const MAX_IN_BACKGROUND = 2;

let running = 0;
const busyUsers = new Set<UserId>();

export async function runHeavy<T>(userId: UserId, work: () => Promise<T>): Promise<T> {
  if (busyUsers.has(userId)) throw tooManyRequests("Hisab is still working on your last backup. Try again in a moment.", 5);
  if (running >= MAX_AT_ONCE) throw tooManyRequests("Hisab is busy with other backups. Try again in a moment.", 5);
  running++;
  busyUsers.add(userId);
  try {
    return await work();
  } finally {
    running--;
    busyUsers.delete(userId);
  }
}

let inBackground = 0;
const waiting: Array<() => void> = [];

export async function runHeavyInTurn<T>(work: () => Promise<T>): Promise<T> {
  if (inBackground >= MAX_IN_BACKGROUND) await new Promise<void>((next) => waiting.push(next));
  inBackground++;
  try {
    return await work();
  } finally {
    inBackground--;
    waiting.shift()?.();
  }
}
