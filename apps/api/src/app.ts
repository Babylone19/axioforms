import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { config } from "./config.js";
import { db, type Database } from "./db/index.js";
import { registerErrorHandler } from "./plugins/errors.js";

export interface AppDeps {
  db?: Database;
}

export async function buildApp(deps: AppDeps = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.NODE_ENV === "test" ? "silent" : "info",
      transport:
        config.NODE_ENV === "development"
          ? { target: "pino-pretty", options: { translateTime: "HH:MM:ss" } }
          : undefined,
    },
    bodyLimit: config.MAX_UPLOAD_SIZE_BYTES + 1024 * 1024,
  });

  app.decorate("db", deps.db ?? db);

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: config.ADMIN_ORIGIN,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
  });
  await app.register(rateLimit, {
    global: true,
    max: 200,
    timeWindow: "1 minute",
  });

  registerErrorHandler(app);

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    db: Database;
  }
}
