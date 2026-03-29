import type { ProjectRow, ProjectCategoryRow } from "@/types/db";
import { ProjectCard } from "./ProjectCard";
import { FolderKanban } from "lucide-react";

interface ProjectListProps {
  projects: ProjectRow[];
  categories: ProjectCategoryRow[];
}

export function ProjectList({ projects, categories }: ProjectListProps) {
  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <FolderKanban className="h-6 w-6" />
        </div>
        <p className="mt-3 text-sm font-medium text-muted-foreground">
          No projects yet
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Create your first project to get started
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {projects.map((project) => (
        <ProjectCard key={project.id} project={project} categories={categories} />
      ))}
    </div>
  );
}
