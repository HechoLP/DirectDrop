import { describe, expect, it } from "vitest";
import { resolveVisualState } from "./visual-state";

const base = {
  tab: "share" as const,
  fileCount: 0,
  hasShare: false,
  online: false,
  transferStates: [],
  hasError: false,
};

describe("desktop visual state", () => {
  it("moves from selection to ready when files are registered", () => {
    expect(resolveVisualState(base)).toBe("select");
    expect(resolveVisualState({ ...base, fileCount: 2 })).toBe("ready");
  });

  it("prioritizes active transfer feedback", () => {
    expect(
      resolveVisualState({
        ...base,
        hasShare: true,
        online: true,
        transferStates: ["TRANSFERRING"],
      }),
    ).toBe("transfer");
  });

  it("keeps failures and about mode explicit", () => {
    expect(resolveVisualState({ ...base, hasError: true })).toBe("error");
    expect(resolveVisualState({ ...base, tab: "about" })).toBe("about");
  });
});
