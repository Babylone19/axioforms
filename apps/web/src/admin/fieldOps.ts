import type {
  FieldOption,
  FieldType,
  FormField,
  FormSchema,
} from "@axioforms/shared";

export const OPTION_TYPES: FieldType[] = ["select", "radio", "checkbox"];

const DEFAULT_IDS: Record<FieldType, string> = {
  text: "texte",
  textarea: "texte_long",
  email: "email",
  number: "nombre",
  date: "date",
  select: "liste",
  radio: "choix",
  checkbox: "cases",
  file: "fichier",
  section: "section",
};

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: "Texte court",
  textarea: "Texte long",
  email: "Email",
  number: "Nombre",
  date: "Date",
  select: "Liste déroulante",
  radio: "Choix unique",
  checkbox: "Cases à cocher",
  file: "Fichier",
  section: "Section",
};

export function sanitizeId(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^[^a-z]+/, "")
    .replace(/_+$/, "")
    .slice(0, 63);
}

export function uniqueFieldId(schema: FormSchema, base: string): string {
  const ids = new Set(schema.fields.map((f) => f.id));
  const normalized = sanitizeId(base) || "champ";
  if (!ids.has(normalized)) return normalized;
  let suffix = 2;
  while (ids.has(`${normalized}_${suffix}`)) suffix++;
  return `${normalized}_${suffix}`;
}

export function defaultOptions(): FieldOption[] {
  return [
    { value: "option_1", label: "Option 1" },
    { value: "option_2", label: "Option 2" },
  ];
}

export function createField(type: FieldType, schema: FormSchema): FormField {
  const base: FormField = {
    id: uniqueFieldId(schema, DEFAULT_IDS[type]),
    type,
    label: FIELD_TYPE_LABELS[type],
  };
  if (type === "section") return base;
  if (OPTION_TYPES.includes(type)) return { ...base, options: defaultOptions() };
  return base;
}

export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= items.length ||
    to >= items.length
  ) {
    return items;
  }
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

export function changeFieldType(field: FormField, type: FieldType): FormField {
  const next: FormField = { id: field.id, type, label: field.label };
  if (field.description) next.description = field.description;
  if (field.visibleIf) next.visibleIf = field.visibleIf;
  if (type === "section") return next;
  if (field.required) next.required = true;
  if (["text", "textarea", "email", "number"].includes(type) && field.placeholder) {
    next.placeholder = field.placeholder;
  }
  if (OPTION_TYPES.includes(type)) {
    next.options = field.options ?? defaultOptions();
  }
  if (field.validation) next.validation = { ...field.validation };
  return next;
}
