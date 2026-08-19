# DirectDrop Security Audit

감사일: 2026-08-17
대상 버전: 0.2.0

## 범위와 Threat Model

보호 자산은 송신자의 원본 파일·절대 경로, 수신 파일, Nearby identity/private key/shared secret, Share Link token/control key/password grant, 다운로드 횟수, signaling state와 local SQLite입니다.

주요 신뢰 경계는 다음과 같습니다.

1. React WebView와 Tauri Rust command
2. Nearby mDNS와 동일 LAN의 비신뢰 device
3. Nearby TCP/TLS peer와 local filesystem
4. Share Link desktop/browser와 HTTPS·WebSocket signaling
5. WebRTC DataChannel peer와 receiver storage
6. GitHub Actions·release artifact와 설치 OS

공격자는 같은 LAN에서 mDNS를 위조하거나 임의 TCP frame을 보내는 device, 다른 device를 사칭하는 peer, pairing code를 비교하지 않도록 유도하는 사람, hostile filename/manifest/chunk를 보내는 sender, 연결·message flood로 자원을 소모하는 client, Share URL을 획득한 원격 사용자를 포함합니다. OS administrator 권한이나 GitHub/Cloudflare account 자체가 이미 탈취된 경우는 신뢰 기반 밖입니다.

## Nearby 보안 통제

| ID   | 위협                                   | 통제와 검증                                                                                                            |
| ---- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| N-01 | mDNS device impersonation·LAN MITM     | advertised certificate SHA-256 pin, TLS, 양쪽 nonce/ID/server fingerprint를 포함한 6자리 상호 확인                     |
| N-02 | paired device replay·name spoofing     | device name이 아닌 pinned fingerprint와 256-bit shared secret HMAC proof, 역할 label·양쪽 nonce/ID/fingerprint binding |
| N-03 | private key/shared secret WebView 노출 | Rust identity에만 저장, `NearbyStatus`에는 secret 없는 summary만 serialize                                             |
| N-04 | plaintext LAN file 전송                | native TCP 위 TLS 1.2/1.3만 허용; 일반 file listener 없음                                                              |
| N-05 | path traversal·platform path confusion | absolute/`..`/drive/backslash/control/bidi/reserved/trailing dot-space 거부, receiver root 아래 staging만 사용         |
| N-06 | folder symlink escape                  | sender registration에서 file/directory symbolic link 거부                                                              |
| N-07 | chunk corruption·offset forgery        | 매 chunk SHA-256, exact file ID/offset/length, persisted offset ACK 확인                                               |
| N-08 | resume state substitution              | transfer ID 형식 제한, saved manifest hash와 partial length 검증                                                       |
| N-09 | 기존 수신 파일 overwrite               | completion 뒤 unique `(n)` destination으로만 이동                                                                      |
| N-10 | memory/socket DoS                      | 1 MiB frame/chunk, 10,000 file bound, stop-and-wait ACK backpressure, 16 concurrent connection, IP당 분당 60회 제한    |
| N-11 | mDNS state exhaustion                  | device 256개/service name 512개 상한, 오래된 unpaired device 우선 eviction                                             |
| N-12 | transfer history memory growth         | Rust와 React 모두 terminal history 200개 상한, active 전송은 보존                                                      |
| N-13 | 무인 파일 투입                         | trusted device도 기본 manual receive, auto receive는 저위험 metadata에만 적용하고 active/container는 항상 재확인       |
| N-14 | partial cleanup이 다른 파일 삭제       | `<download>/.directdrop-partial/<validated transferId>`만 삭제, 원본 경로 삭제 API 없음                                |
| N-15 | identity file 중간 손상·권한 노출      | temp write + sync + previous backup, Unix identity/history `0600`, size/structure validation                           |
| N-16 | 문서처럼 위장한 실행파일               | metadata 사전 분류 후 staging 실제 PE/ELF/Mach-O/shebang 확인, 위험 상승 시 최종 이동 전 두 번째 승인                  |
| N-17 | OS 보호를 우회한 수신 파일             | macOS quarantine/Windows Mark-of-the-Web 적용 성공 후에만 Nearby 최종 위치로 이동                                      |
| N-18 | 악성 여부 오판·과도한 안전 표시        | 모든 판정을 `UNSCANNED`로 유지하고 위험도는 승인 정책에만 사용, 정상 위험 파일도 확인 후 수신 가능                     |

Pairing의 6자리 code는 사용자가 양쪽 화면을 실제로 비교하는 것을 전제로 합니다. 코드를 비교하지 않고 승인하면 잘못된 device를 신뢰할 수 있으므로 UI에서 불일치 시 취소하도록 명시합니다.

## Share Link 기존 보안 통제

