# DirectDrop v0.2.0 Test Matrix

감사일: 2026-08-17

`PASS`는 해당 행에 적힌 자동/실행 범위만 의미합니다. protocol unit test를 서로 다른 물리 장치 전송 결과로 확대 해석하지 않습니다.

## Nearby core

| 시나리오              | 결과 | 검증 범위                                                                        |
| --------------------- | ---- | -------------------------------------------------------------------------------- |
| Persistent identity   | PASS | 재시작 후 device ID와 certificate fingerprint 유지, Unix `0600`                  |
| Pinned TLS            | PASS | self-signed certificate를 SHA-256 pin으로 신뢰한 loopback handshake              |
| Pairing code          | PASS | 6자리 안정성, transcript 순서 변경 시 불일치                                     |
| Paired authentication | PASS | HMAC proof tamper rejection, role·nonce·ID·fingerprint binding                   |
| mDNS metadata bounds  | PASS | bounded parser, local 주소 선택, 실제 OS advertise/browse와 두 앱 discovery 확인 |
| Connection abuse      | PASS | 16 concurrent semaphore, IP당 분당 60 connection rate limit                      |
| Discovery state abuse | PASS | device 256/service name 512 상한과 unpaired eviction                             |
| Native app quit       | PASS | active share가 있으면 ExitRequested를 WebView 확인 흐름으로 전달                 |
| Secret exposure       | PASS | WebView용 trusted device summary에서 shared secret 제외                          |

## Nearby file behavior

| 시나리오             | 결과                 | 검증 범위                                                                           |
| -------------------- | -------------------- | ----------------------------------------------------------------------------------- |
| 0 B file             | PASS / automated     | chunk 없이 completion size 검사와 empty file sync                                   |
| Small file           | PASS / actual E2E    | `README.md` 5,835 bytes 전송, 양쪽 completed, 원본/수신 SHA-256 일치                |
| Multiple files       | PASS                 | bounded manifest, duplicate ID/path rejection                                       |
| Folder               | PASS                 | nested relative path 보존, 단일 파일 폴더 포함                                      |
| Hostile path         | PASS                 | absolute, traversal, drive, backslash, bidi, reserved name, trailing dot/space 거부 |
| Symbolic link        | PASS / static        | 등록 단계에서 file/directory symlink 거부                                           |
| Corrupt chunk        | PASS                 | hash mismatch를 디스크 write 전에 거부                                              |
| Resume               | PASS                 | partial length 반환, manifest hash mismatch 거부                                    |
| Existing destination | PASS                 | 파일과 폴더 모두 suffix를 붙여 non-overwrite                                        |
| Cancel               | PASS / protocol      | scoped partial cleanup, 원본·다른 파일 미삭제                                       |
| Pause/resume         | PASS / state         | sender chunk 경계에서 정지·재개, bounded queue 유지                                 |
| Disconnect retry     | PASS / state         | 동일 transfer ID로 최대 3회 재연결, receiver offset 재사용                          |
| >4 GiB offset        | PASS                 | sparse file 마지막 byte native range read                                           |
| 1 GiB+ full transfer | PHYSICAL TEST NEEDED | unit path와 bounded buffer는 통과, 별도 두 장치 soak 필요                           |
| Risky extension      | PASS / automated     | 실행·script·macro는 HIGH, archive/disk image는 CAUTION, 자동 수신 제외              |
| Renamed executable   | PASS / automated     | PE/ELF/Mach-O/shebang 실제 header가 metadata와 다르면 최종 저장 전 재승인           |
| macOS provenance     | PASS / automated     | 최종 파일에 `com.apple.quarantine` 유지 확인                                        |
| Filename mismatch    | PASS / automated     | 표시 name과 상대 경로 basename 불일치 manifest 거부                                 |

## OS matrix

| Sender      | Receiver    | 자동 검증                           | 실제 물리 장치           |
| ----------- | ----------- | ----------------------------------- | ------------------------ |
| macOS arm64 | macOS arm64 | 실제 격리 앱 2개 E2E PASS           | 별도 물리 장치 검증 필요 |
| macOS       | Windows x64 | GitHub macOS/Windows native CI PASS | 별도 물리 장치 검증 필요 |
| Windows x64 | macOS       | GitHub macOS/Windows native CI PASS | 별도 물리 장치 검증 필요 |
| Windows x64 | Windows x64 | GitHub Windows native CI PASS       | 별도 물리 장치 검증 필요 |

## Share Link regression

| 항목                                                | 결과                           |
| --------------------------------------------------- | ------------------------------ |
| protocol/server/web/desktop test suites             | PASS locally                   |
| Origin allowlist/security headers                   | PASS locally and on production |
| WebRTC integrity/backpressure/completion accounting | PASS automated fixtures        |
| Chrome/Edge/Safari/Firefox physical transfer        | 별도 실제 브라우저 검증 필요   |

## Release gates

| Gate                                    | 현재 상태                        |
| --------------------------------------- | -------------------------------- |
| `pnpm check`                            | PASS locally                     |
| Rust fmt/clippy/26 tests                | PASS locally                     |
| npm/Cargo dependency vulnerability      | PASS, vulnerability 0            |
| Git history secret scan                 | PASS, 32 commits, leak 0         |
| macOS arm64 app build                   | PASS locally and GitHub release  |
| macOS Intel app build                   | PASS in GitHub release workflow  |
| Windows installer                       | PASS, NSIS EXE and x64 MSI       |
| GitHub CI current commit                | PASS, run `31990090144`          |
| Production hardening                    | PASS, v0.2.0 public verification |
| Apple Developer ID signing/notarization | 사용자 요청에 따라 제외          |
