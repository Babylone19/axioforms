import { useCallback, useEffect, useMemo, useState } from "react";
import {
  evaluateVisibility,
  parseFormSchema,
  type FormSchema,
} from "@axioforms/shared";
import {
  getForm,
  listVersions,
  publishForm,
  updateForm,
  type FormDetail,
  type VersionSummary,
} from "../lib/admin.js";
import FormFields from "../components/FormFields.js";
import VisualEditor from "./VisualEditor.js";
import { navigate } from "./AdminApp.js";

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(iso));
}

const EMPTY_SCHEMA: FormSchema = {
  schemaVersion: 1,
  title: "Nouveau formulaire",
  fields: [],
} as FormSchema;

export default function FormEditor({
  apiKey,
  formId,
  onError,
}: {
  apiKey: string;
  formId: string;
  onError: (error: unknown) => string | null;
}) {
  const [form, setForm] = useState<FormDetail | null>(null);
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [jsonText, setJsonText] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [previewAnswers, setPreviewAnswers] = useState<Record<string, unknown>>({});
  const [mode, setMode] = useState<"visual" | "json">("visual");
  const [visualSchema, setVisualSchema] = useState<FormSchema | null>(null);

  const reload = useCallback(async () => {
    try {
      const [detail, versionList] = await Promise.all([
        getForm(apiKey, formId),
        listVersions(apiKey, formId),
      ]);
      setForm(detail);
      setVersions(versionList.items);
      setTitle(detail.title);
      setDescription(detail.description ?? "");
      setWebhookUrl(detail.webhookUrl ?? "");
      let loadedSchema: FormSchema = EMPTY_SCHEMA;
      if (detail.schema) {
        try {
          loadedSchema = parseFormSchema(detail.schema);
        } catch {
          loadedSchema = EMPTY_SCHEMA;
        }
      }
      setVisualSchema(loadedSchema);
      setJsonText(JSON.stringify(loadedSchema, null, 2));
      setError(null);
    } catch (e) {
      const msg = onError(e);
      if (msg) setError(msg);
    }
  }, [apiKey, formId, onError]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const parsed = useMemo((): { schema: FormSchema } | { issues: string[] } => {
    try {
      const raw: unknown = JSON.parse(jsonText);
      return { schema: parseFormSchema(raw) };
    } catch (e) {
      if (e instanceof SyntaxError) return { issues: [`JSON invalide : ${e.message}`] };
      if (e && typeof e === "object" && "issues" in e) {
        const issues = (e as { issues: { path: (string | number)[]; message: string }[] })
          .issues;
        return {
          issues: issues.map(
            (issue) => `${issue.path.join(".") || "schéma"} : ${issue.message}`,
          ),
        };
      }
      return { issues: ["Schéma invalide"] };
    }
  }, [jsonText]);

  const previewSchema = "schema" in parsed ? parsed.schema : null;
  const previewVisible = useMemo(
    () => (previewSchema ? evaluateVisibility(previewSchema, previewAnswers) : new Set<string>()),
    [previewSchema, previewAnswers],
  );

  const save = useCallback(
    async (options: { publish?: boolean } = {}) => {
      if (!("schema" in parsed)) {
        setError("Corrigez les erreurs du schéma avant d'enregistrer.");
        return;
      }
      const setBusy = options.publish ? setPublishing : setSaving;
      setBusy(true);
      setMessage(null);
      setError(null);
      try {
        const schemaToSave: FormSchema = {
          ...parsed.schema,
          title: title.trim() || parsed.schema.title,
          ...(description.trim()
            ? { description: description.trim() }
            : {}),
        };
        await updateForm(apiKey, formId, {
          title: title.trim(),
          description: description.trim() || null,
          webhookUrl: webhookUrl.trim() || null,
          schema: schemaToSave,
        });
        if (options.publish) {
          const version = await publishForm(apiKey, formId);
          setMessage(`Version ${version.versionNumber} publiée.`);
        } else {
          setMessage("Brouillon enregistré.");
        }
        await reload();
      } catch (e) {
        const msg = onError(e);
        if (msg) setError(msg);
      } finally {
        setBusy(false);
      }
    },
    [apiKey, formId, parsed, title, description, webhookUrl, reload, onError],
  );

  const applyJsonText = (text: string) => {
    setJsonText(text);
    try {
      setVisualSchema(parseFormSchema(JSON.parse(text)));
    } catch {
      // on garde le dernier schéma valide pour l'éditeur visuel
    }
  };

  const applyVisualSchema = (next: FormSchema) => {
    setVisualSchema(next);
    setJsonText(JSON.stringify(next, null, 2));
  };

  const formatJson = () => {
    try {
      applyJsonText(JSON.stringify(JSON.parse(jsonText), null, 2));
    } catch {
      setError("JSON invalide : impossible de le formater.");
    }
  };

  const publicUrl = form ? `${window.location.origin}/f/${form.slug}` : "";

  if (!form) {
    return (
      <div className="page">
        {error ? (
          <p className="banner banner-error" role="alert">{error}</p>
        ) : (
          <p className="muted">Chargement…</p>
        )}
        <button className="btn btn-ghost" onClick={() => navigate("/")}>
          ← Retour
        </button>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <button className="link small" onClick={() => navigate("/")}>
            ← Tous les formulaires
          </button>
          <h1>{form.title}</h1>
          <p className="muted small">
            /f/{form.slug} · {versions.length} version(s) publiée(s)
          </p>
        </div>
        <div className="row-actions">
          <button
            className="btn btn-ghost"
            onClick={() => navigate(`/forms/${form.id}/responses`)}
          >
            Voir les réponses
          </button>
          {form.status === "published" && (
            <a
              className="btn btn-ghost"
              href={form.publicUrl}
              target="_blank"
              rel="noreferrer"
            >
              Ouvrir le formulaire
            </a>
          )}
          <button
            className="btn"
            disabled={saving || publishing}
            onClick={() => void save()}
          >
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
          <button
            className="btn btn-primary"
            disabled={saving || publishing}
            onClick={() => void save({ publish: true })}
          >
            {publishing ? "Publication…" : "Publier"}
          </button>
        </div>
      </div>

      {message && (
        <p className="banner banner-success" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="banner banner-error" role="alert">
          {error}
        </p>
      )}

      <div className="split">
        <section className="panel">
          <h2>Configuration</h2>
          <div className="field">
            <label htmlFor="edit-title">Titre</label>
            <input
              id="edit-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="edit-desc">Description</label>
            <input
              id="edit-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="edit-webhook">Webhook (POST à chaque réponse)</label>
            <input
              id="edit-webhook"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://example.com/hooks/axioforms"
            />
          </div>

          <div className="editor-head">
            <h2>Champs du formulaire</h2>
            <div className="tabbar" role="tablist" aria-label="Mode d'édition">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "visual"}
                className={`tab ${mode === "visual" ? "tab-active" : ""}`}
                onClick={() => setMode("visual")}
              >
                Visuel
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "json"}
                className={`tab ${mode === "json" ? "tab-active" : ""}`}
                onClick={() => setMode("json")}
              >
                JSON
              </button>
            </div>
          </div>

          {mode === "visual" ? (
            <VisualEditor
              schema={visualSchema ?? EMPTY_SCHEMA}
              onChange={applyVisualSchema}
            />
          ) : (
            <>
              <div className="editor-head">
                <span className="muted small">
                  Édition directe du schéma — les formats invalides bloquent
                  l'enregistrement.
                </span>
                <button className="btn btn-ghost small" onClick={formatJson}>
                  Formater
                </button>
              </div>
              <textarea
                className="json-editor"
                value={jsonText}
                onChange={(e) => applyJsonText(e.target.value)}
                spellCheck={false}
                aria-label="Schéma JSON du formulaire"
              />
            </>
          )}
          {"issues" in parsed && (
            <ul className="issues" role="alert">
              {parsed.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}

          <h2>Versions</h2>
          {versions.length === 0 ? (
            <p className="muted small">Aucune version publiée.</p>
          ) : (
            <ul className="version-list">
              {versions.map((version) => (
                <li key={version.id}>
                  <strong>v{version.versionNumber}</strong> ·{" "}
                  {version.fieldCount} champ(s) · {formatDate(version.createdAt)}
                </li>
              ))}
            </ul>
          )}
          {publicUrl && (
            <p className="muted small">
              Lien public : <code>{publicUrl}</code>
            </p>
          )}
        </section>

        <section className="panel preview-panel">
          <div className="editor-head">
            <h2>Aperçu interactif</h2>
            <button
              className="btn btn-ghost small"
              onClick={() => setPreviewAnswers({})}
            >
              Réinitialiser
            </button>
          </div>
          {previewSchema ? (
            <>
              <p className="muted small">
                Les conditions s'évaluent en direct. Aucune soumission.
              </p>
              <FormFields
                schema={previewSchema}
                visible={previewVisible}
                answers={previewAnswers}
                setValue={(fieldId, value) =>
                  setPreviewAnswers((prev) => ({ ...prev, [fieldId]: value }))
                }
                errors={{}}
              />
            </>
          ) : (
            <p className="muted">
              L'aperçu apparaîtra dès que le schéma JSON sera valide.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
