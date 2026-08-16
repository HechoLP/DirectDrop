# DirectDrop

**Direct files. No cloud.**

DirectDrop은 클라우드에 파일을 올리지 않고, 내 컴퓨터에서 상대방에게 직접 파일을 전송하는 P2P 파일 공유 프로그램입니다. 데스크톱 앱이 임시 링크와 QR 코드를 만들고, 수신자는 프로그램 설치 없이 브라우저에서 파일을 저장합니다.

## 핵심 기능

- WebRTC RTCDataChannel 기반 직접 P2P 파일 전송
- 중앙 서버·Cloudflare R2·S3에 사용자 파일을 저장하지 않는 구조
- 임시 공유 링크와 QR 코드
- 1~1000회 또는 무제한 다운로드, 만료 시간, 비밀번호 보호
- 자동 승인 또는 요청별 수동 승인
- 여러 파일과 256 KiB 청크 스트리밍, DataChannel backpressure
- Windows 및 macOS 데스크톱 앱, 모바일 우선 브라우저 수신 화면
- SQLite 기반 서버 메타데이터와 송신자 전용 로컬 경로 레지스트리

## 다운로드

[GitHub Releases의 최신 DirectDrop 다운로드](https://github.com/HechoLP/directdrop/releases/latest)

Windows 설치 프로그램은 현재 코드 서명되지 않았고 macOS 앱은 ad-hoc 서명 상태라 SmartScreen 또는 Gatekeeper가 경고할 수 있습니다. 릴리스의 `SHA256SUMS.txt`와 저장소 소스를 확인하세요.

macOS에서 DirectDrop을 `Applications` 폴더로 복사한 뒤 손상되었다는 경고가 나오면 터미널에서 아래 명령을 실행하세요.

```bash
xattr -dr com.apple.quarantine /Applications/DirectDrop.app
open /Applications/DirectDrop.app
```

## 전송 구조

```text
Sender Desktop ── signaling ──▶ share.dlfkd.dev ◀── signaling ── Receiver Browser
Sender Desktop ═══════════════ WebRTC file data ═══════════════▶ Receiver Browser
```

Cloudflare Tunnel은 랜딩 페이지, API, WebSocket signaling만 전달합니다. 실제 파일 바이트는 Tunnel이나 DirectDrop 서버를 통과하지 않습니다.

## 요구 사항과 제한

- 송신자의 DirectDrop 앱이 온라인이어야 합니다.
- 기본 구성은 STUN을 사용하는 Direct P2P 전용입니다. 일부 NAT·방화벽 환경에서는 연결이 실패할 수 있습니다.
- TURN은 선택 사항이며 명시적으로 설정하고 공유에서 Relay를 허용한 경우에만 사용합니다. 서버 업로드 fallback은 없습니다.
- 대용량 디스크 스트리밍 저장은 File System Access API가 있는 최신 Chrome/Edge에서 가장 잘 동작합니다. 자세한 내용은 [브라우저 지원 문서](docs/browser-support.md)를 참고하세요.
- 현재 빌드는 서명·공증되지 않았습니다.

## 로컬 개발

필수 도구는 Node.js 22+, pnpm 11+, Rust stable, Tauri 2 시스템 의존성입니다.

```bash
pnpm install
cp .env.example .env
pnpm build
pnpm --filter @directdrop/server start
```

웹과 서버 개발 모드:

```bash
pnpm dev
```

Tauri 개발 모드:

```bash
pnpm dev:desktop
```

전체 검증:

```bash
pnpm check
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

## 설정

모든 공개 URL, STUN/TURN, cleanup 동작은 환경변수로 분리되어 있습니다. 비밀값 없이 제공되는 [.env.example](.env.example)을 기준으로 설정하세요. 운영 구조는 [architecture.md](docs/architecture.md), Tunnel 재구성은 [cloudflare-setup.md](docs/cloudflare-setup.md)를 참고하세요.

## 저장소 구조

```text
apps/desktop   Tauri + React 송신 앱
apps/web       React 브라우저 랜딩/수신 화면
apps/server    Fastify API + WebSocket signaling + SQLite
packages/      protocol, shared, UI 공통 패키지
docs/          운영·아키텍처·테스트 문서
```

MIT License
