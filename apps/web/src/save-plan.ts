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

export type SaveCapability = {
  hasStreaming: boolean;
  canDownload: boolean;
  saveMode:
    "browser-download" | "file-picker" | "directory-picker" | "unsupported";
  note: string | null;
  warning: string | null;
};

export function detectSaveCapability(files: PublicFile[]): SaveCapability {
  const total = files.reduce((sum, file) => sum + file.size, 0);
  const canUseBrowserDownload = total <= MAX_BROWSER_BUFFER_FALLBACK_BYTES;
  const hasStreaming =
    files.length === 1
      ? Boolean(window.showSaveFilePicker)
      : Boolean(window.showDirectoryPicker);
  const saveMode = canUseBrowserDownload
    ? "browser-download"
    : files.length === 1 && window.showSaveFilePicker
      ? "file-picker"
      : files.length > 1 && window.showDirectoryPicker
        ? "directory-picker"
        : "unsupported";
  return {
    hasStreaming,
    canDownload: saveMode !== "unsupported",
    saveMode,
    note:
      saveMode === "browser-download"
        ? files.length > 1
          ? "전송이 끝나면 각 파일을 브라우저의 기본 다운로드 폴더에 저장합니다. 폴더를 직접 선택할 필요가 없습니다."
          : "전송이 끝나면 브라우저의 기본 다운로드 위치에 저장합니다."
        : saveMode === "directory-picker"
          ? "대용량 파일을 바로 기록하려면 새 폴더나 전용 하위 폴더를 선택해 주세요."
          : saveMode === "file-picker"
            ? "대용량 파일을 바로 기록할 저장 위치를 선택합니다."
            : null,
    warning:
      saveMode === "unsupported"
        ? "이 브라우저는 대용량 파일의 디스크 스트리밍 저장을 지원하지 않습니다. 최신 Chrome 또는 Edge를 사용해 주세요."
        : null,
  };
}

export async function prepareSavePlan(files: PublicFile[]): Promise<SavePlan> {
  const total = files.reduce((sum, file) => sum + file.size, 0);

  // 일반적인 크기의 공유는 브라우저의 기본 다운로드 흐름을 사용한다.
  // macOS/Chrome이 보호 폴더 선택을 거부하는 문제를 피하고, 사용자가
  // 다운로드 전에 별도 폴더 권한을 부여하지 않아도 되게 한다.
  if (total <= MAX_BROWSER_BUFFER_FALLBACK_BYTES)
    return createBrowserDownloadPlan(files);

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
    const reservedNames = new Set<string>();
    return {
      mode: "stream",
      async startFile(control) {
        const handle = await createNonOverwritingFileHandle(
          directory,
          control.name,
          reservedNames,
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

  throw new Error("STREAMING_SAVE_UNSUPPORTED");
}

export async function createNonOverwritingFileHandle(
  directory: FileSystemDirectoryHandle,
  requestedName: string,
  reservedNames = new Set<string>(),
): Promise<FileSystemFileHandle> {
  const safeName = sanitizeDisplayName(requestedName);
  const extensionIndex = safeName.lastIndexOf(".");
  const hasExtension = extensionIndex > 0;
  const stem = hasExtension ? safeName.slice(0, extensionIndex) : safeName;
  const extension = hasExtension ? safeName.slice(extensionIndex) : "";

  for (let suffix = 0; suffix <= 10_000; suffix += 1) {
    const candidate =
      suffix === 0 ? safeName : `${stem} (${suffix})${extension}`;
    if (reservedNames.has(candidate)) continue;
    try {
      await directory.getFileHandle(candidate);
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") {
        const handle = await directory.getFileHandle(candidate, {
          create: true,
        });
        reservedNames.add(candidate);
        return handle;
      }
      throw error;
    }
  }
  throw new Error("SAFE_FILENAME_EXHAUSTED");
}

function createBrowserDownloadPlan(files: PublicFile[]): SavePlan {
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

export function savePreparationErrorMessage(error: unknown) {
  if (error instanceof Error && error.message === "STREAMING_SAVE_UNSUPPORTED")
    return "이 브라우저는 이 크기의 파일을 안전하게 저장할 수 없습니다. 최신 Chrome 또는 Edge를 사용해 주세요.";
  if (
    error instanceof DOMException &&
    (error.name === "SecurityError" || error.name === "NotAllowedError")
  )
    return "선택한 위치는 브라우저가 보호하는 폴더입니다. 새 빈 폴더나 전용 하위 폴더를 만든 뒤 다시 선택해 주세요.";
  return "저장 위치를 준비하지 못했습니다. 다시 시도해 주세요.";
}
