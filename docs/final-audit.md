# DirectDrop Final Audit

## 결론

**Release readiness: NOT READY FOR RELEASE**

감사일: 2026-08-17  
감사 버전: 0.1.4  
감사 기준: `cf6cd3c0805db6e3bbae3cccde24f157313ce6ac`  
보안/안정성 수정: `49ddacb`  
CI 공급망 고정: `c7695b6`

코드의 발견된 CRITICAL/HIGH 문제는 수정되고 회귀 테스트가 통과했습니다. 그러나 현재 감사 커밋의 Windows installer와 실제 브라우저별 전송이 검증되지 않았고, macOS artifact가 공증되지 않았으며, Nearby transport 자체가 미구현입니다. 운영 `share.dlfkd.dev`도 아직 0.1.0이어서 local hardening이 배포되지 않았습니다. 따라서 Release Gate를 통과하지 않습니다.

## 감사 환경

| 항목 | 실제 확인 범위 |
| --- | --- |
| OS | macOS 26.5.2 (25F84), arm64 |
| Runtime | Node 24.14.1, pnpm 11.19.0, rustc/cargo 1.96.0 |
| Desktop UI | 1040×760, 최소 창 600×620에서 no overflow 확인 |
| Browser UI | in-app Chromium browser, 390×844 랜딩/오류/복구 화면 확인 |
| Windows | 이전 v0.1.4 remote workflow와 asset만 확인; 현재 감사 커밋 실행 안 함 |
| Safari/Firefox/Edge | 실행 안 함 |

## 자동 검증 결과

| 검증 | 결과 | 증거 |
| --- | --- | --- |
| `pnpm check` | PASS | lint, strict typecheck, 58 tests, desktop/web/server production build |
| Rust fmt/clippy | PASS | all targets/features, warnings denied |
| Rust tests | PASS | 4 tests, 포함: source 보존, path/public ID 경계, 정확한 range, 4 GiB 초과 offset |
| `pnpm audit --prod --audit-level high` | PASS | known vulnerability 0 |
| `cargo audit` vulnerability | PASS | vulnerability 0 |
| `cargo audit` warning | WARNING | target-conditional GTK 계열 17건; 세 release target tree에는 `glib` 없음 |
| secret scan | PASS | 현재 tree와 Git history에서 private key/token 발견 안 됨; `.env.example` 값은 빈 값 |
| workflow YAML | PASS | YAML parse, external Actions full SHA pinning |

테스트 실패나 skip, strict 완화, warning 무시 설정은 추가하지 않았습니다.

## Final Test Matrix

`PASS`는 적힌 범위의 자동 또는 실제 검증만 뜻합니다. protocol fixture PASS를 실제 두 장치 전송 PASS로 확장 해석하지 않습니다.

### Nearby

| 조합 | 결과 | 이유 |
| --- | --- | --- |
| Windows → Windows | NOT IMPLEMENTED / NOT TESTED | mDNS, pairing, identity, LAN transport 미구현 |
| Windows → macOS | NOT IMPLEMENTED / NOT TESTED | 동일 |
| macOS → Windows | NOT IMPLEMENTED / NOT TESTED | 동일 |
| macOS → macOS | NOT IMPLEMENTED / NOT TESTED | 동일 |

### Share Link

| 조합 | 결과 | 확인한 범위 |
| --- | --- | --- |
| Desktop → Chrome | NOT TESTED | 운영 HTTPS/API/WSS만 확인; 실제 payload 저장 미실행 |
| Desktop → Edge | NOT TESTED | 미실행 |
| Desktop → Safari | NOT TESTED | 미실행 |
| Desktop → Firefox | NOT TESTED | 미실행 |
| Protocol/API/signaling 자동 검증 | PASS | authorization, completion, timeout, malformed message, integrity |

### 파일

| 시나리오 | 결과 | 확인한 범위 |
| --- | --- | --- |
| 0 B | PASS | ordered manifest/file terminal validator |
| 1 KB | NOT TESTED | 실제 전송 미실행 |
| 100 MB | NOT TESTED | 실제 전송 미실행 |
| 1 GB | NOT TESTED | 실제 전송 미실행 |
| >4 GiB | PARTIAL PASS | sparse file의 마지막 byte native range read; 전체 전송 미실행 |
| 100 GiB | NOT TESTED | 실제 전송 미실행 |
| 폴더 | NOT IMPLEMENTED | 현 버전은 파일만 지원 |
| 다중 파일 | PASS | manifest 순서·총량·0 B 혼합 validator; 실제 저장은 미실행 |
| 손상 chunk | PASS | 저장 전 SHA-256 mismatch 거부 |
| 중복/순서 오류 | PASS | duplicate manifest, missing chunk, offset/metadata mismatch 거부 |

### 상태

| 상태 | 결과 | 확인한 범위 |
| --- | --- | --- |
| Complete | PASS | sender/receiver 이중 확인, 정확히 1회 count |
| Cancel | NOT TESTED | cancellation code path 검토; 실제 UI race 미실행 |
| Pause | NOT IMPLEMENTED | 상태·전송 protocol 미구현 |
| Resume | NOT IMPLEMENTED | offset persistence·검증 미구현 |
| Disconnect | PASS | receiver disconnect slot 반환, DataChannel early-close abort 구현 |
| Timeout | PASS | pending 및 transferring inactivity watchdog |
| Sender close | NOT TESTED | 코드 cleanup 검토만 수행 |
| Receiver close | PASS | signaling disconnect 회귀 테스트 |
| Double click | PARTIAL PASS | receiver request-in-flight guard 정적 검토; 실제 UI 자동화 미실행 |

