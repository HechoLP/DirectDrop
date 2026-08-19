import {
  MAX_CONTROL_MESSAGE_CHARS,
  MAX_FILE_CHUNK_BYTES,
  dataChannelControlSchema,
  type DataChannelControl,
  type PublicFile,
} from "@directdrop/protocol";
import {
  assessFileSecurity,
  detectActiveContentKind,
  ProgressMeter,
  sha256Hex,
  throttle,
  type ProgressSnapshot,
} from "@directdrop/shared";
import type { SavePlan } from "./save-plan";

function sameFile(left: PublicFile, right: PublicFile) {
  return (
    left.id === right.id &&
    left.name === right.name &&
    left.size === right.size &&
    left.mimeType === right.mimeType
  );
}

export async function verifyChunkIntegrity(
  chunk: BufferSource,
  expectedSha256: string,
) {
  if ((await sha256Hex(chunk)) !== expectedSha256)
    throw new Error("CHUNK_INTEGRITY_MISMATCH");
}

export function verifyActiveContentMatchesMetadata(
  file: PublicFile,
  firstChunk: ArrayBuffer,
) {
  const detected = detectActiveContentKind(new Uint8Array(firstChunk));
  if (detected && assessFileSecurity([file]).riskLevel !== "HIGH_RISK")
    throw new Error(
      "파일 내용이 표시된 확장자와 달리 실행 가능한 형식입니다. 저장을 중단했습니다. 보낸 사람에게 올바른 파일명으로 다시 공유해 달라고 요청하세요.",
    );
}

export class IncomingTransferValidator {
  private manifestSeen = false;
  private fileIndex = 0;
  private current: { file: PublicFile; receivedBytes: number } | undefined;
  private pendingChunk:
    | { fileId: string; offset: number; size: number; sha256: string }
    | undefined;
  private transferredBytes = 0;
  private terminal = false;

  constructor(private readonly expectedFiles: PublicFile[]) {}

  control(control: DataChannelControl) {
    if (this.terminal) throw new Error("TRANSFER_ALREADY_TERMINAL");

    if (control.type === "TRANSFER_ERROR") {
      this.terminal = true;
      throw new Error(control.message || "REMOTE_TRANSFER_ERROR");
    }

    if (this.pendingChunk) throw new Error("BINARY_CHUNK_REQUIRED");

    if (control.type === "MANIFEST") {
      if (this.manifestSeen || this.current || this.fileIndex !== 0)
        throw new Error("DUPLICATE_MANIFEST");
      const expectedTotal = this.expectedFiles.reduce(
        (sum, file) => sum + file.size,
        0,
      );
      if (
        control.files.length !== this.expectedFiles.length ||
        control.totalSize !== expectedTotal ||
        control.files.some(
          (file, index) => !sameFile(file, this.expectedFiles[index]!),
        )
      )
        throw new Error("MANIFEST_MISMATCH");
      this.manifestSeen = true;
      return;
    }

    if (!this.manifestSeen) throw new Error("MANIFEST_REQUIRED");

    if (control.type === "FILE_START") {
      if (this.current) throw new Error("FILE_ALREADY_OPEN");
      const expected = this.expectedFiles[this.fileIndex];
      if (
        !expected ||
        control.fileId !== expected.id ||
        control.name !== expected.name ||
        control.size !== expected.size ||
        control.mimeType !== expected.mimeType
      )
        throw new Error("FILE_METADATA_MISMATCH");
      this.current = { file: expected, receivedBytes: 0 };
      return;
    }

    if (control.type === "CHUNK") {
      if (
        !this.current ||
        control.fileId !== this.current.file.id ||
        control.offset !== this.current.receivedBytes ||
        control.size > this.current.file.size - this.current.receivedBytes
      )
        throw new Error("CHUNK_METADATA_MISMATCH");
      this.pendingChunk = control;
      return;
    }

    if (control.type === "FILE_END") {
      if (!this.current || control.fileId !== this.current.file.id)
        throw new Error("UNEXPECTED_FILE_END");
      if (this.current.receivedBytes !== this.current.file.size)
        throw new Error("FILE_SIZE_MISMATCH");
      this.current = undefined;
      this.fileIndex += 1;
      return;
    }

    if (control.type === "TRANSFER_COMPLETE") {
      const expectedTotal = this.expectedFiles.reduce(
        (sum, file) => sum + file.size,
        0,
      );
      if (
        this.current ||
        this.fileIndex !== this.expectedFiles.length ||
        this.transferredBytes !== expectedTotal
      )
        throw new Error("INCOMPLETE_TRANSFER");
      this.terminal = true;
    }
  }

