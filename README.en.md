# DirectDrop

[한국어](README.md) | [English](README.en.md)

**Direct files. No cloud.**

DirectDrop sends files from device to device without uploading them to cloud storage. The desktop app now separates internet sharing under `DirectDrop` from same-network transfers under `LAN Share` so both modes can evolve independently.

## Transfer categories

### DirectDrop · Share Link

Creates a temporary `share.dlfkd.dev` link and QR code. The recipient saves files in a browser without installing an app, while file bytes move directly over WebRTC.

### LAN Share · Nearby

Discovers DirectDrop devices on the same Wi-Fi or Ethernet network with mDNS and transfers without internet access. First-time pairing requires both users to compare a six-digit code. Later connections authenticate the device with its pinned certificate fingerprint and persistent trust key. File and folder bytes only travel through the authenticated TLS connection. See [Nearby LAN Share](docs/nearby.md) for protocol and security details.

> **Nearby requirement:** DirectDrop v0.2.0 or later must be installed and running on both the sending and receiving devices. Nearby discovers desktop apps on the same local network and cannot use a browser as a Nearby device. Use `DirectDrop · Share Link` when the recipient should receive files without installing the app.

## Features

- Direct peer-to-peer transfer over WebRTC RTCDataChannel
- No user files stored on the DirectDrop server, Cloudflare R2, or S3
- Temporary share links and QR codes
- 1–1000 downloads or unlimited access, expiration time, and password protection
- Automatic approval or manual approval for each request
- Multiple files, 256 KiB chunk streaming, and DataChannel backpressure
- Windows and macOS desktop apps with a mobile-first browser receiver
- SQLite server metadata and a sender-only local path registry
- Nearby discovery over `_directdrop._tcp.local` mDNS
- Mutual six-digit pairing and certificate-pinned TLS 1.2/1.3
- Bounded 1 MiB streaming for multiple files and folders with chunk SHA-256
- Receive approval, pause, resume, cancel, and verified offset recovery
- Nearby speed, ETA, persistent history, received files, and trusted devices

## Download

Visit [share.dlfkd.dev](https://share.dlfkd.dev/) for platform-specific downloads and an overview, or get the [latest DirectDrop release from GitHub](https://github.com/HechoLP/directdrop/releases/latest).

The Windows installer is currently unsigned, and the macOS app uses ad-hoc signing. Windows SmartScreen or macOS Gatekeeper may show a warning. You can verify the release against `SHA256SUMS.txt` and the source code in this repository.

If macOS says DirectDrop is damaged after you move it to the `Applications` folder, run these commands in Terminal:

```bash
xattr -dr com.apple.quarantine /Applications/DirectDrop.app
open /Applications/DirectDrop.app
```

## Transfer architecture

```text
Sender Desktop ── signaling ──▶ share.dlfkd.dev ◀── signaling ── Receiver Browser
Sender Desktop ═══════════════ WebRTC file data ═══════════════▶ Receiver Browser

Nearby Desktop ═══ certificate-pinned TLS on local network ═══▶ Nearby Desktop
```

Cloudflare Tunnel carries the Share Link landing page, API, and WebSocket signaling only. Share Link bytes move over WebRTC and Nearby bytes move over local TLS; neither path sends file bytes through the DirectDrop server.

## Requirements and limitations

- The sender's DirectDrop app must stay online while files are being shared.
- Nearby requires DirectDrop v0.2.0 or later to be installed and running on both devices on the same private/link-local IPv4 network. Browsers are not discoverable as Nearby devices.
- Allow Local Network access on macOS. On Windows, allow DirectDrop only on `Private networks` when the firewall prompt appears.
- VPNs, guest Wi-Fi, or AP isolation may block device-to-device traffic or mDNS discovery.
- The default configuration uses STUN for direct P2P connections. Some NAT or firewall environments may prevent a connection.
- TURN is optional and is used only when it is explicitly configured and relay is enabled for the share. There is no server-upload fallback.
- Large-file streaming works best in current Chrome or Edge with the File System Access API. See [browser support](docs/browser-support.md) for details.
- Windows builds are unsigned. At the user's request, macOS Developer ID signing and notarization are excluded; macOS artifacts use ad-hoc signing.

## Local development

You need Node.js 22+, pnpm 11+, Rust stable, and the Tauri 2 system dependencies.

```bash
pnpm install
cp .env.example .env
pnpm build
pnpm --filter @directdrop/server start
```

Run the web app and server in development mode:

```bash
pnpm dev
```

Run the Tauri desktop app in development mode:

```bash
pnpm dev:desktop
```

Run the full validation suite:

```bash
pnpm check
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

## Configuration

All public URLs, STUN/TURN settings, and cleanup behavior are configured with environment variables. Start with [.env.example](.env.example), which contains no secrets. See [architecture.md](docs/architecture.md) for the production design and [cloudflare-setup.md](docs/cloudflare-setup.md) to recreate the tunnel.

## Repository layout

```text
apps/desktop   Tauri + React sender app
apps/web       React browser landing and receiver UI
apps/server    Fastify API, WebSocket signaling, and SQLite
packages/      Shared protocol, utilities, and UI package
docs/          Operations, architecture, and testing documentation
```

MIT License
