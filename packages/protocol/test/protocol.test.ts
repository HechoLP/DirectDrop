import { describe, expect, it } from "vitest";
import {
  createShareSchema,
  parseClientMessage,
  publicFileSchema,
} from "../src/index.js";

describe("protocol validation", () => {
  it("accepts a public filename without a local path", () => {
    expect(
      publicFileSchema.parse({
        id: "public-file-1",
        name: "최종본.zip",
        size: 42,
        mimeType: "application/zip",
      }),
    ).toEqual(expect.objectContaining({ name: "최종본.zip" }));
  });

  it("rejects local path-shaped extra data", () => {
    const parsed = publicFileSchema.parse({
      id: "public-file-1",
      name: "safe.txt",
      size: 1,
      mimeType: "text/plain",
      localPath: "/Users/me/safe.txt",
    });
    expect(parsed).not.toHaveProperty("localPath");
  });

  it("enforces custom download limits", () => {
    const input = {
      files: [
        { id: "public-file-1", name: "a", size: 1, mimeType: "text/plain" },
      ],
      expiresAt: null,
      appLifetime: false,
      approvalMode: "AUTO",
      allowRelay: false,
    };
    expect(
      createShareSchema.safeParse({ ...input, downloadLimit: 1000 }).success,
    ).toBe(true);
    expect(
      createShareSchema.safeParse({ ...input, downloadLimit: 1001 }).success,
    ).toBe(false);
  });

  it("parses signaling messages", () => {
    expect(
      parseClientMessage({ type: "JOIN_SHARE", shareToken: "token" }).type,
    ).toBe("JOIN_SHARE");
  });
});
