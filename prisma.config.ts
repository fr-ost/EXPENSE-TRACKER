import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Read lazily so `prisma generate` works without a database (e.g. CI).
    url: process.env.DATABASE_URL ?? "",
  },
});
