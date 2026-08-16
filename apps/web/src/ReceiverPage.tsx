import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  CloudOff,
  Download,
  KeyRound,
  LoaderCircle,
  Radio,
  ShieldCheck,
  WifiOff,
} from "lucide-react";
import type { ServerMessage, ShareMetadata } from "@directdrop/protocol";
import {
  formatBytes,
  formatDuration,
  type ProgressSnapshot,
} from "@directdrop/shared";
import { BrandMark, Button, ProgressBar, StatusPill } from "@directdrop/ui";
import {
  getRuntimeConfig,
  getShare,
  verifySharePassword,
  type PublicRuntimeConfig,
} from "./api";
import { FileList } from "./components/FileList";
import { attachReceiverChannel } from "./receiver-transfer";
import {
  detectSaveCapability,
  prepareSavePlan,
  type SavePlan,
} from "./save-plan";

type Phase =
  | "loading"
  | "ready"
  | "waiting"
  | "connecting"
  | "transferring"
  | "complete"
  | "error";

function isTurnServer(server: RTCIceServer) {
  const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
  return urls.some(
    (url) => url.startsWith("turn:") || url.startsWith("turns:"),
  );
}

function remainingText(expiresAt: string | null) {
  if (!expiresAt) return "제한 없음";
  return formatDuration(
    Math.max(0, (Date.parse(expiresAt) - Date.now()) / 1000),
  );
}

