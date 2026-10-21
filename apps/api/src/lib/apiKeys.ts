import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";

const KEY_RE = /^axf_([a-z0-9]{8})_([a-z0-9]{32})$/;

export function generateApiKey(pepper: string): {
  key: string;
  prefix: string;
  hash: string;
} {
  const prefix = randomBytes(4).toString("hex");
  const secret = randomBytes(24).toString("hex").slice(0, 32);
  const key = `axf_${prefix}_${secret}`;
  return { key, prefix, hash: hashApiKey(key, pepper) };
}

export function hashApiKey(key: string, pepper: string): string {
  return createHmac("sha256", pepper).update(key).digest("hex");
}

export function parseApiKey(
  key: string,
): { prefix: string; secret: string } | null {
  const match = KEY_RE.exec(key);
  if (!match) return null;
  return { prefix: match[1]!, secret: match[2]! };
}

export function verifyApiKey(
  presented: string,
  storedHash: string,
  pepper: string,
): boolean {
  const computed = hashApiKey(presented, pepper);
  if (computed.length !== storedHash.length) return false;
  return timingSafeEqual(Buffer.from(computed), Buffer.from(storedHash));
}
