import { useState } from "react";
import {
  CONDITION_OPS,
  FIELD_TYPES,
  type Condition,
  type ConditionOp,
  type FieldType,
  type FormField,
  type FormSchema,
} from "@axioforms/shared";
import {
  FIELD_TYPE_LABELS,
  OPTION_TYPES,
  changeFieldType,
  createField,
  moveItem,
  sanitizeId,
} from "./fieldOps.js";

const OP_LABELS: Record<ConditionOp, string> = {
  eq: "égal à",
  neq: "différent de",
  in: "parmi",
  not_in: "en dehors de",
  gt: "supérieur à",
  lt: "inférieur à",
  contains: "contient",
  truthy: "est rempli",
};

function parseConditionValue(op: ConditionOp, raw: string): unknown {
  if (op === "truthy") return undefined;
  if (op === "gt" || op === "lt") {
    const trimmed = raw.trim();
    return trimmed === "" || Number.isNaN(Number(trimmed)) ? undefined : Number(trimmed);
  }
  if (op === "in" || op === "not_in") {
    return raw
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  }
  return raw;
}

function formatConditionValue(op: ConditionOp, value: unknown): string {
  if (op === "truthy") return "";
  if (op === "in" || op === "not_in") {
    return Array.isArray(value) ? value.join(", ") : value == null ? "" : String(value);
  }
  return value == null ? "" : String(value);
}

function validateFieldId(
  id: string,
  index: number,
  fields: FormField[],
): string | null {
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(id)) {
    return "Id invalide (minuscules, chiffres, _, commence par une lettre)";
  }
  if (fields.some((f, i) => i !== index && f.id === id)) {
    return "Id déjà utilisé par un autre champ";
  }
  return null;
}

