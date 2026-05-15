import { X, Table2, FileCode2, LayoutGrid, Eye } from "lucide-react";
import { useDbStore, type DbTab } from "@/stores/dbStore";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";

export function DbTabBar() {
  const { tabs, activeTabId, setActiveTab, closeTab, openTab, activeConnectionId, activeDatabase } = useDbStore();

  const handleOpenObjects = () => {
    if (!activeConnectionId) return;
    const tab: DbTab = {
      id: "objects-" + activeConnectionId,
      type: "objects",
      title: "Objects",
      connectionId: activeConnectionId,
      database: activeDatabase ?? undefined,
    };
    openTab(tab);
  };

  const handleCloseOthers = (tabId: string) => {
    const state = useDbStore.getState();
    state.tabs.forEach((t) => {
      if (t.id !== tabId && t.type !== "objects") {
        state.closeTab(t.id);
      }
    });
  };

  const handleCloseToRight = (tabId: string) => {
    const state = useDbStore.getState();
    const idx = state.tabs.findIndex((t) => t.id === tabId);
    if (idx === -1) return;
    const tabsToClose = state.tabs.slice(idx + 1).filter((t) => t.type !== "objects");
    tabsToClose.forEach((t) => state.closeTab(t.id));
  };

  const handleCloseAll = () => {
    const state = useDbStore.getState();
    state.tabs.forEach((t) => {
      if (t.type !== "objects") {
        state.closeTab(t.id);
      }
    });
  };

  const getTabIcon = (tab: DbTab) => {
    const isActive = tab.id === activeTabId;
    switch (tab.type) {
      case "objects":
        return <LayoutGrid className={cn("h-3 w-3 shrink-0", isActive ? "text-amber-400" : "text-amber-400/50")} />;
      case "table":
        return <Table2 className={cn("h-3 w-3 shrink-0", isActive ? "text-blue-400" : "text-blue-400/50")} />;
      case "structure":
        return <FileCode2 className={cn("h-3 w-3 shrink-0", isActive ? "text-purple-400" : "text-purple-400/50")} />;
      case "er":
        return <Eye className={cn("h-3 w-3 shrink-0", isActive ? "text-teal-400" : "text-teal-400/50")} />;
      case "query":
      default:
        return <FileCode2 className={cn("h-3 w-3 shrink-0", isActive ? "text-green-400" : "text-green-400/50")} />;
    }
  };

  if (tabs.length === 0) {
    return (
      <div className="flex h-9 items-center border-b border-white/10 px-2 gap-1">
        <button
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-white/5"
          onClick={handleOpenObjects}
        >
          <LayoutGrid className="h-3 w-3" />
          Objects
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-9 items-center gap-0 overflow-x-auto border-b border-white/10 bg-background/40 px-1">
      {tabs.map((tab, i) => {
        const isActive = tab.id === activeTabId;
        const isObjectsTab = tab.type === "objects";

        const tabElement = (
          <div
            className={cn(
              "group relative flex h-9 shrink-0 cursor-pointer items-center gap-1.5 border-r border-white/10 px-3 text-xs transition-colors",
              isActive
                ? "bg-background text-foreground after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-[#007AFF]"
                : "text-muted-foreground hover:bg-white/5 hover:text-foreground/70",
              i === 0 && "border-l border-l-white/10",
            )}
            onClick={() => setActiveTab(tab.id)}
          >
            {getTabIcon(tab)}
            <span className="max-w-[120px] truncate">{tab.title}</span>
            {!isObjectsTab && (
              <button
                className="ml-0.5 shrink-0 rounded p-0.5 opacity-0 hover:bg-white/10 group-hover:opacity-60"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            )}
          </div>
        );

        // Objects tab doesn't get context menu for close actions
        if (isObjectsTab) {
          return <div key={tab.id}>{tabElement}</div>;
        }

        return (
          <ContextMenu key={tab.id}>
            <ContextMenuTrigger asChild>
              {tabElement}
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onClick={() => closeTab(tab.id)}>
                Close
              </ContextMenuItem>
              <ContextMenuItem onClick={() => handleCloseOthers(tab.id)}>
                Close Others
              </ContextMenuItem>
              <ContextMenuItem onClick={() => handleCloseToRight(tab.id)}>
                Close to the Right
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={handleCloseAll}>
                Close All
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        );
      })}
    </div>
  );
}
