import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useCallback, useRef, useState } from "react";
import { Globe, History, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiSidebar } from "@/components/api/ApiSidebar";
import { RequestBuilder } from "@/components/api/RequestBuilder";
import { HistoryPanel } from "@/components/api/HistoryPanel";
import { useApiStore } from "@/stores/apiStore";
import { useProjectStore } from "@/stores/projectStore";
import type { ApiHistoryRow } from "@/types/db";
import { toast } from "sonner";
import * as apiQueries from "@/db/queries/api";

export const Route = createFileRoute("/api/")({
  component: ApiPage,
});

function ApiPage() {
  const {
    collections,
    folders,
    requests,
    loaded,
    loadedContext,
    selectedRequestId,
    showHistory,
    loadAllCollections,
    loadFolders,
    loadRequests,
    setSelectedRequestId,
    setShowHistory,
  } = useApiStore();

  const { projects, loadProjects } = useProjectStore();

  // Reload whenever we arrive here and the store is not already holding "all" collections
  useEffect(() => {
    if (!loaded || loadedContext !== "all") loadAllCollections();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load projects for sidebar grouping labels
  useEffect(() => {
    if (projects.length === 0) loadProjects();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load folders & requests for all collections
  useEffect(() => {
    for (const col of collections) {
      if (!folders[col.id]) loadFolders(col.id);
      if (!requests[col.id]) loadRequests(col.id);
    }
  }, [collections, folders, requests, loadFolders, loadRequests]);

  // Find the selected request
  const selectedRequest = useMemo(() => {
    if (!selectedRequestId) return null;
    for (const reqs of Object.values(requests)) {
      const found = reqs.find((r) => r.id === selectedRequestId);
      if (found) return found;
    }
    return null;
  }, [selectedRequestId, requests]);

  // Handle history restore
  const handleHistoryRestore = useCallback(
    async (entry: ApiHistoryRow) => {
      // If the entry has a request_id that still exists, select it and apply saved data
      if (entry.request_id) {
        const exists = Object.values(requests)
          .flat()
          .find((r) => r.id === entry.request_id);
        if (exists) {
          // Update the existing request with the history data so you see what was sent
          await apiQueries.updateRequest(exists.id, {
            method: entry.method,
            url: entry.url,
            headers: entry.request_headers,
            body_content: entry.request_body,
            auth_type: entry.auth_type ?? "none",
          });
          await loadRequests(exists.collection_id);
          setSelectedRequestId(exists.id);
          setShowHistory(false);
          return;
        }
      }

      // Create a new request from history if the original is gone
      if (entry.collection_id) {
        try {
          const newReq = await apiQueries.createRequest({
            collection_id: entry.collection_id,
            name: `${entry.method} ${new URL(entry.url).pathname}`.substring(0, 60),
            method: entry.method,
            url: entry.url,
            headers: entry.request_headers,
            body_content: entry.request_body,
            auth_type: entry.auth_type ?? "none",
          });
          await loadRequests(entry.collection_id);
          setSelectedRequestId(newReq.id);
          setShowHistory(false);
          toast.success("Restored from history as new request");
          return;
        } catch {
          // fallback
        }
      }

      setShowHistory(false);
    },
    [requests, setSelectedRequestId, setShowHistory, loadRequests],
  );

  const MIN_W = 224; // w-56
  const MAX_W = 480;
  const [sidebarWidth, setSidebarWidth] = useState(MIN_W);
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
    const next = Math.min(MAX_W, Math.max(MIN_W, startW.current + e.clientX - startX.current));
    setSidebarWidth(next);
  }, []);

  const onDragEnd = useCallback(() => { dragging.current = false; }, []);

  return (
    <div className="flex h-full">
      {/* Collection sidebar */}
      <div className="glass-page-sidebar relative shrink-0" style={{ width: sidebarWidth }}>
        <ApiSidebar
          collections={collections}
          folders={folders}
          requests={requests}
          selectedRequestId={selectedRequestId}
          onSelectRequest={setSelectedRequestId}
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

      {/* Main content area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header — sits above content only */}
        <div className="flex shrink-0 items-center justify-between border-b border-border/50 bg-background/80 px-6 py-3 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-[#007AFF]" />
            <h1 className="text-xl font-bold tracking-tight">API</h1>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => setShowHistory(!showHistory)}
          >
            <History className="h-3.5 w-3.5" />
            History
          </Button>
        </div>

        {/* Content */}
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
              <Send className="mb-3 h-12 w-12 text-muted-foreground/20" />
              <p className="text-sm text-muted-foreground">
                Select a request or create a new one
              </p>
              <p className="mt-1 text-xs text-muted-foreground/60">
                Right-click on a collection to add requests
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
