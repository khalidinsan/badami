import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { Plus, Search, FolderOpen, X, Upload, FileJson } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getCurrentWebview } from "@tauri-apps/api/webview";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CollectionItem } from "./CollectionItem";
import { CollectionVariablesEditor } from "./CollectionVariablesEditor";
import { useApiStore } from "@/stores/apiStore";
import { useProjectStore } from "@/stores/projectStore";
import type { ApiCollectionRow, ApiFolderRow, ApiRequestRow } from "@/types/db";
import * as apiQueries from "@/db/queries/api";
import { importPostmanCollection, exportPostmanCollection } from "@/lib/postmanImporter";
import { toast } from "sonner";

interface ApiSidebarProps {
  collections: ApiCollectionRow[];
  folders: Record<string, ApiFolderRow[]>;
  requests: Record<string, ApiRequestRow[]>;
  selectedRequestId: string | null;
  onSelectRequest: (id: string) => void;
  /** When set, new collections are auto-linked to this project */
  projectId?: string | null;
}

export function ApiSidebar({
  collections,
  folders,
  requests,
  selectedRequestId,
  onSelectRequest,
  projectId,
}: ApiSidebarProps) {
  const [search, setSearch] = useState("");
  const store = useApiStore();
  const { projects } = useProjectStore();

  // Collection variables editor state
  const [colVarsEditId, setColVarsEditId] = useState<string | null>(null);
  const colVarsCollection = collections.find((c) => c.id === colVarsEditId);

  // Generic name-input dialog state
  const [dialog, setDialog] = useState<{
    open: boolean;
    title: string;
    placeholder: string;
    value: string;
    onConfirm: (value: string) => void;
  }>({
    open: false,
    title: "",
    placeholder: "",
    value: "",
    onConfirm: () => {},
  });
  const inputRef = useRef<HTMLInputElement>(null);

  const openDialog = useCallback(
    (opts: { title: string; placeholder?: string; defaultValue?: string; onConfirm: (v: string) => void }) => {
      setDialog({
        open: true,
        title: opts.title,
        placeholder: opts.placeholder ?? "Name",
        value: opts.defaultValue ?? "",
        onConfirm: opts.onConfirm,
      });
    },
    [],
  );

  const closeDialog = () =>
    setDialog((d) => ({ ...d, open: false }));

  const confirmDialog = () => {
    const val = dialog.value.trim();
    if (val) {
      dialog.onConfirm(val);
    }
    closeDialog();
  };

  const filteredCollections = search
    ? collections.filter((c) =>
        c.name.toLowerCase().includes(search.toLowerCase()),
      )
    : collections;

  const handleNewCollection = useCallback(async () => {
    openDialog({
      title: "New Collection",
      placeholder: "Collection name",
      onConfirm: (name) => store.createCollection({ name, project_id: projectId ?? null }),
    });
  }, [openDialog, store, projectId]);

  const handleRenameCollection = useCallback(
    (id: string) => {
      const col = collections.find((c) => c.id === id);
      if (!col) return;
      openDialog({
        title: "Rename Collection",
        placeholder: "Collection name",
        defaultValue: col.name,
        onConfirm: (name) => {
          if (name !== col.name) store.updateCollection(id, { name });
        },
      });
    },
    [collections, openDialog, store],
  );

  const handleAddFolder = useCallback(
    (collectionId: string) => {
      openDialog({
        title: "New Folder",
        placeholder: "Folder name",
        onConfirm: (name) =>
          store.createFolder({ collection_id: collectionId, name }),
      });
    },
    [openDialog, store],
  );

  const handleRenameFolder = useCallback(
    (id: string) => {
      const folder = Object.values(folders).flat().find((f) => f.id === id);
      if (!folder) return;
      openDialog({
        title: "Rename Folder",
        placeholder: "Folder name",
        defaultValue: folder.name,
        onConfirm: (name) => {
          if (name !== folder.name) store.updateFolder(id, { name });
        },
      });
    },
    [folders, openDialog, store],
  );

  const handleAddRequest = useCallback(
    async (collectionId: string, folderId?: string | null) => {
      const request = await store.createRequest({
        collection_id: collectionId,
        folder_id: folderId,
        name: "New Request",
        method: "GET",
      });
      onSelectRequest(request.id);
    },
    [store, onSelectRequest],
  );

  const handleRenameRequest = useCallback(
    (id: string) => {
      const req = Object.values(requests).flat().find((r) => r.id === id);
      if (!req) return;
      openDialog({
        title: "Rename Request",
        placeholder: "Request name",
        defaultValue: req.name,
        onConfirm: (name) => {
          if (name !== req.name) store.updateRequest(id, { name });
        },
      });
    },
    [requests, openDialog, store],
  );

  const handleDuplicateRequest = useCallback(
    async (id: string) => {
      const req = Object.values(requests)
        .flat()
        .find((r) => r.id === id);
      if (!req) return;
      try {
        const newReq = await apiQueries.createRequest({
          collection_id: req.collection_id,
          folder_id: req.folder_id,
          name: `${req.name} (Copy)`,
          method: req.method,
          url: req.url,
          headers: req.headers,
          params: req.params,
          body_type: req.body_type,
          body_content: req.body_content,
          auth_type: req.auth_type,
          auth_config: req.auth_config,
        });
        await store.loadRequests(req.collection_id);
        onSelectRequest(newReq.id);
        toast.success("Request duplicated");
      } catch {
        toast.error("Failed to duplicate request");
      }
    },
    [requests, store, onSelectRequest],
  );

  const [importOpen, setImportOpen] = useState(false);
  const [importDragOver, setImportDragOver] = useState(false);
  const [importing, setImporting] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);

  const doImport = useCallback(
    async (file: File) => {
      if (!file.name.endsWith(".json")) {
        toast.error("Only .json files are supported");
        return;
      }
      setImporting(true);
      try {
        const text = await file.text();
        const col = await importPostmanCollection(text, projectId ?? null);
        // Reload appropriate collection list based on context
        if (projectId) {
          await store.loadCollectionsByProject(projectId);
        } else {
          await store.loadAllCollections();
        }
        await store.loadFolders(col.id);
        await store.loadRequests(col.id);
        toast.success(`Imported "${col.name}"`);
        setImportOpen(false);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to import collection",
        );
      } finally {
        setImporting(false);
      }
    },
    [store, projectId],
  );

  // Use Tauri's native drag-drop event (browser DragEvent doesn't fire for OS file drops)
  useEffect(() => {
    if (!importOpen) return;
    let unlisten: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent(async (event) => {
        const payload = event.payload;
        if (payload.type === "over") {
          setImportDragOver(true);
        } else if (payload.type === "drop") {
          setImportDragOver(false);
          const filePath = payload.paths?.[0];
          if (filePath) {
            try {
              const { readFile } = await import("@tauri-apps/plugin-fs");
              const bytes = await readFile(filePath);
              const name = filePath.split("/").pop() ?? filePath.split("\\").pop() ?? "collection.json";
              const blob = new Blob([bytes], { type: "application/json" });
              doImport(new File([blob], name));
            } catch {
              toast.error("Could not read dropped file");
            }
          }
        } else {
          setImportDragOver(false);
        }
      })
      .then((fn) => { unlisten = fn; });
    return () => unlisten?.();
  }, [importOpen, doImport]);

  const handleImportFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) doImport(file);
      // reset so same file can be re-selected
      e.target.value = "";
    },
    [doImport],
  );

  const handleExportPostman = useCallback(
    async (colId: string) => {
      const col = collections.find((c) => c.id === colId);
      if (!col) return;
      try {
        const colFolders = folders[colId] || [];
        const colRequests = requests[colId] || [];
        const json = await exportPostmanCollection(col, colFolders, colRequests);
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${col.name.replace(/[^a-zA-Z0-9-_]/g, "_")}.postman_collection.json`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success("Collection exported");
      } catch {
        toast.error("Failed to export collection");
      }
    },
    [collections, folders, requests],
  );

  const handleMoveRequest = useCallback(
    async (requestId: string, folderId: string | null) => {
      const req = Object.values(requests).flat().find((r) => r.id === requestId);
      if (!req) return;
      try {
        await apiQueries.moveRequestToFolder(requestId, folderId);
        await store.loadRequests(req.collection_id);
        toast.success("Request moved");
      } catch {
        toast.error("Failed to move request");
      }
    },
    [requests, store],
  );

  // Render helper for a single CollectionItem with all wired-up handlers
  const renderCollectionItem = useCallback(
    (col: ApiCollectionRow) => (
      <CollectionItem
        key={col.id}
        collection={col}
        folders={folders[col.id] || []}
        requests={requests[col.id] || []}
        selectedRequestId={selectedRequestId}
        onSelectRequest={onSelectRequest}
        onDeleteCollection={() => store.deleteCollection(col.id)}
        onRenameCollection={() => handleRenameCollection(col.id)}
        onDuplicateCollection={() => store.duplicateCollection(col.id)}
        onAddFolder={() => handleAddFolder(col.id)}
        onAddRequest={(folderId) => handleAddRequest(col.id, folderId)}
        onDeleteFolder={(id) => store.deleteFolder(id)}
        onRenameFolder={(id) => handleRenameFolder(id)}
        onDeleteRequest={(id) => store.deleteRequest(id)}
        onRenameRequest={(id) => handleRenameRequest(id)}
        onDuplicateRequest={(id) => handleDuplicateRequest(id)}
        onExportCollection={() => handleExportPostman(col.id)}
        onEditCollectionVariables={() => setColVarsEditId(col.id)}
        onMoveRequest={handleMoveRequest}
      />
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [folders, requests, selectedRequestId, onSelectRequest, store, handleRenameCollection, handleAddFolder, handleAddRequest, handleRenameFolder, handleDuplicateRequest, handleExportPostman, handleMoveRequest],
  );

  return (
    <>
    <div className="flex h-full flex-col">
      {/* Search */}
      <div className="relative px-3 py-2">
        <Search className="absolute left-5 top-3.5 h-3 w-3 text-muted-foreground/50" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search collections..."
          className="w-full rounded-md bg-muted/40 py-1 pl-6 pr-6 text-xs outline-none placeholder:text-muted-foreground/40 focus:bg-muted/60"
        />
        {search && (
          <button onClick={() => setSearch("")} className="absolute right-5 top-3.5">
            <X className="h-3 w-3 text-muted-foreground/50" />
          </button>
        )}
      </div>

      {/* Section header */}
      <div className="flex items-center justify-between px-3 pb-1">
        <span className="text-xs font-medium text-muted-foreground">Collections</span>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            title="Import Postman Collection"
            onClick={() => setImportOpen(true)}
          >
            <Upload className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={handleNewCollection}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
        </div>
      </div>

      {/* Tree */}
      <div className="sidebar-scroll flex-1">
        <div className="min-w-max space-y-0.5 px-2 pb-2">
        {filteredCollections.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <FolderOpen className="mb-2 h-8 w-8 text-muted-foreground/30" />
            <p className="text-xs text-muted-foreground">No collections yet</p>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 h-7 gap-1 text-xs text-[#007AFF]"
              onClick={handleNewCollection}
            >
              <Plus className="h-3 w-3" />
              Create Collection
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs text-muted-foreground"
              onClick={() => setImportOpen(true)}
            >
              <Upload className="h-3 w-3" />
              Import from Postman
            </Button>
          </div>
        ) : projectId ? (
          // Inside a project — flat list (already pre-filtered by project)
          filteredCollections.map((col) => renderCollectionItem(col))
        ) : (
          // Main API page — group by project
          <CollectionGroupedList
            collections={filteredCollections}
            projects={projects}
            renderItem={renderCollectionItem}
          />
        )}
        </div>
      </div>
    </div>

    {/* Import modal */}
    <Dialog open={importOpen} onOpenChange={(open) => !importing && setImportOpen(open)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm">Import Collection</DialogTitle>
        </DialogHeader>

        {/* Drop zone — no browser drag events; Tauri native handler above */}
        <div
          onClick={() => !importing && importFileRef.current?.click()}
          className={
            [
              "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 transition-colors",
              importDragOver
                ? "border-[#007AFF] bg-[#007AFF]/10"
                : "border-white/15 bg-white/3 hover:border-white/30 hover:bg-white/5",
              importing ? "pointer-events-none opacity-60" : "",
            ].join(" ")
          }
        >
          {importing ? (
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#007AFF] border-t-transparent" />
          ) : (
            <FileJson
              className={[
                "h-10 w-10 transition-colors",
                importDragOver ? "text-[#007AFF]" : "text-muted-foreground/40",
              ].join(" ")}
            />
          )}
          <div className="text-center">
            <p className="text-sm font-medium">
              {importing ? "Importing…" : importDragOver ? "Drop to import" : "Drop your collection here"}
            </p>
            {!importing && !importDragOver && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                or{" "}
                <span className="text-[#007AFF] underline-offset-2 hover:underline">
                  click to browse
                </span>
                {" — Postman v2.1 JSON"}
              </p>
            )}
          </div>
        </div>

        {/* Hidden file input */}
        <input
          ref={importFileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={handleImportFileChange}
        />

        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            disabled={importing}
            onClick={() => setImportOpen(false)}
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Collection variables editor */}
    {colVarsCollection && (
      <CollectionVariablesEditor
        open={!!colVarsEditId}
        onClose={() => setColVarsEditId(null)}
        collectionId={colVarsCollection.id}
        collectionName={colVarsCollection.name}
      />
    )}

    {/* Name input dialog */}
    <Dialog
      open={dialog.open}
      onOpenChange={(open) => !open && closeDialog()}
    >
      <DialogContent
        className="sm:max-w-xs"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          setTimeout(() => inputRef.current?.select(), 50);
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-sm">{dialog.title}</DialogTitle>
        </DialogHeader>
        <Input
          ref={inputRef}
          value={dialog.value}
          onChange={(e) => setDialog((d) => ({ ...d, value: e.target.value }))}
          placeholder={dialog.placeholder}
          className="h-8 text-sm"
          onKeyDown={(e) => {
            if (e.key === "Enter") confirmDialog();
            if (e.key === "Escape") closeDialog();
          }}
        />
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={closeDialog}>
            Cancel
          </Button>
          <Button size="sm" onClick={confirmDialog}>
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Grouped list for the main API page (no projectId context)
// ---------------------------------------------------------------------------

import type { ProjectRow } from "@/types/db";

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="mb-1 mt-3 flex items-center gap-1.5 px-1 first:mt-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
        {label}
      </span>
      <div className="h-px flex-1 bg-border/40" />
    </div>
  );
}

function CollectionGroupedList({
  collections,
  projects,
  renderItem,
}: {
  collections: ApiCollectionRow[];
  projects: ProjectRow[];
  renderItem: (col: ApiCollectionRow) => React.ReactNode;
}) {
  const projectMap = useMemo(
    () => new Map(projects.map((p) => [p.id, p])),
    [projects],
  );

  // Separate project-linked vs global
  const projectGroups = useMemo(() => {
    const groups = new Map<string, ApiCollectionRow[]>();
    for (const col of collections) {
      if (col.project_id) {
        const arr = groups.get(col.project_id) ?? [];
        arr.push(col);
        groups.set(col.project_id, arr);
      }
    }
    return groups;
  }, [collections]);

  const globalCollections = useMemo(
    () => collections.filter((c) => !c.project_id),
    [collections],
  );

  return (
    <>
      {/* Project-linked sections */}
      {[...projectGroups.entries()].map(([pid, cols]) => {
        const project = projectMap.get(pid);
        const label = project ? `${project.icon ?? ""} ${project.name}`.trim() : "Project";
        return (
          <div key={pid}>
            <SectionLabel label={label} />
            {cols.map((col) => renderItem(col))}
          </div>
        );
      })}

      {/* Global section */}
      {globalCollections.length > 0 && (
        <div>
          <SectionLabel label="Global" />
          {globalCollections.map((col) => renderItem(col))}
        </div>
      )}
    </>
  );
}
