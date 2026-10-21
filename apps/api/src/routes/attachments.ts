import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { attachments } from "../db/schema.js";
import { config } from "../config.js";

const attachmentParams = z.object({ id: z.string().uuid() });

export async function attachmentRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/attachments/:id", async (request, reply) => {
    const { id } = attachmentParams.parse(request.params);
    const [row] = await app.db
      .select()
      .from(attachments)
      .where(eq(attachments.id, id));
    if (!row) {
      return reply.status(404).send({
        error: { code: "NOT_FOUND", message: "Pièce jointe introuvable" },
      });
    }
    const absPath = path.join(config.UPLOAD_DIR, row.storedPath);
    try {
      await fs.access(absPath);
    } catch {
      request.log.error({ storedPath: row.storedPath }, "Fichier manquant sur disque");
      return reply.status(404).send({
        error: { code: "FILE_MISSING", message: "Fichier absent du stockage" },
      });
    }
    reply.header("Content-Type", row.mimeType);
    reply.header("Content-Length", row.sizeBytes);
    reply.header(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
    );
    return reply.send(createReadStream(absPath));
  });
}
