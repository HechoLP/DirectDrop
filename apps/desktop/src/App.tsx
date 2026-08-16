import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import {
  AlertTriangle,
  Bell,
  Check,
  CloudOff,
  Copy,
  Download,
  FilePlus2,
  Files,
  Info,
  Link2,
  LoaderCircle,
  Play,
  QrCode,
  Radio,
  Settings2,
  Share2,
  ShieldCheck,
  Square,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import QRCode from "qrcode";
import {
  HEARTBEAT_INTERVAL_MS,
  type PublicFile,
  type ServerMessage,
} from "@directdrop/protocol";
import {
  formatBytes,
  formatDuration,
  type ProgressSnapshot,
} from "@directdrop/shared";
import { BrandMark, Button, ProgressBar, StatusPill } from "@directdrop/ui";
import {
  defaultSettings,
  expirationIso,
  presets,
  type ShareSettings,
} from "./settings";
import { scheduleShareExpiration } from "./share-expiration";
import { SenderTransfer } from "./sender-transfer";
import {
  isTauri,
  quitApp,
  registerFiles,
  removeLocalFiles,
  setActiveShareCount,
} from "./tauri";
import {
  resolveVisualState,
  visualStateCopy,
  type AppVisualState,
} from "./visual-state";

const apiBase =
  import.meta.env.VITE_PUBLIC_APP_URL ??
  (import.meta.env.DEV ? "http://localhost:8787" : "https://share.dlfkd.dev");
const signalingUrl =
  import.meta.env.VITE_PUBLIC_SIGNALING_URL ??
  (import.meta.env.DEV ? "ws://localhost:8787/ws" : "wss://share.dlfkd.dev/ws");

type CreatedShare = {
  token: string;
  controlKey: string;
  url: string;
  qr: string;
  expiresAt: string | null;
};
type TransferRow = {
  progress?: ProgressSnapshot;
  state: "CONNECTING" | "TRANSFERRING" | "SENT" | "COMPLETED" | "FAILED";
  peerId: string;
};
type PendingRequest = { sessionId: string; peerId: string };

async function notify(title: string, body: string) {
  let granted = await isPermissionGranted();
  if (!granted) granted = (await requestPermission()) === "granted";
  if (granted) sendNotification({ title, body });
}

function isTurnServer(server: RTCIceServer) {
  const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
  return urls.some(
    (url) => url.startsWith("turn:") || url.startsWith("turns:"),
  );
}

export function App() {
  const [files, setFiles] = useState<PublicFile[]>([]);
  const [settings, setSettings] = useState<ShareSettings>(defaultSettings);
  const [share, setShare] = useState<CreatedShare>();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string>();
  const [online, setOnline] = useState(false);
  const [tab, setTab] = useState<"share" | "about">("share");
  const [showQr, setShowQr] = useState(false);
  const [pending, setPending] = useState<PendingRequest>();
  const [transfers, setTransfers] = useState<Record<string, TransferRow>>({});
  const [autoStart, setAutoStart] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const socketRef = useRef<WebSocket | null>(null);
  const transferRef = useRef(new Map<string, SenderTransfer>());
  const filesRef = useRef(files);
  const settingsRef = useRef(settings);
  const shareRef = useRef(share);
  const notificationsRef = useRef(notificationsEnabled);

  const totalSize = useMemo(
    () => files.reduce((sum, file) => sum + file.size, 0),
    [files],
  );
  const completedDownloads = Object.values(transfers).filter(
    (transfer) => transfer.state === "COMPLETED",
  ).length;
  const visualState = resolveVisualState({
    tab,
    fileCount: files.length,
    hasShare: Boolean(share),
    online,
    transferStates: Object.values(transfers).map((transfer) => transfer.state),
    hasError: Boolean(error),
  });

  useEffect(() => {
    filesRef.current = files;
  }, [files]);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  useEffect(() => {
    shareRef.current = share;
  }, [share]);
  useEffect(() => {
    notificationsRef.current = notificationsEnabled;
  }, [notificationsEnabled]);

  const notifyIfEnabled = useCallback((title: string, body: string) => {
    if (notificationsRef.current) void notify(title, body);
  }, []);

  const send = useCallback((message: object) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN)
      socket.send(JSON.stringify(message));
  }, []);

  const addPaths = useCallback(async (paths: string[]) => {
    if (!paths.length) return;
    try {
      const registered = await registerFiles(paths);
      setFiles((current) => {
        const nextFiles = [
          ...current,
          ...registered.filter(
            (next) => !current.some((file) => file.id === next.id),
          ),
        ];
        filesRef.current = nextFiles;
        return nextFiles;
      });
      setError(undefined);
    } catch (pathError) {
      setError(
        pathError instanceof Error ? pathError.message : String(pathError),
      );
    }
  }, []);

  const stopShare = useCallback(async () => {
    const activeShare = shareRef.current;
    if (!activeShare) return;
    const activeFiles = filesRef.current;
    send({
      type: "UNREGISTER_SHARE",
      shareToken: activeShare.token,
      controlKey: activeShare.controlKey,
    });
    socketRef.current?.close();
    transferRef.current.forEach((transfer) => transfer.close());
    transferRef.current.clear();
    shareRef.current = undefined;
    filesRef.current = [];
    setShare(undefined);
    setFiles([]);
    setTransfers({});
    setOnline(false);
    setPending(undefined);
    setShowQr(false);
    await Promise.all([
      fetch(`${apiBase}/api/shares/${activeShare.token}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${activeShare.controlKey}` },
      }).catch(() => undefined),
      removeLocalFiles(activeFiles.map((file) => file.id)),
    ]);
  }, [send]);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    const cleanups: Array<() => void> = [];
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "drop") void addPaths(event.payload.paths);
      })
      .then((unlisten) => {
        if (disposed) unlisten();
        else cleanups.push(unlisten);
      });
    void listen("stop-all-shares", () => void stopShare()).then((unlisten) => {
      if (disposed) unlisten();
      else cleanups.push(unlisten);
    });
    void listen("quit-requested", () => {
      if (
        !shareRef.current ||
        window.confirm(
          "활성 공유가 있습니다. DirectDrop을 종료하면 공유 링크를 사용할 수 없습니다. 종료할까요?",
        )
      )
        void quitApp();
    }).then((unlisten) => {
      if (disposed) unlisten();
      else cleanups.push(unlisten);
    });
    void isEnabled().then(setAutoStart);
    return () => {
      disposed = true;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [addPaths, stopShare]);

  useEffect(() => {
    if (isTauri()) void setActiveShareCount(share ? 1 : 0);
  }, [share]);

  const selectFiles = async () => {
    if (!isTauri()) {
      setError("파일 선택은 DirectDrop 데스크톱 앱에서 사용할 수 있습니다.");
      return;
    }
    const selected = await open({ multiple: true, directory: false });
    if (selected)
      await addPaths(Array.isArray(selected) ? selected : [selected]);
  };

  const removeFile = async (file: PublicFile) => {
    await removeLocalFiles([file.id]);
    setFiles((current) => {
      const nextFiles = current.filter((item) => item.id !== file.id);
      filesRef.current = nextFiles;
      return nextFiles;
    });
  };

  const startTransfer = useCallback(
    async (request: PendingRequest) => {
      if (!shareRef.current) return;
      setPending(undefined);
      send({
        type: "DOWNLOAD_ACCEPT",
        sessionId: request.sessionId,
        peerId: request.peerId,
      });
      notifyIfEnabled(
        "DirectDrop 전송 시작",
        "요청을 승인하고 P2P 연결을 준비합니다.",
      );
      setTransfers((current) => ({
        ...current,
        [request.sessionId]: { state: "CONNECTING", peerId: request.peerId },
      }));
      const config = (await fetch(`${apiBase}/api/config`).then((response) =>
        response.json(),
      )) as { iceServers: RTCIceServer[] };
      const iceServers = settingsRef.current.allowRelay
        ? config.iceServers
        : config.iceServers.filter((server) => !isTurnServer(server));
      const transfer = new SenderTransfer(
        request.sessionId,
        request.peerId,
        filesRef.current,
        iceServers,
        send,
        (progress) =>
          setTransfers((current) => ({
            ...current,
            [request.sessionId]: {
              ...current[request.sessionId]!,
              state: "TRANSFERRING",
              progress,
            },
          })),
        () =>
          setTransfers((current) => ({
            ...current,
            [request.sessionId]: {
              ...current[request.sessionId]!,
              state: "SENT",
            },
          })),
        (transferError) => {
          setTransfers((current) => ({
            ...current,
            [request.sessionId]: {
              ...current[request.sessionId]!,
              state: "FAILED",
            },
          }));
          send({
            type: "TRANSFER_FAILED",
            sessionId: request.sessionId,
            reason: transferError.message,
          });
          notifyIfEnabled("DirectDrop 전송 실패", transferError.message);
        },
      );
      transferRef.current.set(request.sessionId, transfer);
      await transfer.createOffer();
    },
    [notifyIfEnabled, send],
  );

  const connectShare = useCallback(
    (created: CreatedShare) => {
      socketRef.current?.close();
      const socket = new WebSocket(signalingUrl);
      socketRef.current = socket;
      socket.onopen = () => {
        socket.send(
          JSON.stringify({
            type: "REGISTER_SHARE",
            shareToken: created.token,
            controlKey: created.controlKey,
          }),
        );
        setOnline(true);
      };
      socket.onclose = () => setOnline(false);
      socket.onerror = () => setError("Signaling 서버 연결에 실패했습니다.");
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data as string) as ServerMessage;
        if (message.type === "DOWNLOAD_REQUESTED") {
          const request = {
            sessionId: message.sessionId,
            peerId: message.peerId,
          };
          const currentFiles = filesRef.current;
          notifyIfEnabled(
            "새 다운로드 요청",
            currentFiles.length > 1
              ? `${currentFiles[0]?.name} 외 ${currentFiles.length - 1}개`
              : (currentFiles[0]?.name ?? "파일"),
          );
          if (settingsRef.current.approvalMode === "AUTO")
            void startTransfer(request);
          else setPending(request);
        } else if (
          message.type === "ANSWER" ||
          message.type === "ICE_CANDIDATE"
        ) {
          void transferRef.current.get(message.sessionId)?.handle(message);
        } else if (message.type === "TRANSFER_STATE") {
          if (message.state === "COMPLETED") {
            setTransfers((current) => ({
              ...current,
              [message.sessionId]: {
                ...current[message.sessionId]!,
                state: "COMPLETED",
              },
            }));
            transferRef.current.get(message.sessionId)?.close();
            transferRef.current.delete(message.sessionId);
            notifyIfEnabled(
              "DirectDrop 전송 완료",
              "상대방의 저장이 완료되었습니다.",
            );
          }
        } else if (message.type === "ERROR") setError(message.message);
      };
    },
    [notifyIfEnabled, startTransfer],
  );

  useEffect(() => {
    if (!share) return;
    const timer = window.setInterval(
      () => send({ type: "HEARTBEAT", shareToken: share.token }),
      HEARTBEAT_INTERVAL_MS,
    );
    return () => window.clearInterval(timer);
  }, [send, share]);

  useEffect(() => {
    if (!share?.expiresAt) return;
    const token = share.token;
    const expireShare = () => {
      if (shareRef.current?.token !== token) return;
      notifyIfEnabled(
        "DirectDrop 공유 만료",
        "공유 링크의 사용 시간이 끝나 자동으로 종료했습니다.",
      );
      void stopShare();
    };
    return scheduleShareExpiration(share.expiresAt, expireShare);
  }, [notifyIfEnabled, share?.expiresAt, share?.token, stopShare]);

  const createShare = async () => {
    if (!files.length || (settings.password && settings.password.length < 8)) {
      setError(
        settings.password
          ? "비밀번호는 8자 이상이어야 합니다."
          : "공유할 파일을 선택해 주세요.",
      );
      return;
    }
    setCreating(true);
    setError(undefined);
    try {
      const expiresAt = expirationIso(settings);
      const response = await fetch(`${apiBase}/api/shares`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          files,
          downloadLimit: settings.downloadLimit,
          expiresAt,
          appLifetime: settings.appLifetime,
          password: settings.password || null,
          approvalMode: settings.approvalMode,
          allowRelay: settings.allowRelay,
        }),
      });
      if (!response.ok) throw new Error("공유를 만들지 못했습니다.");
      const created = (await response.json()) as Omit<
        CreatedShare,
        "qr" | "expiresAt"
      >;
      const next = {
        ...created,
        qr: await QRCode.toDataURL(created.url, {
          width: 720,
          margin: 2,
          color: { dark: "#0f172a", light: "#ffffff" },
        }),
        expiresAt,
      };
      shareRef.current = next;
      setShare(next);
      connectShare(next);
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : String(createError),
      );
    } finally {
      setCreating(false);
    }
  };

  const copyLink = async () => {
    if (share) await navigator.clipboard.writeText(share.url);
  };
  const shareLink = async () => {
    if (!share) return;
    if (navigator.share)
      await navigator.share({
        title: "DirectDrop",
        text: "DirectDrop으로 파일을 보냈습니다.",
        url: share.url,
      });
    else await copyLink();
  };
  const saveQr = () => {
    if (!share) return;
    const anchor = document.createElement("a");
    anchor.href = share.qr;
    anchor.download = `DirectDrop-${share.token}-QR.png`;
    anchor.click();
  };

  return (
    <div className={`dd-app dd-state-${visualState}`}>
      <header className="dd-topbar">
        <div className="dd-topbar-inner mx-auto flex h-16 max-w-5xl items-center justify-between px-5 lg:px-8">
          <BrandMark />
          <nav className="dd-nav flex items-center" aria-label="앱 메뉴">
            <Button
              onClick={() => setTab("share")}
              aria-current={tab === "share" ? "page" : undefined}
              className={`dd-nav-button ${tab === "share" ? "is-active" : ""}`}
            >
              <Share2 aria-hidden="true" size={17} /> 공유
            </Button>
            <Button
              onClick={() => setTab("about")}
              aria-current={tab === "about" ? "page" : undefined}
              className={`dd-nav-button ${tab === "about" ? "is-active" : ""}`}
            >
              <Info aria-hidden="true" size={17} /> 정보
            </Button>
          </nav>
        </div>
      </header>

      <main className="dd-workspace mx-auto max-w-5xl px-5 lg:px-8">
        {tab === "about" ? (
          <About
            autoStart={autoStart}
            notificationsEnabled={notificationsEnabled}
            onNotificationsEnabled={setNotificationsEnabled}
            onAutoStart={async (enabled) => {
              if (enabled) await enable();
              else await disable();
              setAutoStart(enabled);
            }}
          />
        ) : (
          <div className="dd-share-screen">
            <StateHeader state={visualState} />
            {share ? (
              <ShareReady
                share={share}
                files={files}
                online={online}
                completed={completedDownloads}
                limit={settings.downloadLimit}
                transfers={transfers}
                onCopy={() => void copyLink()}
                onShare={() => void shareLink()}
                onShowQr={() => setShowQr(true)}
                onSaveQr={saveQr}
                onStop={() => void stopShare()}
              />
            ) : (
              <div className="dd-compose-grid grid gap-5 lg:grid-cols-[1.08fr_.92fr]">
                <section
                  aria-labelledby="files-title"
                  className="dd-files-column"
                >
                  <div className="dd-section-heading">
                    <div>
                      <p className="dd-kicker">1단계</p>
                      <h2 id="files-title">파일 선택</h2>
                    </div>
                    <span className="dd-local-badge shrink-0">
                      <CloudOff aria-hidden="true" size={15} /> 서버 저장 없음
                    </span>
                  </div>
                  {!files.length ? (
                    <button
                      onClick={() => void selectFiles()}
                      className="dd-drop-zone flex min-h-[330px] w-full cursor-pointer flex-col items-center justify-center rounded-3xl bg-white p-8 text-center"
                    >
                      <span className="dd-drop-icon grid size-14 place-items-center rounded-2xl bg-blue-50 text-blue-700">
                        <UploadCloud aria-hidden="true" size={27} />
                      </span>
                      <strong className="mt-5 text-lg">
                        보낼 파일을 선택하세요
                      </strong>
                      <span className="mt-2 text-sm text-slate-500">
                        이곳으로 여러 파일을 끌어다 놓아도 됩니다.
                      </span>
                      <span className="dd-drop-action mt-6 inline-flex min-h-11 items-center rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white">
                        <FilePlus2
                          aria-hidden="true"
                          className="mr-2"
                          size={18}
                        />{" "}
                        파일 선택
                      </span>
                      <span className="mt-4 flex items-center gap-1.5 text-xs font-medium text-slate-500">
                        <ShieldCheck aria-hidden="true" size={15} /> 파일은
                        상대방 기기로 직접 전송됩니다.
                      </span>
                    </button>
                  ) : (
                    <div className="dd-panel dd-selected-files overflow-hidden rounded-2xl bg-white">
                      <ul className="dd-selected-files-list divide-y divide-slate-200">
                        {files.map((file) => (
                          <li
                            key={file.id}
                            className="flex min-w-0 items-center gap-3 px-4 py-3"
                          >
                            <span className="dd-file-icon grid size-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-700">
                              <Files aria-hidden="true" size={18} />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span
                                title={file.name}
                                className="block truncate text-sm font-semibold"
                              >
                                {file.name}
                              </span>
                              <span className="tabular mt-0.5 block text-xs text-slate-500">
                                {formatBytes(file.size)}
                              </span>
                            </span>
                            <button
                              onClick={() => void removeFile(file)}
                              className="dd-icon-button grid size-11 cursor-pointer place-items-center rounded-xl text-slate-500 hover:bg-red-50 hover:text-red-700"
                              aria-label={`${file.name} 제거`}
                            >
                              <Trash2 aria-hidden="true" size={17} />
                            </button>
                          </li>
                        ))}
                      </ul>
                      <div className="dd-file-summary flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-3">
                        <span className="text-sm font-semibold">
                          파일 {files.length}개
                        </span>
                        <span className="tabular text-sm font-bold">
                          {formatBytes(totalSize)}
                        </span>
                      </div>
                      <Button
                        onClick={() => void selectFiles()}
                        className="dd-secondary-button m-3 border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                      >
                        <FilePlus2 aria-hidden="true" size={17} /> 파일 추가
                      </Button>
                    </div>
                  )}
                </section>
                <SettingsPanel
                  settings={settings}
                  onChange={setSettings}
                  onStart={() => void createShare()}
                  creating={creating}
                  disabled={!files.length}
                />
              </div>
            )}
          </div>
        )}
        {error && (
          <div
            role="alert"
            className="dd-alert mt-5 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"
          >
            <AlertTriangle
              aria-hidden="true"
              className="mt-0.5 shrink-0"
              size={18}
            />
            {error}
          </div>
        )}
      </main>

      {pending && (
        <ApprovalDialog
          files={files}
          onAccept={() => void startTransfer(pending)}
          onReject={() => {
            send({
              type: "DOWNLOAD_REJECT",
              sessionId: pending.sessionId,
              peerId: pending.peerId,
              reason: "보낸 사람이 요청을 거절했습니다.",
            });
            setPending(undefined);
          }}
        />
      )}
      {showQr && share && (
        <QrDialog
          share={share}
          onClose={() => setShowQr(false)}
          onSave={saveQr}
        />
      )}
    </div>
  );
}

