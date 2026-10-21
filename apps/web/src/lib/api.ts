export interface PublicFormResponse {
  id: string;
  slug: string;
  title: string;
  description?: string;
  versionNumber: number;
  schema: unknown;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, string>;
  };
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function fetchPublicForm(slug: string): Promise<PublicFormResponse> {
  const res = await fetch(`/api/public/f/${encodeURIComponent(slug)}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(
      res.status,
      body?.error.code ?? "NOT_FOUND",
      body?.error.message ?? "Formulaire introuvable",
    );
  }
  return res.json();
}

export async function submitPublicForm(
  slug: string,
  answers: Record<string, unknown>,
  files: Record<string, File>,
): Promise<{ responseId: string }> {
  const hasFile = Object.values(files).some((f) => f != null);
  let res: Response;

  if (hasFile) {
    const form = new FormData();
    form.append("answers", JSON.stringify(answers));
    for (const [fieldId, file] of Object.entries(files)) {
      if (file) form.append(`file_${fieldId}`, file, file.name);
    }
    res = await fetch(`/api/public/f/${encodeURIComponent(slug)}/responses`, {
      method: "POST",
      body: form,
    });
  } else {
    res = await fetch(`/api/public/f/${encodeURIComponent(slug)}/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answers }),
    });
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(
      res.status,
      body?.error.code ?? "ERROR",
      body?.error.message ?? "La soumission a échoué",
      body?.error.details,
    );
  }
  return res.json();
}
