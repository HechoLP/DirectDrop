import {
  DATA_CHANNEL_HIGH_WATER_MARK,
  DATA_CHANNEL_LOW_WATER_MARK,
  DEFAULT_CHUNK_SIZE,
  type PublicFile,
  type ServerMessage,
} from "@directdrop/protocol";
import {
  ProgressMeter,
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

export class SenderTransfer {
  readonly peer: RTCPeerConnection;
  readonly channel: RTCDataChannel;
  private readonly pendingCandidates: RTCIceCandidateInit[] = [];
  private finished = false;

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
      if (
        !this.finished &&
        ["failed", "disconnected"].includes(this.peer.connectionState)
      )
        this.onError(new Error("P2P 연결이 끊겼습니다."));
    };
    this.channel.onopen = () => void this.stream().catch(this.onError);
    this.channel.onerror = () =>
      this.onError(new Error("RTCDataChannel 오류가 발생했습니다."));
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
      else this.pendingCandidates.push(candidate);
    }
  }

  close() {
    this.finished = true;
    this.channel.close();
    this.peer.close();
  }

  private async stream() {
    const totalSize = this.files.reduce((sum, file) => sum + file.size, 0);
    const meter = new ProgressMeter();
    const publish = throttle(this.onProgress, 200);
    let sent = 0;
    this.signal({ type: "TRANSFER_STARTED", sessionId: this.sessionId });
    sendControl(this.channel, {
      type: "MANIFEST",
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
        this.channel.send(chunk);
        sent += chunk.byteLength;
        publish(meter.sample(sent, totalSize));
      }
      sendControl(this.channel, { type: "FILE_END", fileId: file.id });
    }
    await waitForBackpressure(this.channel);
    sendControl(this.channel, { type: "TRANSFER_COMPLETE" });
    this.finished = true;
    this.onComplete();
  }
}
