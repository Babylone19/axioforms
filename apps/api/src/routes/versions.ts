import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, desc, eq, max } from "drizzle-orm";
import { parseFormSchema } from "@axioforms/shared";
import { formVersions, forms } from "../db/schema.js";

const formParams = z.object({ id: z.string().uuid() });
const versionParams = z.object({
  id: z.string().uuid(),
  version: z.coerce.number().int().positive(),
});

function versionSummary(row: typeof formVersions.$inferSelect) {
  return {
    id: row.id,
    formId: row.formId,
    versionNumber: row.versionNumber,
    title: (row.schemaJson as { title: string }).title,
    fieldCount: (row.schemaJson as { fields: unknown[] }).fields.length,
    createdAt: row.createdAt,
  };
}

export async function versionRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/forms/:id/publish", async (request, reply) => {
    const { id } = formParams.parse(request.params);
    const [form] = await app.db.select().from(forms).where(eq(forms.id, id));
    if (!form) {
      return reply.status(404).send({
        error: { code: "NOT_FOUND", message: "Formulaire introuvable" },
      });
    }
    if (!form.schemaDraft) {
      return reply.status(400).send({
        error: {
          code: "NO_DRAFT",
          message: "Aucun schéma à publier : enregistrez un schéma d'abord",
        },
      });
    }
    const schema = parseFormSchema(form.schemaDraft);

    const result = await app.db.transaction(async (tx) => {
      const [{ next }] = await tx
        .select({ next: max(formVersions.versionNumber) })
        .from(formVersions)
        .where(eq(formVersions.formId, id));
      const versionNumber = (next ?? 0) + 1;
      const [version] = await tx
        .insert(formVersions)
        .values({ formId: id, versionNumber, schemaJson: schema })
        .returning();
      await tx
        .update(forms)
        .set({ status: "published", updatedAt: new Date() })
        .where(eq(forms.id, id));
      return version!;
    });

    return reply.status(201).send({
      ...versionSummary(result),
      publicUrl: `/f/${form.slug}`,
    });
  });

  app.get("/api/forms/:id/versions", async (request, reply) => {
    const { id } = formParams.parse(request.params);
    const rows = await app.db
      .select()
      .from(formVersions)
      .where(eq(formVersions.formId, id))
      .orderBy(desc(formVersions.versionNumber));
    return reply.send({ items: rows.map(versionSummary) });
  });

  app.get("/api/forms/:id/published", async (request, reply) => {
    const { id } = formParams.parse(request.params);
    const [row] = await app.db
      .select()
      .from(formVersions)
      .where(eq(formVersions.formId, id))
      .orderBy(desc(formVersions.versionNumber))
      .limit(1);
    if (!row) {
      return reply.status(404).send({
        error: {
          code: "NOT_PUBLISHED",
          message: "Ce formulaire n'a jamais été publié",
        },
      });
    }
    return reply.send({
      ...versionSummary(row),
      schema: row.schemaJson,
    });
  });

  app.get("/api/forms/:id/versions/:version", async (request, reply) => {
    const { id, version } = versionParams.parse(request.params);
    const [row] = await app.db
      .select()
      .from(formVersions)
      .where(
        and(eq(formVersions.formId, id), eq(formVersions.versionNumber, version)),
      );
    if (!row) {
      return reply.status(404).send({
        error: { code: "NOT_FOUND", message: "Version introuvable" },
      });
    }
    return reply.send({ ...versionSummary(row), schema: row.schemaJson });
  });
}
