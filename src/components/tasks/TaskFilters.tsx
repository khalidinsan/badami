import { useEffect, useState, useRef, useCallback } from "react";
import { Filter, Search, X, CalendarDays, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { DatePicker } from "@/components/ui/date-picker";
import * as projectQueries from "@/db/queries/projects";
import type { ProjectRow, LabelRow } from "@/types/db";
import type { TaskFilters } from "@/stores/taskStore";

interface TaskFiltersBarProps {
  filters: TaskFilters;
  labels: LabelRow[];
  onFilterChange: (filters: TaskFilters) => void;
}

const STATUS_OPTIONS = [
  { value: "__all__", label: "All statuses" },
  { value: "todo", label: "To Do" },
  { value: "in_progress", label: "In Progress" },
  { value: "done", label: "Done" },
  { value: "cancelled", label: "Cancelled" },
];

const PRIORITY_OPTIONS = [
  { value: "__all__", label: "All priorities" },
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
  { value: "none", label: "None" },
];

export function TaskFiltersBar({
  filters,
  labels,
  onFilterChange,
}: TaskFiltersBarProps) {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [searchInput, setSearchInput] = useState(filters.search ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    projectQueries.getProjects("active").then(setProjects);
  }, []);

  useEffect(() => {
    setSearchInput(filters.search ?? "");
  }, [filters.search]);

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchInput(value);
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onFilterChange({ ...filters, search: value || undefined });
      }, 300);
    },
    [filters, onFilterChange],
  );

  const activeFilterCount = [
    filters.status,
    filters.priority,
    filters.project_id,
    filters.label_id,
    filters.date_from || filters.date_to,
  ].filter(Boolean).length;

  const clearPopoverFilters = () => {
    onFilterChange({ hide_completed: filters.hide_completed, search: filters.search });
  };

  return (
    <div className="flex items-center gap-2">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
        <input
          value={searchInput}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Search tasks..."
          className="h-8 w-48 rounded-lg border border-border/60 bg-transparent pl-8 pr-3 text-sm outline-none placeholder:text-muted-foreground/40 focus:border-primary/40 focus:bg-background"
        />
        {searchInput && (
          <button
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground"
            onClick={() => handleSearchChange("")}
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Filters popover */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant={activeFilterCount > 0 ? "secondary" : "outline"}
            size="sm"
            className="h-8 gap-1.5"
          >
            <Filter className="h-3.5 w-3.5" />
            Filters
            {activeFilterCount > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                {activeFilterCount}
              </span>
            )}
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-4">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Filters</p>
              {activeFilterCount > 0 && (
                <button
                  onClick={clearPopoverFilters}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Clear all
                </button>
              )}
            </div>

            {/* Status */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Status</label>
              <Select
                value={filters.status ?? "__all__"}
                onValueChange={(v) =>
                  onFilterChange({ ...filters, status: v === "__all__" ? undefined : v })
                }
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Priority */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Priority</label>
              <Select
                value={filters.priority ?? "__all__"}
                onValueChange={(v) =>
                  onFilterChange({ ...filters, priority: v === "__all__" ? undefined : v })
                }
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Project */}
            {projects.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Project</label>
                <Select
                  value={filters.project_id ?? "__all__"}
                  onValueChange={(v) =>
                    onFilterChange({ ...filters, project_id: v === "__all__" ? undefined : v })
                  }
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="All projects" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All projects</SelectItem>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Labels */}
            {labels.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Label</label>
                <div className="flex flex-wrap gap-1.5">
                  {labels.map((label) => {
                    const isActive = filters.label_id === label.id;
                    return (
                      <button
                        key={label.id}
                        onClick={() =>
                          onFilterChange({
                            ...filters,
                            label_id: isActive ? undefined : label.id,
                          })
                        }
                        className={cn(
                          "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                          isActive ? "text-white" : "bg-muted text-muted-foreground hover:bg-muted/80",
                        )}
                        style={isActive ? { backgroundColor: label.color } : undefined}
                      >
                        {label.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <Separator />

            {/* Date range */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                <CalendarDays className="mr-1 inline h-3 w-3" />
                Due date range
              </label>
              <div className="flex items-center gap-2">
                <DatePicker
                  value={filters.date_from ?? null}
                  onChange={(date) =>
                    onFilterChange({ ...filters, date_from: date ?? undefined })
                  }
                  placeholder="From"
                  size="sm"
                  className="flex-1"
                />
                <span className="text-xs text-muted-foreground">—</span>
                <DatePicker
                  value={filters.date_to ?? null}
                  onChange={(date) =>
                    onFilterChange({ ...filters, date_to: date ?? undefined })
                  }
                  placeholder="To"
                  size="sm"
                  className="flex-1"
                />
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

