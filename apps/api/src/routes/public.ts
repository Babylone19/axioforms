import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import {
  evaluateVisibility,
  parseFormSchema,
  validateAnswers,
  type FormSchema,
} from "@axioforms/shared";
import { attachments, formVersions, forms, responses } from "../db/schema.js";
import { config } from "../config.js";
import {
  FileValidationError,
  removeStoredFiles,
  validateAndStoreFile,
  type IncomingFile,
  type StoredFileInfo,
} from "../lib/files.js";

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

interface ParsedSubmission {
  answers: Record<string, unknown>;
  files: Map<string, IncomingFile>;
}

function isWrappedAnswers(json: Record<string, unknown>): boolean {
  return (
    Object.keys(json).length === 1 &&
    typeof json.answers === "object" &&
    json.answers !== null &&
    !Array.isArray(json.answers)
  );
}

async function parseSubmission(request: {
  isMultipart: () => boolean;
  body?: unknown;
  parts: () => AsyncIterableIterator<unknown>;
}): Promise<ParsedSubmission> {
  if (!request.isMultipart()) {
    const { answers } = submitBody.parse(request.body);
    return { answers, files: new Map() };
  }

  const answers: Record<string, unknown> = {};
  const files = new Map<string, IncomingFile>();

  for await (const part of request.parts()) {
    const p = part as {
      type: "file" | "field";
      fieldname: string;
      value?: string;
      filename?: string;
      toBuffer: () => Promise<Buffer>;
      file?: { truncated: boolean };
    };
    if (p.type === "file") {
      const fieldId = p.fieldname.replace(/^file_/, "");
      const buffer = await p.toBuffer();
      if (p.file?.truncated) {
        const mo = Math.round(config.MAX_UPLOAD_SIZE_BYTES / (1024 * 1024));
        throw new FileValidationError(
          fieldId,
          `Fichier trop volumineux (maximum ${mo} Mo)`,
        );
      }
      if (!files.has(fieldId)) {
        files.set(fieldId, {
          buffer,
          filename: p.filename ?? "fichier",
          mimeType: p.mimetype ?? "application/octet-stream",
        });
      }
    } else if (p.fieldname === "answers") {
      const json = JSON.parse(p.value ?? "{}") as Record<string, unknown>;
      const unwrapped = isWrappedAnswers(json)
        ? (json.answers as Record<string, unknown>)
        : json;
      Object.assign(answers, unwrapped);
    } else {
      answers[p.fieldname] = p.value;
    }
  }
  return { answers, files };
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
      const { answers, files } = await parseSubmission(
        request as Parameters<typeof parseSubmission>[0],
      );

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

      const schema: FormSchema = parseFormSchema(version.schemaJson);

      for (const [fieldId] of files) {
        if (answers[fieldId] === undefined) answers[fieldId] = "__uploaded__";
      }

      const visible = evaluateVisibility(schema, answers);
      const storedFiles: StoredFileInfo[] = [];
      const fileMeta: Record<string, StoredFileInfo> = {};
      const errors: Record<string, string> = {};

      try {
        for (const [fieldId, file] of files) {
          const field = schema.fields.find(
            (f) => f.id === fieldId && f.type === "file",
          );
          if (!field || !visible.has(fieldId)) continue;
          try {
            const stored = await validateAndStoreFile(form.id, field, file);
            storedFiles.push(stored);
            fileMeta[fieldId] = stored;
            answers[fieldId] = stored.id;
          } catch (e) {
            if (e instanceof FileValidationError) {
              errors[e.fieldId] = e.message;
            } else {
              throw e;
            }
          }
        }

        if (Object.keys(errors).length > 0) {
          await removeStoredFiles(storedFiles);
          return reply.status(400).send({
            error: {
              code: "VALIDATION_FAILED",
              message: "Le formulaire contient des erreurs",
              details: errors,
            },
          });
        }

        const result = validateAnswers(schema, answers, visible);
        if (!result.ok) {
          await removeStoredFiles(storedFiles);
          return reply.status(400).send({
            error: {
              code: "VALIDATION_FAILED",
              message: "Le formulaire contient des erreurs",
              details: result.errors,
            },
          });
        }

        const data = { ...result.data };
        for (const [fieldId, meta] of Object.entries(fileMeta)) {
          data[fieldId] = {
            id: meta.id,
            filename: meta.filename,
            sizeBytes: meta.sizeBytes,
            mimeType: meta.mimeType,
          };
        }

        const row = await app.db.transaction(async (tx) => {
          const [inserted] = await tx
            .insert(responses)
            .values({
              formId: form.id,
              formVersionId: version.id,
              data,
              meta: {
                ipHash: hashIp(request.ip),
                userAgent:
                  request.headers["user-agent"]?.slice(0, 300) ?? undefined,
              },
            })
            .returning();
          if (storedFiles.length > 0) {
            for (const stored of storedFiles) {
              await tx.insert(attachments).values({
                id: stored.id,
                responseId: inserted!.id,
                fieldId:
                  Object.entries(fileMeta).find(
                    ([, m]) => m.id === stored.id,
                  )?.[0] ?? "unknown",
                filename: stored.filename,
                storedPath: stored.storedPath,
                mimeType: stored.mimeType,
                sizeBytes: stored.sizeBytes,
              });
            }
          }
          return inserted!;
        });

        request.log.info(
          { formId: form.id, responseId: row.id },
          "Réponse enregistrée",
        );
        return reply.status(201).send({
          responseId: row.id,
          submittedAt: row.submittedAt,
        });
      } catch (e) {
        if (e instanceof FileValidationError) {
          await removeStoredFiles(storedFiles);
          return reply.status(400).send({
            error: {
              code: "VALIDATION_FAILED",
              message: "Le formulaire contient des erreurs",
              details: { [e.fieldId]: e.message },
            },
          });
        }
        throw e;
      }
    },
  );
}
