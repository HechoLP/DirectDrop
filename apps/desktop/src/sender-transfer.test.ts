import { describe, expect, it } from "vitest";
import { DATA_CHANNEL_HIGH_WATER_MARK } from "@directdrop/protocol";
import {
  receiverWindowNeedsPause,
  validateReceiverAcknowledgement,
} from "./sender-transfer";

describe("receiver write acknowledgement window", () => {
  it("pauses at the bounded in-flight window until the receiver writes data", () => {
    expect(
      receiverWindowNeedsPause(DATA_CHANNEL_HIGH_WATER_MARK, 0),
    ).toBe(true);
    expect(
      receiverWindowNeedsPause(DATA_CHANNEL_HIGH_WATER_MARK, 1),
    ).toBe(false);
    expect(receiverWindowNeedsPause(10, 9, true)).toBe(true);
    expect(receiverWindowNeedsPause(10, 10, true)).toBe(false);
  });

  it("rejects acknowledgements that move backwards or exceed sent bytes", () => {
    expect(validateReceiverAcknowledgement(4, 8, 6)).toBe(6);
    expect(() => validateReceiverAcknowledgement(4, 8, 3)).toThrow(
      "INVALID_RECEIVER_ACK",
    );
    expect(() => validateReceiverAcknowledgement(4, 8, 9)).toThrow(
      "INVALID_RECEIVER_ACK",
    );
  });
});
