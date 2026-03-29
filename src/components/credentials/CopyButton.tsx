import { useState, useCallback, useEffect } from "react";
import { Copy, Check } from "lucide-react";
import { toast } from "sonner";

interface CopyButtonProps {
  onCopy: () => void | Promise<void>;
  label?: string;
  className?: string;
}

export function CopyButton({ onCopy, label, className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const handleCopy = useCallback(async () => {
    try {
      await onCopy();
      setCopied(true);
      toast.success(label ? `${label} copied (auto-clear 30s)` : "Copied (auto-clear 30s)");
    } catch (err) {
      console.error(err);
      toast.error("Failed to copy");
    }
  }, [onCopy, label]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground transition-colors ${className ?? ""}`}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-green-500" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </button>
  );
}
