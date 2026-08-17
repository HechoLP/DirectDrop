# DirectDrop v0.2.0 Final Security Audit

감사일: 2026-08-17

감사 기준 커밋: `7ea5a97` (`2c1e781` 서버 보안 수정 포함)

## 결론

**판정: READY WITH KNOWN LIMITATIONS**

이번 최종 감사에서 CRITICAL/HIGH 취약점은 확인되지 않았습니다. 운영 또는 장시간 사용에서 문제가 될 수 있는 MEDIUM 8건과 LOW 1건을 재현하거나 코드 경로로 확인해 모두 수정했습니다. 서버 수정은 `share.dlfkd.dev` 운영 환경에 반영했고, 만료·중지된 공유 메타데이터도 백업 후 자동 정리했습니다.

Apple Developer ID 서명·공증은 사용자 요청에 따라 범위에서 제외합니다. 서로 다른 물리 Mac/Windows 장치, 여러 공유기, 1 GiB 이상 파일의 장시간 전송은 별도 실장비 매트릭스가 남아 있습니다.

## 발견 및 조치

| ID   | 심각도 | 발견한 문제                                                                                                            | 조치                                                                          | 검증                                                      |
| ---- | ------ | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------- |
| F-01 | MEDIUM | Cloudflare Tunnel 뒤 모든 사용자가 loopback IP로 집계되어 한 사용자의 요청이 전체 사용자의 rate limit을 소진할 수 있음 | loopback reverse proxy만 신뢰하고 실제 client IP별 bucket 분리                | 한 IP 429 후 다른 IP 404 유지 테스트                      |
| F-02 | MEDIUM | 만료·중지·다운로드 한도 도달 공유가 파일명과 크기를 계속 노출                                                          | terminal 상태에서 파일 목록·크기를 숨기고 새 password grant 거부              | 만료 파일명 비노출 및 410 테스트                          |
| F-03 | MEDIUM | 조회되지 않은 ACTIVE row는 시간이 지나도 cleanup 대상이 되지 않아 메타데이터가 영구 잔존                               | `expires_at <= now`를 cleanup 조건에 포함하고 운영 cleanup 활성화             | 운영 17 share/19 file row → 0/0, 사전 DB 백업 무결성 PASS |
| F-04 | MEDIUM | WebSocket message rate limit은 있었지만 장기 연결 수 상한이 없어 socket 고갈 가능                                      | 전역 1,000개, IP당 16개 active signaling 연결 상한                            | 17번째 연결이 1013으로 종료되는 통합 테스트               |
| F-05 | MEDIUM | mDNS device/service map이 무제한 증가해 같은 LAN 공격자가 메모리를 소모할 수 있음                                      | device 256, service name 512 상한과 오래된 unpaired 항목 eviction             | discovery flood 회귀 테스트                               |
| F-06 | MEDIUM | 완료·실패·취소된 Nearby 전송 기록이 Rust/React 메모리에서 무제한 누적                                                  | 양쪽 모두 terminal history 200개 제한, active 전송 보존                       | Rust와 Vitest history flood 테스트                        |
| F-07 | MEDIUM | 공유 종료 API 실패를 무시하고 control key와 UI 상태를 먼저 지워 링크를 다시 종료할 수 없었음                           | 서버 DELETE 성공/404 확인 후에만 로컬 상태 제거, 실패 시 재시도 상태 유지     | lint/typecheck/unit/build 및 failure path 검토            |
| F-08 | MEDIUM | macOS 앱 메뉴의 Quit가 tray 종료 확인을 우회해 활성 링크가 남을 수 있음                                                | native `ExitRequested`를 가로채 활성 작업이 있으면 WebView 확인 흐름으로 전달 | 실제 앱 조작으로 재현, Rust exit gate 테스트              |
| F-09 | LOW    | 운영 HTTPS 응답에 HSTS가 없음                                                                                          | `Strict-Transport-Security: max-age=31536000` 추가                            | 로컬/운영 header 테스트                                   |

## 자동 검증 결과

| 검증                                                       | 결과                                                                         |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `pnpm check`                                               | PASS — lint, strict typecheck, 69 tests, desktop/web/server production build |
| `cargo fmt --check`                                        | PASS                                                                         |
| `cargo clippy --all-targets --all-features -- -D warnings` | PASS                                                                         |
| `cargo test --all-targets --all-features`                  | PASS — 24 tests                                                              |
| `pnpm audit --prod --audit-level high`                     | PASS — 알려진 취약점 0                                                       |
| `cargo audit`                                              | PASS with warnings — 취약점 0, 허용 경고 17                                  |
| `gitleaks git --all --redact`                              | PASS — 32 commits, secret 0                                                  |
| public verify                                              | PASS — HTTPS, API, WSS, registration, presence                               |
| macOS arm64 app/DMG                                        | PASS — ad-hoc code signature valid, DMG checksum valid                       |

