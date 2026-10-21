import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileTypeFromBuffer } from "file-type";
import type { FormField } from "@axioforms/shared";
import { config } from "../config.js";

export interface IncomingFile {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}

export interface StoredFileInfo {
  id: string;
  filename: string;
  sizeBytes: number;
  mimeType: string;
  storedPath: string;
}

export function sanitizeFilename(name: string): string {
  const base = path
    .basename(name)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/[/\\:*?"<>|]/g, "_");
  return (base.trim() || "fichier").slice(0, 255);
}

export function filePolicyFor(field: FormField): {
  maxBytes: number;
  acceptedMimeTypes?: string[];
} {
  return {
    maxBytes: Math.min(
      field.validation?.maxSizeBytes ?? config.MAX_UPLOAD_SIZE_BYTES,
      config.MAX_UPLOAD_SIZE_BYTES,
    ),
    acceptedMimeTypes: field.validation?.acceptedMimeTypes,
  };
}

export class FileValidationError extends Error {
  constructor(
    public readonly fieldId: string,
    message: string,
  ) {
    super(message);
    this.name = "FileValidationError";
  }
}

/**
 * Contrôle un fichier : taille, type réel (sniffing des octets, jamais le
 * Content-Type client), politique du champ, puis stockage à nom aléatoire.
 */
export async function validateAndStoreFile(
  formId: string,
  field: FormField,
  file: IncomingFile,
): Promise<StoredFileInfo> {
  const policy = filePolicyFor(field);
  const safeName = sanitizeFilename(file.filename);

  if (file.buffer.byteLength > policy.maxBytes) {
    const mo = Math.round(policy.maxBytes / (1024 * 1024));
    throw new FileValidationError(
      field.id,
      `Le fichier « ${safeName} » dépasse la taille maximale de ${mo} Mo`,
    );
  }
  if (file.buffer.byteLength === 0) {
    throw new FileValidationError(field.id, `Le fichier « ${safeName} » est vide`);
  }

  const sniffed = await fileTypeFromBuffer(file.buffer);
  if (!sniffed) {
    throw new FileValidationError(
      field.id,
      `Type de fichier non reconnu pour « ${safeName} »`,
    );
  }
  if (
    policy.acceptedMimeTypes &&
    policy.acceptedMimeTypes.length > 0 &&
    !policy.acceptedMimeTypes.includes(sniffed.mime)
  ) {
    throw new FileValidationError(
      field.id,
      `Type « ${sniffed.mime} » non autorisé pour « ${field.label} » (accepté : ${policy.acceptedMimeTypes.join(", ")})`,
    );
  }

  const id = randomUUID();
  const ext = sniffed.ext ? `.${sniffed.ext}` : "";
  const relPath = path.join(formId, `${id}${ext}`);
  const absPath = path.join(config.UPLOAD_DIR, relPath);

  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, file.buffer);

  return {
    id,
    filename: safeName,
    sizeBytes: file.buffer.byteLength,
    mimeType: sniffed.mime,
    storedPath: relPath,
  };
}

export async function removeStoredFiles(
  files: Pick<StoredFileInfo, "storedPath">[],
): Promise<void> {
  await Promise.allSettled(
    files.map((f) =>
      fs.rm(path.join(config.UPLOAD_DIR, f.storedPath), { force: true }),
    ),
  );
}
