import { X, Play, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface DdlPreviewModalProps {
  sql: string;
  onExecute: () => void;
  onClose: () => void;
  loading?: boolean;
}

export function DdlPreviewModal({
  sql,
  onExecute,
  onClose,
  loading,
}: DdlPreviewModalProps) {
  const handleCopy = () => {
    navigator.clipboard.writeText(sql);
    toast.success("SQL copied");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="mx-4 flex max-h-[80vh] w-full max-w-xl flex-col rounded-xl border border-white/10 bg-background shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <h3 className="text-sm font-medium">DDL Preview</h3>
          <button onClick={onClose} className="rounded p-1 hover:bg-white/10">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* SQL content */}
        <div className="flex-1 overflow-auto p-4">
          <pre className="whitespace-pre-wrap rounded-lg bg-white/5 p-3 font-mono text-xs leading-relaxed text-foreground">
            {sql}
          </pre>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 border-t border-white/10 px-4 py-3">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1 text-xs"
            onClick={handleCopy}
          >
            <Copy className="h-3.5 w-3.5" />
            Copy
          </Button>
          <Button variant="ghost" size="sm" className="text-xs" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="gap-1 text-xs"
            onClick={onExecute}
            disabled={loading}
          >
            <Play className="h-3.5 w-3.5" />
            Execute
          </Button>
        </div>
      </div>
    </div>
  );
}
