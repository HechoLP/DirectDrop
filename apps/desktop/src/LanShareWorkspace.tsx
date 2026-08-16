import {
  ArrowRight,
  CircleDot,
  FilePlus2,
  Files,
  Network,
  Radar,
  ShieldCheck,
  Trash2,
  WifiOff,
} from "lucide-react";
import type { PublicFile } from "@directdrop/protocol";
import { formatBytes } from "@directdrop/shared";
import { Button, StatusPill } from "@directdrop/ui";

export function LanShareWorkspace({
  files,
  onSelectFiles,
  onRemoveFile,
}: {
  files: PublicFile[];
  onSelectFiles: () => void;
  onRemoveFile: (file: PublicFile) => void;
}) {
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);

  return (
    <div className="dd-lan-screen">
      <div className="dd-category-toolbar">
        <div className="dd-category-title">
          <span className="dd-category-icon is-lan">
            <Network aria-hidden="true" size={19} />
          </span>
          <span>
            <strong>LAN Share</strong>
            <small>같은 네트워크 전송</small>
          </span>
        </div>
        <StatusPill tone="neutral">
          <CircleDot aria-hidden="true" size={12} /> Phase 1
        </StatusPill>
      </div>

      <section className="dd-lan-heading" aria-labelledby="lan-share-title">
        <div>
          <p className="dd-kicker">NEARBY · OFFLINE READY</p>
          <h1 id="lan-share-title">가까운 기기로 바로 보내세요</h1>
          <p>
            LAN Share는 같은 Wi-Fi나 Ethernet에 연결된 기기끼리 인터넷 없이
            전송하는 독립 모드입니다.
          </p>
        </div>
        <div className="dd-lan-offline-note">
          <WifiOff aria-hidden="true" size={19} />
          <span>
            <strong>인터넷 불필요</strong>
            외부 서버를 사용하지 않아요
          </span>
        </div>
      </section>

      <div className="dd-lan-grid">
        <section
          className="dd-panel dd-lan-devices"
          aria-labelledby="devices-title"
        >
          <div className="dd-lan-panel-heading">
            <div>
              <p className="dd-kicker">NEARBY DEVICES</p>
              <h2 id="devices-title">주변 기기</h2>
            </div>
            <span className="dd-lan-device-count">0대</span>
          </div>
          <div className="dd-lan-empty">
            <span className="dd-lan-empty-icon">
              <Radar aria-hidden="true" size={28} />
            </span>
            <strong>기기 검색은 다음 단계에서 연결돼요</strong>
            <p>
              mDNS 기반 탐색 모듈이 준비되면 같은 LAN의 DirectDrop 기기가 이곳에
              표시됩니다.
            </p>
          </div>
          <div className="dd-lan-inactive">
            <ShieldCheck aria-hidden="true" size={17} />
            <span>
              현재는 discovery, LAN listener, 수신 포트를 실행하지 않습니다.
            </span>
          </div>
        </section>

        <section
          className="dd-panel dd-lan-files"
          aria-labelledby="lan-files-title"
        >
          <div className="dd-lan-panel-heading">
            <div>
              <p className="dd-kicker">SEND QUEUE</p>
              <h2 id="lan-files-title">보낼 파일</h2>
            </div>
            {files.length > 0 && (
              <span className="dd-lan-file-total">
                {files.length}개 · {formatBytes(totalSize)}
              </span>
            )}
          </div>

          {files.length === 0 ? (
            <button className="dd-lan-file-picker" onClick={onSelectFiles}>
              <span>
                <FilePlus2 aria-hidden="true" size={24} />
              </span>
              <strong>LAN Share용 파일 선택</strong>
              <small>이 화면으로 파일을 끌어다 놓아도 됩니다.</small>
            </button>
          ) : (
            <div className="dd-lan-selected">
              <ul>
                {files.map((file) => (
                  <li key={file.id}>
                    <span className="dd-file-icon">
                      <Files aria-hidden="true" size={18} />
                    </span>
                    <span className="dd-lan-file-copy">
                      <strong title={file.name}>{file.name}</strong>
                      <small>{formatBytes(file.size)}</small>
                    </span>
                    <button
                      type="button"
                      onClick={() => onRemoveFile(file)}
                      aria-label={`${file.name} 제거`}
                      className="dd-icon-button"
                    >
                      <Trash2 aria-hidden="true" size={17} />
                    </button>
                  </li>
                ))}
              </ul>
              <Button
                onClick={onSelectFiles}
                className="dd-secondary-button border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
              >
                <FilePlus2 aria-hidden="true" size={17} /> 파일 추가
              </Button>
            </div>
          )}

          <button
            type="button"
            className="dd-lan-send-disabled"
            disabled
            aria-describedby="lan-send-help"
          >
            기기를 선택하면 보낼 수 있어요
            <ArrowRight aria-hidden="true" size={17} />
          </button>
          <p id="lan-send-help" className="dd-lan-send-help">
            Phase 2에서 주변 기기 검색과 연결됩니다.
          </p>
        </section>
      </div>
    </div>
  );
}
