import { buildApp } from "./app.js";
import { registerRoutes } from "./routes/index.js";
import { config } from "./config.js";

async function main(): Promise<void> {
  const app = await buildApp();
  await registerRoutes(app);
  try {
    await app.listen({ port: config.PORT, host: config.HOST });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
