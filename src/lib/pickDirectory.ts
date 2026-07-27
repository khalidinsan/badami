import { open } from "@tauri-apps/plugin-dialog";

/**
 * Native folder picker for path inputs.
 *
 * Local Dev asks for absolute paths (park roots, project roots) and used to
 * require typing them by hand. `dialog:allow-open` is already granted in the
 * app capabilities, so there is no reason to.
 *
 * Returns the chosen absolute path, or `null` when the user cancels.
 */
export async function pickDirectory(options?: {
  title?: string;
  defaultPath?: string;
}): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: options?.title,
    defaultPath: options?.defaultPath,
  });
  if (typeof selected === "string") return selected;
  // `multiple: false` never yields an array, but the union type includes one.
  if (Array.isArray(selected)) return selected[0] ?? null;
  return null;
}
