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
  return (
    name
      .replace(/[\\/\0]/g, "_")
      .replace(/^\.+$/, "file")
      .slice(0, 255) || "file"
  );
}

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
