import { execSync } from "node:child_process";
import { Client } from "pg";
import { TEST_DATABASE_URL } from "./env";

/**
 * Rebuild the test schema from the real migrations (views and CHECK
 * constraints included). Refuses to run against anything that isn't
 * obviously a test database.
 */
export default async function setup() {
  const databaseName = new URL(TEST_DATABASE_URL).pathname.replace(/^\//, "");
  if (!databaseName.endsWith("_test")) {
    throw new Error(`Refusing to reset "${databaseName}": the test database name must end with "_test".`);
  }

  const client = new Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("CREATE SCHEMA public");
  } finally {
    await client.end();
  }

  execSync("npx prisma migrate deploy", {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
}
