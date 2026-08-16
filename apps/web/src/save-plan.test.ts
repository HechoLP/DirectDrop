import { describe, expect, it, vi } from "vitest";
import { detectSaveCapability } from "./save-plan";

describe("receiver save capability", () => {
  it("blocks unsafe large in-memory downloads", () => {
    vi.stubGlobal("window", {});
    const result = detectSaveCapability([
      {
        id: "file-large",
        name: "large.bin",
        size: 1024 ** 3,
        mimeType: "application/octet-stream",
      },
    ]);
    expect(result.canDownload).toBe(false);
    vi.unstubAllGlobals();
  });
});
