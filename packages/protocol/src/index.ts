import { z } from "zod";

export const APP_NAME = "DirectDrop";
export const APP_VERSION = "0.1.4";
export const DEFAULT_CHUNK_SIZE = 256 * 1024;
export const DATA_CHANNEL_HIGH_WATER_MARK = 8 * 1024 * 1024;
export const DATA_CHANNEL_LOW_WATER_MARK = 2 * 1024 * 1024;
export const HEARTBEAT_INTERVAL_MS = 25_000;
export const MAX_BROWSER_BUFFER_FALLBACK_BYTES = 512 * 1024 * 1024;

export const approvalModeSchema = z.enum(["AUTO", "MANUAL"]);
export type ApprovalMode = z.infer<typeof approvalModeSchema>;

export const downloadSessionStateSchema = z.enum([
  "PENDING",
  "RESERVED",
  "CONNECTING",
  "TRANSFERRING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);
export type DownloadSessionState = z.infer<typeof downloadSessionStateSchema>;

export const publicFileSchema = z.object({
  id: z.string().min(8).max(128),
  name: z.string().min(1).max(255),
  size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  mimeType: z.string().min(1).max(255),
  modifiedAt: z.number().int().nonnegative().optional(),
});
export type PublicFile = z.infer<typeof publicFileSchema>;

export const createShareSchema = z.object({
  files: z.array(publicFileSchema).min(1).max(100),
  downloadLimit: z.number().int().min(1).max(1000).nullable(),
  expiresAt: z.string().datetime().nullable(),
  appLifetime: z.boolean().default(false),
  password: z.string().min(8).max(128).nullable().optional(),
  approvalMode: approvalModeSchema,
  allowRelay: z.boolean().default(false),
});
export type CreateShareInput = z.infer<typeof createShareSchema>;

export const shareMetadataSchema = z.object({
  token: z.string(),
  files: z.array(publicFileSchema),
  totalSize: z.number().int().nonnegative(),
  expiresAt: z.string().nullable(),
  downloadLimit: z.number().int().positive().nullable(),
  completedDownloads: z.number().int().nonnegative(),
  senderOnline: z.boolean(),
  passwordProtected: z.boolean(),
  approvalMode: approvalModeSchema,
  allowRelay: z.boolean(),
  status: z.enum(["ACTIVE", "OFFLINE", "EXPIRED", "LIMIT_REACHED", "STOPPED"]),
});
export type ShareMetadata = z.infer<typeof shareMetadataSchema>;

const messageBaseSchema = z.object({
  type: z.string(),
  requestId: z.string().optional(),
});

export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("REGISTER_SHARE"),
    shareToken: z.string(),
    controlKey: z.string(),
  }),
  z.object({
    type: z.literal("UNREGISTER_SHARE"),
    shareToken: z.string(),
    controlKey: z.string(),
  }),
  z.object({ type: z.literal("JOIN_SHARE"), shareToken: z.string() }),
  z.object({ type: z.literal("HEARTBEAT"), shareToken: z.string() }),
  z.object({
    type: z.literal("DOWNLOAD_REQUEST"),
    shareToken: z.string(),
    accessToken: z.string().optional(),
  }),
  z.object({
    type: z.literal("DOWNLOAD_ACCEPT"),
    sessionId: z.string(),
    peerId: z.string(),
  }),
  z.object({
    type: z.literal("DOWNLOAD_REJECT"),
    sessionId: z.string(),
    peerId: z.string(),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal("OFFER"),
    sessionId: z.string(),
    toPeerId: z.string(),
    sdp: z.string(),
  }),
  z.object({
    type: z.literal("ANSWER"),
    sessionId: z.string(),
    toPeerId: z.string(),
    sdp: z.string(),
  }),
  z.object({
    type: z.literal("ICE_CANDIDATE"),
    sessionId: z.string(),
    toPeerId: z.string(),
    candidate: z.record(z.string(), z.unknown()),
  }),
  z.object({ type: z.literal("TRANSFER_STARTED"), sessionId: z.string() }),
  z.object({ type: z.literal("TRANSFER_COMPLETED"), sessionId: z.string() }),
  z.object({
    type: z.literal("TRANSFER_FAILED"),
    sessionId: z.string(),
    reason: z.string().max(500).optional(),
  }),
  z.object({ type: z.literal("TRANSFER_CANCELLED"), sessionId: z.string() }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

export type ServerMessage =
  | { type: "CONNECTED"; peerId: string }
  | { type: "REGISTERED"; shareToken: string }
  | {
      type: "SHARE_STATE";
      shareToken: string;
      senderOnline: boolean;
      status: ShareMetadata["status"];
    }
  | {
      type: "DOWNLOAD_REQUESTED";
      sessionId: string;
      peerId: string;
      shareToken: string;
    }
  | { type: "DOWNLOAD_ACCEPTED"; sessionId: string; peerId: string }
  | { type: "DOWNLOAD_REJECTED"; sessionId: string; reason?: string }
  | { type: "OFFER"; sessionId: string; peerId: string; sdp: string }
  | { type: "ANSWER"; sessionId: string; peerId: string; sdp: string }
  | {
      type: "ICE_CANDIDATE";
      sessionId: string;
      peerId: string;
      candidate: Record<string, unknown>;
    }
  | {
      type: "TRANSFER_STATE";
      sessionId: string;
      state: DownloadSessionState;
      completedDownloads?: number;
    }
  | { type: "ERROR"; code: string; message: string; requestId?: string };

export const dataChannelControlSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("MANIFEST"),
    files: z.array(publicFileSchema),
    totalSize: z.number().nonnegative(),
  }),
  z.object({
    type: z.literal("FILE_START"),
    fileId: z.string(),
    name: z.string(),
    size: z.number().nonnegative(),
    mimeType: z.string(),
  }),
  z.object({ type: z.literal("FILE_END"), fileId: z.string() }),
  z.object({ type: z.literal("TRANSFER_COMPLETE") }),
  z.object({ type: z.literal("TRANSFER_ERROR"), message: z.string() }),
]);
export type DataChannelControl = z.infer<typeof dataChannelControlSchema>;

export function parseClientMessage(value: unknown): ClientMessage {
  return clientMessageSchema.parse(value);
}

export function isProtocolMessage(value: unknown): value is { type: string } {
  return messageBaseSchema.safeParse(value).success;
}
