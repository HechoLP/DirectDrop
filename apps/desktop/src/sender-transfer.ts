import {
  DATA_CHANNEL_HIGH_WATER_MARK,
  DATA_CHANNEL_LOW_WATER_MARK,
  DEFAULT_CHUNK_SIZE,
  MAX_CONTROL_MESSAGE_CHARS,
  MAX_PENDING_ICE_CANDIDATES,
  PROTOCOL_VERSION,
  dataChannelReceiverControlSchema,
  type PublicFile,
  type ServerMessage,
} from "@directdrop/protocol";
import {
  ProgressMeter,
  sha256Hex,
  throttle,
  type ProgressSnapshot,
} from "@directdrop/shared";
import { readFileChunk } from "./tauri";

type SendSignal = (message: object) => void;

function sendControl(channel: RTCDataChannel, value: object) {
  channel.send(JSON.stringify(value));
}

async function waitForBackpressure(channel: RTCDataChannel) {
  if (channel.bufferedAmount < DATA_CHANNEL_HIGH_WATER_MARK) return;
  channel.bufferedAmountLowThreshold = DATA_CHANNEL_LOW_WATER_MARK;
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      channel.removeEventListener("bufferedamountlow", onLow);
      reject(new Error("DATA_CHANNEL_BACKPRESSURE_TIMEOUT"));
    }, 30_000);
    const onLow = () => {
      window.clearTimeout(timeout);
      channel.removeEventListener("bufferedamountlow", onLow);
      resolve();
    };
    channel.addEventListener("bufferedamountlow", onLow, { once: true });
  });
}

export function validateReceiverAcknowledgement(
  acknowledgedBytes: number,
  sentBytes: number,
  nextAcknowledgedBytes: number,
) {
  if (
    !Number.isSafeInteger(nextAcknowledgedBytes) ||
    nextAcknowledgedBytes < acknowledgedBytes ||
    nextAcknowledgedBytes > sentBytes
  )
    throw new Error("INVALID_RECEIVER_ACK");
  return nextAcknowledgedBytes;
}

export function receiverWindowNeedsPause(
  sentBytes: number,
  acknowledgedBytes: number,
  requireAll = false,
) {
  return requireAll
    ? acknowledgedBytes < sentBytes
    : sentBytes - acknowledgedBytes >= DATA_CHANNEL_HIGH_WATER_MARK;
}

export class SenderTransfer {
  readonly peer: RTCPeerConnection;
  readonly channel: RTCDataChannel;
  private readonly pendingCandidates: RTCIceCandidateInit[] = [];
  private finished = false;
  private readonly connectionTimer: number;
  private disconnectTimer: number | undefined;
  private sentBytes = 0;
  private acknowledgedBytes = 0;
  private readonly acknowledgementWaiters = new Set<() => void>();

  constructor(
    readonly sessionId: string,
    readonly receiverPeerId: string,
    private readonly files: PublicFile[],
    iceServers: RTCIceServer[],
    private readonly signal: SendSignal,
    private readonly onProgress: (snapshot: ProgressSnapshot) => void,
    private readonly onComplete: () => void,
    private readonly onError: (error: Error) => void,
  ) {
    this.peer = new RTCPeerConnection({ iceServers });
    this.channel = this.peer.createDataChannel("directdrop-files", {
      ordered: true,
    });
    this.channel.binaryType = "arraybuffer";
    this.channel.onmessage = (event) => {
      try {
        if (
          typeof event.data !== "string" ||
          event.data.length > MAX_CONTROL_MESSAGE_CHARS
        )
          throw new Error("INVALID_RECEIVER_CONTROL");
        const acknowledgement = dataChannelReceiverControlSchema.parse(
          JSON.parse(event.data),
        );
        this.acknowledgedBytes = validateReceiverAcknowledgement(
          this.acknowledgedBytes,
          this.sentBytes,
          acknowledgement.transferredBytes,
        );
        for (const waiter of this.acknowledgementWaiters) waiter();
        this.acknowledgementWaiters.clear();
      } catch (error) {
        this.fail(
          error instanceof Error ? error : new Error("INVALID_RECEIVER_ACK"),
        );
      }
    };
    this.connectionTimer = window.setTimeout(
      () => this.fail(new Error("P2P 연결 시간이 초과되었습니다.")),
      45_000,
    );
    this.peer.onicecandidate = (event) => {
      if (event.candidate)
        this.signal({
          type: "ICE_CANDIDATE",
          sessionId,
          toPeerId: receiverPeerId,
          candidate: event.candidate.toJSON(),
        });
    };
    this.peer.onconnectionstatechange = () => {
      if (this.finished) return;
      if (this.peer.connectionState === "failed")
        this.fail(new Error("P2P 연결이 끊겼습니다."));
      else if (this.peer.connectionState === "disconnected") {
        if (!this.disconnectTimer)
          this.disconnectTimer = window.setTimeout(
            () => this.fail(new Error("P2P 연결이 끊겼습니다.")),
            10_000,
          );
      } else if (this.peer.connectionState === "connected") {
        if (this.disconnectTimer) window.clearTimeout(this.disconnectTimer);
        this.disconnectTimer = undefined;
      }
    };
    this.channel.onopen = () => {
      window.clearTimeout(this.connectionTimer);
      void this.stream().catch((error: unknown) =>
        this.fail(error instanceof Error ? error : new Error(String(error))),
      );
    };
    this.channel.onerror = () =>
      this.fail(new Error("RTCDataChannel 오류가 발생했습니다."));
    this.channel.onclose = () => {
      if (!this.finished)
        this.fail(new Error("RTCDataChannel 연결이 예기치 않게 종료되었습니다."));
    };
  }

