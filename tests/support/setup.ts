import { TEST_DATABASE_URL } from "./env";

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.ADMIN_PASSWORD = "test-pass-1";
