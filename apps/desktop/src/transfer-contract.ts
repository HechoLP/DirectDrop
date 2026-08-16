export type TransferTransportKind = "WEBRTC" | "LAN" | "BROWSER_LAN";

export type TransferDirection = "SEND" | "RECEIVE";

export type UnifiedTransferStatus =
  | "WAITING"
  | "PAIRING"
  | "CONNECTING"
  | "TRANSFERRING"
  | "PAUSED"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type TransferFile = {
  id: string;
  name: string;
  size: number;
  relativePath?: string;
};

export type TransferSnapshot = {
  id: string;
  transport: TransferTransportKind;
  direction: TransferDirection;
  files: readonly TransferFile[];
  totalBytes: number;
  transferredBytes: number;
  bytesPerSecond: number;
  etaSeconds: number | null;
  status: UnifiedTransferStatus;
};

export interface TransferTransport {
  readonly kind: TransferTransportKind;
  connect(): Promise<void>;
  send(files: readonly TransferFile[]): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  cancel(): Promise<void>;
  close(): void;
}
