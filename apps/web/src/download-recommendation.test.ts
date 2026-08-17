import { describe, expect, it } from "vitest";
import { chooseDownloadRecommendation } from "./download-recommendation";

describe("chooseDownloadRecommendation", () => {
  it("recommends the Windows installer for Windows browsers", () => {
    expect(chooseDownloadRecommendation({ platform: "Windows" })).toEqual({
      key: "windows-x64",
      exact: true,
    });
  });

  it("distinguishes Apple Silicon from Intel when architecture is exposed", () => {
    expect(
      chooseDownloadRecommendation({
        platform: "macOS",
        architecture: "arm",
      }),
    ).toEqual({ key: "mac-arm64", exact: true });
    expect(
      chooseDownloadRecommendation({
        platform: "macOS",
        architecture: "x86",
      }),
    ).toEqual({ key: "mac-intel", exact: true });
  });

  it("uses Apple Silicon as a transparent fallback when a Mac hides its CPU", () => {
    expect(chooseDownloadRecommendation({ platform: "MacIntel" })).toEqual({
      key: "mac-arm64",
      exact: false,
    });
  });

  it("does not invent a download for unsupported platforms", () => {
    expect(
      chooseDownloadRecommendation({ platform: "Linux x86_64" }),
    ).toBeNull();
  });
});
