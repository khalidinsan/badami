import { useEffect, useState, useCallback } from "react";
import { Plus, Key } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CredentialCard } from "./CredentialCard";
import { CredentialForm } from "./CredentialForm";
import { CredentialDetail } from "./CredentialDetail";
import { useCredentials } from "@/hooks/useCredentials";
import type { CredentialRow } from "@/types/db";

interface CredentialListProps {
  projectId?: string;
}

export function CredentialList({ projectId }: CredentialListProps) {
  const { credentials, loading, reload, deleteCredential } =
    useCredentials(projectId);

  const [formOpen, setFormOpen] = useState(false);
  const [editingCredential, setEditingCredential] =
    useState<CredentialRow | null>(null);
  const [viewingCredential, setViewingCredential] =
    useState<CredentialRow | null>(null);

  useEffect(() => {
    reload();
  }, [reload]);

  const handleEdit = useCallback((cred: CredentialRow) => {
    setEditingCredential(cred);
    setFormOpen(true);
  }, []);

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteCredential(id);
    },
    [deleteCredential],
  );

  const handleFormClose = useCallback(
    (open: boolean) => {
      setFormOpen(open);
      if (!open) {
        setEditingCredential(null);
        reload();
      }
    },
    [reload],
  );

  const handleSaved = useCallback(() => {
    reload();
  }, [reload]);

  // Detail view
  if (viewingCredential) {
    // Refresh viewing credential from latest data
    const fresh = credentials.find((c) => c.id === viewingCredential.id);
    return (
      <>
        <CredentialDetail
          credential={fresh ?? viewingCredential}
          onBack={() => setViewingCredential(null)}
          onEdit={(cred) => {
            setViewingCredential(null);
            handleEdit(cred);
          }}
        />
        <CredentialForm
          open={formOpen}
          onOpenChange={handleFormClose}
          credential={editingCredential}
          defaultProjectId={projectId}
          onSaved={handleSaved}
        />
      </>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/40 px-6 py-3">
        <p className="text-xs text-muted-foreground">
          {credentials.length} credential{credentials.length !== 1 ? "s" : ""}
        </p>
        <Button
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={() => {
            setEditingCredential(null);
            setFormOpen(true);
          }}
        >
          <Plus className="h-3 w-3" />
          Add
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
            Loading credentials...
          </div>
        ) : credentials.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Key className="mb-3 h-10 w-10 text-muted-foreground/30" />
            <p className="mb-1 text-sm font-medium text-muted-foreground">
              No credentials yet
            </p>
            <p className="mb-4 text-xs text-muted-foreground/70">
              Add credentials to store passwords, API keys, and more
            </p>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => {
                setEditingCredential(null);
                setFormOpen(true);
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              Add Credential
            </Button>
          </div>
        ) : (
          <div className="grid gap-3 p-6 sm:grid-cols-2 lg:grid-cols-3">
            {credentials.map((cred) => (
              <CredentialCard
                key={cred.id}
                credential={cred}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onClick={setViewingCredential}
              />
            ))}
          </div>
        )}
      </div>

      {/* Form */}
      <CredentialForm
        open={formOpen}
        onOpenChange={handleFormClose}
        credential={editingCredential}
        defaultProjectId={projectId}
        onSaved={handleSaved}
      />
    </div>
  );
}
