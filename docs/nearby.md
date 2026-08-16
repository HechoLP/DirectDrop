# Nearby LAN Share

## 현재 상태

LAN Share는 단계적으로 구현합니다. 현재 완료된 범위는 **Nearby Phase 1**입니다.

| 영역                                       | 상태   |
| ------------------------------------------ | ------ |
| `DirectDrop` / `LAN Share` 최상위 카테고리 | 완료   |
| 카테고리별 독립 파일 큐와 drag-and-drop    | 완료   |
| 공통 transfer 상태·transport 계약          | 완료   |
| mDNS/DNS-SD 기기 탐색                      | 미구현 |
| 기기 pairing과 identity                    | 미구현 |
| 암호화 LAN 연결과 파일 전송                | 미구현 |
| Pause·Resume·폴더 전송                     | 미구현 |
| Browser LAN Share·Clipboard                | 미구현 |

Phase 1에서는 mDNS advertise/discovery, LAN listener, 로컬 웹 서버, clipboard watcher를 실행하지 않습니다.

## 목표 데이터 경로

```text
Sender Desktop ═════ Encrypted local network ═════▶ Receiver Desktop
```

LAN Share 파일 데이터와 discovery는 Cloudflare, `share.dlfkd.dev`, GitHub, 외부 API 또는 외부 signaling 서버를 사용하지 않습니다. 공유기에 WAN 연결이 없어도 같은 LAN 안에서 동작하는 구조를 목표로 합니다.

## 모듈 경계

```text
Desktop React UI
├── DirectDrop category
│   └── WebRTC Share Link
└── LAN Share category
    └── Rust Nearby backend (Phase 2+)

Transfer UI
└── TransferTransport
    ├── WEBRTC
    ├── LAN
    └── BROWSER_LAN
```

공통 계약은 `apps/desktop/src/transfer-contract.ts`에 있습니다. 대용량 binary를 Rust → JavaScript → Rust로 왕복시키지 않고, LAN streaming은 Rust backend에서 처리합니다.

## Discovery

- `_directdrop._tcp.local` 형태의 mDNS/DNS-SD를 우선 검토합니다.
- event-driven discovery를 사용하고 지속적인 대역 포트 스캔이나 busy polling을 하지 않습니다.
- advertise 정보는 random persistent `deviceId`, 사용자가 바꿀 수 있는 `deviceName`, platform, protocol version, port, capabilities로 제한합니다.
- MAC address, OS username, 파일 목록과 불필요한 시스템 정보는 공개하지 않습니다.
- VPN, Tailscale, VM, Docker adapter를 무조건 physical LAN으로 취급하지 않습니다.

## Pairing과 identity

- 설치 시 MAC address와 무관한 random local device ID와 device keypair를 생성합니다.
- 최초 pairing은 양쪽 동일 숫자 확인 또는 QR 방식으로 명시적 승인을 받습니다.
- 이후 trusted device 여부는 이름이 아니라 public key fingerprint로 검증합니다.
- 자동 파일 수신, 텍스트 수신, clipboard sync는 각각 별도 옵션이며 모두 기본 OFF입니다.

## Encryption과 protocol

- 같은 Wi-Fi에서도 plaintext 전송을 허용하지 않습니다.
- QUIC TLS 또는 인증된 TLS 기반 TCP transport를 비교한 뒤 native transport를 선택합니다.
- protocol에는 version과 명확한 크기 제한을 둡니다.
- 최소 메시지는 `HELLO`, `AUTH_REQUEST`, `AUTH_ACCEPT`, `TRANSFER_OFFER`, `TRANSFER_ACCEPT`, `TRANSFER_REJECT`, `FILE_METADATA`, `CHUNK`, `ACK`, `PAUSE`, `RESUME`, `CANCEL`, `COMPLETE`, `ERROR`입니다.

## Streaming과 Resume

- 파일 전체를 RAM에 적재하지 않고 bounded read/write buffer와 backpressure를 사용합니다.
- receiver는 `transferId`, `fileId`, 검증된 offset 또는 chunk map을 로컬에 기록합니다.
- 연결 복구 후 받은 범위 다음부터 이어받고, streaming BLAKE3 또는 SHA-256으로 무결성을 확인합니다.
- 폴더 상대 경로는 정규화하며 `..`, absolute path, platform prefix를 거부합니다.
- 동일 이름 파일은 덮어쓰지 않고 안전한 새 이름을 생성합니다.

## Browser LAN Share

- 사용자가 시작할 때만 LAN local HTTP server를 열고 중지 시 즉시 닫습니다.
- QR에는 LAN 주소와 secure random, 짧은 만료의 session token을 포함합니다.
- endpoint는 local network라는 이유만으로 무인증 요청을 허용하지 않습니다.
- 브라우저 capability에 따라 Resume, directory, background transfer, clipboard 지원을 제한합니다.

## Clipboard와 URL

- MVP 순서는 text, URL, image입니다.
- clipboard 자동 동기화와 URL 자동 실행은 기본 OFF입니다.
- event에 origin device ID, event ID, hash를 포함해 순환 동기화를 막습니다.
- clipboard 전체 내용, secret, key는 로그에 기록하지 않습니다.

## Firewall과 background policy

Nearby가 OFF이면 다음 항목도 모두 OFF여야 합니다.

```text
mDNS advertise
mDNS discovery
LAN listener
Local Web Server
Clipboard watcher
```

Private network를 우선하며 public Wi-Fi에서는 사용자가 명시적으로 활성화하기 전 경고합니다. 방화벽 전체를 끄거나 광범위한 규칙을 생성하지 않고 필요한 listener와 port만 사용합니다.

## 다음 구현 순서

1. Phase 2: mDNS discovery와 최소 device card
2. Phase 3: persistent identity와 pairing
3. Phase 4: encrypted connectivity와 작은 text message
4. Phase 5–8: 파일 streaming, backpressure, 진행률·속도·ETA
5. Phase 9–12: Pause, Cancel, Resume, multi-file, folder
6. Phase 13–20: trusted devices, Browser LAN Share, clipboard, transfer center, tray, network change
7. Phase 21–25: security audit, 성능·Resume 테스트, 반응형 검증, 문서, CI와 release

각 Phase 후 기존 Share Link의 URL, QR, WebRTC, 다운로드 제한, 만료 동작을 회귀 테스트합니다.
