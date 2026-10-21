import { z } from "zod";
import type { FormField, FormSchema } from "./schema.js";

export type FieldErrors = Record<string, string>;

export type ValidationResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; errors: FieldErrors };

function requiredMessage(field: FormField): string {
  if (field.type === "checkbox") {
    return `Le champ « ${field.label} » exige au moins une option`;
  }
  if (field.type === "file") {
    return `Le champ « ${field.label} » exige un fichier`;
  }
  return `Le champ « ${field.label} » est obligatoire`;
}

function buildFieldSchema(field: FormField): z.ZodTypeAny {
  const v = field.validation;
  let base: z.ZodTypeAny;

  switch (field.type) {
    case "email": {
      base = z
        .string({ message: requiredMessage(field) })
        .trim()
        .min(1, requiredMessage(field))
        .email(v?.errorText ?? `Le champ « ${field.label} » doit être un email valide`);
      break;
    }
    case "number": {
      let num = z.coerce.number({
        message: `Le champ « ${field.label} » doit être un nombre`,
      });
      if (v?.min !== undefined) {
        num = num.min(
          v.min,
          v.errorText ?? `La valeur minimum est ${v.min}`,
        );
      }
      if (v?.max !== undefined) {
        num = num.max(
          v.max,
          v.errorText ?? `La valeur maximum est ${v.max}`,
        );
      }
      base = num.refine((n) => Number.isFinite(n), {
        message: `Le champ « ${field.label} » doit être un nombre`,
      });
      break;
    }
    case "date": {
      base = z
        .string({ message: requiredMessage(field) })
        .regex(
          /^\d{4}-\d{2}-\d{2}$/,
          v?.errorText ?? `Le champ « ${field.label} » doit être une date (AAAA-MM-JJ)`,
        )
        .refine((s) => !Number.isNaN(Date.parse(s)), {
          message: v?.errorText ?? `Le champ « ${field.label} » doit être une date valide`,
        });
      break;
    }
    case "checkbox": {
      const values = (field.options ?? []).map((o) => o.value) as [
        string,
        ...string[],
      ];
      const list = z
        .array(
          z.enum(values, {
            message: `Valeur non autorisée pour « ${field.label} »`,
          }),
        )
        .max(values.length);
      if (field.required) {
        base = list.min(1, requiredMessage(field));
      } else {
        base = list.optional();
      }
      return base;
    }
    case "select":
    case "radio": {
      const values = (field.options ?? []).map((o) => o.value) as [
        string,
        ...string[],
      ];
      const enumSchema = z.enum(values, {
        message: `Valeur non autorisée pour « ${field.label} »`,
      });
      if (field.required) {
        base = enumSchema;
      } else {
        base = enumSchema.optional();
      }
      return base;
    }
    case "file": {
      const uuidSchema = z
        .string({ message: requiredMessage(field) })
        .uuid(
          v?.errorText ?? `Le champ « ${field.label} » exige un fichier téléversé`,
        );
      base = field.required ? uuidSchema : uuidSchema.optional();
      return base;
    }
    case "section": {
      return z.never();
    }
    default: {
      let str = z
        .string({ message: requiredMessage(field) })
        .trim();
      if (field.required) str = str.min(1, requiredMessage(field));
      if (v?.minLength !== undefined) {
        str = str.min(
          v.minLength,
          v.errorText ?? `Minimum ${v.minLength} caractères`,
        );
      }
      if (v?.maxLength !== undefined) {
        str = str.max(
          v.maxLength,
          v.errorText ?? `Maximum ${v.maxLength} caractères`,
        );
      }
      if (v?.pattern !== undefined) {
        try {
          str = str.regex(
            new RegExp(v.pattern),
            v.errorText ?? `Le format du champ « ${field.label} » est invalide`,
          );
        } catch {
          // pattern invalide détecté par parseFormSchema, ignoré ici
        }
      }
      base = str;
    }
  }

  if (!field.required) {
    base = (base as z.ZodTypeAny).optional();
  }
  return base;
}

/**
 * Compile le schéma de formulaire en schéma Zod.
 * @param visible ensemble des ids de champs visibles (les masqués sont exclus,
 * donc ni exigés ni acceptés — toute valeur transmise pour eux est retirée avant).
 */
export function buildZodSchema(
  schema: FormSchema,
  visible?: Set<string>,
): z.ZodObject<Record<string, z.ZodTypeAny>, "strip"> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of schema.fields) {
    if (field.type === "section") continue;
    if (visible && !visible.has(field.id)) continue;
    shape[field.id] = buildFieldSchema(field);
  }
  return z.object(shape).strip();
}

function coerceRawValue(field: FormField, value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string" && value.trim() === "") return undefined;
  if (field.type === "checkbox" && !Array.isArray(value)) {
    return [value];
  }
  if (
    (field.type === "text" ||
      field.type === "textarea" ||
      field.type === "email") &&
    typeof value === "string"
  ) {
    return value.trim();
  }
  return value;
}

/**
 * Valide des réponses contre le schéma. Les champs masqués (absents de
 * `visible`) sont retirés de la sortie avant validation : un champ obligatoire
 * masqué ne peut donc jamais faire échouer la soumission.
 */
export function validateAnswers(
  schema: FormSchema,
  input: Record<string, unknown>,
  visible?: Set<string>,
): ValidationResult {
  const effectiveVisible = visible ?? new Set(
    schema.fields.filter((f) => f.type !== "section").map((f) => f.id),
  );

  const stripped: Record<string, unknown> = {};
  for (const field of schema.fields) {
    if (field.type === "section") continue;
    if (!effectiveVisible.has(field.id)) continue;
    if (field.id in input) {
      const coerced = coerceRawValue(field, input[field.id]);
      if (coerced !== undefined) stripped[field.id] = coerced;
    }
  }

  const zodSchema = buildZodSchema(schema, effectiveVisible);
  const result = zodSchema.safeParse(stripped);
  if (result.success) {
    return { ok: true, data: result.data };
  }

  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const fieldId = String(issue.path[0] ?? "_form");
    if (!errors[fieldId]) {
      errors[fieldId] = issue.message;
    }
  }
  return { ok: false, errors };
}
