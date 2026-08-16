import {
  ArrowLeft,
  CircleDot,
  Laptop,
  Monitor,
  Radar,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  WifiOff,
} from "lucide-react";
import type { PublicFile } from "@directdrop/protocol";
import { formatBytes } from "@directdrop/shared";
import { StatusPill } from "@directdrop/ui";

export function LanShareWorkspace({
  files,
  onBack,
}: {
  files: PublicFile[];
  onBack: () => void;
}) {
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);

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
          <h2 id="nearby-title">주변 기기 찾기</h2>
          <p>같은 네트워크에서 DirectDrop을 실행 중인 기기를 찾습니다.</p>
        </div>
        <StatusPill tone="neutral">
          <CircleDot aria-hidden="true" size={12} />
          Phase 1
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
            <p>검색된 실제 기기만 표시됩니다.</p>
          </div>
          <button type="button" disabled aria-label="주변 기기 새로고침">
            <RefreshCw aria-hidden="true" size={17} />
            새로고침
          </button>
        </header>

        <div className="dd-device-placeholder" aria-live="polite">
          <span>
            <Radar aria-hidden="true" size={31} />
          </span>
          <h4>아직 검색된 기기가 없습니다.</h4>
          <p>
            현재 버전은 Nearby 화면과 파일 큐까지 제공합니다. mDNS 탐색과 실제
            LAN 전송은 다음 구현 단계에서 연결됩니다.
          </p>
          <div className="dd-device-types" aria-hidden="true">
            <Monitor size={18} />
            <Laptop size={18} />
            <Smartphone size={18} />
          </div>
        </div>

        <div className="dd-nearby-offline-note">
          <WifiOff aria-hidden="true" size={18} />
          <span>
            <strong>외부 서버를 사용하지 않습니다.</strong>
            Nearby 연결은 같은 로컬 네트워크 안에서만 동작합니다.
          </span>
        </div>
      </section>

      <button
        type="button"
        className="dd-primary-action dd-send-device"
        disabled
      >
        기기를 선택하면 보낼 수 있어요
      </button>
    </section>
  );
}
