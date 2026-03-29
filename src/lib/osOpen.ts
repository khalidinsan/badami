import { open } from "@tauri-apps/plugin-shell";
import { invoke } from "@tauri-apps/api/core";

export async function openInOS(path: string): Promise<void> {
  await open(path);
}

export async function openInCodeEditor(localPath: string): Promise<void> {
  await invoke("open_in_code_editor", { path: localPath });
}
