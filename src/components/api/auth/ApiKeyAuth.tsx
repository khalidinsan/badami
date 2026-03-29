import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Link2, Lock } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CredentialPicker } from "../CredentialPicker";
import type { ApiKeyAuthConfig } from "@/types/api";

interface ApiKeyAuthProps {
  config: ApiKeyAuthConfig;
  onChange: (config: ApiKeyAuthConfig) => void;
}

export function ApiKeyAuth({ config, onChange }: ApiKeyAuthProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [linkedValue, setLinkedValue] = useState<{
    name: string;
    field: string;
  } | null>(null);

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Key</Label>
        <Input
          value={config.key}
          onChange={(e) => onChange({ ...config, key: e.target.value })}
          placeholder="X-API-Key"
          className="h-8 text-xs"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Value</Label>
        <div className="flex gap-2">
          {linkedValue ? (
            <div className="flex flex-1 items-center gap-2 rounded-md border border-border/50 bg-muted/30 px-3 py-1.5">
              <Lock className="h-3.5 w-3.5 text-[#007AFF]" />
              <span className="text-xs">
                Linked: <strong>{linkedValue.name}</strong> → {linkedValue.field}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-5 text-[10px] text-muted-foreground"
                onClick={() => {
                  setLinkedValue(null);
                  onChange({ ...config, value: "" });
                }}
              >
                Unlink
              </Button>
            </div>
          ) : (
            <Input
              value={config.value}
              onChange={(e) => onChange({ ...config, value: e.target.value })}
              placeholder="API key value or {{VARIABLE}}"
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

      <div className="space-y-1.5">
        <Label className="text-xs">Add to</Label>
        <Select
          value={config.add_to}
          onValueChange={(v) =>
            onChange({ ...config, add_to: v as "header" | "query" })
          }
        >
          <SelectTrigger className="h-8 w-36 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="header">Header</SelectItem>
            <SelectItem value="query">Query Param</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <CredentialPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(credential, fieldKey, fieldLabel) => {
          setLinkedValue({ name: credential.name, field: fieldLabel });
          onChange({
            ...config,
            value: `{{CRED:${credential.id}:${fieldKey}}}`,
          });
        }}
      />
    </div>
  );
}
