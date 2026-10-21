import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq, inArray } from "drizzle-orm";
import { buildApp } from "../app.js";
import { registerRoutes } from "../routes/index.js";
import { db, sqlClient } from "../db/index.js";
import { apiKeys, formVersions, forms } from "../db/schema.js";
import { config } from "../config.js";
import { generateApiKey } from "../lib/apiKeys.js";

let app: FastifyInstance;
let key: string;
let keyId: string;
const createdFormIds: string[] = [];

const draftSchema = {
  title: "Versionné",
  fields: [{ id: "name", type: "text", label: "Nom", required: true }],
};

beforeAll(async () => {
  app = await buildApp();
  await registerRoutes(app);
  await app.ready();
  const generated = generateApiKey(config.API_KEY_PEPPER);
  key = generated.key;
  const [row] = await db
    .insert(apiKeys)
    .values({
      name: "test versions",
      keyPrefix: generated.prefix,
      keyHash: generated.hash,
    })
    .returning();
  keyId = row!.id;
});

afterAll(async () => {
  if (createdFormIds.length > 0) {
    await db
      .delete(formVersions)
      .where(inArray(formVersions.formId, createdFormIds));
    await db.delete(forms).where(inArray(forms.id, createdFormIds));
  }
  await db.delete(apiKeys).where(eq(apiKeys.id, keyId));
  await app.close();
  await sqlClient.end();
});

function auth() {
  return { "x-api-key": key };
}

async function createForm(title: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/forms",
    headers: auth(),
    payload: { title, schema: draftSchema },
  });
  const id = res.json().id;
  createdFormIds.push(id);
  return id;
}

describe("Publication et versions", () => {
  it("integration: publish crée la version 1 et passe le formulaire en published", async () => {
    const id = await createForm("Publié");
    const res = await app.inject({
      method: "POST",
      url: `/api/forms/${id}/publish`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().versionNumber).toBe(1);
    expect(res.json().publicUrl).toMatch(/^\/f\/publie-/);

    const form = await app.inject({
      method: "GET",
      url: `/api/forms/${id}`,
      headers: auth(),
    });
    expect(form.json().status).toBe("published");
  });

  it("integration: republish crée la version 2, la version 1 est préservée", async () => {
    const id = await createForm("Multi-version");
    await app.inject({ method: "POST", url: `/api/forms/${id}/publish`, headers: auth() });

    await app.inject({
      method: "PATCH",
      url: `/api/forms/${id}`,
      headers: auth(),
      payload: {
        schema: {
          title: "Version 2 du formulaire",
          fields: [
            { id: "name", type: "text", label: "Nom", required: true },
            { id: "email", type: "email", label: "Email", required: true },
          ],
        },
      },
    });
    const pub2 = await app.inject({
      method: "POST",
      url: `/api/forms/${id}/publish`,
      headers: auth(),
    });
    expect(pub2.json().versionNumber).toBe(2);

    const v1 = await app.inject({
      method: "GET",
      url: `/api/forms/${id}/versions/1`,
      headers: auth(),
    });
    expect(v1.statusCode).toBe(200);
    expect(v1.json().schema.fields).toHaveLength(1);
    expect(v1.json().schema.title).toBe("Versionné");

    const versions = await app.inject({
      method: "GET",
      url: `/api/forms/${id}/versions`,
      headers: auth(),
    });
    expect(versions.json().items.map((v: { versionNumber: number }) => v.versionNumber)).toEqual([2, 1]);
  });

  it("integration: publish sans schéma → 400 NO_DRAFT", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/forms",
      headers: auth(),
      payload: { title: "Sans schéma" },
    });
    const id = res.json().id;
    createdFormIds.push(id);
    const pub = await app.inject({
      method: "POST",
      url: `/api/forms/${id}/publish`,
      headers: auth(),
    });
    expect(pub.statusCode).toBe(400);
    expect(pub.json().error.code).toBe("NO_DRAFT");
  });

  it("integration: published d'un formulaire jamais publié → 404 NOT_PUBLISHED", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/forms",
      headers: auth(),
      payload: { title: "Jamais publié", schema: draftSchema },
    });
    const id = res.json().id;
    createdFormIds.push(id);
    const pub = await app.inject({
      method: "GET",
      url: `/api/forms/${id}/published`,
      headers: auth(),
    });
    expect(pub.statusCode).toBe(404);
    expect(pub.json().error.code).toBe("NOT_PUBLISHED");
  });
});
