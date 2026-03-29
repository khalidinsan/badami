import { useState } from "react";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Wifi,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "@/lib/utils";

interface TestConnectionButtonProps {
  host: string;
  port: number;
  username: string;
  authType: string;
  password?: string;
  pemContent?: string;
  passphrase?: string;
  disabled?: boolean;
}

export function TestConnectionButton({
  host,
  port,
  username,
  authType,
  password,
  pemContent,
  passphrase,
  disabled,
}: TestConnectionButtonProps) {
  const [status, setStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  const handleTest = async () => {
    if (!host || !username) return;
    setStatus("testing");
    setMessage("");

    try {
      const result = await invoke<string>("test_server_connection", {
        host,
        port,
        username,
        authType,
        password: password || null,
        pemContent: pemContent || null,
        passphrase: passphrase || null,
      });
      setStatus("success");
      setMessage(result);
    } catch (err) {
      setStatus("error");
      setMessage(String(err));
    }

    // Reset after a few seconds
    setTimeout(() => {
      setStatus("idle");
      setMessage("");
    }, 5000);
  };

  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={cn(
          "h-8 gap-2 text-xs",
          status === "success" && "border-green-500/50 text-green-600",
          status === "error" && "border-red-500/50 text-red-600",
        )}
        onClick={handleTest}
        disabled={disabled || status === "testing" || !host || !username}
      >
        {status === "testing" && <Loader2 className="h-3 w-3 animate-spin" />}
        {status === "success" && <CheckCircle2 className="h-3 w-3" />}
        {status === "error" && <XCircle className="h-3 w-3" />}
        {status === "idle" && <Wifi className="h-3 w-3" />}
        {status === "testing"
          ? "Testing..."
          : status === "success"
            ? "Connected"
            : status === "error"
              ? "Failed"
              : "Test Connection"}
      </Button>
      {message && (
        <p
          className={cn(
            "text-[11px]",
            status === "success" ? "text-green-600" : "text-red-500",
          )}
        >
          {message}
        </p>
      )}
    </div>
  );
}
