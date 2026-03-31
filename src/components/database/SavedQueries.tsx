import { useState, useEffect, useCallback } from "react";
import {
  X,
  Search,
  Bookmark,
  FolderOpen,
  Plus,
  Trash2,
  Edit2,
  Check,
  FolderPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import * as dbQueries from "@/db/queries/dbClient";
import type { DbSavedQueryRow, DbSavedQueryFolderRow } from "@/types/db";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface SavedQueriesProps {
  connectionId: string;
  currentSql?: string;
  onSelect: (sql: string) => void;
  onClose: () => void;
}

export function SavedQueries({ connectionId, currentSql, onSelect, onClose }: SavedQueriesProps) {
  const [queries, setQueries] = useState<DbSavedQueryRow[]>([]);
  const [folders, setFolders] = useState<DbSavedQueryFolderRow[]>([]);
  const [search, setSearch] = useState("");
  const [savingNew, setSavingNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const load = useCallback(async () => {
    try {
      const [q, f] = await Promise.all([
        dbQueries.getSavedQueries(connectionId),
        dbQueries.getSavedQueryFolders(),
      ]);
      setQueries(q);
      setFolders(f);
    } catch (err) {
      console.error(err);
    }
  }, [connectionId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSaveNew = async () => {
    if (!newName.trim() || !currentSql?.trim()) return;
    try {
      await dbQueries.createSavedQuery({
        connection_id: connectionId,
        name: newName.trim(),
        description: newDescription.trim() || null,
        sql_content: currentSql,
      });
      setSavingNew(false);
      setNewName("");
      setNewDescription("");
      toast.success("Query saved");
      load();
    } catch {
      toast.error("Failed to save query");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await dbQueries.deleteSavedQuery(id);
      setQueries((prev) => prev.filter((q) => q.id !== id));
      toast.success("Query deleted");
    } catch {
      toast.error("Failed to delete");
    }
  };

  const handleRename = async (id: string) => {
    if (!editName.trim()) return;
    try {
      await dbQueries.updateSavedQuery(id, { name: editName.trim() });
      setQueries((prev) =>
        prev.map((q) => (q.id === id ? { ...q, name: editName.trim() } : q)),
      );
      setEditingId(null);
    } catch {
      toast.error("Failed to rename");
    }
  };

  const handleAddFolder = async () => {
    const name = prompt("Folder name:");
    if (!name?.trim()) return;
    try {
      await dbQueries.createSavedQueryFolder(name.trim());
      load();
    } catch {
      toast.error("Failed to create folder");
    }
  };

  const filtered = search
    ? queries.filter(
        (q) =>
          q.name.toLowerCase().includes(search.toLowerCase()) ||
          q.sql_content.toLowerCase().includes(search.toLowerCase()),
      )
    : queries;

  // Group by folder
  const ungrouped = filtered.filter((q) => !q.folder_id);
  const grouped = folders.map((f) => ({
    folder: f,
    items: filtered.filter((q) => q.folder_id === f.id),
  }));

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <Bookmark className="h-3.5 w-3.5" />
          Saved Queries
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground"
            onClick={handleAddFolder}
            title="New folder"
          >
            <FolderPlus className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground"
            onClick={onClose}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="border-b border-white/10 px-2 py-1.5">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search saved..."
            className="h-7 pl-7 text-xs"
          />
        </div>
      </div>

      {/* Save current button */}
      {currentSql?.trim() && !savingNew && (
        <div className="border-b border-white/10 p-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-full gap-1 border-white/10 text-xs"
            onClick={() => setSavingNew(true)}
          >
            <Plus className="h-3 w-3" />
            Save current query
          </Button>
        </div>
      )}

      {/* Save form */}
      {savingNew && (
        <div className="space-y-1.5 border-b border-white/10 p-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Query name"
            className="h-7 text-xs"
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && handleSaveNew()}
          />
          <Input
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            placeholder="Description (optional)"
            className="h-7 text-xs"
          />
          <div className="flex gap-1">
            <Button size="sm" className="h-6 flex-1 text-xs" onClick={handleSaveNew}>
              Save
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs"
              onClick={() => setSavingNew(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Items */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 && (
          <div className="p-3 text-xs text-muted-foreground">
            {search ? "No matching queries" : "No saved queries yet"}
          </div>
        )}

        {/* Folders */}
        {grouped.map(
          ({ folder, items }) =>
            items.length > 0 && (
              <div key={folder.id}>
                <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground">
                  <FolderOpen className="h-3 w-3" />
                  {folder.name}
                </div>
                {items.map((q) => (
                  <QueryItem
                    key={q.id}
                    query={q}
                    isEditing={editingId === q.id}
                    editName={editingId === q.id ? editName : ""}
                    onSelect={onSelect}
                    onStartEdit={() => {
                      setEditingId(q.id);
                      setEditName(q.name);
                    }}
                    onEditNameChange={setEditName}
                    onSaveEdit={() => handleRename(q.id)}
                    onDelete={() => handleDelete(q.id)}
                  />
                ))}
              </div>
            ),
        )}

        {/* Ungrouped */}
        {ungrouped.map((q) => (
          <QueryItem
            key={q.id}
            query={q}
            isEditing={editingId === q.id}
            editName={editingId === q.id ? editName : ""}
            onSelect={onSelect}
            onStartEdit={() => {
              setEditingId(q.id);
              setEditName(q.name);
            }}
            onEditNameChange={setEditName}
            onSaveEdit={() => handleRename(q.id)}
            onDelete={() => handleDelete(q.id)}
          />
        ))}
      </div>
    </div>
  );
}

function QueryItem({
  query,
  isEditing,
  editName,
  onSelect,
  onStartEdit,
  onEditNameChange,
  onSaveEdit,
  onDelete,
}: {
  query: DbSavedQueryRow;
  isEditing: boolean;
  editName: string;
  onSelect: (sql: string) => void;
  onStartEdit: () => void;
  onEditNameChange: (name: string) => void;
  onSaveEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={cn(
        "group flex items-start gap-2 border-b border-white/5 px-3 py-2 hover:bg-white/5",
      )}
    >
      <Bookmark className="mt-0.5 h-3 w-3 shrink-0 text-yellow-400" />
      <div className="min-w-0 flex-1">
        {isEditing ? (
          <div className="flex items-center gap-1">
            <Input
              value={editName}
              onChange={(e) => onEditNameChange(e.target.value)}
              className="h-6 text-xs"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && onSaveEdit()}
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={onSaveEdit}
            >
              <Check className="h-3 w-3" />
            </Button>
          </div>
        ) : (
          <>
            <button
              className="block w-full text-left"
              onClick={() => onSelect(query.sql_content)}
            >
              <span className="text-xs font-medium">{query.name}</span>
              {query.description && (
                <span className="ml-1 text-[10px] text-muted-foreground">
                  — {query.description}
                </span>
              )}
              <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                {query.sql_content}
              </p>
            </button>
            <div className="mt-0.5 flex gap-1 opacity-0 group-hover:opacity-100">
              <button
                className="rounded p-0.5 hover:bg-white/10"
                onClick={onStartEdit}
              >
                <Edit2 className="h-2.5 w-2.5 text-muted-foreground" />
              </button>
              <button
                className="rounded p-0.5 hover:bg-white/10"
                onClick={onDelete}
              >
                <Trash2 className="h-2.5 w-2.5 text-red-400" />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
