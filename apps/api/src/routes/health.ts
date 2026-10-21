import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async (_request, reply) => {
    try {
      await app.db.execute(sql`select 1`);
      return reply.send({ status: "ok", database: "up" });
    } catch {
      return reply.status(503).send({ status: "degraded", database: "down" });
    }
  });
}
