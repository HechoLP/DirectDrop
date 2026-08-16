import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
      expect(store.completeSession(retry.session.id).changed).toBe(true);
      expect(store.completeSession(retry.session.id).changed).toBe(false);
    }
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
});
