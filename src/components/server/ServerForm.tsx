import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TestConnectionButton } from "./TestConnectionButton";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import type { ServerCredentialRow } from "@/types/db";
import type {
  ServerProtocol,
  ServerEnvironment,
  AuthType,
} from "@/types/server";
import {
  DEFAULT_PORTS,
  ENVIRONMENT_LABELS,
} from "@/types/server";
import { useServerStore } from "@/stores/serverStore";
import * as projectQueries from "@/db/queries/projects";
import type { ProjectRow } from "@/types/db";

const COLORS = [
  "#ef4444", "#f97316", "#f59e0b", "#22c55e",
  "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899", "#6b7280",
];

interface ServerFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId?: string | null;
  server?: ServerCredentialRow | null;
}

export function ServerForm({
  open: isOpen,
  onOpenChange,
  projectId,
  server,
}: ServerFormProps) {
  const { createServer, updateServer, pemKeys, loadPemKeys } = useServerStore();

  const [name, setName] = useState("");
  const [environment, setEnvironment] = useState<ServerEnvironment>("development");
  const [color, setColor] = useState("#3b82f6");
  const [protocol, setProtocol] = useState<ServerProtocol>("ssh");
  const [host, setHost] = useState("");
  const [port, setPort] = useState(22);
  const [username, setUsername] = useState("");
  const [authType, setAuthType] = useState<AuthType>("password");
  const [password, setPassword] = useState("");
  const [pemKeyId, setPemKeyId] = useState<string | null>(null);
  const [pemFilePath, setPemFilePath] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [initialDirectory, setInitialDirectory] = useState("/");
  const [saving, setSaving] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(projectId ?? null);
  const [projects, setProjects] = useState<ProjectRow[]>([]);

  // For test connection with PEM content
  const [pemContentForTest, setPemContentForTest] = useState("");

  useEffect(() => {
    if (isOpen) {
      loadPemKeys();
      // Load projects for the project picker (only in global context)
      if (!projectId) {
        projectQueries.getProjects().then(setProjects).catch(() => {});
      }
      if (server) {
        setName(server.name);
        setEnvironment(server.environment as ServerEnvironment);
        setColor(server.color ?? "#6b7280");
        setProtocol(server.protocol as ServerProtocol);
        setHost(server.host);
        setPort(server.port);
        setUsername(server.username);
        setAuthType(server.auth_type as AuthType);
        setPemKeyId(server.pem_key_id ?? null);
        setPemFilePath(server.pem_file_path ?? "");
        setInitialDirectory(server.initial_directory ?? "/");
        setSelectedProjectId(server.project_id ?? null);
        setPassword("");
        setPassphrase("");
        setPemContentForTest("");
      } else {
        setName("");
        setEnvironment("development");
        setColor("#3b82f6");
        setProtocol("ssh");
        setHost("");
        setPort(22);
        setUsername("");
        setAuthType("password");
        setPassword("");
        setPemKeyId(null);
        setPemFilePath("");
        setPassphrase("");
        setInitialDirectory("/");
        setSelectedProjectId(projectId ?? null);
        setPemContentForTest("");
      }
    }
  }, [isOpen, server]);

  const handleProtocolChange = (p: ServerProtocol) => {
    setProtocol(p);
    setPort(DEFAULT_PORTS[p]);
    if (p !== "ssh") {
      setAuthType("password");
    }
  };

  const handleBrowsePem = async () => {
    const selected = await open({
      title: "Select PEM Key File",
      filters: [{ name: "Key Files", extensions: ["pem", "key", "ppk"] }],
    });
    if (selected) {
      setPemFilePath(selected as string);
      try {
        const content = await readTextFile(selected as string);
        setPemContentForTest(content);
      } catch {
        // ignore
      }
    }
  };

  const handleSubmit = async () => {
    if (!name.trim() || !host.trim() || !username.trim() || saving) return;
    setSaving(true);
    // Close dialog immediately for snappy UX
    onOpenChange(false);
    try {
      if (server) {
        // Update
        await updateServer(server.id, {
          name: name.trim(),
          environment,
          color,
          protocol,
          host: host.trim(),
          port,
          username: username.trim(),
          auth_type: authType,
          pem_key_id: authType === "pem_saved" ? pemKeyId : null,
          pem_file_path: authType === "pem_file" || authType === "pem_passphrase" ? pemFilePath : null,
          initial_directory: initialDirectory.trim() || "/",
        });
        // Update password/passphrase in keychain if provided
        if (password) {
          await invoke("save_server_password", { serverId: server.id, password });
        }
        if (passphrase && (authType === "pem_passphrase")) {
          await invoke("save_server_passphrase", { serverId: server.id, passphrase });
        }
      } else {
        // Create
        const resolvedProjectId = projectId ?? selectedProjectId ?? null;
        const created = await createServer({
          project_id: resolvedProjectId,
          name: name.trim(),
          environment,
          color,
          protocol,
          host: host.trim(),
          port,
          username: username.trim(),
          auth_type: authType,
          pem_key_id: authType === "pem_saved" ? pemKeyId : null,
          pem_file_path: authType === "pem_file" || authType === "pem_passphrase" ? pemFilePath : null,
          initial_directory: initialDirectory.trim() || "/",
        });
        // Save password to keychain
        if (password && authType === "password") {
          await invoke("save_server_password", { serverId: created.id, password });
        }
        if (passphrase && authType === "pem_passphrase") {
          await invoke("save_server_passphrase", { serverId: created.id, passphrase });
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{server ? "Edit Server" : "Add Server"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Name */}
          <div className="space-y-1.5">
            <Label className="text-xs">Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Production, Staging"
            />
          </div>

          {/* Project (only in global context — no projectId prop) */}
          {!projectId && (
            <div className="space-y-1.5">
              <Label className="text-xs">Project (optional)</Label>
              <Select
                value={selectedProjectId ?? "__none__"}
                onValueChange={(v) => setSelectedProjectId(v === "__none__" ? null : v)}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="No project (global)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No project (global)</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Environment + Color */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Environment</Label>
              <Select value={environment} onValueChange={(v) => setEnvironment(v as ServerEnvironment)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.entries(ENVIRONMENT_LABELS) as [ServerEnvironment, string][]).map(
                    ([val, label]) => (
                      <SelectItem key={val} value={val}>
                        {label}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Color</Label>
              <div className="flex flex-wrap gap-1.5">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="h-6 w-6 rounded-full border-2 transition-all"
                    style={{
                      backgroundColor: c,
                      borderColor: color === c ? "white" : "transparent",
                      boxShadow: color === c ? `0 0 0 2px ${c}` : "none",
                    }}
                    onClick={() => setColor(c)}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Protocol + Host + Port */}
          <div className="grid grid-cols-[120px_1fr_80px] gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Protocol</Label>
              <Select value={protocol} onValueChange={(v) => handleProtocolChange(v as ServerProtocol)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ssh">SSH</SelectItem>
                  <SelectItem value="ftp">FTP</SelectItem>
                  <SelectItem value="ftps">FTPS</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Host</Label>
              <Input
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="192.168.1.1 or domain.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Port</Label>
              <Input
                type="number"
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
                min={1}
                max={65535}
              />
            </div>
          </div>

          {/* Username */}
          <div className="space-y-1.5">
            <Label className="text-xs">Username</Label>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="root"
            />
          </div>

          {/* Auth Type */}
          <div className="space-y-1.5">
            <Label className="text-xs">Authentication</Label>
            <Select value={authType} onValueChange={(v) => setAuthType(v as AuthType)}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="password">Password</SelectItem>
                {protocol === "ssh" && (
                  <>
                    <SelectItem value="pem_file">PEM Key File</SelectItem>
                    <SelectItem value="pem_saved">Saved PEM Key</SelectItem>
                    <SelectItem value="pem_passphrase">PEM Key + Passphrase</SelectItem>
                  </>
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Auth fields */}
          {authType === "password" && (
            <div className="space-y-1.5">
              <Label className="text-xs">Password</Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={server ? "Leave empty to keep existing" : "Enter password"}
              />
            </div>
          )}

          {(authType === "pem_file" || authType === "pem_passphrase") && (
            <div className="space-y-1.5">
              <Label className="text-xs">PEM Key File</Label>
              <div className="flex gap-2">
                <Input
                  value={pemFilePath}
                  onChange={(e) => setPemFilePath(e.target.value)}
                  placeholder="/path/to/key.pem"
                  className="flex-1"
                  readOnly
                />
                <Button type="button" variant="outline" size="sm" onClick={handleBrowsePem}>
                  Browse
                </Button>
              </div>
            </div>
          )}

          {authType === "pem_saved" && (
            <div className="space-y-1.5">
              <Label className="text-xs">Saved PEM Key</Label>
              <Select
                value={pemKeyId ?? ""}
                onValueChange={(v) => setPemKeyId(v || null)}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Select a saved key..." />
                </SelectTrigger>
                <SelectContent>
                  {pemKeys.map((k) => (
                    <SelectItem key={k.id} value={k.id}>
                      {k.alias}
                    </SelectItem>
                  ))}
                  {pemKeys.length === 0 && (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      No saved keys. Import one from Settings.
                    </div>
                  )}
                </SelectContent>
              </Select>
            </div>
          )}

          {authType === "pem_passphrase" && (
            <div className="space-y-1.5">
              <Label className="text-xs">Passphrase</Label>
              <Input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Enter passphrase for the PEM key"
              />
            </div>
          )}

          {/* Initial Directory */}
          <div className="space-y-1.5">
            <Label className="text-xs">Initial Directory</Label>
            <Input
              value={initialDirectory}
              onChange={(e) => setInitialDirectory(e.target.value)}
              placeholder="/var/www/html"
            />
          </div>

          {/* Test Connection */}
          <TestConnectionButton
            host={host}
            port={port}
            username={username}
            authType={authType}
            password={authType === "password" ? password : undefined}
            pemContent={pemContentForTest || undefined}
            passphrase={authType === "pem_passphrase" ? passphrase : undefined}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={saving || !name.trim() || !host.trim() || !username.trim()}
          >
            {saving ? "Saving..." : server ? "Save Changes" : "Add Server"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
