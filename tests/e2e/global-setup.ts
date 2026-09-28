import { hash } from "@node-rs/argon2";
import { execSync } from "node:child_process";
import { Client } from "pg";
import { E2E_DATABASE_URL, E2E_PASSWORD } from "./env";

/** Fresh schema from the real migrations, plus the single user with a known password. */
export default async function globalSetup() {
  const name = new URL(E2E_DATABASE_URL).pathname.replace(/^\//, "");
  if (!name.endsWith("_test")) throw new Error(`Refusing to reset "${name}": the e2e database name must end with "_test".`);

  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("CREATE SCHEMA public");
  } finally {
    await client.end();
  }
  execSync("npx prisma migrate deploy", { stdio: "pipe", env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL } });

  const passwordHash = await hash(E2E_PASSWORD, { memoryCost: 19_456, timeCost: 2, parallelism: 1 });
  const seed = new Client({ connectionString: E2E_DATABASE_URL });
  await seed.connect();
  try {
    await seed.query(
      `INSERT INTO "User" ("id", "passwordHash", "displayName", "autoLockMinutes", "updatedAt") VALUES ('e2e-user', $1, 'Tester', 15, now())`,
      [passwordHash],
    );
  } finally {
    await seed.end();
  }
}
