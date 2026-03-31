import type { ProjectRow, ProjectCategoryRow } from "@/types/db";
import { cn } from "@/lib/utils";
import { Link } from "@tanstack/react-router";
import {
  Folder,
  Rocket,
  Lightbulb,
  Target,
  Smartphone,
  Globe,
  Palette,
  BarChart3,
  Wrench,
  FileText,
  Building2,
  Zap,
} from "lucide-react";

const PROJECT_ICON_COLORS: Record<string, string> = {
  red:    "bg-red-500/15 text-red-600",
  orange: "bg-orange-500/15 text-orange-600",
  yellow: "bg-yellow-500/15 text-yellow-600",
  green:  "bg-green-500/15 text-green-600",
  blue:   "bg-blue-500/15 text-blue-600",
  purple: "bg-purple-500/15 text-purple-600",
  pink:   "bg-pink-500/15 text-pink-600",
  indigo: "bg-indigo-500/15 text-indigo-600",
};

export const PROJECT_ICONS: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  folder: Folder,
  rocket: Rocket,
  lightbulb: Lightbulb,
  target: Target,
  smartphone: Smartphone,
  globe: Globe,
  palette: Palette,
  chart: BarChart3,
  wrench: Wrench,
  file: FileText,
  building: Building2,
  zap: Zap,
};

const STATUS_DOT: Record<string, string> = {
  active: "bg-green-500",
  on_hold: "bg-yellow-500",
  completed: "bg-blue-400",
  archived: "bg-gray-400",
};

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  on_hold: "On Hold",
  completed: "Completed",
  archived: "Archived",
};

interface ProjectCardProps {
  project: ProjectRow;
  categories: ProjectCategoryRow[];
}

export function ProjectCard({ project, categories }: ProjectCardProps) {
  const iconColor = PROJECT_ICON_COLORS[project.color ?? ""] ?? "bg-muted text-muted-foreground";
  const IconComponent = PROJECT_ICONS[project.icon ?? ""] ?? Folder;
  const categoryName = categories.find((c) => c.id === project.category)?.name;

  // Extract plain text from BlockNote JSON description
  let plainText = "";
  if (project.description) {
    try {
      const blocks = JSON.parse(project.description);
      plainText = Array.isArray(blocks)
        ? blocks
            .map((b: { content?: { text?: string }[] }) =>
              Array.isArray(b.content)
                ? b.content.map((c) => c.text ?? "").join("")
                : "",
            )
            .join(" ")
            .trim()
        : "";
    } catch {
      plainText = project.description;
    }
  }

  return (
    <Link to="/projects/$projectId" params={{ projectId: project.id }}>
      <div className="group flex h-full min-h-[88px] flex-col gap-3 rounded-xl border border-border/60 bg-card p-4 transition-all hover:border-border/80 hover:shadow-sm">
        {/* Top row: icon + name + status */}
        <div className="flex items-start gap-3">
          <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", iconColor)}>
            <IconComponent className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="truncate text-sm font-semibold leading-tight">{project.name}</p>
            <div className="mt-0.5 flex items-center gap-1">
              {categoryName && (
                <>
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">
                    {categoryName}
                  </span>
                  <span className="text-[10px] text-muted-foreground/30">·</span>
                </>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
            <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[project.status] ?? "bg-gray-400")} />
            <span className="text-[10px] text-muted-foreground">
              {STATUS_LABELS[project.status] ?? project.status}
            </span>
          </div>
        </div>

        {/* Description — always takes space so cards are uniform height */}
        <p className={cn(
          "line-clamp-2 text-xs leading-relaxed",
          plainText ? "text-muted-foreground/70" : "text-muted-foreground/30 italic",
        )}>
          {plainText || "No description"}
        </p>
      </div>
    </Link>
  );
}