  async createOffer() {
    const offer = await this.peer.createOffer();
    await this.peer.setLocalDescription(offer);
    this.signal({
      type: "OFFER",
      sessionId: this.sessionId,
      toPeerId: this.receiverPeerId,
      sdp: offer.sdp,
    });
  }

  async handle(message: ServerMessage) {
    if (message.type !== "ANSWER" && message.type !== "ICE_CANDIDATE") return;
    if (message.sessionId !== this.sessionId) return;
    if (message.type === "ANSWER") {
      await this.peer.setRemoteDescription({
        type: "answer",
        sdp: message.sdp,
      });
      await Promise.all(
        this.pendingCandidates
          .splice(0)
          .map((candidate) => this.peer.addIceCandidate(candidate)),
      );
    }
    if (message.type === "ICE_CANDIDATE") {
      const candidate = message.candidate as RTCIceCandidateInit;
      if (this.peer.remoteDescription)
        await this.peer.addIceCandidate(candidate);
      else {
        if (this.pendingCandidates.length >= MAX_PENDING_ICE_CANDIDATES)
          throw new Error("ICE 후보가 허용 범위를 초과했습니다.");
        this.pendingCandidates.push(candidate);
      }
    }
  }

  close() {
    window.clearTimeout(this.connectionTimer);
    if (this.disconnectTimer) window.clearTimeout(this.disconnectTimer);
    this.disconnectTimer = undefined;
    this.finished = true;
    for (const waiter of this.acknowledgementWaiters) waiter();
    this.acknowledgementWaiters.clear();
    this.channel.close();
    this.peer.close();
  }

  private fail(error: Error) {
    if (this.finished) return;
    this.close();
    this.onError(error);
  }

  private async waitForReceiverWindow(requireAll = false) {
    const shouldWait = () =>
      receiverWindowNeedsPause(
        this.sentBytes,
        this.acknowledgedBytes,
        requireAll,
      );
    while (!this.finished && shouldWait()) {
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          this.acknowledgementWaiters.delete(onAcknowledgement);
          reject(new Error("RECEIVER_WRITE_ACK_TIMEOUT"));
        }, 30_000);
        const onAcknowledgement = () => {
          window.clearTimeout(timeout);
          resolve();
        };
        this.acknowledgementWaiters.add(onAcknowledgement);
      });
    }
  }

  private async stream() {
    const totalSize = this.files.reduce((sum, file) => sum + file.size, 0);
    const meter = new ProgressMeter();
    const publish = throttle(this.onProgress, 200);
    let sent = 0;
    let lastProgressSignalAt = Date.now();
    this.signal({ type: "TRANSFER_STARTED", sessionId: this.sessionId });
    sendControl(this.channel, {
      type: "MANIFEST",
      protocolVersion: PROTOCOL_VERSION,
      files: this.files,
      totalSize,
    });
    for (const file of this.files) {
      sendControl(this.channel, {
        type: "FILE_START",
        fileId: file.id,
        name: file.name,
        size: file.size,
        mimeType: file.mimeType,
      });
      for (let offset = 0; offset < file.size; offset += DEFAULT_CHUNK_SIZE) {
        await waitForBackpressure(this.channel);
        const length = Math.min(DEFAULT_CHUNK_SIZE, file.size - offset);
        const chunk = await readFileChunk(file.id, offset, length);
        sendControl(this.channel, {
          type: "CHUNK",
          fileId: file.id,
          offset,
          size: chunk.byteLength,
          sha256: await sha256Hex(chunk),
        });
        this.channel.send(chunk);
        sent += chunk.byteLength;
        this.sentBytes = sent;
        publish(meter.sample(sent, totalSize));
        if (Date.now() - lastProgressSignalAt >= 10_000) {
          this.signal({
            type: "TRANSFER_PROGRESS",
            sessionId: this.sessionId,
          });
          lastProgressSignalAt = Date.now();
        }
        await this.waitForReceiverWindow();
      }
      sendControl(this.channel, { type: "FILE_END", fileId: file.id });
    }
    await waitForBackpressure(this.channel);
    await this.waitForReceiverWindow(true);
    this.signal({ type: "TRANSFER_SENT", sessionId: this.sessionId });
    sendControl(this.channel, { type: "TRANSFER_COMPLETE" });
    this.finished = true;
    window.clearTimeout(this.connectionTimer);
    this.onComplete();
  }
}
