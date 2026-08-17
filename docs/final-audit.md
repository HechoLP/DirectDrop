# DirectDrop v0.2.0 Final Audit

감사일: 2026-08-17

## 결론

**릴리스 및 운영 배포 상태: PASS**

DirectDrop v0.2.0의 Nearby 핵심 경로는 macOS arm64 한 대에서 서로 다른 bundle ID와 별도 앱 데이터 디렉터리를 사용하는 두 앱 인스턴스로 실제 검증했습니다. mDNS 발견, 인증서 고정 TLS, 6자리 상호 확인, 신뢰 저장, 수신 승인, 파일 스트리밍, 양쪽 완료 기록과 SHA-256 원본 일치를 확인했습니다.

GitHub 원격 CI, Apple Silicon·Intel macOS와 Windows installer 생성, 공개 checksum 검증, 운영 `share.dlfkd.dev` v0.2.0 배포와 배포 후 보안 검증을 완료했습니다. Apple Developer ID 서명과 공증은 사용자 요청에 따라 이번 릴리스 범위에서 제외했습니다.

## 감사 환경

| 항목           | 확인 범위                                                            |
| -------------- | -------------------------------------------------------------------- |
| OS             | macOS arm64                                                          |
| Desktop        | Tauri 2 release bundle 2개, 별도 identity/history/storage            |
| Nearby network | 같은 Mac의 loopback을 포함한 실제 OS mDNS browse와 native TCP/TLS    |
| Browser/server | workspace production build와 자동 테스트                             |
| Windows        | GitHub Windows runner의 fmt, Clippy, 21 Rust tests와 installer build |
| 물리 장치      | 서로 다른 물리 Mac/Windows 조합은 별도 후속 matrix 필요              |

## 자동 검증 결과

| 검증                                        | 결과               | 증거                                                                  |
| ------------------------------------------- | ------------------ | --------------------------------------------------------------------- |
| `pnpm check`                                | PASS               | lint, strict typecheck, 59 tests, desktop/web/server production build |
| `cargo fmt --check`                         | PASS               | Rust formatting                                                       |
| `cargo clippy --all-targets -- -D warnings` | PASS               | 모든 target, warning denied                                           |
| `cargo test --all-targets`                  | PASS               | 21 tests                                                              |
| `pnpm audit --prod --audit-level high`      | PASS               | 알려진 vulnerability 0                                                |
| `cargo audit`                               | PASS with warnings | vulnerability 0, 전이 의존성 유지보수/unsound warning 17건            |

`cargo audit` 경고는 Tauri의 Linux GTK3 계열 전이 의존성과 `proc-macro-error`, `unic-*`, `glib`에 관한 것입니다. 현재 audit은 취약점으로 분류하지 않았으며, upstream Tauri/WebKitGTK 의존성 갱신과 함께 계속 추적합니다.

## 실제 Nearby E2E

| 단계                                 | 결과                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------- |
| 별도 identity·certificate 생성       | PASS                                                                      |
| `_directdrop._tcp.local` 광고와 발견 | PASS                                                                      |
| 6자리 pairing code 양쪽 일치         | PASS                                                                      |
| pinned TLS와 paired HMAC 인증        | PASS                                                                      |
| 수신자 파일 제안 표시·수동 승인      | PASS                                                                      |
| `README.md` 5,835 bytes 전송         | PASS                                                                      |
| 송신/수신 history `COMPLETED`        | PASS                                                                      |
| 원본/수신 SHA-256 일치               | PASS (`c961d78751ce1a82988ad7bab0fbd76deaf9050874cd932cf2532c7975b2601d`) |
| 테스트 trust/data/history 정리       | PASS                                                                      |

이 검증 중 동기 Tauri command에서 `tokio::spawn`을 호출해 main thread가 panic하던 실제 결함을 발견했습니다. outbound task를 `tauri::async_runtime::spawn`으로 실행하도록 수정하고 동일 E2E를 다시 통과했습니다.

## Nearby 기능 감사

| 기능                     | 결과 | 범위                                                            |
| ------------------------ | ---- | --------------------------------------------------------------- |
| Persistent identity      | PASS | UUID, self-signed cert/key, Unix `0600`, atomic backup          |
| Device discovery         | PASS | mDNS browse/advertise, bounded TXT metadata, local address 제한 |
| Secure pairing           | PASS | 6자리 code, certificate pin, HMAC proof, trust revoke           |
| File/folder queue        | PASS | 다중 파일, 폴더, 빈 파일, symlink 거부                          |
| Streaming integrity      | PASS | 1 MiB bounded chunks, chunk SHA-256, exact offset ACK           |
| Pause/resume/cancel      | PASS | protocol/state/unit tests; physical interruption soak는 후속    |
| Retry/resume persistence | PASS | manifest hash, partial offset, 최대 3회 재시도                  |
| Receive safety           | PASS | 수동 승인 기본, partial 격리, non-overwrite 이동                |
| History/settings         | PASS | 송수신 내역, 받은 파일, 저장 위치, trust 관리                   |