- Rust는 client path 대신 등록된 random public ID만 읽고 size·mtime을 다시 검사합니다.
- WebRTC protocol v1은 manifest와 각 chunk의 ID·offset·length·SHA-256을 검증합니다.
- 실행 가능/매크로/압축 형식은 명시적 동의를 요구하고, 첫 chunk의 위장 실행 헤더는 저장 전에 중단합니다.
- receiver disk ACK 기반 8 MiB application window로 느린 저장소에서 queue를 제한합니다.
- sender sent와 receiver saved가 모두 기록된 뒤 download count를 atomic하게 올립니다.
- Origin allowlist, strict bounded signaling schema, connection/message/API rate limit을 적용합니다.
- password는 Argon2id hash로 저장하며 short-lived access grant를 사용합니다.
- server·Cloudflare에 file bytes와 sender absolute path를 저장하지 않습니다.
- response CSP, frame/MIME/referrer/permissions/noindex header를 설정합니다.
- loopback Cloudflare proxy만 신뢰해 client IP rate-limit bucket을 분리하고 HSTS를 적용합니다.
- signaling active connection을 전역 1,000개/IP당 16개로 제한합니다.
- terminal share는 파일명·크기를 숨기고 password grant 발급을 중단합니다.
- `expires_at`이 지난 metadata를 조회 여부와 관계없이 자동 삭제합니다.
- third-party GitHub Actions는 full commit SHA에 고정합니다.
- CI/Release action은 Node 24 기반 최신 공식 release commit SHA에 고정합니다.

## 검증 결과

- CRITICAL: 0
- HIGH: 0
- Rust: identity persistence, pinned TLS loopback, pairing/HMAC tamper, frame bound, hostile path, corrupt chunk, resume, non-overwrite, empty file, >4 GiB offset, rate limit, discovery/history bound, native exit tests
- 실제 Nearby E2E: 서로 격리된 앱 2개에서 mDNS 발견, 6자리 pairing, 신뢰 저장, 수신 승인, 5,835 byte 전송, 양쪽 완료와 SHA-256 일치
- TypeScript: strict relative path schema를 포함한 protocol tests
- Workspace: lint, strict typecheck, 72 unit/integration tests, production build
- Dependency audit: npm/Cargo 알려진 vulnerability 0; Tauri/GTK3 등 전이 의존성 유지보수·unsound warning 17건 추적
- Rust 제품 코드에 `unsafe` block, shell command execution, arbitrary URL open command 없음
- 운영 stale metadata 17 share/19 file row를 일관된 backup 후 0/0으로 정리하고 DB 무결성 확인

전체 명령과 OS 범위는 [test-matrix.md](test-matrix.md)를 참고하세요.

## 남은 위험과 명시적 제한

| ID   | 심각도 | 내용                                                                                  | 처리                                                                                |
| ---- | ------ | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| R-01 | MEDIUM | macOS Developer ID signing/notarization 없음                                          | 사용자 요청에 따라 v0.2.0에서 제외, SHA256·source·Gatekeeper 우회 안내 제공         |
| R-02 | MEDIUM | Windows code signing 없음                                                             | SmartScreen 경고를 release/site에 명시                                              |
| R-03 | MEDIUM | 실제 여러 공유기·물리 Windows/macOS 조합의 mDNS/firewall/1 GiB soak evidence가 제한적 | remote OS CI와 release installer를 우선 gate로 사용하고 physical matrix를 계속 기록 |
| R-04 | MEDIUM | public/guest Wi-Fi도 사설 IP를 사용해 자동 식별이 불완전                              | manual receive 기본, Nearby off toggle, Private network만 허용하도록 안내           |
| R-05 | MEDIUM | Browser LAN Share는 신뢰 가능한 local HTTPS 없이 plaintext 위험                       | v0.2.0에서 listener 자체를 실행하지 않음                                            |
| R-06 | MEDIUM | clipboard auto-sync는 secret 유출·loop 위험                                           | v0.2.0에서 watcher 자체를 실행하지 않음                                             |
| R-07 | LOW    | source change 검사가 size와 millisecond mtime 기반                                    | 전송 중 검사 유지; 동일 size/tick in-place change 가능성 문서화                     |
| R-08 | LOW    | transfer history에 local 표시 filename이 남음                                         | 최대 200개, local-only, Unix `0600`, 설정/향후 clear 기능 검토                      |
| R-09 | MEDIUM | 확장자·헤더 정책은 새 악성코드, 난독화 script, 암호화 archive 내부를 판정할 수 없음   | `UNSCANNED` 표시, 위험 형식 수동 승인, OS 출처 보호·백신 검사와 발신자 확인 권고    |

Apple signing 제외는 설치 신뢰 경고를 남기지만 Nearby transport 암호화와 별개의 배포 위험입니다. 릴리스 artifact hash와 GitHub Actions 결과를 함께 확인해야 합니다.

수신 파일 위협 모델과 오탐·미탐 처리 원칙은 [malware-protection.md](malware-protection.md)를 참고하세요.
