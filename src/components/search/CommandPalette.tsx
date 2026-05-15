import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { Command } from "cmdk";
import { AnimatePresence, motion } from "framer-motion";
import Fuse from "fuse.js";
import {
  FolderKanban,
  CheckSquare,
  FileText,
  Search,
  ArrowRight,
  KeyRound,
  Server,
  Globe,
  Zap,
  Database,
} from "lucide-react";
import { cn } from "@/lib/utils";
import * as projectQueries from "@/db/queries/projects";
import * as taskQueries from "@/db/queries/tasks";
import * as credentialQueries from "@/db/queries/credentials";
import * as serverQueries from "@/db/queries/servers";
import * as apiQueries from "@/db/queries/api";
import * as dbClientQueries from "@/db/queries/dbClient";
import { invoke } from "@tauri-apps/api/core";
import type { PageRow } from "@/types/db";

// ── Types ───────────────────────────────────────────────────────────

interface SearchItem {
  id: string;
  type: "project" | "task" | "page" | "credential" | "server" | "api_collection" | "api_request" | "db_connection" | "command";
  title: string;
  subtitle?: string;
  route: string;
}

type CategoryFilter = "all" | "projects" | "tasks" | "servers" | "credentials" | "api" | "database" | "commands";

// ── Recent items (localStorage) ─────────────────────────────────────

const RECENT_KEY = "badami_search_recent";
const MAX_RECENT = 10;

function getRecentItems(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
  } catch { return []; }
}

function addRecentItem(id: string) {
  const recent = getRecentItems().filter((r) => r !== id);
  recent.unshift(id);
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
}

// ── Props ───────────────────────────────────────────────────────────

interface OverlayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (route: string) => void;
  isWindow?: false;
  onClose?: never;
}

interface WindowProps {
  isWindow: true;
  onClose: () => void;
  open?: never;
  onOpenChange?: never;
  onNavigate?: never;
}

type CommandPaletteProps = OverlayProps | WindowProps;

// ── Commands (quick actions) ────────────────────────────────────────

const COMMANDS: SearchItem[] = [
  { id: "cmd-new-project", type: "command", title: "New Project", subtitle: "Create a new project", route: "/projects" },
  { id: "cmd-new-task", type: "command", title: "New Task", subtitle: "Create a new task", route: "/tasks" },
  { id: "cmd-planning", type: "command", title: "Go to Planning", subtitle: "Daily planning & calendar", route: "/planning" },
  { id: "cmd-projects", type: "command", title: "Go to Projects", subtitle: "All projects", route: "/projects" },
  { id: "cmd-tasks", type: "command", title: "Go to Tasks", subtitle: "Task management", route: "/tasks" },
  { id: "cmd-servers", type: "command", title: "Go to Servers", subtitle: "SSH & FTP servers", route: "/servers" },
  { id: "cmd-credentials", type: "command", title: "Go to Credentials", subtitle: "Credential vault", route: "/credentials" },
  { id: "cmd-api", type: "command", title: "Go to API", subtitle: "REST API tool", route: "/api" },
  { id: "cmd-database", type: "command", title: "Go to Database", subtitle: "Database client", route: "/database" },
  { id: "cmd-stats", type: "command", title: "Go to Statistics", subtitle: "Focus & pomodoro stats", route: "/stats" },
  { id: "cmd-settings", type: "command", title: "Go to Settings", subtitle: "App settings", route: "/settings" },
  { id: "cmd-about", type: "command", title: "About Badami", subtitle: "Version & info", route: "/about" },
];

// ── Component ───────────────────────────────────────────────────────

