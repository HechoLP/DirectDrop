export type AppVisualState =
  | "select"
  | "ready"
  | "connect"
  | "live"
  | "transfer"
  | "complete"
  | "error"
  | "about";

type TransferState =
  "CONNECTING" | "TRANSFERRING" | "SENT" | "COMPLETED" | "FAILED";

export function resolveVisualState({
  tab,
  fileCount,
  hasShare,
  online,
  transferStates,
  hasError,
}: {
  tab: "share" | "about";
  fileCount: number;
  hasShare: boolean;
  online: boolean;
  transferStates: TransferState[];
  hasError: boolean;
}): AppVisualState {
  if (tab === "about") return "about";
  if (hasError) return "error";
  if (!hasShare) return fileCount > 0 ? "ready" : "select";
  if (transferStates.includes("FAILED")) return "error";
  if (transferStates.includes("TRANSFERRING")) return "transfer";
  if (transferStates.includes("CONNECTING")) return "connect";
  if (transferStates.includes("COMPLETED") || transferStates.includes("SENT"))
    return "complete";
  return online ? "live" : "connect";
}

export const visualStateCopy: Record<
  AppVisualState,
  { label: string; description: string; step: number }
> = {
  select: {
    label: "SELECT",
    description: "보낼 파일을 선택하세요",
    step: 0,
  },
  ready: {
    label: "READY",
    description: "공유 옵션을 확인하세요",
    step: 1,
  },
  connect: {
    label: "CONNECT",
    description: "직접 연결을 준비하고 있어요",
    step: 2,
  },
  live: {
    label: "LIVE",
    description: "상대방의 접속을 기다리고 있어요",
    step: 2,
  },
  transfer: {
    label: "TRANSFER",
    description: "파일을 기기로 직접 보내고 있어요",
    step: 3,
  },
  complete: {
    label: "COMPLETE",
    description: "상대방 기기에 저장됐어요",
    step: 3,
  },
  error: {
    label: "CHECK",
    description: "아래 안내를 확인해 주세요",
    step: 1,
  },
  about: {
    label: "DIRECT",
    description: "파일은 클라우드를 거치지 않아요",
    step: 0,
  },
};
