import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useCallback, useRef } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { BlockNoteEditor } from "@/components/editor/BlockNoteEditor";
import * as pageQueries from "@/db/queries/pages";
import type { PageRow } from "@/types/db";

export const Route = createFileRoute(
  "/projects/$projectId/pages/$pageId",
)({
  component: PageDetail,
});

const CATEGORIES = [
  { value: "brief", label: "Brief" },
  { value: "feature", label: "Feature" },
  { value: "screenshot", label: "Screenshot" },
  { value: "notes", label: "Notes" },
  { value: "custom", label: "Custom" },
];

function PageDetail() {
  const { projectId, pageId } = Route.useParams();
  const navigate = useNavigate();
  const [page, setPage] = useState<PageRow | null>(null);
  const [title, setTitle] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const titleTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    pageQueries.getPageById(pageId).then((p) => {
      if (p) {
        setPage(p);
        setTitle(p.title);
      }
    });
  }, [pageId]);

  const handleTitleChange = (value: string) => {
    setTitle(value);
    if (titleTimeout.current) clearTimeout(titleTimeout.current);
    titleTimeout.current = setTimeout(() => {
      pageQueries.updatePage(pageId, { title: value });
    }, 500);
  };

  const handleCategoryChange = async (category: string) => {
    const updated = await pageQueries.updatePage(pageId, { category });
    if (updated) setPage(updated);
  };

  const handleContentChange = useCallback(
    async (content: string) => {
      await pageQueries.updatePage(pageId, { content });
    },
    [pageId],
  );

  const handleDelete = async () => {
    await pageQueries.deletePage(pageId);
    navigate({
      to: "/projects/$projectId",
      params: { projectId },
    });
  };

  if (!page) return null;

  return (
    <div className="flex min-h-full flex-col">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border/50 bg-background/80 px-8 py-3 backdrop-blur-sm">
        <Input
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          className="min-w-0 flex-1 border-none bg-transparent px-0 text-xl font-bold tracking-tight shadow-none placeholder:text-muted-foreground/40 focus-visible:ring-0"
          placeholder="Untitled"
        />
        <Select value={page.category ?? "notes"} onValueChange={handleCategoryChange}>
          <SelectTrigger className="h-7 w-28 shrink-0 rounded-full border-border/50 text-[11px] font-medium">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((cat) => (
              <SelectItem key={cat.value} value={cat.value}>
                {cat.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-muted-foreground/50 hover:text-destructive"
          onClick={() => setDeleteOpen(true)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Full-width editor */}
      <div className="flex-1 py-2">
        <BlockNoteEditor
          initialContent={page.content ?? undefined}
          onChange={handleContentChange}
        />
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Page</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this page and its content.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
