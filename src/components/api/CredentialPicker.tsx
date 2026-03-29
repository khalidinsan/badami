import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Key, Lock, Globe, Database, Mail, Server, Smartphone, CreditCard, Settings } from "lucide-react";
import * as credentialQueries from "@/db/queries/credentials";
import type { CredentialRow, CredentialFieldRow } from "@/types/db";
import { CREDENTIAL_FIELD_SCHEMAS } from "@/lib/credentialTypes";
import type { CredentialType } from "@/types/credential";

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Globe,
  Smartphone,
  Key,
  Database,
  Mail,
  CreditCard,
  Lock,
  Settings,
  Server,
};

interface CredentialPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (credential: CredentialRow, fieldKey: string, fieldLabel: string) => void;
}

export function CredentialPicker({ open, onClose, onSelect }: CredentialPickerProps) {
  const [credentials, setCredentials] = useState<CredentialRow[]>([]);
  const [search, setSearch] = useState("");
  const [selectedCredentialId, setSelectedCredentialId] = useState<string | null>(null);
  const [fields, setFields] = useState<CredentialFieldRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setSearch("");
      setSelectedCredentialId(null);
      setFields([]);
      setLoading(true);
      credentialQueries.getAllCredentials().then((creds) => {
        setCredentials(creds);
        setLoading(false);
      });
    }
  }, [open]);

  const handleSelectCredential = useCallback(async (cred: CredentialRow) => {
    setSelectedCredentialId(cred.id);
    const credFields = await credentialQueries.getFieldsByCredential(cred.id);
    setFields(credFields);
  }, []);

  const filteredCredentials = search
    ? credentials.filter(
        (c) =>
          c.name.toLowerCase().includes(search.toLowerCase()) ||
          (c.service_name ?? "").toLowerCase().includes(search.toLowerCase()),
      )
    : credentials;

  const selectedCredential = credentials.find((c) => c.id === selectedCredentialId);

  // Get available fields from schema + actual fields
  const getPickableFields = useCallback(() => {
    if (!selectedCredential) return [];
    const schema = CREDENTIAL_FIELD_SCHEMAS[selectedCredential.type as CredentialType] || [];
    const result: { key: string; label: string; fromSchema: boolean }[] = [];

    // Add schema-defined fields
    for (const s of schema) {
      result.push({ key: s.key, label: s.label, fromSchema: true });
    }

    // Add any actual DB fields that aren't in schema
    for (const f of fields) {
      if (!result.find((r) => r.key === f.field_key)) {
        result.push({ key: f.field_key, label: f.field_label, fromSchema: false });
      }
    }

    return result;
  }, [selectedCredential, fields]);

  const getCredIcon = (iconName: string | undefined) => {
    const Icon = ICON_MAP[iconName ?? ""] ?? Key;
    return Icon;
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md p-0">
        <DialogHeader className="border-b border-border/50 px-4 py-3">
          <DialogTitle className="text-sm">Link from Credentials</DialogTitle>
        </DialogHeader>

        <div className="px-4 py-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search credentials..."
              className="h-8 pl-8 text-xs"
            />
          </div>
        </div>

        <ScrollArea className="max-h-72">
          <div className="space-y-0.5 px-2 pb-3">
            {loading ? (
              <p className="py-6 text-center text-xs text-muted-foreground">Loading...</p>
            ) : filteredCredentials.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
                No credentials found
              </p>
            ) : !selectedCredentialId ? (
              // Step 1: Pick a credential
              filteredCredentials.map((cred) => {
                const Icon = getCredIcon(
                  cred.type === "web_login" ? "Globe" :
                  cred.type === "api_key" ? "Key" :
                  cred.type === "database" ? "Database" :
                  cred.type === "email" ? "Mail" :
                  cred.type === "server_access" ? "Server" :
                  cred.type === "app_account" ? "Smartphone" :
                  cred.type === "license" ? "CreditCard" :
                  cred.type === "secure_note" ? "Lock" :
                  cred.type === "env_vars" ? "Settings" : "Key"
                );
                return (
                  <button
                    key={cred.id}
                    onClick={() => handleSelectCredential(cred)}
                    className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-xs transition-colors hover:bg-accent"
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{cred.name}</p>
                      {cred.service_name && (
                        <p className="truncate text-[10px] text-muted-foreground">{cred.service_name}</p>
                      )}
                    </div>
                    {cred.environment && cred.environment !== "none" && (
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] capitalize text-muted-foreground">
                        {cred.environment}
                      </span>
                    )}
                  </button>
                );
              })
            ) : (
              // Step 2: Pick a field from selected credential
              <div>
                <button
                  onClick={() => { setSelectedCredentialId(null); setFields([]); }}
                  className="mb-2 flex items-center gap-1.5 px-2 text-[11px] text-[#007AFF] hover:underline"
                >
                  &larr; Back to credentials
                </button>
                <p className="mb-1.5 px-2 text-[11px] font-medium text-muted-foreground">
                  Select field from "{selectedCredential?.name}"
                </p>
                {getPickableFields().map((field) => (
                  <button
                    key={field.key}
                    onClick={() => {
                      if (selectedCredential) {
                        onSelect(selectedCredential, field.key, field.label);
                        onClose();
                      }
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent"
                  >
                    <Lock className="h-3 w-3 text-muted-foreground/50" />
                    <span>{field.label}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">{field.key}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
