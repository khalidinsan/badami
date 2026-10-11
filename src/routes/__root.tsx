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
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useExpiryCheck } from "@/hooks/useExpiryCheck";
import { useReminderChecker } from "@/hooks/useReminderChecker";
import { acquireServiceEvents, openDoctorEmitter } from "@/stores/localDevStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { isMacOS } from "@/lib/platform";
import { LOCAL_DEV_ENABLED_SETTING_KEY } from "@/types/localDev";

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

  // Local Dev — subscribe to supervisor events globally when the feature is
  // enabled on macOS. The subscription is refcounted inside the store, so
  // additional per-route acquires are safe. Globally mounted so a MariaDB
  // crash toast / OS notification fires even when the user is on another
  // app tab. Non-macOS skips entirely (supervisor is a no-op there).
  const localDevEventsEnabled = useSettingsStore(
    (s) =>
      isMacOS() &&
      (s.settings[LOCAL_DEV_ENABLED_SETTING_KEY] ?? "true") !== "false",
  );
  useEffect(() => {
    if (!localDevEventsEnabled) return;
    const release = acquireServiceEvents();
    return () => {
      try {
        release();
      } catch (err) {
        console.error("release service events failed", err);
      }
    };
  }, [localDevEventsEnabled]);

  // Local Dev — route-level handler for `openDoctorEmitter`. If the Local Dev
  // tab is already mounted (tab keep-alive), its own subscriber flips to the
  // Doctor sub-tab. If no Local Dev tab exists yet (user triggered DNS
  // unhealthy from a project panel without ever visiting Local Dev), we open
  // one here first and the route's mount effect picks up the pending request
  // via `consumePendingOpenDoctor()`.
  useEffect(() => {
    if (!isMacOS()) return;
    const unsub = openDoctorEmitter.subscribe(() => {
      const { tabs, openTab, setActiveTab, activeTabId } = useAppTabStore.getState();
      const existing = tabs.find((t) => t.type === "local-dev");
      if (existing) {
        if (existing.id !== activeTabId) setActiveTab(existing.id);
      } else {
        openTab({
          type: "local-dev",
          title: "Local Dev",
          icon: "HardDrive",
          route: "/local-dev",
        });
      }
      navigate({ to: "/local-dev" });
    });
    return () => {
      unsub();
    };
  }, [navigate]);

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
      <ErrorBoundary label="app shell">
        {/* Keep-alive tabs — each panel has its own boundary inside TabContentArea */}
        <div className={isRouterTab ? "hidden" : "h-full"}>
          <TabContentArea />
        </div>
        {/* Router Outlet — project detail renders here, other routes return null */}
        <div className={isRouterTab ? "h-full" : "hidden"}>
          <ErrorBoundary label="project view">
            <Outlet />
          </ErrorBoundary>
        </div>
      </ErrorBoundary>
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
