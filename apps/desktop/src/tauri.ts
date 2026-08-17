import { invoke } from "@tauri-apps/api/core";
import type { PublicFile } from "@directdrop/protocol";
import type { FileSecurityAssessment } from "@directdrop/shared";

export const isTauri = () => "__TAURI_INTERNALS__" in window;

export async function registerFiles(paths: string[]): Promise<PublicFile[]> {
  return invoke<PublicFile[]>("register_files", { paths });
}

export async function registerNearbyPaths(
  paths: string[],
): Promise<PublicFile[]> {
  return invoke<PublicFile[]>("register_nearby_paths", { paths });
}

export async function readFileChunk(
  publicFileId: string,
  offset: number,
  length: number,
): Promise<ArrayBuffer> {
  const result = await invoke<ArrayBuffer | number[]>("read_file_chunk", {
    publicFileId,
    offset,
    length,
  });
  if (result instanceof ArrayBuffer) return result;
  return Uint8Array.from(result).buffer;
}

export async function removeLocalFiles(publicFileIds: string[]) {
  await invoke("remove_local_files", { publicFileIds });
}

export async function setActiveShareCount(count: number) {
  await invoke("set_active_share_count", { count });
}

export async function quitApp() {
  await invoke("quit_app");
}

export type TrustedNearbyDevice = {
  deviceId: string;
  deviceName: string;
  certificateFingerprint: string;
  pairedAt: number;
  autoAcceptFiles: boolean;
};

export type NearbyDevice = {
  deviceId: string;
  deviceName: string;
  platform: string;
  address: string;
  port: number;
  protocolVersion: number;
  certificateFingerprint: string;
  paired: boolean;
  lastSeen: number;
};

export type NearbyPreferences = {
  enabled: boolean;
  deviceName: string;
  downloadDirectory: string;
};

export type NearbyStatus = {
  preferences: NearbyPreferences;
  devices: NearbyDevice[];
  trustedDevices: TrustedNearbyDevice[];
  listeningPort: number | null;
};

export type NearbyPairingTicket = {
  pairingId: string;
  deviceId: string;
  deviceName: string;
  code: string;
  incoming: boolean;
};

export type NearbyFile = {
  id: string;
  name: string;
  relativePath: string;
  size: number;
  mimeType: string;
  modifiedAt: number;
};

export type NearbyTransferSnapshot = {
  id: string;
  deviceId: string;
  deviceName: string;
  direction: "SEND" | "RECEIVE";
  files: NearbyFile[];
  totalBytes: number;
  transferredBytes: number;
  bytesPerSecond: number;
  etaSeconds: number | null;
  status:
    | "WAITING"
    | "CONNECTING"
    | "TRANSFERRING"
    | "PAUSED"
    | "COMPLETED"
    | "FAILED"
    | "CANCELLED";
  error: string | null;
  updatedAt: number;
};

export type NearbyTransferOffer = {
  transferId: string;
  deviceId: string;
  deviceName: string;
  files: NearbyFile[];
  totalBytes: number;
  confirmationStage: "BEFORE_TRANSFER" | "AFTER_INSPECTION";
  security: FileSecurityAssessment;
};

export async function getNearbyStatus() {
  return invoke<NearbyStatus>("nearby_status");
}

export async function startNearby() {
  return invoke<NearbyStatus>("nearby_start");
}

export async function stopNearby() {
  return invoke<NearbyStatus>("nearby_stop");
}

export async function updateNearbyPreferences(preferences: NearbyPreferences) {
  return invoke<NearbyStatus>("nearby_update_preferences", preferences);
}

export async function beginNearbyPairing(deviceId: string) {
  return invoke<NearbyPairingTicket>("nearby_begin_pairing", { deviceId });
}

export async function decideNearbyPairing(
  pairingId: string,
  accepted: boolean,
) {
  await invoke("nearby_decide_pairing", { pairingId, accepted });
}

export async function forgetNearbyDevice(deviceId: string) {
  return invoke<NearbyStatus>("nearby_forget_device", { deviceId });
}

export async function setNearbyAutoAcceptFiles(
  deviceId: string,
  enabled: boolean,
) {
  return invoke<NearbyStatus>("nearby_set_auto_accept_files", {
    deviceId,
    enabled,
  });
}

export async function sendNearbyFiles(
  deviceId: string,
  publicFileIds: string[],
) {
  return invoke<string>("nearby_send_files", { deviceId, publicFileIds });
}

export async function decideNearbyTransfer(
  transferId: string,
  accepted: boolean,
) {
  await invoke("nearby_decide_transfer", { transferId, accepted });
}

export async function pauseNearbyTransfer(transferId: string) {
  await invoke("nearby_pause_transfer", { transferId });
}

export async function resumeNearbyTransfer(transferId: string) {
  await invoke("nearby_resume_transfer", { transferId });
}

export async function retryNearbyTransfer(transferId: string) {
  await invoke("nearby_retry_transfer", { transferId });
}

export async function cancelNearbyTransfer(transferId: string) {
  await invoke("nearby_cancel_transfer", { transferId });
}

export async function getNearbyTransfers() {
  return invoke<NearbyTransferSnapshot[]>("nearby_transfers");
}
