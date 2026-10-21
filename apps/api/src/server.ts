import { buildApp } from "./app.js";
import { config } from "./config.js";
import { healthRoutes } from "./routes/health.js";

async function main(): Promise<void> {
  const app = await buildApp();
  await app.register(healthRoutes);
  try {
    await app.listen({ port: config.PORT, host: config.HOST });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
