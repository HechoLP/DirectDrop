import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type {
  ApprovalMode,
  CreateShareInput,
  DownloadSessionState,
  PublicFile,
} from "@directdrop/protocol";
import {
  controlKey,
  hashControlKey,
  secureToken,
  verifyControlKey,
} from "./token.js";

type ShareRow = {
  id: string;
  token: string;
  control_key_hash: string;
  expires_at: string | null;
  download_limit: number | null;
  completed_downloads: number;
  password_hash: string | null;
  approval_mode: ApprovalMode;
  allow_relay: number;
  app_lifetime: number;
  status: "ACTIVE" | "STOPPED" | "EXPIRED";
  created_at: string;
  updated_at: string;
};

type FileRow = {
  public_id: string;
  display_name: string;
  size: number;
  mime_type: string;
  modified_at: number | null;
};

export type StoredShare = {
  id: string;
  token: string;
  expiresAt: string | null;
  downloadLimit: number | null;
  completedDownloads: number;
  passwordHash: string | null;
  approvalMode: ApprovalMode;
  allowRelay: boolean;
  appLifetime: boolean;
  status: "ACTIVE" | "STOPPED" | "EXPIRED";
  files: PublicFile[];
};

export type StoredDownloadSession = {
  id: string;
  shareId: string;
  receiverPeerId: string;
  state: DownloadSessionState;
  senderConfirmed: boolean;
  receiverConfirmed: boolean;
};

export class DirectDropStore {
  readonly db: Database.Database;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("foreign_keys = ON");
    if (path !== ":memory:") this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS shares (
        id TEXT PRIMARY KEY,
        token TEXT NOT NULL UNIQUE,
        control_key_hash TEXT NOT NULL,
        expires_at TEXT,
        download_limit INTEGER,
        completed_downloads INTEGER NOT NULL DEFAULT 0,
        password_hash TEXT,
        approval_mode TEXT NOT NULL CHECK (approval_mode IN ('AUTO', 'MANUAL')),
        allow_relay INTEGER NOT NULL DEFAULT 0,
        app_lifetime INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'STOPPED', 'EXPIRED')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS share_files (
        share_id TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
        public_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        size INTEGER NOT NULL,
        mime_type TEXT NOT NULL,
        modified_at INTEGER,
        PRIMARY KEY (share_id, public_id)
      );
      CREATE TABLE IF NOT EXISTS download_sessions (
        id TEXT PRIMARY KEY,
        share_id TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
        receiver_peer_id TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('PENDING','RESERVED','CONNECTING','TRANSFERRING','COMPLETED','FAILED','CANCELLED')),
        started_at TEXT NOT NULL,
        completed_at TEXT,
        sender_confirmed INTEGER NOT NULL DEFAULT 0,
        receiver_confirmed INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS download_sessions_share_state_idx ON download_sessions(share_id, state);
      CREATE INDEX IF NOT EXISTS download_sessions_receiver_idx ON download_sessions(receiver_peer_id, state);
    `);
    const sessionColumns = this.db.pragma("table_info(download_sessions)") as {
      name: string;
    }[];
    if (!sessionColumns.some((column) => column.name === "sender_confirmed"))
      this.db.exec(
        "ALTER TABLE download_sessions ADD COLUMN sender_confirmed INTEGER NOT NULL DEFAULT 0",
      );
    if (!sessionColumns.some((column) => column.name === "receiver_confirmed"))
      this.db.exec(
        "ALTER TABLE download_sessions ADD COLUMN receiver_confirmed INTEGER NOT NULL DEFAULT 0",
      );
  }

  close() {
    this.db.close();
  }

  createShare(input: CreateShareInput, passwordHash: string | null) {
    const create = this.db.transaction(() => {
      const id = secureToken(18);
      const token = secureToken(12);
      const key = controlKey();
      const now = new Date().toISOString();
      this.db
        .prepare(
          `
        INSERT INTO shares (id, token, control_key_hash, expires_at, download_limit, password_hash, approval_mode, allow_relay, app_lifetime, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        )
        .run(
          id,
          token,
          hashControlKey(key),
          input.expiresAt,
          input.downloadLimit,
          passwordHash,
          input.approvalMode,
          input.allowRelay ? 1 : 0,
          input.appLifetime ? 1 : 0,
          now,
          now,
        );

