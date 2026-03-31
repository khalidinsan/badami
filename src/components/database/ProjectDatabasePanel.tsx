import { useState } from "react";
import { ConnectionList } from "@/components/database/ConnectionList";
import { ConnectionForm } from "@/components/database/ConnectionForm";
import type { DbConnectionRow } from "@/types/db";

interface ProjectDatabasePanelProps {
  projectId: string;
}

export function ProjectDatabasePanel({ projectId }: ProjectDatabasePanelProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [editingConnection, setEditingConnection] = useState<DbConnectionRow | null>(null);

  return (
    <div className="flex h-full flex-col">
      <ConnectionList
        projectId={projectId}
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
