export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** index;
  return `${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: index === 0 ? 0 : 1 }).format(value)} ${units[index]}`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "계산 중";
  const rounded = Math.ceil(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainingSeconds = rounded % 60;
  if (hours > 0) return `${hours}시간 ${minutes}분`;
  if (minutes > 0) return `${minutes}분 ${remainingSeconds}초`;
  return `${remainingSeconds}초`;
}

export function sanitizeDisplayName(name: string): string {
  const cleaned = name
    .normalize("NFC")
    .replace(/\p{Cc}/gu, "_")
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/[\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 255);
  if (!cleaned || /^\.{1,2}$/.test(cleaned)) return "file";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(cleaned))
    return `_${cleaned}`;
  return cleaned;
}

export async function sha256Hex(data: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export type FileSecurityReason =
  | "EXECUTABLE_OR_INSTALLER"
  | "SCRIPT_OR_SHORTCUT"
  | "MACRO_DOCUMENT"
  | "ARCHIVE_OR_DISK_IMAGE"
  | "ACTIVE_WEB_CONTENT"
  | "DECEPTIVE_DOUBLE_EXTENSION"
  | "ACTIVE_MIME_MISMATCH"
  | "EXECUTABLE_CONTENT_MISMATCH";

export type FileSecurityAssessment = {
  verdict: "UNSCANNED";
  riskLevel: "LOWER_RISK" | "CAUTION" | "HIGH_RISK";
  requiresExplicitApproval: boolean;
  riskyFileCount: number;
  reasons: FileSecurityReason[];
};

export type SecurityFileDescriptor = {
  name: string;
  mimeType: string;
  relativePath?: string;
};

const executableExtensions = new Set([
  "app",
  "apk",
  "appimage",
  "bin",
  "com",
  "cpl",
  "deb",
  "dll",
  "dylib",
  "exe",
  "gadget",
  "jar",
  "msi",
  "msp",
  "pif",
  "pkg",
  "rpm",
  "scr",
  "sys",
]);
const scriptAndShortcutExtensions = new Set([
  "bat",
  "cmd",
  "command",
  "desktop",
  "fish",
  "hta",
  "inf",
  "ins",
  "isp",
  "job",
  "jse",
  "js",
  "lnk",
  "msh",
  "msh1",
  "msh2",
  "mst",
  "php",
  "pl",
  "ps1",
  "psd1",
  "psm1",
  "py",
  "rb",
  "reg",
  "scf",
  "sct",
  "sh",
  "url",
  "vb",
  "vbe",
  "vbs",
  "webloc",
  "workflow",
  "wsc",
  "wsf",
  "wsh",
  "xnk",
  "zsh",
]);
const macroDocumentExtensions = new Set([
  "chm",
  "doc",
  "docm",
  "dot",
  "dotm",
  "iqy",
  "one",
  "pot",
  "potm",
  "ppam",
  "pps",
  "ppsm",
  "ppt",
  "pptm",
  "rtf",
  "sldm",
  "slk",
  "xla",
  "xlam",
  "xll",
  "xls",
  "xlsb",
  "xlsm",
  "xlt",
  "xltm",
]);
const archiveExtensions = new Set([
  "7z",
  "bz2",
  "cab",
  "dmg",
  "gz",
  "img",
  "iso",
  "lz",
  "lzma",
  "rar",
  "tar",
  "tgz",
  "txz",
  "vhd",
  "vhdx",
  "xz",
  "zip",
]);
const activeWebExtensions = new Set([
  "htm",
  "html",
  "mht",
  "mhtml",
  "svg",
  "xhtml",
]);
const decoyExtensions = new Set([
  "csv",
  "doc",
  "docx",
  "gif",
  "jpeg",
  "jpg",
  "mp3",
  "mp4",
  "pdf",
  "png",
  "ppt",
  "pptx",
  "rtf",
  "txt",
  "xls",
  "xlsx",
]);

function extensionParts(value: string) {
  const filename = value.replaceAll("\\", "/").split("/").pop() ?? value;
  return filename
    .toLocaleLowerCase("en-US")
    .split(".")
    .slice(1)
    .filter(Boolean);
}

function addReason(
  reasons: Set<FileSecurityReason>,
  reason: FileSecurityReason,
) {
  reasons.add(reason);
}

export function assessFileSecurity(
  files: SecurityFileDescriptor[],
): FileSecurityAssessment {
  const reasons = new Set<FileSecurityReason>();
  let riskyFileCount = 0;
  let highest: FileSecurityAssessment["riskLevel"] = "LOWER_RISK";

  for (const file of files) {
    const fileReasons = new Set<FileSecurityReason>();
    const path = file.relativePath ?? file.name;
    const pathSegments = path.toLocaleLowerCase("en-US").split(/[\\/]/);
    const parts = extensionParts(path);
    const extension = parts.at(-1) ?? "";
    const mime = file.mimeType.toLocaleLowerCase("en-US");

    if (
      executableExtensions.has(extension) ||
      pathSegments.some((segment) => segment.endsWith(".app")) ||
      mime.includes("executable") ||
      mime.includes("x-msdownload") ||
      mime.includes("java-archive") ||
      mime.includes("msi")
    )
      addReason(fileReasons, "EXECUTABLE_OR_INSTALLER");
    if (
      scriptAndShortcutExtensions.has(extension) ||
      mime.includes("javascript") ||
      mime.includes("x-sh") ||
      mime.includes("powershell")
    )
      addReason(fileReasons, "SCRIPT_OR_SHORTCUT");
    if (macroDocumentExtensions.has(extension) || mime.includes("macroenabled"))
      addReason(fileReasons, "MACRO_DOCUMENT");
    if (
      archiveExtensions.has(extension) ||
      mime.includes("compressed") ||
      mime.includes("archive") ||
      mime.includes("x-7z") ||
      mime.includes("rar") ||
      mime.includes("zip")
    )
      addReason(fileReasons, "ARCHIVE_OR_DISK_IMAGE");
    if (
      activeWebExtensions.has(extension) ||
      mime === "text/html" ||
      mime === "image/svg+xml"
    )
      addReason(fileReasons, "ACTIVE_WEB_CONTENT");
    if (
      parts.length >= 2 &&
      decoyExtensions.has(parts.at(-2) ?? "") &&
      (executableExtensions.has(extension) ||
        scriptAndShortcutExtensions.has(extension))
    )
      addReason(fileReasons, "DECEPTIVE_DOUBLE_EXTENSION");
    if (
      decoyExtensions.has(extension) &&
      (mime.includes("executable") ||
        mime.includes("x-msdownload") ||
        mime.includes("javascript") ||
        mime.includes("powershell"))
    )
      addReason(fileReasons, "ACTIVE_MIME_MISMATCH");

    if (fileReasons.size > 0) riskyFileCount += 1;
    if (
      [...fileReasons].some((reason) =>
        [
          "EXECUTABLE_OR_INSTALLER",
          "SCRIPT_OR_SHORTCUT",
          "MACRO_DOCUMENT",
          "DECEPTIVE_DOUBLE_EXTENSION",
          "ACTIVE_MIME_MISMATCH",
        ].includes(reason),
      )
    )
      highest = "HIGH_RISK";
    else if (fileReasons.size > 0 && highest === "LOWER_RISK")
      highest = "CAUTION";
    fileReasons.forEach((reason) => reasons.add(reason));
  }

  return {
    verdict: "UNSCANNED",
    riskLevel: highest,
    requiresExplicitApproval: highest !== "LOWER_RISK",
    riskyFileCount,
    reasons: [...reasons],
  };
}

export function detectActiveContentKind(bytes: Uint8Array) {
  if (bytes.length >= 64 && bytes[0] === 0x4d && bytes[1] === 0x5a) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const peOffset = view.getUint32(0x3c, true);
    if (
      peOffset <= bytes.length - 4 &&
      bytes[peOffset] === 0x50 &&
      bytes[peOffset + 1] === 0x45 &&
      bytes[peOffset + 2] === 0 &&
      bytes[peOffset + 3] === 0
    )
      return "WINDOWS_EXECUTABLE" as const;
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x7f &&
    bytes[1] === 0x45 &&
    bytes[2] === 0x4c &&
    bytes[3] === 0x46
  )
    return "ELF_EXECUTABLE" as const;
  if (bytes.length >= 4) {
    const magic = Array.from(bytes.slice(0, 4), (value) =>
      value.toString(16).padStart(2, "0"),
    ).join("");
    if (
      [
        "cafebabe",
        "bebafeca",
        "feedface",
        "cefaedfe",
        "feedfacf",
        "cffaedfe",
      ].includes(magic)
    )
      return "MACHO_EXECUTABLE" as const;
  }
  if (bytes.length >= 2 && bytes[0] === 0x23 && bytes[1] === 0x21)
    return "SCRIPT_SHEBANG" as const;
  return null;
}

