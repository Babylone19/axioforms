import type { FastifyError, FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { SchemaValidationError } from "@axioforms/shared";

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | Error, request, reply) => {
    const err = error as FastifyError;
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: "VALIDATION_FAILED",
          message: "Données invalides",
          details: error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        },
      } satisfies ApiErrorBody);
    }
    if (error instanceof SchemaValidationError) {
      return reply.status(400).send({
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      } satisfies ApiErrorBody);
    }
    const statusCode = err.statusCode ?? 500;
    if (statusCode >= 500) {
      request.log.error(error);
      return reply.status(500).send({
        error: { code: "INTERNAL_ERROR", message: "Erreur interne du serveur" },
      } satisfies ApiErrorBody);
    }
    return reply.status(statusCode).send({
      error: {
        code: err.code ?? "BAD_REQUEST",
        message: error.message,
      },
    } satisfies ApiErrorBody);
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({
      error: { code: "NOT_FOUND", message: "Ressource introuvable" },
    } satisfies ApiErrorBody);
  });
}
