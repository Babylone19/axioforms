import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { eq, inArray } from "drizzle-orm";
import { parseFormSchema, type FormSchema } from "@axioforms/shared";
import { config } from "../src/config.js";
import { db, sqlClient } from "../src/db/index.js";
import {
  attachments,
  formVersions,
  forms,
  responses,
} from "../src/db/schema.js";

const DEMO_TITLE = "Démo — Onboarding client";

const demoSchema: FormSchema = {
  schemaVersion: 1,
  title: DEMO_TITLE,
  description:
    "Formulaire d'exemple : logique conditionnelle, validations, fichiers et webhook.",
  fields: [
    {
      id: "intro",
      type: "section",
      label: "Vos coordonnées",
    },
    {
      id: "client_type",
      type: "select",
      label: "Type de client",
      description: "Les champs entreprise apparaissent selon votre choix.",
      required: true,
      options: [
        { value: "particulier", label: "Particulier" },
        { value: "entreprise", label: "Entreprise" },
        { value: "association", label: "Association" },
      ],
    },
    {
      id: "full_name",
      type: "text",
      label: "Nom complet",
      required: true,
      validation: { minLength: 2, maxLength: 120 },
    },
    {
      id: "email",
      type: "email",
      label: "Email",
      required: true,
    },
    {
      id: "company_name",
      type: "text",
      label: "Raison sociale",
      required: true,
      visibleIf: {
        field: "client_type",
        op: "in",
        value: ["entreprise", "association"],
      },
    },
    {
      id: "vat_number",
      type: "text",
      label: "Numéro de TVA",
      description: "Format belge : BE suivi de 10 chiffres.",
      required: true,
      validation: {
        pattern: "^BE[0-9]{10}$",
        errorText: "Format attendu : BE + 10 chiffres (ex. BE0123456789)",
      },
      visibleIf: { field: "client_type", op: "eq", value: "entreprise" },
    },
    {
      id: "company_size",
      type: "number",
      label: "Nombre de collaborateurs",
      required: true,
      validation: { min: 1, max: 100000 },
      visibleIf: {
        field: "client_type",
        op: "in",
        value: ["entreprise", "association"],
      },
    },
    {
      id: "dedicated_contact",
      type: "checkbox",
      label: "Souhaite un contact dédié",
      options: [{ value: "yes", label: "Oui, un contact dédié" }],
      visibleIf: { field: "company_size", op: "gt", value: 50 },
    },
    {
      id: "plan",
      type: "radio",
      label: "Formule souhaitée",
      required: true,
      options: [
        { value: "essentiel", label: "Essentiel" },
        { value: "pro", label: "Pro" },
      ],
    },
    {
      id: "budget",
      type: "number",
      label: "Budget annuel (€)",
      required: true,
      validation: { min: 0, max: 1000000 },
      visibleIf: { field: "plan", op: "eq", value: "pro" },
    },
    {
      id: "contract",
      type: "file",
      label: "Contrat ou devis signé",
      description: "PDF ou image, 2 Mo maximum.",
      validation: {
        maxSizeBytes: 2 * 1024 * 1024,
        acceptedMimeTypes: ["application/pdf", "image/png", "image/jpeg"],
      },
      visibleIf: { field: "client_type", op: "eq", value: "entreprise" },
    },
    {
      id: "start_date",
      type: "date",
      label: "Date de démarrage souhaitée",
    },
    {
      id: "interests",
      type: "checkbox",
      label: "Centres d'intérêt",
      options: [
        { value: "news", label: "Newsletter produit" },
        { value: "events", label: "Événements" },
        { value: "beta", label: "Programme bêta" },
      ],
    },
    {
      id: "notes",
      type: "textarea",
      label: "Autre chose à nous dire ?",
      validation: { maxLength: 2000 },
    },
  ],
};

const PDF_BYTES = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n",
  "utf-8",
);

async function main(): Promise<void> {
  const schema = parseFormSchema(demoSchema);

  const existing = await db
    .select({ id: forms.id })
    .from(forms)
    .where(eq(forms.title, DEMO_TITLE));
  if (existing.length > 0) {
    const ids = existing.map((f) => f.id);
    const oldAttachments = await db
      .select({ storedPath: attachments.storedPath })
      .from(attachments)
      .innerJoin(responses, eq(attachments.responseId, responses.id))
      .where(inArray(responses.formId, ids));
    for (const attachment of oldAttachments) {
      await fs.rm(path.join(config.UPLOAD_DIR, attachment.storedPath), {
        force: true,
      });
    }
    await db.delete(forms).where(inArray(forms.id, ids));
    console.log(`Ancien formulaire de démo supprimé (${ids.length}).`);
  }

  const slug = "demo-onboarding-client";
  const [form] = await db
    .insert(forms)
    .values({
      slug,
      title: DEMO_TITLE,
      description: demoSchema.description,
      status: "published",
      schemaDraft: schema,
    })
    .returning();

  const [version] = await db
    .insert(formVersions)
    .values({
      formId: form!.id,
      versionNumber: 1,
      schemaJson: schema,
    })
    .returning();

  const samples: Record<string, unknown>[] = [
    {
      client_type: "entreprise",
      full_name: "Camille Martin",
      email: "camille@acme.be",
      company_name: "Acme SA",
      vat_number: "BE0123456789",
      company_size: 120,
      dedicated_contact: ["yes"],
      plan: "pro",
      budget: 24000,
      start_date: "2026-11-02",
      interests: ["news", "beta"],
      notes: "Migration depuis un outil interne.",
    },
    {
      client_type: "particulier",
      full_name: "Louis Dubois",
      email: "louis@example.com",
      plan: "essentiel",
      interests: ["events"],
    },
    {
      client_type: "association",
      full_name: "Sofia Peeters",
      email: "sofia@asbl.be",
      company_name: "Les Amis du Code",
      company_size: 12,
      plan: "essentiel",
      notes: "Premier contact via un partenaire.",
    },
  ];

  for (const [index, data] of samples.entries()) {
    const submittedAt = new Date(Date.now() - (samples.length - index) * 3600_000);
    const [row] = await db
      .insert(responses)
      .values({
        formId: form!.id,
        formVersionId: version!.id,
        data,
        meta: { ipHash: "seed" },
        submittedAt,
      })
      .returning();

    if (index === 0) {
      const attachmentId = randomUUID();
      const storedFilename = `${attachmentId}.pdf`;
      const dir = path.join(config.UPLOAD_DIR, form!.id);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, storedFilename), PDF_BYTES);
      await db.insert(attachments).values({
        id: attachmentId,
        responseId: row!.id,
        fieldId: "contract",
        filename: "contrat-acme.pdf",
        storedPath: `${form!.id}/${storedFilename}`,
        mimeType: "application/pdf",
        sizeBytes: PDF_BYTES.length,
      });
      await db
        .update(responses)
        .set({
          data: {
            ...data,
            contract: {
              id: attachmentId,
              filename: "contrat-acme.pdf",
              sizeBytes: PDF_BYTES.length,
              mimeType: "application/pdf",
            },
          },
        })
        .where(eq(responses.id, row!.id));
    }
  }

  console.log("Formulaire de démonstration prêt :");
  console.log(`  Formulaire : ${form!.id}`);
  console.log(`  Public     : /f/${slug}`);
  console.log(`  Réponses   : ${samples.length} (dont 1 pièce jointe)`);
  await sqlClient.end();
}

await main();
