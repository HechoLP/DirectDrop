import { z } from "zod";

export const APP_NAME = "DirectDrop";
export const APP_VERSION = "0.1.4";
export const PROTOCOL_VERSION = 1;
export const DEFAULT_CHUNK_SIZE = 256 * 1024;
export const DATA_CHANNEL_HIGH_WATER_MARK = 8 * 1024 * 1024;
export const DATA_CHANNEL_LOW_WATER_MARK = 2 * 1024 * 1024;
export const HEARTBEAT_INTERVAL_MS = 25_000;
export const MAX_BROWSER_BUFFER_FALLBACK_BYTES = 512 * 1024 * 1024;
export const MAX_SHARE_FILES = 100;
export const MAX_CONTROL_MESSAGE_CHARS = 64 * 1024;
export const MAX_PENDING_ICE_CANDIDATES = 256;
export const MAX_FILE_CHUNK_BYTES = 1024 * 1024;

const opaqueIdSchema = z.string().min(8).max(128);
const signalingTextSchema = z.string().min(1).max(60 * 1024);

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
  id: opaqueIdSchema,
  name: z.string().min(1).max(255),
  size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  mimeType: z.string().min(1).max(255),
  modifiedAt: z.number().int().nonnegative().optional(),
});
export type PublicFile = z.infer<typeof publicFileSchema>;

export const createShareSchema = z
  .object({
    files: z.array(publicFileSchema).min(1).max(MAX_SHARE_FILES),
    downloadLimit: z.number().int().min(1).max(1000).nullable(),
    expiresAt: z.string().datetime().nullable(),
    appLifetime: z.boolean().default(false),
    password: z.string().min(8).max(128).nullable().optional(),
    approvalMode: approvalModeSchema,
    allowRelay: z.boolean().default(false),
  })
  .strict()
  .superRefine((input, context) => {
    const total = input.files.reduce((sum, file) => sum + file.size, 0);
    if (!Number.isSafeInteger(total))
      context.addIssue({
        code: "custom",
        path: ["files"],
        message: "Total file size exceeds the supported safe integer range",
      });
  });
export type CreateShareInput = z.infer<typeof createShareSchema>;

export const shareMetadataSchema = z.object({
  token: opaqueIdSchema,
  files: z.array(publicFileSchema).max(MAX_SHARE_FILES),
  totalSize: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
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

const iceServerSchema = z
  .object({
    urls: z.union([z.string().min(1).max(2048), z.array(z.string().min(1).max(2048)).max(16)]),
    username: z.string().max(512).optional(),
    credential: z.string().max(2048).optional(),
  })
  .strict();

export const publicRuntimeConfigSchema = z
  .object({
    appUrl: z.string().url(),
    signalingUrl: z.string().url(),
    iceServers: z.array(iceServerSchema).max(16),
  })
  .strict();

export const createdShareResponseSchema = z
  .object({
    token: opaqueIdSchema,
    controlKey: opaqueIdSchema,
    url: z.string().url(),
  })
  .strict();

export const passwordVerificationResponseSchema = z
  .object({ accessToken: opaqueIdSchema.nullable() })
  .strict();

const messageBaseSchema = z.object({
  type: z.string(),
  requestId: z.string().optional(),
});

export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("REGISTER_SHARE"),
    shareToken: opaqueIdSchema,
    controlKey: opaqueIdSchema,
  }).strict(),
  z.object({
    type: z.literal("UNREGISTER_SHARE"),
    shareToken: opaqueIdSchema,
    controlKey: opaqueIdSchema,
  }).strict(),
  z.object({ type: z.literal("JOIN_SHARE"), shareToken: opaqueIdSchema }).strict(),
  z.object({ type: z.literal("HEARTBEAT"), shareToken: opaqueIdSchema }).strict(),
  z.object({
    type: z.literal("DOWNLOAD_REQUEST"),
    shareToken: opaqueIdSchema,
    accessToken: opaqueIdSchema.optional(),
  }).strict(),
  z.object({
    type: z.literal("DOWNLOAD_ACCEPT"),
    sessionId: opaqueIdSchema,
    peerId: opaqueIdSchema,
  }).strict(),
  z.object({
    type: z.literal("DOWNLOAD_REJECT"),
    sessionId: opaqueIdSchema,
    peerId: opaqueIdSchema,
    reason: z.string().max(500).optional(),
  }).strict(),
  z.object({
    type: z.literal("OFFER"),
    sessionId: opaqueIdSchema,
    toPeerId: opaqueIdSchema,
    sdp: signalingTextSchema,
  }).strict(),
  z.object({
    type: z.literal("ANSWER"),
    sessionId: opaqueIdSchema,
    toPeerId: opaqueIdSchema,
    sdp: signalingTextSchema,
  }).strict(),
  z.object({
    type: z.literal("ICE_CANDIDATE"),
    sessionId: opaqueIdSchema,
    toPeerId: opaqueIdSchema,
    candidate: z.record(z.string(), z.unknown()),
  }).strict(),
  z.object({ type: z.literal("TRANSFER_STARTED"), sessionId: opaqueIdSchema }).strict(),
  z.object({ type: z.literal("TRANSFER_PROGRESS"), sessionId: opaqueIdSchema }).strict(),
  z.object({ type: z.literal("TRANSFER_SENT"), sessionId: opaqueIdSchema }).strict(),
  z.object({ type: z.literal("TRANSFER_COMPLETED"), sessionId: opaqueIdSchema }).strict(),
  z.object({
    type: z.literal("TRANSFER_FAILED"),
    sessionId: opaqueIdSchema,
    reason: z.string().max(500).optional(),
  }).strict(),
  z.object({ type: z.literal("TRANSFER_CANCELLED"), sessionId: opaqueIdSchema }).strict(),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

