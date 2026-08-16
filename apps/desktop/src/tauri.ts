import { invoke } from "@tauri-apps/api/core";
import type { PublicFile } from "@directdrop/protocol";

export const isTauri = () => "__TAURI_INTERNALS__" in window;

export async function registerFiles(paths: string[]): Promise<PublicFile[]> {
  return invoke<PublicFile[]>("register_files", { paths });
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
