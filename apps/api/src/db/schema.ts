import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    keyPrefix: text("key_prefix").notNull().unique(),
    keyHash: text("key_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("api_keys_prefix_idx").on(t.keyPrefix)],
);

export const forms = pgTable(
  "forms",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status", { enum: ["draft", "published"] })
      .notNull()
      .default("draft"),
    webhookUrl: text("webhook_url"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("forms_status_idx").on(t.status)],
);

export const formVersions = pgTable(
  "form_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    formId: uuid("form_id")
      .notNull()
      .references(() => forms.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    schemaJson: jsonb("schema_json")
      .$type<{
        schemaVersion: 1;
        title: string;
        description?: string;
        fields: unknown[];
      }>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    unique("form_versions_form_version_unique").on(t.formId, t.versionNumber),
    index("form_versions_form_idx").on(t.formId, t.versionNumber),
  ],
);

export const responses = pgTable(
  "responses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    formId: uuid("form_id")
      .notNull()
      .references(() => forms.id, { onDelete: "cascade" }),
    formVersionId: uuid("form_version_id")
      .notNull()
      .references(() => formVersions.id, { onDelete: "restrict" }),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    meta: jsonb("meta")
      .$type<{
        ipHash?: string;
        userAgent?: string;
        webhookStatus?: string;
      }>()
      .default({})
      .notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("responses_form_submitted_idx").on(t.formId, t.submittedAt),
    index("responses_version_idx").on(t.formVersionId),
  ],
);

export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    responseId: uuid("response_id").references(() => responses.id, {
      onDelete: "cascade",
    }),
    fieldId: text("field_id").notNull(),
    filename: text("filename").notNull(),
    storedPath: text("stored_path").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("attachments_response_idx").on(t.responseId)],
);

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
export type Form = typeof forms.$inferSelect;
export type NewForm = typeof forms.$inferInsert;
export type FormVersion = typeof formVersions.$inferSelect;
export type NewFormVersion = typeof formVersions.$inferInsert;
export type Response = typeof responses.$inferSelect;
export type NewResponse = typeof responses.$inferInsert;
export type Attachment = typeof attachments.$inferSelect;
export type NewAttachment = typeof attachments.$inferInsert;
