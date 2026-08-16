import {
  MAX_BROWSER_BUFFER_FALLBACK_BYTES,
  type DataChannelControl,
  type PublicFile,
} from "@directdrop/protocol";
import { sanitizeDisplayName } from "@directdrop/shared";

export type SavePlan = {
  mode: "stream" | "memory";
  startFile(
    control: Extract<DataChannelControl, { type: "FILE_START" }>,
  ): Promise<void>;
  write(chunk: ArrayBuffer): Promise<void>;
  endFile(): Promise<void>;
  complete(): Promise<void>;
  abort(reason: unknown): Promise<void>;
};

export function detectSaveCapability(files: PublicFile[]) {
  const total = files.reduce((sum, file) => sum + file.size, 0);
  const hasStreaming =
    files.length === 1
      ? Boolean(window.showSaveFilePicker)
      : Boolean(window.showDirectoryPicker);
  return {
    hasStreaming,
    canDownload: hasStreaming || total <= MAX_BROWSER_BUFFER_FALLBACK_BYTES,
    warning: hasStreaming
      ? null
      : total > MAX_BROWSER_BUFFER_FALLBACK_BYTES
        ? "이 브라우저는 대용량 파일의 디스크 스트리밍 저장을 지원하지 않습니다. 최신 Chrome 또는 Edge를 사용해 주세요."
        : "이 브라우저에서는 파일을 메모리에 임시 보관한 후 저장합니다. 큰 파일은 Chrome 또는 Edge를 권장합니다.",
  };
}

export async function prepareSavePlan(files: PublicFile[]): Promise<SavePlan> {
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (files.length === 1 && window.showSaveFilePicker) {
    const file = files[0]!;
    const handle = await window.showSaveFilePicker({
      suggestedName: sanitizeDisplayName(file.name),
    });
    let writable: FileSystemWritableFileStream | undefined;
    return {
      mode: "stream",
      async startFile() {
        writable = await handle.createWritable();
      },
      async write(chunk) {
        if (!writable) throw new Error("FILE_WRITER_NOT_READY");
        await writable.write(chunk);
      },
      async endFile() {
        await writable?.close();
        writable = undefined;
      },
      async complete() {},
      async abort(reason) {
        await writable?.abort(reason);
      },
    };
  }

  if (files.length > 1 && window.showDirectoryPicker) {
    const directory = await window.showDirectoryPicker({ mode: "readwrite" });
    let writable: FileSystemWritableFileStream | undefined;
    return {
      mode: "stream",
      async startFile(control) {
        const handle = await directory.getFileHandle(
          sanitizeDisplayName(control.name),
          { create: true },
        );
        writable = await handle.createWritable();
      },
      async write(chunk) {
        if (!writable) throw new Error("FILE_WRITER_NOT_READY");
        await writable.write(chunk);
      },
      async endFile() {
        await writable?.close();
        writable = undefined;
      },
      async complete() {},
      async abort(reason) {
        await writable?.abort(reason);
      },
    };
  }

  if (total > MAX_BROWSER_BUFFER_FALLBACK_BYTES)
    throw new Error("STREAMING_SAVE_UNSUPPORTED");
  const chunks = new Map<string, BlobPart[]>();
  const descriptors = new Map(files.map((file) => [file.id, file]));
  let currentFileId: string | undefined;
  return {
    mode: "memory",
    async startFile(control) {
      currentFileId = control.fileId;
      chunks.set(control.fileId, []);
    },
    async write(chunk) {
      if (!currentFileId) throw new Error("FILE_WRITER_NOT_READY");
      chunks.get(currentFileId)?.push(chunk);
    },
    async endFile() {
      currentFileId = undefined;
    },
    async complete() {
      for (const [fileId, parts] of chunks) {
        const file = descriptors.get(fileId);
        if (!file) continue;
        const url = URL.createObjectURL(
          new Blob(parts, { type: file.mimeType }),
        );
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = sanitizeDisplayName(file.name);
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
    },
    async abort() {
      chunks.clear();
      currentFileId = undefined;
    },
  };
}