export const fileSecurityReasonLabels: Record<FileSecurityReason, string> = {
  EXECUTABLE_OR_INSTALLER: "실행파일 또는 설치 패키지가 포함되어 있습니다.",
  SCRIPT_OR_SHORTCUT: "실행 가능한 스크립트 또는 바로가기가 포함되어 있습니다.",
  MACRO_DOCUMENT: "매크로를 실행할 수 있는 문서가 포함되어 있습니다.",
  ARCHIVE_OR_DISK_IMAGE:
    "압축파일 또는 디스크 이미지의 내부 항목은 전송 전에 확인할 수 없습니다.",
  ACTIVE_WEB_CONTENT: "스크립트를 포함할 수 있는 웹 콘텐츠가 있습니다.",
  DECEPTIVE_DOUBLE_EXTENSION:
    "일반 문서처럼 보이게 만든 이중 확장자 파일이 있습니다.",
  ACTIVE_MIME_MISMATCH:
    "표시 확장자와 전달된 실행 형식 정보가 일치하지 않습니다.",
  EXECUTABLE_CONTENT_MISMATCH:
    "파일 내용이 표시된 확장자와 달리 실행 가능한 형식입니다.",
};

export type ProgressSnapshot = {
  transferredBytes: number;
  totalBytes: number;
  percent: number;
  currentBytesPerSecond: number;
  averageBytesPerSecond: number;
  etaSeconds: number;
};

