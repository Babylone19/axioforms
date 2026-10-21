import PublicForm from "./pages/PublicForm.js";

export default function App() {
  const path = window.location.pathname;
  const match = /^\/f\/([a-z0-9-]+)/i.exec(path);

  if (match) {
    return <PublicForm slug={match[1]} />;
  }

  return (
    <div className="public-shell">
      <div className="card">
        <h1>AxioForms</h1>
        <p className="muted">
          Espace d'administration — ouvrez un formulaire public via son lien
          <code> /f/&lt;slug&gt;</code>.
        </p>
      </div>
    </div>
  );
}
