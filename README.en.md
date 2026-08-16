# DirectDrop

[한국어](README.md) | [English](README.en.md)

**Direct files. No cloud.**

DirectDrop sends files from device to device without uploading them to cloud storage. The desktop app now separates internet sharing under `DirectDrop` from same-network transfers under `LAN Share` so both modes can evolve independently.

## Transfer categories

### DirectDrop · Share Link

Creates a temporary `share.dlfkd.dev` link and QR code. The recipient saves files in a browser without installing an app, while file bytes move directly over WebRTC.

### LAN Share · Nearby

Designed for direct transfers between devices on the same Wi-Fi or Ethernet network without internet access. Phase 1 currently separates the screen, file queue, and shared transport contract. mDNS discovery and actual LAN transfers are planned for the next phases. See the [Nearby LAN Share document](docs/nearby.md) for the exact status.

## Features

- Direct peer-to-peer transfer over WebRTC RTCDataChannel
- No user files stored on the DirectDrop server, Cloudflare R2, or S3
- Temporary share links and QR codes
- 1–1000 downloads or unlimited access, expiration time, and password protection
- Automatic approval or manual approval for each request
- Multiple files, 256 KiB chunk streaming, and DataChannel backpressure
- Windows and macOS desktop apps with a mobile-first browser receiver
- SQLite server metadata and a sender-only local path registry

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
```

Cloudflare Tunnel carries the landing page, API, and WebSocket signaling only. File bytes do not pass through the tunnel or the DirectDrop server.

## Requirements and limitations

- The current public release transfers files through DirectDrop Share Link. LAN Share is still under development.
- The sender's DirectDrop app must stay online while files are being shared.
- The default configuration uses STUN for direct P2P connections. Some NAT or firewall environments may prevent a connection.
- TURN is optional and is used only when it is explicitly configured and relay is enabled for the share. There is no server-upload fallback.
- Large-file streaming works best in current Chrome or Edge with the File System Access API. See [browser support](docs/browser-support.md) for details.
- Current builds are not code-signed or notarized.

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
