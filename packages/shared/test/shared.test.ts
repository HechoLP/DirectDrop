import { describe, expect, it } from "vitest";
import {
  formatBytes,
  sanitizeDisplayName,
  sha256Hex,
} from "../src/index.js";

describe("shared utilities", () => {
  it("formats large files without loading them", () =>
    expect(formatBytes(100 * 1024 ** 3)).toBe("100 GB"));
  it("removes path separators from display names", () =>
    expect(sanitizeDisplayName("../../Users/me/file.txt")).not.toContain("/"));

  it.each([
    ["..", "file"],
    ["CON", "_CON"],
    ["nul.txt", "_nul.txt"],
    ["report.pdf. ", "report.pdf"],
    ["safe\u202efile.exe", "safefile.exe"],
    ["bad<name>:?.txt", "bad_name___.txt"],
  ])("sanitizes hostile cross-platform filename %s", (input, expected) => {
    expect(sanitizeDisplayName(input)).toBe(expected);
  });

  it("computes a deterministic SHA-256 digest", async () => {
    expect(await sha256Hex(new TextEncoder().encode("DirectDrop"))).toBe(
      "5f3ab6695c4d46d3bf8e78cf360ba1bb852899bd2586f3f951e71e7ccf11a109",
    );
  });
});