## 보안 결과

상세 Threat Model과 finding은 [security-audit.md](security-audit.md)에 있습니다.

| 심각도 | 남은 수 |
| --- | ---: |
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 6 |
| LOW | 2 |

주요 수정은 chunk SHA-256/protocol version, 저장 ACK backpressure, 이중 완료 확인, 예약·전송 watchdog, strict bounded schema, WebSocket Origin allowlist, 비덮어쓰기 저장, hostile filename 정제, API response validation, third-party Action SHA pinning입니다.

## 성능과 자원

로컬 release server의 짧은 관찰 결과입니다. 장기 soak test는 아닙니다.

| 상태 | CPU | RSS | FD / TCP |
| --- | ---: | ---: | ---: |
| idle | 0.0% | 약 92–94 MB | 23 / 2 |
| idle WebSocket 25개 | 0.0% | 약 92.6 MB | 48 / 27 |
| 25개 종료 후 | 0.0% | 약 92.6 MB | 23 / 2 |

100개 동시 WebSocket 시도는 동일 IP connection rate limit의 HTTP 429에 도달했습니다. 관찰 구간에 busy-loop나 socket/FD 잔류는 없었습니다. 실제 대용량 전송 RSS, 느린 디스크, disk full, suspend/resume, 장시간 reconnect soak는 실행하지 않았습니다.

## 패키지와 배포

### macOS

- `DirectDrop.app`과 `DirectDrop_0.1.4_aarch64.dmg` build: PASS
- binary: Mach-O arm64
- `codesign --verify --deep --strict`: PASS
- `hdiutil verify`: PASS
- DMG SHA-256: `b59ddb207e47f6c5429d5e2ca80cd38eca5fb398fc8e1634e10e7f6a32a4b4be`
- signing identity: ad-hoc, TeamIdentifier 없음
- notarization: 없음
- `spctl --assess`: **FAIL (rejected)**

`xattr -dr com.apple.quarantine`는 테스트용 우회 안내일 뿐 정식 installer acceptance PASS로 취급하지 않습니다.

### Windows와 GitHub

- 현재 감사 커밋 Windows build/설치/제거/upgrade: NOT TESTED
- 이전 v0.1.4 release workflow run `31959215041`: PASS
- 이전 remote CI run `31960423968`: PASS, 단 현재 local 감사 커밋을 포함하지 않음
- 기존 v0.1.4의 Apple Silicon DMG, Intel DMG, EXE, MSI는 공개 `SHA256SUMS.txt`와 모두 일치
- local audit commit은 push/deploy하지 않았으므로 새 remote CI 결과가 없음

### Production

2026-08-17 관찰 시점:

- `https://share.dlfkd.dev/health`: HTTP 정상, `version: 0.1.0`, `fileStorage: false`
- public verify: HTTPS, API, WSS, register, presence PASS
- TURN: 미구성
- arbitrary Origin WebSocket: 운영에서는 연결됨
- CSP, X-Content-Type-Options, frame/referrer/permissions/noindex response header: 운영 응답에 없음
- local 0.1.4 code에는 위 Origin/header 수정이 있으나 아직 배포되지 않음
- Cloudflare dashboard/tunnel credential rotation·restart: 권한이 없어 NOT TESTED

## 알려진 제한과 Release Gate

- Nearby는 UI/파일 큐 Phase 1뿐이며 discovery, pairing, identity, 암호화 transport가 없습니다.
- Pause, Resume, folder, clipboard, Browser LAN Share, persistent history는 미구현입니다.
- File System Access API가 없는 브라우저는 최대 512 MiB 메모리 fallback만 지원합니다.
- restrictive NAT를 위한 TURN이 운영에 없습니다.
- 현재 Windows/cross-browser/대용량 실제 E2E 증거가 없습니다.
- macOS Developer ID signing/notarization이 없습니다.
- 운영 서버는 감사 수정 전 버전입니다.

Release 전에 최소한 현재 commit의 remote CI/Windows installer, Apple signing/notarization, Chrome·Edge·Safari·Firefox 실제 전송, 0 B/1 KB/100 MB/1 GB 및 느린 수신·disconnect 검증, 운영 배포 후 Origin/security header 재검증이 필요합니다. Nearby를 릴리스 기능으로 표기하려면 구현 후 pairing/MITM/replay/LAN matrix를 별도 통과해야 합니다.

## 최종 Gate

| Gate | 결과 |
| --- | --- |
| CRITICAL = 0 | PASS |
| HIGH = 0 | PASS |
| 자동 회귀 테스트 | PASS |
| local build | PASS |
| 현재 commit remote CI | FAIL / NOT RUN |
| core cross-platform integration | FAIL / NOT TESTED |
| Windows installer | FAIL / NOT TESTED |
| macOS installer acceptance | FAIL |
| Nearby | FAIL / NOT IMPLEMENTED |
| 운영 hardening 배포 | FAIL / NOT DEPLOYED |

**최종 판정: NOT READY FOR RELEASE**
