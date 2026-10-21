import type { FastifyInstance } from "fastify";
import { healthRoutes } from "./health.js";
import { keyRoutes } from "./keys.js";
import { formRoutes } from "./forms.js";
import { versionRoutes } from "./versions.js";
import { publicRoutes } from "./public.js";
import { attachmentRoutes } from "./attachments.js";
import { responseRoutes } from "./responses.js";
import { requireApiKey } from "../plugins/auth.js";

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(healthRoutes);
  await app.register(publicRoutes);
  await app.register(async (scoped) => {
    scoped.addHook("preHandler", requireApiKey);
    await scoped.register(keyRoutes);
    await scoped.register(formRoutes);
    await scoped.register(versionRoutes);
    await scoped.register(attachmentRoutes);
    await scoped.register(responseRoutes);
  });
}
