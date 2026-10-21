import type { FastifyBaseLogger } from "fastify";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { responses } from "../db/schema.js";

export const WEBHOOK_TIMEOUT_MS = 5000;

export interface WebhookPayload {
  event: "response.created";
  formId: string;
  formSlug: string;
  versionNumber: number;
  responseId: string;
  submittedAt: string;
  data: Record<string, unknown>;
}

async function recordStatus(
  responseId: string,
  status: string,
  log: FastifyBaseLogger,
): Promise<void> {
  try {
    await db
      .update(responses)
      .set({
        meta: sql`${responses.meta} || ${JSON.stringify({ webhookStatus: status })}::jsonb`,
      })
      .where(eq(responses.id, responseId));
  } catch (e) {
    log.error({ err: e, responseId }, "Impossible d'enregistrer le statut webhook");
  }
}

export async function dispatchWebhook(options: {
  url: string | null;
  payload: WebhookPayload;
  log: FastifyBaseLogger;
}): Promise<void> {
  const { url, payload, log } = options;
  if (!url) return;

  let status: string;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "AxioForms-Webhook/1.0",
        "x-axioforms-event": payload.event,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    status = res.ok ? "success" : `failed:http_${res.status}`;
    if (!res.ok) {
      log.warn({ url, status }, "Webhook en échec");
    }
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    status = aborted ? "failed:timeout" : "failed:network";
    log.warn({ err: e, url, status }, "Webhook injoignable");
  } finally {
    clearTimeout(timer);
  }

  await recordStatus(payload.responseId, status, log);
}
