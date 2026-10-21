import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq, inArray } from "drizzle-orm";
import { buildApp } from "../app.js";
import { registerRoutes } from "../routes/index.js";
import { db, sqlClient } from "../db/index.js";
import { apiKeys, formVersions, forms, responses } from "../db/schema.js";
import { config } from "../config.js";
import { generateApiKey } from "../lib/apiKeys.js";

let app: FastifyInstance;
let key: string;
let keyId: string;
let slug: string;
const createdFormIds: string[] = [];

const onboardingSchema = {
  title: "Onboarding client",
  description: "Première prise de contact",
  fields: [
    { id: "client_type", type: "select", label: "Type de client", required: true, options: [
      { value: "particulier", label: "Particulier" },
      { value: "entreprise", label: "Entreprise" },
    ] },
    { id: "company_name", type: "text", label: "Raison sociale", required: true,
      visibleIf: { field: "client_type", op: "eq", value: "entreprise" } },
    { id: "vat_number", type: "text", label: "N° de TVA", required: true,
      validation: { pattern: "^BE[0-9]{10}$", errorText: "Format BE + 10 chiffres" },
      visibleIf: { field: "client_type", op: "eq", value: "entreprise" } },
    { id: "email", type: "email", label: "Email", required: true },
    { id: "notes", type: "textarea", label: "Notes", required: false },
  ],
};

beforeAll(async () => {
  app = await buildApp();
  await registerRoutes(app);
  await app.ready();

  const generated = generateApiKey(config.API_KEY_PEPPER);
  key = generated.key;
  const [keyRow] = await db
    .insert(apiKeys)
    .values({
      name: "test public",
      keyPrefix: generated.prefix,
      keyHash: generated.hash,
    })
    .returning();
  keyId = keyRow!.id;

  const created = await app.inject({
    method: "POST",
    url: "/api/forms",
    headers: { "x-api-key": key },
    payload: { title: "Onboarding client", schema: onboardingSchema },
  });
  const formId = created.json().id;
  createdFormIds.push(formId);
  const published = await app.inject({
    method: "POST",
    url: `/api/forms/${formId}/publish`,
    headers: { "x-api-key": key },
  });
  slug = published.json().publicUrl.replace("/f/", "");
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

describe("GET /f/:slug", () => {
  it("integration: formulaire publié accessible sans clé API", async () => {
    const res = await app.inject({ method: "GET", url: `/api/public/f/${slug}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.title).toBe("Onboarding client");
    expect(body.versionNumber).toBe(1);
    expect(body.schema.fields).toHaveLength(5);
  });

  it("integration: slug inexistant → 404", async () => {
    const res = await app.inject({ method: "GET", url: "/api/public/f/inexistant" });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /f/:slug/responses", () => {
  it("integration: soumission valide → 201 et réponse stockée liée à la version", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/public/f/${slug}/responses`,
      payload: {
        answers: {
          client_type: "entreprise",
          company_name: "Acme SA",
          vat_number: "BE0123456789",
          email: "cto@acme.be",
        },
      },
    });
    expect(res.statusCode).toBe(201);
    const { responseId } = res.json();
    const [row] = await db.select().from(responses).where(eq(responses.id, responseId));
    expect(row).toBeDefined();
    expect(row!.data).toMatchObject({
      client_type: "entreprise",
      company_name: "Acme SA",
      vat_number: "BE0123456789",
      email: "cto@acme.be",
    });
    expect(row!.formId).toBe(createdFormIds[0]);
    expect(row!.meta.ipHash).toBeTruthy();
  });

  it("validation: email invalide → 400 VALIDATION_FAILED avec details par champ", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/public/f/${slug}/responses`,
      payload: {
        answers: { client_type: "particulier", email: "pas-un-email" },
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.details.email).toMatch(/email valide/);
  });

  it("validation: champ obligatoire masqué non fourni → 201 (ni exigé)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/public/f/${slug}/responses`,
      payload: {
        answers: { client_type: "particulier", email: "jane@example.com" },
      },
    });
    expect(res.statusCode).toBe(201);
    const [row] = await db
      .select()
      .from(responses)
      .where(eq(responses.id, res.json().responseId));
    expect(row!.data.company_name).toBeUndefined();
    expect(row!.data.vat_number).toBeUndefined();
  });

  it("validation: champ masqué fourni volontairement → strippé (ni enregistré)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/public/f/${slug}/responses`,
      payload: {
        answers: {
          client_type: "particulier",
          email: "mallory@example.com",
          company_name: "Injected Corp",
          vat_number: "BE0000000000",
        },
      },
    });
    expect(res.statusCode).toBe(201);
    const [row] = await db
      .select()
      .from(responses)
      .where(eq(responses.id, res.json().responseId));
    expect(row!.data).not.toHaveProperty("company_name");
    expect(row!.data).not.toHaveProperty("vat_number");
  });

  it("validation: pattern TVA invalide sur champ visible → 400 avec errorText", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/public/f/${slug}/responses`,
      payload: {
        answers: {
          client_type: "entreprise",
          company_name: "Acme",
          vat_number: "XX999",
          email: "a@b.co",
        },
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.details.vat_number).toBe("Format BE + 10 chiffres");
  });

  it("validation: valeur hors options select → 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/public/f/${slug}/responses`,
      payload: { answers: { client_type: "alien", email: "a@b.co" } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.details.client_type).toMatch(/non autorisée/);
  });

  it("integration: soumission sur formulaire non publié → 404", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/forms",
      headers: { "x-api-key": key },
      payload: { title: "Brouillon secret", schema: onboardingSchema },
    });
    const draftSlug = created.json().slug;
    createdFormIds.push(created.json().id);
    const res = await app.inject({
      method: "POST",
      url: `/api/public/f/${draftSlug}/responses`,
      payload: { answers: { client_type: "particulier", email: "x@y.zz" } },
    });
    expect(res.statusCode).toBe(404);
  });
});
