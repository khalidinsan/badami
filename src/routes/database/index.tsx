import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useDbStore } from "@/stores/dbStore";
import { useDbConnection } from "@/hooks/useDbConnection";
import { ConnectionList } from "@/components/database/ConnectionList";
import { ConnectionForm } from "@/components/database/ConnectionForm";
import { DbWorkspace } from "@/components/database/DbWorkspace";
import type { DbConnectionRow } from "@/types/db";

export const Route = createFileRoute("/database/")({
  component: () => null,
});

export function DatabasePage() {
  const { loadConnections } = useDbConnection();
  const { viewMode, connections } = useDbStore();
  const [formOpen, setFormOpen] = useState(false);
  const [editingConnection, setEditingConnection] =
    useState<DbConnectionRow | null>(null);

  useEffect(() => {
    if (connections.length === 0) loadConnections();
  }, []);

  if (viewMode === "workspace") {
    return <DbWorkspace onBackToList={() => useDbStore.getState().setViewMode("connections")} />;
  }

  return (
    <div className="flex h-full flex-col">
      <ConnectionList
        onNewConnection={() => {
          setEditingConnection(null);
          setFormOpen(true);
        }}
        onEditConnection={(conn) => {
          setEditingConnection(conn);
          setFormOpen(true);
        }}
      />

      {formOpen && (
        <ConnectionForm
          connection={editingConnection}
          open={formOpen}
          onOpenChange={setFormOpen}
        />
      )}
    </div>
  );
}
