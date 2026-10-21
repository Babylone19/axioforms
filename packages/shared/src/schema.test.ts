import { describe, expect, it } from "vitest";
import { SchemaValidationError, parseFormSchema } from "./schema.js";

const baseForm = {
  title: "Test",
  fields: [
    { id: "name", type: "text", label: "Nom", required: true },
    { id: "kind", type: "select", label: "Type", options: [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
    ] },
  ],
};

describe("parseFormSchema", () => {
  it("schema: accepte un formulaire de base", () => {
    const parsed = parseFormSchema(baseForm);
    expect(parsed.title).toBe("Test");
    expect(parsed.fields).toHaveLength(2);
    expect(parsed.schemaVersion).toBe(1);
  });

  it("schema: rejette un id de champ dupliqué", () => {
    expect(() =>
      parseFormSchema({
        title: "Dup",
        fields: [
          { id: "name", type: "text", label: "Nom" },
          { id: "name", type: "text", label: "Nom 2" },
        ],
      }),
    ).toThrowError(SchemaValidationError);
  });

  it("schema: rejette un select sans options", () => {
    expect(() =>
      parseFormSchema({
        title: "NoOpts",
        fields: [{ id: "choice", type: "select", label: "Choix" }],
      }),
    ).toThrowError(/options/);
  });

  it("schema: rejette une regexp invalide", () => {
    expect(() =>
      parseFormSchema({
        title: "BadRegex",
        fields: [
          {
            id: "code",
            type: "text",
            label: "Code",
            validation: { pattern: "([unclosed" },
          },
        ],
      }),
    ).toThrowError(/régulière invalide/);
  });

  it("conditions: rejette visibleIf pointant un champ inexistant", () => {
    expect(() =>
      parseFormSchema({
        title: "BadRef",
        fields: [
          {
            id: "vat",
            type: "text",
            label: "TVA",
            visibleIf: { field: "ghost", op: "eq", value: "x" },
          },
        ],
      }),
    ).toThrowError(SchemaValidationError);
  });

  it("conditions: rejette un cycle visibleIf (CYCLE_DETECTED)", () => {
    try {
      parseFormSchema({
        title: "Cycle",
        fields: [
          { id: "a", type: "text", label: "A", visibleIf: { field: "b", op: "truthy" } },
          { id: "b", type: "text", label: "B", visibleIf: { field: "a", op: "truthy" } },
        ],
      });
      expect.unreachable("aurait dû lever SchemaValidationError");
    } catch (e) {
      expect(e).toBeInstanceOf(SchemaValidationError);
      expect((e as SchemaValidationError).code).toBe("CYCLE_DETECTED");
    }
  });
});