export function CommandPalette(props: CommandPaletteProps) {
  const isWindow = props.isWindow === true;
  const isOpen = isWindow || props.open;

  const [search, setSearch] = useState("");
  const [items, setItems] = useState<SearchItem[]>([]);
  const [category, setCategory] = useState<CategoryFilter>("all");
  const fuseRef = useRef<Fuse<SearchItem> | null>(null);

  const handleClose = useCallback(() => {
    if (isWindow) {
      props.onClose();
    } else {
      props.onOpenChange(false);
    }
  }, [isWindow, props]);

  // Detect prefix commands
  const { effectiveSearch, effectiveCategory } = useMemo(() => {
    const trimmed = search.trim();
    if (trimmed.startsWith(">")) return { effectiveSearch: trimmed.slice(1).trim(), effectiveCategory: "commands" as CategoryFilter };
    if (trimmed.startsWith("#")) return { effectiveSearch: trimmed.slice(1).trim(), effectiveCategory: "tasks" as CategoryFilter };
    if (trimmed.startsWith("@")) return { effectiveSearch: trimmed.slice(1).trim(), effectiveCategory: "servers" as CategoryFilter };
    if (trimmed.startsWith("/")) return { effectiveSearch: trimmed.slice(1).trim(), effectiveCategory: "projects" as CategoryFilter };
    return { effectiveSearch: trimmed, effectiveCategory: category };
  }, [search, category]);

  // Load searchable items
  useEffect(() => {
    if (!isOpen) return;
    const load = async () => {
      const [projects, tasks, allPages, allCredentials, allServers, allCollections, allRequests, allDbConnections] = await Promise.all([
        projectQueries.getProjects(),
        taskQueries.getTasks(),
        loadAllPages(),
        credentialQueries.getAllCredentials(),
        serverQueries.getAllServers(),
        apiQueries.getAllCollections(),
        loadAllApiRequests(),
        dbClientQueries.getConnections(),
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
          subtitle: [c.type, c.username, c.service_name, c.url].filter(Boolean).join(" · "),
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
        ...allDbConnections.map((d) => ({
          id: d.id,
          type: "db_connection" as const,
          title: d.name,
          subtitle: `${d.engine.toUpperCase()} · ${d.host}:${d.port}`,
          route: "/database",
        })),
        ...COMMANDS,
      ];

      setItems(searchItems);
      fuseRef.current = new Fuse(searchItems, {
        keys: [{ name: "title", weight: 2 }, { name: "subtitle", weight: 1 }],
        threshold: 0.35,
      });
    };
    load();
    setSearch("");
    setCategory("all");
  }, [isOpen]);

  // Filter by category then search
  const filtered = useMemo(() => {
    let pool = items;

    // Category filter
    if (effectiveCategory !== "all") {
      const typeMap: Record<CategoryFilter, string[]> = {
        all: [],
        projects: ["project", "page"],
        tasks: ["task"],
        servers: ["server"],
        credentials: ["credential"],
        api: ["api_collection", "api_request"],
        database: ["db_connection"],
        commands: ["command"],
      };
      const types = typeMap[effectiveCategory];
      if (types.length > 0) {
        pool = pool.filter((i) => types.includes(i.type));
      }
    }

    // Text search
    if (!effectiveSearch) {
      // Show recent items first, then rest
      const recentIds = getRecentItems();
      const recentItems = recentIds
        .map((id) => pool.find((i) => i.id === id))
        .filter(Boolean) as SearchItem[];
      const rest = pool.filter((i) => !recentIds.includes(i.id));
      return [...recentItems, ...rest].slice(0, 25);
    }

    // Use fuse on the filtered pool
    const fuse = new Fuse(pool, {
      keys: [{ name: "title", weight: 2 }, { name: "subtitle", weight: 1 }],
      threshold: 0.35,
    });
    return fuse.search(effectiveSearch, { limit: 25 }).map((r) => r.item);
  }, [effectiveSearch, effectiveCategory, items]);

  const navigateInMain = useCallback(
    async (route: string) => {
      if (isWindow) {
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
      addRecentItem(item.id);
      navigateInMain(item.route);
    },
    [navigateInMain],
  );

  const getIcon = (type: string) => {
    switch (type) {
      case "project": return <FolderKanban className="h-4 w-4 shrink-0 text-blue-500" />;
      case "task": return <CheckSquare className="h-4 w-4 shrink-0 text-orange-500" />;
      case "page": return <FileText className="h-4 w-4 shrink-0 text-purple-500" />;
      case "credential": return <KeyRound className="h-4 w-4 shrink-0 text-amber-500" />;
      case "server": return <Server className="h-4 w-4 shrink-0 text-emerald-500" />;
      case "api_collection": return <Globe className="h-4 w-4 shrink-0 text-sky-500" />;
      case "api_request": return <Zap className="h-4 w-4 shrink-0 text-violet-500" />;
      case "db_connection": return <Database className="h-4 w-4 shrink-0 text-teal-500" />;
      case "command": return <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />;
      default: return null;
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case "project": return "Project";
      case "task": return "Task";
      case "page": return "Page";
      case "credential": return "Credential";
      case "server": return "Server";
      case "api_collection": return "Collection";
      case "api_request": return "Request";
      case "db_connection": return "Database";
      case "command": return "Command";
      default: return type;
    }
  };

  const categories: { key: CategoryFilter; label: string; icon: React.ReactNode }[] = [
    { key: "all", label: "All", icon: <Search className="h-3 w-3" /> },
    { key: "projects", label: "Projects", icon: <FolderKanban className="h-3 w-3" /> },
    { key: "tasks", label: "Tasks", icon: <CheckSquare className="h-3 w-3" /> },
    { key: "servers", label: "Servers", icon: <Server className="h-3 w-3" /> },
    { key: "credentials", label: "Credentials", icon: <KeyRound className="h-3 w-3" /> },
    { key: "api", label: "API", icon: <Globe className="h-3 w-3" /> },
    { key: "database", label: "Database", icon: <Database className="h-3 w-3" /> },
    { key: "commands", label: "Commands", icon: <ArrowRight className="h-3 w-3" /> },
  ];

  if (!isOpen) return null;

  const commandContent = (
    <Command
      className={cn(
        "flex h-full flex-col overflow-hidden bg-popover/95 backdrop-blur-xl",
        isWindow
          ? "rounded-lg border border-border/30 shadow-lg"
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
          placeholder="Search or type > for commands, # tasks, @ servers, / projects..."
          className="flex-1 bg-transparent py-3.5 text-sm font-medium outline-none placeholder:text-muted-foreground/40"
        />
        {!isWindow && (
          <kbd className="shrink-0 rounded-lg border border-border/50 bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground/60">
            ESC
          </kbd>
        )}
      </div>

      {/* Category filter tabs */}
      <div className="flex items-center gap-0.5 overflow-x-auto overflow-y-hidden border-b border-border/30 px-3 py-1.5" style={{ scrollbarWidth: "none" }}>
        {categories.map((cat) => (
          <button
            key={cat.key}
            onClick={() => { setCategory(cat.key); setSearch(""); }}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
              effectiveCategory === cat.key
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/40",
            )}
          >
            {cat.icon}
            {cat.label}
          </button>
        ))}
      </div>

      <Command.List
        className={cn(
          "flex-1 overflow-auto px-2 py-2",
          isWindow ? "max-h-[calc(100vh-140px)]" : "max-h-[380px]",
        )}
      >
        <Command.Empty className="flex flex-col items-center gap-2 py-10 text-center">
          <Search className="h-8 w-8 text-muted-foreground/20" />
          <p className="text-sm text-muted-foreground/60">No results found</p>
          <p className="text-xs text-muted-foreground/40">Try a different search or category</p>
        </Command.Empty>

        {/* Results grouped by type */}
        {filtered.length > 0 && (() => {
          // Group items by type
          const groups = new Map<string, SearchItem[]>();
          for (const item of filtered) {
            const key = item.type;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push(item);
          }

          return Array.from(groups.entries()).map(([type, groupItems]) => (
            <Command.Group key={type} heading={getTypeLabel(type) + "s"}>
              {groupItems.map((item) => (
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
                    <p className="truncate font-medium leading-snug">{item.title}</p>
                    {item.subtitle && (
                      <p className="truncate text-xs leading-snug text-muted-foreground/60">{item.subtitle}</p>
                    )}
                  </div>
                  <span className="shrink-0 rounded-lg bg-muted/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/50">
                    {getTypeLabel(item.type)}
                  </span>
                </Command.Item>
              ))}
            </Command.Group>
          ));
        })()}
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
        <span className="ml-auto flex items-center gap-1.5 text-[10px] text-muted-foreground/40">
          <kbd className="rounded border border-border/40 bg-muted/30 px-1 py-px font-mono text-[10px]">&gt;</kbd>
          commands
          <kbd className="rounded border border-border/40 bg-muted/30 px-1 py-px font-mono text-[10px]">#</kbd>
          tasks
          <kbd className="rounded border border-border/40 bg-muted/30 px-1 py-px font-mono text-[10px]">@</kbd>
          servers
        </span>
      </div>
    </Command>
  );

  // Window mode: fill entire window
  if (isWindow) {
    return <div className="flex h-screen flex-col overflow-hidden bg-background">{commandContent}</div>;
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
          className="relative w-full max-w-[560px]"
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
