/** Integration tests run against a dedicated database, never DATABASE_URL. */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://ledger:ledger@localhost:5432/ledger_test?schema=public";
