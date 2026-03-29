import { useState, useEffect, useMemo } from "react";
import { ArrowLeftRight, Equal, Plus, Minus, Eye, EyeOff } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useCredentials } from "@/hooks/useCredentials";
import * as credentialQueries from "@/db/queries/credentials";
import type { CredentialRow } from "@/types/db";

interface EnvDiffViewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  envCredentials: CredentialRow[];
}

interface EnvEntry {
  key: string;
  value: string;
}

export function EnvDiffView({
  open,
  onOpenChange,
  envCredentials,
}: EnvDiffViewProps) {
  const { decryptField } = useCredentials();
  const [leftId, setLeftId] = useState<string>("");
  const [rightId, setRightId] = useState<string>("");
  const [leftEntries, setLeftEntries] = useState<EnvEntry[]>([]);
  const [rightEntries, setRightEntries] = useState<EnvEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [showValues, setShowValues] = useState(false);

  // Auto-select first two env credentials
  useEffect(() => {
    if (open && envCredentials.length >= 2) {
      if (!leftId) setLeftId(envCredentials[0].id);
      if (!rightId) setRightId(envCredentials[1].id);
    } else if (open && envCredentials.length === 1) {
      if (!leftId) setLeftId(envCredentials[0].id);
    }
  }, [open, envCredentials, leftId, rightId]);

  // Load env vars for a credential
  const loadEnvVars = async (credentialId: string): Promise<EnvEntry[]> => {
    const vars = await credentialQueries.getEnvVarsByCredential(credentialId);
    const entries: EnvEntry[] = [];
    for (const v of vars) {
      try {
        const value = await decryptField(v.encrypted_value, v.iv);
        entries.push({ key: v.var_key, value });
      } catch {
        entries.push({ key: v.var_key, value: "" });
      }
    }
    return entries;
  };

  useEffect(() => {
    if (!open) return;
    if (!leftId && !rightId) return;

    setLoading(true);
    Promise.all([
      leftId ? loadEnvVars(leftId) : Promise.resolve([]),
      rightId ? loadEnvVars(rightId) : Promise.resolve([]),
    ])
      .then(([left, right]) => {
        setLeftEntries(left);
        setRightEntries(right);
      })
      .finally(() => setLoading(false));
  }, [open, leftId, rightId]);

  // Compute diff
  const diff = useMemo(() => {
    const leftMap = new Map(leftEntries.map((e) => [e.key, e.value]));
    const rightMap = new Map(rightEntries.map((e) => [e.key, e.value]));
    const allKeys = new Set([...leftMap.keys(), ...rightMap.keys()]);
    const rows: {
      key: string;
      left: string | null;
      right: string | null;
      status: "same" | "different" | "left-only" | "right-only";
    }[] = [];

    for (const key of Array.from(allKeys).sort()) {
      const left = leftMap.get(key) ?? null;
      const right = rightMap.get(key) ?? null;
      let status: "same" | "different" | "left-only" | "right-only";
      if (left !== null && right !== null) {
        status = left === right ? "same" : "different";
      } else if (left !== null) {
        status = "left-only";
      } else {
        status = "right-only";
      }
      rows.push({ key, left, right, status });
    }

    return rows;
  }, [leftEntries, rightEntries]);

  const stats = useMemo(() => {
    let same = 0, different = 0, leftOnly = 0, rightOnly = 0;
    for (const row of diff) {
      if (row.status === "same") same++;
      else if (row.status === "different") different++;
      else if (row.status === "left-only") leftOnly++;
      else rightOnly++;
    }
    return { same, different, leftOnly, rightOnly };
  }, [diff]);

  const leftCred = envCredentials.find((c) => c.id === leftId);
  const rightCred = envCredentials.find((c) => c.id === rightId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowLeftRight className="h-4 w-4" />
            Compare Environment Variables
          </DialogTitle>
        </DialogHeader>

        {/* Selectors */}
        <div className="flex items-center gap-3">
          <Select value={leftId} onValueChange={setLeftId}>
            <SelectTrigger className="h-8 flex-1 text-xs">
              <SelectValue placeholder="Select left..." />
            </SelectTrigger>
            <SelectContent>
              {envCredentials.map((c) => (
                <SelectItem key={c.id} value={c.id} disabled={c.id === rightId}>
                  {c.name}
                  {c.environment && c.environment !== "none" ? ` (${c.environment})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ArrowLeftRight className="h-4 w-4 text-muted-foreground shrink-0" />
          <Select value={rightId} onValueChange={setRightId}>
            <SelectTrigger className="h-8 flex-1 text-xs">
              <SelectValue placeholder="Select right..." />
            </SelectTrigger>
            <SelectContent>
              {envCredentials.map((c) => (
                <SelectItem key={c.id} value={c.id} disabled={c.id === leftId}>
                  {c.name}
                  {c.environment && c.environment !== "none" ? ` (${c.environment})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            onClick={() => setShowValues((v) => !v)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-input text-muted-foreground hover:text-foreground transition-colors"
            title={showValues ? "Hide values" : "Show values"}
          >
            {showValues ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        </div>

        {/* Stats */}
        {diff.length > 0 && (
          <div className="flex items-center gap-2 text-[11px]">
            <Badge variant="outline" className="gap-1 px-1.5 py-0 text-[10px]">
              <Equal className="h-2.5 w-2.5" />
              {stats.same} same
            </Badge>
            {stats.different > 0 && (
              <Badge variant="outline" className="gap-1 px-1.5 py-0 text-[10px] border-yellow-500/40 text-yellow-600">
                {stats.different} different
              </Badge>
            )}
            {stats.leftOnly > 0 && (
              <Badge variant="outline" className="gap-1 px-1.5 py-0 text-[10px] border-red-500/40 text-red-600">
                <Minus className="h-2.5 w-2.5" />
                {stats.leftOnly} left only
              </Badge>
            )}
            {stats.rightOnly > 0 && (
              <Badge variant="outline" className="gap-1 px-1.5 py-0 text-[10px] border-green-500/40 text-green-600">
                <Plus className="h-2.5 w-2.5" />
                {stats.rightOnly} right only
              </Badge>
            )}
          </div>
        )}

        {/* Diff table */}
        <div className="flex-1 overflow-auto rounded-lg border border-border/60">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary mr-2" />
              Decrypting...
            </div>
          ) : diff.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              {(!leftId || !rightId) ? "Select two credentials to compare" : "No variables found"}
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/40 bg-muted/30">
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground w-[30%]">Key</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground w-[35%]">
                    {leftCred?.name ?? "Left"}
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground w-[35%]">
                    {rightCred?.name ?? "Right"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {diff.map((row) => (
                  <tr
                    key={row.key}
                    className={cn(
                      "border-b border-border/20",
                      row.status === "different" && "bg-yellow-500/5",
                      row.status === "left-only" && "bg-red-500/5",
                      row.status === "right-only" && "bg-green-500/5",
                    )}
                  >
                    <td className="px-3 py-1.5 font-mono font-semibold text-primary">
                      {row.key}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-muted-foreground">
                      {row.left !== null ? (showValues ? row.left : "••••••") : (
                        <span className="text-muted-foreground/30 italic">—</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-muted-foreground">
                      {row.right !== null ? (showValues ? row.right : "••••••") : (
                        <span className="text-muted-foreground/30 italic">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
