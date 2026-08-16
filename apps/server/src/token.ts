import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function secureToken(bytes = 12): string {
  return randomBytes(bytes).toString("base64url");
}

export function controlKey(): string {
  return secureToken(32);
}

export function hashControlKey(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function verifyControlKey(value: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashControlKey(value), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
