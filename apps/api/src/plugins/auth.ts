import type { FastifyReply, FastifyRequest } from "fastify";
import { and, eq, isNull } from "drizzle-orm";
import { config } from "../config.js";
import { apiKeys } from "../db/schema.js";
import { parseApiKey, verifyApiKey } from "../lib/apiKeys.js";

declare module "fastify" {
  interface FastifyRequest {
    apiKeyId: string | null;
  }
}

export async function requireApiKey(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const header = request.headers["x-api-key"];
  const presented = Array.isArray(header) ? header[0] : header;
  if (!presented) {
    return reply.status(401).send({
      error: { code: "UNAUTHORIZED", message: "En-tête X-API-Key manquant" },
    });
  }
  const parsed = parseApiKey(presented);
  if (!parsed) {
    return reply.status(401).send({
      error: { code: "UNAUTHORIZED", message: "Clé API invalide" },
    });
  }
  const [row] = await request.server.db
    .select()
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.keyPrefix, parsed.prefix),
        isNull(apiKeys.revokedAt),
      ),
    )
    .limit(1);
  if (!row || !verifyApiKey(presented, row.keyHash, config.API_KEY_PEPPER)) {
    return reply.status(401).send({
      error: { code: "UNAUTHORIZED", message: "Clé API invalide ou révoquée" },
    });
  }
  request.apiKeyId = row.id;
}
