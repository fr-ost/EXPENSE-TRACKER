import { execSync } from "node:child_process";
import { Client } from "pg";
import { E2E_DATABASE_URL } from "./env";

/**
 * Fresh schema from the real migrations. No user row: the owner is created on
 * the first sign-in, exactly as on a fresh Railway deploy.
 */
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
}
