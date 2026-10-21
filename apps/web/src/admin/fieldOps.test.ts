import { describe, expect, it } from "vitest";
import type { FormField, FormSchema } from "@axioforms/shared";
import {
  changeFieldType,
  createField,
  moveItem,
  sanitizeId,
  uniqueFieldId,
} from "./fieldOps.js";

const schema: FormSchema = {
  schemaVersion: 1,
  title: "Test",
  fields: [
    { id: "a", type: "text", label: "A" },
    { id: "b", type: "text", label: "B" },
    { id: "c", type: "text", label: "C" },
  ],
};

describe("sanitizeId", () => {
  it("normalise en minuscules avec underscores", () => {
    expect(sanitizeId("Mon Champ - TVA !")).toBe("mon_champ_tva");
  });

  it("supprime les caractères de tête invalides", () => {
    expect(sanitizeId("123abc")).toBe("abc");
    expect(sanitizeId("__x")).toBe("x");
  });

  it("tronque à 63 caractères", () => {
    expect(sanitizeId("a".repeat(80))).toHaveLength(63);
  });
});

describe("uniqueFieldId", () => {
  it("retourne l'id de base s'il est libre", () => {
    expect(uniqueFieldId(schema, "email")).toBe("email");
  });

  it("suffixe en cas de collision", () => {
    expect(uniqueFieldId(schema, "a")).toBe("a_2");
  });

  it("gère plusieurs collisions et un id vide", () => {
    const occupied = { ...schema, fields: [...schema.fields, { id: "a_2", type: "text", label: "A2" } as FormField] };
    expect(uniqueFieldId(occupied, "a")).toBe("a_3");
    expect(uniqueFieldId(schema, "")).toBe("champ");
  });
});

describe("createField", () => {
  it("crée un champ texte minimal avec un id unique", () => {
    const field = createField("text", schema);
    expect(field).toEqual({ id: "texte", type: "text", label: "Texte court" });
  });

  it("ajoute des options par défaut pour une liste", () => {
    const field = createField("select", schema);
    expect(field.options).toHaveLength(2);
    expect(field.options?.[0]).toEqual({ value: "option_1", label: "Option 1" });
  });

  it("crée une section sans options ni validation", () => {
    const field = createField("section", schema);
    expect(field).toEqual({ id: "section", type: "section", label: "Section" });
  });
});

describe("moveItem", () => {
  it("déplace un élément vers le bas", () => {
    expect(moveItem([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
  });

  it("déplace un élément vers le haut", () => {
    expect(moveItem([1, 2, 3], 2, 0)).toEqual([3, 1, 2]);
  });

  it("retourne le tableau inchangé si indices invalides ou identiques", () => {
    const items = [1, 2, 3];
    expect(moveItem(items, 1, 1)).toBe(items);
    expect(moveItem(items, -1, 2)).toBe(items);
    expect(moveItem(items, 0, 5)).toBe(items);
  });
});

describe("changeFieldType", () => {
  it("conserve id, label et visibleIf", () => {
    const field: FormField = {
      id: "x",
      type: "text",
      label: "X",
      required: true,
      visibleIf: { field: "a", op: "truthy" },
    };
    const next = changeFieldType(field, "number");
    expect(next.id).toBe("x");
    expect(next.label).toBe("X");
    expect(next.required).toBe(true);
    expect(next.visibleIf).toEqual({ field: "a", op: "truthy" });
    expect(next.options).toBeUndefined();
  });

  it("ajoute des options pour un type à choix", () => {
    const next = changeFieldType({ id: "x", type: "text", label: "X" }, "radio");
    expect(next.options).toHaveLength(2);
  });

  it("retire options et required pour une section", () => {
    const field: FormField = {
      id: "x",
      type: "select",
      label: "X",
      required: true,
      options: [{ value: "a", label: "A" }],
    };
    const next = changeFieldType(field, "section");
    expect(next).toEqual({ id: "x", type: "section", label: "X" });
  });
});
