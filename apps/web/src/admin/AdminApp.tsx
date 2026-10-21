import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { AdminApiError, readStoredKey, storeKey } from "../lib/admin.js";
import FormList from "./FormList.js";
import FormEditor from "./FormEditor.js";
import ResponsesView from "./ResponsesView.js";

export type AdminRoute =
  | { page: "list" }
  | { page: "editor"; formId: string }
  | { page: "responses"; formId: string };

function parseHash(hash: string): AdminRoute {
  const route = hash.replace(/^#/, "");
  const responses = /^\/forms\/([0-9a-f-]+)\/responses$/.exec(route);
  if (responses) return { page: "responses", formId: responses[1] };
  const editor = /^\/forms\/([0-9a-f-]+)$/.exec(route);
  if (editor) return { page: "editor", formId: editor[1] };
  return { page: "list" };
}

export function navigate(path: string): void {
  window.location.hash = path;
}

function KeyGate({ onSubmit }: { onSubmit: (key: string) => void }) {
  const [value, setValue] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (trimmed) onSubmit(trimmed);
  };

  return (
    <div className="public-shell">
      <form className="card" onSubmit={submit}>
        <h1>AxioForms — Administration</h1>
        <p className="muted">
          Collez une clé API pour accéder à la gestion des formulaires et des
          réponses.
        </p>
        <div className="field">
          <label htmlFor="api-key">Clé API</label>
          <input
            id="api-key"
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="axf_…"
            autoComplete="off"
          />
        </div>
        <button type="submit" className="submit" disabled={!value.trim()}>
          Se connecter
        </button>
        <p className="muted small" style={{ marginTop: "1rem" }}>
          Créer une clé :{" "}
          <code>npm run key:create -w apps/api -- "ma clé"</code>
        </p>
      </form>
    </div>
  );
}

export default function AdminApp() {
  const [key, setKey] = useState(readStoredKey());
  const [route, setRoute] = useState<AdminRoute>(() =>
    parseHash(window.location.hash),
  );
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const handleApiError = useCallback((error: unknown): string | null => {
    if (error instanceof AdminApiError) {
      if (error.status === 401) {
        setAuthError("Clé API invalide ou révoquée. Reconnectez-vous.");
        storeKey("");
        setKey("");
        return null;
      }
      return error.message;
    }
    return "Erreur réseau : vérifiez que l'API est démarrée.";
  }, []);

  if (!key) {
    return (
      <>
        <KeyGate
          onSubmit={(newKey) => {
            setAuthError(null);
            storeKey(newKey);
            setKey(newKey);
          }}
        />
        {authError && (
          <p className="admin-auth-error" role="alert">
            {authError}
          </p>
        )}
      </>
    );
  }

  return (
    <div className="admin-shell">
      <header className="topbar">
        <button
          className="brand"
          onClick={() => navigate("/")}
          title="Retour aux formulaires"
        >
          AxioForms <span>admin</span>
        </button>
        <nav className="topbar-nav">
          <a href="#/">Formulaires</a>
          <button
            className="btn-ghost"
            onClick={() => {
              storeKey("");
              setKey("");
              setAuthError(null);
              navigate("/");
            }}
          >
            Changer de clé
          </button>
        </nav>
      </header>
      <main className="admin-main">
        {route.page === "list" && (
          <FormList apiKey={key} onError={handleApiError} />
        )}
        {route.page === "editor" && (
          <FormEditor
            apiKey={key}
            formId={route.formId}
            onError={handleApiError}
          />
        )}
        {route.page === "responses" && (
          <ResponsesView
            apiKey={key}
            formId={route.formId}
            onError={handleApiError}
          />
        )}
      </main>
    </div>
  );
}
