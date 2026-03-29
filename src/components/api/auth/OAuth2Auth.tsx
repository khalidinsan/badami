import { useState, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Link2, Lock, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { CredentialPicker } from "../CredentialPicker";
import type { OAuth2AuthConfig } from "@/types/api";

interface OAuth2AuthProps {
  config: OAuth2AuthConfig;
  onChange: (config: OAuth2AuthConfig) => void;
}

type LinkableField = "client_id" | "client_secret";

export function OAuth2Auth({ config, onChange }: OAuth2AuthProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerField, setPickerField] = useState<LinkableField>("client_id");
  const [linkedFields, setLinkedFields] = useState<
    Record<string, { name: string; field: string }>
  >({});
  const [fetching, setFetching] = useState(false);
  const [tokenStatus, setTokenStatus] = useState<"idle" | "success" | "error">("idle");
  const [tokenError, setTokenError] = useState("");

  const openPicker = (field: LinkableField) => {
    setPickerField(field);
    setPickerOpen(true);
  };

  const handleFetchToken = useCallback(async () => {
    if (!config.token_url) return;
    setFetching(true);
    setTokenStatus("idle");
    setTokenError("");
    try {
      const result = await invoke<Record<string, unknown>>("api_fetch_oauth2_token", {
        tokenUrl: config.token_url,
        clientId: config.client_id,
        clientSecret: config.client_secret,
        scope: config.scope,
      });

      const accessToken = (result.access_token as string) ?? "";
      const expiresIn = (result.expires_in as number) ?? 3600;
      const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

      onChange({
        ...config,
        cached_token: accessToken,
        token_expires_at: expiresAt,
      });
      setTokenStatus("success");
    } catch (err) {
      setTokenError(err instanceof Error ? err.message : String(err));
      setTokenStatus("error");
    } finally {
      setFetching(false);
    }
  }, [config, onChange]);

  const isTokenValid =
    config.cached_token &&
    config.token_expires_at &&
    new Date(config.token_expires_at) > new Date();

  const renderLinkableField = (
    field: LinkableField,
    label: string,
    placeholder: string,
    isSecret = false,
  ) => {
    const linked = linkedFields[field];
    return (
      <div className="space-y-1.5">
        <Label className="text-xs">{label}</Label>
        <div className="flex gap-2">
          {linked ? (
            <div className="flex flex-1 items-center gap-2 rounded-md border border-border/50 bg-muted/30 px-3 py-1.5">
              <Lock className="h-3.5 w-3.5 text-[#007AFF]" />
              <span className="text-xs">
                Linked: <strong>{linked.name}</strong> → {linked.field}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-5 text-[10px] text-muted-foreground"
                onClick={() => {
                  const next = { ...linkedFields };
                  delete next[field];
                  setLinkedFields(next);
                  onChange({ ...config, [field]: "" });
                }}
              >
                Unlink
              </Button>
            </div>
          ) : (
            <Input
              type={isSecret ? "password" : "text"}
              value={config[field]}
              onChange={(e) => onChange({ ...config, [field]: e.target.value })}
              placeholder={placeholder}
              className="h-8 flex-1 text-xs"
            />
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => openPicker(field)}
          >
            <Link2 className="h-3 w-3" />
            Link
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Grant Type</Label>
        <Input
          value="Client Credentials"
          disabled
          className="h-8 text-xs opacity-60"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Token URL</Label>
        <Input
          value={config.token_url}
          onChange={(e) => onChange({ ...config, token_url: e.target.value })}
          placeholder="https://auth.example.com/oauth/token"
          className="h-8 text-xs"
        />
      </div>

      {renderLinkableField("client_id", "Client ID", "Client ID or {{VARIABLE}}")}
      {renderLinkableField("client_secret", "Client Secret", "Client Secret or {{VARIABLE}}", true)}

      <div className="space-y-1.5">
        <Label className="text-xs">Scope</Label>
        <Input
          value={config.scope}
          onChange={(e) => onChange({ ...config, scope: e.target.value })}
          placeholder="read write"
          className="h-8 text-xs"
        />
      </div>

      {/* Token fetch section */}
      <div className="rounded-md border border-border/50 bg-muted/20 p-3">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <p className="text-xs font-medium">Access Token</p>
            {isTokenValid ? (
              <div className="flex items-center gap-1 text-[11px] text-green-500">
                <CheckCircle2 className="h-3 w-3" />
                Valid until{" "}
                {new Date(config.token_expires_at!).toLocaleTimeString()}
              </div>
            ) : config.cached_token ? (
              <p className="text-[11px] text-yellow-500">Token expired</p>
            ) : (
              <p className="text-[11px] text-muted-foreground">No token cached</p>
            )}
          </div>
          <Button
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={handleFetchToken}
            disabled={fetching || !config.token_url}
          >
            {fetching && <Loader2 className="h-3 w-3 animate-spin" />}
            {fetching ? "Fetching..." : "Get Token"}
          </Button>
        </div>
        {tokenStatus === "error" && (
          <div className="mt-2 flex items-start gap-1.5 text-[11px] text-red-400">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
            <span className="break-all">{tokenError}</span>
          </div>
        )}
      </div>

      <CredentialPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(credential, fieldKey, fieldLabel) => {
          setLinkedFields((prev) => ({
            ...prev,
            [pickerField]: { name: credential.name, field: fieldLabel },
          }));
          onChange({
            ...config,
            [pickerField]: `{{CRED:${credential.id}:${fieldKey}}}`,
          });
        }}
      />
    </div>
  );
}
