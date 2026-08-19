# Nearby LAN Share

## v0.2.0 구현 상태

Nearby는 같은 IPv4 사설/링크 로컬 네트워크의 DirectDrop 데스크톱 앱끼리 인터넷과 외부 서버 없이 파일을 전송합니다.

| 영역                                              | 상태                            |
| ------------------------------------------------- | ------------------------------- |
| 독립 Nearby 화면·파일 큐                          | 완료                            |
| `_directdrop._tcp.local` mDNS advertise/discovery | 완료                            |
| 영구 random device ID와 사용자 지정 이름          | 완료                            |
| 인증서 고정 TLS와 6자리 상호 페어링               | 완료                            |
| 신뢰 기기·저위험 파일 자동 수신                   | 완료, 기본 OFF                  |
| 수동 수신 승인                                    | 완료, 기본값                    |
| 다중 파일·폴더·빈 파일                            | 완료                            |
| bounded streaming·backpressure·SHA-256            | 완료                            |
| 보내기 일시정지·재개·취소                         | 완료                            |
| 연결 중단 후 검증된 offset부터 이어보내기         | 완료                            |
| 속도·ETA·전송 내역·받은 파일                      | 완료                            |
| Browser LAN Share·Clipboard sync                  | v0.2.0 범위 밖, listener 미실행 |

## 데이터 경로

```text
Sender Desktop
  └─ mDNS discovery: _directdrop._tcp.local
  └─ certificate fetch + fingerprint check
  └─ TLS 1.2/1.3 + paired HMAC device authentication
       ═════ 1 MiB file chunks + SHA-256 + ACK ═════▶ Receiver Desktop
```

Nearby discovery, 페어링, 승인, 파일 바이트는 Cloudflare, `share.dlfkd.dev`, GitHub, STUN/TURN 또는 외부 signaling 서버를 사용하지 않습니다. 공유기에 WAN 연결이 없어도 같은 LAN에서 동작합니다.

## Discovery

- 서비스 타입: `_directdrop._tcp.local.`
- TXT 최소 정보: random persistent `deviceId`, 사용자 지정 `deviceName`, platform, protocol version, certificate fingerprint, capabilities
- 공개하지 않는 정보: MAC address, OS 사용자명, 절대 파일 경로, 파일 목록, 페어링 키
- 지속 포트 스캔이나 busy polling 없이 mDNS event를 처리합니다.
- 현재 discovery는 non-loopback private/link-local IPv4 주소를 사용합니다. 공인 IP에서 들어오는 연결은 거부합니다.
- 네트워크가 mDNS, client isolation 또는 peer-to-peer 통신을 차단하면 기기가 나타나지 않습니다.

## Identity와 Pairing

- 최초 실행 시 MAC address와 무관한 UUID, self-signed device certificate, private key를 생성합니다.
- identity는 앱 데이터의 `nearby/identity.json`에 저장하며 Unix에서는 `0600` 권한으로 제한합니다.
- identity 저장은 임시 파일과 이전 유효본 backup을 사용해 중간 종료 시 손상을 줄입니다.
- 최초 페어링은 양쪽에서 같은 6자리 코드를 확인하고 양쪽 모두 승인해야 완료됩니다.
- 코드는 양쪽 nonce, device ID, 실제 server certificate fingerprint를 포함하므로 mDNS fingerprint 바꿔치기/TLS MITM이면 일치하지 않습니다.
- 이후 연결은 이름이 아니라 pinned certificate fingerprint와 256-bit shared secret HMAC proof로 상호 인증합니다.
- shared secret과 private key는 WebView 상태/API에 노출하지 않습니다.
- 신뢰 해제 시 해당 기기의 key를 로컬에서 삭제합니다.

## Transport와 Protocol

- native Rust TCP listener 위에 TLS 1.2/1.3을 사용합니다.
- protocol version은 `2`, control frame은 최대 1 MiB, chunk는 최대 4 MiB, 한 번에 최대 10,000개 파일입니다.
- sender는 한 chunk를 전송한 뒤 receiver의 정확한 `fileId`·offset ACK를 확인합니다. 따라서 느린 디스크에서도 메모리/송신 queue가 무제한 증가하지 않습니다.
- chunk마다 SHA-256을 검증한 뒤에만 디스크에 기록합니다.
- trusted-device HMAC proof에는 역할 label, 양쪽 nonce/ID/certificate fingerprint를 포함해 반대 방향·다른 세션 replay를 거부합니다.
- listener는 동시에 최대 16개 연결만 처리합니다.

