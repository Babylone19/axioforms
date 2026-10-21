import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormField } from "@axioforms/shared";
import {
  downloadAttachment,
  downloadCsv,
  getForm,
  listResponses,
  type FormDetail,
  type ResponsePage,
} from "../lib/admin.js";
import { navigate } from "./AdminApp.js";

const PAGE_SIZE = 20;

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(iso));
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.filename === "string") return record.filename;
    return JSON.stringify(value);
  }
  return String(value);
}

export default function ResponsesView({
  apiKey,
  formId,
  onError,
}: {
  apiKey: string;
  formId: string;
  onError: (error: unknown) => string | null;
}) {
  const [form, setForm] = useState<FormDetail | null>(null);
  const [page, setPage] = useState<ResponsePage | null>(null);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [detail, responses] = await Promise.all([
        getForm(apiKey, formId),
        listResponses(apiKey, formId, { limit: PAGE_SIZE, offset }),
      ]);
      setForm(detail);
      setPage(responses);
      setError(null);
    } catch (e) {
      const msg = onError(e);
      if (msg) setError(msg);
    } finally {
      setLoading(false);
    }
  }, [apiKey, formId, offset, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const fieldsById = useMemo(() => {
    const map = new Map<string, FormField>();
    const schema = form?.schema as { fields?: FormField[] } | null;
    for (const field of schema?.fields ?? []) {
      map.set(field.id, field);
    }
    return map;
  }, [form]);

  const labels = useMemo(() => {
    const map = new Map<string, string>();
    for (const [id, field] of fieldsById) map.set(id, field.label);
    return map;
  }, [fieldsById]);

  const renderFieldValue = (fieldId: string, value: unknown): string => {
    const options = fieldsById.get(fieldId)?.options ?? [];
    const labelOf = (raw: unknown) =>
      options.find((option) => option.value === raw)?.label ?? String(raw);
    if (Array.isArray(value)) {
      return value.length > 0 ? value.map(labelOf).join(", ") : "—";
    }
    if (typeof value === "string" && options.length > 0) return labelOf(value);
    return renderValue(value);
  };

  const columns = useMemo(() => {
    const keys: string[] = [];
    for (const item of page?.items ?? []) {
      for (const key of Object.keys(item.data)) {
        if (!keys.includes(key)) keys.push(key);
      }
    }
    return keys;
  }, [page]);

  const exportCsv = async () => {
    if (!form) return;
    try {
      await downloadCsv(apiKey, form);
    } catch (e) {
      const msg = onError(e);
      if (msg) setError(msg);
    }
  };

  const download = async (attachmentId: string) => {
    const item = page?.items
      .flatMap((r) => r.attachments)
      .find((a) => a.id === attachmentId);
    if (!item) return;
    try {
      await downloadAttachment(apiKey, item);
    } catch (e) {
      const msg = onError(e);
      if (msg) setError(msg);
    }
  };

  if (!form && loading) {
    return (
      <div className="page">
        <p className="muted">Chargement…</p>
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
          <h1>Réponses — {form?.title}</h1>
          <p className="muted small">
            {page ? `${page.pagination.total} réponse(s)` : ""}
          </p>
        </div>
        <div className="row-actions">
          <button
            className="btn btn-ghost"
            onClick={() => navigate(`/forms/${formId}`)}
          >
            Éditer le formulaire
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => void load()}
            disabled={loading}
          >
            Rafraîchir
          </button>
          <button
            className="btn"
            onClick={() => void exportCsv()}
            disabled={!page || page.pagination.total === 0}
          >
            Exporter CSV
          </button>
        </div>
      </div>

      {error && (
        <p className="banner banner-error" role="alert">
          {error}
        </p>
      )}

      {page && page.items.length === 0 ? (
        <div className="panel empty">
          <p>Aucune réponse pour le moment.</p>
          <p className="muted">
            Partagez le lien public du formulaire pour recevoir des réponses.
          </p>
        </div>
      ) : (
        <>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Version</th>
                  {columns.map((column) => (
                    <th key={column}>{labels.get(column) ?? column}</th>
                  ))}
                  <th>Pièces jointes</th>
                </tr>
              </thead>
              <tbody>
                {(page?.items ?? []).map((item) => (
                  <tr key={item.id}>
                    <td className="small">{formatDate(item.submittedAt)}</td>
                    <td className="small">v{item.versionNumber}</td>
                    {columns.map((column) => (
                      <td key={column}>
                        {renderFieldValue(column, item.data[column])}
                      </td>
                    ))}
                    <td>
                      {item.attachments.length === 0 ? (
                        <span className="muted">—</span>
                      ) : (
                        <div className="row-actions">
                          {item.attachments.map((attachment) => (
                            <button
                              key={attachment.id}
                              className="btn btn-ghost small"
                              onClick={() => void download(attachment.id)}
                              title={`${attachment.mimeType} · ${attachment.sizeBytes} octets`}
                            >
                              {attachment.filename}
                            </button>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {page && page.pagination.total > PAGE_SIZE && (
            <div className="pagination">
              <button
                className="btn btn-ghost"
                disabled={offset === 0 || loading}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                ← Précédent
              </button>
              <span className="muted small">
                {offset + 1}–{Math.min(offset + PAGE_SIZE, page.pagination.total)} sur{" "}
                {page.pagination.total}
              </span>
              <button
                className="btn btn-ghost"
                disabled={!page.pagination.hasMore || loading}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                Suivant →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
