import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, type PublicFile } from "@directdrop/protocol";
import {
  IncomingTransferValidator,
  verifyActiveContentMatchesMetadata,
  verifyChunkIntegrity,
} from "./receiver-transfer";

const files: PublicFile[] = [
  {
    id: "public-file-1",
    name: "safe.bin",
    size: 4,
    mimeType: "application/octet-stream",
  },
  {
    id: "public-file-2",
    name: "empty.txt",
    size: 0,
    mimeType: "text/plain",
  },
];

function manifest() {
  return {
    type: "MANIFEST" as const,
    protocolVersion: PROTOCOL_VERSION as 1,
    files,
    totalSize: 4,
  };
}

function chunk(offset: number, size: number) {
  return {
    type: "CHUNK" as const,
    fileId: files[0]!.id,
    offset,
    size,
    sha256: "0".repeat(64),
  };
}

describe("incoming transfer validation", () => {
  it("detects a corrupted chunk before it reaches storage", async () => {
    const chunk = new TextEncoder().encode("DirectDrop");
    await expect(
      verifyChunkIntegrity(
        chunk,
        "5f3ab6695c4d46d3bf8e78cf360ba1bb852899bd2586f3f951e71e7ccf11a109",
      ),
    ).resolves.toBeUndefined();
    await expect(verifyChunkIntegrity(chunk, "0".repeat(64))).rejects.toThrow(
      "CHUNK_INTEGRITY_MISMATCH",
    );
  });

  it("blocks renamed executable bytes before writing the first chunk", () => {
    const pe = new Uint8Array(128);
    pe.set([0x4d, 0x5a]);
    new DataView(pe.buffer).setUint32(0x3c, 64, true);
    pe.set([0x50, 0x45, 0, 0], 64);
    expect(() =>
      verifyActiveContentMatchesMetadata(
        {
          id: "renamed-file",
          name: "invoice.pdf",
          size: pe.byteLength,
          mimeType: "application/pdf",
        },
        pe.buffer,
      ),
    ).toThrow("실행 가능한 형식");
    expect(() =>
      verifyActiveContentMatchesMetadata(
        {
          id: "declared-executable",
          name: "installer.exe",
          size: pe.byteLength,
          mimeType: "application/vnd.microsoft.portable-executable",
        },
        pe.buffer,
      ),
    ).not.toThrow();
  });

  it("accepts an exact ordered transfer including a zero-byte file", () => {
    const validator = new IncomingTransferValidator(files);
    validator.control(manifest());
    validator.control({
      type: "FILE_START",
      fileId: files[0]!.id,
      name: files[0]!.name,
      size: files[0]!.size,
      mimeType: files[0]!.mimeType,
    });
    validator.control(chunk(0, 3));
    expect(validator.chunk(3)).toMatchObject({
      transferredBytes: 3,
      fileId: files[0]!.id,
      fileBytes: 3,
    });
    validator.control(chunk(3, 1));
    expect(validator.chunk(1)).toMatchObject({ transferredBytes: 4 });
    validator.control({ type: "FILE_END", fileId: files[0]!.id });
    validator.control({
      type: "FILE_START",
      fileId: files[1]!.id,
      name: files[1]!.name,
      size: files[1]!.size,
      mimeType: files[1]!.mimeType,
    });
    validator.control({ type: "FILE_END", fileId: files[1]!.id });
    expect(() =>
      validator.control({ type: "TRANSFER_COMPLETE" }),
    ).not.toThrow();
  });

  it("rejects a path-manipulated or reordered file metadata frame", () => {
    const validator = new IncomingTransferValidator(files);
    validator.control(manifest());
    expect(() =>
      validator.control({
        type: "FILE_START",
        fileId: files[0]!.id,
        name: "../../secret.bin",
        size: files[0]!.size,
        mimeType: files[0]!.mimeType,
      }),
    ).toThrow("FILE_METADATA_MISMATCH");
  });

  it("rejects chunks that exceed the declared file size", () => {
    const validator = new IncomingTransferValidator(files);
    validator.control(manifest());
    validator.control({
      type: "FILE_START",
      fileId: files[0]!.id,
      name: files[0]!.name,
      size: files[0]!.size,
      mimeType: files[0]!.mimeType,
    });
    validator.control(chunk(0, 4));
    expect(() => validator.chunk(5)).toThrow("FILE_SIZE_EXCEEDED");
    expect(() => validator.chunk(0)).toThrow("FILE_SIZE_EXCEEDED");
  });

  it("rejects missing, duplicate, and incomplete protocol states", () => {
    expect(() =>
      new IncomingTransferValidator(files).control({
        type: "TRANSFER_COMPLETE",
      }),
    ).toThrow("MANIFEST_REQUIRED");

    const duplicate = new IncomingTransferValidator(files);
    duplicate.control(manifest());
    expect(() => duplicate.control(manifest())).toThrow("DUPLICATE_MANIFEST");

    const incomplete = new IncomingTransferValidator(files);
    incomplete.control(manifest());
    expect(() => incomplete.control({ type: "TRANSFER_COMPLETE" })).toThrow(
      "INCOMPLETE_TRANSFER",
    );
  });
});
