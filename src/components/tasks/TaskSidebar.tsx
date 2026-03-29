import { useEffect, useState } from "react";
import {
  Inbox,
  Star,
  CalendarCheck,
  CalendarClock,
  CalendarRange,
  AlertCircle,
  FolderKanban,
  Tag,
  CheckSquare,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTaskStore } from "@/stores/taskStore";
import * as projectQueries from "@/db/queries/projects";
import type { ProjectRow, LabelRow } from "@/types/db";
import type { SmartListType } from "@/types/task";

interface SmartListDef {
  type: SmartListType;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const SMART_LISTS: SmartListDef[] = [
  { type: "inbox", label: "Inbox", icon: Inbox },
  { type: "starred", label: "Starred", icon: Star },
  { type: "today", label: "Today", icon: CalendarCheck },
  { type: "tomorrow", label: "Tomorrow", icon: CalendarClock },
  { type: "next7days", label: "Next 7 Days", icon: CalendarRange },
  { type: "overdue", label: "Overdue", icon: AlertCircle },
];

interface TaskSidebarProps {
  labels: LabelRow[];
  activeFilter: {
    smart_list?: SmartListType;
    project_id?: string;
    label_id?: string;
  };
  onSelectSmartList: (list: SmartListType | undefined) => void;
  onSelectProject: (projectId: string | undefined) => void;
  onSelectLabel: (labelId: string | undefined) => void;
  isDraggingTask?: boolean;
  dragHoverProjectId?: string | null;
}

export function TaskSidebar({
  labels,
  activeFilter,
  onSelectSmartList,
  onSelectProject,
  onSelectLabel,
  isDraggingTask = false,
  dragHoverProjectId,
}: TaskSidebarProps) {
  const { smartListCounts, loadSmartListCounts } = useTaskStore();
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [labelsOpen, setLabelsOpen] = useState(true);

  useEffect(() => {
    loadSmartListCounts();
    projectQueries.getProjects("active").then(setProjects);
  }, []);

  const isAllActive = !activeFilter.smart_list && !activeFilter.project_id && !activeFilter.label_id;

  return (
    <aside className="flex h-full w-52 shrink-0 flex-col overflow-y-auto border-r border-border/50 bg-muted/20">
      {/* All Tasks */}
      <div className="px-2 pt-4">
        <SidebarItem
          icon={CheckSquare}
          label="All Tasks"
          active={isAllActive}
          onClick={() => onSelectSmartList(undefined)}
        />
      </div>

      {/* Smart Lists */}
      <div className="mt-0.5 px-2 pb-1 pt-3">
        <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
          Smart Lists
        </p>
        <div className="space-y-0.5">
          {SMART_LISTS.map((sl) => {
            const count = smartListCounts[sl.type] ?? 0;
            return (
              <SidebarItem
                key={sl.type}
                icon={sl.icon}
                label={sl.label}
                active={activeFilter.smart_list === sl.type}
                count={count}
                urgent={sl.type === "overdue" && count > 0}
                onClick={() => {
                  onSelectSmartList(sl.type);
                }}
              />
            );
          })}
        </div>
      </div>

      {/* Projects */}
      {projects.length > 0 && (
        <div className="px-2 pb-1 pt-3">
          <button
            onClick={() => setProjectsOpen((v) => !v)}
            className="mb-1 flex w-full items-center gap-1 px-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 hover:text-muted-foreground/70"
          >
            {projectsOpen ? (
              <ChevronDown className="h-2.5 w-2.5" />
            ) : (
              <ChevronRight className="h-2.5 w-2.5" />
            )}
            Projects
          </button>
          {projectsOpen && (
            <div className="space-y-0.5">
              {isDraggingTask && (
                <div
                  data-droppable-project="__inbox__"
                  className={cn(
                    "mb-0.5 flex items-center gap-2 rounded-lg border border-dashed px-2 py-1.5 text-xs transition-colors",
                    dragHoverProjectId === "__inbox__"
                      ? "border-primary/60 bg-primary/10 text-primary"
                      : "border-muted-foreground/30 text-muted-foreground/60 hover:border-primary/50 hover:bg-primary/5 hover:text-primary",
                  )}
                >
                  <Inbox className="h-3.5 w-3.5 shrink-0" />
                  <span>Move to Inbox</span>
                </div>
              )}
              {projects.map((p) => (
                <div
                  key={p.id}
                  data-droppable-project={isDraggingTask ? p.id : undefined}
                  className={cn(
                    isDraggingTask && "cursor-copy rounded-lg border border-dashed transition-colors",
                    isDraggingTask && dragHoverProjectId === p.id
                      ? "border-primary/60 bg-primary/10"
                      : isDraggingTask ? "border-transparent hover:border-primary/50 hover:bg-primary/5" : "",
                  )}
                >
                  <SidebarItem
                    icon={FolderKanban}
                    label={p.name}
                    active={activeFilter.project_id === p.id}
                    onClick={() => {
                      if (!isDraggingTask)
                        onSelectProject(activeFilter.project_id === p.id ? undefined : p.id);
                    }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Labels */}
      {labels.length > 0 && (
        <div className="px-2 pb-4 pt-3">
          <button
            onClick={() => setLabelsOpen((v) => !v)}
            className="mb-1 flex w-full items-center gap-1 px-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 hover:text-muted-foreground/70"
          >
            {labelsOpen ? (
              <ChevronDown className="h-2.5 w-2.5" />
            ) : (
              <ChevronRight className="h-2.5 w-2.5" />
            )}
            Labels
          </button>
          {labelsOpen && (
            <div className="space-y-0.5">
              {labels.map((label) => (
                <SidebarItem
                  key={label.id}
                  icon={Tag}
                  label={label.name}
                  active={activeFilter.label_id === label.id}
                  dot={label.color}
                  onClick={() => {
                    onSelectLabel(activeFilter.label_id === label.id ? undefined : label.id);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}

// ─── Sidebar item ────────────────────────────────────────────────────────────

interface SidebarItemProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active?: boolean;
  count?: number;
  urgent?: boolean;
  dot?: string;     // hex color for dot override
  onClick: () => void;
}

function SidebarItem({ icon: Icon, label, active, count, urgent, dot, onClick }: SidebarItemProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors",
        active
          ? "bg-primary/10 font-medium text-primary"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
    >
      {dot ? (
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: dot }}
        />
      ) : (
        <Icon className={cn("h-3.5 w-3.5 shrink-0", active && "text-primary")} />
      )}
      <span className="flex-1 truncate">{label}</span>
      {count !== undefined && count > 0 && (
        <span
          className={cn(
            "flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold",
            urgent
              ? "bg-red-500/15 text-red-600"
              : "bg-muted text-muted-foreground",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}