  chunk(byteLength: number) {
    if (this.terminal) throw new Error("TRANSFER_ALREADY_TERMINAL");
    if (!this.manifestSeen || !this.current || !this.pendingChunk)
      throw new Error("UNEXPECTED_BINARY_CHUNK");
    if (
      !Number.isSafeInteger(byteLength) ||
      byteLength <= 0 ||
      byteLength > MAX_FILE_CHUNK_BYTES ||
      byteLength !== this.pendingChunk.size ||
      this.current.receivedBytes + byteLength > this.current.file.size
    )
      throw new Error("FILE_SIZE_EXCEEDED");
    const expectedSha256 = this.pendingChunk.sha256;
    this.pendingChunk = undefined;
    this.current.receivedBytes += byteLength;
    this.transferredBytes += byteLength;
    return {
      transferredBytes: this.transferredBytes,
      fileId: this.current.file.id,
      fileBytes: this.current.receivedBytes,
      expectedSha256,
    };
  }

  fail() {
    this.terminal = true;
  }
}

export function attachReceiverChannel(options: {
  channel: RTCDataChannel;
  files: PublicFile[];
  savePlan: SavePlan;
  onProgress: (snapshot: ProgressSnapshot) => void;
  onComplete: () => void;
  onError: (error: Error) => void;
}) {
  const { channel, files, savePlan } = options;
  const total = files.reduce((sum, file) => sum + file.size, 0);
  const meter = new ProgressMeter();
  const publish = throttle(options.onProgress, 200);
  const validator = new IncomingTransferValidator(files);
  const filesById = new Map(files.map((file) => [file.id, file]));
  let chain = Promise.resolve();
  let settled = false;

  const abort = async (error: unknown) => {
    if (settled) return;
    settled = true;
    validator.fail();
    channel.onmessage = null;
    channel.close();
    await savePlan.abort(error);
    options.onError(error instanceof Error ? error : new Error(String(error)));
  };

  channel.binaryType = "arraybuffer";
  channel.onerror = () => void abort(new Error("DATA_CHANNEL_ERROR"));
  channel.onclose = () => {
    if (!settled) void abort(new Error("DATA_CHANNEL_CLOSED_EARLY"));
  };
  channel.onmessage = (event) => {
    if (settled) return;
    chain = chain
      .then(async () => {
        if (typeof event.data === "string") {
          if (event.data.length > MAX_CONTROL_MESSAGE_CHARS)
            throw new Error("CONTROL_MESSAGE_TOO_LARGE");
          const control = dataChannelControlSchema.parse(
            JSON.parse(event.data),
          );
          validator.control(control);
          if (control.type === "FILE_START") await savePlan.startFile(control);
          else if (control.type === "FILE_END") await savePlan.endFile();
          else if (control.type === "TRANSFER_COMPLETE") {
            await savePlan.complete();
            settled = true;
            channel.onmessage = null;
            channel.close();
            options.onComplete();
          }
          return;
        }
        const chunk =
          event.data instanceof ArrayBuffer
            ? event.data
            : await (event.data as Blob).arrayBuffer();
        const received = validator.chunk(chunk.byteLength);
        await verifyChunkIntegrity(chunk, received.expectedSha256);
        if (received.fileBytes === chunk.byteLength) {
          const file = filesById.get(received.fileId);
          if (!file) throw new Error("UNKNOWN_TRANSFER_FILE");
          verifyActiveContentMatchesMetadata(file, chunk);
        }
        await savePlan.write(chunk);
        channel.send(
          JSON.stringify({
            type: "CHUNK_ACK",
            transferredBytes: received.transferredBytes,
          }),
        );
        publish(meter.sample(received.transferredBytes, total));
      })
      .catch(abort);
  };
}
