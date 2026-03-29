import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { HttpMethod } from "@/types/api";
import { HTTP_METHODS, METHOD_COLORS } from "@/types/api";

interface UrlBarProps {
  method: HttpMethod;
  url: string;
  sending: boolean;
  /** Variable names resolved from the active environment */
  envVarNames?: Set<string>;
  /** Variable names resolved from the collection (fallback) */
  colVarNames?: Set<string>;
  /** Resolved values map for tooltip — key → value */
  varValues?: Map<string, string>;
  onMethodChange: (method: HttpMethod) => void;
  onUrlChange: (url: string) => void;
  onSend: () => void;
  onCancel: () => void;
}

const VAR_RE = /(\{\{[^}]+\}\})/g;

function VarToken({
  text,
  kind,
  value,
}: {
  text: string;
  kind: "env" | "col" | "cred" | "unresolved";
  value?: string;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const spanRef = useRef<HTMLSpanElement>(null);

  const colorClass =
    kind === "env"
      ? "bg-green-500/20 text-green-400"
      : kind === "col"
        ? "bg-purple-500/20 text-purple-400"
        : kind === "cred"
          ? "bg-blue-500/20 text-blue-400"
          : "bg-red-500/20 text-red-400";

  const handleMouseEnter = () => {
    if (spanRef.current) {
      const rect = spanRef.current.getBoundingClientRect();
      setPos({ top: rect.top - 4, left: rect.left });
    }
  };

  const tooltip =
    pos &&
    createPortal(
      <span
        className="pointer-events-none fixed z-[9999] max-w-[260px] -translate-y-full truncate rounded bg-popover px-2 py-1 text-[11px] shadow-lg ring-1 ring-border/50"
        style={{ top: pos.top, left: pos.left }}
      >
        {kind === "unresolved" ? (
          <span className="text-destructive">unresolved</span>
        ) : value === "[encrypted]" ? (
          <span className="text-muted-foreground">🔒 encrypted</span>
        ) : value ? (
          <span className="text-popover-foreground">{value}</span>
        ) : (
          <em className="text-muted-foreground">empty</em>
        )}
      </span>,
      document.body,
    );

  return (
    <>
      <span
        ref={spanRef}
        className={`rounded px-0.5 ${colorClass} cursor-default`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={() => setPos(null)}
      >
        {text}
      </span>
      {tooltip}
    </>
  );
}

export function UrlBar({
  method,
  url,
  sending,
  envVarNames,
  colVarNames,
  varValues,
  onMethodChange,
  onUrlChange,
  onSend,
  onCancel,
}: UrlBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !sending) {
      onSend();
    }
  };

  const hasVarInfo = (envVarNames?.size ?? 0) > 0 || (colVarNames?.size ?? 0) > 0;

  // Build highlighted segments for the overlay
  const segments = useMemo(() => {
    if (!hasVarInfo) return null;
    const parts = url.split(VAR_RE);
    if (parts.length <= 1) return null;
    return parts.map((part, i) => {
      if (!VAR_RE.test(part)) return <span key={i}>{part}</span>;
      // Reset lastIndex after test()
      VAR_RE.lastIndex = 0;
      const inner = part.slice(2, -2);
      const isCred = inner.startsWith("CRED:");
      const inEnv = envVarNames?.has(inner) ?? false;
      const inCol = colVarNames?.has(inner) ?? false;
      const kind = isCred ? "cred" : inEnv ? "env" : inCol ? "col" : "unresolved";
      const value = isCred ? "[encrypted]" : varValues?.get(inner);
      return (
        <VarToken key={i} text={part} kind={kind} value={kind === "unresolved" ? undefined : value} />
      );
    });
  }, [url, envVarNames, colVarNames, varValues, hasVarInfo]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex items-center gap-2">
      {/* Method selector */}
      <Select value={method} onValueChange={(v) => onMethodChange(v as HttpMethod)}>
        <SelectTrigger
          className="h-9 w-[110px] shrink-0 border-white/10 bg-white/5 text-xs font-bold"
          style={{ color: METHOD_COLORS[method] }}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {HTTP_METHODS.map((m) => (
            <SelectItem key={m} value={m}>
              <span className="font-bold" style={{ color: METHOD_COLORS[m] }}>
                {m}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* URL input with highlight overlay */}
      <div className="relative flex-1">
        {segments && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 flex items-center overflow-hidden whitespace-nowrap px-3 font-mono text-sm text-transparent"
          >
            {/* Re-enable pointer events only for var tokens so hover works */}
            <div className="pointer-events-auto flex items-center whitespace-nowrap">
              {segments}
            </div>
          </div>
        )}
        <input
          ref={inputRef}
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="https://api.example.com/endpoint"
          className="h-9 w-full rounded-md border border-white/10 bg-white/5 px-3 font-mono text-sm outline-none focus:ring-1 focus:ring-[#007AFF]"
        />
      </div>

      {/* Send / Cancel button */}
      {sending ? (
        <Button
          size="sm"
          variant="destructive"
          className="h-9 gap-1.5 px-4"
          onClick={onCancel}
        >
          <Loader2 className="h-4 w-4 animate-spin" />
          Cancel
        </Button>
      ) : (
        <Button
          size="sm"
          className="h-9 gap-1.5 bg-[#007AFF] px-4 text-white hover:bg-[#0066DD]"
          onClick={onSend}
        >
          <Send className="h-4 w-4" />
          Send
        </Button>
      )}
    </div>
  );
}

