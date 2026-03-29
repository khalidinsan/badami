import { useEffect, useMemo, useCallback, useRef, useState, type DragEvent } from "react";
import { Globe, History, Send, Plus, Upload, FileJson } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiSidebar } from "@/components/api/ApiSidebar";
import { RequestBuilder } from "@/components/api/RequestBuilder";
import { HistoryPanel } from "@/components/api/HistoryPanel";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useApiStore } from "@/stores/apiStore";
import { importPostmanCollection } from "@/lib/postmanImporter";
import { toast } from "sonner";
import type { ApiHistoryRow } from "@/types/db";

interface ProjectApiPanelProps {
  projectId: string;
}

export function ProjectApiPanel({ projectId }: ProjectApiPanelProps) {
  const {
    collections,
    folders,
    requests,
    loadedContext,
    selectedRequestId,
    showHistory,
    loadCollectionsByProject,
    loadFolders,
    loadRequests,
    setSelectedRequestId,
    setShowHistory,
    createCollection,
  } = useApiStore();

  // Reload whenever this panel mounts or projectId changes and context doesn't match
  useEffect(() => {
    if (loadedContext !== projectId) loadCollectionsByProject(projectId);
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load folders & requests for each collection
  useEffect(() => {
    for (const col of collections) {
      if (!folders[col.id]) loadFolders(col.id);
      if (!requests[col.id]) loadRequests(col.id);
    }
  }, [collections, folders, requests, loadFolders, loadRequests]);

  const selectedRequest = useMemo(() => {
    if (!selectedRequestId) return null;
    for (const reqs of Object.values(requests)) {
      const found = reqs.find((r) => r.id === selectedRequestId);
      if (found) return found;
    }
    return null;
  }, [selectedRequestId, requests]);

  const handleHistoryRestore = useCallback(
    async (entry: ApiHistoryRow) => {
      if (entry.request_id) {
        const exists = Object.values(requests)
          .flat()
          .find((r) => r.id === entry.request_id);
        if (exists) {
          setSelectedRequestId(exists.id);
          setShowHistory(false);
          return;
        }
      }
      setShowHistory(false);
    },
    [requests, setSelectedRequestId, setShowHistory],
  );

  const handleCreateFirst = useCallback(async () => {
    const col = await createCollection({
      project_id: projectId,
      name: "API Collection",
    });
    await loadFolders(col.id);
    await loadRequests(col.id);
  }, [projectId, createCollection, loadFolders, loadRequests]);

  // Import dialog state
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
        const col = await importPostmanCollection(text, projectId);
        await loadCollectionsByProject(projectId);
        await loadFolders(col.id);
        await loadRequests(col.id);
        toast.success(`Imported "${col.name}"`);
        setImportOpen(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to import collection");
      } finally {
        setImporting(false);
      }
    },
    [projectId, loadCollectionsByProject, loadFolders, loadRequests],
  );

  const importDialog = (
    <Dialog open={importOpen} onOpenChange={(open) => !importing && setImportOpen(open)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm">Import Collection</DialogTitle>
        </DialogHeader>
        <div
          onDragOver={(e) => { e.preventDefault(); setImportDragOver(true); }}
          onDragLeave={() => setImportDragOver(false)}
          onDrop={(e: DragEvent<HTMLDivElement>) => {
            e.preventDefault();
            setImportDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) doImport(file);
          }}
          onClick={() => !importing && importFileRef.current?.click()}
          className={[
            "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 transition-colors",
            importDragOver ? "border-[#007AFF] bg-[#007AFF]/10" : "border-white/15 bg-white/3 hover:border-white/30 hover:bg-white/5",
            importing ? "pointer-events-none opacity-60" : "",
          ].join(" ")}
        >
          {importing ? (
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#007AFF] border-t-transparent" />
          ) : (
            <FileJson className={["h-10 w-10 transition-colors", importDragOver ? "text-[#007AFF]" : "text-muted-foreground/40"].join(" ")} />
          )}
          <div className="text-center">
            <p className="text-sm font-medium">
              {importing ? "Importing…" : importDragOver ? "Drop to import" : "Drop your collection here"}
            </p>
            {!importing && !importDragOver && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                or <span className="text-[#007AFF] underline-offset-2 hover:underline">click to browse</span> — Postman v2.1 JSON
              </p>
            )}
          </div>
        </div>
        <input
          ref={importFileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) doImport(file);
            e.target.value = "";
          }}
        />
        <DialogFooter>
          <Button variant="ghost" size="sm" disabled={importing} onClick={() => setImportOpen(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  if (collections.length === 0) {
    return (
      <>
      <div className="flex flex-1 flex-col items-center justify-center gap-1 text-center">
        <Globe className="mb-2 h-12 w-12 text-muted-foreground/20" />
        <p className="text-sm text-muted-foreground">No API collections yet</p>
        <Button
          variant="ghost"
          size="sm"
          className="mt-1 gap-1.5 text-xs text-[#007AFF]"
          onClick={handleCreateFirst}
        >
          <Plus className="h-3.5 w-3.5" />
          Create Collection
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-xs text-muted-foreground"
          onClick={() => setImportOpen(true)}
        >
          <Upload className="h-3.5 w-3.5" />
          Import from Postman
        </Button>
      </div>
      {importDialog}
      </>
    );
  }

  const PROJ_MIN_W = 208; // w-52
  const PROJ_MAX_W = 480;
  const [sidebarWidth, setSidebarWidth] = useState(PROJ_MIN_W);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);

  const onDragStart = useCallback((e: React.PointerEvent) => {
    dragging.current = true;
    startX.current = e.clientX;
    startW.current = sidebarWidth;
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [sidebarWidth]);

  const onDragMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const next = Math.min(PROJ_MAX_W, Math.max(PROJ_MIN_W, startW.current + e.clientX - startX.current));
    setSidebarWidth(next);
  }, []);

  const onDragEnd = useCallback(() => { dragging.current = false; }, []);

  return (
    <>
    <div className="flex h-full">
      {/* Sidebar */}
      <div className="glass-page-sidebar relative shrink-0" style={{ width: sidebarWidth }}>
        <ApiSidebar
          collections={collections}
          folders={folders}
          requests={requests}
          selectedRequestId={selectedRequestId}
          onSelectRequest={setSelectedRequestId}
          projectId={projectId}
        />
        {/* Resize handle */}
        <div
          className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-[#007AFF]/30 active:bg-[#007AFF]/50"
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
        />
      </div>

      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center justify-end border-b border-border/30 px-3 py-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1.5 text-[10px]"
            onClick={() => setShowHistory(!showHistory)}
          >
            <History className="h-3 w-3" />
            History
          </Button>
        </div>

        <div className="flex min-h-0 flex-1">
          {showHistory ? (
            <div className="flex-1">
              <HistoryPanel
                onRestore={handleHistoryRestore}
                onClose={() => setShowHistory(false)}
              />
            </div>
          ) : selectedRequest ? (
            <div className="flex-1 overflow-hidden">
              <RequestBuilder request={selectedRequest} />
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center text-center">
              <Send className="mb-3 h-10 w-10 text-muted-foreground/20" />
              <p className="text-xs text-muted-foreground">
                Select a request or create a new one
              </p>
            </div>
          )}
        </div>
      </div>
    </div>

    {importDialog}
    </>
  );
}
