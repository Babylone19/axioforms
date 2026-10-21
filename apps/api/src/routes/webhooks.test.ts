import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import http from "node:http";
import type { AddressInfo } from "node:net";
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
let receiver: http.Server;
let baseUrl: string;
const createdFormIds: string[] = [];
const received: { path: string; headers: http.IncomingHttpHeaders; body: unknown }[] = [];

const schema = {
  title: "Webhook test",
  fields: [
    { id: "name", type: "text", label: "Nom", required: true },
    { id: "email", type: "email", label: "Email", required: true },
  ],
};

async function createPublishedForm(webhookUrl?: string): Promise<{ id: string; slug: string }> {
  const res = await app.inject({
    method: "POST",
    url: "/api/forms",
    headers: { "x-api-key": key },
    payload: { title: `Webhook ${Math.random().toString(36).slice(2, 7)}`, schema, webhookUrl },
  });
  expect(res.statusCode).toBe(201);
  const form = res.json();
  createdFormIds.push(form.id);
  const published = await app.inject({
    method: "POST",
    url: `/api/forms/${form.id}/publish`,
    headers: { "x-api-key": key },
  });
  expect(published.statusCode).toBe(201);
  return { id: form.id, slug: published.json().publicUrl.replace("/f/", "") };
}

async function submit(slug: string) {
  const res = await app.inject({
    method: "POST",
    url: `/api/public/f/${slug}/responses`,
    payload: { answers: { name: "Alice", email: "alice@example.com" } },
  });
  expect(res.statusCode).toBe(201);
  return res.json().responseId as string;
}

async function waitForStatus(
  responseId: string,
  expected: string | undefined,
): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const [row] = await db
      .select({ meta: responses.meta })
      .from(responses)
      .where(eq(responses.id, responseId));
    if (row && row.meta.webhookStatus === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const [row] = await db
    .select({ meta: responses.meta })
    .from(responses)
    .where(eq(responses.id, responseId));
  throw new Error(
    `webhookStatus attendu ${expected}, obtenu ${row?.meta.webhookStatus}`,
  );
}

beforeAll(async () => {
  receiver = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      received.push({
        path: req.url ?? "",
        headers: req.headers,
        body: JSON.parse(Buffer.concat(chunks).toString("utf-8")),
      });
      res.statusCode = req.url === "/fail" ? 500 : 204;
      res.end();
    });
  });
  await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));
  const address = receiver.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;

  app = await buildApp();
  await registerRoutes(app);
  await app.ready();

  const generated = generateApiKey(config.API_KEY_PEPPER);
  key = generated.key;
  const [keyRow] = await db
    .insert(apiKeys)
    .values({
      name: "test webhooks",
      keyPrefix: generated.prefix,
      keyHash: generated.hash,
    })
    .returning();
  keyId = keyRow!.id;
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
  await new Promise<void>((resolve) => receiver.close(() => resolve()));
});

describe("webhooks", () => {
  it("POST la réponse au webhook configuré et enregistre le statut", async () => {
    const form = await createPublishedForm(`${baseUrl}/hook`);
    const responseId = await submit(form.slug);
    await waitForStatus(responseId, "success");

    const entry = received.find(
      (r) => (r.body as { responseId?: string }).responseId === responseId,
    );
    expect(entry).toBeDefined();
    expect(entry!.path).toBe("/hook");
    expect(entry!.headers["content-type"]).toContain("application/json");
    expect(entry!.headers["x-axioforms-event"]).toBe("response.created");
    const body = entry!.body as {
      event: string;
      formId: string;
      formSlug: string;
      versionNumber: number;
      data: Record<string, unknown>;
      submittedAt: string;
    };
    expect(body.event).toBe("response.created");
    expect(body.formId).toBe(form.id);
    expect(body.formSlug).toBe(form.slug);
    expect(body.versionNumber).toBe(1);
    expect(body.data).toEqual({ name: "Alice", email: "alice@example.com" });
    expect(Number.isNaN(Date.parse(body.submittedAt))).toBe(false);
  });

  it("échec HTTP → statut failed, la soumission reste un succès", async () => {
    const form = await createPublishedForm(`${baseUrl}/fail`);
    const responseId = await submit(form.slug);
    await waitForStatus(responseId, "failed:http_500");
  });

  it("webhook injoignable → failed:network", async () => {
    const form = await createPublishedForm("http://127.0.0.1:1/hook");
    const responseId = await submit(form.slug);
    await waitForStatus(responseId, "failed:network");
  });

  it("sans webhook → aucun statut enregistré", async () => {
    const form = await createPublishedForm();
    const responseId = await submit(form.slug);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const [row] = await db
      .select({ meta: responses.meta })
      .from(responses)
      .where(eq(responses.id, responseId));
    expect(row!.meta.webhookStatus).toBeUndefined();
  });

  it("refuse une URL de webhook non http(s)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/forms",
      headers: { "x-api-key": key },
      payload: {
        title: "Webhook invalide",
        schema,
        webhookUrl: "ftp://example.com/hook",
      },
    });
    expect(res.statusCode).toBe(400);
  });
});
