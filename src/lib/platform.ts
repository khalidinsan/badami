/** Client-side platform detection (navigator only; no Tauri plugin required). */

export type ClientPlatform = "macos" | "windows" | "linux";

export function detectClientPlatform(): ClientPlatform {
  if (typeof navigator === "undefined") return "linux";
  const ua = navigator.userAgent.toLowerCase();
  const platform = (navigator.platform || "").toLowerCase();
  if (ua.includes("mac") || platform.includes("mac")) return "macos";
  if (ua.includes("win") || platform.includes("win")) return "windows";
  return "linux";
}

export function isMacOS(): boolean {
  return detectClientPlatform() === "macos";
}
