import { useState, useCallback } from "react";
import { Zap, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "@/lib/utils";

interface TestResult {
  success: boolean;
  message: string;
  latency_ms: number;
}

interface TestConnectionButtonProps {
  params: {
    connection_id: string;
    engine: string;
    host?: string | null;
    port?: number | null;
    database_name?: string | null;
    username?: string | null;
    password?: string | null;
    credential_id?: string | null;
    credential_field?: string | null;
    sqlite_file_path?: string | null;
    use_ssl?: boolean;
    ssl_mode?: string;
    ssl_ca_path?: string;
    tunnel_local_port?: number;
    _has_saved_password?: boolean;
  };
  onResult?: (result: TestResult | null) => void;
}

export function TestConnectionButton({ params, onResult }: TestConnectionButtonProps) {
  const [testing, setTesting] = useState(false);

  const handleTest = useCallback(async () => {
    setTesting(true);
    onResult?.(null);
    try {
      // If the form signals a saved keychain password exists but no explicit password
      // was typed, fetch it from keychain before testing.
      let effectivePassword = params.password ?? null;
      if (!effectivePassword && params._has_saved_password && params.connection_id !== "test") {
        effectivePassword = await invoke<string>("get_db_password", {
          connectionId: params.connection_id,
        }).catch(() => null);
      }
      const { _has_saved_password: _, ...testParams } = params;
      const r = await invoke<TestResult>("dbc_test_connection", {
        params: { ...testParams, password: effectivePassword },
      });
      onResult?.(r);
    } catch (err) {
      onResult?.({
        success: false,
        message: String(err),
        latency_ms: 0,
      });
    } finally {
      setTesting(false);
    }
  }, [params, onResult]);

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleTest}
      disabled={testing}
    >
        {testing ? (
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
        ) : (
          <Zap className="mr-1.5 h-3.5 w-3.5" />
        )}
        Test Connection
      </Button>
    );
}

// Exported separately so the parent can place it wherever it wants
export function TestConnectionResult({ result }: { result: { success: boolean; message: string; latency_ms: number } | null }) {
  if (!result) return null;
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs",
        result.success
          ? "border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400"
          : "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
      )}
    >
      {result.success ? (
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
      ) : (
        <XCircle className="h-3.5 w-3.5 shrink-0" />
      )}
      <span className="truncate">{result.message}</span>
      {result.success && (
        <span className="shrink-0 text-muted-foreground">({result.latency_ms}ms)</span>
      )}
    </div>
  );
}
