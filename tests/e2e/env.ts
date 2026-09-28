export const E2E_PORT = Number(process.env.E2E_PORT ?? 3200);
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgresql://ledger:ledger@localhost:5432/ledger_e2e_test?schema=public";
/** Short on purpose: ADMIN_PASSWORD may be anything from 1 to 10 letters or digits. */
export const E2E_PASSWORD = "hisab2026";
