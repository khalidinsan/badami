import { useEffect, useState } from "react";
import {
  KeyRound,
  Trash2,
  Upload,
  Shield,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { useServerStore } from "@/stores/serverStore";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { toast } from "sonner";
import type { PemKeyRow } from "@/types/db";
import * as serverQueries from "@/db/queries/servers";
import dayjs from "dayjs";

export function PemKeyManager() {
  const { pemKeys, loadPemKeys, deletePemKey } = useServerStore();
  const [importOpen, setImportOpen] = useState(false);
  const [alias, setAlias] = useState("");
  const [comment, setComment] = useState("");
  const [filePath, setFilePath] = useState("");
  const [importing, setImporting] = useState(false);
  const [deletingKey, setDeletingKey] = useState<PemKeyRow | null>(null);

  useEffect(() => {
    loadPemKeys();
  }, []);

  const handleBrowse = async () => {
    const selected = await open({
      title: "Select PEM Key File",
      filters: [{ name: "Key Files", extensions: ["pem", "key", "ppk"] }],
    });
    if (selected) {
      setFilePath(selected as string);
      // Auto-fill alias from filename if empty
      if (!alias) {
        const name = (selected as string).split("/").pop()?.replace(/\.[^.]+$/, "") ?? "";
        setAlias(name);
      }
    }
  };

  const handleImport = async () => {
    if (!alias.trim() || !filePath) return;
    setImporting(true);
    try {
      // Read the PEM file
      const pemContent = await readTextFile(filePath);

      // Encrypt via Rust
      const [encryptedData, iv] = await invoke<[number[], number[]]>(
        "encrypt_pem_key",
        { pemContent },
      );

      // Save to DB
      await serverQueries.createPemKey({
        alias: alias.trim(),
        encrypted_data: encryptedData,
        iv,
        comment: comment.trim() || null,
      });

      toast.success("PEM key imported");
      setImportOpen(false);
      setAlias("");
      setComment("");
      setFilePath("");
      loadPemKeys();
    } catch (err) {
      console.error(err);
      toast.error(`Failed to import key: ${err}`);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          PEM keys are encrypted and stored securely. They are never exposed to the frontend.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 text-xs"
          onClick={() => setImportOpen(true)}
        >
          <Upload className="h-3 w-3" />
          Import Key
        </Button>
      </div>

      {pemKeys.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border/60 py-8">
          <Shield className="mb-2 h-6 w-6 text-muted-foreground/30" />
          <p className="text-xs text-muted-foreground/60">No PEM keys imported yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {pemKeys.map((key) => (
            <div
              key={key.id}
              className="flex items-center justify-between rounded-lg border border-border/60 bg-card px-3 py-2.5"
            >
              <div className="flex items-center gap-2.5">
                <KeyRound className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">{key.alias}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {key.comment && <span>{key.comment} · </span>}
                    Added {dayjs(key.created_at).format("MMM D, YYYY")}
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                onClick={() => setDeletingKey(key)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Import Dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Import PEM Key</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Alias</Label>
              <Input
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                placeholder="e.g. AWS Production Key"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Key File</Label>
              <div className="flex gap-2">
                <Input
                  value={filePath}
                  readOnly
                  placeholder="Select a .pem, .key, or .ppk file"
                  className="flex-1"
                />
                <Button type="button" variant="outline" size="sm" onClick={handleBrowse}>
                  Browse
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Comment (optional)</Label>
              <Input
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Notes about this key"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleImport}
              disabled={importing || !alias.trim() || !filePath}
            >
              {importing ? "Importing..." : "Import"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog open={!!deletingKey} onOpenChange={(o) => { if (!o) setDeletingKey(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete PEM Key</AlertDialogTitle>
            <AlertDialogDescription>
              Delete &quot;{deletingKey?.alias}&quot;? Servers using this key will need
              to be updated with a new key. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deletingKey) {
                  deletePemKey(deletingKey.id);
                  setDeletingKey(null);
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
