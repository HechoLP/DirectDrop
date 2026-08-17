import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { APP_VERSION } from "@directdrop/protocol";
import { buildApp, robotsDirective } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { DirectDropStore } from "../src/store.js";

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function testApp(extra: Record<string, string> = {}) {
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_PATH: ":memory:",
    BACKGROUND_CLEANUP_MODE: "off",
    ...extra,
  });
  const app = await buildApp({
    config,
    store: new DirectDropStore(":memory:"),
  });
  apps.push(app);
  return app;
}

describe("DirectDrop API", () => {
  it("indexes only the successful public landing page", () => {
    expect(robotsDirective("/", "text/html", 200)).toBe("index, follow");
    expect(robotsDirective("/?from=github", "text/html", 200)).toBe(
      "index, follow",
    );
    expect(robotsDirective("/s/private-share", "text/html", 200)).toBe(
      "noindex, nofollow, noarchive",
    );
    expect(robotsDirective("/", "text/html", 404)).toBe(
      "noindex, nofollow, noarchive",
    );
  });

  it("reports that health does not use file storage", async () => {
    const app = await testApp();
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      service: "DirectDrop",
      version: APP_VERSION,
      fileStorage: false,
    });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["x-robots-tag"]).toBe(
      "noindex, nofollow, noarchive",
    );
    expect(response.headers["content-security-policy"]).toContain(
      "default-src 'self'",
    );
  });

  it("prevents stale HTML and missing-resource responses from being cached", async () => {
    const app = await testApp();
    const page = await app.inject({
      method: "GET",
      url: "/s/example",
      headers: { accept: "text/html" },
    });
    expect(page.headers["cache-control"]).toBe("no-store");

    const missing = await app.inject({
      method: "GET",
      url: "/missing.js",
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.headers["cache-control"]).toBe("no-store");
  });

  it("creates and retrieves a share without exposing its control key", async () => {
    const app = await testApp();
    const created = await app.inject({
      method: "POST",
      url: "/api/shares",
      payload: {
        files: [
          {
            id: "public-file-1",
            name: "movie.mp4",
            size: 1024,
            mimeType: "video/mp4",
          },
        ],
        downloadLimit: 3,
        expiresAt: null,
        appLifetime: false,
        approvalMode: "AUTO",
        allowRelay: false,
      },
    });
    expect(created.statusCode).toBe(201);
    const body = created.json();
    const lookup = await app.inject({
      method: "GET",
      url: `/api/shares/${body.token}`,
    });
    expect(lookup.json()).toMatchObject({
      token: body.token,
      completedDownloads: 0,
      passwordProtected: false,
    });
    expect(lookup.body).not.toContain(body.controlKey);
  });

  it("hides protected metadata until Argon2id verification succeeds", async () => {
    const app = await testApp();
    const created = await app.inject({
      method: "POST",
      url: "/api/shares",
      payload: {
        files: [
          {
            id: "public-file-1",
            name: "secret.zip",
            size: 50,
            mimeType: "application/zip",
          },
        ],
        downloadLimit: 1,
        expiresAt: null,
        appLifetime: false,
        password: "correct horse battery staple",
        approvalMode: "AUTO",
        allowRelay: false,
      },
    });
    const { token } = created.json();
    expect(
      (await app.inject({ method: "GET", url: `/api/shares/${token}` })).json()
        .files,
    ).toEqual([]);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/shares/${token}/verify`,
          payload: { password: "wrong-password" },
        })
      ).statusCode,
    ).toBe(401);
    const verified = await app.inject({
      method: "POST",
      url: `/api/shares/${token}/verify`,
      payload: { password: "correct horse battery staple" },
    });
    const accessToken = verified.json().accessToken;
    const unlocked = await app.inject({
      method: "GET",
      url: `/api/shares/${token}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(unlocked.json().files).toHaveLength(1);
  });

  it("does not start a cleanup loop when mode is off", async () => {
    const app = await testApp({ BACKGROUND_CLEANUP_MODE: "off" });
    expect(app.directDrop.config.cleanupMode).toBe("off");
  });

  it("rejects malformed route tokens before share lookup", async () => {
    const app = await testApp();
    const lookup = await app.inject({
      method: "GET",
      url: "/api/shares/not%21valid",
    });
    expect(lookup.statusCode).toBe(404);
    expect(lookup.json()).toEqual({ error: "SHARE_NOT_FOUND" });
  });
});
