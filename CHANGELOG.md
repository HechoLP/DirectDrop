# Changelog

모든 주요 변경 사항은 이 파일에 기록합니다. 버전은 Semantic Versioning을 따릅니다.

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
