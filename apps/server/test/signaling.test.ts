import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import type { ServerMessage } from "@directdrop/protocol";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { DirectDropStore } from "../src/store.js";
import { MAX_ACTIVE_SIGNALING_CONNECTIONS_PER_IP } from "../src/signaling.js";

type TestClient = {
  socket: WebSocket;
  send: (message: object) => void;
  next: <T extends ServerMessage["type"]>(
    type: T,
  ) => Promise<Extract<ServerMessage, { type: T }>>;
};

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function signalingApp(extra: Record<string, string> = {}) {
  const store = new DirectDropStore(":memory:");
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_PATH: ":memory:",
    BACKGROUND_CLEANUP_MODE: "off",
    ...extra,
  });
  const app = await buildApp({ config, store });
  await app.listen({ host: "127.0.0.1", port: 0 });
  apps.push(app);
  const address = app.server.address();
  if (!address || typeof address === "string")
    throw new Error("TEST_SERVER_ADDRESS_MISSING");
  return { app, store, url: `ws://127.0.0.1:${address.port}/ws` };
}

async function connect(url: string): Promise<TestClient> {
  const socket = new WebSocket(url);
  const queued: ServerMessage[] = [];
  const waiters: Array<{
    type: ServerMessage["type"];
    resolve: (message: ServerMessage) => void;
  }> = [];
  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString()) as ServerMessage;
    const waiterIndex = waiters.findIndex(
      (waiter) => waiter.type === message.type,
    );
    if (waiterIndex >= 0) waiters.splice(waiterIndex, 1)[0]!.resolve(message);
    else queued.push(message);
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return {
    socket,
    send(message) {
      socket.send(JSON.stringify(message));
    },
    next(type) {
      const queuedIndex = queued.findIndex((message) => message.type === type);
      if (queuedIndex >= 0)
        return Promise.resolve(queued.splice(queuedIndex, 1)[0] as never);
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error(`Timed out waiting for ${type}`)),
          2_000,
        );
        waiters.push({
          type,
          resolve: (message) => {
            clearTimeout(timeout);
            resolve(message as never);
          },
        });
      });
    },
  };
}

function createShare(store: DirectDropStore, downloadLimit = 1) {
  return store.createShare(
    {
      files: [
        {
          id: "public-file-1",
          name: "video.mp4",
          size: 1_000_000,
          mimeType: "video/mp4",
        },
      ],
      downloadLimit,
      expiresAt: null,
      appLifetime: false,
      approvalMode: "AUTO",
      allowRelay: false,
    },
    null,
  );
}

