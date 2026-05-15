import { useState, useRef, useEffect, useCallback } from "react";
import {
  X,
  CalendarDays,
  FolderKanban,
  CheckSquare,
  Server,
  KeyRound,
  Globe,
  Database,
  BarChart3,
  Settings,
  Info,
  Plus,
  Pin,
  ChevronLeft,
  ChevronRight,
  Bot,
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppTabStore, type AppTab, type AppTabType } from "@/stores/appTabStore";
import { useRouter } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  CalendarDays,
  FolderKanban,
  CheckSquare,
  Server,
  KeyRound,
  Globe,
  Database,
  BarChart3,
  Settings,
  Info,
  Bot,
};

const NEW_TAB_OPTIONS: { type: AppTabType; title: string; icon: string; route: string }[] = [
  { type: "planning", title: "Planning", icon: "CalendarDays", route: "/planning" },
  { type: "projects", title: "Projects", icon: "FolderKanban", route: "/projects" },
  { type: "tasks", title: "Tasks", icon: "CheckSquare", route: "/tasks" },
  { type: "servers", title: "Servers", icon: "Server", route: "/servers" },
  { type: "credentials", title: "Credentials", icon: "KeyRound", route: "/credentials" },
  { type: "api", title: "API", icon: "Globe", route: "/api" },
  { type: "database", title: "Database", icon: "Database", route: "/database" },
  { type: "ai", title: "AI Chat", icon: "Bot", route: "/ai" },
  { type: "stats", title: "Statistics", icon: "BarChart3", route: "/stats" },
  { type: "settings", title: "Settings", icon: "Settings", route: "/settings" },
];

