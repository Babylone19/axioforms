import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import fs from "node:fs/promises";
import path from "node:path";
import { eq, inArray } from "drizzle-orm";
import { buildApp } from "../app.js";
import { registerRoutes } from "../routes/index.js";
import { db, sqlClient } from "../db/index.js";
import { apiKeys, attachments, formVersions, forms, responses } from "../db/schema.js";
import { config } from "../config.js";
import { generateApiKey } from "../lib/apiKeys.js";

let app: FastifyInstance;
let key: string;
let keyId: string;
let slug: string;
const createdFormIds: string[] = [];

const PDF_BYTES = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< >>\n%%EOF\n",
  "utf-8",
);
function buildPng(): Buffer {
  const { crc32 } = require("node:zlib") as typeof import("node:zlib");
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.concat([
    Buffer.from([0, 0, 0, 1, 0, 0, 0, 1]),
    Buffer.from([8, 0, 0, 0, 0]),
  ]);
  const type = Buffer.from("IHDR");
  const len = Buffer.from([0, 0, 0, 13]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([type, ihdrData])) >>> 0);
  return Buffer.concat([sig, len, type, ihdrData, crc, Buffer.alloc(64)]);
}
const PNG_BYTES = buildPng();
const BIG_PDF_BYTES = Buffer.concat([
  PDF_BYTES,
  Buffer.alloc(2000, 0x20),
]);

const fileFormSchema = {
  title: "Avec pièce jointe",
  fields: [
    { id: "name", type: "text", label: "Nom", required: true },
    { id: "client_type", type: "select", label: "Type", required: true, options: [
      { value: "particulier", label: "Particulier" },
      { value: "entreprise", label: "Entreprise" },
    ] },
    { id: "contract", type: "file", label: "Contrat", required: false,
      validation: {
        maxSizeBytes: 1024,
        acceptedMimeTypes: ["application/pdf"],
      },
      visibleIf: { field: "client_type", op: "eq", value: "entreprise" } },
    { id: "logo", type: "file", label: "Logo", required: true,
      validation: { acceptedMimeTypes: ["application/pdf"] } },
  ],
};

