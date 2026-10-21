import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { defineConfig } from "drizzle-kit";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
loadEnv({ path: path.join(rootDir, ".env") });

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
