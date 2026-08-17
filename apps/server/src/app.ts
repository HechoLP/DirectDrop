import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { LogController, type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import { hash, verify } from "@node-rs/argon2";
import {
  APP_VERSION,
  createShareSchema,
  type ShareMetadata,
} from "@directdrop/protocol";
import { loadConfig, type DirectDropConfig } from "./config.js";
import { SignalingHub } from "./signaling.js";
import { DirectDropStore, type StoredShare } from "./store.js";
import { secureToken } from "./token.js";

type AccessGrant = { shareId: string; expiresAt: number };
const ROUTE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const TRUSTED_REVERSE_PROXIES = ["127.0.0.1", "::1"];

export function robotsDirective(
  url: string,
  statusCode: number,
) {
  const path = url.split("?", 1)[0];
  return path === "/" &&
    statusCode >= 200 &&
    statusCode < 400
    ? "index, follow"
    : "noindex, nofollow, noarchive";
}

function metadata(
  share: StoredShare,
  senderOnline: boolean,
  unlocked: boolean,
): ShareMetadata {
  let status: ShareMetadata["status"] = senderOnline ? "ACTIVE" : "OFFLINE";
  if (share.status === "EXPIRED") status = "EXPIRED";
  else if (share.status === "STOPPED") status = "STOPPED";
  else if (
    share.downloadLimit !== null &&
    share.completedDownloads >= share.downloadLimit
  )
    status = "LIMIT_REACHED";
  const exposesFiles =
    unlocked && !["EXPIRED", "STOPPED", "LIMIT_REACHED"].includes(status);
  return {
    token: share.token,
    files: exposesFiles ? share.files : [],
    totalSize: exposesFiles
      ? share.files.reduce((total, file) => total + file.size, 0)
      : 0,
    expiresAt: share.expiresAt,
    downloadLimit: share.downloadLimit,
    completedDownloads: share.completedDownloads,
    senderOnline,
    passwordProtected: Boolean(share.passwordHash),
    approvalMode: share.approvalMode,
    allowRelay: share.allowRelay,
    status,
  };
}

export async function buildApp(
  options: { config?: DirectDropConfig; store?: DirectDropStore } = {},
): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  const store = options.store ?? new DirectDropStore(config.databasePath);
  const app = Fastify({
    logger: process.env.NODE_ENV !== "test",
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 1024 * 1024,
    // The production server is loopback-only behind cloudflared. Trust only
    // that immediate proxy hop so per-IP rate limits cannot collapse every
    // public user into 127.0.0.1 or be spoofed by a direct remote client.
    trustProxy: TRUSTED_REVERSE_PROXIES,
  });
  const grants = new Map<string, AccessGrant>();
  const grantTimers = new Map<string, NodeJS.Timeout>();

  app.addHook("onSend", async (request, reply, payload) => {
    reply
      .header("x-content-type-options", "nosniff")
      .header("referrer-policy", "no-referrer")
      .header("strict-transport-security", "max-age=31536000")
      .header("permissions-policy", "camera=(), microphone=(), geolocation=()")
      .header("x-frame-options", "DENY")
      .header(
        "x-robots-tag",
        robotsDirective(request.url, reply.statusCode),
      )
      .header(
        "content-security-policy",
        `default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data: blob:; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ${config.publicSignalingUrl}`,
      );
    if (
      request.url === "/health" ||
      request.url === "/ws" ||
      request.url.startsWith("/api/") ||
      request.headers.accept?.includes("text/html")
    ) {
      reply.header("cache-control", "no-store");
    }
    return payload;
  });

  const validateAccessToken = (shareId: string, token: string | undefined) => {
    if (!token) return false;
    const grant = grants.get(token);
    if (!grant || grant.shareId !== shareId || grant.expiresAt <= Date.now()) {
      grants.delete(token);
      const timer = grantTimers.get(token);
      if (timer) clearTimeout(timer);
      grantTimers.delete(token);
      return false;
    }
    return true;
  };

  await app.register(cors, {
    origin(origin, callback) {
      callback(null, !origin || config.allowedOrigins.includes(origin));
    },
  });
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  await app.register(websocket, {
    options: { maxPayload: 64 * 1024, perMessageDeflate: false },
  });
  const hub = new SignalingHub(
    store,
    app.log,
    validateAccessToken,
    config.presenceTimeoutMs,
    config.reservationTimeoutMs,
  );
  app.decorate("directDrop", { config, store, hub });

  app.get("/health", async () => ({
    ok: true,
    service: "DirectDrop",
    version: APP_VERSION,
    fileStorage: false,
  }));

  app.get("/api/config", async () => ({
    appUrl: config.publicAppUrl,
    signalingUrl: config.publicSignalingUrl,
    iceServers: [
      ...(config.stunUrls.length ? [{ urls: config.stunUrls }] : []),
      ...(config.turnUrls.length && config.turnUsername && config.turnCredential
        ? [
            {
              urls: config.turnUrls,
              username: config.turnUsername,
              credential: config.turnCredential,
            },
          ]
        : []),
    ],
  }));

  app.post(
    "/api/shares",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = createShareSchema.safeParse(request.body);
      if (!parsed.success)
        return reply
          .code(400)
          .send({ error: "INVALID_SHARE", details: parsed.error.flatten() });
      const passwordHash = parsed.data.password
        ? await hash(parsed.data.password, {
            memoryCost: 19_456,
            timeCost: 2,
            parallelism: 1,
          })
        : null;
      const created = store.createShare(parsed.data, passwordHash);
      return reply.code(201).send({
        token: created.token,
        controlKey: created.controlKey,
        url: `${config.publicAppUrl}/s/${created.token}`,
      });
    },
  );

  app.get<{ Params: { token: string } }>(
    "/api/shares/:token",
    { config: { rateLimit: { max: 90, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (!ROUTE_TOKEN_PATTERN.test(request.params.token))
        return reply.code(404).send({ error: "SHARE_NOT_FOUND" });
      const share = store.getShareByToken(request.params.token);
      if (!share) return reply.code(404).send({ error: "SHARE_NOT_FOUND" });
      const bearer = request.headers.authorization?.replace(/^Bearer\s+/i, "");
      return metadata(
        share,
        hub.isSenderOnline(share.token),
        !share.passwordHash || validateAccessToken(share.id, bearer),
      );
    },
  );

  app.post<{ Params: { token: string }; Body: { password?: string } }>(
    "/api/shares/:token/verify",
    { config: { rateLimit: { max: 8, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (!ROUTE_TOKEN_PATTERN.test(request.params.token))
        return reply.code(404).send({ error: "SHARE_NOT_FOUND" });
      const share = store.getShareByToken(request.params.token);
      if (!share) return reply.code(404).send({ error: "SHARE_NOT_FOUND" });
      if (
        share.status !== "ACTIVE" ||
        (share.downloadLimit !== null &&
          share.completedDownloads >= share.downloadLimit)
      )
        return reply.code(410).send({ error: "SHARE_UNAVAILABLE" });
      if (!share.passwordHash) return reply.send({ accessToken: null });
      if (
        typeof request.body?.password !== "string" ||
        request.body.password.length < 8 ||
        request.body.password.length > 128 ||
        !(await verify(share.passwordHash, request.body.password))
      )
        return reply.code(401).send({ error: "INVALID_PASSWORD" });
      const accessToken = secureToken(24);
      grants.set(accessToken, {
        shareId: share.id,
        expiresAt: Date.now() + 10 * 60 * 1000,
      });
      const timer = setTimeout(() => {
        grants.delete(accessToken);
        grantTimers.delete(accessToken);
      }, 10 * 60 * 1000);
      timer.unref();
      grantTimers.set(accessToken, timer);
      return { accessToken };
    },
  );

  app.delete<{ Params: { token: string } }>(
    "/api/shares/:token",
    async (request, reply) => {
      if (!ROUTE_TOKEN_PATTERN.test(request.params.token))
        return reply.code(403).send({ error: "SHARE_AUTH_FAILED" });
      const key = request.headers.authorization?.replace(/^Bearer\s+/i, "");
      if (!key || !store.stopShare(request.params.token, key))
        return reply.code(403).send({ error: "SHARE_AUTH_FAILED" });
      return reply.code(204).send();
    },
  );

  app.get(
    "/ws",
    {
      websocket: true,
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    (socket, request) => {
      const origin = request.headers.origin;
      if (origin && !config.allowedOrigins.includes(origin)) {
        socket.close(1008, "origin not allowed");
        return;
      }
      hub.add(socket, request.ip);
    },
  );

  const webRoot = resolve(
    fileURLToPath(new URL("../../web/dist", import.meta.url)),
  );
  const hasWebRoot = existsSync(webRoot);
  if (hasWebRoot) {
    await app.register(fastifyStatic, {
      root: webRoot,
      wildcard: false,
      setHeaders(response, filePath) {
        if (filePath.startsWith(resolve(webRoot, "assets"))) {
          response.header(
            "cache-control",
            "public, max-age=31536000, immutable",
          );
        } else {
          response.header("cache-control", "no-store");
        }
      },
    });
  }
  app.setNotFoundHandler((request, reply) => {
    if (
      hasWebRoot &&
      request.method === "GET" &&
      request.headers.accept?.includes("text/html")
    )
      return reply.sendFile("index.html");
    return reply
      .header("cache-control", "no-store")
      .code(404)
      .send({ error: "NOT_FOUND" });
  });

  let cleanupTimer: NodeJS.Timeout | undefined;
  if (config.cleanupMode !== "off") {
    cleanupTimer = setInterval(() => {
      store.releaseExpiredReservations(config.reservationTimeoutMs);
      if (
        config.cleanupMode === "always" ||
        store.countCleanupCandidates() >= config.cleanupAutoThreshold
      )
        store.cleanupMetadata();
    }, 60_000);
    cleanupTimer.unref();
  }

  app.addHook("onClose", async () => {
    if (cleanupTimer) clearInterval(cleanupTimer);
    grantTimers.forEach((timer) => clearTimeout(timer));
    grantTimers.clear();
    grants.clear();
    hub.shutdown();
    store.close();
  });
  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    directDrop: {
      config: DirectDropConfig;
      store: DirectDropStore;
      hub: SignalingHub;
    };
  }
}
