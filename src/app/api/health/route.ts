import { prisma } from "@/lib/server/db";
import { json } from "@/lib/server/http";

/** Public liveness + database check for the platform health probe. Reveals nothing else. */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return json({ status: "ok" });
  } catch {
    return json({ status: "unavailable" }, 503);
  }
}
