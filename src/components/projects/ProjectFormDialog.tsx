import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { PROJECT_ICONS } from "./ProjectCard";
import * as categoryQueries from "@/db/queries/projectCategories";
import type { ProjectRow, ProjectCategoryRow } from "@/types/db";

const COLORS = [
  { name: "red", class: "bg-red-500" },
  { name: "orange", class: "bg-orange-500" },
  { name: "yellow", class: "bg-yellow-500" },
  { name: "green", class: "bg-green-500" },
  { name: "blue", class: "bg-blue-500" },
  { name: "purple", class: "bg-purple-500" },
  { name: "pink", class: "bg-pink-500" },
  { name: "indigo", class: "bg-indigo-500" },
];

const ICON_KEYS = Object.keys(PROJECT_ICONS);

interface ProjectFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: {
    name: string;
    description?: string | null;
    icon?: string | null;
    color?: string | null;
    category?: string | null;
  }) => void;
  project?: ProjectRow | null;
  onCategoriesChange?: (categories: ProjectCategoryRow[]) => void;
}

export function ProjectFormDialog({
  open,
  onOpenChange,
  onSubmit,
  project,
  onCategoriesChange,
}: ProjectFormDialogProps) {
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [icon, setIcon] = useState(project?.icon ?? "folder");
  const [color, setColor] = useState(project?.color ?? "blue");
  const [category, setCategory] = useState(project?.category ?? "");

  const [categories, setCategories] = useState<ProjectCategoryRow[]>([]);
  const [newCatName, setNewCatName] = useState("");
  const [addingCat, setAddingCat] = useState(false);

  // Load categories from DB whenever dialog opens
  useEffect(() => {
    if (open) {
      categoryQueries.getProjectCategories().then(setCategories);
    }
  }, [open]);

  // Sync form fields when dialog opens / project prop changes
  useEffect(() => {
    if (open) {
      setName(project?.name ?? "");
      setDescription(project?.description ?? "");
      setIcon(project?.icon ?? "folder");
      setColor(project?.color ?? "blue");
      setCategory(project?.category ?? "");
      setNewCatName("");
      setAddingCat(false);
    }
  }, [open, project]);

  const handleAddCategory = async () => {
    const trimmed = newCatName.trim();
    if (!trimmed) return;
    const slug = trimmed.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
    const id = slug || `cat_${Date.now()}`;
    const created = await categoryQueries.createProjectCategory({ id, name: trimmed });
    const updated = [...categories, created];
    setCategories(updated);
    onCategoriesChange?.(updated);
    setNewCatName("");
    setAddingCat(false);
    setCategory(created.id);
  };

  const handleDeleteCategory = async (id: string) => {
    await categoryQueries.deleteProjectCategory(id);
    const updated = categories.filter((c) => c.id !== id);
    setCategories(updated);
    onCategoriesChange?.(updated);
    if (category === id) setCategory("");
  };

  const isEdit = !!project;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit({
      name: name.trim(),
      description: description.trim() || null,
      icon,
      color,
      category: category || null,
    });
    if (!isEdit) {
      setName("");
      setDescription("");
      setIcon("folder");
      setColor("blue");
      setCategory("");
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              {isEdit ? "Edit Project" : "New Project"}
            </DialogTitle>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="project-name">Name</Label>
              <Input
                id="project-name"
                placeholder="Project name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="project-desc">Description</Label>
              <Textarea
                id="project-desc"
                placeholder="Brief description (optional)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label>Icon</Label>
              <div className="flex flex-wrap gap-2">
                {ICON_KEYS.map((key) => {
                  const IconComp = PROJECT_ICONS[key];
                  return (
                    <button
                      key={key}
                      type="button"
                      className={cn(
                        "flex h-9 w-9 items-center justify-center rounded-md border transition-colors",
                        icon === key
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-transparent text-muted-foreground hover:bg-muted",
                      )}
                      onClick={() => setIcon(key)}
                    >
                      <IconComp className="h-4 w-4" />
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Color</Label>
              <div className="flex flex-wrap gap-2">
                {COLORS.map((c) => (
                  <button
                    key={c.name}
                    type="button"
                    className={cn(
                      "h-7 w-7 rounded-full transition-all",
                      c.class,
                      color === c.name
                        ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
                        : "opacity-60 hover:opacity-100",
                    )}
                    onClick={() => setColor(c.name)}
                  />
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Category</Label>
              <Select
                value={category || "__none__"}
                onValueChange={(v) => setCategory(v === "__none__" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="No category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No category</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      <div className="flex w-full items-center justify-between gap-2">
                        <span>{c.name}</span>
                        <button
                          type="button"
                          className="ml-auto text-muted-foreground/60 hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteCategory(c.id);
                          }}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    </SelectItem>
                  ))}
                  <div className="px-2 py-1.5">
                    {addingCat ? (
                      <div className="flex items-center gap-1.5">
                        <Input
                          autoFocus
                          value={newCatName}
                          onChange={(e) => setNewCatName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { e.preventDefault(); handleAddCategory(); }
                            if (e.key === "Escape") { setAddingCat(false); setNewCatName(""); }
                          }}
                          placeholder="Category name..."
                          className="h-6 text-xs"
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-xs"
                          onClick={handleAddCategory}
                          disabled={!newCatName.trim()}
                        >
                          Add
                        </Button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="flex w-full items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => setAddingCat(true)}
                      >
                        <Plus className="h-3 w-3" />
                        New category
                      </button>
                    )}
                  </div>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              {isEdit ? "Save Changes" : "Create Project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
