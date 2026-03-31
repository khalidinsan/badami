import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Database,
  Shield,
  KeyRound,
  FolderOpen,
  Eye,
  EyeOff,
  Link2,
  KeySquare,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDbConnection } from "@/hooks/useDbConnection";
import { TestConnectionButton, TestConnectionResult } from "@/components/database/TestConnectionButton";
import { CredentialPicker } from "@/components/api/CredentialPicker";
import type { DbConnectionRow, ProjectRow, CredentialRow, ServerCredentialRow } from "@/types/db";
import * as projectQueries from "@/db/queries/projects";
import * as serverQueries from "@/db/queries/servers";
import { open } from "@tauri-apps/plugin-dialog";
import { cn } from "@/lib/utils";

interface ConnectionFormProps {
  connection: DbConnectionRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DEFAULT_PORTS: Record<string, number> = {
  mysql: 3306,
  mariadb: 3306,
  postgresql: 5432,
  sqlite: 0,
};

const CONNECTION_COLORS = [
  "#6b7280",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

export function ConnectionForm({
  connection,
  open: isOpen,
  onOpenChange,
}: ConnectionFormProps) {
  const { createConnection, updateConnection } = useDbConnection();
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [servers, setServers] = useState<ServerCredentialRow[]>([]);
  const [saving, setSaving] = useState(false);

  // Form state
  const [engine, setEngine] = useState(connection?.engine ?? "mysql");
  const [name, setName] = useState(connection?.name ?? "");
  const [host, setHost] = useState(connection?.host ?? "localhost");
  const [port, setPort] = useState(connection?.port ?? 3306);
  const [databaseName, setDatabaseName] = useState(connection?.database_name ?? "");
  const [username, setUsername] = useState(connection?.username ?? "root");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [projectId, setProjectId] = useState(connection?.project_id || "__none__");
  const [color, setColor] = useState(connection?.color ?? "#6b7280");
  const [sqliteFilePath, setSqliteFilePath] = useState(connection?.sqlite_file_path ?? "");

  // Credential link for password
  const [credentialId, setCredentialId] = useState(connection?.credential_id ?? "");
  const [credentialField, setCredentialField] = useState(connection?.credential_field ?? "");
  const [credentialLabel, setCredentialLabel] = useState("");
  const [credPickerOpen, setCredPickerOpen] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; latency_ms: number } | null>(null);
  const [hasSavedPassword, setHasSavedPassword] = useState(false);

  // SSH
  const [useSshTunnel, setUseSshTunnel] = useState(connection?.use_ssh_tunnel === 1);
  const [sshServerId, setSshServerId] = useState(connection?.ssh_server_id ?? "__none__");
  const [sshLocalPort, setSshLocalPort] = useState(connection?.ssh_local_port ?? 3307);

  // SSL
  const [useSsl, setUseSsl] = useState(connection?.use_ssl === 1);
  const [sslMode, setSslMode] = useState(connection?.ssl_mode ?? "prefer");
  const [sslCaPath, setSslCaPath] = useState(connection?.ssl_ca_path ?? "");
  const [sslCertPath, setSslCertPath] = useState(connection?.ssl_cert_path ?? "");
  const [sslKeyPath, setSslKeyPath] = useState(connection?.ssl_key_path ?? "");

  useEffect(() => {
    projectQueries.getProjects("active").then(setProjects).catch(console.error);
    serverQueries.getAllServers().then(setServers).catch(console.error);
  }, []);

  // Check if a password is saved in keychain for this connection
  useEffect(() => {
    if (!connection?.id) return;
    invoke<string>("get_db_password", { connectionId: connection.id })
      .then(() => setHasSavedPassword(true))
      .catch(() => setHasSavedPassword(false));
  }, [connection?.id]);

  // Update port when engine changes (new connection only)
  useEffect(() => {
    if (!connection) {
      setPort(DEFAULT_PORTS[engine] ?? 3306);
      if (engine === "mysql" || engine === "mariadb") {
        setUsername("root");
      } else if (engine === "postgresql") {
        setUsername("postgres");
      }
    }
  }, [engine, connection]);

  const isSqlite = engine === "sqlite";

  const browseSqliteFile = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "SQLite", extensions: ["db", "sqlite", "sqlite3"] }],
    });
    if (selected) {
      setSqliteFilePath(selected as string);
      if (!name) setName((selected as string).split("/").pop() ?? "");
    }
  };

  const browseFile = async (
    setter: (v: string) => void,
    exts: string[] = ["pem", "crt", "key", "cer"],
  ) => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Certificate", extensions: exts }],
    });
    if (selected) setter(selected as string);
  };

  const handleCredentialSelect = (cred: CredentialRow, fieldKey: string, fieldLabel: string) => {
    setCredentialId(cred.id);
    setCredentialField(fieldKey);
    setCredentialLabel(`${cred.name} → ${fieldLabel}`);
    setPassword("");
    setCredPickerOpen(false);
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const data = {
        name: name.trim(),
        engine,
        project_id: projectId === "__none__" ? null : projectId || null,
        host: isSqlite ? null : host || null,
        port: isSqlite ? null : port,
        database_name: isSqlite ? null : databaseName || null,
        username: isSqlite ? null : username || null,
        credential_id: credentialId || null,
        credential_field: credentialField || null,
        use_ssh_tunnel: useSshTunnel ? 1 : 0,
        ssh_server_id: useSshTunnel && sshServerId !== "__none__" ? sshServerId : null,
        ssh_local_port: useSshTunnel ? sshLocalPort : null,
        use_ssl: useSsl ? 1 : 0,
        ssl_mode: useSsl ? sslMode : "prefer",
        ssl_ca_path: useSsl ? sslCaPath || null : null,
        ssl_cert_path: useSsl ? sslCertPath || null : null,
        ssl_key_path: useSsl ? sslKeyPath || null : null,
        sqlite_file_path: isSqlite ? sqliteFilePath || null : null,
        color,
      };

      if (connection) {
        await updateConnection(connection.id, data);
        // Save password to keychain if provided
        if (!credentialId && password) {
          await invoke("save_db_password", { connectionId: connection.id, password });
          setHasSavedPassword(true);
        }
      } else {
        const created = await createConnection(data);
        if (!credentialId && password) {
          await invoke("save_db_password", { connectionId: created.id, password });
        }
      }
      onOpenChange(false);
    } catch {
      // Handled by store
    } finally {
      setSaving(false);
    }
  };

  const handleClearSavedPassword = async () => {
    if (!connection?.id) return;
    await invoke("delete_db_password", { connectionId: connection.id }).catch(() => {});
    setHasSavedPassword(false);
    setPassword("");
  };

  const testParams = {
    connection_id: connection?.id ?? "test",
    engine,
    host: isSqlite ? null : host,
    port: isSqlite ? null : port,
    database_name: isSqlite ? null : databaseName,
    username: isSqlite ? null : username,
    password: password || null,
    credential_id: credentialId || null,
    credential_field: credentialField || null,
    sqlite_file_path: isSqlite ? sqliteFilePath : null,
    use_ssl: useSsl,
    ssl_mode: useSsl ? sslMode : undefined,
    ssl_ca_path: useSsl ? sslCaPath : undefined,
    tunnel_local_port: useSshTunnel ? sshLocalPort : undefined,
    // signal TestConnectionButton to fetch from keychain if no explicit password
    _has_saved_password: !password && !credentialId && hasSavedPassword,
  };

  return (
    <>
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {connection ? "Edit Connection" : "New Connection"}
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="general" className="mt-2">
          <TabsList className="w-full">
            <TabsTrigger value="general" className="flex-1 gap-1.5">
              <Database className="h-3.5 w-3.5" />
              General
            </TabsTrigger>
            {!isSqlite && (
              <>
                <TabsTrigger value="ssh" className="flex-1 gap-1.5">
                  <KeyRound className="h-3.5 w-3.5" />
                  SSH Tunnel
                </TabsTrigger>
                <TabsTrigger value="ssl" className="flex-1 gap-1.5">
                  <Shield className="h-3.5 w-3.5" />
                  SSL / TLS
                </TabsTrigger>
              </>
            )}
          </TabsList>

          <TabsContent value="general" className="space-y-4 pt-4">
            {/* Engine */}
            <div className="space-y-1.5">
              <Label>Engine</Label>
              <Select value={engine} onValueChange={setEngine}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mysql">MySQL</SelectItem>
                  <SelectItem value="mariadb">MariaDB</SelectItem>
                  <SelectItem value="postgresql">PostgreSQL</SelectItem>
                  <SelectItem value="sqlite">SQLite</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Name + Color */}
            <div className="flex gap-3">
              <div className="flex-1 space-y-1.5">
                <Label>Connection Name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="DB Production"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Color</Label>
                <div className="flex flex-wrap gap-1.5">
                  {CONNECTION_COLORS.map((c) => (
                    <button
                      key={c}
                      className={cn(
                        "h-6 w-6 rounded-full transition-transform",
                        color === c && "ring-2 ring-offset-2 ring-[#007AFF] scale-110",
                      )}
                      style={{ backgroundColor: c }}
                      onClick={() => setColor(c)}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* Project */}
            <div className="space-y-1.5">
              <Label>Project (Optional)</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger>
                  <SelectValue placeholder="No project" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No project</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {isSqlite ? (
              /* SQLite: File path */
              <div className="space-y-1.5">
                <Label>Database File</Label>
                <div className="flex gap-2">
                  <Input
                    value={sqliteFilePath}
                    onChange={(e) => setSqliteFilePath(e.target.value)}
                    placeholder="/path/to/database.db"
                    className="flex-1"
                  />
                  <Button variant="outline" size="sm" onClick={browseSqliteFile}>
                    <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
                    Browse
                  </Button>
                </div>
              </div>
            ) : (
              /* MySQL/PG: Host, Port, DB, Username, Password */
              <>
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2 space-y-1.5">
                    <Label>Host</Label>
                    <Input value={host} onChange={(e) => setHost(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Port</Label>
                    <Input
                      type="number"
                      value={port}
                      onChange={(e) => setPort(Number(e.target.value))}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Database</Label>
                  <Input
                    value={databaseName}
                    onChange={(e) => setDatabaseName(e.target.value)}
                    placeholder="myapp"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Username</Label>
                  <Input value={username} onChange={(e) => setUsername(e.target.value)} />
                </div>
                {/* Password */}
                <div className="space-y-1.5">
                  <Label>Password</Label>
                  {credentialId ? (
                    <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-sm">
                      <Link2 className="h-3.5 w-3.5 shrink-0 text-primary" />
                      <span className="flex-1 truncate text-xs text-muted-foreground">{credentialLabel}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={() => { setCredentialId(""); setCredentialField(""); setCredentialLabel(""); }}
                      >
                        Clear
                      </Button>
                    </div>
                  ) : (
                    <>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Input
                          type={showPassword ? "text" : "password"}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder={
                            hasSavedPassword && !password
                              ? "(saved in keychain)"
                              : connection
                              ? "Leave empty to keep existing"
                              : "Enter password"
                          }
                          className="pr-9"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((v) => !v)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCredPickerOpen(true)}
                      >
                        <Link2 className="mr-1.5 h-3.5 w-3.5" />
                        Credential
                      </Button>
                    </div>
                    {hasSavedPassword && !password && !credentialId && (
                      <div className="flex items-center justify-between rounded-md border border-green-500/30 bg-green-500/10 px-2.5 py-1.5 text-xs">
                        <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
                          <KeySquare className="h-3.5 w-3.5" />
                          Password saved in keychain
                        </div>
                        <button
                          type="button"
                          onClick={handleClearSavedPassword}
                          className="flex items-center gap-1 text-muted-foreground hover:text-destructive"
                        >
                          <X className="h-3 w-3" />
                          Clear
                        </button>
                      </div>
                    )}
                    </>
                  )}
                </div>
              </>
            )}
          </TabsContent>

          {!isSqlite && (
            <TabsContent value="ssh" className="space-y-4 pt-4">
              <div className="flex items-center justify-between">
                <Label>Use SSH Tunnel</Label>
                <Switch checked={useSshTunnel} onCheckedChange={setUseSshTunnel} />
              </div>
              {useSshTunnel && (
                <div className="space-y-3">
                  {/* SSH Server picker */}
                  <div className="space-y-1.5">
                    <Label>SSH Server</Label>
                    <Select value={sshServerId} onValueChange={setSshServerId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a server..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— Select server —</SelectItem>
                        {servers.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name} ({s.username}@{s.host}:{s.port})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-[11px] text-muted-foreground">
                      Pick a server from the Servers module. The SSH session will forward the local port to the DB port.
                    </p>
                  </div>

                  {servers.length === 0 && (
                    <p className="rounded-md border border-dashed border-border/60 px-3 py-2 text-xs text-muted-foreground">
                      No servers found. Add a server in the Servers module first.
                    </p>
                  )}

                  <div className="space-y-1.5">
                    <Label>Local Port (forwarded)</Label>
                    <Input
                      type="number"
                      value={sshLocalPort}
                      onChange={(e) => setSshLocalPort(Number(e.target.value))}
                    />
                  </div>
                </div>
              )}
            </TabsContent>
          )}

          {!isSqlite && (
            <TabsContent value="ssl" className="space-y-4 pt-4">
              <div className="flex items-center justify-between">
                <Label>Use SSL / TLS</Label>
                <Switch checked={useSsl} onCheckedChange={setUseSsl} />
              </div>
              {useSsl && (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label>SSL Mode</Label>
                    <Select value={sslMode} onValueChange={setSslMode}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="prefer">Prefer</SelectItem>
                        <SelectItem value="require">Require</SelectItem>
                        <SelectItem value="verify-ca">Verify CA</SelectItem>
                        <SelectItem value="verify-full">Verify Full</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>CA Certificate</Label>
                    <div className="flex gap-2">
                      <Input value={sslCaPath} onChange={(e) => setSslCaPath(e.target.value)} className="flex-1" />
                      <Button variant="outline" size="sm" onClick={() => browseFile(setSslCaPath)}>
                        Browse
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Client Certificate</Label>
                    <div className="flex gap-2">
                      <Input value={sslCertPath} onChange={(e) => setSslCertPath(e.target.value)} className="flex-1" />
                      <Button variant="outline" size="sm" onClick={() => browseFile(setSslCertPath)}>
                        Browse
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Client Key</Label>
                    <div className="flex gap-2">
                      <Input value={sslKeyPath} onChange={(e) => setSslKeyPath(e.target.value)} className="flex-1" />
                      <Button variant="outline" size="sm" onClick={() => browseFile(setSslKeyPath)}>
                        Browse
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </TabsContent>
          )}
        </Tabs>

        {/* Footer */}
        <div className="flex flex-col gap-2 border-t pt-4">
          {testResult && <TestConnectionResult result={testResult} />}
          <div className="flex items-center justify-between">
            <TestConnectionButton params={testParams} onResult={setTestResult} />
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving || !name.trim()}>
                {saving ? "Saving..." : connection ? "Save" : "Add Connection"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    <CredentialPicker
      open={credPickerOpen}
      onClose={() => setCredPickerOpen(false)}
      onSelect={handleCredentialSelect}
    />
    </>
  );
}
