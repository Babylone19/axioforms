import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import {
  attachments,
  formVersions,
  forms,
  responses,
} from "../db/schema.js";

const formParams = z.object({ id: z.string().uuid() });
const responseParams = z.object({
  id: z.string().uuid(),
  responseId: z.string().uuid(),
});

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  version: z.coerce.number().int().min(1).optional(),
  since: z.string().datetime({ offset: true }).optional(),
});

function notFound(message: string) {
  return { error: { code: "NOT_FOUND", message } };
}

const CSV_DELIMITER = ";";

function csvCell(value: unknown, delimiter = CSV_DELIMITER): string {
  if (value === null || value === undefined) return "";
  const text = Array.isArray(value)
    ? value.join(" | ")
    : typeof value === "object"
      ? typeof (value as { filename?: unknown }).filename === "string"
        ? (value as { filename: string }).filename
        : JSON.stringify(value)
      : String(value);
  const needsQuotes =
    text.includes(delimiter) || /["\r\n]/.test(text);
  if (needsQuotes) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export async function responseRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/forms/:id/responses", async (request, reply) => {
    const { id } = formParams.parse(request.params);
    const query = listQuery.parse(request.query);

    const [form] = await app.db
      .select({ id: forms.id })
      .from(forms)
      .where(eq(forms.id, id));
    if (!form) {
      return reply.status(404).send(notFound("Formulaire introuvable"));
    }

    const conditions = [eq(responses.formId, id)];
    if (query.version !== undefined) {
      conditions.push(eq(formVersions.versionNumber, query.version));
    }
    if (query.since !== undefined) {
      conditions.push(gte(responses.submittedAt, new Date(query.since)));
    }
    const where = and(...conditions);

    const [{ total }] = await app.db
      .select({ total: sql<number>`count(*)::int` })
      .from(responses)
      .innerJoin(formVersions, eq(responses.formVersionId, formVersions.id))
      .where(where);

    const rows = await app.db
      .select({
        id: responses.id,
        versionNumber: formVersions.versionNumber,
        data: responses.data,
        meta: responses.meta,
        submittedAt: responses.submittedAt,
      })
      .from(responses)
      .innerJoin(formVersions, eq(responses.formVersionId, formVersions.id))
      .where(where)
      .orderBy(desc(responses.submittedAt), desc(responses.id))
      .limit(query.limit)
      .offset(query.offset);

    const ids = rows.map((r) => r.id);
    const files =
      ids.length > 0
        ? await app.db
            .select({
              id: attachments.id,
              responseId: attachments.responseId,
              fieldId: attachments.fieldId,
              filename: attachments.filename,
              mimeType: attachments.mimeType,
              sizeBytes: attachments.sizeBytes,
            })
            .from(attachments)
            .where(inArray(attachments.responseId, ids))
        : [];

    const byResponse = new Map<string, typeof files>();
    for (const file of files) {
      if (!file.responseId) continue;
      const list = byResponse.get(file.responseId) ?? [];
      list.push(file);
      byResponse.set(file.responseId, list);
    }

    return {
      items: rows.map((row) => ({
        id: row.id,
        versionNumber: row.versionNumber,
        data: row.data,
        meta: row.meta,
        submittedAt: row.submittedAt,
        attachments: byResponse.get(row.id) ?? [],
      })),
      pagination: {
        total,
        limit: query.limit,
        offset: query.offset,
        hasMore: query.offset + rows.length < total,
      },
    };
  });

  app.get("/api/forms/:id/responses/export.csv", async (request, reply) => {
    const { id } = formParams.parse(request.params);

    const [form] = await app.db
      .select({ id: forms.id, slug: forms.slug })
      .from(forms)
      .where(eq(forms.id, id));
    if (!form) {
      return reply.status(404).send(notFound("Formulaire introuvable"));
    }

    const rows = await app.db
      .select({
        id: responses.id,
        versionNumber: formVersions.versionNumber,
        data: responses.data,
        submittedAt: responses.submittedAt,
      })
      .from(responses)
      .innerJoin(formVersions, eq(responses.formVersionId, formVersions.id))
      .where(eq(responses.formId, id))
      .orderBy(asc(responses.submittedAt), asc(responses.id));

    const fieldIds: string[] = [];
    for (const row of rows) {
      for (const key of Object.keys(row.data)) {
        if (!fieldIds.includes(key)) fieldIds.push(key);
      }
    }

    const header = ["response_id", "submitted_at", "version", ...fieldIds];
    const lines = [header.map((cell) => csvCell(cell)).join(CSV_DELIMITER)];
    for (const row of rows) {
      lines.push(
        [
          row.id,
          row.submittedAt.toISOString(),
          row.versionNumber,
          ...fieldIds.map((fieldId) => row.data[fieldId]),
        ]
          .map((cell) => csvCell(cell))
          .join(CSV_DELIMITER),
      );
    }
    const csv = `\uFEFF${lines.join("\r\n")}\r\n`;

    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header(
      "Content-Disposition",
      `attachment; filename="${form.slug}-responses.csv"`,
    );
    return reply.send(csv);
  });

  app.get("/api/forms/:id/responses/:responseId", async (request, reply) => {
    const params = responseParams.parse(request.params);

    const [row] = await app.db
      .select({
        id: responses.id,
        formId: responses.formId,
        versionNumber: formVersions.versionNumber,
        data: responses.data,
        meta: responses.meta,
        submittedAt: responses.submittedAt,
      })
      .from(responses)
      .innerJoin(formVersions, eq(responses.formVersionId, formVersions.id))
      .where(
        and(eq(responses.id, params.responseId), eq(responses.formId, params.id)),
      );
    if (!row) {
      return reply.status(404).send(notFound("Réponse introuvable"));
    }

    const files = await app.db
      .select({
        id: attachments.id,
        fieldId: attachments.fieldId,
        filename: attachments.filename,
        mimeType: attachments.mimeType,
        sizeBytes: attachments.sizeBytes,
        createdAt: attachments.createdAt,
      })
      .from(attachments)
      .where(eq(attachments.responseId, row.id));

    return {
      id: row.id,
      formId: row.formId,
      versionNumber: row.versionNumber,
      data: row.data,
      meta: row.meta,
      submittedAt: row.submittedAt,
      attachments: files.map((f) => ({
        ...f,
        url: `/api/attachments/${f.id}`,
      })),
    };
  });
}
