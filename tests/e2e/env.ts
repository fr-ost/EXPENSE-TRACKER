export const E2E_PORT = Number(process.env.E2E_PORT ?? 3200);
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgresql://ledger:ledger@localhost:5432/ledger_e2e_test?schema=public";
export const E2E_PASSWORD = "e2e-correct-horse-battery";
