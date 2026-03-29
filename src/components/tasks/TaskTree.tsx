import { useState, useEffect, useCallback, useRef } from "react";
import { Plus, CheckSquare2, RotateCcw, Trash2, Star, FolderKanban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TaskItem } from "./TaskItem";
import { SortableTaskItem } from "./SortableTaskItem";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
  type DragMoveEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useTaskStore } from "@/stores/taskStore";
import * as taskQueries from "@/db/queries/tasks";
import type { TaskRow, ProjectRow } from "@/types/db";

interface TaskTreeProps {
  tasks: TaskRow[];
  selectedTaskId: string | null;
  onSelectTask: (id: string) => void;
  onToggleTask: (id: string) => void;
  onDeleteTask?: (id: string) => void;
  projects?: ProjectRow[];
  onMoveToProject?: (taskId: string, projectId: string | null) => void;
  onDragTaskStart?: (taskId: string) => void;
  onDragTaskEnd?: () => void;
  onDragHoverChange?: (id: string | null) => void;
}

export function TaskTree({
  tasks,
  selectedTaskId,
  onSelectTask,
  onToggleTask,
  onDeleteTask,
  projects,
  onMoveToProject,
  onDragTaskStart,
  onDragTaskEnd,
  onDragHoverChange,
}: TaskTreeProps) {
  const { taskLabels, loadTaskLabelsBatch, loadSubtaskProgress, subtaskProgress, toggleStar, createTask } = useTaskStore();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [childrenMap, setChildrenMap] = useState<Map<string, TaskRow[]>>(
    new Map(),
  );
  const [addingSubtaskFor, setAddingSubtaskFor] = useState<string | null>(null);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
  const [parentIdsSet, setParentIdsSet] = useState<Set<string>>(new Set());
  const [activeDragTask, setActiveDragTask] = useState<TaskRow | null>(null);

  // Local copy of tasks so subtask checkboxes update immediately within this instance
  const [localTasks, setLocalTasks] = useState<TaskRow[]>(tasks);
  useEffect(() => {
    setLocalTasks(tasks);
  }, [tasks]);

  // Know upfront which tasks have children (so chevron is visible before expand)
  useEffect(() => {
    if (tasks.length === 0) return;
    taskQueries.getParentIdsAmong(tasks.map((t) => t.id)).then((ids) => {
      setParentIdsSet(new Set(ids));
      // Load subtask progress for parents
      if (ids.length > 0) {
        loadSubtaskProgress(ids);
      }
    });
  }, [tasks]);

  // Batch load labels for all tasks
  useEffect(() => {
    const missingIds = tasks.filter((t) => !taskLabels.has(t.id)).map((t) => t.id);
    if (missingIds.length > 0) {
      loadTaskLabelsBatch(missingIds);
    }
  }, [tasks, taskLabels, loadTaskLabelsBatch]);

  // Wraps onToggleTask to keep local state + children in sync after cascade
  const handleToggle = useCallback(
    async (id: string) => {
      // Optimistic: update local task state immediately
      const task = localTasks.find((t) => t.id === id);
      if (task) {
        const newStatus =
          task.status === "todo" ? "in_progress" : task.status === "in_progress" ? "done" : "todo";
        setLocalTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: newStatus } : t)));
      }

      // Fire store toggle (also optimistic)
      await onToggleTask(id);

      // If this task has loaded children, re-fetch them to show cascade
      if (expandedIds.has(id)) {
        taskQueries.getSubtasks(id).then((freshChildren) => {
          setChildrenMap((prev) => new Map(prev).set(id, freshChildren));
        });
      }
    },
    [onToggleTask, expandedIds, localTasks],
  );

  const toggleExpand = useCallback(
    async (taskId: string) => {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        if (next.has(taskId)) {
          next.delete(taskId);
        } else {
          next.add(taskId);
          // Load children if not already loaded
          if (!childrenMap.has(taskId)) {
            taskQueries.getSubtasks(taskId).then((children) => {
              setChildrenMap((prev) => new Map(prev).set(taskId, children));
            });
          }
        }
        return next;
      });
    },
    [childrenMap],
  );

  const handleAddSubtask = async (parentId: string, depth: number) => {
    if (!newSubtaskTitle.trim()) return;
    const task = await createTask({
      title: newSubtaskTitle.trim(),
      parent_id: parentId,
      depth: depth + 1,
    });
    setChildrenMap((prev) => {
      const next = new Map(prev);
      const existing = next.get(parentId) ?? [];
      next.set(parentId, [...existing, task]);
      return next;
    });
    setExpandedIds((prev) => new Set(prev).add(parentId));
    setNewSubtaskTitle("");
    setAddingSubtaskFor(null);
    // Mark parent as having children
    setParentIdsSet((prev) => new Set(prev).add(parentId));
  };

  const { sortBy, reorderTasks: reorderTasksAction } = useTaskStore();

  // Track pointer position so we can detect sidebar drops via elementFromPoint
  const lastPointerRef = useRef({ x: 0, y: 0 });
  useEffect(() => {
    const track = (e: PointerEvent) => {
      lastPointerRef.current = { x: e.clientX, y: e.clientY };
    };
    document.addEventListener("pointermove", track);
    return () => document.removeEventListener("pointermove", track);
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const task = localTasks.find((t) => t.id === event.active.id);
      setActiveDragTask(task ?? null);
      onDragTaskStart?.(event.active.id as string);
    },
    [onDragTaskStart, localTasks],
  );

  // Update hover indicator during drag
  const handleDragMove = useCallback(
    (_event: DragMoveEvent) => {
      if (!onDragHoverChange) return;
      const { x, y } = lastPointerRef.current;
      const elements = document.elementsFromPoint(x, y);
      const sidebarZone = elements.find((el) => el.hasAttribute("data-droppable-project"));
      if (sidebarZone) {
        onDragHoverChange(sidebarZone.getAttribute("data-droppable-project"));
        return;
      }
      const groupZone = elements.find((el) => el.hasAttribute("data-droppable-group"));
      onDragHoverChange(groupZone?.getAttribute("data-droppable-group") ?? null);
    },
    [onDragHoverChange],
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      onDragTaskEnd?.();
      onDragHoverChange?.(null);
      setActiveDragTask(null);
      const { active, over } = event;

      // elementsFromPoint (plural) — pierces DragOverlay to reach elements underneath
      const { x, y } = lastPointerRef.current;
      const elements = document.elementsFromPoint(x, y);

      // 1. Sidebar project drop zones
      const sidebarZone = elements.find((el) => el.hasAttribute("data-droppable-project"));
      if (sidebarZone && onMoveToProject) {
        const rawId = sidebarZone.getAttribute("data-droppable-project");
        const projectId = rawId === "__inbox__" ? null : rawId;
        await onMoveToProject(active.id as string, projectId ?? null);
        return;
      }

      // 2. Cross-group drop — pointer landed on a different project group
      const groupZone = elements.find((el) => el.hasAttribute("data-droppable-group"));
      if (groupZone && onMoveToProject) {
        const rawId = groupZone.getAttribute("data-droppable-group");
        const targetProjectId = rawId === "__none__" ? null : rawId;
        const activeTask = localTasks.find((t) => t.id === active.id);
        if (activeTask && targetProjectId !== (activeTask.project_id ?? null)) {
          await onMoveToProject(active.id as string, targetProjectId);
          return;
        }
      }

      // 3. Normal reorder within same group
      if (!over || active.id === over.id) return;
      const oldIndex = localTasks.findIndex((t) => t.id === active.id);
      const newIndex = localTasks.findIndex((t) => t.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = arrayMove(localTasks, oldIndex, newIndex);
      setLocalTasks(reordered);

      const updates = reordered.map((t, i) => ({ id: t.id, sort_order: i }));
      await reorderTasksAction(updates);
    },
    [localTasks, reorderTasksAction, onMoveToProject, onDragTaskEnd, onDragHoverChange],
  );

  const isManualSort = sortBy === "manual";

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onDragCancel={() => { onDragTaskEnd?.(); onDragHoverChange?.(null); setActiveDragTask(null); }}
    >
      <SortableContext
        items={localTasks.map((t) => t.id)}
        strategy={verticalListSortingStrategy}
        disabled={!isManualSort}
      >
        <div className="space-y-0.5">
          {localTasks.map((task) => {
            const isExpanded = expandedIds.has(task.id);
            const children = childrenMap.get(task.id);
            const hasLoadedChildren = !!children && children.length > 0;
            const hasChildren = parentIdsSet.has(task.id) || hasLoadedChildren;

            return (
              <div key={task.id}>
                <ContextMenu>
                  <ContextMenuTrigger asChild>
                    {isManualSort ? (
                      <div>
                        <SortableTaskItem
                          task={task}
                          labels={taskLabels.get(task.id)}
                          hasChildren={hasChildren}
                          expanded={isExpanded}
                          selected={selectedTaskId === task.id}
                          subtaskProgress={subtaskProgress.get(task.id)}
                          onToggle={handleToggle}
                          onToggleStar={toggleStar}
                          onClick={onSelectTask}
                          onExpand={toggleExpand}
                        >
                          {task.depth < 2 && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                              onClick={() => {
                                setAddingSubtaskFor(
                                  addingSubtaskFor === task.id ? null : task.id,
                                );
                                setNewSubtaskTitle("");
                              }}
                              title="Add subtask"
                            >
                              <Plus className="h-3 w-3" />
                            </Button>
                          )}
                        </SortableTaskItem>
                      </div>
                    ) : (
                      <div className="group relative flex items-center gap-1 rounded-lg transition-colors hover:bg-muted/60">
                        <div className="min-w-0 flex-1">
                          <TaskItem
                            task={task}
                            labels={taskLabels.get(task.id)}
                            depth={task.depth}
                            hasChildren={hasChildren}
                            expanded={isExpanded}
                            selected={selectedTaskId === task.id}
                            noHover
                            subtaskProgress={subtaskProgress.get(task.id)}
                            onToggle={handleToggle}
                            onToggleStar={toggleStar}
                            onClick={onSelectTask}
                            onExpand={toggleExpand}
                          />
                        </div>
                        {task.depth < 2 && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                            onClick={() => {
                              setAddingSubtaskFor(
                                addingSubtaskFor === task.id ? null : task.id,
                              );
                              setNewSubtaskTitle("");
                            }}
                            title="Add subtask"
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    )}
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem onClick={() => handleToggle(task.id)}>
                      {task.status === "done" || task.status === "cancelled" ? (
                        <><RotateCcw /> Reopen</>
                      ) : (
                        <><CheckSquare2 /> Mark Done</>
                      )}
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => toggleStar(task.id)}>
                      <Star className="h-4 w-4" />
                      {task.is_starred ? "Unstar" : "Star"}
                    </ContextMenuItem>
                    {onMoveToProject && projects && projects.length > 0 && (
                      <ContextMenuSub>
                        <ContextMenuSubTrigger>
                          <FolderKanban className="h-4 w-4" />
                          Move to Project
                        </ContextMenuSubTrigger>
                        <ContextMenuSubContent>
                          <ContextMenuItem onClick={() => onMoveToProject(task.id, null)}>
                            Inbox (No Project)
                          </ContextMenuItem>
                          <ContextMenuSeparator />
                          {projects.map((p) => (
                            <ContextMenuItem key={p.id} onClick={() => onMoveToProject(task.id, p.id)}>
                              {p.name}
                            </ContextMenuItem>
                          ))}
                        </ContextMenuSubContent>
                      </ContextMenuSub>
                    )}
                    {task.depth < 2 && task.status !== "done" && task.status !== "cancelled" && (
                      <ContextMenuItem onClick={() => setAddingSubtaskFor(task.id)}>
                        <Plus className="h-4 w-4" />
                        Add Subtask
                      </ContextMenuItem>
                    )}
                    {onDeleteTask && (
                      <>
                        <ContextMenuSeparator />
                        <ContextMenuItem variant="destructive" onClick={() => onDeleteTask(task.id)}>
                          <Trash2 /> Delete
                        </ContextMenuItem>
                      </>
                    )}
                  </ContextMenuContent>
                </ContextMenu>

                {/* Inline add subtask input */}
                {addingSubtaskFor === task.id && (
                  <div className="ml-12 mt-1 flex items-center gap-2 pr-2">
                    <Input
                      autoFocus
                      value={newSubtaskTitle}
                      onChange={(e) => setNewSubtaskTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleAddSubtask(task.id, task.depth);
                        if (e.key === "Escape") setAddingSubtaskFor(null);
                      }}
                      placeholder="Subtask title..."
                      className="h-7 text-xs"
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={() => handleAddSubtask(task.id, task.depth)}
                    >
                      Add
                    </Button>
                  </div>
                )}

                {/* Children */}
                {isExpanded && children && children.length > 0 && (
                  <TaskTree
                    tasks={children}
                    selectedTaskId={selectedTaskId}
                    onSelectTask={onSelectTask}
                    onToggleTask={handleToggle}
                    onDeleteTask={onDeleteTask}
                    projects={projects}
                    onMoveToProject={onMoveToProject}
                  />
                )}
              </div>
            );
          })}
        </div>
      </SortableContext>

      {/* DragOverlay portals to document.body — bypasses sidebar stacking context */}
      <DragOverlay dropAnimation={null}>
        {activeDragTask ? (
          <div className="rounded-lg border border-border/60 bg-background shadow-xl ring-1 ring-primary/20 opacity-95">
            <TaskItem
              task={activeDragTask}
              labels={taskLabels.get(activeDragTask.id)}
              depth={activeDragTask.depth}
              hasChildren={false}
              expanded={false}
              selected={false}
              noHover
              onToggle={() => {}}
              onClick={() => {}}
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
