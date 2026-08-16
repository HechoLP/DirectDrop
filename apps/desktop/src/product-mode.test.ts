import { describe, expect, it } from "vitest";
import { productModes } from "./product-mode";

describe("product modes", () => {
  it("keeps internet Share Link and offline LAN Share separate", () => {
    expect(productModes.directdrop.requiresInternet).toBe(true);
    expect(productModes["lan-share"].requiresInternet).toBe(false);
    expect(productModes.directdrop.id).not.toBe(productModes["lan-share"].id);
  });
});
