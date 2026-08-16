import { describe, expect, it } from "vitest";
import { formatBytes, sanitizeDisplayName } from "../src/index.js";

describe("shared utilities", () => {
  it("formats large files without loading them", () =>
    expect(formatBytes(100 * 1024 ** 3)).toBe("100 GB"));
  it("removes path separators from display names", () =>
    expect(sanitizeDisplayName("../../Users/me/file.txt")).not.toContain("/"));
});
