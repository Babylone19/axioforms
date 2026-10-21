import { z } from "zod";

export const CONDITION_OPS = [
  "eq",
  "neq",
  "in",
  "not_in",
  "gt",
  "lt",
  "contains",
  "truthy",
] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];

export const FIELD_TYPES = [
  "text",
  "textarea",
  "email",
  "number",
  "date",
  "select",
  "radio",
  "checkbox",
  "file",
  "section",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const conditionSchema = z.object({
  field: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,63}$/, "id de champ invalide"),
  op: z.enum(CONDITION_OPS),
  value: z.unknown().optional(),
});
export type Condition = z.infer<typeof conditionSchema>;

export const fieldValidationSchema = z
  .object({
    minLength: z.number().int().min(0).optional(),
    maxLength: z.number().int().min(1).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    pattern: z.string().optional(),
    errorText: z.string().max(500).optional(),
    maxSizeBytes: z.number().int().min(1).optional(),
    acceptedMimeTypes: z.array(z.string().min(1)).optional(),
  })
  .strict();
export type FieldValidation = z.infer<typeof fieldValidationSchema>;

export const fieldOptionSchema = z
  .object({
    value: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[a-z0-9][a-z0-9_-]{0,199}$/i, "value d'option invalide"),
    label: z.string().min(1).max(200),
  })
  .strict();
export type FieldOption = z.infer<typeof fieldOptionSchema>;

const fieldIdSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9_]{0,63}$/,
    "L'id de champ doit commencer par une lettre minuscule, puis lettres/chiffres/underscore (max 64)",
  );

export const fieldSchema = z
  .object({
    id: fieldIdSchema,
    type: z.enum(FIELD_TYPES),
    label: z.string().min(1).max(200),
    description: z.string().max(1000).optional(),
    required: z.boolean().optional(),
    placeholder: z.string().max(200).optional(),
    options: z.array(fieldOptionSchema).min(1).optional(),
    validation: fieldValidationSchema.optional(),
    visibleIf: conditionSchema.optional(),
  })
  .strict()
  .superRefine((field, ctx) => {
    if (
      (field.type === "select" ||
        field.type === "radio" ||
        field.type === "checkbox") &&
      !field.options
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Le champ "${field.id}" de type ${field.type} nécessite une liste "options"`,
      });
    }
    if (field.type === "section" && field.options) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Le champ section "${field.id}" ne peut pas avoir d'options`,
      });
    }
    if (field.validation?.pattern !== undefined) {
      try {
        new RegExp(field.validation.pattern);
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Le champ "${field.id}" a une expression régulière invalide dans validation.pattern`,
        });
      }
    }
    if (
      field.validation?.minLength !== undefined &&
      field.validation?.maxLength !== undefined &&
      field.validation.minLength > field.validation.maxLength
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Le champ "${field.id}" : minLength > maxLength`,
      });
    }
  });
export type FormField = z.infer<typeof fieldSchema>;

export const formSchema = z
  .object({
    schemaVersion: z.literal(1).default(1),
    title: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    fields: z.array(fieldSchema).min(1).max(200),
  })
  .strict();
export type FormSchema = z.infer<typeof formSchema>;

export class SchemaValidationError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "DUPLICATE_FIELD_ID"
      | "CYCLE_DETECTED"
      | "UNKNOWN_CONDITION_FIELD",
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "SchemaValidationError";
  }
}

function detectCycles(fields: FormField[]): string[] | null {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  let cycle: string[] | null = null;

  function visit(id: string, path: string[]): void {
    if (cycle) return;
    if (visiting.has(id)) {
      cycle = [...path, id];
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    const field = byId.get(id);
    if (field?.visibleIf) {
      visit(field.visibleIf.field, [...path, id]);
    }
    visiting.delete(id);
    visited.add(id);
  }

  for (const field of fields) {
    visit(field.id, []);
    if (cycle) return cycle;
  }
  return null;
}

export function parseFormSchema(input: unknown): FormSchema {
  const ids = new Set<string>();
  const preliminary = formSchema.parse(input);
  for (const field of preliminary.fields) {
    if (ids.has(field.id)) {
      throw new SchemaValidationError(
        `Id de champ dupliqué : "${field.id}"`,
        "DUPLICATE_FIELD_ID",
        { fieldId: field.id },
      );
    }
    ids.add(field.id);
  }
  for (const field of preliminary.fields) {
    if (field.visibleIf && !ids.has(field.visibleIf.field)) {
      throw new SchemaValidationError(
        `Le champ "${field.id}" référence un champ inexistant "${field.visibleIf.field}" dans visibleIf`,
        "UNKNOWN_CONDITION_FIELD",
        { fieldId: field.id, referenced: field.visibleIf.field },
      );
    }
    if (field.visibleIf && field.visibleIf.field === field.id) {
      throw new SchemaValidationError(
        `Le champ "${field.id}" ne peut pas dépendre de lui-même`,
        "CYCLE_DETECTED",
        { cycle: [field.id, field.id] },
      );
    }
  }
  const cycle = detectCycles(preliminary.fields);
  if (cycle) {
    throw new SchemaValidationError(
      `Cycle de logique conditionnelle détecté : ${cycle.join(" → ")}`,
      "CYCLE_DETECTED",
      { cycle },
    );
  }
  return preliminary;
}
