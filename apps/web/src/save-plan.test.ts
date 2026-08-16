import { describe, expect, it, vi } from "vitest";
import {
  detectSaveCapability,
  prepareSavePlan,
  savePreparationErrorMessage,
} from "./save-plan";

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
    expect(result.saveMode).toBe("unsupported");
    vi.unstubAllGlobals();
  });

  it("uses the browser download folder for ordinary multi-file shares", () => {
    vi.stubGlobal("window", {
      showDirectoryPicker: vi.fn(),
    });
    const result = detectSaveCapability([
      {
        id: "first",
        name: "first.txt",
        size: 12,
        mimeType: "text/plain",
      },
      {
        id: "second",
        name: "second.txt",
        size: 24,
        mimeType: "text/plain",
      },
    ]);
    expect(result.saveMode).toBe("browser-download");
    expect(result.canDownload).toBe(true);
    expect(result.note).toContain("폴더를 직접 선택할 필요가 없습니다");
    vi.unstubAllGlobals();
  });

  it("does not open a directory picker for ordinary multi-file shares", async () => {
    const showDirectoryPicker = vi.fn();
    vi.stubGlobal("window", { showDirectoryPicker });
    const plan = await prepareSavePlan([
      {
        id: "first",
        name: "first.txt",
        size: 12,
        mimeType: "text/plain",
      },
      {
        id: "second",
        name: "second.txt",
        size: 24,
        mimeType: "text/plain",
      },
    ]);
    expect(plan.mode).toBe("memory");
    expect(showDirectoryPicker).not.toHaveBeenCalled();
    await plan.abort("test complete");
    vi.unstubAllGlobals();
  });

  it("explains how to recover when Chrome rejects a protected folder", () => {
    expect(
      savePreparationErrorMessage(
        new DOMException("blocked", "NotAllowedError"),
      ),
    ).toContain("전용 하위 폴더");
  });
});