export const serverMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("CONNECTED"), peerId: opaqueIdSchema }).strict(),
  z.object({ type: z.literal("REGISTERED"), shareToken: opaqueIdSchema }).strict(),
  z.object({
    type: z.literal("SHARE_STATE"),
    shareToken: opaqueIdSchema,
    senderOnline: z.boolean(),
    status: shareMetadataSchema.shape.status,
  }).strict(),
  z.object({
    type: z.literal("DOWNLOAD_REQUESTED"),
    sessionId: opaqueIdSchema,
    peerId: opaqueIdSchema,
    shareToken: opaqueIdSchema,
  }).strict(),
  z.object({
    type: z.literal("DOWNLOAD_ACCEPTED"),
    sessionId: opaqueIdSchema,
    peerId: opaqueIdSchema,
  }).strict(),
  z.object({
    type: z.literal("DOWNLOAD_REJECTED"),
    sessionId: opaqueIdSchema,
    reason: z.string().max(500).optional(),
  }).strict(),
  z.object({
    type: z.literal("OFFER"),
    sessionId: opaqueIdSchema,
    peerId: opaqueIdSchema,
    sdp: signalingTextSchema,
  }).strict(),
  z.object({
    type: z.literal("ANSWER"),
    sessionId: opaqueIdSchema,
    peerId: opaqueIdSchema,
    sdp: signalingTextSchema,
  }).strict(),
  z.object({
    type: z.literal("ICE_CANDIDATE"),
    sessionId: opaqueIdSchema,
    peerId: opaqueIdSchema,
    candidate: z.record(z.string(), z.unknown()),
  }).strict(),
  z.object({
    type: z.literal("TRANSFER_STATE"),
    sessionId: opaqueIdSchema,
    state: downloadSessionStateSchema,
    completedDownloads: z.number().int().nonnegative().optional(),
  }).strict(),
  z.object({
    type: z.literal("ERROR"),
    code: z.string().min(1).max(100),
    message: z.string().min(1).max(500),
    requestId: z.string().max(128).optional(),
  }).strict(),
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;

export const dataChannelControlSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("MANIFEST"),
    protocolVersion: z.literal(PROTOCOL_VERSION),
    files: z.array(publicFileSchema).min(1).max(MAX_SHARE_FILES),
    totalSize: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  }).strict(),
  z.object({
    type: z.literal("FILE_START"),
    fileId: opaqueIdSchema,
    name: z.string().min(1).max(255),
    size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    mimeType: z.string().min(1).max(255),
  }).strict(),
  z
    .object({
      type: z.literal("CHUNK"),
      fileId: opaqueIdSchema,
      offset: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      size: z.number().int().positive().max(MAX_FILE_CHUNK_BYTES),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
  z.object({ type: z.literal("FILE_END"), fileId: opaqueIdSchema }).strict(),
  z.object({ type: z.literal("TRANSFER_COMPLETE") }).strict(),
  z.object({ type: z.literal("TRANSFER_ERROR"), message: z.string().max(500) }).strict(),
]);
export type DataChannelControl = z.infer<typeof dataChannelControlSchema>;

export const dataChannelReceiverControlSchema = z
  .object({
    type: z.literal("CHUNK_ACK"),
    transferredBytes: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
export type DataChannelReceiverControl = z.infer<
  typeof dataChannelReceiverControlSchema
>;

export function parseClientMessage(value: unknown): ClientMessage {
  return clientMessageSchema.parse(value);
}

export function parseServerMessage(value: unknown): ServerMessage {
  return serverMessageSchema.parse(value);
}

export function isProtocolMessage(value: unknown): value is { type: string } {
  return messageBaseSchema.safeParse(value).success;
}
