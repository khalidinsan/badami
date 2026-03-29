import { useState, useEffect, useCallback } from "react";
import {
  Globe,
  Smartphone,
  Key,
  Database,
  Mail,
  CreditCard,
  Lock,
  Settings,
  Server,
  ArrowLeft,
  Pencil,
  ExternalLink,
  Download,
  Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { SensitiveField } from "./SensitiveField";
import { CopyButton } from "./CopyButton";
import { ExpiryBadge } from "./ExpiryBadge";
import { TotpDisplay } from "./TotpDisplay";
import { useCredentials } from "@/hooks/useCredentials";
import type { CredentialRow, CredentialFieldRow, CredentialTotpRow, CredentialEnvVarRow } from "@/types/db";
import type { CredentialType, CredentialEnvironment } from "@/types/credential";
import {
  CREDENTIAL_TYPE_LABELS,
  ENVIRONMENT_LABELS,
  ENVIRONMENT_COLORS,
} from "@/types/credential";
import * as credentialQueries from "@/db/queries/credentials";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { openInOS } from "@/lib/osOpen";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";

dayjs.extend(relativeTime);

const ICON_MAP: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  Globe, Smartphone, Key, Database, Mail, CreditCard, Lock, Settings, Server,
};

const TYPE_ICON_NAMES: Record<CredentialType, string> = {
  web_login: "Globe",
  app_account: "Smartphone",
  api_key: "Key",
  database: "Database",
  email: "Mail",
  license: "CreditCard",
  secure_note: "Lock",
  env_vars: "Settings",
  server_access: "Server",
};

interface CredentialDetailProps {
  credential: CredentialRow;
  onBack: () => void;
  onEdit: (credential: CredentialRow) => void;
}

