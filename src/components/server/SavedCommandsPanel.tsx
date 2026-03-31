import { useState, useEffect, useCallback } from "react";
import {
  Plus,
  Search,
  X,
  Play,
  Type,
  Pencil,
  Trash2,
  Terminal,
  Globe,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import * as savedCommandQueries from "@/db/queries/savedCommands";
import type { SavedCommandRow } from "@/types/db";
import { toast } from "sonner";

interface SavedCommandsPanelProps {
  serverId: string;
  projectId?: string | null;
  onRunCommand: (command: string) => void;
  onClose: () => void;
}

export function SavedCommandsPanel({
  serverId,
  projectId,
  onRunCommand,
  onClose,
}: SavedCommandsPanelProps) {
  const [commands, setCommands] = useState<SavedCommandRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [runImmediately, setRunImmediately] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingCommand, setEditingCommand] = useState<SavedCommandRow | null>(null);

  // Form state
  const [formName, setFormName] = useState("");
  const [formCommand, setFormCommand] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formIsGlobal, setFormIsGlobal] = useState(false);

  const loadCommands = useCallback(async () => {
    setLoading(true);
    try {
      const cmds = await savedCommandQueries.getSavedCommands(serverId, projectId);
      setCommands(cmds);
    } catch (err) {
      console.error(err);
      toast.error("Failed to load saved commands");
    } finally {
      setLoading(false);
    }
  }, [serverId, projectId]);

  useEffect(() => {
    loadCommands();
  }, [loadCommands]);

  const filtered = search
    ? commands.filter(
        (c) =>
          c.name.toLowerCase().includes(search.toLowerCase()) ||
          c.command.toLowerCase().includes(search.toLowerCase()) ||
          (c.description ?? "").toLowerCase().includes(search.toLowerCase()),
      )
    : commands;

  const handleRun = (cmd: SavedCommandRow) => {
    if (runImmediately) {
      onRunCommand(cmd.command + "\n");
    } else {
      onRunCommand(cmd.command);
    }
  };

  const openForm = (cmd?: SavedCommandRow) => {
    if (cmd) {
      setEditingCommand(cmd);
      setFormName(cmd.name);
      setFormCommand(cmd.command);
      setFormDescription(cmd.description ?? "");
      setFormIsGlobal(!cmd.server_id);
    } else {
      setEditingCommand(null);
      setFormName("");
      setFormCommand("");
      setFormDescription("");
      setFormIsGlobal(false);
    }
    setFormOpen(true);
  };

  const handleSave = async () => {
    if (!formName.trim() || !formCommand.trim()) {
      toast.error("Name and command are required");
      return;
    }

    try {
      if (editingCommand) {
        await savedCommandQueries.updateSavedCommand(editingCommand.id, {
          name: formName.trim(),
          command: formCommand.trim(),
          description: formDescription.trim() || null,
        });
        toast.success("Command updated");
      } else {
        await savedCommandQueries.createSavedCommand({
          server_id: formIsGlobal ? null : serverId,
          project_id: formIsGlobal ? null : (projectId ?? null),
          name: formName.trim(),
          command: formCommand.trim(),
          description: formDescription.trim() || null,
        });
        toast.success("Command saved");
      }
      setFormOpen(false);
      loadCommands();
    } catch (err) {
      console.error(err);
      toast.error("Failed to save command");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await savedCommandQueries.deleteSavedCommand(id);
      setCommands((prev) => prev.filter((c) => c.id !== id));
      toast.success("Command deleted");
    } catch (err) {
      console.error(err);
      toast.error("Failed to delete command");
    }
  };

  return (
    <div className="flex h-full w-72 flex-col border-l border-border/40 bg-card/80 backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/40 px-3 py-2">
        <span className="text-xs font-medium">Saved Commands</span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => openForm()}
            title="Add command"
          >
            <Plus className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onClose}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="border-b border-border/30 px-3 py-1.5">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/50" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search commands..."
            className="h-7 pl-7 text-[11px]"
          />
        </div>
      </div>

      {/* Mode toggle */}
      <div className="flex items-center gap-1.5 border-b border-border/30 px-3 py-1.5">
        <button
          onClick={() => setRunImmediately(true)}
          className={cn(
            "flex items-center gap-1 rounded px-2 py-0.5 text-[10px] transition-colors",
            runImmediately
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Play className="h-2.5 w-2.5" />
          Run
        </button>
        <button
          onClick={() => setRunImmediately(false)}
          className={cn(
            "flex items-center gap-1 rounded px-2 py-0.5 text-[10px] transition-colors",
            !runImmediately
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Type className="h-2.5 w-2.5" />
          Insert
        </button>
      </div>

      {/* Commands list */}
      <ScrollArea className="flex-1">
        <div className="space-y-0.5 p-1.5">
          {loading ? (
            <p className="py-8 text-center text-[11px] text-muted-foreground">
              Loading...
            </p>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground/60">
              <Terminal className="h-6 w-6" />
              <p className="text-[11px]">
                {search ? "No matching commands" : "No saved commands yet"}
              </p>
              {!search && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 gap-1 text-[10px]"
                  onClick={() => openForm()}
                >
                  <Plus className="h-2.5 w-2.5" />
                  Add command
                </Button>
              )}
            </div>
          ) : (
            filtered.map((cmd) => (
              <div
                key={cmd.id}
                className="group relative rounded-lg border border-border/30 bg-card/50 p-2 transition-colors hover:bg-accent/50"
              >
                <button
                  className="w-full text-left"
                  onClick={() => handleRun(cmd)}
                >
                  <div className="flex items-center gap-1.5">
                    {!cmd.server_id && (
                      <Globe className="h-2.5 w-2.5 shrink-0 text-muted-foreground/50" />
                    )}
                    <span className="truncate text-[11px] font-medium">
                      {cmd.name}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                    {cmd.command}
                  </p>
                  {cmd.description && (
                    <p className="mt-0.5 truncate text-[10px] text-muted-foreground/60">
                      {cmd.description}
                    </p>
                  )}
                </button>
                {/* Action buttons */}
                <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5"
                    onClick={(e) => {
                      e.stopPropagation();
                      openForm(cmd);
                    }}
                  >
                    <Pencil className="h-2.5 w-2.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 text-destructive hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(cmd.id);
                    }}
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>

      {/* Add/Edit command dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {editingCommand ? "Edit Command" : "Add Command"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label className="text-[11px]">Name</Label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Restart Nginx"
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Command</Label>
              <Textarea
                value={formCommand}
                onChange={(e) => setFormCommand(e.target.value)}
                placeholder="sudo systemctl restart nginx"
                className="min-h-[60px] font-mono text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Description (optional)</Label>
              <Input
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Restart the web server"
                className="h-8 text-xs"
              />
            </div>
            {!editingCommand && (
              <label className="flex items-center gap-2 text-[11px]">
                <input
                  type="checkbox"
                  checked={formIsGlobal}
                  onChange={(e) => setFormIsGlobal(e.target.checked)}
                  className="rounded"
                />
                <span className="text-muted-foreground">
                  Global command (available on all servers)
                </span>
              </label>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setFormOpen(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={handleSave}
            >
              {editingCommand ? "Update" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
