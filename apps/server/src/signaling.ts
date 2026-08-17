import type { FastifyBaseLogger } from "fastify";
import type { WebSocket } from "ws";
import {
  parseClientMessage,
  type ClientMessage,
  type ServerMessage,
  type ShareMetadata,
} from "@directdrop/protocol";
import type { DirectDropStore, StoredShare } from "./store.js";
import { secureToken } from "./token.js";

type Peer = {
  id: string;
  clientIp: string;
  socket: WebSocket;
  joinedShares: Set<string>;
  registeredShares: Set<string>;
  downloadRequestTimes: number[];
  messageTimes: number[];
};

export const MAX_ACTIVE_SIGNALING_CONNECTIONS = 1_000;
export const MAX_ACTIVE_SIGNALING_CONNECTIONS_PER_IP = 16;

export class SignalingHub {
  readonly peers = new Map<string, Peer>();
  readonly senders = new Map<string, string>();
  private shuttingDown = false;
  private readonly lastSeen = new Map<string, number>();
  private readonly presenceTimers = new Map<string, NodeJS.Timeout>();
  private readonly reservationTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly store: DirectDropStore,
    private readonly log: FastifyBaseLogger,
    private readonly validateAccessToken: (
      shareId: string,
      token: string | undefined,
    ) => boolean,
    private readonly presenceTimeoutMs: number,
    private readonly reservationTimeoutMs: number,
  ) {}

  add(socket: WebSocket, clientIp: string) {
    const connectionsForIp = [...this.peers.values()].filter(
      (peer) => peer.clientIp === clientIp,
    ).length;
    if (
      this.peers.size >= MAX_ACTIVE_SIGNALING_CONNECTIONS ||
      connectionsForIp >= MAX_ACTIVE_SIGNALING_CONNECTIONS_PER_IP
    ) {
      socket.close(1013, "signaling capacity reached");
      return undefined;
    }
    const peer: Peer = {
      id: secureToken(12),
      clientIp,
      socket,
      joinedShares: new Set(),
      registeredShares: new Set(),
      downloadRequestTimes: [],
      messageTimes: [],
    };
    this.peers.set(peer.id, peer);
    this.send(peer, { type: "CONNECTED", peerId: peer.id });

    socket.on("message", (raw, isBinary) => {
      const cutoff = Date.now() - 60_000;
      peer.messageTimes = peer.messageTimes.filter((time) => time > cutoff);
      if (peer.messageTimes.length >= 300) {
        this.sendError(
          peer,
          "MESSAGE_RATE_LIMITED",
          "Signaling 메시지가 너무 많습니다.",
        );
        socket.close(1008, "message rate limit");
        return;
      }
      peer.messageTimes.push(Date.now());
      if (isBinary) {
        this.sendError(
          peer,
          "BINARY_SIGNALING_FORBIDDEN",
          "Signaling은 JSON 메시지만 허용합니다.",
        );
        return;
      }
      try {
        const parsed = JSON.parse(raw.toString()) as unknown;
        const message = parseClientMessage(parsed);
        this.handle(peer, message);
      } catch (error) {
        this.log.warn(
          {
            peerId: peer.id,
            errorType:
              error instanceof Error ? error.constructor.name : "UnknownError",
          },
          "invalid signaling message",
        );
        this.sendError(
          peer,
          "INVALID_MESSAGE",
          "올바르지 않은 signaling 메시지입니다.",
        );
      }
    });
    socket.on("close", () => this.remove(peer));
    socket.on("error", (error) =>
      this.log.warn({ peerId: peer.id, error }, "websocket error"),
    );
    return peer.id;
  }

  isSenderOnline(token: string) {
    const peerId = this.senders.get(token);
    const peer = peerId ? this.peers.get(peerId) : undefined;
    const seen = this.lastSeen.get(token) ?? 0;
    return Boolean(
      peer &&
      peer.socket.readyState === peer.socket.OPEN &&
      Date.now() - seen < this.presenceTimeoutMs,
    );
  }

  shutdown() {
    this.shuttingDown = true;
    for (const peer of this.peers.values())
      peer.socket.close(1001, "server shutdown");
    for (const timer of this.presenceTimers.values()) clearTimeout(timer);
    for (const timer of this.reservationTimers.values()) clearTimeout(timer);
    this.peers.clear();
    this.senders.clear();
    this.lastSeen.clear();
    this.presenceTimers.clear();
    this.reservationTimers.clear();
  }

  private touchPresence(token: string) {
    this.lastSeen.set(token, Date.now());
    const previous = this.presenceTimers.get(token);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(() => {
      this.presenceTimers.delete(token);
      this.notifyShareState(token);
    }, this.presenceTimeoutMs);
    timer.unref();
    this.presenceTimers.set(token, timer);
  }

  private send(peer: Peer | undefined, message: ServerMessage) {
    if (!peer) return;
    if (peer.socket.readyState === peer.socket.OPEN)
      peer.socket.send(JSON.stringify(message));
  }

  private sendError(
    peer: Peer,
    code: string,
    message: string,
    requestId?: string,
  ) {
    this.send(peer, {
      type: "ERROR",
      code,
      message,
      ...(requestId ? { requestId } : {}),
    });
  }

  private scheduleReservationTimeout(sessionId: string) {
    const previous = this.reservationTimers.get(sessionId);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(() => {
      this.reservationTimers.delete(sessionId);
      if (this.store.expirePendingSession(sessionId))
        this.notifyParticipants(sessionId, {
          type: "TRANSFER_STATE",
          sessionId,
          state: "FAILED",
        });
    }, this.reservationTimeoutMs);
    timer.unref();
    this.reservationTimers.set(sessionId, timer);
  }

  private scheduleTransferTimeout(sessionId: string) {
    const previous = this.reservationTimers.get(sessionId);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(() => {
      this.reservationTimers.delete(sessionId);
      if (this.store.expireActiveSession(sessionId))
        this.notifyParticipants(sessionId, {
          type: "TRANSFER_STATE",
          sessionId,
          state: "FAILED",
        });
    }, this.reservationTimeoutMs);
    timer.unref();
    this.reservationTimers.set(sessionId, timer);
  }

  private clearReservationTimeout(sessionId: string) {
    const timer = this.reservationTimers.get(sessionId);
    if (timer) clearTimeout(timer);
    this.reservationTimers.delete(sessionId);
  }

  private clearTerminalReservationTimers() {
    for (const sessionId of this.reservationTimers.keys()) {
      const state = this.store.getSession(sessionId)?.state;
      if (!state || ["COMPLETED", "FAILED", "CANCELLED"].includes(state))
        this.clearReservationTimeout(sessionId);
    }
  }

  private finishConfirmedSession(sessionId: string) {
    const completed = this.store.completeSession(sessionId);
    if (!completed.changed) return;
    this.clearReservationTimeout(sessionId);
    this.notifyParticipants(sessionId, {
      type: "TRANSFER_STATE",
      sessionId,
      state: "COMPLETED",
      completedDownloads: completed.completedDownloads,
    });
  }

  private shareStatus(share: StoredShare): ShareMetadata["status"] {
    if (share.status === "EXPIRED") return "EXPIRED";
    if (share.status === "STOPPED") return "STOPPED";
    if (
      share.downloadLimit !== null &&
      share.completedDownloads >= share.downloadLimit
    )
      return "LIMIT_REACHED";
    return this.isSenderOnline(share.token) ? "ACTIVE" : "OFFLINE";
  }

  private notifyShareState(token: string) {
    const share = this.store.getShareByToken(token);
    if (!share) return;
    const senderOnline = this.isSenderOnline(token);
    const message: ServerMessage = {
      type: "SHARE_STATE",
      shareToken: token,
      senderOnline,
      status: this.shareStatus(share),
    };
    for (const peer of this.peers.values())
      if (peer.joinedShares.has(token)) this.send(peer, message);
  }

  private assertSender(peer: Peer, share: StoredShare): boolean {
    return (
      this.senders.get(share.token) === peer.id &&
      peer.registeredShares.has(share.token)
    );
  }

  private isSessionParticipant(
    peer: Peer,
    session: { receiverPeerId: string; shareId: string },
  ): boolean {
    if (session.receiverPeerId === peer.id) return true;
    const share = this.store.getShareById(session.shareId);
    return Boolean(share && this.assertSender(peer, share));
  }

  private handle(peer: Peer, message: ClientMessage) {
    switch (message.type) {
      case "REGISTER_SHARE": {
        const share = this.store.authorizeShare(
          message.shareToken,
          message.controlKey,
        );
        if (!share || share.status !== "ACTIVE")
          return this.sendError(
            peer,
            "SHARE_AUTH_FAILED",
            "공유를 등록할 수 없습니다.",
          );
        if (
          !peer.registeredShares.has(share.token) &&
          peer.registeredShares.size >= 25
        )
          return this.sendError(
            peer,
            "SHARE_REGISTRATION_LIMIT",
            "한 연결에서 등록할 수 있는 공유 수를 초과했습니다.",
          );
        const existing = this.senders.get(share.token);
        if (existing && existing !== peer.id)
          this.peers.get(existing)?.registeredShares.delete(share.token);
        this.senders.set(share.token, peer.id);
        peer.registeredShares.add(share.token);
        this.touchPresence(share.token);
        this.send(peer, { type: "REGISTERED", shareToken: share.token });
        this.notifyShareState(share.token);
        return;
      }
      case "UNREGISTER_SHARE": {
        const share = this.store.authorizeShare(
          message.shareToken,
          message.controlKey,
        );
        if (!share || !this.assertSender(peer, share))
          return this.sendError(
            peer,
            "SHARE_AUTH_FAILED",
            "공유를 중지할 권한이 없습니다.",
          );
        this.store.stopShare(message.shareToken, message.controlKey);
        this.clearTerminalReservationTimers();
        this.senders.delete(message.shareToken);
        this.lastSeen.delete(message.shareToken);
        const presenceTimer = this.presenceTimers.get(message.shareToken);
        if (presenceTimer) clearTimeout(presenceTimer);
        this.presenceTimers.delete(message.shareToken);
        peer.registeredShares.delete(message.shareToken);
        this.notifyShareState(message.shareToken);
        return;
      }
      case "JOIN_SHARE": {
        const share = this.store.getShareByToken(message.shareToken);
        if (!share)
          return this.sendError(
            peer,
            "SHARE_NOT_FOUND",
            "공유를 찾을 수 없습니다.",
          );
        if (!peer.joinedShares.has(share.token) && peer.joinedShares.size >= 100)
          return this.sendError(
            peer,
            "JOIN_LIMIT_REACHED",
            "한 연결에서 참여할 수 있는 공유 수를 초과했습니다.",
          );
        peer.joinedShares.add(message.shareToken);
        this.send(peer, {
          type: "SHARE_STATE",
          shareToken: share.token,
          senderOnline: this.isSenderOnline(share.token),
          status: this.shareStatus(share),
        });
        return;
      }
      case "HEARTBEAT": {
        if (peer.registeredShares.has(message.shareToken)) {
          this.touchPresence(message.shareToken);
          this.notifyShareState(message.shareToken);
        }
        return;
      }
      case "DOWNLOAD_REQUEST": {
        const cutoff = Date.now() - 60_000;
        peer.downloadRequestTimes = peer.downloadRequestTimes.filter(
          (time) => time > cutoff,
        );
        if (peer.downloadRequestTimes.length >= 20)
          return this.sendError(
            peer,
            "RATE_LIMITED",
            "다운로드 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
          );
        peer.downloadRequestTimes.push(Date.now());
        const share = this.store.getShareByToken(message.shareToken);
        if (!share)
          return this.sendError(
            peer,
            "SHARE_NOT_FOUND",
            "공유를 찾을 수 없습니다.",
          );
        if (!peer.joinedShares.has(share.token))
          return this.sendError(
            peer,
            "JOIN_REQUIRED",
            "먼저 공유에 참여해야 합니다.",
          );
        if (
          share.passwordHash &&
          !this.validateAccessToken(share.id, message.accessToken)
        )
          return this.sendError(
            peer,
            "PASSWORD_REQUIRED",
            "비밀번호 확인이 필요합니다.",
          );
        const senderPeer = this.peers.get(this.senders.get(share.token) ?? "");
        if (!senderPeer)
          return this.sendError(
            peer,
            "SENDER_OFFLINE",
            "보낸 사람이 오프라인입니다.",
          );
        const reserved = this.store.reserveDownload(share.token, peer.id);
        if (!reserved.ok)
          return this.sendError(
            peer,
            reserved.code,
            reserved.code === "DOWNLOAD_LIMIT_REACHED"
              ? "다운로드 횟수가 모두 사용되었습니다."
              : "다운로드를 시작할 수 없습니다.",
          );
        this.scheduleReservationTimeout(reserved.session.id);
        this.send(senderPeer, {
          type: "DOWNLOAD_REQUESTED",
          sessionId: reserved.session.id,
          peerId: peer.id,
          shareToken: share.token,
        });
        return;
      }
      case "DOWNLOAD_ACCEPT": {
        const session = this.store.getSession(message.sessionId);
        const share = session ? this.store.getShareById(session.shareId) : null;
        if (
          !session ||
          !share ||
          !this.assertSender(peer, share) ||
          session.receiverPeerId !== message.peerId
        )
          return this.sendError(
            peer,
            "INVALID_SESSION",
            "다운로드 세션이 올바르지 않습니다.",
          );
        if (!this.store.setSessionState(session.id, "CONNECTING"))
          return this.sendError(
            peer,
            "INVALID_SESSION_STATE",
            "이미 처리된 다운로드 요청입니다.",
          );
        this.send(this.peers.get(session.receiverPeerId), {
          type: "DOWNLOAD_ACCEPTED",
          sessionId: session.id,
          peerId: peer.id,
        });
        return;
      }
      case "DOWNLOAD_REJECT": {
        const session = this.store.getSession(message.sessionId);
        const share = session ? this.store.getShareById(session.shareId) : null;
        if (!session || !share || !this.assertSender(peer, share))
          return this.sendError(
            peer,
            "INVALID_SESSION",
            "다운로드 세션이 올바르지 않습니다.",
          );
        if (!this.store.setSessionState(session.id, "CANCELLED"))
          return this.sendError(
            peer,
            "INVALID_SESSION_STATE",
            "이미 처리된 다운로드 요청입니다.",
          );
        this.clearReservationTimeout(session.id);
        this.send(this.peers.get(session.receiverPeerId), {
          type: "DOWNLOAD_REJECTED",
          sessionId: session.id,
          ...(message.reason ? { reason: message.reason } : {}),
        });
        return;
      }
      case "OFFER":
      case "ANSWER":
      case "ICE_CANDIDATE": {
        const session = this.store.getSession(message.sessionId);
        if (!session)
          return this.sendError(
            peer,
            "INVALID_SESSION",
            "다운로드 세션이 없습니다.",
          );
        const share = this.store.getShareById(session.shareId);
        const senderPeerId = share ? this.senders.get(share.token) : undefined;
        const participants = new Set([session.receiverPeerId, senderPeerId]);
        if (!participants.has(peer.id) || !participants.has(message.toPeerId))
          return this.sendError(
            peer,
            "INVALID_PEER",
            "세션 참여자만 signaling할 수 있습니다.",
          );
        if (message.type === "OFFER")
          this.send(this.peers.get(message.toPeerId), {
            type: "OFFER",
            sessionId: message.sessionId,
            peerId: peer.id,
            sdp: message.sdp,
          });
        else if (message.type === "ANSWER")
          this.send(this.peers.get(message.toPeerId), {
            type: "ANSWER",
            sessionId: message.sessionId,
            peerId: peer.id,
            sdp: message.sdp,
          });
        else
          this.send(this.peers.get(message.toPeerId), {
            type: "ICE_CANDIDATE",
            sessionId: message.sessionId,
            peerId: peer.id,
            candidate: message.candidate,
          });
        return;
      }
      case "TRANSFER_STARTED": {
        const session = this.store.getSession(message.sessionId);
        const share = session ? this.store.getShareById(session.shareId) : null;
        if (!session || !share || !this.assertSender(peer, share))
          return this.sendError(
            peer,
            "INVALID_SESSION",
            "보낸 사람만 전송을 시작할 수 있습니다.",
          );
        if (!this.store.setSessionState(session.id, "TRANSFERRING")) return;
        this.scheduleTransferTimeout(session.id);
        this.notifyParticipants(session.id, {
          type: "TRANSFER_STATE",
          sessionId: session.id,
          state: "TRANSFERRING",
        });
        return;
      }
      case "TRANSFER_PROGRESS": {
        const session = this.store.getSession(message.sessionId);
        const share = session ? this.store.getShareById(session.shareId) : null;
        if (!session || !share || !this.assertSender(peer, share))
          return this.sendError(
            peer,
            "INVALID_SESSION",
            "보낸 사람만 전송 활동을 확인할 수 있습니다.",
          );
        if (session.state !== "TRANSFERRING")
          return this.sendError(
            peer,
            "INVALID_SESSION_STATE",
            "전송 활동 상태를 확인할 수 없습니다.",
          );
        this.scheduleTransferTimeout(session.id);
        return;
      }
      case "TRANSFER_SENT": {
        const session = this.store.getSession(message.sessionId);
        const share = session ? this.store.getShareById(session.shareId) : null;
        if (!session || !share || !this.assertSender(peer, share))
          return this.sendError(
            peer,
            "INVALID_SESSION",
            "보낸 사람만 전송 완료를 확인할 수 있습니다.",
          );
        if (session.state !== "TRANSFERRING")
          return this.sendError(
            peer,
            "INVALID_SESSION_STATE",
            "전송 완료 상태를 확인할 수 없습니다.",
          );
        this.store.markSessionSent(session.id);
        this.scheduleTransferTimeout(session.id);
        this.finishConfirmedSession(session.id);
        return;
      }
      case "TRANSFER_COMPLETED": {
        const session = this.store.getSession(message.sessionId);
        if (!session || session.receiverPeerId !== peer.id)
          return this.sendError(
            peer,
            "INVALID_SESSION",
            "수신자만 전송 완료를 확정할 수 있습니다.",
          );
        if (session.state !== "TRANSFERRING")
          return this.sendError(
            peer,
            "INVALID_SESSION_STATE",
            "전송 완료 상태를 확인할 수 없습니다.",
          );
        this.store.markSessionReceived(session.id);
        this.scheduleTransferTimeout(session.id);
        this.finishConfirmedSession(session.id);
        return;
      }
      case "TRANSFER_FAILED":
      case "TRANSFER_CANCELLED": {
        const session = this.store.getSession(message.sessionId);
        if (!session || !this.isSessionParticipant(peer, session))
          return this.sendError(
            peer,
            "INVALID_SESSION",
            "세션 참여자만 전송 상태를 변경할 수 있습니다.",
          );
        const state =
          message.type === "TRANSFER_CANCELLED" ? "CANCELLED" : "FAILED";
        if (!this.store.setSessionState(session.id, state)) return;
        this.clearReservationTimeout(session.id);
        this.notifyParticipants(session.id, {
          type: "TRANSFER_STATE",
          sessionId: session.id,
          state,
        });
        return;
      }
    }
  }

  private notifyParticipants(sessionId: string, message: ServerMessage) {
    const session = this.store.getSession(sessionId);
    if (!session) return;
    const share = this.store.getShareById(session.shareId);
    this.send(this.peers.get(session.receiverPeerId), message);
    if (share)
      this.send(this.peers.get(this.senders.get(share.token) ?? ""), message);
  }

  private remove(peer: Peer) {
    this.peers.delete(peer.id);
    if (this.shuttingDown) return;
    this.store.failSessionsForPeer(peer.id);
    this.clearTerminalReservationTimers();
    for (const token of peer.registeredShares) {
      if (this.senders.get(token) === peer.id) this.senders.delete(token);
      this.lastSeen.delete(token);
      const presenceTimer = this.presenceTimers.get(token);
      if (presenceTimer) clearTimeout(presenceTimer);
      this.presenceTimers.delete(token);
      const share = this.store.getShareByToken(token);
      if (share?.appLifetime)
        this.store.db
          .prepare(
            "UPDATE shares SET status = 'STOPPED', updated_at = ? WHERE id = ?",
          )
          .run(new Date().toISOString(), share.id);
      if (share) this.store.failSessionsForShare(share.id);
      this.clearTerminalReservationTimers();
      this.notifyShareState(token);
    }
  }
}