function StateHeader({ state }: { state: AppVisualState }) {
  const copy = visualStateCopy[state];
  const steps = [
    { label: "파일 선택", icon: FilePlus2 },
    { label: "공유 설정", icon: Settings2 },
    { label: "연결 대기", icon: Radio },
    { label: "파일 전송", icon: Share2 },
  ];

  return (
    <section className="dd-state-header" aria-live="polite" aria-atomic="true">
      <div className="dd-state-heading" key={state}>
        <p className="dd-kicker">DIRECT TRANSFER</p>
        <h1>{copy.label}</h1>
        <p>{copy.description}</p>
      </div>
      <div className="dd-privacy-note">
        <ShieldCheck aria-hidden="true" size={18} />
        <span>
          <strong>클라우드 저장 없이</strong>
          기기 사이에서 직접 전송해요
        </span>
      </div>
      <ol className="dd-stepper" aria-label="공유 진행 상태">
        {steps.map((step, index) => {
          const Icon = step.icon;
          const current = index === copy.step;
          return (
            <li
              key={step.label}
              className={current ? "is-current" : ""}
              data-complete={index < copy.step || undefined}
              aria-current={current ? "step" : undefined}
            >
              <span className="dd-step-icon">
                {index < copy.step ? (
                  <Check aria-hidden="true" size={14} />
                ) : (
                  <Icon aria-hidden="true" size={14} />
                )}
              </span>
              <span>{step.label}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function SettingsPanel({
  settings,
  onChange,
  onStart,
  creating,
  disabled,
}: {
  settings: ShareSettings;
  onChange: (settings: ShareSettings) => void;
  onStart: () => void;
  creating: boolean;
  disabled: boolean;
}) {
  const standardLimits = [1, 2, 3, 5, 10];
  const limitValue =
    settings.downloadLimit === null
      ? "unlimited"
      : standardLimits.includes(settings.downloadLimit)
        ? String(settings.downloadLimit)
        : "custom";
  return (
    <section
      aria-labelledby="settings-title"
      className="dd-panel dd-settings-panel rounded-2xl border border-slate-200 bg-white p-5"
    >
      <div className="dd-settings-heading flex items-center justify-between gap-3">
        <div>
          <p className="dd-kicker">2단계</p>
          <h2 id="settings-title" className="font-bold">
            공유 설정
          </h2>
        </div>
        <span className="dd-settings-icon" aria-hidden="true">
          <Settings2 size={18} />
        </span>
      </div>
      <div className="dd-settings-content">
        <fieldset className="dd-settings-presets">
          <legend className="text-sm font-semibold">빠른 설정</legend>
          <div className="dd-preset-grid mt-2 grid grid-cols-3 gap-2">
            {presets.map((preset) => (
              <button
                key={preset.id}
                onClick={() =>
                  onChange({
                    ...settings,
                    downloadLimit: preset.downloadLimit,
                    expiresInMs: preset.expiresInMs,
                    appLifetime: false,
                  })
                }
                aria-pressed={
                  !settings.appLifetime &&
                  settings.downloadLimit === preset.downloadLimit &&
                  settings.expiresInMs === preset.expiresInMs
                }
                className="dd-preset cursor-pointer rounded-xl border border-slate-200 px-3 text-left hover:border-blue-500 hover:bg-blue-50"
              >
                <span className="block text-xs font-bold">{preset.label}</span>
                <span className="mt-1 block text-[11px] text-slate-500">
                  {preset.detail}
                </span>
              </button>
            ))}
          </div>
        </fieldset>
        <div className="dd-settings-grid">
          <label className="block text-sm font-semibold">
            다운로드 횟수
            <span
              className={`dd-setting-control ${limitValue === "custom" ? "has-custom-value" : ""}`}
            >
              <select
                value={limitValue}
                onChange={(event) =>
                  onChange({
                    ...settings,
                    downloadLimit:
                      event.target.value === "unlimited"
                        ? null
                        : event.target.value === "custom"
                          ? 20
                          : Number(event.target.value),
                  })
                }
                className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-base font-normal"
              >
                <option value="1">1회</option>
                <option value="2">2회</option>
                <option value="3">3회</option>
                <option value="5">5회</option>
                <option value="10">10회</option>
                <option value="custom">직접 입력</option>
                <option value="unlimited">제한 없음</option>
              </select>
              {limitValue === "custom" && (
                <input
                  aria-label="다운로드 가능 횟수 직접 입력"
                  type="number"
                  min={1}
                  max={1000}
                  value={settings.downloadLimit ?? 20}
                  onChange={(event) =>
                    onChange({
                      ...settings,
                      downloadLimit: Math.min(
                        1000,
                        Math.max(1, Number(event.target.value)),
                      ),
                    })
                  }
                  className="min-h-11 w-full rounded-xl border border-slate-300 px-3 text-base font-normal"
                />
              )}
            </span>
          </label>
          <label className="block text-sm font-semibold">
            만료
            <select
              value={
                settings.appLifetime
                  ? "app"
                  : (settings.expiresInMs ?? "unlimited")
              }
              onChange={(event) =>
                onChange({
                  ...settings,
                  appLifetime: event.target.value === "app",
                  expiresInMs:
                    event.target.value === "app" ||
                    event.target.value === "unlimited"
                      ? null
                      : Number(event.target.value),
                })
              }
              className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-base font-normal"
            >
              <option value={600000}>10분</option>
              <option value={1800000}>30분</option>
              <option value={3600000}>1시간</option>
              <option value={10800000}>3시간</option>
              <option value={21600000}>6시간</option>
              <option value={43200000}>12시간</option>
              <option value={86400000}>24시간</option>
              <option value={259200000}>3일</option>
              <option value={604800000}>7일</option>
              <option value="app">앱 종료 시까지</option>
              <option value="unlimited">제한 없음</option>
            </select>
          </label>
          <label className="block text-sm font-semibold">
            비밀번호 <span className="font-normal text-slate-500">(선택)</span>
            <input
              type="password"
              minLength={8}
              autoComplete="new-password"
              value={settings.password}
              onChange={(event) =>
                onChange({ ...settings, password: event.target.value })
              }
              placeholder="8자 이상 또는 비워두기"
              className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-base font-normal"
            />
          </label>
          <label className="block text-sm font-semibold">
            승인 방식
            <select
              value={settings.approvalMode}
              onChange={(event) =>
                onChange({
                  ...settings,
                  approvalMode: event.target
                    .value as ShareSettings["approvalMode"],
                })
              }
              className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-base font-normal"
            >
              <option value="AUTO">자동 승인</option>
              <option value="MANUAL">매번 승인</option>
            </select>
          </label>
        </div>
        <label className="dd-setting-toggle flex min-h-14 cursor-pointer items-center gap-3 rounded-xl bg-slate-50 px-3 text-sm">
          <input
            type="checkbox"
            checked={settings.allowRelay}
            onChange={(event) =>
              onChange({ ...settings, allowRelay: event.target.checked })
            }
            className="dd-switch shrink-0"
          />
          <span>
            <strong className="block">직접 연결 실패 시 Relay 허용</strong>
            <span className="text-xs text-slate-500">
              TURN 서버가 구성된 경우에만 동작합니다.
            </span>
          </span>
        </label>
        <Button
          onClick={onStart}
          disabled={disabled || creating}
          className="dd-primary-button w-full bg-blue-600 text-white hover:bg-blue-700"
        >
          {creating ? (
            <LoaderCircle
              className="animate-spin motion-reduce:animate-none"
              aria-hidden="true"
              size={18}
            />
          ) : (
            <Play aria-hidden="true" size={18} />
          )}{" "}
          공유 시작
        </Button>
      </div>
    </section>
  );
}

function ShareReady({
  share,
  files,
  online,
  completed,
  limit,
  transfers,
  onCopy,
  onShare,
  onShowQr,
  onSaveQr,
  onStop,
}: {
  share: CreatedShare;
  files: PublicFile[];
  online: boolean;
  completed: number;
  limit: number | null;
  transfers: Record<string, TransferRow>;
  onCopy: () => void;
  onShare: () => void;
  onShowQr: () => void;
  onSaveQr: () => void;
  onStop: () => void;
}) {
  const totalSize = useMemo(
    () => files.reduce((sum, file) => sum + file.size, 0),
    [files],
  );
  const transferEntries = Object.entries(transfers);

  return (
    <div className="dd-share-ready mx-auto max-w-4xl">
      <div className="dd-ready-summary flex items-center justify-between gap-4">
        <div className="min-w-0">
          <StatusPill tone={online ? "success" : "warning"}>
            <Radio aria-hidden="true" size={13} />
            {online ? "링크 활성화됨" : "연결 중"}
          </StatusPill>
          <p className="mt-2 truncate text-sm font-semibold text-slate-700">
            {files[0]?.name}
            {files.length > 1 ? ` 외 ${files.length - 1}개` : ""}
          </p>
        </div>
        <dl className="dd-ready-metrics">
          <div>
            <dt>다운로드</dt>
            <dd className="tabular">
              {completed} / {limit ?? "∞"}
            </dd>
          </div>
          <div>
            <dt>남은 시간</dt>
            <dd className="tabular">
              <ShareRemaining expiresAt={share.expiresAt} />
            </dd>
          </div>
        </dl>
      </div>
      <div className="dd-ready-grid">
        <section
          className="dd-active-share-card rounded-2xl border border-slate-200 bg-white"
          aria-labelledby="active-share-title"
        >
          <div className="dd-active-share-heading">
            <div>
              <p className="dd-kicker">ACTIVE SHARE</p>
              <h2 id="active-share-title">공유 중인 항목</h2>
            </div>
            <span className="dd-file-count">파일 {files.length}개</span>
          </div>

          <div className="dd-share-link-row">
            <span className="dd-list-icon" aria-hidden="true">
              <Link2 size={17} />
            </span>
            <div className="min-w-0 flex-1">
              <span className="dd-list-label">공유 링크</span>
              <p className="dd-share-url truncate text-sm font-semibold text-blue-800">
                {share.url}
              </p>
            </div>
            <button
              type="button"
              onClick={onCopy}
              className="dd-icon-button grid size-11 shrink-0 cursor-pointer place-items-center rounded-xl text-slate-500"
              aria-label="공유 링크 복사"
            >
              <Copy aria-hidden="true" size={17} />
            </button>
          </div>

          <div className="dd-active-file-region">
            <div className="dd-active-file-title">
              <span>공유 파일</span>
              <span className="tabular">{formatBytes(totalSize)}</span>
            </div>
            <ul className="dd-active-file-list">
              {files.map((file) => (
                <li key={file.id}>
                  <span className="dd-list-icon" aria-hidden="true">
                    <Files size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {file.name}
                    </span>
                    <span className="tabular block text-xs text-slate-500">
                      {formatBytes(file.size)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {transferEntries.length > 0 ? (
            <div className="dd-transfer-list" aria-label="전송 현황">
              {transferEntries.map(([sessionId, transfer]) => (
                <div
                  key={sessionId}
                  className="dd-transfer-row rounded-xl border border-slate-200 bg-white"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-bold">
                      {transfer.state === "COMPLETED"
                        ? "저장 완료"
                        : transfer.state === "FAILED"
                          ? "전송 실패"
                          : "전송 중"}
                    </p>
                    <span className="tabular text-sm font-bold">
                      {transfer.progress?.percent.toFixed(0) ?? 0}%
                    </span>
                  </div>
                  <div className="mt-2">
                    <ProgressBar value={transfer.progress?.percent ?? 0} />
                  </div>
                  {transfer.progress && (
                    <p className="tabular mt-1 text-xs text-slate-500">
                      {formatBytes(transfer.progress.currentBytesPerSecond)}/s ·
                      약 {formatDuration(transfer.progress.etaSeconds)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : null}

          <div className="dd-share-actions">
            <Button
              onClick={onCopy}
              className="dd-primary-button bg-blue-600 text-white hover:bg-blue-700"
            >
              <Copy aria-hidden="true" size={17} /> 링크 복사
            </Button>
            <Button
              onClick={onShare}
              className="border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
            >
              <Share2 aria-hidden="true" size={17} /> 공유
            </Button>
            <Button
              onClick={onStop}
              className="border border-red-200 bg-white text-red-700 hover:bg-red-50"
            >
              <Square aria-hidden="true" size={17} /> 중지
            </Button>
          </div>
        </section>
        <aside className="dd-qr-card rounded-2xl border border-slate-200 bg-white p-4 text-center">
          <div className="dd-qr-heading">
            <span className="dd-list-icon" aria-hidden="true">
              <QrCode size={17} />
            </span>
            <span>
              <strong>QR로 열기</strong>
              <small>휴대폰에서 바로 접속</small>
            </span>
          </div>
          <button
            onClick={onShowQr}
            className="dd-qr-button w-full cursor-zoom-in rounded-xl bg-white p-2"
            aria-label="QR 코드 크게 보기"
          >
            <img
              src={share.qr}
              alt={`공유 링크 ${share.url} QR 코드`}
              className="mx-auto aspect-square w-full"
            />
          </button>
          <div className="dd-qr-actions grid gap-2">
            <Button
              onClick={onShowQr}
              className="border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
            >
              <QrCode aria-hidden="true" size={17} /> 크게 보기
            </Button>
            <Button
              onClick={onSaveQr}
              className="border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
            >
              <Download aria-hidden="true" size={17} /> 이미지 저장
            </Button>
          </div>
        </aside>
      </div>
    </div>
  );
}

function ShareRemaining({ expiresAt }: { expiresAt: string | null }) {
  const [remaining, setRemaining] = useState(
    expiresAt ? "계산 중" : "제한 없음",
  );

  useEffect(() => {
    const updateRemaining = () =>
      setRemaining(
        expiresAt
          ? formatDuration(
              Math.max(0, (Date.parse(expiresAt) - Date.now()) / 1000),
            )
          : "제한 없음",
      );
    updateRemaining();
    const timer = window.setInterval(updateRemaining, 1_000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);

  return remaining;
}

function About({
  autoStart,
  notificationsEnabled,
  onAutoStart,
  onNotificationsEnabled,
}: {
  autoStart: boolean;
  notificationsEnabled: boolean;
  onAutoStart: (enabled: boolean) => Promise<void>;
  onNotificationsEnabled: (enabled: boolean) => void;
}) {
  return (
    <div className="dd-about mx-auto max-w-2xl">
      <div className="dd-panel dd-about-card rounded-2xl border border-slate-200 bg-white p-7">
        <BrandMark />
        <h1 className="dd-about-title mt-6 text-2xl font-bold">
          DirectDrop 정보
        </h1>
        <p className="mt-1 text-sm text-slate-500">Version 0.1.3</p>
        <p className="dd-about-description mt-5 text-sm leading-6 text-slate-600">
          파일을 서버에 저장하지 않고 WebRTC P2P로 상대방 기기에 직접
          전송합니다.
        </p>
        <div className="dd-about-links mt-6 grid gap-3">
          <a
            href="https://share.dlfkd.dev"
            target="_blank"
            rel="noreferrer"
            className="flex min-h-11 items-center justify-between rounded-xl border border-slate-200 px-4 text-sm font-semibold hover:bg-slate-50"
          >
            <span className="flex items-center gap-2">
              <Link2 aria-hidden="true" size={17} /> 웹사이트
            </span>
            <span className="text-slate-500">share.dlfkd.dev</span>
          </a>
          <a
            href="https://github.com/HechoLP/directdrop/releases/latest"
            target="_blank"
            rel="noreferrer"
            className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-semibold hover:bg-slate-50"
          >
            <Download aria-hidden="true" size={17} /> 최신 버전 다운로드
          </a>
          <a
            href="https://github.com/HechoLP/directdrop/issues"
            target="_blank"
            rel="noreferrer"
            className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-semibold hover:bg-slate-50"
          >
            <AlertTriangle aria-hidden="true" size={17} /> 문제 신고
          </a>
        </div>
        <label className="dd-about-toggle mt-6 flex min-h-12 cursor-pointer items-center justify-between gap-4 border-t border-slate-200 pt-5 text-sm font-semibold">
          <span className="flex items-center gap-2">
            <Bell aria-hidden="true" size={17} /> 로그인 시 자동 시작
          </span>
          <input
            type="checkbox"
            checked={autoStart}
            onChange={(event) => void onAutoStart(event.target.checked)}
            className="dd-switch shrink-0"
          />
        </label>
        <label className="dd-about-toggle flex min-h-12 cursor-pointer items-center justify-between gap-4 text-sm font-semibold">
          <span className="flex items-center gap-2">
            <Bell aria-hidden="true" size={17} /> 전송 알림
          </span>
          <input
            type="checkbox"
            checked={notificationsEnabled}
            onChange={(event) => onNotificationsEnabled(event.target.checked)}
            className="dd-switch shrink-0"
          />
        </label>
      </div>
    </div>
  );
}

function ApprovalDialog({
  files,
  onAccept,
  onReject,
}: {
  files: PublicFile[];
  onAccept: () => void;
  onReject: () => void;
}) {
  return (
    <div
      className="dd-dialog-backdrop fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="approval-title"
    >
      <div className="dd-dialog w-full max-w-md rounded-2xl bg-white p-6">
        <ShieldCheck className="text-blue-700" aria-hidden="true" />
        <h2 id="approval-title" className="mt-4 text-xl font-bold">
          새 다운로드 요청
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          {files[0]?.name}
          {files.length > 1 ? ` 외 ${files.length - 1}개` : ""}
        </p>
        <div className="mt-6 grid grid-cols-2 gap-3">
          <Button
            onClick={onReject}
            className="border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
          >
            <X aria-hidden="true" size={17} /> 거절
          </Button>
          <Button
            onClick={onAccept}
            className="bg-blue-600 text-white hover:bg-blue-700"
          >
            <Check aria-hidden="true" size={17} /> 허용
          </Button>
        </div>
      </div>
    </div>
  );
}

function QrDialog({
  share,
  onClose,
  onSave,
}: {
  share: CreatedShare;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <div
      className="dd-dialog-backdrop fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-5"
      role="dialog"
      aria-modal="true"
      aria-label="QR 코드 크게 보기"
    >
      <div className="dd-dialog relative w-full max-w-lg rounded-2xl bg-white p-6">
        <button
          onClick={onClose}
          className="absolute right-3 top-3 grid size-11 cursor-pointer place-items-center rounded-xl hover:bg-slate-100"
          aria-label="닫기"
        >
          <X aria-hidden="true" size={20} />
        </button>
        <img
          src={share.qr}
          alt={`공유 링크 ${share.url} QR 코드`}
          className="mx-auto mt-5 aspect-square w-full max-w-sm"
        />
        <p className="mt-4 break-all text-center text-xs text-slate-500">
          {share.url}
        </p>
        <Button
          onClick={onSave}
          className="mt-5 w-full bg-blue-600 text-white hover:bg-blue-700"
        >
          <Download aria-hidden="true" size={17} /> QR 이미지 저장
        </Button>
      </div>
    </div>
  );
}
