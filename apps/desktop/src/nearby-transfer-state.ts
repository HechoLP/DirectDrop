import type { NearbyTransferSnapshot } from "./tauri";

export const MAX_NEARBY_TRANSFER_HISTORY = 200;

function isTerminal(transfer: NearbyTransferSnapshot) {
  return ["COMPLETED", "FAILED", "CANCELLED"].includes(transfer.status);
}

export function mergeNearbyTransferList(
  current: NearbyTransferSnapshot[],
  snapshot: NearbyTransferSnapshot,
) {
  const sorted = [
    snapshot,
    ...current.filter((item) => item.id !== snapshot.id),
  ].sort((left, right) => right.updatedAt - left.updatedAt);
  let terminalCount = 0;
  return sorted.filter((transfer) => {
    if (!isTerminal(transfer)) return true;
    terminalCount += 1;
    return terminalCount <= MAX_NEARBY_TRANSFER_HISTORY;
  });
}