export function CredentialDetail({
  credential,
  onBack,
  onEdit,
}: CredentialDetailProps) {
  const { decryptField, copyToClipboard, copyPlainToClipboard } =
    useCredentials();

  const [fields, setFields] = useState<CredentialFieldRow[]>([]);
  const [envVars, setEnvVars] = useState<CredentialEnvVarRow[]>([]);
  const [totp, setTotp] = useState<CredentialTotpRow | null>(null);
  const [decryptedValues, setDecryptedValues] = useState<Record<string, string>>({});
  const [decryptedEnvValues, setDecryptedEnvValues] = useState<Record<string, string>>({});
  const [decrypting, setDecrypting] = useState(true);

  const type = credential.type as CredentialType;
  const env = (credential.environment ?? "none") as CredentialEnvironment;
  const envColor = ENVIRONMENT_COLORS[env];
  const iconName = TYPE_ICON_NAMES[type] ?? "Key";
  const Icon = ICON_MAP[iconName] ?? Key;

  // Load fields & totp
  useEffect(() => {
    setDecrypting(true);
    (async () => {
      const [f, t] = await Promise.all([
        credentialQueries.getFieldsByCredential(credential.id),
        credentialQueries.getTotpByCredential(credential.id),
      ]);
      setFields(f);
      setTotp(t ?? null);

      // Decrypt sensitive fields
      const decrypted: Record<string, string> = {};
      for (const field of f) {
        if (field.is_sensitive === 1 && field.encrypted_value && field.iv) {
          try {
            decrypted[field.id] = await decryptField(
              field.encrypted_value,
              field.iv,
            );
          } catch {
            decrypted[field.id] = "••••••••";
          }
        }
      }
      setDecryptedValues(decrypted);

      // Load env vars
      if (credential.type === "env_vars") {
        const vars = await credentialQueries.getEnvVarsByCredential(credential.id);
        setEnvVars(vars);
        const dEnv: Record<string, string> = {};
        for (const v of vars) {
          try {
            dEnv[v.id] = await decryptField(
              v.encrypted_value,
              v.iv,
            );
          } catch {
            dEnv[v.id] = "••••••••";
          }
        }
        setDecryptedEnvValues(dEnv);
      }

      setDecrypting(false);
    })();
  }, [credential.id, credential.type, decryptField]);

  const handleCopyField = useCallback(
    async (field: CredentialFieldRow) => {
      if (field.is_sensitive === 1 && field.encrypted_value && field.iv) {
        await copyToClipboard(
          field.encrypted_value,
          field.iv,
        );
      } else if (field.plain_value) {
        await copyPlainToClipboard(field.plain_value);
      }
    },
    [copyToClipboard, copyPlainToClipboard],
  );

  const tags = credential.tags ? JSON.parse(credential.tags) as string[] : [];

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/40 px-6 py-4">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onBack}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div
            className="flex h-9 w-9 items-center justify-center rounded-lg"
            style={{ backgroundColor: `${envColor}15` }}
          >
            <Icon className="h-4.5 w-4.5" style={{ color: envColor }} />
          </div>
          <div>
            <h2 className="text-base font-semibold">{credential.name}</h2>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {CREDENTIAL_TYPE_LABELS[type]}
              </span>
              {env !== "none" && (
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0"
                  style={{ borderColor: `${envColor}40`, color: envColor }}
                >
                  {ENVIRONMENT_LABELS[env]}
                </Badge>
              )}
            </div>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 text-xs"
          onClick={() => onEdit(credential)}
        >
          <Pencil className="h-3.5 w-3.5" />
          Edit
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-6 py-4 space-y-4">
        {decrypting ? (
          <div className="flex items-center justify-center py-12">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary" />
              Decrypting fields...
            </div>
          </div>
        ) : (
        <>
        {/* Fields */}
        {fields.map((field) => (
          <div key={field.id} className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                {field.field_label}
              </span>
              <div className="flex items-center gap-0.5">
                {/* Open URL button */}
                {field.field_key === "url" && field.plain_value && (
                  <button
                    type="button"
                    onClick={() => openInOS(field.plain_value!)}
                    className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </button>
                )}
                <CopyButton
                  onCopy={() => handleCopyField(field)}
                  label={field.field_label}
                />
              </div>
            </div>
            {field.is_sensitive === 1 ? (
              <SensitiveField
                label=""
                value={decryptedValues[field.id] ?? "••••••••"}
                readOnly
              />
            ) : (
              <p className="text-sm font-mono">{field.plain_value ?? "—"}</p>
            )}
          </div>
        ))}

        {/* Env vars */}
        {credential.type === "env_vars" && envVars.length > 0 && (
          <>
            <Separator />
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Variables
                </h3>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 text-[10px]"
                    onClick={async () => {
                      const content = await buildEnvString(envVars, decryptField);
                      await invoke("credential_copy_plain_to_clipboard", { value: content });
                      toast.success("Copied as .env");
                    }}
                  >
                    <Copy className="h-3 w-3" />
                    Copy .env
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 text-[10px]"
                    onClick={async () => {
                      const content = await buildEnvString(envVars, decryptField);
                      const filePath = await save({
                        defaultPath: `.env.${credential.environment ?? "local"}`,
                        filters: [{ name: "Env", extensions: ["env", "txt"] }],
                      });
                      if (filePath) {
                        await writeTextFile(filePath, content);
                        toast.success("Exported .env file");
                      }
                    }}
                  >
                    <Download className="h-3 w-3" />
                    Export
                  </Button>
                </div>
              </div>
              {envVars.map((v) => (
                <div
                  key={v.id}
                  className="flex items-center justify-between rounded-lg border border-border/40 px-3 py-2"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono font-semibold text-primary">
                      {v.var_key}
                    </span>
                    <span className="text-xs font-mono text-muted-foreground">
                      = {decryptedEnvValues[v.id] ? "••••••" : "—"}
                    </span>
                  </div>
                  <CopyButton
                    onCopy={() =>
                      copyToClipboard(
                        v.encrypted_value,
                        v.iv,
                      )
                    }
                    label={v.var_key}
                  />
                </div>
              ))}
            </div>
          </>
        )}

        {/* TOTP */}
        {totp && (
          <>
            <Separator />
            <TotpDisplay totp={totp} />
          </>
        )}

        {/* Tags */}
        {tags.length > 0 && (
          <>
            <Separator />
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag: string) => (
                <Badge key={tag} variant="secondary" className="text-[10px]">
                  {tag}
                </Badge>
              ))}
            </div>
          </>
        )}

        {/* Expiry */}
        {credential.expires_at && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">Expires:</span>
            <ExpiryBadge expiresAt={credential.expires_at} />
            <span className="text-xs text-muted-foreground">
              {dayjs(credential.expires_at).format("MMM D, YYYY")}
            </span>
          </div>
        )}

        {/* Notes */}
        {credential.notes && (
          <>
            <Separator />
            <div className="space-y-1">
              <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                Notes
              </span>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                {credential.notes}
              </p>
            </div>
          </>
        )}

        {/* Meta */}
        <Separator />
        <div className="text-[11px] text-muted-foreground space-y-0.5">
          <p>Created {dayjs(credential.created_at).fromNow()}</p>
          <p>Updated {dayjs(credential.updated_at).fromNow()}</p>
        </div>
        </>
        )}
      </div>
    </div>
  );
}

async function buildEnvString(
  envVars: CredentialEnvVarRow[],
  decryptField: (enc: unknown, iv: unknown) => Promise<string>,
): Promise<string> {
  const lines: string[] = [];
  for (const v of envVars) {
    try {
      const val = await decryptField(
        v.encrypted_value,
        v.iv,
      );
      lines.push(`${v.var_key}=${val}`);
    } catch {
      lines.push(`${v.var_key}=`);
    }
  }
  return lines.join("\n") + "\n";
}
