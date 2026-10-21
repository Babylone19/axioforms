import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, asc, eq, isNull } from "drizzle-orm";
import { apiKeys } from "../db/schema.js";
import { config } from "../config.js";
import { generateApiKey } from "../lib/apiKeys.js";

const createKeyBody = z.object({
  name: z.string().min(1).max(100),
});

const keySummary = (row: {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: Date;
  revokedAt: Date | null;
}) => ({
  id: row.id,
  name: row.name,
  keyPrefix: row.keyPrefix,
  createdAt: row.createdAt,
  revoked: row.revokedAt !== null,
});

export async function keyRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/keys", async (request, reply) => {
    const body = createKeyBody.parse(request.body);
    const { key, prefix, hash } = generateApiKey(config.API_KEY_PEPPER);
    const [row] = await app.db
      .insert(apiKeys)
      .values({ name: body.name, keyPrefix: prefix, keyHash: hash })
      .returning();
    request.log.info({ keyPrefix: prefix }, "Clé API créée");
    return reply.status(201).send({
      // La clé n'est affichée qu'une seule fois, à la création
      apiKey: key,
      ...keySummary(row!),
    });
  });

  app.get("/api/keys", async (_request, reply) => {
    const rows = await app.db
      .select()
      .from(apiKeys)
      .orderBy(asc(apiKeys.createdAt));
    return reply.send({ items: rows.map(keySummary) });
  });

  app.delete("/api/keys/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const [row] = await app.db
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(isNull(apiKeys.revokedAt), eq(apiKeys.id, id)))
      .returning();
    if (!row) {
      return reply.status(404).send({
        error: { code: "NOT_FOUND", message: "Clé API introuvable ou déjà révoquée" },
      });
    }
    return reply.send(keySummary(row));
  });
}
