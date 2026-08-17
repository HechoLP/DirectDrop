import {
  ArrowLeft,
  CircleDot,
  Laptop,
  Monitor,
  Pause,
  Play,
  Radar,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldCheck,
  Smartphone,
  Square,
  WifiOff,
} from "lucide-react";
import type { PublicFile } from "@directdrop/protocol";
import { formatBytes, formatDuration } from "@directdrop/shared";
import { ProgressBar, StatusPill } from "@directdrop/ui";
import type {
  NearbyDevice,
  NearbyStatus,
  NearbyTransferSnapshot,
} from "./tauri";

export function LanShareWorkspace({
  files,
  status,
  transfers,
  busyDeviceId,
  onBack,
  onRefresh,
  onPair,
  onSend,
  onPause,
  onResume,
  onRetry,
  onCancel,
}: {
  files: PublicFile[];
  status?: NearbyStatus;
  transfers: NearbyTransferSnapshot[];
  busyDeviceId?: string;
  onBack: () => void;
  onRefresh: () => void;
  onPair: (device: NearbyDevice) => void;
  onSend: (device: NearbyDevice) => void;
  onPause: (transferId: string) => void;
  onResume: (transferId: string) => void;
  onRetry: (transferId: string) => void;
  onCancel: (transferId: string) => void;
}) {
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  const devices = status?.devices ?? [];
  const enabled = status?.preferences.enabled ?? false;
  const activeTransfers = transfers.filter((transfer) =>
    ["WAITING", "CONNECTING", "TRANSFERRING", "PAUSED", "FAILED"].includes(
      transfer.status,
    ),
  );

  return (
    <section
      className="dd-flow-page dd-nearby-page"
      aria-labelledby="nearby-title"
    >
      <button type="button" className="dd-back-button" onClick={onBack}>
        <ArrowLeft aria-hidden="true" size={17} />
        파일 선택으로
      </button>

      <div className="dd-flow-heading">
        <span className="dd-flow-icon">
          <Radar aria-hidden="true" size={22} />
        </span>
        <div>
          <h2 id="nearby-title">Nearby로 보내기</h2>
          <p>같은 네트워크의 기기에 TLS로 암호화해 직접 전송합니다.</p>
        </div>
        <StatusPill tone={enabled ? "success" : "warning"}>
          <CircleDot aria-hidden="true" size={12} />
          {enabled ? `수신 중 · ${status?.listeningPort ?? "…"}` : "꺼짐"}
        </StatusPill>
      </div>

      <div className="dd-nearby-summary">
        <span className="dd-file-icon">
          <Laptop aria-hidden="true" size={18} />
        </span>
        <span>
          <strong>보낼 파일 {files.length}개</strong>
          <small>{formatBytes(totalSize)}</small>
        </span>
        <ShieldCheck aria-hidden="true" size={18} />
      </div>

      <section className="dd-device-browser" aria-labelledby="devices-title">
        <header>
          <div>
            <h3 id="devices-title">주변 기기</h3>
            <p>mDNS로 발견한 실제 DirectDrop 기기만 표시됩니다.</p>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            aria-label="주변 기기 새로고침"
          >
            <RefreshCw aria-hidden="true" size={17} />
            새로고침
          </button>
        </header>

        {!enabled || devices.length === 0 ? (
          <div className="dd-device-placeholder" aria-live="polite">
            <span>
              {enabled ? (
                <Radar aria-hidden="true" size={31} />
              ) : (
                <WifiOff aria-hidden="true" size={31} />
              )}
            </span>
            <h4>
              {enabled
                ? "같은 네트워크의 기기를 기다리고 있습니다."
                : "설정에서 Nearby를 켜 주세요."}
            </h4>
            <p>
              양쪽 기기에서 DirectDrop Nearby를 켜고 같은 Wi-Fi 또는 Ethernet에
              연결하세요. 인터넷이나 외부 서버는 필요하지 않습니다.
            </p>
            <div className="dd-device-types" aria-hidden="true">
              <Monitor size={18} />
              <Laptop size={18} />
              <Smartphone size={18} />
            </div>
          </div>
        ) : (
          <div className="dd-device-grid" aria-live="polite">
            {devices.map((device) => (
              <article className="dd-device-card" key={device.deviceId}>
                <span className="dd-device-card-icon">
                  {device.platform === "windows" ? (
                    <Monitor aria-hidden="true" size={23} />
                  ) : (
                    <Laptop aria-hidden="true" size={23} />
                  )}
                </span>
                <span className="dd-device-card-copy">
                  <strong>{device.deviceName}</strong>
                  <small>
                    {platformLabel(device.platform)} · {device.address}
                  </small>
                  <small className={device.paired ? "is-trusted" : ""}>
                    {device.paired ? "✓ 신뢰하는 기기" : "인증 필요"}
                  </small>
                </span>
                <button
                  type="button"
                  aria-label={
                    device.paired
                      ? `${device.deviceName}에게 Nearby로 보내기`
                      : `${device.deviceName}와 페어링`
                  }
                  disabled={busyDeviceId === device.deviceId}
                  onClick={() =>
                    device.paired ? onSend(device) : onPair(device)
                  }
                >
                  {busyDeviceId === device.deviceId ? (
                    <RefreshCw
                      className="dd-spin"
                      aria-hidden="true"
                      size={15}
                    />
                  ) : device.paired ? (
                    <Send aria-hidden="true" size={15} />
                  ) : (
                    <ShieldCheck aria-hidden="true" size={15} />
                  )}
                  {device.paired ? "보내기" : "페어링"}
                </button>
              </article>
            ))}
          </div>
        )}

        <div className="dd-nearby-offline-note">
          <WifiOff aria-hidden="true" size={18} />
          <span>
            <strong>외부 서버를 사용하지 않습니다.</strong>
            파일 데이터와 페어링 키는 이 로컬 네트워크 밖으로 전송되지 않습니다.
          </span>
        </div>
      </section>

      {activeTransfers.length > 0 && (
        <section
          className="dd-nearby-transfers"
          aria-labelledby="nearby-transfers-title"
        >
          <header>
            <h3 id="nearby-transfers-title">Nearby 전송</h3>
            <span>{activeTransfers.length}개</span>
          </header>
          <div>
            {activeTransfers.map((transfer) => {
              const progress = transfer.totalBytes
                ? (transfer.transferredBytes / transfer.totalBytes) * 100
                : transfer.status === "COMPLETED"
                  ? 1
                  : 0;
              return (
                <article className="dd-nearby-transfer" key={transfer.id}>
                  <div className="dd-nearby-transfer-title">
                    <span>
                      <strong>
                        {transfer.direction === "SEND" ? "↑" : "↓"}{" "}
                        {transfer.deviceName}
                      </strong>
                      <small>
                        {transfer.files[0]?.name ?? "파일"}
                        {transfer.files.length > 1
                          ? ` 외 ${transfer.files.length - 1}개`
                          : ""}
                      </small>
                    </span>
                    <StatusPill
                      tone={
                        transfer.status === "FAILED"
                          ? "danger"
                          : transfer.status === "PAUSED"
                            ? "warning"
                            : "success"
                      }
                    >
                      {statusLabel(transfer.status)}
                    </StatusPill>
                  </div>
                  <ProgressBar value={progress} />
                  <div className="dd-nearby-transfer-meta">
                    <span>
                      {formatBytes(transfer.transferredBytes)} /{" "}
                      {formatBytes(transfer.totalBytes)}
                    </span>
                    <span>
                      {transfer.bytesPerSecond > 0
                        ? `${formatBytes(transfer.bytesPerSecond)}/s`
                        : "—"}
                      {transfer.etaSeconds !== null
                        ? ` · ${formatDuration(transfer.etaSeconds)}`
                        : ""}
                    </span>
                  </div>
                  {transfer.error && <p role="alert">{transfer.error}</p>}
                  <div className="dd-nearby-transfer-actions">
                    {transfer.status === "TRANSFERRING" &&
                      transfer.direction === "SEND" && (
                        <button
                          type="button"
                          onClick={() => onPause(transfer.id)}
                        >
                          <Pause aria-hidden="true" size={14} /> 일시정지
                        </button>
                      )}
                    {transfer.status === "PAUSED" &&
                      transfer.direction === "SEND" && (
                        <button
                          type="button"
                          onClick={() => onResume(transfer.id)}
                        >
                          <Play aria-hidden="true" size={14} /> 계속
                        </button>
                      )}
                    {transfer.status === "FAILED" &&
                      transfer.direction === "SEND" && (
                        <button
                          type="button"
                          onClick={() => onRetry(transfer.id)}
                        >
                          <RotateCcw aria-hidden="true" size={14} /> 이어보내기
                        </button>
                      )}
                    {!["FAILED", "CANCELLED", "COMPLETED"].includes(
                      transfer.status,
                    ) && (
                      <button
                        type="button"
                        onClick={() => onCancel(transfer.id)}
                      >
                        <Square aria-hidden="true" size={13} /> 취소
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}
    </section>
  );
}

function platformLabel(platform: string) {
  if (platform === "macos") return "macOS";
  if (platform === "windows") return "Windows";
  if (platform === "linux") return "Linux";
  return platform;
}

function statusLabel(status: NearbyTransferSnapshot["status"]) {
  return {
    WAITING: "승인 대기",
    CONNECTING: "연결 중",
    TRANSFERRING: "전송 중",
    PAUSED: "일시정지",
    COMPLETED: "완료",
    FAILED: "연결 중단",
    CANCELLED: "취소됨",
  }[status];
}
