import { useCallback, useEffect, useState } from "react";
import {
  createForm,
  deleteForm,
  listForms,
  type FormSummary,
} from "../lib/admin.js";
import { navigate } from "./AdminApp.js";

const DEFAULT_SCHEMA = {
  title: "Mon formulaire",
  description: "Décrivez l'objectif du formulaire",
  fields: [
    {
      id: "full_name",
      type: "text",
      label: "Nom complet",
      required: true,
      validation: { minLength: 2, maxLength: 120 },
    },
    { id: "email", type: "email", label: "Email", required: true },
    {
      id: "profile",
      type: "select",
      label: "Profil",
      required: true,
      options: [
        { value: "particulier", label: "Particulier" },
        { value: "entreprise", label: "Entreprise" },
      ],
    },
    {
      id: "company",
      type: "text",
      label: "Société",
      required: true,
      visibleIf: { field: "profile", op: "eq", value: "entreprise" },
    },
    { id: "message", type: "textarea", label: "Message", required: false },
  ],
};

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(iso));
}

export default function FormList({
  apiKey,
  onError,
}: {
  apiKey: string;
  onError: (error: unknown) => string | null;
}) {
  const [forms, setForms] = useState<FormSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [schemaText, setSchemaText] = useState(
    JSON.stringify(DEFAULT_SCHEMA, null, 2),
  );
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await listForms(apiKey);
      setForms(data.items);
      setMessage(null);
    } catch (error) {
      setMessage(onError(error));
    } finally {
      setLoading(false);
    }
  }, [apiKey, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setCreating(true);
    setMessage(null);
    try {
      const schema = JSON.parse(schemaText) as unknown;
      const form = await createForm(apiKey, {
        title: title.trim(),
        description: description.trim() || undefined,
        schema,
      });
      setShowCreate(false);
      setTitle("");
      setDescription("");
      navigate(`/forms/${form.id}`);
    } catch (error) {
      if (error instanceof SyntaxError) {
        setMessage(`JSON invalide : ${error.message}`);
      } else {
        setMessage(onError(error));
      }
    } finally {
      setCreating(false);
    }
  };

  const remove = async (form: FormSummary) => {
    if (
      !window.confirm(
        `Supprimer « ${form.title} » ainsi que toutes ses réponses ?`,
      )
    ) {
      return;
    }
    try {
      await deleteForm(apiKey, form.id);
      await load();
    } catch (error) {
      setMessage(onError(error));
    }
  };

  const copy = async (form: FormSummary) => {
    const url = `${window.location.origin}${form.publicUrl}`;
    try {
      await navigator.clipboard.writeText(url);
      setMessage(`Lien copié : ${url}`);
    } catch {
      setMessage(url);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Formulaires</h1>
          <p className="muted">Créez, publiez et suivez vos formulaires.</p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => setShowCreate((v) => !v)}
        >
          {showCreate ? "Annuler" : "Nouveau formulaire"}
        </button>
      </div>

      {message && (
        <p className="banner" role="status">
          {message}
        </p>
      )}

      {showCreate && (
        <section className="panel">
          <h2>Nouveau formulaire</h2>
          <div className="field">
            <label htmlFor="new-title">Titre</label>
            <input
              id="new-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Onboarding client"
            />
          </div>
          <div className="field">
            <label htmlFor="new-desc">Description</label>
            <input
              id="new-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="new-schema">Schéma JSON (brouillon)</label>
            <textarea
              id="new-schema"
              className="json-editor"
              rows={16}
              value={schemaText}
              onChange={(e) => setSchemaText(e.target.value)}
              spellCheck={false}
            />
          </div>
          <button
            className="btn btn-primary"
            disabled={!title.trim() || creating}
            onClick={() => void create()}
          >
            {creating ? "Création…" : "Créer"}
          </button>
        </section>
      )}

      {loading ? (
        <p className="muted">Chargement…</p>
      ) : forms.length === 0 ? (
        <div className="panel empty">
          <p>Aucun formulaire pour le moment.</p>
          <p className="muted">
            Créez-en un avec le bouton « Nouveau formulaire ».
          </p>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Formulaire</th>
              <th>Statut</th>
              <th>Modifié</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {forms.map((form) => (
              <tr key={form.id}>
                <td>
                  <button
                    className="link"
                    onClick={() => navigate(`/forms/${form.id}`)}
                  >
                    {form.title}
                  </button>
                  <div className="muted small">/f/{form.slug}</div>
                </td>
                <td>
                  <span
                    className={`badge ${form.status === "published" ? "badge-published" : "badge-draft"}`}
                  >
                    {form.status === "published" ? "Publié" : "Brouillon"}
                  </span>
                </td>
                <td className="small">{formatDate(form.updatedAt)}</td>
                <td>
                  <div className="row-actions">
                    <button
                      className="btn btn-ghost"
                      onClick={() => navigate(`/forms/${form.id}`)}
                    >
                      Éditer
                    </button>
                    <button
                      className="btn btn-ghost"
                      onClick={() => navigate(`/forms/${form.id}/responses`)}
                    >
                      Réponses
                    </button>
                    {form.status === "published" && (
                      <>
                        <button
                          className="btn btn-ghost"
                          onClick={() => void copy(form)}
                        >
                          Copier le lien
                        </button>
                        <a
                          className="btn btn-ghost"
                          href={form.publicUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Ouvrir
                        </a>
                      </>
                    )}
                    <button
                      className="btn btn-danger"
                      onClick={() => void remove(form)}
                    >
                      Supprimer
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
