import { Link, useRouterState, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import {
  FolderKanban,
  CheckSquare,
  CalendarDays,
  Settings,
  ChevronLeft,
  ChevronRight,
  StickyNote,
  ArrowLeft,
  RotateCcw,
  Server,
  KeyRound,
  Globe,
  BarChart3,
  Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useTaskStore } from "@/stores/taskStore";
import sidebarPattern from "@/assets/sidebar-pattern.svg";
import { useCredentialStore } from "@/stores/credentialStore";
import { getExpiryBadgeCount } from "@/hooks/useExpiryCheck";
import { SyncStatusIndicator } from "@/components/sync/SyncStatusIndicator";

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const navItems: NavItem[] = [
  { to: "/planning", label: "Planning", icon: CalendarDays },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/tasks", label: "Tasks", icon: CheckSquare },
  { to: "/servers", label: "Servers", icon: Server },
  { to: "/credentials", label: "Credentials", icon: KeyRound },
  { to: "/api", label: "API", icon: Globe },
];

const bottomItems: NavItem[] = [
  { to: "/stats", label: "Statistics", icon: BarChart3 },
  { to: "/settings", label: "Settings", icon: Settings },
  { to: "/about", label: "About", icon: Info },
];

interface SidebarProps {
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}

export function Sidebar({ collapsed, onCollapsedChange }: SidebarProps) {
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;
  const router = useRouter();
  const { credentials, loadAllCredentials } = useCredentialStore();
  const { loadSmartListCounts } = useTaskStore();

  useEffect(() => {
    if (credentials.length === 0) loadAllCredentials();
  }, []);

  useEffect(() => {
    loadSmartListCounts();
  }, []);

  const expiryCount = getExpiryBadgeCount(credentials);

  return (
    <aside
      className={cn(
        "relative flex flex-col overflow-hidden transition-all duration-200",
        "bg-[#007AFF]",
        collapsed ? "w-[78px]" : "w-56",
      )}
    >
      {/* Abstract pattern overlay */}
      <img
        src={sidebarPattern}
        alt=""
        className="pointer-events-none absolute inset-0 h-full w-full object-cover"
        aria-hidden="true"
      />

      {/* Content */}
      <div className="relative z-10 flex flex-1 flex-col">
        {/* Traffic light zone — drag region, leaves space for macOS native buttons */}
        <div
          className="h-[28px] shrink-0 select-none"
          data-tauri-drag-region
        />

        {/* Header: logo + collapse toggle */}
        <div className="flex items-center justify-between px-3 pb-3">
          {!collapsed && (
            <img
              src="/logo-white.png"
              alt="Badami"
              className="h-7 w-auto object-contain"
              draggable={false}
            />
          )}
          {collapsed && (
            <img
              src="/icon-white.png"
              alt="Badami"
              className="h-7 w-7 object-contain"
              draggable={false}
            />
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-white/70 hover:bg-white/10 hover:text-white"
            onClick={() => onCollapsedChange(!collapsed)}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/* Back / Reload — navigation controls */}
        <div className={cn(
          "flex items-center gap-1 px-3 pb-3",
          collapsed && "justify-center flex-col gap-0.5",
        )}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => router.history.back()}
                className="flex h-7 w-7 items-center justify-center rounded-md text-white/60 transition-colors hover:bg-white/10 hover:text-white"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Go back</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => window.location.reload()}
                className="flex h-7 w-7 items-center justify-center rounded-md text-white/60 transition-colors hover:bg-white/10 hover:text-white"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Reload</TooltipContent>
          </Tooltip>
        </div>

        <Separator className="bg-white/15" />

        {/* Main nav */}
        <nav className="flex-1 space-y-0.5 px-2 py-3">
          {navItems.map((item) => {
            const isActive = currentPath.startsWith(item.to);
            const linkContent = (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-white/20 text-white shadow-sm backdrop-blur-sm"
                    : "text-white/70 hover:bg-white/10 hover:text-white",
                  collapsed && "justify-center px-0",
                )}
              >
                <item.icon className="h-5 w-5 shrink-0" />
                {!collapsed && <span className="flex-1">{item.label}</span>}
                {item.to === "/credentials" && expiryCount > 0 && (
                  <span className={cn(
                    "flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white",
                    collapsed && "absolute -right-0.5 -top-0.5",
                  )}>
                    {expiryCount}
                  </span>
                )}
              </Link>
            );

            if (collapsed) {
              return (
                <Tooltip key={item.to}>
                  <TooltipTrigger asChild>
                    <span className="relative">{linkContent}</span>
                  </TooltipTrigger>
                  <TooltipContent side="right">{item.label}</TooltipContent>
                </Tooltip>
              );
            }

            return linkContent;
          })}
        </nav>

        {/* Bottom nav */}
        <div className="space-y-0.5 px-2 pb-3">
          <Separator className="mb-2 bg-white/15" />

          {/* Sync status indicator (Phase 14) */}
          <SyncStatusIndicator collapsed={collapsed} />

          {/* Today window launcher */}
          {(() => {
            const openToday = async () => {
              try {
                const existing = await WebviewWindow.getByLabel("today");
                if (existing) {
                  await existing.show();
                  await existing.setFocus();
                  return;
                }

                const { useSettingsStore } = await import("@/stores/settingsStore");
                const store = useSettingsStore.getState();
                if (!store.loaded) await store.loadSettings();
                const geoStr = store.getSetting("today_window_geometry", "");
                let geo: { x?: number; y?: number; width?: number; height?: number } = {};
                try { geo = geoStr ? JSON.parse(geoStr) : {}; } catch {}

                const win = new WebviewWindow("today", {
                  url: "/today",
                  title: "Today — Badami",
                  width: geo.width ?? 300,
                  height: geo.height ?? 480,
                  minWidth: 260,
                  minHeight: 360,
                  x: geo.x,
                  y: geo.y,
                  decorations: false,
                  transparent: false,
                  alwaysOnTop: true,
                  resizable: true,
                  center: !geo.x,
                });
                win.once("tauri://error", (e) => {
                  console.error("Today window error:", e);
                });
              } catch (err) {
                console.error("Failed to open Today window:", err);
              }
            };

            const btnContent = (
              <button
                onClick={openToday}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  "text-white/70 hover:bg-white/10 hover:text-white",
                  collapsed && "justify-center px-0",
                )}
              >
                <StickyNote className="h-5 w-5 shrink-0" />
                {!collapsed && <span>Today</span>}
              </button>
            );

            if (collapsed) {
              return (
                <Tooltip>
                  <TooltipTrigger asChild>{btnContent}</TooltipTrigger>
                  <TooltipContent side="right">Today</TooltipContent>
                </Tooltip>
              );
            }
            return btnContent;
          })()}

          {bottomItems.map((item) => {
            const isActive = currentPath.startsWith(item.to);
            const linkContent = (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-white/20 text-white shadow-sm backdrop-blur-sm"
                    : "text-white/70 hover:bg-white/10 hover:text-white",
                  collapsed && "justify-center px-0",
                )}
              >
                <item.icon className="h-5 w-5 shrink-0" />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            );

            if (collapsed) {
              return (
                <Tooltip key={item.to}>
                  <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
                  <TooltipContent side="right">{item.label}</TooltipContent>
                </Tooltip>
              );
            }

            return linkContent;
          })}
        </div>
      </div>
    </aside>
  );
}
