import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Key } from "lucide-react";
import { CopyButton } from "./CopyButton";
import { useTotp } from "@/hooks/useTotp";
import type { CredentialTotpRow } from "@/types/db";

interface TotpDisplayProps {
  totp: CredentialTotpRow;
}

export function TotpDisplay({ totp }: TotpDisplayProps) {
  const { code, remainingSeconds, period } = useTotp({
    encryptedSecret: totp.encrypted_secret,
    iv: totp.iv,
    digits: totp.digits ?? undefined,
    period: totp.period_seconds ?? 30,
    algorithm: totp.algorithm ?? undefined,
  });

  const progress = remainingSeconds / period;

  const handleCopy = useCallback(async () => {
    if (code) {
      await invoke("credential_copy_plain_to_clipboard", { value: code });
    }
  }, [code]);

  // Format code with space in middle: "482917" → "482 917"
  const displayCode = code ?? "------";
  const formatted = displayCode.length === 6
    ? `${displayCode.slice(0, 3)} ${displayCode.slice(3)}`
    : displayCode;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Key className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          TOTP
        </span>
      </div>
      <div className="flex items-center gap-3">
        <div className="rounded-lg border border-border/60 bg-muted/30 px-4 py-2">
          <span className="text-2xl font-bold font-mono tracking-widest tabular-nums">
            {formatted}
          </span>
        </div>
        <CopyButton onCopy={handleCopy} label="TOTP code" />
        <div className="flex items-center gap-2">
          {/* Progress bar */}
          <div className="h-1.5 w-16 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-1000 ease-linear"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">
            {remainingSeconds}s
          </span>
        </div>
      </div>
    </div>
  );
}
