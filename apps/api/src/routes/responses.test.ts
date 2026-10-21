import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { desc, eq, inArray } from "drizzle-orm";
import { buildApp } from "../app.js";
import { registerRoutes } from "../routes/index.js";
import { db, sqlClient } from "../db/index.js";
import { apiKeys, formVersions, forms, responses } from "../db/schema.js";
import { config } from "../config.js";
import { generateApiKey } from "../lib/apiKeys.js";

let app: FastifyInstance;
let key: string;
let keyId: string;
let formId: string;
let slug: string;
const createdFormIds: string[] = [];

const baseSchema = {
  title: "Contact",
  fields: [
    { id: "name", type: "text", label: "Nom", required: true },
    { id: "email", type: "email", label: "Email", required: true },
    {
      id: "plan",
      type: "select",
      label: "Formule",
      required: true,
      options: [
        { value: "basic", label: "Basic" },
        { value: "pro", label: "Pro" },
      ],
    },
    { id: "notes", type: "textarea", label: "Notes" },
  ],
};

async function submit(answers: Record<string, unknown>) {
  const res = await app.inject({
    method: "POST",
    url: `/api/public/f/${slug}/responses`,
    payload: { answers },
  });
  expect(res.statusCode).toBe(201);
  return res.json().responseId as string;
}

beforeAll(async () => {
  app = await buildApp();
  await registerRoutes(app);
  await app.ready();

  const generated = generateApiKey(config.API_KEY_PEPPER);
  key = generated.key;
  const [keyRow] = await db
    .insert(apiKeys)
    .values({
      name: "test responses",
      keyPrefix: generated.prefix,
      keyHash: generated.hash,
    })
    .returning();
  keyId = keyRow!.id;

  const created = await app.inject({
    method: "POST",
    url: "/api/forms",
    headers: { "x-api-key": key },
    payload: { title: "Contact démo", schema: baseSchema },
  });
  formId = created.json().id;
  createdFormIds.push(formId);

  const published = await app.inject({
    method: "POST",
    url: `/api/forms/${formId}/publish`,
    headers: { "x-api-key": key },
  });
  slug = published.json().publicUrl.replace("/f/", "");

  await submit({
    name: "Alice",
    email: "alice@example.com",
    plan: "basic",
    notes: 'Bonjour, "monde", ok',
  });
  await submit({ name: "Bob", email: "bob@example.com", plan: "pro" });

  const withSource = {
    ...baseSchema,
    fields: [
      ...baseSchema.fields,
      {
        id: "source",
        type: "text",
        label: "Comment nous avez-vous connus ?",
        required: false,
      },
    ],
  };
  await app.inject({
    method: "PATCH",
    url: `/api/forms/${formId}`,
    headers: { "x-api-key": key },
    payload: { schema: withSource },
  });
  await app.inject({
    method: "POST",
    url: `/api/forms/${formId}/publish`,
    headers: { "x-api-key": key },
  });
  await submit({
    name: "Carol",
    email: "carol@example.com",
    plan: "pro",
    source: "LinkedIn",
  });
});

afterAll(async () => {
  await db.delete(responses).where(inArray(responses.formId, createdFormIds));
  if (createdFormIds.length > 0) {
    await db.delete(formVersions).where(inArray(formVersions.formId, createdFormIds));
    await db.delete(forms).where(inArray(forms.id, createdFormIds));
  }
  await db.delete(apiKeys).where(eq(apiKeys.id, keyId));
  await app.close();
  await sqlClient.end();
});

describe("GET /api/forms/:id/responses", () => {
  it("sans clé API → 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/forms/${formId}/responses`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("liste les réponses de la plus récente à la plus ancienne", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/forms/${formId}/responses`,
      headers: { "x-api-key": key },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(3);
    expect(body.pagination).toMatchObject({ total: 3, limit: 20, offset: 0, hasMore: false });
    expect(body.items[0].data.name).toBe("Carol");
    expect(body.items[1].data.name).toBe("Bob");
    expect(body.items[2].data.name).toBe("Alice");
    expect(body.items[2].data.notes).toBe('Bonjour, "monde", ok');
    expect(body.items[2].versionNumber).toBe(1);
    expect(body.items[0].versionNumber).toBe(2);
    expect(body.items[0].attachments).toEqual([]);
  });

  it("filtre par version", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/forms/${formId}/responses?version=1`,
      headers: { "x-api-key": key },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(2);
    expect(body.pagination.total).toBe(2);
    expect(body.items.every((i: { versionNumber: number }) => i.versionNumber === 1)).toBe(true);
  });

  it("filtre since (date ISO)", async () => {
    const [latest] = await db
      .select({ submittedAt: responses.submittedAt })
      .from(responses)
      .where(eq(responses.formId, formId))
      .orderBy(desc(responses.submittedAt))
      .limit(1);
    const res = await app.inject({
      method: "GET",
      url: `/api/forms/${formId}/responses?since=${encodeURIComponent(latest!.submittedAt.toISOString())}`,
      headers: { "x-api-key": key },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].data.name).toBe("Carol");
  });

  it("pagination limit/offset avec hasMore", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/forms/${formId}/responses?limit=1&offset=1`,
      headers: { "x-api-key": key },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].data.name).toBe("Bob");
    expect(body.pagination).toMatchObject({ total: 3, limit: 1, offset: 1, hasMore: true });
  });

  it("query invalide (limit > 100) → 400", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/forms/${formId}/responses?limit=500`,
      headers: { "x-api-key": key },
    });
    expect(res.statusCode).toBe(400);
  });

  it("formulaire inconnu → 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/forms/00000000-0000-4000-8000-000000000000/responses",
      headers: { "x-api-key": key },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /api/forms/:id/responses/:responseId", () => {
  it("renvoie la réponse avec ses pièces jointes et l'URL de téléchargement", async () => {
    const [row] = await db
      .select({ id: responses.id })
      .from(responses)
      .where(eq(responses.formId, formId))
      .limit(1);
    const res = await app.inject({
      method: "GET",
      url: `/api/forms/${formId}/responses/${row!.id}`,
      headers: { "x-api-key": key },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(row!.id);
    expect(body.data.name).toBeTruthy();
    expect(body.versionNumber).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(body.attachments)).toBe(true);
  });

  it("réponse d'un autre formulaire → 404", async () => {
    const [row] = await db
      .select({ id: responses.id })
      .from(responses)
      .where(eq(responses.formId, formId))
      .limit(1);
    const res = await app.inject({
      method: "GET",
      url: `/api/forms/00000000-0000-4000-8000-000000000000/responses/${row!.id}`,
      headers: { "x-api-key": key },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /api/forms/:id/responses/export.csv", () => {
  it("exporte un CSV avec en-tête, échappement et colonne ajoutée en v2", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/forms/${formId}/responses/export.csv`,
      headers: { "x-api-key": key },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toMatch(/contact-demo-[a-z0-9]+-responses\.csv/);
    expect(res.body.startsWith("\uFEFF")).toBe(true);
    const lines = res.body.replace(/^\uFEFF/, "").trimEnd().split("\r\n");
    expect(lines).toHaveLength(4);
    const header = lines[0]!.split(";");
    expect(header.slice(0, 3)).toEqual(["response_id", "submitted_at", "version"]);
    expect(header).toContain("name");
    expect(header).toContain("source");
    expect(res.body).toContain('"Bonjour, ""monde"", ok"');
    expect(res.body).toContain("LinkedIn");
  });
});
