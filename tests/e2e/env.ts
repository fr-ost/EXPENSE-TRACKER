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
/** A certificate the server is told the Android app is signed with (ANDROID_CERT_SHA256). */
export const E2E_ANDROID_CERT = "5A:0E:9B:7C:11:D2:46:F8:03:AA:6D:E1:7B:90:C4:2F:38:65:BE:19:D7:4A:02:83:FC:51:9E:6B:A0:3D:C7:14";
