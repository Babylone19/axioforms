import { config } from "../src/config.js";
import { db, sqlClient } from "../src/db/index.js";
import { apiKeys } from "../src/db/schema.js";
import { generateApiKey } from "../src/lib/apiKeys.js";

const name = process.argv[2] ?? "clé locale";

async function main(): Promise<void> {
  const { key, prefix, hash } = generateApiKey(config.API_KEY_PEPPER);
  await db.insert(apiKeys).values({
    name,
    keyPrefix: prefix,
    keyHash: hash,
  });
  console.log(`Clé API créée ("${name}") :`);
  console.log(key);
  await sqlClient.end();
}

await main();
