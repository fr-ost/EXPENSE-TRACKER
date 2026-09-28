import "server-only";
import { formatDate, fromDbDate, isValidTimeZone } from "@/lib/dates";
import type { SessionInfo } from "@/lib/types";
import type { SettingsInput } from "@/lib/validation";
import { prisma } from "../db";
import { invalid } from "../errors";

export async function updateSettings(input: SettingsInput) {
  if (!isValidTimeZone(input.timezone)) throw invalid("Choose a valid timezone.", { timezone: "Unknown timezone." });
  await prisma.user.updateMany({ data: input });
}

function ago(date: Date): string {
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutes < 2) return "active now";
  if (minutes < 60) return `active ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `active ${hours} h ago`;
  return `active ${Math.round(hours / 24)} d ago`;
}

function describeUserAgent(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Chrome\//.test(userAgent)
      ? "Chrome"
      : /Firefox\//.test(userAgent)
        ? "Firefox"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : "Browser";
  const os = /iPhone|iPad/.test(userAgent)
    ? "iOS"
    : /Android/.test(userAgent)
      ? "Android"
      : /Mac OS X/.test(userAgent)
        ? "macOS"
        : /Windows/.test(userAgent)
          ? "Windows"
          : /Linux/.test(userAgent)
            ? "Linux"
            : "";
  return os ? `${browser} on ${os}` : browser;
}

export async function listSessions(currentId: string): Promise<SessionInfo[]> {
  const sessions = await prisma.session.findMany({
    where: { expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: "desc" },
    select: { id: true, createdAt: true, lastSeenAt: true, userAgent: true },
  });
  // Session ids are token hashes; they are never sent to the browser.
  return sessions.map((s) => ({
    current: s.id === currentId,
    signedIn: formatDate(fromDbDate(s.createdAt)),
    lastActive: s.id === currentId ? "active now" : ago(s.lastSeenAt),
    device: describeUserAgent(s.userAgent),
  }));
}
