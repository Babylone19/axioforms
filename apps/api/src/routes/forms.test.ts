import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq, inArray } from "drizzle-orm";
import { buildApp } from "../app.js";
import { registerRoutes } from "../routes/index.js";
import { db, sqlClient } from "../db/index.js";
import { apiKeys, forms } from "../db/schema.js";
import { config } from "../config.js";
import { generateApiKey } from "../lib/apiKeys.js";

let app: FastifyInstance;
let validKey: string;
let keyRowId: string;
const createdFormIds: string[] = [];

const validSchema = {
  title: "Formulaire de test",
  fields: [
    { id: "name", type: "text", label: "Nom", required: true },
  ],
};

beforeAll(async () => {
  app = await buildApp();
  await registerRoutes(app);
  await app.ready();

  const { key, prefix, hash } = generateApiKey(config.API_KEY_PEPPER);
  const [row] = await db
    .insert(apiKeys)
    .values({ name: "clé de test", keyPrefix: prefix, keyHash: hash })
    .returning();
  validKey = key;
  keyRowId = row!.id;
});

afterAll(async () => {
  if (createdFormIds.length > 0) {
    await db.delete(forms).where(inArray(forms.id, createdFormIds));
  }
  await db.delete(apiKeys).where(eq(apiKeys.id, keyRowId));
  await app.close();
  await sqlClient.end();
});

function auth(headers: Record<string, string> = {}) {
  return { "x-api-key": validKey, ...headers };
}

describe("API auth + formulaires", () => {
  it("integration: GET /api/forms sans clé API → 401", async () => {
    const res = await app.inject({ method: "GET", url: "/api/forms" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });

  it("integration: clé invalide → 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/forms",
      headers: { "x-api-key": "axf_deadbeef_00000000000000000000000000000000" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("integration: clé révoquée → 401", async () => {
    const { key, prefix, hash } = generateApiKey(config.API_KEY_PEPPER);
    const [row] = await db
      .insert(apiKeys)
      .values({
        name: "à révoquer",
        keyPrefix: prefix,
        keyHash: hash,
        revokedAt: new Date(),
      })
      .returning();
    const res = await app.inject({
      method: "GET",
      url: "/api/forms",
      headers: { "x-api-key": key },
    });
    expect(res.statusCode).toBe(401);
    await db.delete(apiKeys).where(eq(apiKeys.id, row!.id));
  });

  it("integration: POST /api/forms valide → 201 avec slug et schéma", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/forms",
      headers: auth(),
      payload: { title: "Onboarding", schema: validSchema },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.slug).toMatch(/^onboarding-[a-f0-9]{6}$/);
    expect(body.status).toBe("draft");
    expect(body.schema.fields).toHaveLength(1);
    expect(body.publicUrl).toBe(`/f/${body.slug}`);
    createdFormIds.push(body.id);
  });

  it("integration: POST /api/forms avec schéma invalide → 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/forms",
      headers: auth(),
      payload: {
        title: "Cassé",
        schema: {
          title: "Cassé",
          fields: [
            { id: "a", type: "text", label: "A" },
            { id: "a", type: "text", label: "A bis" },
          ],
        },
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("DUPLICATE_FIELD_ID");
  });

  it("integration: PATCH met à jour le brouillon, GET le relit", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/forms",
      headers: auth(),
      payload: { title: "À mettre à jour", schema: validSchema },
    });
    const id = created.json().id;
    createdFormIds.push(id);
    const patched = await app.inject({
      method: "PATCH",
      url: `/api/forms/${id}`,
      headers: auth(),
      payload: {
        title: "Renommé",
        schema: {
          ...validSchema,
          fields: [
            ...validSchema.fields,
            { id: "email", type: "email", label: "Email", required: true },
          ],
        },
      },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().title).toBe("Renommé");
    expect(patched.json().schema.fields).toHaveLength(2);
  });

  it("integration: GET /api/forms/:id inexistant → 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/forms/00000000-0000-4000-8000-000000000000",
      headers: auth(),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });
});
