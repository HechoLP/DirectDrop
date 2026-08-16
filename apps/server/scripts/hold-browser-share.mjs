import WebSocket from "ws";

const appUrl = process.env.DIRECTDROP_VERIFY_URL ?? "https://share.dlfkd.dev";
const signalingUrl =
  process.env.DIRECTDROP_VERIFY_WS ?? "wss://share.dlfkd.dev/ws";
const created = await fetch(`${appUrl}/api/shares`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    files: [
      {
        id: "public-browser-verification-file",
        name: "2026_최종프로젝트_진짜최종_수정본_진짜최종.zip",
        size: 2_469_135_780,
        mimeType: "application/zip",
      },
    ],
    downloadLimit: 3,
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    appLifetime: false,
    approvalMode: "MANUAL",
    allowRelay: false,
  }),
}).then((response) => {
  if (!response.ok) throw new Error(`SHARE_CREATE_FAILED_${response.status}`);
  return response.json();
});

const socket = new WebSocket(signalingUrl);
await new Promise((resolve, reject) => {
  socket.once("open", resolve);
  socket.once("error", reject);
});
socket.send(
  JSON.stringify({
    type: "REGISTER_SHARE",
    shareToken: created.token,
    controlKey: created.controlKey,
  }),
);

const heartbeat = setInterval(() => {
  if (socket.readyState === WebSocket.OPEN)
    socket.send(
      JSON.stringify({ type: "HEARTBEAT", shareToken: created.token }),
    );
}, 25_000);

async function cleanup() {
  clearInterval(heartbeat);
  socket.close();
  await fetch(`${appUrl}/api/shares/${created.token}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${created.controlKey}` },
  }).catch(() => undefined);
  process.exit(0);
}

process.once("SIGINT", () => void cleanup());
process.once("SIGTERM", () => void cleanup());
console.log(`Browser verification share: ${created.url}`);
