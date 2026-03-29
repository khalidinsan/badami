import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Link2, Lock } from "lucide-react";
import { CredentialPicker } from "../CredentialPicker";
import type { BasicAuthConfig } from "@/types/api";

interface BasicAuthProps {
  config: BasicAuthConfig;
  onChange: (config: BasicAuthConfig) => void;
}

type LinkableField = "username" | "password";

export function BasicAuth({ config, onChange }: BasicAuthProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerField, setPickerField] = useState<LinkableField>("username");
  const [linkedFields, setLinkedFields] = useState<
    Record<string, { name: string; field: string }>
  >({});

  const openPicker = (field: LinkableField) => {
    setPickerField(field);
    setPickerOpen(true);
  };

  const renderField = (
    field: LinkableField,
    label: string,
    placeholder: string,
    isPassword = false,
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
              type={isPassword ? "password" : "text"}
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
      {renderField("username", "Username", "Username or {{VARIABLE}}")}
      {renderField("password", "Password", "Password or {{VARIABLE}}", true)}

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
