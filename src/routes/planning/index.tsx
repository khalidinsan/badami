import { createFileRoute } from "@tanstack/react-router";
import { useState, useCallback, useMemo, useEffect } from "react";
import { Plus, CalendarDays, Download, X, List } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePlanning } from "@/hooks/usePlanning";
import { CalendarView } from "@/components/planning/CalendarView";
import { AgendaView } from "@/components/planning/AgendaView";
import { DailyTaskList } from "@/components/planning/DailyTaskList";
import { TaskPool } from "@/components/planning/TaskPool";
import { today, formatDate } from "@/lib/dateUtils";
import * as projectQueries from "@/db/queries/projects";
import type { ProjectRow } from "@/types/db";
import dayjs from "dayjs";

export const Route = createFileRoute("/planning/")({ component: PlanningPage });

type PlanningViewMode = "calendar" | "agenda";

function PlanningPage() {
  const {
    tasks,
    selectedDate,
    loading,
    calendarEvents,
    loadTasks,
    loadCalendarEvents,
    scheduleTask,
    rescheduleTask,
    createNote,
    toggleTask,
    unscheduleTask,
    importProjectTasks,
    reorderTasks,
  } = usePlanning();

  const [panelOpen, setPanelOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [planViewMode, setPlanViewMode] = useState<PlanningViewMode>("calendar");

  useEffect(() => {
    projectQueries.getProjects("active").then(setProjects);
  }, []);

  useEffect(() => {
    const start = dayjs(selectedDate).startOf("month").format("YYYY-MM-DD");
    const end = dayjs(selectedDate).endOf("month").format("YYYY-MM-DD");
    loadCalendarEvents(start, end);
  }, [selectedDate]);

  const handleDateClick = useCallback(
    (date: string) => {
      loadTasks(date);
      setPanelOpen(true);
    },
    [loadTasks],
  );

  const handleEventDrop = useCallback(
    (taskId: string, newDate: string) => {
      rescheduleTask(taskId, newDate);
    },
    [rescheduleTask],
  );

  const handleClosePanel = () => setPanelOpen(false);

  const handleAddNote = async () => {
    if (!noteText.trim()) return;
    await createNote(selectedDate, noteText.trim());
    setNoteText("");
  };

  const handleAddTask = async (taskId: string) => {
    await scheduleTask(taskId, selectedDate);
  };

  const handleImportProject = async (projectId: string) => {
    if (projectId === "__none__") return;
    await importProjectTasks(projectId, selectedDate);
  };

  const existingTaskIds = useMemo(
    () => new Set(tasks.map((t) => t.id)),
    [tasks],
  );

  const isToday = selectedDate === today();

  return (
    <div className="relative h-full">
      {/* View mode toggle */}
      <div className="absolute left-5 top-4 z-10">
        <Tabs value={planViewMode} onValueChange={(v) => setPlanViewMode(v as PlanningViewMode)}>
          <TabsList className="h-8">
            <TabsTrigger value="calendar" className="h-6 gap-1 px-2 text-xs">
              <CalendarDays className="h-3 w-3" />
              Calendar
            </TabsTrigger>
            <TabsTrigger value="agenda" className="h-6 gap-1 px-2 text-xs">
              <List className="h-3 w-3" />
              Agenda
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Full-width Calendar or Agenda */}
      <div className="h-full overflow-hidden px-5 pt-14">
        {planViewMode === "calendar" ? (
          <CalendarView
            selectedDate={panelOpen ? selectedDate : null}
            calendarEvents={calendarEvents}
            onDateClick={handleDateClick}
            onEventDrop={handleEventDrop}
          />
        ) : (
          <AgendaView
            onSelectDate={handleDateClick}
            onToggleTask={(taskId) => toggleTask(taskId)}
          />
        )}
      </div>

      {/* Slide-in daily plan panel — fixed to viewport right edge */}
      <div
        className={`fixed inset-y-0 right-0 z-20 flex w-80 flex-col border-l border-border/60 bg-background shadow-xl transition-transform duration-300 ease-in-out ${
          panelOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Panel Header */}
        <div className="flex shrink-0 items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-primary" />
            <div>
              <p className="text-sm font-bold">
                {isToday ? "Today" : formatDate(selectedDate)}
              </p>
              {isToday && (
                <p className="text-xs text-muted-foreground">
                  {formatDate(selectedDate)}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {/* Import from project */}
            <Select onValueChange={handleImportProject}>
              <SelectTrigger className="h-7 w-7 border-none p-0 shadow-none [&>svg]:hidden">
                <Download className="h-3.5 w-3.5 text-muted-foreground" />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="__none__" disabled>
                  Import from project
                </SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={handleClosePanel}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <Separator />

        {/* Task list */}
        <div className="flex-1 overflow-auto px-4 py-3">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : (
            <DailyTaskList
              tasks={tasks}
              onToggle={toggleTask}
              onDelete={unscheduleTask}
              onDropTask={handleAddTask}
              onReorder={reorderTasks}
            />
          )}
        </div>

        <Separator />

        {/* Add note */}
        <div className="shrink-0 px-4 py-3">
          <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 transition-colors focus-within:border-primary/40 focus-within:bg-background">
            <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
            <input
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddNote();
              }}
              placeholder="Add a note..."
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/40"
            />
          </div>
        </div>

        {/* Task Pool */}
        <div className="shrink-0 border-t border-border/50 px-4 pb-4 pt-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Unscheduled
          </h3>
          <TaskPool
            selectedDate={selectedDate}
            existingTaskIds={existingTaskIds}
            onAddTask={handleAddTask}
          />
        </div>
      </div>
    </div>
  );
}
