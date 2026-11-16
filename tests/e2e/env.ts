export const E2E_PORT = Number(process.env.E2E_PORT ?? 3200);
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgresql://ledger:ledger@localhost:5432/ledger_e2e_test?schema=public";

/** The stand-in for Google that the tests sign in through (tests/e2e/fake-google.mjs). */
export const FAKE_GOOGLE_PORT = Number(process.env.FAKE_GOOGLE_PORT ?? 3201);
export const FAKE_GOOGLE_ORIGIN = `http://localhost:${FAKE_GOOGLE_PORT}`;
export const E2E_GOOGLE_CLIENT_ID = "hisab-e2e.apps.googleusercontent.com";
export const E2E_GOOGLE_CLIENT_SECRET = "e2e-client-secret";
/** Whose earlier ledger the first sign-in with this address takes over (see OWNER_EMAIL). */
export const E2E_OWNER_EMAIL = "owner@example.com";
