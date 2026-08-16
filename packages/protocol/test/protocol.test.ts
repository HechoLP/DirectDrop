import { describe, expect, it } from "vitest";
import {
  createShareSchema,
  dataChannelControlSchema,
  parseClientMessage,
  parseServerMessage,
  PROTOCOL_VERSION,
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
      parseClientMessage({
        type: "JOIN_SHARE",
        shareToken: "valid-token-1234",
      }).type,
    ).toBe("JOIN_SHARE");
  });

  it("rejects oversized or malformed signaling fields", () => {
    expect(() =>
      parseClientMessage({
        type: "DOWNLOAD_REJECT",
        sessionId: "session-12345678",
        peerId: "peer-12345678",
        reason: "x".repeat(501),
      }),
    ).toThrow();
    expect(() =>
      parseServerMessage({ type: "CONNECTED", peerId: "short" }),
    ).toThrow();
  });

  it("rejects unsafe data-channel metadata bounds", () => {
    expect(
      dataChannelControlSchema.safeParse({
        type: "FILE_START",
        fileId: "public-file-1",
        name: "x".repeat(256),
        size: 1,
        mimeType: "text/plain",
      }).success,
    ).toBe(false);
    expect(
      dataChannelControlSchema.safeParse({
        type: "MANIFEST",
        protocolVersion: PROTOCOL_VERSION,
        files: Array.from({ length: 101 }, (_, index) => ({
          id: `public-file-${index}`,
          name: `${index}.txt`,
          size: 1,
          mimeType: "text/plain",
        })),
        totalSize: 101,
      }).success,
    ).toBe(false);
    expect(
      dataChannelControlSchema.safeParse({
        type: "MANIFEST",
        protocolVersion: PROTOCOL_VERSION + 1,
        files: [
          {
            id: "public-file-1",
            name: "safe.txt",
            size: 1,
            mimeType: "text/plain",
          },
        ],
        totalSize: 1,
      }).success,
    ).toBe(false);
  });

  it("rejects aggregate file sizes outside the safe integer range", () => {
    expect(
      createShareSchema.safeParse({
        files: [
          {
            id: "public-file-1",
            name: "a.bin",
            size: Number.MAX_SAFE_INTEGER,
            mimeType: "application/octet-stream",
          },
          {
            id: "public-file-2",
            name: "b.bin",
            size: 1,
            mimeType: "application/octet-stream",
          },
        ],
        downloadLimit: 1,
        expiresAt: null,
        appLifetime: false,
        approvalMode: "AUTO",
        allowRelay: false,
      }).success,
    ).toBe(false);
  });
});