describe("WebSocket signaling", () => {
  it("routes a complete transfer and counts it exactly once", async () => {
    const { store, url } = await signalingApp();
    const share = createShare(store);
    const sender = await connect(url);
    const receiver = await connect(url);
    const intruder = await connect(url);
    await Promise.all([
      sender.next("CONNECTED"),
      receiver.next("CONNECTED"),
      intruder.next("CONNECTED"),
    ]);

    sender.send({
      type: "REGISTER_SHARE",
      shareToken: share.token,
      controlKey: share.controlKey,
    });
    await sender.next("REGISTERED");
    receiver.send({ type: "JOIN_SHARE", shareToken: share.token });
    await receiver.next("SHARE_STATE");
    receiver.send({ type: "DOWNLOAD_REQUEST", shareToken: share.token });
    const requested = await sender.next("DOWNLOAD_REQUESTED");

    intruder.send({
      type: "TRANSFER_FAILED",
      sessionId: requested.sessionId,
      reason: "forged",
    });
    expect((await intruder.next("ERROR")).code).toBe("INVALID_SESSION");

    sender.send({
      type: "DOWNLOAD_ACCEPT",
      sessionId: requested.sessionId,
      peerId: requested.peerId,
    });
    await receiver.next("DOWNLOAD_ACCEPTED");
    sender.send({
      type: "OFFER",
      sessionId: requested.sessionId,
      toPeerId: requested.peerId,
      sdp: "test-offer",
    });
    expect((await receiver.next("OFFER")).sdp).toBe("test-offer");

    sender.send({ type: "TRANSFER_STARTED", sessionId: requested.sessionId });
    await Promise.all([
      sender.next("TRANSFER_STATE"),
      receiver.next("TRANSFER_STATE"),
    ]);
    receiver.send({
      type: "TRANSFER_COMPLETED",
      sessionId: requested.sessionId,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(store.getShareByToken(share.token)?.completedDownloads).toBe(0);
    sender.send({ type: "TRANSFER_SENT", sessionId: requested.sessionId });
    const [senderComplete, receiverComplete] = await Promise.all([
      sender.next("TRANSFER_STATE"),
      receiver.next("TRANSFER_STATE"),
    ]);
    expect(senderComplete.state).toBe("COMPLETED");
    expect(receiverComplete.completedDownloads).toBe(1);

    receiver.send({
      type: "TRANSFER_COMPLETED",
      sessionId: requested.sessionId,
    });
    expect((await receiver.next("ERROR")).code).toBe("INVALID_SESSION_STATE");
    expect(store.getShareByToken(share.token)?.completedDownloads).toBe(1);
    receiver.send({ type: "DOWNLOAD_REQUEST", shareToken: share.token });
    expect((await receiver.next("ERROR")).code).toBe("DOWNLOAD_LIMIT_REACHED");
  });

  it("releases a reserved slot when the receiver disconnects", async () => {
    const { store, url } = await signalingApp();
    const share = createShare(store);
    const sender = await connect(url);
    const first = await connect(url);
    await Promise.all([sender.next("CONNECTED"), first.next("CONNECTED")]);
    sender.send({
      type: "REGISTER_SHARE",
      shareToken: share.token,
      controlKey: share.controlKey,
    });
    await sender.next("REGISTERED");
    first.send({ type: "JOIN_SHARE", shareToken: share.token });
    await first.next("SHARE_STATE");
    first.send({ type: "DOWNLOAD_REQUEST", shareToken: share.token });
    await sender.next("DOWNLOAD_REQUESTED");
    first.socket.close();
    await new Promise<void>((resolve) =>
      first.socket.once("close", () => resolve()),
    );

    const retry = await connect(url);
    await retry.next("CONNECTED");
    retry.send({ type: "JOIN_SHARE", shareToken: share.token });
    await retry.next("SHARE_STATE");
    retry.send({ type: "DOWNLOAD_REQUEST", shareToken: share.token });
    expect((await sender.next("DOWNLOAD_REQUESTED")).shareToken).toBe(
      share.token,
    );
  });

  it("expires an abandoned reservation even when background cleanup is off", async () => {
    const { store, url } = await signalingApp({
      RESERVATION_TIMEOUT_MS: "25",
    });
    const share = createShare(store);
    const sender = await connect(url);
    const receiver = await connect(url);
    await Promise.all([sender.next("CONNECTED"), receiver.next("CONNECTED")]);
    sender.send({
      type: "REGISTER_SHARE",
      shareToken: share.token,
      controlKey: share.controlKey,
    });
    await sender.next("REGISTERED");
    receiver.send({ type: "JOIN_SHARE", shareToken: share.token });
    await receiver.next("SHARE_STATE");
    receiver.send({ type: "DOWNLOAD_REQUEST", shareToken: share.token });
    await sender.next("DOWNLOAD_REQUESTED");
    expect((await receiver.next("TRANSFER_STATE")).state).toBe("FAILED");

    receiver.send({ type: "DOWNLOAD_REQUEST", shareToken: share.token });
    expect((await sender.next("DOWNLOAD_REQUESTED")).shareToken).toBe(
      share.token,
    );
  });

  it("releases a transferring slot when activity stops", async () => {
    const { store, url } = await signalingApp({
      RESERVATION_TIMEOUT_MS: "25",
    });
    const share = createShare(store);
    const sender = await connect(url);
    const receiver = await connect(url);
    await Promise.all([sender.next("CONNECTED"), receiver.next("CONNECTED")]);
    sender.send({
      type: "REGISTER_SHARE",
      shareToken: share.token,
      controlKey: share.controlKey,
    });
    await sender.next("REGISTERED");
    receiver.send({ type: "JOIN_SHARE", shareToken: share.token });
    await receiver.next("SHARE_STATE");
    receiver.send({ type: "DOWNLOAD_REQUEST", shareToken: share.token });
    const request = await sender.next("DOWNLOAD_REQUESTED");
    sender.send({
      type: "DOWNLOAD_ACCEPT",
      sessionId: request.sessionId,
      peerId: request.peerId,
    });
    await receiver.next("DOWNLOAD_ACCEPTED");
    sender.send({ type: "TRANSFER_STARTED", sessionId: request.sessionId });
    await Promise.all([
      sender.next("TRANSFER_STATE"),
      receiver.next("TRANSFER_STATE"),
    ]);
    expect((await receiver.next("TRANSFER_STATE")).state).toBe("FAILED");
    expect(store.getShareByToken(share.token)?.completedDownloads).toBe(0);

    receiver.send({ type: "DOWNLOAD_REQUEST", shareToken: share.token });
    expect((await sender.next("DOWNLOAD_REQUESTED")).shareToken).toBe(
      share.token,
    );
  });

  it("rejects WebSocket upgrades from an untrusted browser origin", async () => {
    const { app, url } = await signalingApp();
    const socket = new WebSocket(url, {
      origin: "https://attacker.invalid",
    });
    const code = await new Promise<number>((resolve, reject) => {
      socket.once("close", resolve);
      socket.once("error", reject);
    });
    expect(code).toBe(1008);
    expect(app.directDrop.hub.peers.size).toBe(0);
  });

  it("caps long-lived signaling connections from one client address", async () => {
    const { app, url } = await signalingApp();
    const clients = await Promise.all(
      Array.from(
        { length: MAX_ACTIVE_SIGNALING_CONNECTIONS_PER_IP },
        () => connect(url),
      ),
    );
    await Promise.all(clients.map((client) => client.next("CONNECTED")));

    const overflow = new WebSocket(url);
    const code = await new Promise<number>((resolve, reject) => {
      overflow.once("close", resolve);
      overflow.once("error", reject);
    });
    expect(code).toBe(1013);
    expect(app.directDrop.hub.peers.size).toBe(
      MAX_ACTIVE_SIGNALING_CONNECTIONS_PER_IP,
    );
  });
});
