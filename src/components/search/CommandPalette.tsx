import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { Command } from "cmdk";
import { AnimatePresence, motion } from "framer-motion";
import Fuse from "fuse.js";
import {
  FolderKanban,
  CheckSquare,
  FileText,
  CalendarDays,
  Settings,
  Search,
  ArrowRight,
  KeyRound,
  Server,
  Globe,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import * as projectQueries from "@/db/queries/projects";
import * as taskQueries from "@/db/queries/tasks";
import * as credentialQueries from "@/db/queries/credentials";
import * as serverQueries from "@/db/queries/servers";
import * as apiQueries from "@/db/queries/api";
import { invoke } from "@tauri-apps/api/core";
import type { PageRow } from "@/types/db";

interface SearchItem {
  id: string;
  type: "project" | "task" | "page" | "credential" | "server" | "api_collection" | "api_request";
  title: string;
  subtitle?: string;
  route: string;
}

// Overlay mode (inside main window via Cmd+K)
interface OverlayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (route: string) => void;
  isWindow?: false;
  onClose?: never;
}

// Window mode (standalone search window)
interface WindowProps {
  isWindow: true;
  onClose: () => void;
  open?: never;
  onOpenChange?: never;
  onNavigate?: never;
}

type CommandPaletteProps = OverlayProps | WindowProps;