export class ProgressMeter {
  readonly #startedAt = performance.now();
  #lastAt = this.#startedAt;
  #lastBytes = 0;

  sample(transferredBytes: number, totalBytes: number): ProgressSnapshot {
    const now = performance.now();
    const intervalSeconds = Math.max((now - this.#lastAt) / 1000, 0.001);
    const totalSeconds = Math.max((now - this.#startedAt) / 1000, 0.001);
    const currentBytesPerSecond =
      Math.max(0, transferredBytes - this.#lastBytes) / intervalSeconds;
    const averageBytesPerSecond = transferredBytes / totalSeconds;
    const remaining = Math.max(0, totalBytes - transferredBytes);
    this.#lastAt = now;
    this.#lastBytes = transferredBytes;
    return {
      transferredBytes,
      totalBytes,
      percent:
        totalBytes === 0
          ? 100
          : Math.min(100, (transferredBytes / totalBytes) * 100),
      currentBytesPerSecond,
      averageBytesPerSecond,
      etaSeconds:
        averageBytesPerSecond > 0
          ? remaining / averageBytesPerSecond
          : Number.POSITIVE_INFINITY,
    };
  }
}

export function throttle<T extends (...args: any[]) => void>(
  fn: T,
  waitMs: number,
): T {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Parameters<T> | undefined;
  return ((...args: Parameters<T>) => {
    const now = Date.now();
    pending = args;
    const run = () => {
      last = Date.now();
      timer = undefined;
      const values = pending;
      pending = undefined;
      if (values) fn(...values);
    };
    if (now - last >= waitMs) run();
    else if (!timer) timer = setTimeout(run, waitMs - (now - last));
  }) as T;
}
