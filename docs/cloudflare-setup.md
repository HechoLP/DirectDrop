# Cloudflare Tunnel Setup

현재 운영 구성:

| 항목            | 값                         |
| --------------- | -------------------------- |
| Tunnel name     | `directdrop`               |
| Public hostname | `share.dlfkd.dev`          |
| Local origin    | `http://localhost:8787`    |
| WebSocket       | `wss://share.dlfkd.dev/ws` |

전용 Tunnel을 사용하며 기존 DNS, 메일, Worker, 다른 Tunnel 설정을 재사용하거나 변경하지 않습니다. R2는 사용하지 않습니다.

```bash
cloudflared tunnel login
cloudflared tunnel create directdrop
cloudflared tunnel route dns directdrop share.dlfkd.dev
cloudflared tunnel ingress validate
cloudflared tunnel run directdrop
```

로컬 `~/.cloudflared/config.yml` 예시입니다. 실제 UUID와 credential 파일은 저장소 밖에 둡니다.

```yaml
tunnel: <tunnel-uuid>
credentials-file: /absolute/path/to/<tunnel-uuid>.json
ingress:
  - hostname: share.dlfkd.dev
    service: http://localhost:8787
  - service: http_status:404
```

운영 환경:

```env
PUBLIC_APP_URL=https://share.dlfkd.dev
PUBLIC_SIGNALING_URL=wss://share.dlfkd.dev/ws
ALLOWED_ORIGINS=https://share.dlfkd.dev,tauri://localhost,https://tauri.localhost
```

개발 환경:

```env
PUBLIC_APP_URL=http://localhost:8787
PUBLIC_SIGNALING_URL=ws://localhost:8787/ws
```

검증:

```bash
curl --fail https://share.dlfkd.dev/health
```

Tunnel은 web/API/signaling 전용입니다. WebRTC 파일 데이터가 Tunnel을 경유하도록 reverse proxy나 fallback upload를 추가하지 마세요.
