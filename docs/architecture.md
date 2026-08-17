# DirectDrop Architecture

```mermaid
flowchart TB
  APP["DirectDrop Desktop"] --> DD["DirectDrop · Share Link"]
  APP --> LAN["LAN Share · Nearby"]
  DD --> WEBRTC["Internet signaling + WebRTC"]
  LAN --> NATIVE["Local discovery + encrypted native transport"]
  NATIVE == "mDNS + pinned TLS" ==> DEVICE["Nearby DirectDrop device"]
```

`DirectDrop`과 `LAN Share`는 UI 상태와 파일 선택 큐가 분리되어 있습니다. Share Link는 인터넷 signaling과 WebRTC를, Nearby는 Rust native mDNS와 인증된 TLS를 사용합니다. 두 경로 모두 파일 bytes를 DirectDrop 서버에 업로드하지 않습니다.

## DirectDrop · Share Link

```mermaid
flowchart TB
  G["GitHub Repository"] --> A["GitHub Actions"] --> R["GitHub Releases"] --> D["DirectDrop Desktop"]
  D -. "HTTPS and WebSocket signaling" .-> C["share.dlfkd.dev via Cloudflare Tunnel"]
  B["Receiver Browser"] -. "HTTPS and WebSocket signaling" .-> C
  D == "WebRTC RTCDataChannel file bytes" ==> B
```

## LAN Share · Nearby

```mermaid
sequenceDiagram
  participant A as Sender Desktop
  participant M as Local mDNS
  participant B as Receiver Desktop
  A->>M: Browse _directdrop._tcp.local
  B->>M: Advertise ID, name, fingerprint, port
  M-->>A: Resolved private IPv4 endpoint
  A->>B: Fetch certificate and verify advertised SHA-256
  A->>B: TLS Challenge and paired HMAC authentication
  Note over A,B: First use requires matching six-digit approval on both devices
  A->>B: TRANSFER_OFFER with bounded manifest
  B-->>A: User approval and verified resume offsets
  loop Each 1 MiB chunk
    A->>B: fileId, offset, length, SHA-256 plus bytes
    B-->>A: exact persisted offset ACK
  end
  A->>B: COMPLETE
  B-->>A: COMPLETE_ACK after sync and safe final rename
```

Native Nearby owns the TCP/TLS socket and file handles, so binary data does not round-trip through the React WebView. Partial files are isolated by transfer ID and only moved to the configured destination after all declared sizes and hashes pass. 세부 설계는 [nearby.md](nearby.md)를 참고하세요.

## 신뢰 경계

`apps/server`는 share metadata, sender presence, download reservation, SDP/ICE 메시지만 처리합니다. 파일 업로드 endpoint와 서버 임시 파일 경로가 없습니다. `fileStorage: false`는 `/health`에서도 노출됩니다.

`apps/desktop`의 Rust 레지스트리가 무작위 `publicFileId`를 로컬 절대 경로에 매핑합니다. 브라우저와 서버에는 public ID와 정제된 표시 이름만 전달됩니다. Rust는 매 청크 읽기 전에 크기·mtime을 검사하고 read-only handle로 필요한 범위만 읽습니다.

Nearby identity의 private key와 paired shared secret은 앱 데이터에만 저장되고 WebView로 serialize하지 않습니다. mDNS에는 certificate fingerprint까지만 공개합니다. 최초 페어링 코드는 양쪽 nonce·device ID·server fingerprint를 묶고, 재연결 proof는 역할 label과 양쪽 fingerprint를 HMAC에 포함합니다.

수신자는 WebRTC DataChannel의 ordered binary chunk를 처리합니다. protocol version 1은 각 binary chunk 전에 file ID, offset, length, SHA-256을 전송합니다. 수신자는 manifest와 정확한 파일 순서·크기·offset·hash를 검증한 뒤 저장하고 누적 저장 바이트를 ACK합니다. 송신자는 수신자가 실제 저장한 데이터와 최대 8 MiB 이상 벌어지면 대기하므로 느린 디스크도 bounded backpressure로 처리합니다.

총 512 MiB 이하인 일반 공유는 macOS 보호 폴더 권한을 요구하지 않고 메모리 버퍼를 거쳐 브라우저 기본 다운로드 방식으로 저장합니다. 512 MiB를 넘는 대용량 공유는 File System Access API writable stream에 바로 기록하며, 이 API가 없으면 메모리 사용 급증을 막기 위해 다운로드를 차단합니다. 같은 이름의 파일이 존재하면 덮어쓰지 않고 번호가 붙은 새 이름을 예약합니다.

## DownloadSession

```text
RESERVED → CONNECTING → TRANSFERRING → COMPLETED
     └───────────────→ FAILED / CANCELLED
```

예약은 SQLite transaction 안에서 `completed + active reservations < downloadLimit`를 검사합니다. 실패, 취소, 연결 종료, 예약 timeout, 전송 inactivity timeout은 slot을 반환합니다. 송신자의 전송 완료 확인과 수신자의 디스크 저장 완료 확인이 모두 기록된 뒤에만 transaction이 카운트를 정확히 한 번 올립니다.

## Cleanup

만료는 조회 시 lazy 처리합니다. 기본 `BACKGROUND_CLEANUP_MODE=off`에는 background loop가 없습니다. `auto`와 `always`는 서버 메타데이터만 정리하며 송신자 filesystem API에 접근할 수 없습니다.
