export interface FormSummary {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  status: "draft" | "published";
  webhookUrl: string | null;
  publicUrl: string;
  createdAt: string;
  updatedAt: string;
  hasDraftSchema: boolean;
}

export interface FormDetail extends FormSummary {
  schema: unknown;
}

export interface VersionSummary {
  id: string;
  formId: string;
  versionNumber: number;
  title: string;
  fieldCount: number;
  createdAt: string;
  publicUrl: string;
}

export interface AttachmentMeta {
  id: string;
  fieldId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  url?: string;
}

export interface ResponseItem {
  id: string;
  versionNumber: number;
  data: Record<string, unknown>;
  meta: Record<string, unknown>;
  submittedAt: string;
  attachments: AttachmentMeta[];
}

export interface ResponsePage {
  items: ResponseItem[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

export class AdminApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, string>,
  ) {
    super(message);
    this.name = "AdminApiError";
  }
}

export function readStoredKey(): string {
  return localStorage.getItem("axioforms.apiKey") ?? "";
}

export function storeKey(key: string): void {
  if (key) localStorage.setItem("axioforms.apiKey", key);
  else localStorage.removeItem("axioforms.apiKey");
}

async function request<T>(
  key: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {}),
      "x-api-key": key,
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as
      | { error?: { code?: string; message?: string; details?: Record<string, string> } }
      | null;
    throw new AdminApiError(
      res.status,
      body?.error?.code ?? "ERROR",
      body?.error?.message ?? `Erreur ${res.status}`,
      body?.error?.details,
    );
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function listForms(key: string) {
  return request<{ items: FormSummary[] }>(key, "/api/forms");
}

export function getForm(key: string, id: string) {
  return request<FormDetail>(key, `/api/forms/${id}`);
}

export function createForm(
  key: string,
  payload: { title: string; description?: string; schema?: unknown; webhookUrl?: string },
) {
  return request<FormDetail>(key, "/api/forms", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateForm(
  key: string,
  id: string,
  payload: {
    title?: string;
    description?: string | null;
    schema?: unknown;
    webhookUrl?: string | null;
  },
) {
  return request<FormDetail>(key, `/api/forms/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteForm(key: string, id: string) {
  return request<void>(key, `/api/forms/${id}`, { method: "DELETE" });
}

export function publishForm(key: string, id: string) {
  return request<VersionSummary>(key, `/api/forms/${id}/publish`, { method: "POST" });
}

export function listVersions(key: string, id: string) {
  return request<{ items: VersionSummary[] }>(key, `/api/forms/${id}/versions`);
}

export function listResponses(
  key: string,
  id: string,
  params: { limit?: number; offset?: number; version?: number } = {},
) {
  const search = new URLSearchParams();
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  if (params.offset !== undefined) search.set("offset", String(params.offset));
  if (params.version !== undefined) search.set("version", String(params.version));
  const qs = search.toString();
  return request<ResponsePage>(
    key,
    `/api/forms/${id}/responses${qs ? `?${qs}` : ""}`,
  );
}

async function downloadBlob(key: string, path: string, filename: string) {
  const res = await fetch(path, { headers: { "x-api-key": key } });
  if (!res.ok) {
    throw new AdminApiError(res.status, "DOWNLOAD_FAILED", "Téléchargement impossible");
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function downloadAttachment(key: string, attachment: AttachmentMeta) {
  return downloadBlob(
    key,
    `/api/attachments/${attachment.id}`,
    attachment.filename,
  );
}

export function downloadCsv(key: string, form: FormSummary) {
  return downloadBlob(
    key,
    `/api/forms/${form.id}/responses/export.csv`,
    `${form.slug}-responses.csv`,
  );
}
