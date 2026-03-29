import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Plus,
  Trash2,
  Settings2,
  Eye,
  EyeOff,
  Link2,
  Lock,
  Pencil,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEnvironment } from "@/hooks/useEnvironment";
import { CredentialPicker } from "./CredentialPicker";
import type { ApiEnvVariableRow } from "@/types/db";

interface EnvironmentEditorProps {
  open: boolean;
  onClose: () => void;
  collectionId: string;
}

interface VariableRow extends ApiEnvVariableRow {
  _dirty?: boolean;
  _new?: boolean;
  _deleted?: boolean;
  _credentialName?: string;
}

const ENV_COLORS: Record<string, string> = {
  Production: "#ef4444",
  Staging: "#f59e0b",
  Development: "#22c55e",
  Local: "#3b82f6",
};

export function EnvironmentEditor({
  open,
  onClose,
  collectionId,
}: EnvironmentEditorProps) {
  const env = useEnvironment(collectionId);
  const [selectedEnvId, setSelectedEnvId] = useState<string | null>(null);
  const [variables, setVariables] = useState<VariableRow[]>([]);
  const [loadingVars, setLoadingVars] = useState(false);
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set());
  const [credPickerOpen, setCredPickerOpen] = useState(false);
  const [credPickerVarIndex, setCredPickerVarIndex] = useState<number | null>(null);
  const [renamingEnv, setRenamingEnv] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Load environments on open
  useEffect(() => {
    if (open) {
      env.reload();
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-select first env
  useEffect(() => {
    if (env.environments.length > 0 && !selectedEnvId) {
      setSelectedEnvId(env.environments[0].id);
    }
  }, [env.environments, selectedEnvId]);

  // Load variables for selected env
  useEffect(() => {
    if (selectedEnvId) {
      setLoadingVars(true);
      env.getVariables(selectedEnvId).then((vars) => {
        setVariables(vars.map((v) => ({ ...v })));
        setLoadingVars(false);
      });
    } else {
      setVariables([]);
    }
  }, [selectedEnvId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreateEnv = useCallback(async () => {
    const names = ["Development", "Staging", "Production", "Local"];
    const existingNames = env.environments.map((e) => e.name);
    const nextName = names.find((n) => !existingNames.includes(n)) ?? "New Environment";
    const created = await env.create(nextName);
    setSelectedEnvId(created.id);
  }, [env]);

  const handleDeleteEnv = useCallback(
    async (id: string) => {
      await env.remove(id);
      if (selectedEnvId === id) {
        setSelectedEnvId(env.environments.find((e) => e.id !== id)?.id ?? null);
      }
    },
    [env, selectedEnvId],
  );

  const handleRenameEnv = useCallback(
    async (id: string) => {
      if (renameValue.trim()) {
        await env.update(id, { name: renameValue.trim() });
      }
      setRenamingEnv(null);
    },
    [env, renameValue],
  );

  const handleAddVariable = useCallback(() => {
    setVariables((prev) => [
      ...prev,
      {
        id: `new_${Date.now()}`,
        environment_id: selectedEnvId!,
        var_key: "",
        plain_value: "",
        credential_id: null,
        credential_field: null,
        is_secret: 0,
        enabled: 1,
        _new: true,
        _dirty: true,
      },
    ]);
  }, [selectedEnvId]);

  const updateVar = useCallback((index: number, updates: Partial<VariableRow>) => {
    setVariables((prev) =>
      prev.map((v, i) => (i === index ? { ...v, ...updates, _dirty: true } : v)),
    );
  }, []);

  const deleteVar = useCallback((index: number) => {
    setVariables((prev) =>
      prev.map((v, i) =>
        i === index ? { ...v, _deleted: true, _dirty: true } : v,
      ),
    );
  }, []);

  const toggleReveal = useCallback((id: string) => {
    setRevealedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSave = useCallback(async () => {
    for (const v of variables) {
      if (v._deleted && !v._new) {
        await env.deleteVariable(v.id);
      } else if (v._new && !v._deleted && v.var_key.trim()) {
        await env.createVariable({
          environment_id: v.environment_id,
          var_key: v.var_key,
          plain_value: v.credential_id ? null : (v.plain_value ?? null),
          credential_id: v.credential_id,
          credential_field: v.credential_field,
          is_secret: v.is_secret,
        });
      } else if (v._dirty && !v._new && !v._deleted) {
        await env.updateVariable(v.id, {
          var_key: v.var_key,
          plain_value: v.credential_id ? null : (v.plain_value ?? null),
          credential_id: v.credential_id,
          credential_field: v.credential_field,
          is_secret: v.is_secret,
          enabled: v.enabled,
        });
      }
    }
    // Reload
    if (selectedEnvId) {
      const fresh = await env.getVariables(selectedEnvId);
      setVariables(fresh.map((v) => ({ ...v })));
    }
  }, [variables, selectedEnvId, env]);

  const selectedEnv = env.environments.find((e) => e.id === selectedEnvId);
  const activeVars = variables.filter((v) => !v._deleted);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl p-0">
        <DialogHeader className="border-b border-border/50 px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Settings2 className="h-4 w-4" />
            Environment Variables
          </DialogTitle>
        </DialogHeader>

        <div className="flex min-h-[400px]">
          {/* Env list sidebar */}
          <div className="w-44 shrink-0 border-r border-border/50 p-2">
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-[11px] font-medium text-muted-foreground">
                Environments
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                onClick={handleCreateEnv}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="space-y-0.5">
              {env.environments.map((e) => (
                <div key={e.id} className="group flex items-center gap-1">
                  {renamingEnv === e.id ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(ev) => setRenameValue(ev.target.value)}
                      onBlur={() => handleRenameEnv(e.id)}
                      onKeyDown={(ev) => {
                        if (ev.key === "Enter") handleRenameEnv(e.id);
                        if (ev.key === "Escape") setRenamingEnv(null);
                      }}
                      className="h-7 w-full rounded-md bg-muted/60 px-2 text-xs outline-none"
                    />
                  ) : (
                    <button
                      onClick={() => setSelectedEnvId(e.id)}
                      onDoubleClick={() => {
                        setRenamingEnv(e.id);
                        setRenameValue(e.name);
                      }}
                      className={cn(
                        "flex flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors",
                        selectedEnvId === e.id
                          ? "bg-accent font-medium"
                          : "hover:bg-accent/50",
                      )}
                    >
                      <span
                        className="inline-block h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: ENV_COLORS[e.name] || "#6b7280" }}
                      />
                      <span className="truncate">{e.name}</span>
                    </button>
                  )}
                  <div className="flex shrink-0 opacity-0 group-hover:opacity-100">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 text-muted-foreground"
                      onClick={() => {
                        setRenamingEnv(e.id);
                        setRenameValue(e.name);
                      }}
                    >
                      <Pencil className="h-2.5 w-2.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 text-destructive"
                      onClick={() => handleDeleteEnv(e.id)}
                    >
                      <Trash2 className="h-2.5 w-2.5" />
                    </Button>
                  </div>
                </div>
              ))}
              {env.environments.length === 0 && (
                <p className="px-2 py-4 text-center text-[11px] text-muted-foreground">
                  No environments
                </p>
              )}
            </div>
          </div>

          {/* Variable editor */}
          <div className="flex min-w-0 flex-1 flex-col">
            {selectedEnv ? (
              <>
                <div className="flex items-center justify-between border-b border-border/30 px-4 py-2">
                  <p className="text-xs font-medium">
                    Variables — {selectedEnv.name}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 gap-1 text-[11px]"
                    onClick={handleAddVariable}
                  >
                    <Plus className="h-3 w-3" />
                    Add Variable
                  </Button>
                </div>

                <ScrollArea className="flex-1">
                  {loadingVars ? (
                    <p className="p-4 text-center text-xs text-muted-foreground">
                      Loading...
                    </p>
                  ) : activeVars.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12">
                      <p className="mb-2 text-xs text-muted-foreground">
                        No variables yet
                      </p>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 text-xs text-[#007AFF]"
                        onClick={handleAddVariable}
                      >
                        <Plus className="h-3 w-3" />
                        Add Variable
                      </Button>
                    </div>
                  ) : (
                    <div className="p-3">
                      {/* Header */}
                      <div className="mb-1 grid grid-cols-[auto_1fr_1.5fr_auto] items-center gap-2 px-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        <span className="w-4" />
                        <span>Key</span>
                        <span>Value</span>
                        <span className="w-16" />
                      </div>
                      <div className="space-y-1">
                        {activeVars.map((v) => {
                          const originalIdx = variables.indexOf(v);
                          const isLinked = !!v.credential_id;
                          return (
                            <div
                              key={v.id}
                              className="grid grid-cols-[auto_1fr_1.5fr_auto] items-center gap-2 rounded-md px-1 py-1 hover:bg-muted/30"
                            >
                              <Checkbox
                                checked={v.enabled === 1}
                                onCheckedChange={(c) =>
                                  updateVar(originalIdx, { enabled: c ? 1 : 0 })
                                }
                                className="h-3.5 w-3.5"
                              />
                              <Input
                                value={v.var_key}
                                onChange={(e) =>
                                  updateVar(originalIdx, { var_key: e.target.value })
                                }
                                placeholder="VARIABLE_NAME"
                                className="h-7 font-mono text-[11px]"
                              />
                              {isLinked ? (
                                <div className="flex items-center gap-1.5 rounded-md border border-border/50 bg-muted/30 px-2 py-1">
                                  <Lock className="h-3 w-3 text-[#007AFF]" />
                                  <span className="truncate text-[11px]">
                                    Linked: {v.credential_field ?? "credential"}
                                  </span>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="ml-auto h-4 w-4"
                                    onClick={() =>
                                      updateVar(originalIdx, {
                                        credential_id: null,
                                        credential_field: null,
                                      })
                                    }
                                  >
                                    <Trash2 className="h-2.5 w-2.5" />
                                  </Button>
                                </div>
                              ) : (
                                <div className="flex gap-1">
                                  <Input
                                    type={
                                      v.is_secret && !revealedIds.has(v.id)
                                        ? "password"
                                        : "text"
                                    }
                                    value={v.plain_value ?? ""}
                                    onChange={(e) =>
                                      updateVar(originalIdx, {
                                        plain_value: e.target.value,
                                      })
                                    }
                                    placeholder="Value"
                                    className="h-7 flex-1 text-[11px]"
                                  />
                                  {v.is_secret ? (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7"
                                      onClick={() => toggleReveal(v.id)}
                                    >
                                      {revealedIds.has(v.id) ? (
                                        <EyeOff className="h-3 w-3" />
                                      ) : (
                                        <Eye className="h-3 w-3" />
                                      )}
                                    </Button>
                                  ) : null}
                                </div>
                              )}
                              <div className="flex items-center gap-0.5">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6"
                                  title={
                                    v.is_secret ? "Mark as plain" : "Mark as secret"
                                  }
                                  onClick={() =>
                                    updateVar(originalIdx, {
                                      is_secret: v.is_secret ? 0 : 1,
                                    })
                                  }
                                >
                                  {v.is_secret ? (
                                    <Lock className="h-3 w-3 text-yellow-500" />
                                  ) : (
                                    <Eye className="h-3 w-3 text-muted-foreground" />
                                  )}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6"
                                  title="Link from Credentials"
                                  onClick={() => {
                                    setCredPickerVarIndex(originalIdx);
                                    setCredPickerOpen(true);
                                  }}
                                >
                                  <Link2 className="h-3 w-3 text-muted-foreground" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 text-destructive"
                                  onClick={() => deleteVar(originalIdx)}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </ScrollArea>

                {/* Footer */}
                <div className="flex justify-end gap-2 border-t border-border/30 px-4 py-2">
                  <Button variant="ghost" size="sm" onClick={onClose}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleSave}>
                    Save Changes
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center">
                <p className="text-xs text-muted-foreground">
                  Select or create an environment
                </p>
              </div>
            )}
          </div>
        </div>

        <CredentialPicker
          open={credPickerOpen}
          onClose={() => setCredPickerOpen(false)}
          onSelect={(credential, fieldKey, fieldLabel) => {
            if (credPickerVarIndex !== null) {
              updateVar(credPickerVarIndex, {
                credential_id: credential.id,
                credential_field: fieldKey,
                plain_value: null,
                _credentialName: `${credential.name} → ${fieldLabel}`,
              });
            }
            setCredPickerOpen(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
