import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SensitiveField } from "./SensitiveField";
import { PasswordGenerator } from "./PasswordGenerator";
import { useCredentials } from "@/hooks/useCredentials";
import {
  CREDENTIAL_FIELD_SCHEMAS,
  type FieldSchema,
} from "@/lib/credentialTypes";
import type { CredentialType, CredentialEnvironment } from "@/types/credential";
import { CREDENTIAL_TYPE_LABELS, ENVIRONMENT_LABELS } from "@/types/credential";
import type { CredentialRow } from "@/types/db";
import type { ProjectRow } from "@/types/db";
import * as projectQueries from "@/db/queries/projects";

interface CredentialFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  credential?: CredentialRow | null;
  defaultProjectId?: string | null;
  onSaved?: () => void;
}

export function CredentialForm({
  open,
  onOpenChange,
  credential,
  defaultProjectId,
  onSaved,
}: CredentialFormProps) {
  const isEdit = !!credential;
  const {
    createCredential,
    updateCredential,
    saveFieldsForCredential,
    saveEnvVars,
    decryptField,
    getFields,
    getEnvVars,
  } = useCredentials();

  const [projects, setProjects] = useState<ProjectRow[]>([]);

  // Form state
  const [type, setType] = useState<CredentialType>("web_login");
  const [name, setName] = useState("");
  const [environment, setEnvironment] = useState<CredentialEnvironment>("none");
  const [projectId, setProjectId] = useState<string>("none");
  const [expiresAt, setExpiresAt] = useState("");
  const [notes, setNotes] = useState("");
  const [tags, setTags] = useState("");

  // Dynamic fields: key -> value
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});

  // Env vars
  const [envVars, setEnvVars] = useState<{ key: string; value: string }[]>([]);

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      projectQueries.getProjects().then(setProjects).catch(() => {});
    }
  }, [open]);

  // Load existing credential data on edit
  useEffect(() => {
    if (!open) return;

    if (credential) {
      setType(credential.type as CredentialType);
      setName(credential.name);
      setEnvironment((credential.environment ?? "none") as CredentialEnvironment);
      setProjectId(credential.project_id ?? "none");
      setExpiresAt(credential.expires_at ?? "");
      setNotes(credential.notes ?? "");
      setTags(credential.tags ? JSON.parse(credential.tags).join(", ") : "");

      // Load fields
      (async () => {
        const fields = await getFields(credential.id);
        const values: Record<string, string> = {};
        for (const f of fields) {
          if (f.is_sensitive === 1 && f.encrypted_value && f.iv) {
            try {
              values[f.field_key] = await decryptField(
                f.encrypted_value as number[],
                f.iv as number[],
              );
            } catch {
              values[f.field_key] = "";
            }
          } else {
            values[f.field_key] = f.plain_value ?? "";
          }
        }
        setFieldValues(values);

        // Load env vars
        if (credential.type === "env_vars") {
          const vars = await getEnvVars(credential.id);
          const decrypted: { key: string; value: string }[] = [];
          for (const v of vars) {
            try {
              const val = await decryptField(
                v.encrypted_value as number[],
                v.iv as number[],
              );
              decrypted.push({ key: v.var_key, value: val });
            } catch {
              decrypted.push({ key: v.var_key, value: "" });
            }
          }
          setEnvVars(decrypted);
        }
      })();
    } else {
      // Reset form
      setType("web_login");
      setName("");
      setEnvironment("none");
      setProjectId(defaultProjectId ?? "none");
      setExpiresAt("");
      setNotes("");
      setTags("");
      setFieldValues({});
      setEnvVars([]);
    }
  }, [open, credential, defaultProjectId, getFields, getEnvVars, decryptField]);

  const schema = CREDENTIAL_FIELD_SCHEMAS[type] ?? [];

  const setFieldValue = useCallback((key: string, value: string) => {
    setFieldValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleSave = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);

    try {
      const tagArr = tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      // Extract mapped values from fields
      let username: string | null = null;
      let url: string | null = null;
      let serviceName: string | null = null;
      for (const field of schema) {
        const val = fieldValues[field.key] ?? "";
        if (field.mapTo === "username" && val) username = val;
        if (field.mapTo === "url" && val) url = val;
        if (field.mapTo === "service_name" && val) serviceName = val;
      }

      const data = {
        type,
        name: name.trim(),
        environment,
        project_id: projectId === "none" ? null : projectId,
        expires_at: expiresAt || null,
        notes: notes || null,
        tags: tagArr.length > 0 ? tagArr : null,
        username,
        url,
        service_name: serviceName,
      };

      // Close dialog immediately for snappy UX
      onOpenChange(false);

      let credentialId: string;

      if (isEdit && credential) {
        await updateCredential(credential.id, data);
        credentialId = credential.id;
      } else {
        const created = await createCredential(data);
        credentialId = created.id;
      }

      // Save fields
      const sensitiveFields: Record<string, { label: string; value: string }> = {};
      const plainFields: Record<string, { label: string; value: string }> = {};

      for (const field of schema) {
        const val = fieldValues[field.key] ?? "";
        if (!val && !field.sensitive) continue;
        if (field.sensitive) {
          sensitiveFields[field.key] = { label: field.label, value: val };
        } else {
          plainFields[field.key] = { label: field.label, value: val };
        }
      }

      await saveFieldsForCredential(credentialId, sensitiveFields, plainFields);

      // Save env vars
      if (type === "env_vars") {
        const validVars = envVars.filter((v) => v.key.trim());
        await saveEnvVars(credentialId, validVars);
      }

      onSaved?.();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit Credential" : "Add Credential"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Type selector */}
          {!isEdit && (
            <div className="space-y-1.5">
              <Label className="text-xs">Type</Label>
              <Select
                value={type}
                onValueChange={(v) => {
                  setType(v as CredentialType);
                  setFieldValues({});
                  setEnvVars([]);
                }}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(
                    Object.entries(CREDENTIAL_TYPE_LABELS) as [
                      CredentialType,
                      string,
                    ][]
                  ).map(([val, label]) => (
                    <SelectItem key={val} value={val}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Name */}
          <div className="space-y-1.5">
            <Label className="text-xs">Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Cloudflare Login"
              className="h-8 text-xs"
            />
          </div>

          {/* Environment */}
          <div className="space-y-1.5">
            <Label className="text-xs">Environment</Label>
            <Select
              value={environment}
              onValueChange={(v) =>
                setEnvironment(v as CredentialEnvironment)
              }
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(
                  Object.entries(ENVIRONMENT_LABELS) as [
                    CredentialEnvironment,
                    string,
                  ][]
                ).map(([val, label]) => (
                  <SelectItem key={val} value={val}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Project */}
          <div className="space-y-1.5">
            <Label className="text-xs">Project</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Global (no project)</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Dynamic fields */}
          {schema.map((field) => (
            <DynamicField
              key={field.key}
              field={field}
              value={fieldValues[field.key] ?? ""}
              onChange={(v) => setFieldValue(field.key, v)}
              showPasswordGenerator={
                field.sensitive && field.key.includes("password")
              }
            />
          ))}

          {/* Env vars editor */}
          {type === "env_vars" && (
            <div className="space-y-2">
              <Label className="text-xs">Variables</Label>
              {envVars.map((v, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={v.key}
                    onChange={(e) => {
                      const next = [...envVars];
                      next[i] = { ...next[i], key: e.target.value };
                      setEnvVars(next);
                    }}
                    placeholder="KEY"
                    className="h-8 w-1/3 font-mono text-xs"
                  />
                  <Input
                    type="password"
                    value={v.value}
                    onChange={(e) => {
                      const next = [...envVars];
                      next[i] = { ...next[i], value: e.target.value };
                      setEnvVars(next);
                    }}
                    placeholder="value"
                    className="h-8 flex-1 font-mono text-xs"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-destructive"
                    onClick={() => setEnvVars(envVars.filter((_, j) => j !== i))}
                  >
                    ×
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setEnvVars([...envVars, { key: "", value: "" }])}
              >
                + Add Variable
              </Button>
            </div>
          )}

          {/* Expires at */}
          <div className="space-y-1.5">
            <Label className="text-xs">Expires at (optional)</Label>
            <DatePicker
              value={expiresAt || null}
              onChange={(date) => setExpiresAt(date ?? "")}
              placeholder="No expiry date"
            />
          </div>

          {/* Tags */}
          <div className="space-y-1.5">
            <Label className="text-xs">Tags (comma separated)</Label>
            <Input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="hosting, client-x"
              className="h-8 text-xs"
            />
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label className="text-xs">Notes</Label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional notes..."
              rows={3}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-ring resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!name.trim() || saving}
              onClick={handleSave}
            >
              {saving ? "Saving..." : isEdit ? "Save Changes" : "Add Credential"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Dynamic Field Renderer ─────────────────────────────────────────

function DynamicField({
  field,
  value,
  onChange,
  showPasswordGenerator,
}: {
  field: FieldSchema;
  value: string;
  onChange: (value: string) => void;
  showPasswordGenerator?: boolean;
}) {
  if (field.sensitive) {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs">{field.label}</Label>
          {showPasswordGenerator && (
            <PasswordGenerator onUsePassword={onChange} />
          )}
        </div>
        <SensitiveField
          label=""
          value={value}
          onChange={onChange}
          placeholder={field.placeholder}
        />
      </div>
    );
  }

  if (field.inputType === "select" && field.options) {
    return (
      <div className="space-y-1.5">
        <Label className="text-xs">{field.label}</Label>
        <Select value={value || ""} onValueChange={onChange}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder={`Select ${field.label}`} />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  if (field.inputType === "textarea") {
    return (
      <div className="space-y-1.5">
        <Label className="text-xs">{field.label}</Label>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          rows={5}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-ring resize-none font-mono"
        />
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{field.label}</Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder}
        className="h-8 text-xs"
      />
    </div>
  );
}
