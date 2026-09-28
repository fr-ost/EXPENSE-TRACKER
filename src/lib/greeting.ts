/** Time-of-day greeting in the owner's timezone (Settings → Timezone). */

export type DayPart = "morning" | "afternoon" | "evening";

export function dayPart(hour: number): DayPart {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  return "evening";
}

export function hourIn(timeZone: string, now: Date = new Date()): number {
  try {
    return Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone }).format(now)) % 24;
  } catch {
    return now.getUTCHours();
  }
}

/** "Good morning", "Good afternoon" or "Good evening". */
export function greeting(timeZone: string, now: Date = new Date()): string {
  return `Good ${dayPart(hourIn(timeZone, now))}`;
}
