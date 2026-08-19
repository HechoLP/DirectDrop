import { describe, expect, it } from "vitest";
import {
  assessFileSecurity,
  detectActiveContentKind,
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

  it("requires explicit approval for active content and opaque containers", () => {
    expect(
      assessFileSecurity([
        { name: "invoice.pdf.exe", mimeType: "application/octet-stream" },
      ]),
    ).toMatchObject({
      riskLevel: "HIGH_RISK",
      requiresExplicitApproval: true,
      reasons: expect.arrayContaining([
        "EXECUTABLE_OR_INSTALLER",
        "DECEPTIVE_DOUBLE_EXTENSION",
      ]),
    });
    expect(
      assessFileSecurity([
        { name: "documents.zip", mimeType: "application/zip" },
      ]),
    ).toMatchObject({
      riskLevel: "CAUTION",
      requiresExplicitApproval: true,
    });
    expect(
      assessFileSecurity([{ name: "notes.txt", mimeType: "text/plain" }]),
    ).toMatchObject({
      riskLevel: "LOWER_RISK",
      requiresExplicitApproval: false,
    });
    expect(
      assessFileSecurity([
        { name: "legacy.doc", mimeType: "application/msword" },
      ]),
    ).toMatchObject({
      riskLevel: "HIGH_RISK",
      requiresExplicitApproval: true,
      reasons: expect.arrayContaining(["MACRO_DOCUMENT"]),
    });
  });

  it("detects renamed executable and script content by header", () => {
    const pe = new Uint8Array(128);
    pe.set([0x4d, 0x5a]);
    new DataView(pe.buffer).setUint32(0x3c, 64, true);
    pe.set([0x50, 0x45, 0, 0], 64);
    expect(detectActiveContentKind(pe)).toBe("WINDOWS_EXECUTABLE");
    expect(detectActiveContentKind(Uint8Array.from([0x4d, 0x5a, 0, 0]))).toBe(
      null,
    );
    expect(
      detectActiveContentKind(Uint8Array.from([0x7f, 0x45, 0x4c, 0x46])),
    ).toBe("ELF_EXECUTABLE");
    expect(detectActiveContentKind(new TextEncoder().encode("#!/bin/sh"))).toBe(
      "SCRIPT_SHEBANG",
    );
    expect(
      detectActiveContentKind(new TextEncoder().encode("plain text")),
    ).toBe(null);
  });
});
