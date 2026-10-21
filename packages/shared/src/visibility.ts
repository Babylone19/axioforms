import type { Condition, FormField, FormSchema } from "./schema.js";

function fieldById(schema: FormSchema): Map<string, FormField> {
  return new Map(schema.fields.map((f) => [f.id, f]));
}

function isAbsent(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

function looseEquals(a: unknown, b: unknown): boolean {
  if (typeof a === "number" || typeof b === "number") {
    return Number(a) === Number(b);
  }
  if (typeof a === "boolean" || typeof b === "boolean") {
    return Boolean(a) === Boolean(b);
  }
  return String(a) === String(b);
}

function matchCondition(
  condition: Condition,
  rawValue: unknown,
): boolean {
  if (isAbsent(rawValue)) return false;

  const { op, value } = condition;

  if (Array.isArray(rawValue)) {
    switch (op) {
      case "truthy":
        return rawValue.length > 0;
      case "eq":
      case "contains":
        return Array.isArray(value)
          ? value.some((v) => rawValue.some((r) => looseEquals(r, v)))
          : rawValue.some((r) => looseEquals(r, value));
      case "neq":
      case "not_in":
        return !matchCondition(
          { ...condition, op: op === "neq" ? "eq" : "contains" },
          rawValue,
        );
      case "in":
        return Array.isArray(value)
          ? rawValue.some((r) => value.some((v) => looseEquals(r, v)))
          : rawValue.some((r) => looseEquals(r, value));
      case "gt":
      case "lt":
        return false;
    }
  }

  switch (op) {
    case "truthy":
      return true;
    case "eq":
      return looseEquals(rawValue, value);
    case "neq":
      return !looseEquals(rawValue, value);
    case "in":
      return Array.isArray(value)
        ? value.some((v) => looseEquals(rawValue, v))
        : false;
    case "not_in":
      return Array.isArray(value)
        ? !value.some((v) => looseEquals(rawValue, v))
        : true;
    case "contains":
      return String(rawValue).includes(String(value));
    case "gt": {
      const n = Number(rawValue);
      const c = Number(value);
      return Number.isFinite(n) && Number.isFinite(c) && n > c;
    }
    case "lt": {
      const n = Number(rawValue);
      const c = Number(value);
      return Number.isFinite(n) && Number.isFinite(c) && n < c;
    }
    default:
      return false;
  }
}

/**
 * Évalue les champs visibles d'un formulaire pour une valeur de saisie donnée.
 *
 * Règles :
 * - un champ sans `visibleIf` est toujours visible ;
 * - une condition évaluée sur une valeur absente/vide est toujours fausse ;
 * - un champ dont la condition référence un champ masqué est lui-même masqué ;
 * - l'évaluation est en cascade (fixpoint borné — le graphe est acyclique,
 *   garanti par parseFormSchema).
 *
 * @returns l'ensemble des ids de champs visibles (sections comprises)
 */
export function evaluateVisibility(
  schema: FormSchema,
  input: Record<string, unknown>,
): Set<string> {
  const byId = fieldById(schema);
  const all = schema.fields;

  let visible = new Set(all.map((f) => f.id));
  const maxIter = all.length + 2;

  for (let iter = 0; iter < maxIter; iter++) {
    const next = new Set<string>();
    for (const field of all) {
      if (!field.visibleIf) {
        next.add(field.id);
        continue;
      }
      const referenced = byId.get(field.visibleIf.field);
      if (!referenced || !visible.has(referenced.id)) continue;
      const rawValue = input[field.visibleIf.field];
      if (matchCondition(field.visibleIf, rawValue)) {
        next.add(field.id);
      }
    }
    const stable =
      next.size === visible.size && [...next].every((id) => visible.has(id));
    visible = next;
    if (stable) return visible;
  }
  throw new Error(
    "Évaluation de visibilité non stabilisée (graphe de conditions invalide)",
  );
}
