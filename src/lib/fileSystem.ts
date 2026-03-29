import { basename } from "@tauri-apps/api/path";

export async function getFileName(path: string): Promise<string> {
  return await basename(path);
}
