# Changelog

모든 주요 변경 사항은 이 파일에 기록합니다. 버전은 Semantic Versioning을 따릅니다.

## 0.2.0 - 2026-08-17

### Added

- `DirectDrop` Share Link와 `LAN Share` Nearby를 분리한 최상위 제품 카테고리
- 두 카테고리에서 독립적으로 유지되는 파일 선택 큐와 drag-and-drop 동작
- `_directdrop._tcp.local` mDNS 기반 실제 Nearby 기기 검색과 native TCP listener
- persistent random device identity, self-signed certificate와 6자리 상호 확인 페어링
- 인증서 고정 TLS 1.2/1.3와 paired device HMAC 상호 인증
- 여러 파일·폴더·빈 파일의 1 MiB bounded native streaming
- 수신 전 승인, 기기별 자동 수신 opt-in, 신뢰 기기 해제
- chunk SHA-256, exact offset ACK, 연결 중단 후 partial offset resume
- 보내기 일시정지·재개·취소·이어보내기와 속도·ETA 표시
- Nearby 전송 내역·받은 파일·저장 경로·기기 이름 설정
- macOS Local Network/Bonjour usage declaration
- Nearby 아키텍처·보안·OS 권한·테스트 매트릭스 문서

### Security

- private/link-local address만 허용하고 공인 IP 연결 거부
- protocol/control/chunk/file/path 크기 제한, 16 concurrent connection과 IP rate limit
- traversal·drive·backslash·control/bidi·Windows reserved path 및 symbolic link 거부
- identity/private key/shared secret을 WebView에 노출하지 않고 Unix `0600`으로 저장
- resume manifest hash 검증, scoped partial cleanup, destination non-overwrite
- Browser LAN HTTP listener와 clipboard watcher는 안전한 opt-in 설계 전까지 비활성 유지

### Changed

- 공유 목록을 링크·파일 수·다운로드 수·남은 시간만 표시하는 요약 행으로 단순화
- 공유 항목을 클릭하면 QR, 전체 파일과 전송 현황이 있는 상세 화면으로 이동하도록 분리
- 웹사이트에 Nearby와 Share Link의 두 직접 전송 경로, OS별 다운로드·권한 안내 추가
- macOS Developer ID 서명·공증은 사용자 요청에 따라 제외하고 ad-hoc signing 유지

### Fixed

- 일반적인 다중 파일 다운로드에서 Chrome의 보호 폴더 선택창을 열지 않고 브라우저 기본 다운로드 방식으로 저장
- 대용량 저장 위치가 보호 폴더로 거부될 때 새 전용 하위 폴더를 안내하는 복구 메시지 추가
- 현재 공유/전송 중 종료 경고에 Nearby active transfer 포함
- 동기 Tauri command에서 Nearby outbound task를 시작할 때 Tokio reactor가 없어 앱이 종료되던 문제 수정
- Nearby 기기별 보내기 버튼에 고유 접근성 이름을 추가해 보조 기술에서 대상 기기를 정확히 구분
- Windows에서 Unix 전용 권한 인자가 사용되지 않아 네이티브 CI가 실패하던 교차 플랫폼 경고 수정

## 0.1.4 - 2026-08-17

### Added

- 업로드 화면과 공유 목록을 오갈 수 있는 상단 내비게이션
- 활성 공유 링크, 업로드한 파일, 개별·전체 용량을 확인하는 공유 목록
- 현재 링크를 유지한 채 새 업로드 화면으로 이동하고, 새 파일 선택 시에만 기존 공유를 종료하는 확인 흐름

### Changed

- Apple Silicon과 Intel Mac용 릴리스 파일명을 쉽게 구분하도록 개선
- macOS 앱 번들에 ad-hoc 서명을 적용하고 릴리스 안내에 Gatekeeper 해제·실행 명령 추가

## 0.1.3 - 2026-08-17

### Added

- 활성 공유 링크와 공유 중인 모든 파일을 함께 확인하는 컴팩트 목록
- 파일별 이름·크기, 전체 용량, 다운로드 수, 초 단위 남은 시간 표시

### Changed

- 최소 앱 창 600×620부터 준비·설정·활성 공유 화면을 페이지 스크롤 없이 표시
- 작은 창에서는 설정을 2열로 재배치하고 보조 설명을 줄여 핵심 조작 영역 유지

### Fixed

- 설정한 만료 시각이 지나면 활성 공유를 즉시 화면에서 제거하고 연결·로컬 등록·서버 메타데이터 정리
- 링크 복사 버튼이 카드 배경 규칙에 가려지던 활성 공유 화면 스타일 충돌

## 0.1.2 - 2026-08-17

### Changed

- Apple과 토스 스타일을 참고한 밝고 절제된 데스크톱 UI
- 회백색 배경, 흰 표면, 단일 블루 포인트 기반의 일관된 디자인 토큰
- 큰 영문 상태 문구를 짧은 한국어 안내와 컴팩트한 4단계 진행 표시로 교체
- 선택된 빠른 설정, 토글, 입력 포커스, 오류 상태의 시각 피드백 개선
- 장식용 파티클 캔버스와 지속 애니메이션 제거

### Accessibility

- 44px 이상 조작 영역, 명확한 키보드 포커스, reduced-motion 지원 유지
- 작은 창에서 진행 단계를 2열로 재배치하고 가로 스크롤 제거

## 0.1.1 - 2026-08-16

### Changed

- v0 AI Animation States에서 영감을 받은 상태 중심 데스크톱 UI
- 파일 선택, 준비, 연결, 전송, 완료 상태별 파티클 패턴과 색상 전환
- 반투명 작업 패널, 글래스 상태 레일, 큰 상태 타이포그래피
- macOS WebView용 투명 캔버스·정적 파티클 폴백과 reduced-motion 지원

### Fixed

- 네이티브 파일 선택 후 작업 화면이 중간 스크롤 위치에 남는 문제

## 0.1.0 - 2026-08-16

### Added

- WebRTC RTCDataChannel 직접 P2P 파일 전송
- `share.dlfkd.dev` 임시 공유 링크와 QR 공유
- 1~1000회 다운로드 제한, 만료, 비밀번호, 승인 모드
- 여러 파일의 고정 크기 청크 스트리밍과 backpressure
- 대용량 브라우저 디스크 스트리밍 저장과 기능 감지
- Tauri/Rust read-only 로컬 파일 레지스트리, Tray, 자동 시작, 알림
- 반응형 랜딩·수신·송신 UI
- Cloudflare Tunnel 운영 구성, GitHub CI 및 Windows/macOS 릴리스 자동화
