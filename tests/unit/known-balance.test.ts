import { describe, expect, it } from "vitest";
import { landsBefore, latestKnownBalance } from "@/lib/known-balance";

const today = "2026-09-28";

describe("where an entry lands against the latest known balance", () => {
  const opening = latestKnownBalance({ openingDate: "2026-09-01", lastUpdate: null });
  const update = latestKnownBalance({ openingDate: "2026-01-01", lastUpdate: { date: today, time: "14:05", balance: "500.00", source: "MANUAL" } });
  const smsNoTime = latestKnownBalance({ openingDate: "2026-01-01", lastUpdate: { date: "2026-09-20", time: null, balance: "1.00", source: "SMS" } });

  it("uses the newer of the opening balance and the last update", () => {
    expect(opening).toEqual({ date: "2026-09-01", time: "00:00", opening: true });
    expect(update).toMatchObject({ date: today, time: "14:05", opening: false });
    const updateBeforeOpening = { date: "2025-12-01", time: null, balance: "1.00", source: "MANUAL" as const };
    expect(latestKnownBalance({ openingDate: "2026-01-01", lastUpdate: updateBeforeOpening })).toMatchObject({ opening: true });
  });

  it("an opening balance holds from the very start of its day", () => {
    expect(landsBefore("2026-08-31", "", opening, today)).toBe(true);
    expect(landsBefore("2026-09-01", "", opening, today)).toBe(false);
    expect(landsBefore("2026-09-01", "00:00", opening, today)).toBe(false);
  });

  it("an update holds from its moment: earlier the same day is included, later isn't", () => {
    expect(landsBefore(today, "09:30", update, today)).toBe(true);
    expect(landsBefore(today, "14:05", update, today)).toBe(true);
    expect(landsBefore(today, "14:06", update, today)).toBe(false);
    // Without a time, something recorded today counts from now: after the update.
    expect(landsBefore(today, "", update, today)).toBe(false);
    expect(landsBefore("2026-09-27", "", update, today)).toBe(true);
  });

  it("an update without a time on an earlier day is the end of that day", () => {
    expect(landsBefore("2026-09-20", "", smsNoTime, today)).toBe(true);
    expect(landsBefore("2026-09-20", "23:59", smsNoTime, today)).toBe(true);
    expect(landsBefore("2026-09-21", "00:01", smsNoTime, today)).toBe(false);
  });
});
