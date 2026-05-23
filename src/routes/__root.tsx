import {
  createRootRoute,
  Outlet,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { TabContentArea } from "@/components/layout/TabContentArea";
import { useAppTabStore } from "@/stores/appTabStore";
import { CommandPalette } from "@/components/search/CommandPalette";
import { Toaster } from "@/components/ui/sonner";
import { OnboardingDialog } from "@/components/OnboardingDialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useExpiryCheck } from "@/hooks/useExpiryCheck";
import { useReminderChecker } from "@/hooks/useReminderChecker";

// Tab types rendered by the router's Outlet (e.g. project detail with nested routes)
const ROUTER_TAB_TYPES = new Set(["project"]);

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  const location = useLocation();
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);

  // On initial load, navigate router to the active tab's route (keeps router in sync)
  useEffect(() => {
    if (location.pathname === "/today" || location.pathname === "/search") return;

    const { tabs, activeTabId } = useAppTabStore.getState();
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (activeTab) {
      navigate({ to: activeTab.route as any });
      window.history.replaceState(null, "", activeTab.route);
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

  // Is the active tab router-rendered (project detail)?
  const activeTab = useAppTabStore((s) => s.tabs.find((t) => t.id === s.activeTabId));
  const isRouterTab = activeTab && ROUTER_TAB_TYPES.has(activeTab.type);

  return (
    <MainLayout>
      {/* Keep-alive tabs */}
      <div className={isRouterTab ? "hidden" : "h-full"}>
        <TabContentArea />
      </div>
      {/* Router Outlet — project detail renders here, other routes return null */}
      <div className={isRouterTab ? "h-full" : "hidden"}>
        <Outlet />
      </div>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onNavigate={(path) => {
          const { tabs, setActiveTab, openTab } = useAppTabStore.getState();
          const existing = tabs.find((t) => t.route === path);
          if (existing) {
            setActiveTab(existing.id);
          } else {
            const type = path.split("/").filter(Boolean)[0] || "planning";
            openTab({ type: type as any, title: type.charAt(0).toUpperCase() + type.slice(1), icon: "CalendarDays", route: path });
          }
          navigate({ to: path as any });
        }}
      />
      <OnboardingDialog />
      <Toaster richColors position="bottom-right" />
    </MainLayout>
  );
}
