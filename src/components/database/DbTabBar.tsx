import { X, Table2, FileCode2, Plus } from "lucide-react";
import { useDbStore, type DbTab } from "@/stores/dbStore";
import { cn } from "@/lib/utils";
import { v4 as uuidv4 } from "uuid";

export function DbTabBar() {
  const { tabs, activeTabId, setActiveTab, closeTab, openTab, activeConnectionId, activeDatabase } = useDbStore();

  const handleNewQuery = () => {
    if (!activeConnectionId) return;
    const tab: DbTab = {
      id: uuidv4(),
      type: "query",
      title: "Query " + (tabs.filter((t) => t.type === "query").length + 1),
      connectionId: activeConnectionId,
      sqlContent: "",
      database: activeDatabase ?? undefined,
    };
    openTab(tab);
  };

  if (tabs.length === 0) {
    return (
      <div className="flex h-9 items-center border-b border-white/10 px-2">
        <button
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-white/5"
          onClick={handleNewQuery}
        >
          <Plus className="h-3 w-3" />
          New Query
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-9 items-center gap-0 overflow-x-auto border-b border-white/10 bg-background/40 px-1">
      {tabs.map((tab, i) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            className={cn(
              "group relative flex h-9 shrink-0 cursor-pointer items-center gap-1.5 border-r border-white/10 px-3 text-xs transition-colors",
              isActive
                ? "bg-background text-foreground after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-[#007AFF]"
                : "text-muted-foreground hover:bg-white/5 hover:text-foreground/70",
              i === 0 && "border-l border-l-white/10",
            )}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.type === "table" ? (
              <Table2 className={cn("h-3 w-3 shrink-0", isActive ? "text-blue-400" : "text-blue-400/50")} />
            ) : tab.type === "structure" ? (
              <FileCode2 className={cn("h-3 w-3 shrink-0", isActive ? "text-purple-400" : "text-purple-400/50")} />
            ) : (
              <FileCode2 className={cn("h-3 w-3 shrink-0", isActive ? "text-green-400" : "text-green-400/50")} />
            )}
            <span className="max-w-[120px] truncate">{tab.title}</span>
            <button
              className="ml-0.5 shrink-0 rounded p-0.5 opacity-0 hover:bg-white/10 group-hover:opacity-60"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </div>
        );
      })}
      <button
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-white/5"
        onClick={handleNewQuery}
      >
        <Plus className="h-3 w-3" />
      </button>
    </div>
  );
}
