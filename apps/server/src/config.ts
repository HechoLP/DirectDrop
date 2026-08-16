import { resolve } from "node:path";

export type CleanupMode = "off" | "auto" | "always";

function numberFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const port = numberFromEnv(env.PORT, 8787);
  const publicAppUrl = env.PUBLIC_APP_URL ?? `http://localhost:${port}`;
  return {
    host: env.HOST ?? "127.0.0.1",
    port,
    databasePath:
      env.DATABASE_PATH === ":memory:"
        ? ":memory:"
        : resolve(env.DATABASE_PATH ?? "./data/directdrop-server.sqlite3"),
    publicAppUrl: publicAppUrl.replace(/\/$/, ""),
    publicSignalingUrl:
      env.PUBLIC_SIGNALING_URL ??
      `${publicAppUrl.replace(/^http/, "ws").replace(/\/$/, "")}/ws`,
    allowedOrigins: (
      env.ALLOWED_ORIGINS ??
      "http://localhost:5173,http://localhost:5174,tauri://localhost,https://tauri.localhost"
    )
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    stunUrls: (env.STUN_URLS ?? "stun:stun.cloudflare.com:3478")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    turnUrls: (env.TURN_URLS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    turnUsername: env.TURN_USERNAME ?? "",
    turnCredential: env.TURN_CREDENTIAL ?? "",
    cleanupMode: (["off", "auto", "always"].includes(
      env.BACKGROUND_CLEANUP_MODE ?? "off",
    )
      ? env.BACKGROUND_CLEANUP_MODE
      : "off") as CleanupMode,
    cleanupAutoThreshold: numberFromEnv(env.CLEANUP_AUTO_THRESHOLD, 1000),
    presenceTimeoutMs: numberFromEnv(env.PRESENCE_TIMEOUT_MS, 65_000),
    reservationTimeoutMs: numberFromEnv(env.RESERVATION_TIMEOUT_MS, 120_000),
  };
}

export type DirectDropConfig = ReturnType<typeof loadConfig>;