export default function VisualEditor({
  schema,
  onChange,
}: {
  schema: FormSchema;
  onChange: (next: FormSchema) => void;
}) {
  const [newType, setNewType] = useState<FieldType>("text");
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [idErrors, setIdErrors] = useState<Record<number, string>>({});

  const updateField = (index: number, next: FormField) => {
    onChange({
      ...schema,
      fields: schema.fields.map((field, i) => (i === index ? next : field)),
    });
  };

  const removeField = (index: number) => {
    const field = schema.fields[index]!;
    if (!window.confirm(`Supprimer le champ « ${field.label} » ?`)) return;
    onChange({
      ...schema,
      fields: schema.fields.filter((_, i) => i !== index),
    });
  };

  const reorder = (from: number, to: number) => {
    if (from === to) return;
    onChange({ ...schema, fields: moveItem(schema.fields, from, to) });
  };

  const addField = () => {
    onChange({
      ...schema,
      fields: [...schema.fields, createField(newType, schema)],
    });
  };

  const updateId = (index: number, raw: string) => {
    const field = schema.fields[index]!;
    const id = sanitizeId(raw);
    const error = validateFieldId(id, index, schema.fields);
    setIdErrors((prev) => {
      const next = { ...prev };
      if (error) next[index] = error;
      else delete next[index];
      return next;
    });
    if (!error) updateField(index, { ...field, id });
  };

  const setCondition = (index: number, patch: Partial<Condition>) => {
    const field = schema.fields[index]!;
    if (!field.visibleIf) return;
    const next: Condition = { ...field.visibleIf, ...patch };
    if (next.op === "truthy") delete next.value;
    updateField(index, { ...field, visibleIf: next });
  };

  const setNumericValidation = (
    index: number,
    key: "minLength" | "maxLength" | "min" | "max" | "maxSizeBytes",
    raw: string,
  ) => {
    const field = schema.fields[index]!;
    const validation = { ...(field.validation ?? {}) };
    const trimmed = raw.trim();
    if (trimmed === "") delete validation[key];
    else validation[key] = Number(trimmed);
    updateField(index, {
      ...field,
      validation: Object.keys(validation).length > 0 ? validation : undefined,
    });
  };

  const setTextValidation = (
    index: number,
    key: "pattern" | "errorText",
    raw: string,
  ) => {
    const field = schema.fields[index]!;
    const validation = { ...(field.validation ?? {}) };
    if (raw === "") delete validation[key];
    else validation[key] = raw;
    updateField(index, {
      ...field,
      validation: Object.keys(validation).length > 0 ? validation : undefined,
    });
  };

  const setMimeTypes = (index: number, raw: string) => {
    const field = schema.fields[index]!;
    const validation = { ...(field.validation ?? {}) };
    const types = raw
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    if (types.length === 0) delete validation.acceptedMimeTypes;
    else validation.acceptedMimeTypes = types;
    updateField(index, {
      ...field,
      validation: Object.keys(validation).length > 0 ? validation : undefined,
    });
  };

  return (
    <div className="visual-editor">
      <div className="add-field">
        <label htmlFor="new-field-type" className="muted small">
          Ajouter un champ
        </label>
        <select
          id="new-field-type"
          value={newType}
          onChange={(e) => setNewType(e.target.value as FieldType)}
        >
          {FIELD_TYPES.map((type) => (
            <option key={type} value={type}>
              {FIELD_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
        <button type="button" className="btn" onClick={addField}>
          + Ajouter
        </button>
      </div>

      {schema.fields.length === 0 ? (
        <p className="muted">
          Aucun champ. Ajoutez-en un ou repassez en mode JSON.
        </p>
      ) : (
        <ul className="field-list">
          {schema.fields.map((field, index) => {
            const optionsRequired = OPTION_TYPES.includes(field.type);
            const textLike = ["text", "textarea", "email"].includes(field.type);
            const numeric = field.type === "number";
            const file = field.type === "file";
            const idError = idErrors[index];

            return (
              <li
                key={index}
                className={`field-card ${overIndex === index ? "drag-over" : ""}`}
                draggable
                onDragStart={(e) => {
                  const target = e.nativeEvent.target as HTMLElement;
                  if (!target.closest(".drag-handle")) {
                    e.preventDefault();
                    return;
                  }
                  e.dataTransfer.effectAllowed = "move";
                  setDragIndex(index);
                }}
                onDragOver={(e) => {
                  if (dragIndex === null) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setOverIndex(index);
                }}
                onDragLeave={() => {
                  if (overIndex === index) setOverIndex(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragIndex !== null) reorder(dragIndex, index);
                  setDragIndex(null);
                  setOverIndex(null);
                }}
                onDragEnd={() => {
                  setDragIndex(null);
                  setOverIndex(null);
                }}
              >
                <details>
                  <summary>
                    <span className="drag-handle" title="Glisser pour réordonner">
                      ⠿
                    </span>
                    <span className="type-badge">{FIELD_TYPE_LABELS[field.type]}</span>
                    <span className="field-summary-label">
                      {field.label || "(sans libellé)"}
                    </span>
                    {field.required && <span className="chip">requis</span>}
                    {field.visibleIf && <span className="chip">conditionnel</span>}
                    <span className="field-actions">
                      <button
                        type="button"
                        className="btn btn-ghost small"
                        title="Monter"
                        disabled={index === 0}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          reorder(index, index - 1);
                        }}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost small"
                        title="Descendre"
                        disabled={index === schema.fields.length - 1}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          reorder(index, index + 1);
                        }}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger small"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          removeField(index);
                        }}
                      >
                        Supprimer
                      </button>
                    </span>
                  </summary>

                  <div className="field-body">
                    <div className="field-grid">
                      <label>
                        Libellé
                        <input
                          value={field.label}
                          onChange={(e) =>
                            updateField(index, { ...field, label: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        Identifiant technique
                        <input
                          value={field.id}
                          onChange={(e) => updateId(index, e.target.value)}
                          aria-invalid={Boolean(idError)}
                        />
                        {idError && (
                          <span className="field-error">{idError}</span>
                        )}
                      </label>
                    </div>

                    <label>
                      Description (optionnelle)
                      <input
                        value={field.description ?? ""}
                        onChange={(e) =>
                          updateField(index, {
                            ...field,
                            description: e.target.value || undefined,
                          })
                        }
                      />
                    </label>

                    <div className="field-grid">
                      <label>
                        Type
                        <select
                          value={field.type}
                          onChange={(e) =>
                            updateField(
                              index,
                              changeFieldType(field, e.target.value as FieldType),
                            )
                          }
                        >
                          {FIELD_TYPES.map((type) => (
                            <option key={type} value={type}>
                              {FIELD_TYPE_LABELS[type]}
                            </option>
                          ))}
                        </select>
                      </label>

                      {field.type !== "section" ? (
                        <label className="check-line">
                          <input
                            type="checkbox"
                            checked={Boolean(field.required)}
                            onChange={(e) =>
                              updateField(index, {
                                ...field,
                                required: e.target.checked || undefined,
                              })
                            }
                          />
                          Champ obligatoire
                        </label>
                      ) : (
                        <span />
                      )}
                    </div>

                    {["text", "textarea", "email", "number", "date"].includes(
                      field.type,
                    ) && (
                      <label>
                        Placeholder (optionnel)
                        <input
                          value={field.placeholder ?? ""}
                          onChange={(e) =>
                            updateField(index, {
                              ...field,
                              placeholder: e.target.value || undefined,
                            })
                          }
                        />
                      </label>
                    )}

                    {optionsRequired && (
                      <div className="options-editor">
                        <span className="muted small">Options</span>
                        {(field.options ?? []).map((option, optionIndex) => (
                          <div className="option-row" key={optionIndex}>
                            <input
                              value={option.value}
                              aria-label={`Valeur de l'option ${optionIndex + 1}`}
                              onChange={(e) => {
                                const value = sanitizeId(e.target.value);
                                updateField(index, {
                                  ...field,
                                  options: (field.options ?? []).map((o, i) =>
                                    i === optionIndex ? { ...o, value } : o,
                                  ),
                                });
                              }}
                            />
                            <input
                              value={option.label}
                              aria-label={`Libellé de l'option ${optionIndex + 1}`}
                              onChange={(e) =>
                                updateField(index, {
                                  ...field,
                                  options: (field.options ?? []).map((o, i) =>
                                    i === optionIndex
                                      ? { ...o, label: e.target.value }
                                      : o,
                                  ),
                                })
                              }
                            />
                            <button
                              type="button"
                              className="btn btn-ghost small"
                              disabled={(field.options?.length ?? 0) <= 1}
                              onClick={() =>
                                updateField(index, {
                                  ...field,
                                  options: (field.options ?? []).filter(
                                    (_, i) => i !== optionIndex,
                                  ),
                                })
                              }
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          className="btn btn-ghost small"
                          onClick={() => {
                            const options = field.options ?? [];
                            let n = options.length + 1;
                            while (
                              options.some((o) => o.value === `option_${n}`)
                            ) {
                              n++;
                            }
                            updateField(index, {
                              ...field,
                              options: [
                                ...options,
                                { value: `option_${n}`, label: `Option ${n}` },
                              ],
                            });
                          }}
                        >
                          + Option
                        </button>
                      </div>
                    )}

                    {(textLike || numeric || file) && (
                      <details className="advanced">
                        <summary>Validation</summary>
                        <div className="field-grid">
                          {textLike && (
                            <>
                              <label>
                                Longueur min.
                                <input
                                  type="number"
                                  min={0}
                                  value={field.validation?.minLength ?? ""}
                                  onChange={(e) =>
                                    setNumericValidation(index, "minLength", e.target.value)
                                  }
                                />
                              </label>
                              <label>
                                Longueur max.
                                <input
                                  type="number"
                                  min={1}
                                  value={field.validation?.maxLength ?? ""}
                                  onChange={(e) =>
                                    setNumericValidation(index, "maxLength", e.target.value)
                                  }
                                />
                              </label>
                            </>
                          )}
                          {numeric && (
                            <>
                              <label>
                                Valeur min.
                                <input
                                  type="number"
                                  value={field.validation?.min ?? ""}
                                  onChange={(e) =>
                                    setNumericValidation(index, "min", e.target.value)
                                  }
                                />
                              </label>
                              <label>
                                Valeur max.
                                <input
                                  type="number"
                                  value={field.validation?.max ?? ""}
                                  onChange={(e) =>
                                    setNumericValidation(index, "max", e.target.value)
                                  }
                                />
                              </label>
                            </>
                          )}
                          {file && (
                            <>
                              <label>
                                Taille max. (octets)
                                <input
                                  type="number"
                                  min={1}
                                  value={field.validation?.maxSizeBytes ?? ""}
                                  onChange={(e) =>
                                    setNumericValidation(
                                      index,
                                      "maxSizeBytes",
                                      e.target.value,
                                    )
                                  }
                                />
                                <span className="muted small">
                                  2 Mo = 2097152
                                </span>
                              </label>
                              <label>
                                Types MIME acceptés (séparés par des virgules)
                                <input
                                  value={
                                    field.validation?.acceptedMimeTypes?.join(", ") ?? ""
                                  }
                                  placeholder="application/pdf, image/png"
                                  onChange={(e) =>
                                    setMimeTypes(index, e.target.value)
                                  }
                                />
                              </label>
                            </>
                          )}
                        </div>
                        {textLike && (
                          <div className="field-grid">
                            <label>
                              Expression régulière
                              <input
                                value={field.validation?.pattern ?? ""}
                                placeholder="^BE[0-9]{10}$"
                                onChange={(e) =>
                                  setTextValidation(index, "pattern", e.target.value)
                                }
                              />
                            </label>
                            <label>
                              Message d'erreur
                              <input
                                value={field.validation?.errorText ?? ""}
                                placeholder="Format attendu…"
                                onChange={(e) =>
                                  setTextValidation(index, "errorText", e.target.value)
                                }
                              />
                            </label>
                          </div>
                        )}
                      </details>
                    )}

                    <details className="advanced">
                      <summary>Affichage conditionnel</summary>
                      <div className="field-grid">
                        <label>
                          Afficher si le champ
                          <select
                            value={field.visibleIf?.field ?? ""}
                            onChange={(e) => {
                              const referenced = e.target.value;
                              if (!referenced) {
                                updateField(index, {
                                  ...field,
                                  visibleIf: undefined,
                                });
                                return;
                              }
                              updateField(index, {
                                ...field,
                                visibleIf: {
                                  field: referenced,
                                  op: field.visibleIf?.op ?? "eq",
                                  value: field.visibleIf?.value,
                                },
                              });
                            }}
                          >
                            <option value="">— Toujours affiché —</option>
                            {schema.fields
                              .filter((f) => f.id !== field.id && f.type !== "section")
                              .map((f) => (
                                <option key={f.id} value={f.id}>
                                  {f.label} ({f.id})
                                </option>
                              ))}
                          </select>
                        </label>

                        {field.visibleIf && (
                          <>
                            <label>
                              Opérateur
                              <select
                                value={field.visibleIf.op}
                                onChange={(e) =>
                                  setCondition(index, {
                                    op: e.target.value as ConditionOp,
                                  })
                                }
                              >
                                {CONDITION_OPS.map((op) => (
                                  <option key={op} value={op}>
                                    {OP_LABELS[op]}
                                  </option>
                                ))}
                              </select>
                            </label>
                            {field.visibleIf.op !== "truthy" && (
                              <label>
                                Valeur
                                <input
                                  value={formatConditionValue(
                                    field.visibleIf.op,
                                    field.visibleIf.value,
                                  )}
                                  onChange={(e) =>
                                    setCondition(index, {
                                      value: parseConditionValue(
                                        field.visibleIf!.op,
                                        e.target.value,
                                      ),
                                    })
                                  }
                                />
                                {(field.visibleIf.op === "in" ||
                                  field.visibleIf.op === "not_in") && (
                                  <span className="muted small">
                                    Valeurs séparées par des virgules
                                  </span>
                                )}
                              </label>
                            )}
                          </>
                        )}
                      </div>
                    </details>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
