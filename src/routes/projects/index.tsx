import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo, useEffect } from "react";
import { Plus, Search, X, Pencil, Archive, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ProjectCard } from "@/components/projects/ProjectCard";
import { ProjectFormDialog } from "@/components/projects/ProjectFormDialog";
import { getProjectCategories } from "@/db/queries/projectCategories";
import { useProjectStore } from "@/stores/projectStore";
import type { ProjectRow, ProjectCategoryRow } from "@/types/db";

export const Route = createFileRoute("/projects/")({
  component: ProjectsPage,
});

const STATUS_OPTIONS = [
  { value: "__all__", label: "All Statuses" },
  { value: "active", label: "Active" },
  { value: "on_hold", label: "On Hold" },
  { value: "completed", label: "Completed" },
  { value: "archived", label: "Archived" },
];

function ProjectsPage() {
  const { projects, loading, createProject, updateProject, archiveProject, deleteProject, loadProjects } = useProjectStore();
  const [categories, setCategories] = useState<ProjectCategoryRow[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [categoryFilter, setCategoryFilter] = useState("__all__");

  // Context-menu state
  const [ctxProject, setCtxProject] = useState<ProjectRow | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    loadProjects();
    getProjectCategories().then(setCategories);
  }, []);

  const filtered = useMemo(() => {
    return projects.filter((p) => {
      const matchesStatus =
        statusFilter === "__all__" || p.status === statusFilter;
      const matchesCategory =
        categoryFilter === "__all__" || p.category === categoryFilter;
      const matchesSearch =
        !search.trim() ||
        p.name.toLowerCase().includes(search.toLowerCase().trim());
      return matchesStatus && matchesCategory && matchesSearch;
    });
  }, [projects, search, statusFilter, categoryFilter]);

  const hasActiveFilters =
    search.trim() || statusFilter !== "active" || categoryFilter !== "__all__";

  const clearFilters = () => {
    setSearch("");
    setStatusFilter("active");
    setCategoryFilter("__all__");
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-border/50 px-6 py-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Projects</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {loading
                ? "Loading..."
                : `${filtered.length}${filtered.length !== projects.length ? ` of ${projects.length}` : ""} project${projects.length !== 1 ? "s" : ""}`}
            </p>
          </div>
          <Button onClick={() => setFormOpen(true)} size="sm">
            <Plus className="mr-1.5 h-4 w-4" />
            New Project
          </Button>
        </div>

        {/* Filter toolbar */}
        <div className="mt-4 flex items-center gap-2">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/40" />
            <Input
              placeholder="Search projects..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 border-0 bg-muted/50 pl-8 text-sm shadow-none focus-visible:ring-1"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-muted-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 w-32 border-0 bg-muted/50 text-xs shadow-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="text-xs">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="h-8 w-36 border-0 bg-muted/50 text-xs shadow-none">
              <SelectValue placeholder="All Categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__" className="text-xs">All Categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id} className="text-xs">
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex gap-3 rounded-xl border border-l-4 border-border/40 p-4">
                <Skeleton className="h-9 w-9 shrink-0 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="h-3 w-full" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
              <Search className="h-5 w-5 text-muted-foreground/50" />
            </div>
            <p className="mt-4 text-sm font-medium text-muted-foreground">
              {hasActiveFilters ? "No projects match your filters" : "No projects yet"}
            </p>
            {hasActiveFilters ? (
              <button
                onClick={clearFilters}
                className="mt-2 text-xs text-primary hover:underline"
              >
                Clear filters
              </button>
            ) : (
              <Button onClick={() => setFormOpen(true)} size="sm" className="mt-4">
                <Plus className="mr-1.5 h-4 w-4" />
                Create your first project
              </Button>
            )}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((p) => (
              <ContextMenu key={p.id}>
                <ContextMenuTrigger className="block">
                  <ProjectCard project={p} categories={categories} />
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem
                    onClick={() => { setCtxProject(p); setEditOpen(true); }}
                  >
                    <Pencil /> Edit
                  </ContextMenuItem>
                  <ContextMenuItem
                    onClick={() => archiveProject(p.id)}
                  >
                    <Archive /> Archive
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    variant="destructive"
                    onClick={() => { setCtxProject(p); setDeleteOpen(true); }}
                  >
                    <Trash2 /> Delete
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))}
          </div>
        )}
      </div>

      <ProjectFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        onSubmit={createProject}
        onCategoriesChange={setCategories}
      />

      {/* Context-menu edit dialog */}
      {ctxProject && (
        <ProjectFormDialog
          open={editOpen}
          onOpenChange={(o) => { setEditOpen(o); if (!o) setCtxProject(null); }}
          onSubmit={(data) => updateProject(ctxProject.id, data)}
          project={ctxProject}
          onCategoriesChange={setCategories}
        />
      )}

      {/* Context-menu delete confirm */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Project</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete &quot;{ctxProject?.name}&quot; and all
              its pages. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setCtxProject(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (!ctxProject) return;
                await deleteProject(ctxProject.id);
                setCtxProject(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
