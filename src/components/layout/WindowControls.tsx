import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";

type Platform = "macos" | "windows" | "linux";

function detectPlatform(): Platform {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("mac")) return "macos";
  if (ua.includes("win")) return "windows";
  return "linux";
}

const currentPlatform = detectPlatform();

export function WindowControls() {
  const win = getCurrentWindow();
  const close = () => win.close();
  const minimize = () => win.minimize();
  const toggleMaximize = () => win.toggleMaximize();

  if (currentPlatform === "macos") {
    return (
      <div className="flex items-center gap-2 pl-3">
        <button
          onClick={close}
          className="group flex h-3 w-3 items-center justify-center rounded-full bg-[#ff5f57] transition hover:brightness-90"
          title="Close"
        >
          <X className="hidden h-2 w-2 text-black/60 group-hover:block" strokeWidth={3} />
        </button>
        <button
          onClick={minimize}
          className="group flex h-3 w-3 items-center justify-center rounded-full bg-[#ffbd2e] transition hover:brightness-90"
          title="Minimize"
        >
          <Minus className="hidden h-2 w-2 text-black/60 group-hover:block" strokeWidth={3} />
        </button>
        <button
          onClick={toggleMaximize}
          className="group flex h-3 w-3 items-center justify-center rounded-full bg-[#28c840] transition hover:brightness-90"
          title="Full Screen"
        >
          <Square className="hidden h-1.5 w-1.5 text-black/60 group-hover:block" strokeWidth={3} />
        </button>
      </div>
    );
  }

  // Windows / Linux — right-aligned
  return (
    <div className="flex items-center">
      <button
        onClick={minimize}
        className="flex h-8 w-10 items-center justify-center text-muted-foreground transition hover:bg-muted"
        title="Minimize"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={toggleMaximize}
        className="flex h-8 w-10 items-center justify-center text-muted-foreground transition hover:bg-muted"
        title="Maximize"
      >
        <Square className="h-3 w-3" />
      </button>
      <button
        onClick={close}
        className="flex h-8 w-10 items-center justify-center text-muted-foreground transition hover:bg-red-500 hover:text-white"
        title="Close"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function usePlatform(): Platform {
  return currentPlatform;
}