`cargo audit`의 17개 경고는 Tauri lockfile에 포함된 Linux GTK3 계열, `proc-macro-error`, `unic-*`, `glib` 전이 의존성의 유지보수/unsound 경고입니다. 이번 macOS/Windows 릴리스 경로의 확인된 취약점은 아니지만 upstream 갱신을 계속 추적합니다.

## Nearby 검증

현재 회귀 테스트는 다음 공격·오류 경로를 직접 확인합니다.

- self-signed certificate fingerprint 고정 TLS와 pairing HMAC tamper 거부
- private/link-local 주소 제한, connection/IP rate limit, bounded mDNS state
- hostile path·Windows reserved name·symlink·손상 chunk 거부
- resume manifest/offset 검증, non-overwrite destination, empty file
- pause/resume/cancel, 4 GiB 초과 offset, bounded terminal history
- native quit 시 active share 보호

같은 날 별도 identity와 data directory를 가진 macOS arm64 앱 2개로 수행한 실제 Nearby E2E에서는 mDNS 발견, 6자리 pairing, 수신 승인, `README.md` 5,835 bytes 전송, 양쪽 `COMPLETED`, SHA-256 일치를 확인했습니다. 이번 수정 후에는 해당 경로의 Rust 회귀 24개와 macOS arm64 release build를 다시 통과했습니다.

## 운영 반영

- 운영 URL: `https://share.dlfkd.dev`
- health: version `0.2.0`, `fileStorage: false`
- server bind: `127.0.0.1:8787`, Cloudflare Tunnel만 외부 진입
- cleanup: `BACKGROUND_CLEANUP_MODE=always`
- stale metadata: share 17건/file row 19건 → 0/0
- 사전 백업: `~/Library/Application Support/DirectDrop/backups/security-audit-20260817-134901/server.sqlite3`
- backup/live DB `PRAGMA integrity_check`: PASS
- HSTS, CSP, frame, MIME, referrer, permissions, cache, robots header: PASS
- 공개 HTTPS/API/WSS/share registration/presence: PASS

로컬 최종 DMG: `DirectDrop_0.2.0_aarch64.dmg`

SHA-256: `a8819ab388aef965e0f4a5f38b39b6f01e6fa51197e8dbd9be332ea94815abcf`

서버는 파일 본문이나 송신자의 절대 경로를 저장하지 않습니다. 이번 cleanup은 SQLite의 공유 토큰·파일명·크기 같은 메타데이터만 제거했습니다.

## 남은 제한

| 심각도 | 제한                                                            | 권고                                                    |
| ------ | --------------------------------------------------------------- | ------------------------------------------------------- |
| MEDIUM | Apple Developer ID 서명·공증 없음                               | 요청 범위에서 제외. SHA-256 제공과 Gatekeeper 안내 유지 |
| MEDIUM | Windows code signing 없음                                       | SmartScreen 경고 고지, 향후 서명 인증서 적용            |
| MEDIUM | 서로 다른 물리 OS/공유기와 1 GiB+ 장시간 전송 재검증 필요       | release 전 실장비 soak matrix 수행                      |
| MEDIUM | TURN 미구성 시 일부 NAT 환경에서 Share Link 직접 연결 실패 가능 | 운영 규모 증가 시 TURN 추가                             |
| MEDIUM | VPN/가상 사설 adapter를 일반 LAN과 완전히 구분하기 어려움       | manual receive 기본값과 Nearby off 제공 유지            |
| LOW    | source 변경 검사가 size와 millisecond mtime 기반                | 향후 전송 전/중 파일 identity 강화 검토                 |
| LOW    | local transfer history에 표시 파일명이 최대 200개 남음          | clear-history UI와 보존 기간 설정 검토                  |

## Release Gate

| Gate                               | 상태                 |
| ---------------------------------- | -------------------- |
| CRITICAL/HIGH = 0                  | PASS                 |
| workspace/Rust regression          | PASS                 |
| dependency/secret audit            | PASS                 |
| macOS arm64 local release app/DMG  | PASS                 |
| 운영 server security patch         | PASS                 |
| 공개 HTTPS/API/WSS E2E             | PASS                 |
| 물리 macOS↔Windows/large-file soak | KNOWN LIMITATION     |
| Developer ID signing/notarization  | 사용자 요청으로 제외 |

**최종 판정: 알려진 제한을 명시한 상태에서 최종 테스트 및 제한적 배포 준비 완료.**
