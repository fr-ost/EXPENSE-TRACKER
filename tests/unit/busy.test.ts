import { describe, expect, it } from "vitest";
import { runHeavy, runHeavyInTurn } from "@/lib/server/busy";
import type { UserId } from "@/lib/server/user-id";

/** Work that finishes when told to. */
function job() {
  let finish!: () => void;
  const done = new Promise<void>((resolve) => (finish = resolve));
  return { run: () => done.then(() => "done"), finish };
}
const user = (name: string) => name as UserId;

describe("heavy work (backups, restores) is rationed", () => {
  it("one at a time per person, three at once overall; the rest are asked to come back", async () => {
    const jobs = [job(), job(), job()];
    const running = jobs.map((j, i) => runHeavy(user(`u${i}`), j.run));

    // The same person again, and a fourth person, are turned away at once.
    await expect(runHeavy(user("u0"), async () => "again")).rejects.toMatchObject({ status: 429, retryAfterSeconds: 5, message: expect.stringMatching(/still working on your last backup/) });
    await expect(runHeavy(user("u3"), async () => "fourth")).rejects.toMatchObject({ status: 429, message: expect.stringMatching(/busy with other backups/) });

    // When one finishes there is room again — for that person too.
    jobs[0].finish();
    expect(await running[0]).toBe("done");
    expect(await runHeavy(user("u0"), async () => "again")).toBe("again");
    jobs[1].finish();
    jobs[2].finish();
    await Promise.all(running);

    // A failure gives its place back as well.
    await expect(runHeavy(user("u9"), async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(await runHeavy(user("u9"), async () => "after")).toBe("after");
  });

  it("in the background: two at once, the others wait their turn instead of being dropped", async () => {
    const started: number[] = [];
    const jobs = [job(), job(), job(), job()];
    const all = jobs.map((j, i) =>
      runHeavyInTurn(async () => {
        started.push(i);
        return j.run();
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(started).toEqual([0, 1]);
    jobs[0].finish();
    await all[0];
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(started).toEqual([0, 1, 2]);
    jobs[1].finish();
    jobs[2].finish();
    jobs[3].finish();
    expect(await Promise.all(all)).toEqual(["done", "done", "done", "done"]);
    expect(started).toEqual([0, 1, 2, 3]);
  });
});
