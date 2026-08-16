import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { CreateShareInput } from "@directdrop/protocol";
import { DirectDropStore } from "../src/store.js";

const baseShare: CreateShareInput = {
  files: [
    {
      id: "public-file-1",
      name: "safe.txt",
      size: 4,
      mimeType: "text/plain",
      modifiedAt: 1,
    },
  ],
  downloadLimit: 1,
  expiresAt: null,
  appLifetime: false,
  approvalMode: "AUTO",
  allowRelay: false,
};

describe("DirectDropStore", () => {
  let store: DirectDropStore;
  beforeEach(() => {
    store = new DirectDropStore(":memory:");
  });
  afterEach(() => store.close());

  it("generates non-sequential URL-safe share tokens", () => {
    const one = store.createShare(baseShare, null);
    const two = store.createShare(baseShare, null);
    expect(one.token).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(two.token).not.toBe(one.token);
  });

  it("never stores a local path", () => {
    const created = store.createShare(baseShare, null);
    const serialized = JSON.stringify(store.getShareByToken(created.token));
    expect(serialized).not.toContain("/Users/");
    expect(serialized).not.toContain("C:\\\\Users");
  });

  it("allows exactly one concurrent reservation for the final slot", () => {
    const created = store.createShare({ ...baseShare, downloadLimit: 3 }, null);
    for (let index = 0; index < 2; index += 1) {
      const reserved = store.reserveDownload(created.token, `done-${index}`);
      expect(reserved.ok).toBe(true);
      if (reserved.ok) {
        store.setSessionState(reserved.session.id, "CONNECTING");
        store.setSessionState(reserved.session.id, "TRANSFERRING");
        store.markSessionSent(reserved.session.id);
        store.markSessionReceived(reserved.session.id);
        expect(store.completeSession(reserved.session.id).changed).toBe(true);
      }
    }
    const attempts = Array.from({ length: 10 }, (_, index) =>
      store.reserveDownload(created.token, `peer-${index}`),
    );
    expect(attempts.filter((result) => result.ok)).toHaveLength(1);
  });

  it("returns slots after failure and only counts completion once", () => {
    const created = store.createShare(baseShare, null);
    const failed = store.reserveDownload(created.token, "failed");
    expect(failed.ok).toBe(true);
    if (failed.ok) store.setSessionState(failed.session.id, "FAILED");
    const retry = store.reserveDownload(created.token, "retry");
    expect(retry.ok).toBe(true);
    if (retry.ok) {
      store.setSessionState(retry.session.id, "CONNECTING");
      store.setSessionState(retry.session.id, "TRANSFERRING");
      store.markSessionSent(retry.session.id);
      store.markSessionReceived(retry.session.id);
      expect(store.completeSession(retry.session.id).changed).toBe(true);
      expect(store.completeSession(retry.session.id).changed).toBe(false);
    }
    expect(store.getShareByToken(created.token)?.completedDownloads).toBe(1);
  });

  it("requires independent sender and receiver confirmation before counting", () => {
    const created = store.createShare(baseShare, null);
    const reserved = store.reserveDownload(created.token, "receiver");
    expect(reserved.ok).toBe(true);
    if (!reserved.ok) return;
    store.setSessionState(reserved.session.id, "CONNECTING");
    store.setSessionState(reserved.session.id, "TRANSFERRING");

    store.markSessionReceived(reserved.session.id);
    expect(store.completeSession(reserved.session.id).changed).toBe(false);
    expect(store.getShareByToken(created.token)?.completedDownloads).toBe(0);

    store.markSessionSent(reserved.session.id);
    expect(store.completeSession(reserved.session.id).changed).toBe(true);
    expect(store.getShareByToken(created.token)?.completedDownloads).toBe(1);
  });

  it("marks expired shares lazily without touching files", () => {
    const created = store.createShare(
      { ...baseShare, expiresAt: new Date(Date.now() - 1000).toISOString() },
      null,
    );
    expect(store.getShareByToken(created.token)?.status).toBe("EXPIRED");
    expect(store.countCleanupCandidates()).toBe(1);
  });

  it("migrates legacy session tables without losing rows", () => {
    const directory = mkdtempSync(join(tmpdir(), "directdrop-migration-"));
    const databasePath = join(directory, "legacy.sqlite3");
    try {
      const legacy = new Database(databasePath);
      legacy.exec(`
        CREATE TABLE download_sessions (
          id TEXT PRIMARY KEY,
          share_id TEXT NOT NULL,
          receiver_peer_id TEXT NOT NULL,
          state TEXT NOT NULL,
          started_at TEXT NOT NULL,
          completed_at TEXT,
          updated_at TEXT NOT NULL
        );
        INSERT INTO download_sessions VALUES (
          'legacy-session', 'legacy-share', 'legacy-peer', 'FAILED',
          '2026-08-17T00:00:00.000Z', NULL, '2026-08-17T00:00:00.000Z'
        );
      `);
      legacy.close();

      const migrated = new DirectDropStore(databasePath);
      const columns = migrated.db.pragma(
        "table_info(download_sessions)",
      ) as Array<{ name: string }>;
      expect(columns.map((column) => column.name)).toEqual(
        expect.arrayContaining(["sender_confirmed", "receiver_confirmed"]),
      );
      expect(
        migrated.db
          .prepare("SELECT COUNT(*) AS count FROM download_sessions")
          .get(),
      ).toEqual({ count: 1 });
      migrated.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