export function ReceiverPage({ token }: { token: string }) {
  const [metadata, setMetadata] = useState<ShareMetadata>();
  const [runtime, setRuntime] = useState<PublicRuntimeConfig>();
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string>();
  const [password, setPassword] = useState("");
  const [accessToken, setAccessToken] = useState<string>();
  const [progress, setProgress] = useState<ProgressSnapshot>();
  const [connectionType, setConnectionType] = useState("연결 전");
  const socketRef = useRef<WebSocket | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const senderPeerRef = useRef<string | null>(null);
  const sessionRef = useRef<string | null>(null);
  const savePlanRef = useRef<SavePlan | null>(null);
  const pendingCandidatesRef = useRef<
    Array<{ sessionId: string; candidate: RTCIceCandidateInit }>
  >([]);

  const send = useCallback((message: object) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN)
      socket.send(JSON.stringify(message));
  }, []);

  const fail = useCallback(
    (message: string) => {
      setError(message);
      setPhase("error");
      if (sessionRef.current)
        send({
          type: "TRANSFER_FAILED",
          sessionId: sessionRef.current,
          reason: message,
        });
    },
    [send],
  );

  const createPeer = useCallback(
    async (offer: Extract<ServerMessage, { type: "OFFER" }>) => {
      if (!runtime || !metadata || !savePlanRef.current)
        throw new Error("TRANSFER_NOT_READY");
      peerRef.current?.close();
      const iceServers = metadata.allowRelay
        ? runtime.iceServers
        : runtime.iceServers.filter((server) => !isTurnServer(server));
      const peer = new RTCPeerConnection({ iceServers });
      peerRef.current = peer;
      senderPeerRef.current = offer.peerId;
      sessionRef.current = offer.sessionId;
      peer.onicecandidate = (event) => {
        if (event.candidate)
          send({
            type: "ICE_CANDIDATE",
            sessionId: offer.sessionId,
            toPeerId: offer.peerId,
            candidate: event.candidate.toJSON(),
          });
      };
      peer.onconnectionstatechange = () => {
        if (
          peer.connectionState === "failed" ||
          peer.connectionState === "disconnected"
        )
          fail(
            "P2P 연결이 끊겼습니다. 네트워크를 확인하고 다시 시도해 주세요.",
          );
        if (peer.connectionState === "connected") {
          const selected = peer.getStats().then((stats) => {
            let pair:
              | (RTCStats & {
                  localCandidateId?: string;
                  remoteCandidateId?: string;
                })
              | undefined;
            for (const report of stats.values()) {
              if (report.type === "transport" && report.selectedCandidatePairId)
                pair = stats.get(report.selectedCandidatePairId) as typeof pair;
            }
            if (!pair) {
              for (const report of stats.values())
                if (
                  report.type === "candidate-pair" &&
                  report.state === "succeeded" &&
                  report.nominated
                )
                  pair = report as typeof pair;
            }
            const localCandidate = pair?.localCandidateId
              ? stats.get(pair.localCandidateId)
              : undefined;
            const remoteCandidate = pair?.remoteCandidateId
              ? stats.get(pair.remoteCandidateId)
              : undefined;
            setConnectionType(
              localCandidate?.candidateType === "relay" ||
                remoteCandidate?.candidateType === "relay"
                ? "Relay"
                : "Direct P2P",
            );
          });
          void selected;
        }
      };
      peer.ondatachannel = (event) => {
        setPhase("transferring");
        send({ type: "TRANSFER_STARTED", sessionId: offer.sessionId });
        attachReceiverChannel({
          channel: event.channel,
          files: metadata.files,
          savePlan: savePlanRef.current!,
          onProgress: setProgress,
          onComplete: () => {
            setPhase("complete");
            send({ type: "TRANSFER_COMPLETED", sessionId: offer.sessionId });
          },
          onError: (transferError) => fail(transferError.message),
        });
      };
      await peer.setRemoteDescription({ type: "offer", sdp: offer.sdp });
      const queued = pendingCandidatesRef.current.filter(
        (item) => item.sessionId === offer.sessionId,
      );
      pendingCandidatesRef.current = pendingCandidatesRef.current.filter(
        (item) => item.sessionId !== offer.sessionId,
      );
      await Promise.all(
        queued.map((item) => peer.addIceCandidate(item.candidate)),
      );
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      send({
        type: "ANSWER",
        sessionId: offer.sessionId,
        toPeerId: offer.peerId,
        sdp: answer.sdp,
      });
    },
    [fail, metadata, runtime, send],
  );

  useEffect(() => {
    let active = true;
    Promise.all([getShare(token), getRuntimeConfig()])
      .then(([share, config]) => {
        if (!active) return;
        setMetadata(share);
        setRuntime(config);
        setPhase("ready");
      })
      .catch((loadError: Error) =>
        fail(
          loadError.message === "SHARE_NOT_FOUND"
            ? "공유 링크를 찾을 수 없습니다."
            : "공유 정보를 불러오지 못했습니다.",
        ),
      );
    return () => {
      active = false;
    };
  }, [fail, token]);

  useEffect(() => {
    if (!runtime) return;
    const socket = new WebSocket(runtime.signalingUrl);
    socketRef.current = socket;
    socket.onopen = () => send({ type: "JOIN_SHARE", shareToken: token });
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data as string) as ServerMessage;
      if (message.type === "SHARE_STATE")
        setMetadata((current) =>
          current
            ? {
                ...current,
                senderOnline: message.senderOnline,
                status: message.status,
              }
            : current,
        );
      else if (message.type === "DOWNLOAD_ACCEPTED") {
        sessionRef.current = message.sessionId;
        senderPeerRef.current = message.peerId;
        setPhase("connecting");
      } else if (message.type === "DOWNLOAD_REJECTED")
        fail(message.reason ?? "보낸 사람이 다운로드 요청을 거절했습니다.");
      else if (message.type === "OFFER")
        void createPeer(message).catch((peerError: Error) =>
          fail(peerError.message),
        );
      else if (message.type === "ICE_CANDIDATE") {
        const candidate = message.candidate as RTCIceCandidateInit;
        if (
          peerRef.current?.remoteDescription &&
          sessionRef.current === message.sessionId
        )
          void peerRef.current.addIceCandidate(candidate);
        else
          pendingCandidatesRef.current.push({
            sessionId: message.sessionId,
            candidate,
          });
      } else if (message.type === "ERROR") fail(message.message);
    };
    socket.onerror = () =>
      fail("Signaling 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    return () => {
      socket.close();
      peerRef.current?.close();
    };
  }, [createPeer, fail, runtime, send, token]);

  const unlock = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const grant = await verifySharePassword(token, password);
      setAccessToken(grant);
      setMetadata(await getShare(token, grant));
      setPassword("");
    } catch {
      setError("비밀번호가 올바르지 않습니다.");
    }
  };

  const startDownload = async () => {
    if (!metadata) return;
    try {
      savePlanRef.current = await prepareSavePlan(metadata.files);
      setError(undefined);
      setPhase("waiting");
      send({
        type: "DOWNLOAD_REQUEST",
        shareToken: token,
        ...(accessToken ? { accessToken } : {}),
      });
    } catch (saveError) {
      if (saveError instanceof DOMException && saveError.name === "AbortError")
        return;
      fail(
        saveError instanceof Error &&
          saveError.message === "STREAMING_SAVE_UNSUPPORTED"
          ? "이 브라우저는 이 크기의 파일을 안전하게 저장할 수 없습니다. 최신 Chrome 또는 Edge를 사용해 주세요."
          : "저장 위치를 준비하지 못했습니다.",
      );
    }
  };

  const locked = metadata?.passwordProtected && metadata.files.length === 0;
  const capability =
    metadata && !locked ? detectSaveCapability(metadata.files) : undefined;
  const terminalState =
    metadata?.status === "EXPIRED" ||
    metadata?.status === "LIMIT_REACHED" ||
    metadata?.status === "STOPPED";

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-3xl items-center px-4 sm:px-6">
          <a href="/" aria-label="DirectDrop 홈">
            <BrandMark />
          </a>
        </div>
      </header>
      <main
        id="main"
        className="mx-auto max-w-3xl px-4 py-8 pb-32 sm:px-6 sm:py-12 sm:pb-12"
      >
        {phase === "loading" && (
          <div className="flex min-h-64 items-center justify-center gap-3 text-slate-600">
            <LoaderCircle
              className="animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />{" "}
            공유 정보를 불러오는 중…
          </div>
        )}

        {metadata && phase !== "loading" && (
          <>
            <section className="mb-8">
              <StatusPill tone={metadata.senderOnline ? "success" : "warning"}>
                <Radio aria-hidden="true" size={13} />{" "}
                {metadata.senderOnline
                  ? "보낸 사람 온라인"
                  : "보낸 사람 오프라인"}
              </StatusPill>
              <h1 className="mt-5 text-3xl font-bold tracking-[-.03em] sm:text-4xl">
                파일을 전달받았습니다.
              </h1>
              <p className="mt-3 text-base leading-7 text-slate-600">
                파일은 클라우드를 거치지 않고 보낸 사람의 컴퓨터와 직접
                연결됩니다.
              </p>
            </section>

            {locked ? (
              <form
                onSubmit={unlock}
                className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6"
              >
                <KeyRound className="text-blue-700" aria-hidden="true" />
                <h2 className="mt-4 text-lg font-bold">
                  비밀번호가 필요합니다
                </h2>
                <label
                  htmlFor="share-password"
                  className="mt-5 block text-sm font-semibold"
                >
                  공유 비밀번호
                </label>
                <input
                  id="share-password"
                  type="password"
                  autoComplete="current-password"
                  minLength={8}
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base focus:border-blue-600"
                />
                {error && (
                  <p
                    role="alert"
                    className="mt-2 text-sm font-medium text-red-700"
                  >
                    {error}
                  </p>
                )}
                <Button
                  className="mt-5 w-full bg-blue-600 text-white hover:bg-blue-700"
                  type="submit"
                >
                  <ShieldCheck aria-hidden="true" size={18} /> 확인
                </Button>
              </form>
            ) : (
              <div className="space-y-6">
                <FileList files={metadata.files} />
                <dl className="grid grid-cols-2 gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-3">
                  <div>
                    <dt className="text-xs font-semibold text-slate-500">
                      다운로드
                    </dt>
                    <dd className="tabular mt-1 text-sm font-bold">
                      {metadata.completedDownloads} /{" "}
                      {metadata.downloadLimit ?? "∞"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold text-slate-500">
                      남은 시간
                    </dt>
                    <dd className="tabular mt-1 text-sm font-bold">
                      {remainingText(metadata.expiresAt)}
                    </dd>
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <dt className="text-xs font-semibold text-slate-500">
                      연결 방식
                    </dt>
                    <dd className="mt-1 text-sm font-bold">{connectionType}</dd>
                  </div>
                </dl>

                {!metadata.senderOnline && metadata.status === "OFFLINE" && (
                  <div
                    className="rounded-2xl border border-amber-200 bg-amber-50 p-5"
                    role="status"
                  >
                    <WifiOff className="text-amber-800" aria-hidden="true" />
                    <p className="mt-3 font-bold text-amber-950">
                      보낸 사람의 컴퓨터가 오프라인입니다.
                    </p>
                    <p className="mt-1 text-sm leading-6 text-amber-900">
                      DirectDrop은 파일을 클라우드에 저장하지 않습니다. 보낸
                      사람이 다시 온라인이 되면 받을 수 있습니다.
                    </p>
                  </div>
                )}
                {metadata.status === "EXPIRED" && (
                  <StateNotice
                    icon={Clock3}
                    title="공유 링크가 만료되었습니다."
                    body="새 링크를 요청해 주세요."
                  />
                )}
                {metadata.status === "LIMIT_REACHED" && (
                  <StateNotice
                    icon={CloudOff}
                    title="다운로드 횟수가 모두 사용되었습니다."
                    body="보낸 사람에게 새 공유를 요청해 주세요."
                  />
                )}
                {metadata.status === "STOPPED" && (
                  <StateNotice
                    icon={CloudOff}
                    title="보낸 사람이 공유를 중지했습니다."
                    body="이 링크로는 더 이상 파일을 받을 수 없습니다."
                  />
                )}
                {capability?.warning && (
                  <p className="rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-900">
                    <AlertTriangle
                      className="mr-2 inline"
                      aria-hidden="true"
                      size={17}
                    />
                    {capability.warning}
                  </p>
                )}

                {(phase === "waiting" || phase === "connecting") && (
                  <p
                    className="flex items-center gap-2 rounded-xl bg-blue-50 p-4 text-sm font-semibold text-blue-900"
                    role="status"
                  >
                    <LoaderCircle
                      className="animate-spin motion-reduce:animate-none"
                      aria-hidden="true"
                      size={18}
                    />
                    {phase === "waiting"
                      ? "보낸 사람의 승인을 기다리는 중…"
                      : "P2P 연결을 준비하는 중…"}
                  </p>
                )}
                {phase === "transferring" && progress && (
                  <section
                    aria-live="polite"
                    className="rounded-2xl border border-blue-200 bg-white p-5"
                  >
                    <div className="flex items-end justify-between gap-4">
                      <div>
                        <p className="text-sm font-bold">전송 중</p>
                        <p className="tabular mt-1 text-sm text-slate-600">
                          {formatBytes(progress.transferredBytes)} /{" "}
                          {formatBytes(progress.totalBytes)}
                        </p>
                      </div>
                      <strong className="tabular text-2xl">
                        {progress.percent.toFixed(0)}%
                      </strong>
                    </div>
                    <div className="mt-4">
                      <ProgressBar value={progress.percent} />
                    </div>
                    <div className="tabular mt-3 flex justify-between text-xs text-slate-500">
                      <span>
                        {formatBytes(progress.currentBytesPerSecond)}/s
                      </span>
                      <span>약 {formatDuration(progress.etaSeconds)} 남음</span>
                    </div>
                  </section>
                )}
                {phase === "complete" && (
                  <div
                    className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5"
                    role="status"
                  >
                    <CheckCircle2
                      className="text-emerald-700"
                      aria-hidden="true"
                    />
                    <p className="mt-3 font-bold text-emerald-950">
                      다운로드가 완료되었습니다.
                    </p>
                    <p className="mt-1 text-sm text-emerald-900">
                      파일이 선택한 위치에 저장되었습니다.
                    </p>
                  </div>
                )}
                {phase === "error" && error && (
                  <div
                    className="rounded-2xl border border-red-200 bg-red-50 p-5"
                    role="alert"
                  >
                    <AlertTriangle
                      className="text-red-700"
                      aria-hidden="true"
                    />
                    <p className="mt-3 font-bold text-red-950">
                      전송을 완료하지 못했습니다.
                    </p>
                    <p className="mt-1 text-sm leading-6 text-red-900">
                      {error}
                    </p>
                  </div>
                )}

                <div className="safe-bottom fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 p-4 backdrop-blur-sm sm:static sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
                  <div className="mx-auto max-w-3xl">
                    <Button
                      onClick={() => void startDownload()}
                      disabled={
                        !metadata.senderOnline ||
                        terminalState ||
                        !capability?.canDownload ||
                        ["waiting", "connecting", "transferring"].includes(
                          phase,
                        )
                      }
                      className="w-full bg-blue-600 text-base text-white hover:bg-blue-700"
                    >
                      <Download aria-hidden="true" size={20} /> 다운로드 시작
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {!metadata && phase === "error" && (
          <StateNotice
            icon={AlertTriangle}
            title="공유를 열 수 없습니다."
            body={error ?? "링크를 다시 확인해 주세요."}
          />
        )}
      </main>
    </div>
  );
}

function StateNotice({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof AlertTriangle;
  title: string;
  body: string;
}) {
  return (
    <div
      className="rounded-2xl border border-slate-200 bg-white p-6 text-center"
      role="status"
    >
      <Icon className="mx-auto text-slate-500" aria-hidden="true" />
      <p className="mt-4 font-bold">{title}</p>
      <p className="mt-2 text-sm leading-6 text-slate-600">{body}</p>
    </div>
  );
}
