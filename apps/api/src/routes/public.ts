import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import {
  evaluateVisibility,
  parseFormSchema,
  validateAnswers,
} from "@axioforms/shared";
import { formVersions, forms, responses } from "../db/schema.js";
import { config } from "../config.js";

const slugParams = z.object({ slug: z.string().min(1).max(120) });

const submitBody = z.object({
  answers: z.record(z.unknown()).default({}),
});

function hashIp(ip: string): string {
  return createHash("sha256")
    .update(`${config.API_KEY_PEPPER}:${ip}`)
    .digest("hex")
    .slice(0, 32);
}

export async function publicRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/f/:slug",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { slug } = slugParams.parse(request.params);
      const [form] = await app.db.select().from(forms).where(eq(forms.slug, slug));
      if (!form || form.status !== "published") {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: "Formulaire introuvable ou non publié" },
        });
      }
      const [version] = await app.db
        .select()
        .from(formVersions)
        .where(eq(formVersions.formId, form.id))
        .orderBy(desc(formVersions.versionNumber))
        .limit(1);
      if (!version) {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: "Formulaire non publié" },
        });
      }
      return reply.send({
        id: form.id,
        slug: form.slug,
        title: version.schemaJson.title,
        description: version.schemaJson.description ?? form.description,
        versionNumber: version.versionNumber,
        schema: version.schemaJson,
      });
    },
  );

  app.post(
    "/f/:slug/responses",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { slug } = slugParams.parse(request.params);
      const { answers } = submitBody.parse(request.body);

      const [form] = await app.db.select().from(forms).where(eq(forms.slug, slug));
      if (!form || form.status !== "published") {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: "Formulaire introuvable ou non publié" },
        });
      }
      const [version] = await app.db
        .select()
        .from(formVersions)
        .where(eq(formVersions.formId, form.id))
        .orderBy(desc(formVersions.versionNumber))
        .limit(1);
      if (!version) {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: "Formulaire non publié" },
        });
      }

      const schema = parseFormSchema(version.schemaJson);
      const visible = evaluateVisibility(schema, answers);
      const result = validateAnswers(schema, answers, visible);
      if (!result.ok) {
        return reply.status(400).send({
          error: {
            code: "VALIDATION_FAILED",
            message: "Le formulaire contient des erreurs",
            details: result.errors,
          },
        });
      }

      const [row] = await app.db
        .insert(responses)
        .values({
          formId: form.id,
          formVersionId: version.id,
          data: result.data,
          meta: {
            ipHash: hashIp(request.ip),
            userAgent: request.headers["user-agent"]?.slice(0, 300),
          },
        })
        .returning();

      request.log.info(
        { formId: form.id, responseId: row!.id },
        "Réponse enregistrée",
      );
      return reply.status(201).send({
        responseId: row!.id,
        submittedAt: row!.submittedAt,
      });
    },
  );
}