## 파일·폴더와 Resume

- 파일을 전체 RAM에 적재하지 않고 1 MiB buffer로 읽고 씁니다.
- 폴더 relative path는 `/` 기준으로 보존합니다.
- absolute path, `..`, Windows drive prefix/colon, backslash, control/bidi 문자, Windows reserved name, trailing dot/space를 거부합니다.
- symbolic link는 등록 단계에서 거부해 선택한 폴더 밖 파일이 포함되지 않게 합니다.
- 수신 중 데이터는 `<download>/.directdrop-partial/<transferId>`에만 저장합니다.
- resume state는 manifest hash와 실제 partial file length를 함께 확인합니다. 다른 manifest로 같은 transfer ID를 재사용할 수 없습니다.
- 연결이 끊기면 송신자는 동일 transfer ID로 다시 연결하고, 수신자가 확인한 offset 다음부터 이어보냅니다.
- 완료 전에는 최종 위치로 이동하지 않으며 기존 파일·폴더와 이름이 겹치면 `(1)`, `(2)` suffix를 붙입니다.
- 실행 가능·script·macro·archive 형식은 자동 수신하지 않으며, 전체 수신 후 실제 실행 header가 표시 형식과 다르면 최종 이동 전에 다시 승인받습니다.
- macOS quarantine 또는 Windows Mark-of-the-Web 적용에 실패하면 파일을 최종 위치로 이동하지 않습니다.
- 취소 시 해당 transfer ID의 partial directory만 삭제합니다. 원본이나 다른 수신 파일은 삭제하지 않습니다.

## 승인·Pause·Cancel

- 신뢰 기기라도 기본은 전송마다 수신자가 파일명·개수·총용량을 보고 승인합니다.
- 설정에서 특정 신뢰 기기의 저위험 파일만 자동 수신하도록 켤 수 있습니다. 실행 가능 파일과 내부를 확인할 수 없는 container는 항상 승인합니다.
- 송신자가 일시정지하면 다음 chunk를 읽거나 보내지 않고, 재개 시 같은 connection과 offset에서 계속합니다.
- 수신자가 취소하면 receiver partial만 정리하고 sender에 취소를 전달합니다.
- 실패한 송신은 UI의 `이어보내기`로 검증된 offset부터 재시도합니다.

## 로컬 저장과 내역

- 기본 저장 위치는 사용자 Downloads의 `DirectDrop` 폴더이며 절대 경로만 설정할 수 있습니다.
- 완료·실패·취소 내역을 최대 200개 로컬 `transfer-history.json`에 저장합니다. Unix 권한은 `0600`입니다.
- 내역에는 표시용 파일 metadata만 있고 파일 bytes, private key, shared secret은 없습니다.

## OS 권한과 방화벽

- macOS bundle에는 `NSLocalNetworkUsageDescription`과 `_directdrop._tcp` Bonjour service declaration이 포함됩니다.
- macOS 첫 실행 시 `로컬 네트워크` 접근을 허용해야 discovery/listener가 동작합니다.
- Windows Defender Firewall prompt에서는 `Private networks`만 허용하는 것을 권장합니다. 방화벽 전체를 끄지 않습니다.
- Nearby를 끄면 mDNS advertise/discovery와 TCP listener를 모두 중지합니다.

## v0.2.0 검증 범위

- persistent identity/fingerprint 및 TLS loopback handshake
- pairing code 안정성, HMAC tamper rejection
- bounded control/chunk frame limit
- traversal·reserved·bidi relative path rejection
- corrupted chunk 저장 전 거부
- partial offset resume와 manifest mismatch 방어
- 기존 파일/폴더 non-overwrite
- 4 GiB 초과 sparse file offset native read
- macOS/Windows GitHub CI에서 Rust fmt, clippy `-D warnings`, 전체 unit test

실제 서로 다른 물리 장치·공유기 조합은 환경별 mDNS/방화벽 정책의 영향을 받으므로 릴리스 후에도 [테스트 매트릭스](test-matrix.md)에 결과를 누적합니다.

## 의도적으로 포함하지 않은 기능

Browser LAN Share와 clipboard 자동 동기화는 편의를 위해 plaintext HTTP listener나 무인 clipboard 감시를 추가하지 않도록 v0.2.0에서 활성화하지 않았습니다. 이후 버전에서 브라우저가 신뢰할 수 있는 로컬 인증과 별도 opt-in/loop 방지 설계를 갖춘 뒤 추가합니다.