      const insertFile = this.db.prepare(`
        INSERT INTO share_files (share_id, public_id, display_name, size, mime_type, modified_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const file of input.files) {
        insertFile.run(
          id,
          file.id,
          file.name,
          file.size,
          file.mimeType,
          file.modifiedAt ?? null,
        );
      }
      return { id, token, controlKey: key };
    });
    return create();
  }

  private hydrate(row: ShareRow | undefined): StoredShare | null {
    if (!row) return null;
    if (
      row.status === "ACTIVE" &&
      row.expires_at &&
      Date.parse(row.expires_at) <= Date.now()
    ) {
      this.db
        .prepare(
          "UPDATE shares SET status = 'EXPIRED', updated_at = ? WHERE id = ?",
        )
        .run(new Date().toISOString(), row.id);
      row.status = "EXPIRED";
    }
    const files = this.db
      .prepare(
        "SELECT public_id, display_name, size, mime_type, modified_at FROM share_files WHERE share_id = ? ORDER BY rowid",
      )
      .all(row.id) as FileRow[];
    return {
      id: row.id,
      token: row.token,
      expiresAt: row.expires_at,
      downloadLimit: row.download_limit,
      completedDownloads: row.completed_downloads,
      passwordHash: row.password_hash,
      approvalMode: row.approval_mode,
      allowRelay: Boolean(row.allow_relay),
      appLifetime: Boolean(row.app_lifetime),
      status: row.status,
      files: files.map((file) => ({
        id: file.public_id,
        name: file.display_name,
        size: file.size,
        mimeType: file.mime_type,
        ...(file.modified_at === null ? {} : { modifiedAt: file.modified_at }),
      })),
    };
  }

  getShareByToken(token: string): StoredShare | null {
    return this.hydrate(
      this.db.prepare("SELECT * FROM shares WHERE token = ?").get(token) as
        ShareRow | undefined,
    );
  }

  getShareById(id: string): StoredShare | null {
    return this.hydrate(
      this.db.prepare("SELECT * FROM shares WHERE id = ?").get(id) as
        ShareRow | undefined,
    );
  }

  authorizeShare(token: string, key: string): StoredShare | null {
    const row = this.db
      .prepare("SELECT * FROM shares WHERE token = ?")
      .get(token) as ShareRow | undefined;
    if (!row || !verifyControlKey(key, row.control_key_hash)) return null;
    return this.hydrate(row);
  }

  stopShare(token: string, key: string): boolean {
    const share = this.authorizeShare(token, key);
    if (!share) return false;
    this.db
      .prepare(
        "UPDATE shares SET status = 'STOPPED', updated_at = ? WHERE id = ?",
      )
      .run(new Date().toISOString(), share.id);
    this.failSessionsForShare(share.id);
    return true;
  }

  reserveDownload(
    token: string,
    receiverPeerId: string,
  ):
    | { ok: true; session: StoredDownloadSession; share: StoredShare }
    | { ok: false; code: string } {
    const reserve = this.db.transaction(() => {
      const share = this.getShareByToken(token);
      if (!share) return { ok: false as const, code: "SHARE_NOT_FOUND" };
      if (share.status === "EXPIRED")
        return { ok: false as const, code: "SHARE_EXPIRED" };
      if (share.status !== "ACTIVE")
        return { ok: false as const, code: "SHARE_STOPPED" };
      const active = (
        this.db
          .prepare(
            `
        SELECT COUNT(*) AS count FROM download_sessions
        WHERE share_id = ? AND state IN ('PENDING','RESERVED','CONNECTING','TRANSFERRING')
      `,
          )
          .get(share.id) as { count: number }
      ).count;
      if (
        share.downloadLimit !== null &&
        share.completedDownloads + active >= share.downloadLimit
      ) {
        return { ok: false as const, code: "DOWNLOAD_LIMIT_REACHED" };
      }
      const session: StoredDownloadSession = {
        id: secureToken(18),
        shareId: share.id,
        receiverPeerId,
        state: "RESERVED",
        senderConfirmed: false,
        receiverConfirmed: false,
      };
      const now = new Date().toISOString();
      this.db
        .prepare(
          `
        INSERT INTO download_sessions (id, share_id, receiver_peer_id, state, started_at, updated_at)
        VALUES (?, ?, ?, 'RESERVED', ?, ?)
      `,
        )
        .run(session.id, share.id, receiverPeerId, now, now);
      return { ok: true as const, session, share };
    });
    return reserve();
  }

  getSession(id: string): StoredDownloadSession | null {
    const row = this.db
      .prepare(
        "SELECT id, share_id, receiver_peer_id, state, sender_confirmed, receiver_confirmed FROM download_sessions WHERE id = ?",
      )
      .get(id) as
      | {
          id: string;
          share_id: string;
          receiver_peer_id: string;
          state: DownloadSessionState;
          sender_confirmed: number;
          receiver_confirmed: number;
        }
      | undefined;
    return row
      ? {
          id: row.id,
          shareId: row.share_id,
          receiverPeerId: row.receiver_peer_id,
          state: row.state,
          senderConfirmed: Boolean(row.sender_confirmed),
          receiverConfirmed: Boolean(row.receiver_confirmed),
        }
      : null;
  }

  setSessionState(
    id: string,
    state: Exclude<DownloadSessionState, "COMPLETED">,
  ): boolean {
    const allowedFrom: Record<
      Exclude<DownloadSessionState, "COMPLETED">,
      DownloadSessionState[]
    > = {
      PENDING: [],
      RESERVED: [],
      CONNECTING: ["RESERVED"],
      TRANSFERRING: ["CONNECTING"],
      FAILED: ["PENDING", "RESERVED", "CONNECTING", "TRANSFERRING"],
      CANCELLED: ["PENDING", "RESERVED", "CONNECTING", "TRANSFERRING"],
    };
    const current = this.getSession(id);
    if (!current || !allowedFrom[state].includes(current.state)) return false;
    const result = this.db
      .prepare(
        `
      UPDATE download_sessions SET state = ?, updated_at = ?
      WHERE id = ? AND state = ?
    `,
      )
      .run(state, new Date().toISOString(), id, current.state);
    return result.changes === 1;
  }

  completeSession(id: string): {
    changed: boolean;
    completedDownloads?: number;
  } {
    const complete = this.db.transaction(() => {
      const session = this.getSession(id);
      if (
        !session ||
        session.state !== "TRANSFERRING" ||
        !session.senderConfirmed ||
        !session.receiverConfirmed
      )
        return { changed: false };
      const now = new Date().toISOString();
      const result = this.db
        .prepare(
          `
        UPDATE download_sessions SET state = 'COMPLETED', completed_at = ?, updated_at = ?
        WHERE id = ? AND state = 'TRANSFERRING'
      `,
        )
        .run(now, now, id);
      if (result.changes !== 1) return { changed: false };
      this.db
        .prepare(
          "UPDATE shares SET completed_downloads = completed_downloads + 1, updated_at = ? WHERE id = ?",
        )
        .run(now, session.shareId);
      const share = this.getShareById(session.shareId);
      return {
        changed: true,
        completedDownloads: share?.completedDownloads ?? 0,
      };
    });
    return complete();
  }

  markSessionSent(id: string): boolean {
    const result = this.db
      .prepare(
        `
      UPDATE download_sessions SET sender_confirmed = 1, updated_at = ?
      WHERE id = ? AND state = 'TRANSFERRING' AND sender_confirmed = 0
    `,
      )
      .run(new Date().toISOString(), id);
    return result.changes === 1;
  }

  markSessionReceived(id: string): boolean {
    const result = this.db
      .prepare(
        `
      UPDATE download_sessions SET receiver_confirmed = 1, updated_at = ?
      WHERE id = ? AND state = 'TRANSFERRING' AND receiver_confirmed = 0
    `,
      )
      .run(new Date().toISOString(), id);
    return result.changes === 1;
  }

  expirePendingSession(id: string): boolean {
    const result = this.db
      .prepare(
        `
      UPDATE download_sessions SET state = 'FAILED', updated_at = ?
      WHERE id = ? AND state IN ('PENDING','RESERVED','CONNECTING')
    `,
      )
      .run(new Date().toISOString(), id);
    return result.changes === 1;
  }

  expireActiveSession(id: string): boolean {
    const result = this.db
      .prepare(
        `
      UPDATE download_sessions SET state = 'FAILED', updated_at = ?
      WHERE id = ? AND state = 'TRANSFERRING'
    `,
      )
      .run(new Date().toISOString(), id);
    return result.changes === 1;
  }

  releaseExpiredReservations(timeoutMs: number): number {
    const cutoff = new Date(Date.now() - timeoutMs).toISOString();
    const result = this.db
      .prepare(
        `
      UPDATE download_sessions SET state = 'FAILED', updated_at = ?
      WHERE state IN ('PENDING','RESERVED','CONNECTING') AND updated_at < ?
    `,
      )
      .run(new Date().toISOString(), cutoff);
    return result.changes;
  }

  failSessionsForPeer(peerId: string): number {
    const result = this.db
      .prepare(
        `
      UPDATE download_sessions SET state = 'FAILED', updated_at = ?
      WHERE receiver_peer_id = ? AND state IN ('PENDING','RESERVED','CONNECTING','TRANSFERRING')
    `,
      )
      .run(new Date().toISOString(), peerId);
    return result.changes;
  }

  failSessionsForShare(shareId: string): number {
    const result = this.db
      .prepare(
        `
      UPDATE download_sessions SET state = 'FAILED', updated_at = ?
      WHERE share_id = ? AND state IN ('PENDING','RESERVED','CONNECTING','TRANSFERRING')
    `,
      )
      .run(new Date().toISOString(), shareId);
    return result.changes;
  }

  countCleanupCandidates(): number {
    return (
      this.db
        .prepare(
          "SELECT COUNT(*) AS count FROM shares WHERE status IN ('EXPIRED','STOPPED')",
        )
        .get() as { count: number }
    ).count;
  }

  cleanupMetadata(): number {
    const result = this.db
      .prepare("DELETE FROM shares WHERE status IN ('EXPIRED','STOPPED')")
      .run();
    return result.changes;
  }
}
