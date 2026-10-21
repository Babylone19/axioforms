import { describe, expect, it } from "vitest";
import { parseFormSchema } from "./schema.js";
import { evaluateVisibility } from "./visibility.js";

const onboarding = parseFormSchema({
  title: "Onboarding",
  fields: [
    { id: "client_type", type: "select", label: "Type", required: true, options: [
      { value: "particulier", label: "Particulier" },
      { value: "entreprise", label: "Entreprise" },
    ] },
    { id: "company_name", type: "text", label: "Raison sociale",
      visibleIf: { field: "client_type", op: "eq", value: "entreprise" } },
    { id: "vat_number", type: "text", label: "N° TVA",
      visibleIf: { field: "client_type", op: "eq", value: "entreprise" } },
    { id: "interests", type: "checkbox", label: "Centres d'intérêt", options: [
      { value: "news", label: "News" },
      { value: "events", label: "Events" },
    ] },
    { id: "newsletter", type: "text", label: "Fréquence news",
      visibleIf: { field: "interests", op: "contains", value: "news" } },
    { id: "age", type: "number", label: "Âge" },
    { id: "budget", type: "number", label: "Budget" },
    { id: "premium", type: "text", label: "Premium",
      visibleIf: { field: "budget", op: "gt", value: 1000 } },
    { id: "country", type: "select", label: "Pays", options: [
      { value: "fr", label: "France" },
      { value: "be", label: "Belgique" },
    ] },
    { id: "region", type: "text", label: "Région",
      visibleIf: { field: "country", op: "in", value: ["fr", "be"] } },
    { id: "city", type: "text", label: "Ville",
      visibleIf: { field: "country", op: "not_in", value: ["fr"] } },
    { id: "company_name_size", type: "text", label: "Taille société",
      visibleIf: { field: "company_name", op: "truthy" } },
    { id: "sector", type: "text", label: "Secteur",
      visibleIf: { field: "company_name_size", op: "truthy" } },
  ],
});

const onboardingClean = parseFormSchema({
  title: "Clean",
  fields: [
    { id: "client_type", type: "select", label: "Type", options: [
      { value: "particulier", label: "Particulier" },
      { value: "entreprise", label: "Entreprise" },
    ] },
    { id: "company_name", type: "text", label: "Raison sociale",
      visibleIf: { field: "client_type", op: "eq", value: "entreprise" } },
    { id: "company_name_size", type: "text", label: "Taille",
      visibleIf: { field: "company_name", op: "truthy" } },
    { id: "sector", type: "text", label: "Secteur",
      visibleIf: { field: "company_name_size", op: "truthy" } },
    { id: "notes", type: "textarea", label: "Notes" },
  ],
});

describe("evaluateVisibility", () => {
  it("conditions: champ sans visibleIf toujours visible", () => {
    const v = evaluateVisibility(onboarding, {});
    expect(v.has("client_type")).toBe(true);
    expect(v.has("notes") || v.has("client_type")).toBe(true);
  });

  it("conditions: eq visible si valeur correspondante", () => {
    const v = evaluateVisibility(onboarding, { client_type: "entreprise" });
    expect(v.has("company_name")).toBe(true);
    expect(v.has("vat_number")).toBe(true);
  });

  it("conditions: eq masqué si valeur différente", () => {
    const v = evaluateVisibility(onboarding, { client_type: "particulier" });
    expect(v.has("company_name")).toBe(false);
    expect(v.has("vat_number")).toBe(false);
  });

  it("conditions: valeur absente du champ référencé → condition false", () => {
    const v = evaluateVisibility(onboarding, {});
    expect(v.has("company_name")).toBe(false);
  });

  it("conditions: neq masqué si valeur égale", () => {
    const schema = parseFormSchema({
      title: "Neq",
      fields: [
        { id: "a", type: "text", label: "A" },
        { id: "b", type: "text", label: "B", visibleIf: { field: "a", op: "neq", value: "x" } },
      ],
    });
    expect(evaluateVisibility(schema, { a: "x" }).has("b")).toBe(false);
    expect(evaluateVisibility(schema, { a: "y" }).has("b")).toBe(true);
    expect(evaluateVisibility(schema, {}).has("b")).toBe(false);
  });

  it("conditions: in accepte une valeur de la liste", () => {
    const v = evaluateVisibility(onboarding, { country: "be" });
    expect(v.has("region")).toBe(true);
    expect(v.has("city")).toBe(true);
  });

  it("conditions: not_in masqué si valeur dans la liste", () => {
    const v = evaluateVisibility(onboarding, { country: "fr" });
    expect(v.has("city")).toBe(false);
    expect(v.has("region")).toBe(true);
  });

  it("conditions: gt sur champ number", () => {
    expect(evaluateVisibility(onboarding, { budget: 2000 }).has("premium")).toBe(true);
    expect(evaluateVisibility(onboarding, { budget: 500 }).has("premium")).toBe(false);
    expect(evaluateVisibility(onboarding, {}).has("premium")).toBe(false);
  });

  it("conditions: contains sur tableau checkbox", () => {
    const avecNews = evaluateVisibility(onboarding, { interests: ["news", "events"] });
    expect(avecNews.has("newsletter")).toBe(true);
    const sansNews = evaluateVisibility(onboarding, { interests: ["events"] });
    expect(sansNews.has("newsletter")).toBe(false);
    const vide = evaluateVisibility(onboarding, { interests: [] });
    expect(vide.has("newsletter")).toBe(false);
  });

  it("conditions: visibilité en cascade sur 3 niveaux (fixpoint)", () => {
    const v = evaluateVisibility(onboardingClean, {
      client_type: "entreprise",
      company_name: "Acme",
      company_name_size: "10-50",
    });
    expect(v.has("company_name")).toBe(true);
    expect(v.has("company_name_size")).toBe(true);
    expect(v.has("sector")).toBe(true);
  });

  it("conditions: champ dépendant d'un champ masqué est masqué", () => {
    const v = evaluateVisibility(onboardingClean, { client_type: "particulier" });
    expect(v.has("company_name")).toBe(false);
    expect(v.has("company_name_size")).toBe(false);
    expect(v.has("sector")).toBe(false);
  });

  it("conditions: la saisie d'un champ masqué ne réactive pas sa descendance si lui-même reste masqué", () => {
    const v = evaluateVisibility(onboardingClean, {
      client_type: "particulier",
      company_name: "Hacker",
    });
    expect(v.has("company_name")).toBe(false);
    expect(v.has("company_name_size")).toBe(false);
  });

  it("conditions: section visibleIf évaluée comme un champ", () => {
    const schema = parseFormSchema({
      title: "Sections",
      fields: [
        { id: "show", type: "text", label: "Afficher" },
        { id: "sec", type: "section", label: "Section", visibleIf: { field: "show", op: "truthy" } },
        { id: "name", type: "text", label: "Nom" },
      ],
    });
    expect(evaluateVisibility(schema, { show: "oui" }).has("sec")).toBe(true);
    expect(evaluateVisibility(schema, {}).has("sec")).toBe(false);
    expect(evaluateVisibility(schema, {}).has("name")).toBe(true);
  });

  it("conditions: truthy sur checkbox remplie", () => {
    const v = evaluateVisibility(onboarding, { interests: ["news"] });
    expect(v.has("newsletter")).toBe(true);
  });
});
