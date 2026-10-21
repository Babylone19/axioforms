import { useCallback, useEffect, useMemo, useState } from "react";
import {
  evaluateVisibility,
  parseFormSchema,
  validateAnswers,
  type FieldErrors,
  type FormSchema,
} from "@axioforms/shared";
import { ApiError, fetchPublicForm, submitPublicForm } from "../lib/api.js";

const FILE_PLACEHOLDER = "00000000-0000-4000-8000-000000000000";

type Status =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready" }
  | { phase: "submitting" }
  | { phase: "done" };

function fileFieldErrorMessage(
  required: boolean,
  label: string,
  hasFile: boolean,
): string | undefined {
  if (required && !hasFile) return `Le champ « ${label} » exige un fichier`;
  return undefined;
}

export default function PublicForm({ slug }: { slug: string }) {
  const [status, setStatus] = useState<Status>({ phase: "loading" });
  const [meta, setMeta] = useState<{
    title: string;
    description?: string;
    schema: FormSchema;
  } | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchPublicForm(slug)
      .then((form) => {
        if (cancelled) return;
        setMeta({
          title: form.title,
          description: form.description,
          schema: parseFormSchema(form.schema),
        });
        setStatus({ phase: "ready" });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setStatus({
          phase: "error",
          message:
            e instanceof ApiError
              ? e.message
              : "Impossible de charger le formulaire",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const schema = meta?.schema;
  const visible = useMemo(
    () => (schema ? evaluateVisibility(schema, answers) : new Set<string>()),
    [schema, answers],
  );

  const setValue = useCallback((fieldId: string, value: unknown) => {
    setAnswers((prev) => ({ ...prev, [fieldId]: value }));
  }, []);

  const computeErrors = useCallback(
    (
      ans: Record<string, unknown>,
      vis: Set<string>,
      fileMap: Record<string, File | null>,
    ): FieldErrors => {
      if (!schema) return {};
      const withPlaceholders = { ...ans };
      for (const field of schema.fields) {
        if (
          field.type === "file" &&
          vis.has(field.id) &&
          fileMap[field.id] != null
        ) {
          withPlaceholders[field.id] = FILE_PLACEHOLDER;
        }
      }
      const result = validateAnswers(schema, withPlaceholders, vis);
      const errs: FieldErrors = result.ok ? {} : { ...result.errors };
      for (const field of schema.fields) {
        if (field.type !== "file" || !vis.has(field.id)) continue;
        const msg = fileFieldErrorMessage(
          Boolean(field.required),
          field.label,
          fileMap[field.id] != null,
        );
        if (msg) errs[field.id] = msg;
      }
      return errs;
    },
    [schema],
  );

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!schema) return;
    setSubmitAttempted(true);
    const errs = computeErrors(answers, visible, files);
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      const firstId = Object.keys(errs)[0];
      document
        .querySelector<HTMLElement>(`[data-field="${firstId}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    setStatus({ phase: "submitting" });
    try {
      const withPlaceholders = { ...answers };
      for (const field of schema.fields) {
        if (field.type === "file" && files[field.id] != null) {
          withPlaceholders[field.id] = FILE_PLACEHOLDER;
        }
      }
      await submitPublicForm(slug, withPlaceholders, files as Record<string, File>);
      setStatus({ phase: "done" });
    } catch (e) {
      setStatus({ phase: "ready" });
      if (e instanceof ApiError && e.details) {
        setErrors(e.details);
        const firstId = Object.keys(e.details)[0];
        document
          .querySelector<HTMLElement>(`[data-field="${firstId}"]`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      } else if (e instanceof ApiError) {
        setErrors({ _form: e.message });
      } else {
        setErrors({ _form: "Erreur réseau : réessayez" });
      }
    }
  };

  if (status.phase === "loading") {
    return (
      <div className="public-shell">
        <div className="card muted">Chargement du formulaire…</div>
      </div>
    );
  }

  if (status.phase === "error") {
    return (
      <div className="public-shell">
        <div className="card error-card">
          <h1>Formulaire indisponible</h1>
          <p>{status.message}</p>
        </div>
      </div>
    );
  }

  if (status.phase === "done" || !schema) {
    return (
      <div className="public-shell">
        <div className="card success-card">
          <h1>Merci !</h1>
          <p>Votre réponse a bien été enregistrée.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="public-shell">
      <form className="card" onSubmit={onSubmit} noValidate>
        <header className="form-header">
          <h1>{meta?.title}</h1>
          {meta?.description && <p className="muted">{meta.description}</p>}
        </header>

        {errors._form && (
          <p className="field-error form-level" role="alert">
            {errors._form}
          </p>
        )}

        {schema.fields.map((field) => {
          if (!visible.has(field.id)) return null;

          if (field.type === "section") {
            return (
              <section key={field.id} className="form-section" data-field={field.id}>
                <h2>{field.label}</h2>
                {field.description && <p className="muted">{field.description}</p>}
              </section>
            );
          }

          const error = submitAttempted || errors[field.id] ? errors[field.id] : undefined;
          const describedBy = error ? `err-${field.id}` : undefined;

          return (
            <div key={field.id} className="field" data-field={field.id}>
              {field.type !== "checkbox" && field.type !== "radio" && (
                <label htmlFor={`f-${field.id}`}>
                  {field.label}
                  {field.required && <span aria-hidden="true"> *</span>}
                </label>
              )}
              {field.description && <p className="muted small">{field.description}</p>}

              {field.type === "text" || field.type === "email" || field.type === "date" ? (
                <input
                  id={`f-${field.id}`}
                  type={field.type === "text" ? "text" : field.type}
                  value={(answers[field.id] as string) ?? ""}
                  onChange={(e) => setValue(field.id, e.target.value)}
                  placeholder={field.placeholder}
                  required={field.required}
                  minLength={field.validation?.minLength}
                  maxLength={field.validation?.maxLength}
                  aria-invalid={Boolean(error)}
                  aria-describedby={describedBy}
                />
              ) : field.type === "textarea" ? (
                <textarea
                  id={`f-${field.id}`}
                  rows={4}
                  value={(answers[field.id] as string) ?? ""}
                  onChange={(e) => setValue(field.id, e.target.value)}
                  placeholder={field.placeholder}
                  maxLength={field.validation?.maxLength}
                  aria-invalid={Boolean(error)}
                  aria-describedby={describedBy}
                />
              ) : field.type === "number" ? (
                <input
                  id={`f-${field.id}`}
                  type="number"
                  value={(answers[field.id] as number | string) ?? ""}
                  onChange={(e) =>
                    setValue(
                      field.id,
                      e.target.value === "" ? "" : Number(e.target.value),
                    )
                  }
                  min={field.validation?.min}
                  max={field.validation?.max}
                  aria-invalid={Boolean(error)}
                  aria-describedby={describedBy}
                />
              ) : field.type === "select" ? (
                <select
                  id={`f-${field.id}`}
                  value={(answers[field.id] as string) ?? ""}
                  onChange={(e) => setValue(field.id, e.target.value)}
                  aria-invalid={Boolean(error)}
                  aria-describedby={describedBy}
                >
                  <option value="">— Choisir —</option>
                  {(field.options ?? []).map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              ) : field.type === "radio" ? (
                <div
                  role="radiogroup"
                  aria-label={field.label}
                  aria-invalid={Boolean(error)}
                  aria-describedby={describedBy}
                >
                  {(field.options ?? []).map((opt) => (
                    <label key={opt.value} className="choice">
                      <input
                        type="radio"
                        name={field.id}
                        value={opt.value}
                        checked={answers[field.id] === opt.value}
                        onChange={() => setValue(field.id, opt.value)}
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
              ) : field.type === "checkbox" ? (
                <div
                  role="group"
                  aria-label={field.label}
                  aria-invalid={Boolean(error)}
                  aria-describedby={describedBy}
                >
                  {(field.options ?? []).map((opt) => {
                    const list = (answers[field.id] as string[] | undefined) ?? [];
                    const checked = list.includes(opt.value);
                    return (
                      <label key={opt.value} className="choice">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setValue(
                              field.id,
                              checked
                                ? list.filter((v) => v !== opt.value)
                                : [...list, opt.value],
                            )
                          }
                        />
                        {opt.label}
                      </label>
                    );
                  })}
                </div>
              ) : field.type === "file" ? (
                <input
                  id={`f-${field.id}`}
                  type="file"
                  accept={field.validation?.acceptedMimeTypes?.join(",")}
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    setFiles((prev) => ({ ...prev, [field.id]: file }));
                  }}
                  aria-invalid={Boolean(error)}
                  aria-describedby={describedBy}
                />
              ) : null}

              {error && (
                <p className="field-error" id={`err-${field.id}`} role="alert">
                  {error}
                </p>
              )}
            </div>
          );
        })}

        <button type="submit" className="submit" disabled={status.phase === "submitting"}>
          {status.phase === "submitting" ? "Envoi en cours…" : "Envoyer"}
        </button>
      </form>
    </div>
  );
}
