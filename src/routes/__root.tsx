import {
  createRootRoute,
  Outlet,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MainLayout } from "@/components/layout/MainLayout";
import { useTabRouteSync } from "@/components/layout/AppTabContent";
import { useAppTabStore } from "@/stores/appTabStore";
import { CommandPalette } from "@/components/search/CommandPalette";
import { Toaster } from "@/components/ui/sonner";
import { OnboardingDialog } from "@/components/OnboardingDialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useExpiryCheck } from "@/hooks/useExpiryCheck";
import { useReminderChecker } from "@/hooks/useReminderChecker";

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  const location = useLocation();
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Sync active tab with router (main window only)
  useTabRouteSync();

  // Restore persisted tab route on initial load (main window only)
  useEffect(() => {
    // Skip for Today/Search windows — they have their own routes
    if (location.pathname === "/today" || location.pathname === "/search") return;

    const { tabs, activeTabId } = useAppTabStore.getState();
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (activeTab && activeTab.route !== "/" && location.pathname === "/") {
      navigate({ to: activeTab.route as any });
    } else if (activeTab && !location.pathname.startsWith(activeTab.route.split("/").slice(0, 2).join("/"))) {
      navigate({ to: activeTab.route as any });
    }
  }, []);

  // Check credential expiry on app startup
  useExpiryCheck();

  // Check reminders every 60s and send OS notifications
  useReminderChecker();

  // Set overlay titlebar on macOS main window so traffic lights sit inside content
  useEffect(() => {
    const win = getCurrentWindow();
    if (win.label !== "main") return;
    if (!navigator.userAgent.toLowerCase().includes("mac")) return;
    win.setTitleBarStyle("overlay").catch(() => {});
  }, []);

  // Cmd+K / Ctrl+K to open palette (in-app)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Register global shortcut (works even when app not focused) — main window only
  useEffect(() => {
    const win = getCurrentWindow();
    if (win.label !== "main") return;

    const shortcut =
      navigator.userAgent.toLowerCase().includes("mac")
        ? "Command+Shift+K"
        : "Control+Shift+K";

    let cancelled = false;

    // Delay registration slightly to avoid race with HMR cleanup
    const timer = setTimeout(() => {
      if (cancelled) return;
      unregisterAll().catch(() => {}).finally(() => {
        if (cancelled) return;
        register(shortcut, async () => {
          // Try to show existing search window
          const existing = await WebviewWindow.getByLabel("search");
          if (existing) {
            await existing.show();
            await existing.setFocus();
            return;
          }
          // Create new search window
          const searchWin = new WebviewWindow("search", {
            url: "/search",
            title: "Quick Search",
            width: 560,
            height: 500,
            decorations: false,
            transparent: false,
            alwaysOnTop: true,
            resizable: false,
            center: true,
            focus: true,
          });
          searchWin.once("tauri://created", async () => {
            await searchWin.setFocus();
          });
        }).catch(() => {});
      });
    }, 100);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      unregisterAll().catch(() => {});
    };
  }, []);

  // Listen for "navigate" events from other windows is now handled
  // via the navigate_main_window Rust command (see src-tauri/src/lib.rs)

  // Today window / search window renders without sidebar/layout
  if (location.pathname === "/today" || location.pathname === "/search") {
    return <Outlet />;
  }

  return (
    <MainLayout>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={location.pathname.split("/").slice(0, 2).join("/")}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.1 }}
          className="h-full"
        >
          <Outlet />
        </motion.div>
      </AnimatePresence>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onNavigate={(path) => navigate({ to: path as any })}
      />
      <OnboardingDialog />
      <Toaster richColors position="bottom-right" />
    </MainLayout>
  );
}