export function CommandPalette(props: CommandPaletteProps) {
  const isWindow = props.isWindow === true;
  const isOpen = isWindow || props.open;

  const [search, setSearch] = useState("");
  const [items, setItems] = useState<SearchItem[]>([]);
  const fuseRef = useRef<Fuse<SearchItem> | null>(null);

  const handleClose = useCallback(() => {
    if (isWindow) {
      props.onClose();
    } else {
      props.onOpenChange(false);
    }
  }, [isWindow, props]);

  // Load searchable items
  useEffect(() => {
    if (!isOpen) return;
    const load = async () => {
      const [projects, tasks, allPages, allCredentials, allServers, allCollections, allRequests] = await Promise.all([
        projectQueries.getProjects(),
        taskQueries.getTasks(),
        loadAllPages(),
        credentialQueries.getAllCredentials(),
        serverQueries.getAllServers(),
        apiQueries.getAllCollections(),
        loadAllApiRequests(),
      ]);

      const searchItems: SearchItem[] = [
        ...projects.map((p) => ({
          id: p.id,
          type: "project" as const,
          title: p.name,
          subtitle: p.status,
          route: `/projects/${p.id}`,
        })),
        ...tasks.map((t) => ({
          id: t.id,
          type: "task" as const,
          title: t.title,
          subtitle: t.status,
          route: "/tasks",
        })),
        ...allPages.map((p) => ({
          id: p.id,
          type: "page" as const,
          title: p.title,
          subtitle: p.category ?? undefined,
          route: `/projects/${p.project_id}/pages/${p.id}`,
        })),
        ...allCredentials.map((c) => ({
          id: c.id,
          type: "credential" as const,
          title: c.name,
          subtitle: [c.type, c.username, c.service_name, c.url]
            .filter(Boolean)
            .join(" · "),
          route: "/credentials",
        })),
        ...allServers.map((s) => ({
          id: s.id,
          type: "server" as const,
          title: s.name,
          subtitle: `${s.protocol.toUpperCase()} · ${s.host}:${s.port}`,
          route: "/servers",
        })),
        ...allCollections.map((c) => ({
          id: c.id,
          type: "api_collection" as const,
          title: c.name,
          subtitle: c.description ?? undefined,
          route: "/api",
        })),
        ...allRequests.map((r) => ({
          id: r.id,
          type: "api_request" as const,
          title: r.name,
          subtitle: `${r.method} · ${r.url}`,
          route: "/api",
        })),
      ];

      setItems(searchItems);
      fuseRef.current = new Fuse(searchItems, {
        keys: ["title", "subtitle"],
        threshold: 0.4,
        includeMatches: true,
      });
    };
    load();
    setSearch("");
  }, [isOpen]);

  const filtered = useMemo(() => {
    if (!search.trim()) return items.slice(0, 20);
    if (!fuseRef.current) return [];
    return fuseRef.current.search(search, { limit: 20 }).map((r) => r.item);
  }, [search, items]);

  const navigateInMain = useCallback(
    async (route: string) => {
      if (isWindow) {
        // invoke calls Rust directly — Rust evaluates window.location.assign()
        // in main window's webview. No React/event/timing issues.
        await invoke("navigate_main_window", { path: route });
        handleClose();
      } else if (props.onNavigate) {
        handleClose();
        props.onNavigate(route);
      }
    },
    [isWindow, handleClose, props],
  );

  const handleSelect = useCallback(
    async (item: SearchItem) => {
      navigateInMain(item.route);
    },
    [navigateInMain],
  );

  const getIcon = (type: string) => {
    switch (type) {
      case "project":
        return <FolderKanban className="h-4 w-4 shrink-0 text-blue-500" />;
      case "task":
        return <CheckSquare className="h-4 w-4 shrink-0 text-orange-500" />;
      case "page":
        return <FileText className="h-4 w-4 shrink-0 text-purple-500" />;
      case "credential":
        return <KeyRound className="h-4 w-4 shrink-0 text-amber-500" />;
      case "server":
        return <Server className="h-4 w-4 shrink-0 text-emerald-500" />;
      case "api_collection":
        return <Globe className="h-4 w-4 shrink-0 text-sky-500" />;
      case "api_request":
        return <Zap className="h-4 w-4 shrink-0 text-violet-500" />;
      default:
        return null;
    }
  };

  const quickLinks: { label: string; route: string; icon: React.ReactNode }[] =
    [
      {
        label: "Planning",
        route: "/planning",
        icon: <CalendarDays className="h-4 w-4" />,
      },
      {
        label: "Projects",
        route: "/projects",
        icon: <FolderKanban className="h-4 w-4" />,
      },
      {
        label: "Tasks",
        route: "/tasks",
        icon: <CheckSquare className="h-4 w-4" />,
      },
      {
        label: "Servers",
        route: "/servers",
        icon: <Server className="h-4 w-4" />,
      },
      {
        label: "Credentials",
        route: "/credentials",
        icon: <KeyRound className="h-4 w-4" />,
      },
      {
        label: "API",
        route: "/api",
        icon: <Globe className="h-4 w-4" />,
      },
      {
        label: "Settings",
        route: "/settings",
        icon: <Settings className="h-4 w-4" />,
      },
    ];

  if (!isOpen) return null;

  const commandContent = (
    <Command
      className={cn(
        "flex h-full flex-col overflow-hidden bg-popover/95 backdrop-blur-xl",
        isWindow
          ? "rounded-none border-0 shadow-none"
          : "rounded-2xl border border-border/40 shadow-2xl ring-1 ring-black/[0.04]",
      )}
      shouldFilter={false}
      onKeyDown={(e) => {
        if (e.key === "Escape") handleClose();
      }}
    >
      {/* Search input */}
      <div className="flex items-center gap-3 border-b border-border/40 px-4">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground/60" />
        <Command.Input
          autoFocus
          value={search}
          onValueChange={setSearch}
          placeholder="Search projects, tasks, pages..."
          className="flex-1 bg-transparent py-3.5 text-sm font-medium outline-none placeholder:text-muted-foreground/40"
        />
        {!isWindow && (
          <kbd className="shrink-0 rounded-lg border border-border/50 bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground/60">
            ESC
          </kbd>
        )}
      </div>

      <Command.List
        className={cn(
          "flex-1 overflow-auto px-2 py-2",
          "max-h-[400px]",
          "[&_[cmdk-group-heading]]:mb-1.5 [&_[cmdk-group-heading]]:mt-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-muted-foreground/50",
          "[&_[cmdk-group]+[cmdk-group]]:mt-1",
        )}
      >
        <Command.Empty className="flex flex-col items-center gap-2 py-10 text-center">
          <Search className="h-8 w-8 text-muted-foreground/20" />
          <p className="text-sm text-muted-foreground/60">No results found</p>
        </Command.Empty>

        {/* Quick links when no search */}
        {!search.trim() && (
          <Command.Group heading="Navigate">
            {quickLinks.map((link) => (
              <Command.Item
                key={link.route}
                value={link.label}
                onSelect={() => navigateInMain(link.route)}
                className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all duration-150 select-none hover:bg-accent/60 data-[selected=true]:bg-accent"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground">
                  {link.icon}
                </span>
                <span className="flex-1 font-medium">{link.label}</span>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/30" />
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {/* Search results */}
        {filtered.length > 0 && (
          <Command.Group heading={search.trim() ? "Results" : "Recent"}>
            {filtered.map((item) => (
              <Command.Item
                key={`${item.type}-${item.id}`}
                value={`${item.type}-${item.id}`}
                onSelect={() => handleSelect(item)}
                className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all duration-150 select-none hover:bg-accent/60 data-[selected=true]:bg-accent"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted/60">
                  {getIcon(item.type)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium leading-snug">
                    {item.title}
                  </p>
                  {item.subtitle && (
                    <p className="truncate text-xs leading-snug text-muted-foreground/60">
                      {item.subtitle}
                    </p>
                  )}
                </div>
                <span className="shrink-0 rounded-lg bg-muted/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/50">
                  {item.type}
                </span>
              </Command.Item>
            ))}
          </Command.Group>
        )}
      </Command.List>

      {/* Footer hints */}
      <div className="flex items-center gap-4 border-t border-border/40 px-4 py-2">
        <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground/40">
          <kbd className="rounded border border-border/40 bg-muted/30 px-1 py-px font-mono text-[10px]">↑↓</kbd>
          navigate
        </span>
        <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground/40">
          <kbd className="rounded border border-border/40 bg-muted/30 px-1 py-px font-mono text-[10px]">↵</kbd>
          open
        </span>
        <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground/40">
          <kbd className="rounded border border-border/40 bg-muted/30 px-1 py-px font-mono text-[10px]">esc</kbd>
          close
        </span>
      </div>
    </Command>
  );

  // Window mode: fill entire window, no backdrop
  if (isWindow) {
    return <div className="flex h-screen flex-col">{commandContent}</div>;
  }

  // Overlay mode
  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-start justify-center pt-[18vh]">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          className="absolute inset-0 bg-black/30 backdrop-blur-sm"
          onClick={handleClose}
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.97, y: -6 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: -6 }}
          transition={{ duration: 0.12, ease: [0.32, 0.72, 0, 1] }}
          className="relative w-full max-w-[520px]"
        >
          {commandContent}
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

async function loadAllPages(): Promise<PageRow[]> {
  const { db } = await import("@/db/client");
  return await db
    .selectFrom("pages")
    .selectAll()
    .orderBy("created_at", "desc")
    .execute();
}

async function loadAllApiRequests() {
  const { db } = await import("@/db/client");
  return await db
    .selectFrom("api_requests")
    .select(["id", "collection_id", "name", "method", "url"])
    .orderBy("created_at", "desc")
    .execute();
}
