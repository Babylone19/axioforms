import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { z } from "zod";

function findRoot(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 6; i++) {
    const pkgPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
          workspaces?: unknown;
        };
        if (pkg.workspaces) return dir;
      } catch {
        // ignore
      }
    }
    dir = path.dirname(dir);
  }
  return startDir;
}

const rootDir = findRoot(path.dirname(fileURLToPath(import.meta.url)));
loadEnv({ path: path.join(rootDir, ".env") });

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default("0.0.0.0"),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL est requis (cf. .env.example)"),
  API_KEY_PEPPER: z.string().min(8, "API_KEY_PEPPER doit faire au moins 8 caractères"),
  UPLOAD_DIR: z.string().default("./uploads"),
  MAX_UPLOAD_SIZE_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  ADMIN_ORIGIN: z.string().default("http://localhost:5173"),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Configuration invalide :", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
