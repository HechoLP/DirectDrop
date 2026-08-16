import { describe, expect, it } from "vitest";
import { defaultSettings, expirationIso } from "./settings";

describe("share settings", () => {
  it("defines one-time sharing as downloadLimit = 1", () =>
    expect(defaultSettings.downloadLimit).toBe(1));
  it("computes expiration without polling", () =>
    expect(expirationIso({ ...defaultSettings, expiresInMs: 600_000 }, 0)).toBe(
      "1970-01-01T00:10:00.000Z",
    ));
});
