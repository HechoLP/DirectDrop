import { describe, expect, it } from "vitest";
import type { NearbyTransferSnapshot } from "./tauri";
import {
  MAX_NEARBY_TRANSFER_HISTORY,
  mergeNearbyTransferList,
} from "./nearby-transfer-state";

function transfer(
  id: string,
  updatedAt: number,
  status: NearbyTransferSnapshot["status"] = "COMPLETED",
): NearbyTransferSnapshot {
  return {
    id,
    deviceId: "device-12345678",
    deviceName: "Trusted Mac",
    direction: "RECEIVE",
    files: [],
    totalBytes: 0,
    transferredBytes: 0,
    bytesPerSecond: 0,
    etaSeconds: null,
    status,
    error: null,
    updatedAt,
  };
}

describe("Nearby transfer state", () => {
  it("keeps active transfers while bounding terminal history", () => {
    let current = [transfer("active", 0, "TRANSFERRING")];
    for (let index = 0; index < MAX_NEARBY_TRANSFER_HISTORY + 20; index += 1)
      current = mergeNearbyTransferList(
        current,
        transfer(`terminal-${index}`, index + 1),
      );

    expect(current).toHaveLength(MAX_NEARBY_TRANSFER_HISTORY + 1);
    expect(current.some((item) => item.id === "active")).toBe(true);
    expect(current.some((item) => item.id === "terminal-0")).toBe(false);
    expect(
      current.some(
        (item) => item.id === `terminal-${MAX_NEARBY_TRANSFER_HISTORY + 19}`,
      ),
    ).toBe(true);
  });
});
