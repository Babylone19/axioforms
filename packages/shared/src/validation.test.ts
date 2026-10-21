import { describe, expect, it } from "vitest";
import { parseFormSchema, type FormSchema } from "./schema.js";
import { validateAnswers, buildZodSchema } from "./validation.js";

const form = parseFormSchema({
  title: "Validation",
  fields: [
    { id: "name", type: "text", label: "Nom", required: true, validation: { minLength: 2, maxLength: 10 } },
    { id: "email", type: "email", label: "Email", required: true },
    { id: "age", type: "number", label: "Âge", required: false, validation: { min: 18, max: 99 } },
    { id: "signup_date", type: "date", label: "Date", required: false },
    { id: "city", type: "select", label: "Ville", required: true, options: [
      { value: "paris", label: "Paris" },
      { value: "lyon", label: "Lyon" },
    ] },
    { id: "plan", type: "radio", label: "Offre", required: false, options: [
      { value: "basic", label: "Basic" },
      { value: "pro", label: "Pro" },
    ] },
    { id: "interests", type: "checkbox", label: "Centres d'intérêt", required: true, options: [
      { value: "news", label: "News" },
      { value: "events", label: "Events" },
    ] },
    { id: "code", type: "text", label: "Code", required: false, validation: {
      pattern: "^BE[0-9]{10}$",
      errorText: "Format BE + 10 chiffres",
    } },
    { id: "contract", type: "file", label: "Contrat", required: false },
    { id: "notes", type: "textarea", label: "Notes", required: false, validation: { maxLength: 50 } },
  ],
});

const base = {
  name: "Ada",
  email: "ada@example.com",
  city: "paris",
  interests: ["news"],
};

describe("validateAnswers — succès", () => {
  it("validation: réponse valide acceptée", () => {
    const r = validateAnswers(form, base);
    expect(r.ok).toBe(true);
  });

  it("validation: champs optionnels absents acceptés", () => {
    const r = validateAnswers(form, base);
    expect(r.ok).toBe(true);
    expect(r.ok && r.data.age).toBeUndefined();
  });

  it("validation: number coercé depuis string form-data (\"42\" → 42)", () => {
    const r = validateAnswers(form, { ...base, age: "42" });
    expect(r.ok).toBe(true);
    expect(r.ok && r.data.age).toBe(42);
  });

  it("validation: chaîne vidée de ses espaces", () => {
    const r = validateAnswers(form, { ...base, name: "  Ada  " });
    expect(r.ok && r.data.name).toBe("Ada");
  });

  it("validation: checkbox avec valeur unique form-data wrap en tableau", () => {
    const r = validateAnswers(form, { ...base, interests: "events" });
    expect(r.ok && r.data.interests).toEqual(["events"]);
  });
});

describe("validateAnswers — rejets", () => {
  it("validation: required manquant rejeté", () => {
    const { name: _name, ...sansNom } = base;
    const r = validateAnswers(form, sansNom);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.name).toMatch(/obligatoire/);
  });

  it("validation: email invalide rejeté", () => {
    const r = validateAnswers(form, { ...base, email: "pas-un-email" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.email).toMatch(/email valide/);
  });

  it("validation: minLength non respecté rejeté", () => {
    const r = validateAnswers(form, { ...base, name: "A" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.name).toMatch(/Minimum 2/);
  });

  it("validation: maxLength non respecté rejeté", () => {
    const r = validateAnswers(form, { ...base, name: "A".repeat(11) });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.name).toMatch(/Maximum 10/);
  });

  it("validation: number en dessous de min rejeté", () => {
    const r = validateAnswers(form, { ...base, age: 17 });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.age).toMatch(/minimum est 18/);
  });

  it("validation: number au-dessus de max rejeté", () => {
    const r = validateAnswers(form, { ...base, age: 100 });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.age).toMatch(/maximum est 99/);
  });

  it("validation: nombre non numérique rejeté", () => {
    const r = validateAnswers(form, { ...base, age: "abc" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.age).toBeTruthy();
  });

  it("validation: pattern regex non respecté rejeté avec errorText", () => {
    const r = validateAnswers(form, { ...base, code: "XX123" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.code).toBe("Format BE + 10 chiffres");
  });

  it("validation: valeur hors options select rejetée (injection)", () => {
    const r = validateAnswers(form, { ...base, city: "hacker-ville" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.city).toMatch(/non autorisée/);
  });

  it("validation: valeur hors options radio rejetée", () => {
    const r = validateAnswers(form, { ...base, plan: "gratuit" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.plan).toMatch(/non autorisée/);
  });

  it("validation: checkbox required avec tableau vide rejeté", () => {
    const r = validateAnswers(form, { ...base, interests: [] });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.interests).toMatch(/au moins une option/);
  });

  it("validation: checkbox avec valeur hors options rejetée", () => {
    const r = validateAnswers(form, { ...base, interests: ["news", "xxx"] });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.interests).toMatch(/non autorisée/);
  });

  it("validation: date au format invalide rejetée", () => {
    const r = validateAnswers(form, { ...base, signup_date: "21/10/2026" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.signup_date).toMatch(/AAAA-MM-JJ/);
  });
});

describe("validateAnswers — champs masqués", () => {
  const visibleOnlyName = new Set(["name", "email", "city", "interests"]);

  it("validation: champ masqué required absent → aucune erreur", () => {
    const r = validateAnswers(form, base, visibleOnlyName);
    expect(r.ok).toBe(true);
  });

  it("validation: champ masqué fourni volontairement est strippé du résultat", () => {
    const r = validateAnswers(
      form,
      { ...base, age: 150, code: "nimp" },
      visibleOnlyName,
    );
    expect(r.ok).toBe(true);
    expect(r.ok && "age" in r.data).toBe(false);
    expect(r.ok && "code" in r.data).toBe(false);
  });

  it("validation: champ masqué transmis avec valeur invalide → ignoré (strippé avant Zod)", () => {
    const r = validateAnswers(form, { ...base, email: "not-an-email" }, new Set(["name", "city", "interests"]));
    expect(r.ok).toBe(true);
  });

  it("validation: ensemble visible sans champ obligatoire → validé sans lui", () => {
    const { city: _city, ...sansVille } = base;
    const r = validateAnswers(form, sansVille, new Set(["name", "email", "interests"]));
    expect(r.ok).toBe(true);
  });
});

describe("buildZodSchema", () => {
  it("validation: les champs exclus de l'ensemble visible ne sont pas dans le schéma Zod", () => {
    const zodSchema = buildZodSchema(form, new Set(["name"]));
    expect(Object.keys(zodSchema.shape)).toEqual(["name"]);
  });

  it("validation: les sections n'apparaissent jamais comme champs de réponse", () => {
    const withSection = parseFormSchema({
      title: "S",
      fields: [
        { id: "intro", type: "section", label: "Section 1" },
        { id: "name", type: "text", label: "Nom", required: true },
      ],
    });
    const r = validateAnswers(withSection, { name: "Ada" });
    expect(r.ok).toBe(true);
    expect(r.ok && r.data).toEqual({ name: "Ada" });
  });

  it("validation: tout champ du schéma valide produit un objet vide sans erreur pour champs optionnels vides", () => {
    const schema: FormSchema = parseFormSchema({
      title: "Optionnel",
      fields: [{ id: "x", type: "text", label: "X", required: false }],
    });
    const r = validateAnswers(schema, {});
    expect(r.ok).toBe(true);
  });
});
