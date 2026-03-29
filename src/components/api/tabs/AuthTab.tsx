import type { AuthType, AuthConfig } from "@/types/api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BearerAuth } from "../auth/BearerAuth";
import { BasicAuth } from "../auth/BasicAuth";
import { ApiKeyAuth } from "../auth/ApiKeyAuth";
import { OAuth2Auth } from "../auth/OAuth2Auth";

interface AuthTabProps {
  authType: AuthType;
  authConfig: AuthConfig | null;
  onTypeChange: (type: AuthType) => void;
  onConfigChange: (config: AuthConfig | null) => void;
}

export function AuthTab({
  authType,
  authConfig,
  onTypeChange,
  onConfigChange,
}: AuthTabProps) {
  return (
    <div className="p-3">
      <div className="mb-4">
        <Select
          value={authType}
          onValueChange={(v) => {
            const t = v as AuthType;
            onTypeChange(t);
            switch (t) {
              case "bearer":
                onConfigChange({ type: "bearer", token: "" });
                break;
              case "basic":
                onConfigChange({ type: "basic", username: "", password: "" });
                break;
              case "api_key":
                onConfigChange({ type: "api_key", key: "", value: "", add_to: "header" });
                break;
              case "oauth2":
                onConfigChange({
                  type: "oauth2",
                  grant_type: "client_credentials",
                  token_url: "",
                  client_id: "",
                  client_secret: "",
                  scope: "",
                });
                break;
              default:
                onConfigChange(null);
            }
          }}
        >
          <SelectTrigger className="h-7 w-48 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No Auth</SelectItem>
            <SelectItem value="bearer">Bearer Token</SelectItem>
            <SelectItem value="basic">Basic Auth</SelectItem>
            <SelectItem value="api_key">API Key</SelectItem>
            <SelectItem value="oauth2">OAuth 2.0</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {authType === "none" && (
        <p className="py-6 text-center text-sm text-muted-foreground">
          This request does not use any authorization
        </p>
      )}

      {authType === "bearer" && authConfig?.type === "bearer" && (
        <BearerAuth config={authConfig} onChange={onConfigChange} />
      )}

      {authType === "basic" && authConfig?.type === "basic" && (
        <BasicAuth config={authConfig} onChange={onConfigChange} />
      )}

      {authType === "api_key" && authConfig?.type === "api_key" && (
        <ApiKeyAuth config={authConfig} onChange={onConfigChange} />
      )}

      {authType === "oauth2" && authConfig?.type === "oauth2" && (
        <OAuth2Auth config={authConfig} onChange={onConfigChange} />
      )}
    </div>
  );
}
