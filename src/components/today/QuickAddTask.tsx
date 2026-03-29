import { useState, useEffect, useRef, useCallback } from "react";
import { FolderKanban, X } from "lucide-react";
import { cn } from "@/lib/utils";
import * as planningQueries from "@/db/queries/planning";
import * as projectQueries from "@/db/queries/projects";
import { today } from "@/lib/dateUtils";
import { emit } from "@tauri-apps/api/event";
import type { ProjectRow } from "@/types/db";

interface QuickAddTaskProps {
  onAdded: () => void;
  autoFocus?: boolean;
  onCancel?: () => void;
}

export function QuickAddTask({ onAdded, autoFocus, onCancel }: QuickAddTaskProps) {
  const [text, setText] = useState("");
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [selectedProject, setSelectedProject] = useState<ProjectRow | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    projectQueries.getProjects("active").then(setProjects);
  }, []);

  const filteredProjects = mentionQuery !== null
    ? projects.filter((p) =>
        p.name.toLowerCase().includes(mentionQuery.toLowerCase()),
      ).slice(0, 5)
    : [];

  const extractMention = useCallback((value: string): string | null => {
    const atIdx = value.lastIndexOf("@");
    if (atIdx === -1) return null;
    // Only trigger if @ is at start or preceded by a space
    if (atIdx > 0 && value[atIdx - 1] !== " ") return null;
    return value.slice(atIdx + 1);
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setText(value);
    const mention = extractMention(value);
    setMentionQuery(mention);
    if (mention !== null) setMentionIndex(0);
  };

  const selectProject = (project: ProjectRow) => {
    // Remove @query from text
    const atIdx = text.lastIndexOf("@");
    const newText = atIdx > 0 ? text.slice(0, atIdx).trimEnd() : "";
    setText(newText);
    setSelectedProject(project);
    setMentionQuery(null);
    inputRef.current?.focus();
  };

  const clearProject = () => {
    setSelectedProject(null);
    inputRef.current?.focus();
  };

  const [adding, setAdding] = useState(false);

  const handleAdd = async () => {
    const trimmed = text.trim();
    if (!trimmed) {
      onCancel?.();
      return;
    }
    if (adding) return;
    setAdding(true);
    // Clear input immediately for snappy UX
    setText("");
    setSelectedProject(null);
    setMentionQuery(null);
    try {
      await planningQueries.createScheduledNote(
        today(),
        trimmed,
        selectedProject?.id ?? null,
      );
      emit("task-changed").catch(() => {});
      onAdded();
    } catch (err) {
      console.error(err);
    } finally {
      setAdding(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (mentionQuery !== null && filteredProjects.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => Math.min(i + 1, filteredProjects.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        selectProject(filteredProjects[mentionIndex]);
        return;
      }
    }
    if (e.key === "Enter") handleAdd();
    if (e.key === "Escape") {
      if (mentionQuery !== null) {
        setMentionQuery(null);
      } else {
        onCancel?.();
      }
    }
  };

  return (
    <div className="relative">
      {/* Project chip */}
      {selectedProject && (
        <div className="mb-1 flex items-center gap-1">
          <div className="flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
            <FolderKanban className="h-2.5 w-2.5" />
            <span className="max-w-[140px] truncate">{selectedProject.name}</span>
            <button
              onClick={clearProject}
              className="ml-0.5 rounded-sm hover:bg-primary/20"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </div>
        </div>
      )}

      <input
        ref={inputRef}
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus={autoFocus}
        value={text}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          // Delay to allow click on dropdown
          setTimeout(() => {
            if (!text.trim() && !selectedProject) onCancel?.();
          }, 150);
        }}
        placeholder={selectedProject ? "Task title..." : "Add task... (@ to assign project)"}
        className="w-full rounded-md bg-black/5 px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground/50 focus:bg-black/10 dark:bg-white/5 dark:focus:bg-white/10"
      />

      {/* @mention dropdown */}
      {mentionQuery !== null && filteredProjects.length > 0 && (
        <div className="absolute bottom-full left-0 z-50 mb-1 max-h-40 w-full overflow-y-auto rounded-lg border border-border/50 bg-popover p-1 shadow-lg">
          {filteredProjects.map((p, i) => (
            <button
              key={p.id}
              onMouseDown={(e) => {
                e.preventDefault(); // prevent input blur
                selectProject(p);
              }}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors hover:bg-accent",
                i === mentionIndex && "bg-accent",
              )}
            >
              <FolderKanban className="h-3 w-3 text-muted-foreground/50" />
              <span className="truncate">{p.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
