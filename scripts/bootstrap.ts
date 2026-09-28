/**
 * Ensures the single user account exists. Runs before the server starts
 * (see `npm start`). There is no sign-up flow anywhere in the application:
 * this script is the only way the account is created.
 *
 * - No user yet: creates it from ADMIN_PASSWORD_HASH (required).
 * - User exists: does nothing, unless FORCE_PASSWORD_RESET=true, in which case
 *   the password is replaced from ADMIN_PASSWORD_HASH and every session is
 *   revoked. Remove the flag afterwards.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const ARGON2_PATTERN = /^\$argon2(id|i|d)\$v=\d+\$m=\d+,t=\d+,p=\d+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/;

function readPasswordHash(): string | null {
  const raw = process.env.ADMIN_PASSWORD_HASH?.trim();
  if (!raw) return null;
  const value = raw.startsWith("base64:") ? Buffer.from(raw.slice(7), "base64").toString("utf8") : raw;
  if (!ARGON2_PATTERN.test(value)) {
    throw new Error(
      "ADMIN_PASSWORD_HASH is not a valid Argon2 hash. Generate one with `npm run hash-password`. " +
        "(If the value looks truncated, your shell or .env loader may have expanded the '$' characters — use the base64: form.)",
    );
  }
  return value;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set.");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    const user = await prisma.user.findFirst({ select: { id: true } });
    const passwordHash = readPasswordHash();

    if (!user) {
      if (!passwordHash) {
        throw new Error(
          "No account exists yet. Set ADMIN_PASSWORD_HASH (generate it with `npm run hash-password`) and restart.",
        );
      }
      await prisma.user.create({
        data: {
          passwordHash,
          displayName: process.env.ADMIN_DISPLAY_NAME?.trim().slice(0, 60) ?? "",
          baseCurrency: process.env.DEFAULT_CURRENCY?.trim().toUpperCase() || "BDT",
          timezone: process.env.DEFAULT_TIMEZONE?.trim() || "Asia/Dhaka",
        },
      });
      console.log("[bootstrap] Account created.");
      return;
    }

    if (process.env.FORCE_PASSWORD_RESET === "true") {
      if (!passwordHash) throw new Error("FORCE_PASSWORD_RESET is set but ADMIN_PASSWORD_HASH is empty.");
      await prisma.$transaction([
        prisma.user.update({ where: { id: user.id }, data: { passwordHash, passwordChangedAt: new Date() } }),
        prisma.session.deleteMany({}),
      ]);
      console.warn("[bootstrap] Password reset from ADMIN_PASSWORD_HASH; all sessions revoked. Remove FORCE_PASSWORD_RESET now.");
      return;
    }

    console.log("[bootstrap] Account exists; nothing to do.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(`[bootstrap] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