## 보안 결과

| 심각도   | 남은 수 |
| -------- | ------: |
| CRITICAL |       0 |
| HIGH     |       0 |
| MEDIUM   |       6 |
| LOW      |       2 |

상세 threat model은 [security-audit.md](security-audit.md)에 기록했습니다. 주요 남은 위험은 미서명 installer 경고, 서로 다른 물리 OS/공유기 조합의 제한된 실측, public Wi-Fi 오인 가능성, 의도적으로 비활성화한 Browser LAN/clipboard 기능입니다.

## 패키지와 배포 정책

### macOS

- Apple Silicon과 Intel DMG를 GitHub Actions에서 각각 생성합니다.
- Developer ID signing/notarization은 이번 범위에서 제외합니다.
- 사용자는 Gatekeeper가 차단할 때 아래 명령으로 quarantine을 제거한 뒤 실행할 수 있습니다.

```bash
xattr -dr com.apple.quarantine /Applications/DirectDrop.app
open /Applications/DirectDrop.app
```

### Windows

- Windows x64 NSIS EXE와 MSI를 GitHub Actions에서 생성합니다.
- Windows code signing이 없으므로 SmartScreen 경고가 표시될 수 있습니다.

### Artifact 무결성

- 공개 릴리스: <https://github.com/HechoLP/DirectDrop/releases/tag/v0.2.0>
- GitHub CI `31990090144`: web/server, macOS native, Windows native PASS
- Release workflow `31990446156`: ARM DMG, Intel DMG, Windows NSIS EXE/MSI, checksum PASS
- 공개 installer 4개를 다시 다운로드해 `SHA256SUMS.txt`와 모두 일치함을 확인했습니다.
- 두 DMG는 `hdiutil verify` PASS, 내부 binary는 각각 arm64와 x86_64, ad-hoc signature와 Local Network/Bonjour declaration을 확인했습니다.
- Windows asset은 NSIS PE executable과 x64 MSI installer 형식을 확인했습니다.

### Production

- `https://share.dlfkd.dev/health`: version `0.2.0`, `fileStorage: false`
- HTTPS, API, WSS, share registration/presence/cleanup 실제 검증 PASS
- 허용되지 않은 WebSocket Origin은 code `1008`, `origin not allowed`로 차단
- CSP, MIME, frame, referrer, permissions, noindex response header 확인
- 공개 랜딩의 JS/CSS asset HTTP 200과 immutable cache 확인
- 브라우저 1280 px viewport에서 `scrollWidth === innerWidth` 확인
- 이전 runtime bundle은 local rollback backup으로 보존

## 남은 검증 범위

- 서로 다른 두 물리 장치의 macOS/Windows 교차 전송
- 1 GiB 이상, 느린 디스크, sleep/wake, 장시간 재연결 soak
- Windows 설치·제거와 SmartScreen 실제 화면
- Chrome/Edge/Safari/Firefox Share Link 실제 대용량 저장
- 서로 다른 네트워크와 브라우저 환경의 장기 운영 관찰

이 항목들은 구현 누락을 뜻하지 않으며, 현재 로컬 검증을 넘어서는 release/physical evidence입니다.

## Release Gate

| Gate                              | 상태                    |
| --------------------------------- | ----------------------- |
| CRITICAL/HIGH = 0                 | PASS                    |
| Workspace/Rust 자동 검증          | PASS                    |
| 실제 Nearby mDNS→TLS→전송→hash    | PASS                    |
| macOS arm64 local release app     | PASS                    |
| 현재 commit GitHub CI             | PASS                    |
| ARM/Intel macOS/Windows artifact  | PASS                    |
| 공개 SHA256/DMG/installer 검증    | PASS                    |
| 운영 `share.dlfkd.dev` v0.2.0     | PASS                    |
| Developer ID signing/notarization | 사용자 요청에 따라 제외 |

**최종 판정: DirectDrop v0.2.0 릴리스와 운영 배포 완료. Developer ID 서명·공증만 요청 범위에서 제외.**
