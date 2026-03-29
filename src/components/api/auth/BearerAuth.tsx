import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Link2, Lock } from "lucide-react";
import { CredentialPicker } from "../CredentialPicker";
import type { BearerAuthConfig } from "@/types/api";

interface BearerAuthProps {
  config: BearerAuthConfig;
  onChange: (config: BearerAuthConfig) => void;
}

export function BearerAuth({ config, onChange }: BearerAuthProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [linkedCredential, setLinkedCredential] = useState<{
    name: string;
    field: string;
  } | null>(null);

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Token</Label>
        <div className="flex gap-2">
          {linkedCredential ? (
            <div className="flex flex-1 items-center gap-2 rounded-md border border-border/50 bg-muted/30 px-3 py-1.5">
              <Lock className="h-3.5 w-3.5 text-[#007AFF]" />
              <span className="text-xs">
                Linked: <strong>{linkedCredential.name}</strong> → {linkedCredential.field}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-5 text-[10px] text-muted-foreground"
                onClick={() => {
                  setLinkedCredential(null);
                  onChange({ ...config, token: "" });
                }}
              >
                Unlink
              </Button>
            </div>
          ) : (
            <Input
              value={config.token}
              onChange={(e) => onChange({ ...config, token: e.target.value })}
              placeholder="Enter token or {{VARIABLE}}"
              className="h-8 flex-1 font-mono text-xs"
            />
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => setPickerOpen(true)}
          >
            <Link2 className="h-3 w-3" />
            Link
          </Button>
        </div>
      </div>

      <CredentialPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(credential, fieldKey, fieldLabel) => {
          setLinkedCredential({
            name: credential.name,
            field: fieldLabel,
          });
          // Store as {{CRED:credential_id:field_key}} so Rust can resolve
          onChange({
            ...config,
            token: `{{CRED:${credential.id}:${fieldKey}}}`,
          });
        }}
      />
    </div>
  );
}
