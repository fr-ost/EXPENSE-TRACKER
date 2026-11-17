import { defineConfig, devices } from "@playwright/test";
import {
  E2E_ANDROID_CERT,
  E2E_DATABASE_URL,
  E2E_GOOGLE_CLIENT_ID,
  E2E_GOOGLE_CLIENT_SECRET,
  E2E_OWNER_EMAIL,
  E2E_PORT,
  FAKE_GOOGLE_ORIGIN,
  FAKE_GOOGLE_PORT,
} from "./tests/e2e/env";

/**
 * End-to-end tests run against a production build on an isolated database
 * (its name must end in "_test"; it is wiped on every run). People sign in
 * through a local stand-in for Google (tests/e2e/fake-google.mjs).
 *
 *   npm run build && npm run test:e2e
 *
 * Set CHROMIUM_PATH to use a pre-installed Chromium instead of Playwright's.
 */
export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${E2E_PORT}`,
    // A new account takes the browser's timezone; the tests' dates and SMS times are Dhaka's.
    timezoneId: "Asia/Dhaka",
    trace: "retain-on-failure",
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : undefined,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 860 } }, grepInvert: /@mobile/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, grep: /@mobile/ },
  ],
  webServer: [
    {
      command: "node tests/e2e/fake-google.mjs",
      url: `${FAKE_GOOGLE_ORIGIN}/healthz`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        FAKE_GOOGLE_PORT: String(FAKE_GOOGLE_PORT),
        GOOGLE_CLIENT_ID: E2E_GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET: E2E_GOOGLE_CLIENT_SECRET,
      },
    },
    {
      command: `npx next start -p ${E2E_PORT}`,
      url: `http://localhost:${E2E_PORT}/login`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        DATABASE_URL: E2E_DATABASE_URL,
        NODE_ENV: "production",
        GOOGLE_CLIENT_ID: E2E_GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET: E2E_GOOGLE_CLIENT_SECRET,
        GOOGLE_TEST_ORIGIN: FAKE_GOOGLE_ORIGIN,
        OWNER_EMAIL: E2E_OWNER_EMAIL,
        // Pasted the way people paste: lower case, a stray space.
        ANDROID_CERT_SHA256: ` ${E2E_ANDROID_CERT.toLowerCase()}`,
      },
    },
  ],
});
