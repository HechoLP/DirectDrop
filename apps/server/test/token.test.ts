import { describe, expect, it } from "vitest";
import { secureToken } from "../src/token.js";

describe("secure share tokens", () => {
  it("generates 100,000 URL-safe tokens without a collision", () => {
    const tokens = new Set<string>();
    for (let index = 0; index < 100_000; index += 1) {
      const token = secureToken(12);
      expect(token).toMatch(/^[A-Za-z0-9_-]{16}$/);
      tokens.add(token);
    }
    expect(tokens.size).toBe(100_000);
  });
});