export function AppTabBar() {
  const { tabs, activeTabId, setActiveTab, closeTab, closeOtherTabs, closeTabsToRight, closeAllTabs, openTab, renameTab, reorderTabs, pinTab, unpinTab } =
    useAppTabStore();
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showScrollLeft, setShowScrollLeft] = useState(false);
  const [showScrollRight, setShowScrollRight] = useState(false);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  // dnd-kit sensors — require 5px movement before drag starts (prevents accidental drags on click)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // ── Overflow detection ──────────────────────────────────────────
  const checkOverflow = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setShowScrollLeft(el.scrollLeft > 0);
    setShowScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    checkOverflow();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", checkOverflow);
    const ro = new ResizeObserver(checkOverflow);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", checkOverflow);
      ro.disconnect();
    };
  }, [checkOverflow, tabs.length]);

  const scrollLeftFn = () => scrollRef.current?.scrollBy({ left: -150, behavior: "smooth" });
  const scrollRightFn = () => scrollRef.current?.scrollBy({ left: 150, behavior: "smooth" });

  // ── Handlers ────────────────────────────────────────────────────
  const handleTabClick = (tab: AppTab) => {
    if (renamingTabId) return;
    setActiveTab(tab.id);
    router.navigate({ to: tab.route });
  };

  const handleCloseTab = (tabId: string) => {
    closeTab(tabId);
    const state = useAppTabStore.getState();
    const newActive = state.tabs.find((t) => t.id === state.activeTabId);
    if (newActive) {
      router.navigate({ to: newActive.route });
    }
  };

  // Middle-click to close
  const handleMouseDown = (e: React.MouseEvent, tabId: string) => {
    if (e.button === 1) {
      e.preventDefault();
      const tab = tabs.find((t) => t.id === tabId);
      if (tab && !tab.pinned) {
        handleCloseTab(tabId);
      }
    }
  };

  // Double-click to rename
  const handleDoubleClick = (tab: AppTab) => {
    setRenamingTabId(tab.id);
    setRenameValue(tab.title);
    setTimeout(() => renameInputRef.current?.select(), 0);
  };

  const handleRenameSubmit = () => {
    if (renamingTabId && renameValue.trim()) {
      renameTab(renamingTabId, renameValue.trim());
    }
    setRenamingTabId(null);
  };

  const handleNewTab = (option: (typeof NEW_TAB_OPTIONS)[number]) => {
    openTab({
      type: option.type,
      title: option.title,
      icon: option.icon,
      route: option.route,
    });
    router.navigate({ to: option.route });
  };

  // ── Drag & Drop (dnd-kit) ──────────────────────────────────────
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = tabs.findIndex((t) => t.id === active.id);
    const newIndex = tabs.findIndex((t) => t.id === over.id);
    if (oldIndex !== -1 && newIndex !== -1) {
      reorderTabs(oldIndex, newIndex);
    }
  };

  // ── Keyboard shortcuts (Cmd+1-9, Cmd+W) ────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod) return;

      // Cmd+W close active tab
      if (e.key === "w" && !e.shiftKey) {
        e.preventDefault();
        const state = useAppTabStore.getState();
        if (state.activeTabId) {
          const tab = state.tabs.find((t) => t.id === state.activeTabId);
          if (tab && !tab.pinned) {
            handleCloseTab(state.activeTabId);
          }
        }
        return;
      }

      // Cmd+1-9 switch tabs
      const num = parseInt(e.key);
      if (num >= 1 && num <= 9) {
        e.preventDefault();
        const state = useAppTabStore.getState();
        const idx = num - 1;
        if (idx < state.tabs.length) {
          const tab = state.tabs[idx];
          state.setActiveTab(tab.id);
          router.navigate({ to: tab.route });
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [router]);

  const tabIds = tabs.map((t) => t.id);

  return (
    <div className="relative flex h-[34px] items-center border-b border-border/60 bg-card/40">
      {/* Scroll left indicator */}
      {showScrollLeft && (
        <button
          className="absolute left-0 z-10 flex h-full w-6 items-center justify-center bg-gradient-to-r from-card/90 to-transparent"
          onClick={scrollLeftFn}
        >
          <ChevronLeft className="h-3 w-3 text-muted-foreground" />
        </button>
      )}

      {/* Tabs scroll area */}
      <div
        ref={scrollRef}
        className="flex h-full flex-1 items-center gap-0 overflow-x-auto overflow-y-hidden pl-1"
        style={{ scrollbarWidth: "none" }}
      >
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={tabIds} strategy={horizontalListSortingStrategy}>
            {tabs.map((tab) => (
              <SortableTab
                key={tab.id}
                tab={tab}
                isActive={tab.id === activeTabId}
                isRenaming={renamingTabId === tab.id}
                renameValue={renameValue}
                renameInputRef={renamingTabId === tab.id ? renameInputRef : undefined}
                onRenameChange={setRenameValue}
                onRenameSubmit={handleRenameSubmit}
                onRenameCancel={() => setRenamingTabId(null)}
                onClick={() => handleTabClick(tab)}
                onMouseDown={(e) => handleMouseDown(e, tab.id)}
                onDoubleClick={() => handleDoubleClick(tab)}
                onClose={() => handleCloseTab(tab.id)}
                onPin={() => pinTab(tab.id)}
                onUnpin={() => unpinTab(tab.id)}
                onCloseOthers={() => closeOtherTabs(tab.id)}
                onCloseRight={() => closeTabsToRight(tab.id)}
                onCloseAll={closeAllTabs}
                onRenameStart={() => handleDoubleClick(tab)}
              />
            ))}
          </SortableContext>
        </DndContext>
      </div>

      {/* Scroll right indicator */}
      {showScrollRight && (
        <button
          className="absolute right-8 z-10 flex h-full w-6 items-center justify-center bg-gradient-to-l from-card/90 to-transparent"
          onClick={scrollRightFn}
        >
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        </button>
      )}

      {/* New tab button */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted/40 hover:text-foreground mr-1.5 ml-0.5">
            <Plus className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {NEW_TAB_OPTIONS.map((opt) => {
            const Icon = ICON_MAP[opt.icon] ?? CalendarDays;
            return (
              <DropdownMenuItem key={opt.type} onClick={() => handleNewTab(opt)}>
                <Icon className="mr-2 h-3.5 w-3.5" />
                {opt.title}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// ── Sortable Tab Item ─────────────────────────────────────────────

interface SortableTabProps {
  tab: AppTab;
  isActive: boolean;
  isRenaming: boolean;
  renameValue: string;
  renameInputRef?: React.RefObject<HTMLInputElement | null>;
  onRenameChange: (v: string) => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
  onClick: () => void;
  onMouseDown: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onClose: () => void;
  onPin: () => void;
  onUnpin: () => void;
  onCloseOthers: () => void;
  onCloseRight: () => void;
  onCloseAll: () => void;
  onRenameStart: () => void;
}

function SortableTab({
  tab,
  isActive,
  isRenaming,
  renameValue,
  renameInputRef,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
  onClick,
  onMouseDown,
  onDoubleClick,
  onClose,
  onPin,
  onUnpin,
  onCloseOthers,
  onCloseRight,
  onCloseAll,
  onRenameStart,
}: SortableTabProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const IconComp = ICON_MAP[tab.icon] ?? CalendarDays;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={setNodeRef}
          style={style}
          {...attributes}
          {...listeners}
          onMouseDown={onMouseDown}
          onClick={onClick}
          onDoubleClick={onDoubleClick}
          className={cn(
            "group relative flex h-[34px] shrink-0 cursor-pointer items-center gap-1.5 px-3 text-[12px] font-medium transition-colors select-none",
            isActive
              ? "bg-background text-foreground after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-[#007AFF]"
              : "text-muted-foreground hover:bg-muted/40 hover:text-foreground/80",
            isDragging && "opacity-50 z-50",
          )}
        >
          {tab.pinned && (
            <Pin className="h-2.5 w-2.5 shrink-0 text-muted-foreground/50 -rotate-45" />
          )}
          <IconComp className="h-3.5 w-3.5 shrink-0 opacity-70" />

          {isRenaming ? (
            <Input
              ref={renameInputRef}
              value={renameValue}
              onChange={(e) => onRenameChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onRenameSubmit();
                if (e.key === "Escape") onRenameCancel();
                e.stopPropagation();
              }}
              onBlur={onRenameSubmit}
              className="h-5 w-[80px] border-0 bg-muted/50 px-1 text-[12px] shadow-none focus-visible:ring-1"
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="max-w-[120px] truncate">{tab.title}</span>
          )}

          {!tab.pinned && !isRenaming && (
            <button
              className="ml-0.5 shrink-0 rounded p-0.5 opacity-0 hover:bg-muted group-hover:opacity-60"
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <X className="h-2.5 w-2.5" />
            </button>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {!tab.pinned ? (
          <ContextMenuItem onClick={onPin}>
            <Pin className="mr-2 h-3.5 w-3.5" />
            Pin Tab
          </ContextMenuItem>
        ) : (
          <ContextMenuItem onClick={onUnpin}>
            <Pin className="mr-2 h-3.5 w-3.5" />
            Unpin Tab
          </ContextMenuItem>
        )}
        <ContextMenuItem onClick={onRenameStart}>
          Rename
        </ContextMenuItem>
        <ContextMenuSeparator />
        {!tab.pinned && (
          <ContextMenuItem onClick={onClose}>
            Close
          </ContextMenuItem>
        )}
        <ContextMenuItem onClick={onCloseOthers}>
          Close Others
        </ContextMenuItem>
        <ContextMenuItem onClick={onCloseRight}>
          Close to the Right
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onCloseAll}>
          Close All
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