function multipart(
  fields: Record<string, string>,
  files: { name: string; filename: string; contentType: string; content: Buffer }[],
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = "----axioformsTestBoundary";
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
        "utf-8",
      ),
    );
  }
  for (const file of files) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
        "utf-8",
      ),
      file.content,
      Buffer.from("\r\n", "utf-8"),
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`, "utf-8"));
  return {
    payload: Buffer.concat(parts),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
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
      name: "test attachments",
      keyPrefix: generated.prefix,
      keyHash: generated.hash,
    })
    .returning();
  keyId = keyRow!.id;

  const created = await app.inject({
    method: "POST",
    url: "/api/forms",
    headers: { "x-api-key": key },
    payload: { title: "Avec pièce jointe", schema: fileFormSchema },
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
  const rows = await db.select().from(attachments);
  for (const row of rows) {
    await fs.rm(path.join(config.UPLOAD_DIR, row.storedPath), { force: true });
  }
  await db.delete(attachments);
  await db.delete(responses).where(inArray(responses.formId, createdFormIds));
  if (createdFormIds.length > 0) {
    await db.delete(formVersions).where(inArray(formVersions.formId, createdFormIds));
    await db.delete(forms).where(inArray(forms.id, createdFormIds));
  }
  await db.delete(apiKeys).where(eq(apiKeys.id, keyId));
  await app.close();
  await sqlClient.end();
});

describe("Soumission multipart avec pièces jointes", () => {
  it("validation: fichier valide → 201, fichier stocké et lié à la réponse", async () => {
    const { payload, headers } = multipart(
      { answers: JSON.stringify({ name: "Ada", client_type: "entreprise" }) },
      [
        {
          name: "file_contract",
          filename: "contrat.pdf",
          contentType: "application/pdf",
          content: PDF_BYTES,
        },
        {
          name: "file_logo",
          filename: "logo.pdf",
          contentType: "application/pdf",
          content: PDF_BYTES,
        },
      ],
    );
    const res = await app.inject({
      method: "POST",
      url: `/f/${slug}/responses`,
      headers,
      payload,
    });
    expect(res.statusCode).toBe(201);
    const [row] = await db
      .select()
      .from(responses)
      .where(eq(responses.id, res.json().responseId));
    const contract = row!.data.contract as { id: string; filename: string; mimeType: string };
    expect(contract.filename).toBe("contrat.pdf");
    expect(contract.mimeType).toBe("application/pdf");

    const [attachmentRow] = await db
      .select()
      .from(attachments)
      .where(eq(attachments.id, contract.id));
    expect(attachmentRow.responseId).toBe(row!.id);
    const abs = path.join(config.UPLOAD_DIR, attachmentRow.storedPath);
    const stat = await fs.stat(abs);
    expect(stat.size).toBe(PDF_BYTES.byteLength);
  });

  it("validation: mime non dans la whitelist → 400 (sniffing, pas le Content-Type)", async () => {
    const { payload, headers } = multipart(
      { answers: JSON.stringify({ name: "Ada", client_type: "particulier" }) },
      [
        {
          name: "file_logo",
          filename: "piège.pdf",
          contentType: "application/pdf",
          content: PNG_BYTES,
        },
      ],
    );
    const res = await app.inject({
      method: "POST",
      url: `/f/${slug}/responses`,
      headers,
      payload,
    });
    expect(res.statusCode).toBe(400);
    const details = res.json().error.details;
    expect(details.logo).toMatch(/non autorisé/);
  });

  it("validation: fichier dépassant maxSizeBytes → 400", async () => {
    const { payload, headers } = multipart(
      { answers: JSON.stringify({ name: "Ada", client_type: "entreprise" }) },
      [
        {
          name: "file_contract",
          filename: "gros.pdf",
          contentType: "application/pdf",
          content: BIG_PDF_BYTES,
        },
        {
          name: "file_logo",
          filename: "ok.pdf",
          contentType: "application/pdf",
          content: PDF_BYTES,
        },
      ],
    );
    const res = await app.inject({
      method: "POST",
      url: `/f/${slug}/responses`,
      headers,
      payload,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.details.contract).toMatch(/dépasse la taille maximale/);
  });

  it("validation: fichier obligatoire manquant → 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/f/${slug}/responses`,
      payload: { answers: { name: "Ada", client_type: "particulier" } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.details.logo).toMatch(/exige un fichier/);
  });

  it("validation: champ fichier masqué → ni exigé, fichier transmis ignoré", async () => {
    const { payload, headers } = multipart(
      { answers: JSON.stringify({ name: "Ada", client_type: "particulier" }) },
      [
        {
          name: "file_contract",
          filename: "intrus.pdf",
          contentType: "application/pdf",
          content: PDF_BYTES,
        },
        {
          name: "file_logo",
          filename: "logo.pdf",
          contentType: "application/pdf",
          content: PDF_BYTES,
        },
      ],
    );
    const res = await app.inject({
      method: "POST",
      url: `/f/${slug}/responses`,
      headers,
      payload,
    });
    expect(res.statusCode).toBe(201);
    const [row] = await db
      .select()
      .from(responses)
      .where(eq(responses.id, res.json().responseId));
    expect(row!.data).not.toHaveProperty("contract");
    const orphan = await db
      .select()
      .from(attachments)
      .where(eq(attachments.responseId, row!.id));
    expect(orphan).toHaveLength(1);
    expect(orphan[0].fieldId === "logo" || orphan[0].fieldId === "contract").toBe(true);
  });
});

describe("Téléchargement de pièce jointe", () => {
  let attachmentId: string;

  beforeAll(async () => {
    const [row] = await db.select().from(attachments).limit(1);
    attachmentId = row!.id;
  });

  it("integration: sans clé API → 401", async () => {
    const res = await app.inject({ method: "GET", url: `/api/attachments/${attachmentId}` });
    expect(res.statusCode).toBe(401);
  });

  it("integration: avec clé API → 200, Content-Type application/pdf, Content-Disposition attachment", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/attachments/${attachmentId}`,
      headers: { "x-api-key": key },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toMatch(/^attachment;/);
  });

  it("integration: id inexistant → 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/attachments/00000000-0000-4000-8000-000000000000",
      headers: { "x-api-key": key },
    });
    expect(res.statusCode).toBe(404);
  });
});
