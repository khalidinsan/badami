import { useEffect, useState } from "react";
import { CheckSquare2, Trash2, FolderKanban, Flag, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import * as projectQueries from "@/db/queries/projects";
import type { ProjectRow } from "@/types/db";

interface BulkActionBarProps {
  count: number;
  onComplete: () => void;
  onDelete: () => void;
  onSetPriority: (priority: string) => void;
  onMoveToProject: (projectId: string | null) => void;
  onCancel: () => void;
}

const PRIORITY_OPTIONS = [
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
  { value: "none", label: "None" },
];

export function BulkActionBar({
  count,
  onComplete,
  onDelete,
  onSetPriority,
  onMoveToProject,
  onCancel,
}: BulkActionBarProps) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectRow[]>([]);

  useEffect(() => {
    projectQueries.getProjects("active").then(setProjects);
  }, []);

  if (count === 0) return null;

  return (
    <>
      <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-border/60 bg-background/95 px-4 py-2.5 shadow-lg backdrop-blur-md">
        <span className="mr-1 text-xs font-medium text-muted-foreground">
          {count} selected
        </span>

        <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={onComplete}>
          <CheckSquare2 className="h-3.5 w-3.5" />
          Complete
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs">
              <FolderKanban className="h-3.5 w-3.5" />
              Move
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={() => onMoveToProject(null)}>
              No project
            </DropdownMenuItem>
            {projects.map((p) => (
              <DropdownMenuItem key={p.id} onClick={() => onMoveToProject(p.id)}>
                {p.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs">
              <Flag className="h-3.5 w-3.5" />
              Priority
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {PRIORITY_OPTIONS.map((opt) => (
              <DropdownMenuItem key={opt.value} onClick={() => onSetPriority(opt.value)}>
                {opt.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 text-xs text-destructive hover:bg-destructive/10"
          onClick={() => setDeleteOpen(true)}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </Button>

        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs text-muted-foreground"
          onClick={onCancel}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {count} task(s)</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the selected tasks and all subtasks. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { onDelete(); setDeleteOpen(false); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
