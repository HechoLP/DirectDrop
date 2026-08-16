import WebSocket from "ws";

const appUrl = process.env.DIRECTDROP_VERIFY_URL ?? "https://share.dlfkd.dev";
const signalingUrl =
  process.env.DIRECTDROP_VERIFY_WS ?? "wss://share.dlfkd.dev/ws";

function client() {
  const socket = new WebSocket(signalingUrl);
  const queue = [];
  const waiters = [];
  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    const index = waiters.findIndex((waiter) => waiter.type === message.type);
    if (index >= 0) waiters.splice(index, 1)[0].resolve(message);
    else queue.push(message);
  });
  const opened = new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return {
    socket,
    opened,
    send(message) {
      socket.send(JSON.stringify(message));
    },
    next(type) {
      const index = queue.findIndex((message) => message.type === type);
      if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error(`Timed out waiting for ${type}`)),
          10_000,
        );
        waiters.push({
          type,
          resolve: (message) => {
            clearTimeout(timeout);
            resolve(message);
          },
        });
      });
    },
  };
}

const health = await fetch(`${appUrl}/health`);
if (!health.ok || (await health.json()).fileStorage !== false)
  throw new Error("PUBLIC_HEALTH_FAILED");

const createdResponse = await fetch(`${appUrl}/api/shares`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    files: [
      {
        id: "public-verification-file",
        name: "verification.txt",
        size: 12,
        mimeType: "text/plain",
      },
    ],
    downloadLimit: 1,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    appLifetime: false,
    approvalMode: "AUTO",
    allowRelay: false,
  }),
});
if (createdResponse.status !== 201)
  throw new Error(`PUBLIC_CREATE_FAILED_${createdResponse.status}`);
const share = await createdResponse.json();

try {
  const sender = client();
  const receiver = client();
  await Promise.all([sender.opened, receiver.opened]);
  await Promise.all([sender.next("CONNECTED"), receiver.next("CONNECTED")]);
  sender.send({
    type: "REGISTER_SHARE",
    shareToken: share.token,
    controlKey: share.controlKey,
  });
  await sender.next("REGISTERED");
  receiver.send({ type: "JOIN_SHARE", shareToken: share.token });
  const state = await receiver.next("SHARE_STATE");
  if (!state.senderOnline || state.status !== "ACTIVE")
    throw new Error("PUBLIC_PRESENCE_FAILED");
  const lookup = await fetch(`${appUrl}/api/shares/${share.token}`);
  if (!lookup.ok || !(await lookup.json()).senderOnline)
    throw new Error("PUBLIC_LOOKUP_FAILED");
  sender.socket.close();
  receiver.socket.close();
} finally {
  await fetch(`${appUrl}/api/shares/${share.token}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${share.controlKey}` },
  });
}

console.log("Public HTTPS, API, WSS, registration and presence verified.");
