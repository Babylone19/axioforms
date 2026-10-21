import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { parseFormSchema } from "@axioforms/shared";
import { forms } from "../db/schema.js";
import { slugify } from "../lib/slug.js";

const schemaInput = z.unknown();

const createFormBody = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  schema: schemaInput.optional(),
  webhookUrl: z
    .string()
    .url()
    .refine((u) => /^https?:\/\//i.test(u), {
      message: "L'URL du webhook doit être en http(s)",
    })
    .optional(),
});

const updateFormBody = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional().nullable(),
  schema: schemaInput.optional(),
  webhookUrl: z
    .string()
    .url()
    .refine((u) => /^https?:\/\//i.test(u), {
      message: "L'URL du webhook doit être en http(s)",
    })
    .nullable()
    .optional(),
});

const formParams = z.object({ id: z.string().uuid() });

function toSummary(row: typeof forms.$inferSelect) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    status: row.status,
    webhookUrl: row.webhookUrl,
    publicUrl: `/f/${row.slug}`,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    hasDraftSchema: row.schemaDraft !== null,
  };
}

function toDetail(row: typeof forms.$inferSelect) {
  return {
    ...toSummary(row),
    schema: row.schemaDraft,
  };
}

export async function formRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/forms", async (request, reply) => {
    const body = createFormBody.parse(request.body);
    const draft = body.schema !== undefined ? parseFormSchema(body.schema) : null;
    const [row] = await app.db
      .insert(forms)
      .values({
        slug: slugify(body.title),
        title: body.title,
        description: body.description,
        webhookUrl: body.webhookUrl,
        schemaDraft: draft ?? undefined,
      })
      .returning();
    return reply.status(201).send(toDetail(row!));
  });

  app.get("/api/forms", async (_request, reply) => {
    const rows = await app.db
      .select()
      .from(forms)
      .orderBy(desc(forms.createdAt));
    return reply.send({ items: rows.map(toSummary) });
  });

  app.get("/api/forms/:id", async (request, reply) => {
    const { id } = formParams.parse(request.params);
    const [row] = await app.db.select().from(forms).where(eq(forms.id, id));
    if (!row) {
      return reply.status(404).send({
        error: { code: "NOT_FOUND", message: "Formulaire introuvable" },
      });
    }
    return reply.send(toDetail(row));
  });

  app.patch("/api/forms/:id", async (request, reply) => {
    const { id } = formParams.parse(request.params);
    const body = updateFormBody.parse(request.body);
    const [existing] = await app.db
      .select()
      .from(forms)
      .where(eq(forms.id, id));
    if (!existing) {
      return reply.status(404).send({
        error: { code: "NOT_FOUND", message: "Formulaire introuvable" },
      });
    }
    const patch: Partial<typeof forms.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (body.title !== undefined) patch.title = body.title;
    if (body.description !== undefined) patch.description = body.description;
    if (body.webhookUrl !== undefined) patch.webhookUrl = body.webhookUrl;
    if (body.schema !== undefined) {
      patch.schemaDraft = parseFormSchema(body.schema);
    }
    const [row] = await app.db
      .update(forms)
      .set(patch)
      .where(eq(forms.id, id))
      .returning();
    return reply.send(toDetail(row!));
  });

  app.delete("/api/forms/:id", async (request, reply) => {
    const { id } = formParams.parse(request.params);
    const [row] = await app.db
      .delete(forms)
      .where(eq(forms.id, id))
      .returning();
    if (!row) {
      return reply.status(404).send({
        error: { code: "NOT_FOUND", message: "Formulaire introuvable" },
      });
    }
    return reply.status(204).send();
  });
}
