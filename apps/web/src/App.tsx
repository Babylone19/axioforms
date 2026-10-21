import AdminApp from "./admin/AdminApp.js";
import PublicForm from "./pages/PublicForm.js";

export default function App() {
  const path = window.location.pathname;
  const match = /^\/f\/([a-z0-9-]+)/i.exec(path);

  if (match) {
    return <PublicForm slug={match[1]} />;
  }

  return <AdminApp />;
}
