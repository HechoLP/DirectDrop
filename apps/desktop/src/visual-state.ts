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
    label: "파일을 바로 보내세요",
    description:
      "업로드를 기다릴 필요 없이 상대방 기기로 직접 전달할 수 있어요.",
    step: 0,
  },
  ready: {
    label: "공유 준비를 마쳐볼까요?",
    description: "다운로드 횟수와 만료 시간을 확인하면 준비가 끝나요.",
    step: 1,
  },
  connect: {
    label: "공유 링크를 준비하고 있어요",
    description: "안전한 직접 연결을 만드는 중입니다. 잠시만 기다려 주세요.",
    step: 2,
  },
  live: {
    label: "받을 사람을 기다리고 있어요",
    description: "링크나 QR 코드를 보내면 바로 다운로드할 수 있어요.",
    step: 2,
  },
  transfer: {
    label: "파일을 보내고 있어요",
    description: "브라우저를 닫지 않도록 상대방에게 안내해 주세요.",
    step: 3,
  },
  complete: {
    label: "파일 전달을 완료했어요",
    description: "상대방 기기에 파일이 안전하게 저장되었습니다.",
    step: 3,
  },
  error: {
    label: "확인이 필요해요",
    description: "아래 안내를 확인한 뒤 다시 시도해 주세요.",
    step: 1,
  },
  about: {
    label: "DirectDrop 정보",
    description: "클라우드 저장 없이 파일을 직접 전달합니다.",
    step: 0,
  },
};
