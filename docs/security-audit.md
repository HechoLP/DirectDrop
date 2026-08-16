# DirectDrop Security Audit

감사일: 2026-08-17

대상 버전: 0.1.4

감사 기준 커밋: `cf6cd3c0805db6e3bbae3cccde24f157313ce6ac`

보안 수정 커밋: `49ddacb`

## 범위와 Threat Model

보호 자산은 송신자의 원본 파일과 로컬 절대 경로, 수신자가 저장한 파일, share/control/password grant token, 다운로드 횟수, signaling 상태, 로컬 SQLite입니다.

신뢰 경계는 다음과 같습니다.

1. Desktop WebView와 Rust command 경계
2. Desktop/Browser와 HTTPS·WebSocket signaling 서버 경계
3. 양쪽 브라우저의 WebRTC DataChannel 경계
4. 수신 브라우저와 사용자가 선택한 저장 위치 경계
5. GitHub Actions·릴리스 artifact와 최종 설치 경계

공격자는 공유 URL을 획득한 원격 사용자, 악의적인 웹 페이지, 조작된 signaling/DataChannel message를 보내는 peer, 동일 파일명·hostile filename을 보내는 sender, 다량 연결로 자원을 소모하는 client를 포함합니다. 서버·Cloudflare·GitHub 계정 자체가 이미 탈취된 경우와 OS 관리자 권한 공격은 이 감사의 신뢰 기반 밖입니다.

Nearby Phase 1에는 discovery, pairing, identity, LAN listener, encrypted transport가 없습니다. 따라서 device impersonation, mDNS spoofing, pairing replay, LAN MITM 항목은 안전하다고 판정하지 않고 `NOT IMPLEMENTED / NOT TESTED`로 분리합니다.

## 수정한 발견 사항

| ID | 최초 심각도 | 문제 | 수정 및 회귀 검증 |
| --- | --- | --- | --- |
| F-01 | HIGH | DataChannel binary에 종단 간 무결성 검증이 없어 손상 chunk를 저장할 수 있음 | protocol v1 CHUNK metadata와 SHA-256을 추가하고 손상 fixture 거부 테스트 추가 |
| F-02 | HIGH | 수신자 단독 완료 메시지가 다운로드 횟수를 소비할 수 있음 | sender sent + receiver saved 이중 확인과 atomic completion, 중복/순서 테스트 추가 |
| F-03 | HIGH | cleanup off에서 예약 또는 진행 중 세션이 영구 slot을 잡을 수 있음 | 예약 timer와 sender progress 기반 inactivity watchdog, disconnect/timeout 테스트 추가 |
| F-04 | MEDIUM | signaling/control message와 ICE queue 일부가 충분히 제한되지 않음 | strict schema, 최대 payload/file/chunk/ICE/message rate 제한 추가 |
| F-05 | MEDIUM | WebSocket Origin 검증이 없어 임의 웹 origin이 연결 가능 | allowlist 검사와 malicious-origin 1008 종료 테스트 추가 |
| F-06 | MEDIUM | 느린 수신 저장소가 DataChannel 송신과 분리되어 메모리가 증가할 수 있음 | 저장 완료 ACK와 8 MiB application window, ACK timeout/위조 검사 추가 |
| F-07 | MEDIUM | 저장 폴더에서 같은 파일명을 덮어쓸 수 있음 | exclusive create와 `(n)` suffix 예약, 덮어쓰기 회귀 테스트 추가 |
| F-08 | MEDIUM | 서버/API 응답과 전송 state가 신뢰되어 malformed 응답이 상태를 오염시킬 수 있음 | 응답·server message strict parsing, terminal/순서/총량 state validator 추가 |
| F-09 | LOW | Tauri 시작 실패가 `expect` panic으로 끝남 | `Result` 반환과 명시적 stderr/exit code 처리로 변경 |
| F-10 | MEDIUM | 외부 GitHub Actions가 변경 가능한 tag를 사용함 | 모든 third-party action을 공식 저장소의 full commit SHA로 고정 |

## 확인된 방어

- Rust는 클라이언트가 전달한 path가 아니라 등록된 random public ID만 읽고, read-only handle의 metadata를 다시 검사합니다.
- 레지스트리 row 삭제와 cleanup은 원본 파일을 삭제하지 않습니다.
- 브라우저 저장 이름은 control 문자, bidi control, path separator, Windows reserved name과 trailing dot/space를 정제합니다.
- 파일 bytes와 로컬 절대 경로는 signaling 서버 DB/API/log에 저장하지 않습니다.
- share token은 CSPRNG URL-safe 16자이며 100,000개 생성 충돌 테스트가 통과했습니다.
- 비밀번호는 Argon2id hash로 저장하고 verify endpoint와 일반 API/connection에 rate limit을 적용합니다.
- CSP, noindex, frame 차단, MIME sniffing 차단, referrer/permissions policy를 local server code에 추가했습니다.
- request access log를 끄고 invalid message log에 payload/stack/token을 기록하지 않습니다.
- Rust 제품 코드에 `unsafe` block, shell command 실행, 임의 URL open command가 없습니다.

## 남은 발견 사항

| ID | 심각도 | 내용 | Release 영향 |
| --- | --- | --- | --- |
| R-01 | MEDIUM | macOS artifact가 ad-hoc 서명이고 notarization되지 않아 Gatekeeper가 거부함 | 정식 Developer ID 서명·공증 전 설치 gate 실패 |
| R-02 | MEDIUM | 최신 코드의 Windows build/installer와 Chrome·Edge·Safari·Firefox 전체 전송을 실행하지 못함 | 현재 커밋의 cross-platform core integration 미확인 |
| R-03 | MEDIUM | 512 MiB 이하 File System Access 미지원 브라우저는 파일 전체를 메모리에 모음 | 동시 공유/저메모리 환경에 부담; 512 MiB 초과는 차단 |
| R-04 | MEDIUM | 운영 서버가 아직 0.1.0이며 local security fix가 배포되지 않음 | 배포 전 임의 Origin 허용·보안 header 부재가 유지됨 |
| R-05 | MEDIUM | 운영 TURN이 구성되지 않음 | restrictive NAT/firewall에서 P2P 연결 실패 가능 |
| R-06 | MEDIUM | `cargo audit`에 Linux GTK 계열의 target-conditional unmaintained/unsound 경고 17건이 남음 | macOS/Windows tree에는 포함되지 않지만 Linux target 추가 전 정리 필요 |
| R-07 | LOW | 원본 변경 검사는 size와 millisecond mtime에 의존함 | 동일 크기·같은 tick의 in-place 수정은 송신 의도 변경을 놓칠 가능성 |
| R-08 | LOW | password access grant는 서버 메모리의 10분 bearer token임 | 유출 시 만료 전 재사용 가능; HTTPS와 로그 억제에 의존 |

남은 CRITICAL은 0, HIGH는 0입니다. 다만 R-01, R-02, R-04와 미구현 Nearby 때문에 전체 제품의 Security/Release Gate는 통과하지 않습니다.
