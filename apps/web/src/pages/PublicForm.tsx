import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  evaluateVisibility,
  parseFormSchema,
  validateAnswers,
  type FieldErrors,
  type FormSchema,
} from "@axioforms/shared";
import FormFields from "../components/FormFields.js";
import { ApiError, fetchPublicForm, submitPublicForm } from "../lib/api.js";

const FILE_PLACEHOLDER = "00000000-0000-4000-8000-000000000000";

type Status =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready" }
  | { phase: "submitting" }
  | { phase: "done" };

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

  const setFile = useCallback((fieldId: string, file: File | null) => {
    setFiles((prev) => ({ ...prev, [fieldId]: file }));
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
        if (field.required && fileMap[field.id] == null) {
          errs[field.id] = `Le champ « ${field.label} » exige un fichier`;
        }
      }
      return errs;
    },
    [schema],
  );

  const onSubmit = async (event: FormEvent) => {
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
      await submitPublicForm(
        slug,
        withPlaceholders,
        files as Record<string, File>,
      );
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

        <FormFields
          schema={schema}
          visible={visible}
          answers={answers}
          setValue={setValue}
          setFile={setFile}
          errors={errors}
          showAllErrors={submitAttempted}
        />

        <button
          type="submit"
          className="submit"
          disabled={status.phase === "submitting"}
        >
          {status.phase === "submitting" ? "Envoi en cours…" : "Envoyer"}
        </button>
      </form>
    </div>
  );
}
