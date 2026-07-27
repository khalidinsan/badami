import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Settings, Timer, Monitor, Rocket, Moon, Sun, KeyRound, Terminal, FolderOpen, Lock, ShieldCheck, RefreshCw, Bot, Download } from "lucide-react";
import { UpdateChecker } from "@/components/updater/UpdateChecker";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useSettingsStore } from "@/stores/settingsStore";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import { PemKeyManager } from "@/components/server/PemKeyManager";
import { useMasterPassword } from "@/hooks/useMasterPassword";
import { useVault } from "@/hooks/useVault";
import { SyncSettingsPanel } from "@/components/sync/SyncSettingsPanel";
import { useOpenRouterModels } from "@/hooks/useOpenRouterModels";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/settings/")({
  component: () => null,
});

const SECTIONS = [
  { id: "appearance", label: "Appearance", icon: Monitor },
  { id: "pomodoro", label: "Pomodoro", icon: Timer },
  { id: "today", label: "Today Window", icon: Monitor },
  { id: "system", label: "System", icon: Rocket },
  { id: "updates", label: "Updates", icon: Download },
  { id: "terminal", label: "SSH Terminal", icon: Terminal },
  { id: "filemanager", label: "File Manager", icon: FolderOpen },
  { id: "ai", label: "AI Assistant", icon: Bot },
  { id: "sync", label: "Cloud Sync", icon: RefreshCw },
  { id: "vault", label: "Credential Vault", icon: Lock },
  { id: "pem", label: "PEM Keys", icon: KeyRound },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

export function SettingsPage() {
  const { loaded, loadSettings, getSetting, setSetting } = useSettingsStore();
  const [autostartEnabled, setAutostartEnabled] = useState(false);
  const [activeSection, setActiveSection] = useState<SectionId>("appearance");

  useEffect(() => {
    if (!loaded) loadSettings();
    isEnabled().then(setAutostartEnabled).catch(() => {});
  }, [loaded]);

  const theme = getSetting("app_theme", "dark");
  const workMin = getSetting("pomodoro_work_min", "25");
  const breakMin = getSetting("pomodoro_break_min", "5");
  const alwaysOnTop = getSetting("today_window_always_on_top", "true");
  const closeToTray = getSetting("close_to_tray", "true");
  const showDockIcon = getSetting("show_dock_icon", "true");

  const handleThemeChange = async (newTheme: string) => {
    await setSetting("app_theme", newTheme);
    localStorage.setItem("app_theme", newTheme);
    const root = document.documentElement;
    if (newTheme === "dark") root.classList.add("dark");
    else if (newTheme === "light") root.classList.remove("dark");
    else root.classList.toggle("dark", window.matchMedia("(prefers-color-scheme: dark)").matches);
  };

  const handleAutostartToggle = async (enabled: boolean) => {
    try {
      if (enabled) await enable(); else await disable();
      setAutostartEnabled(enabled);
    } catch {}
  };

  return (
    <div className="flex h-full">
      {/* Sidebar nav */}
      <div className="w-[180px] shrink-0 border-r border-border/40 py-4 px-2">
        <div className="mb-4 px-2 flex items-center gap-2">
          <Settings className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Settings</span>
        </div>
        <nav className="space-y-0.5">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            return (
              <button
                key={s.id}
                onClick={() => setActiveSection(s.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-colors",
                  activeSection === s.id
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {s.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Content area */}
      <ScrollArea className="flex-1">
        <div className="max-w-xl px-6 py-6">
          {activeSection === "appearance" && (
            <Section title="Appearance" icon={Monitor}>
              <div className="flex items-center gap-3">
                {(["light", "dark", "system"] as const).map((t) => (
                  <Button key={t} variant={theme === t ? "default" : "outline"} size="sm" className="gap-2" onClick={() => handleThemeChange(t)}>
                    {t === "light" && <Sun className="h-3.5 w-3.5" />}
                    {t === "dark" && <Moon className="h-3.5 w-3.5" />}
                    {t === "system" && <Monitor className="h-3.5 w-3.5" />}
                    <span className="capitalize">{t}</span>
                  </Button>
                ))}
              </div>
            </Section>
          )}

          {activeSection === "pomodoro" && (
            <Section title="Pomodoro Timer" icon={Timer}>
              <Row label="Work duration (min)">
                <Input type="number" min={1} max={120} value={workMin} onChange={(e) => setSetting("pomodoro_work_min", e.target.value)} className="w-20 text-center" />
              </Row>
              <Separator />
              <Row label="Break duration (min)">
                <Input type="number" min={1} max={60} value={breakMin} onChange={(e) => setSetting("pomodoro_break_min", e.target.value)} className="w-20 text-center" />
              </Row>
            </Section>
          )}

          {activeSection === "today" && (
            <Section title="Today Window" icon={Monitor}>
              <Row label="Always on top by default">
                <Switch checked={alwaysOnTop === "true"} onCheckedChange={(c) => setSetting("today_window_always_on_top", c ? "true" : "false")} />
              </Row>
            </Section>
          )}

          {activeSection === "system" && (
            <Section title="System" icon={Rocket}>
              <Row label="Launch at login" desc="Automatically start Badami when you log in">
                <Switch checked={autostartEnabled} onCheckedChange={handleAutostartToggle} />
              </Row>
              <Separator />
              <Row label="Close to system tray" desc="Keep app running in background when window is closed">
                <Switch checked={closeToTray === "true"} onCheckedChange={(c) => setSetting("close_to_tray", c ? "true" : "false")} />
              </Row>
              <Separator />
              <Row label="Show app in Dock" desc="Display Badami icon in the macOS Dock">
                <Switch checked={showDockIcon === "true"} onCheckedChange={(c) => setSetting("show_dock_icon", c ? "true" : "false")} />
              </Row>
            </Section>
          )}

          {activeSection === "updates" && (
            <Section title="Updates" icon={Download}>
              <p className="text-xs text-muted-foreground">
                Badami checks{" "}
                <a
                  href="https://github.com/khalidinsan/badami/releases"
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline"
                >
                  GitHub Releases
                </a>{" "}
                for signed builds produced by CI. Download & install restarts the app.
              </p>
              <Separator />
              <UpdateChecker compact />
            </Section>
          )}

          {activeSection === "terminal" && <TerminalSection />}
          {activeSection === "filemanager" && <FileManagerSection />}
          {activeSection === "ai" && <AiSection />}
          {activeSection === "sync" && (
            <Section title="Cross-Device Sync" icon={RefreshCw}>
              <SyncSettingsPanel />
            </Section>
          )}
          {activeSection === "vault" && <VaultSecuritySection />}
          {activeSection === "pem" && (
            <Section title="PEM Keys" icon={KeyRound}>
              <PemKeyManager />
            </Section>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ─── Shared layout helpers ──────────────────────────────────────────

function Section({ title, icon: Icon, children }: { title: string; icon: typeof Monitor; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        <Icon className="h-4 w-4" />
        {title}
      </h2>
      <div className="space-y-4 rounded-xl border border-border/60 bg-card p-4">
        {children}
      </div>
    </div>
  );
}

function Row({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <Label className="text-sm">{label}</Label>
        {desc && <p className="text-xs text-muted-foreground">{desc}</p>}
      </div>
      {children}
    </div>
  );
}

// ─── Terminal Section ───────────────────────────────────────────────

function TerminalSection() {
  const { getSetting, setSetting } = useSettingsStore();
  return (
    <Section title="SSH Terminal" icon={Terminal}>
      <Row label="Font size">
        <Input type="number" min={8} max={32} value={getSetting("ssh_terminal_font_size", "13")} onChange={(e) => setSetting("ssh_terminal_font_size", e.target.value)} className="w-20 text-center" />
      </Row>
      <Separator />
      <Row label="Font family">
        <Input value={getSetting("ssh_terminal_font_family", "JetBrains Mono")} onChange={(e) => setSetting("ssh_terminal_font_family", e.target.value)} className="w-48" />
      </Row>
      <Separator />
      <Row label="Terminal theme">
        <Select value={getSetting("ssh_terminal_theme", "dark")} onValueChange={(v) => setSetting("ssh_terminal_theme", v)}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="dark">Dark</SelectItem>
            <SelectItem value="light">Light</SelectItem>
            <SelectItem value="monokai">Monokai</SelectItem>
            <SelectItem value="nord">Nord</SelectItem>
          </SelectContent>
        </Select>
      </Row>
      <Separator />
      <Row label="Auto reconnect" desc="Automatically reconnect on connection drop">
        <Switch checked={getSetting("ssh_auto_reconnect", "false") === "true"} onCheckedChange={(c) => setSetting("ssh_auto_reconnect", c ? "true" : "false")} />
      </Row>
      {getSetting("ssh_auto_reconnect", "false") === "true" && (
        <>
          <Separator />
          <Row label="Max reconnect attempts">
            <Input type="number" min={1} max={20} value={getSetting("ssh_auto_reconnect_max_attempts", "5")} onChange={(e) => setSetting("ssh_auto_reconnect_max_attempts", e.target.value)} className="w-20 text-center" />
          </Row>
          <Separator />
          <Row label="Keepalive interval (sec)">
            <Input type="number" min={5} max={300} value={getSetting("ssh_keepalive_interval", "30")} onChange={(e) => setSetting("ssh_keepalive_interval", e.target.value)} className="w-20 text-center" />
          </Row>
        </>
      )}
    </Section>
  );
}

// ─── File Manager Section ───────────────────────────────────────────

function FileManagerSection() {
  const { getSetting, setSetting } = useSettingsStore();
  return (
    <Section title="File Manager" icon={FolderOpen}>
      <Row label="Show hidden files" desc="Display dotfiles by default">
        <Switch checked={getSetting("file_manager_show_hidden", "false") === "true"} onCheckedChange={(c) => setSetting("file_manager_show_hidden", c ? "true" : "false")} />
      </Row>
      <Separator />
      <Row label="Default local path">
        <Input value={getSetting("file_manager_default_local_path", "~/Downloads")} onChange={(e) => setSetting("file_manager_default_local_path", e.target.value)} className="w-48" placeholder="~/Downloads" />
      </Row>
    </Section>
  );
}

// ─── AI Section ─────────────────────────────────────────────────────

function AiSection() {
  const { getSetting, setSetting } = useSettingsStore();
  return (
    <Section title="AI Assistant" icon={Bot}>
      <div>
        <Label className="text-sm">OpenRouter API Key</Label>
        <p className="text-xs text-muted-foreground">Get your key from <a href="https://openrouter.ai/keys" className="text-primary underline" target="_blank" rel="noreferrer">openrouter.ai/keys</a></p>
      </div>
      <div className="flex items-center gap-2">
        <Input type="password" value={getSetting("openrouter_api_key", "")} onChange={(e) => setSetting("openrouter_api_key", e.target.value)} placeholder="sk-or-v1-..." className="flex-1 font-mono text-xs" />
        <TestApiKeyButton />
      </div>
      <Separator />
      <AiModelSelector />
    </Section>
  );
}

// ─── Test API Key Button ────────────────────────────────────────────

function TestApiKeyButton() {
  const { getSetting } = useSettingsStore();
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<"idle" | "success" | "error">("idle");

  const handleTest = async () => {
    const apiKey = getSetting("openrouter_api_key", "");
    if (!apiKey) { setResult("error"); return; }
    setTesting(true); setResult("idle");
    try {
      const res = await fetch("https://openrouter.ai/api/v1/auth/key", { headers: { Authorization: `Bearer ${apiKey}` } });
      setResult(res.ok ? "success" : "error");
    } catch { setResult("error"); }
    finally { setTesting(false); }
  };

  return (
    <Button variant="outline" size="sm" className={`h-8 text-xs gap-1.5 ${result === "success" ? "border-green-500 text-green-500" : result === "error" ? "border-destructive text-destructive" : ""}`} onClick={handleTest} disabled={testing}>
      {testing ? <RefreshCw className="h-3 w-3 animate-spin" /> : result === "success" ? "✓ Valid" : result === "error" ? "✗ Invalid" : "Test"}
    </Button>
  );
}

// ─── AI Model Selector ──────────────────────────────────────────────

function formatPrice(price: string | undefined): string {
  if (!price) return "—";
  const num = parseFloat(price) * 1_000_000;
  if (num === 0) return "Free";
  if (num < 0.01) return "<$0.01";
  return `$${num.toFixed(2)}`;
}

function AiModelSelector() {
  const { getSetting, setSetting } = useSettingsStore();
  const { models, loading, refresh } = useOpenRouterModels();
  const [search, setSearch] = useState("");

  const defaultModel = getSetting("ai_model", "deepseek/deepseek-v4-flash");
  const activeRaw = getSetting("ai_active_models", "");
  const activeIds = activeRaw ? activeRaw.split(",").map((s) => s.trim()).filter(Boolean) : [];

  // Default is always active
  const allActive = activeIds.includes(defaultModel) ? activeIds : [defaultModel, ...activeIds];

  const toggleActive = (id: string) => {
    // Can't deactivate the default
    if (id === defaultModel) return;
    const updated = activeIds.includes(id)
      ? activeIds.filter((m) => m !== id)
      : [...activeIds, id];
    setSetting("ai_active_models", updated.join(","));
  };

  const setDefault = (id: string) => {
    setSetting("ai_model", id);
    // Also ensure it's in active list
    if (!activeIds.includes(id)) {
      setSetting("ai_active_models", [...activeIds, id].join(","));
    }
  };

  const filtered = search
    ? models.filter((m) => m.name.toLowerCase().includes(search.toLowerCase()) || m.id.toLowerCase().includes(search.toLowerCase()))
    : models.slice(0, 50);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm">Models</Label>
          <p className="text-xs text-muted-foreground">Toggle active models for IDE agent. Set one as default.</p>
        </div>
        <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={refresh} disabled={loading}>
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {/* Active models chips */}
      {allActive.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {allActive.map((id) => (
            <span key={id} className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs ${id === defaultModel ? "bg-primary/15 text-primary font-medium" : "bg-muted text-muted-foreground"}`}>
              {id.split("/").pop()}
              {id === defaultModel && <span className="text-[9px] opacity-60">default</span>}
              {id !== defaultModel && <button onClick={() => toggleActive(id)} className="hover:text-destructive ml-0.5">×</button>}
            </span>
          ))}
        </div>
      )}

      {/* Search + model list */}
      <Input placeholder="Search models..." value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 text-xs" />
      <div className="max-h-[260px] overflow-y-auto rounded-md border border-border/40">
        {filtered.length === 0 && <p className="px-3 py-4 text-center text-xs text-muted-foreground">{loading ? "Loading..." : "No models found"}</p>}
        {filtered.map((m) => {
          const isActive = allActive.includes(m.id);
          const isDefault = m.id === defaultModel;
          return (
            <div key={m.id} className={`flex items-center gap-2 px-3 py-1.5 text-xs border-b border-border/20 last:border-0 ${isDefault ? "bg-primary/5" : ""}`}>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{m.name}</p>
                <p className="truncate text-[10px] text-muted-foreground/60">{formatPrice(m.pricing?.prompt)} / {formatPrice(m.pricing?.completion)}{m.context_length ? ` · ${Math.round(m.context_length / 1000)}k` : ""}</p>
              </div>
              <button
                onClick={() => toggleActive(m.id)}
                className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${isActive ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
              >
                {isActive ? "Active" : "Add"}
              </button>
              <button
                onClick={() => setDefault(m.id)}
                className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${isDefault ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
              >
                {isDefault ? "Default" : "Set Default"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Vault Security Section ─────────────────────────────────────────

function VaultSecuritySection() {
  const { vaultConfig, hasMasterPassword, loadVaultConfig } = useVault();
  const { processing, enableMasterPassword, removeMasterPassword, changeMasterPassword, setAutoLockMinutes } = useMasterPassword();
  const [mode, setMode] = useState<"idle" | "enable" | "change" | "remove">("idle");
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [hint, setHint] = useState("");
  const [error, setError] = useState("");

  useEffect(() => { loadVaultConfig(); }, []);

  const resetForm = () => { setMode("idle"); setCurrentPassword(""); setPassword(""); setConfirmPassword(""); setHint(""); setError(""); };

  const handleEnable = async () => {
    if (password.length < 8) { setError("Password must be at least 8 characters"); return; }
    if (password !== confirmPassword) { setError("Passwords do not match"); return; }
    try { await enableMasterPassword(password, hint); resetForm(); } catch { setError("Failed to enable master password"); }
  };

  const handleChange = async () => {
    if (!currentPassword) { setError("Enter your current password"); return; }
    if (password.length < 8) { setError("New password must be at least 8 characters"); return; }
    if (password !== confirmPassword) { setError("Passwords do not match"); return; }
    try { await changeMasterPassword(currentPassword, password, hint); resetForm(); } catch { setError("Failed — current password incorrect?"); }
  };

  const handleRemove = async () => {
    if (!currentPassword) { setError("Enter your current password to confirm"); return; }
    try { await removeMasterPassword(currentPassword); resetForm(); } catch { setError("Failed — current password incorrect?"); }
  };

  const autoLockMin = vaultConfig?.auto_lock_minutes ?? 15;

  return (
    <Section title="Credential Vault" icon={Lock}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className={hasMasterPassword ? "h-4 w-4 text-green-500" : "h-4 w-4 text-muted-foreground"} />
          <div>
            <Label className="text-sm">Master Password</Label>
            <p className="text-xs text-muted-foreground">{hasMasterPassword ? "Enabled — vault locks after idle" : "Disabled — using machine-bound encryption"}</p>
          </div>
        </div>
        {mode === "idle" && (
          <div className="flex items-center gap-2">
            {hasMasterPassword ? (
              <>
                <Button variant="outline" size="sm" className="text-xs" onClick={() => setMode("change")}>Change</Button>
                <Button variant="outline" size="sm" className="text-xs text-destructive" onClick={() => setMode("remove")}>Remove</Button>
              </>
            ) : (
              <Button variant="outline" size="sm" className="text-xs" onClick={() => setMode("enable")}>Enable</Button>
            )}
          </div>
        )}
      </div>

      {(mode === "enable" || mode === "change") && (
        <div className="space-y-3 rounded-lg border border-border/40 bg-muted/20 p-3">
          <p className="text-xs font-medium">{mode === "enable" ? "Set Master Password" : "Change Master Password"}</p>
          {mode === "change" && <Input type="password" placeholder="Current password" value={currentPassword} onChange={(e) => { setCurrentPassword(e.target.value); setError(""); }} className="h-8 text-sm" autoFocus />}
          <Input type="password" placeholder="New password (min 8 chars)" value={password} onChange={(e) => { setPassword(e.target.value); setError(""); }} className="h-8 text-sm" autoFocus={mode === "enable"} />
          <Input type="password" placeholder="Confirm password" value={confirmPassword} onChange={(e) => { setConfirmPassword(e.target.value); setError(""); }} className="h-8 text-sm" />
          <Input placeholder="Password hint (optional)" value={hint} onChange={(e) => setHint(e.target.value)} className="h-8 text-sm" />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" className="text-xs" onClick={resetForm}>Cancel</Button>
            <Button size="sm" className="text-xs" onClick={mode === "enable" ? handleEnable : handleChange} disabled={processing}>{processing ? "Processing..." : mode === "enable" ? "Enable" : "Change"}</Button>
          </div>
        </div>
      )}

      {mode === "remove" && (
        <div className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <p className="text-xs text-destructive font-medium">Remove master password? Credentials will be re-encrypted with machine-bound key.</p>
          <Input type="password" placeholder="Current password" value={currentPassword} onChange={(e) => { setCurrentPassword(e.target.value); setError(""); }} className="h-8 text-sm" autoFocus />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" className="text-xs" onClick={resetForm}>Cancel</Button>
            <Button variant="destructive" size="sm" className="text-xs" onClick={handleRemove} disabled={processing}>{processing ? "Processing..." : "Remove"}</Button>
          </div>
        </div>
      )}

      {hasMasterPassword && (
        <>
          <Separator />
          <Row label="Auto-lock timeout" desc="Lock vault after inactivity">
            <Select value={String(autoLockMin)} onValueChange={(v) => setAutoLockMinutes(parseInt(v))}>
              <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="5">5 min</SelectItem>
                <SelectItem value="10">10 min</SelectItem>
                <SelectItem value="15">15 min</SelectItem>
                <SelectItem value="30">30 min</SelectItem>
                <SelectItem value="60">1 hour</SelectItem>
              </SelectContent>
            </Select>
          </Row>
        </>
      )}

      {hasMasterPassword && vaultConfig?.password_hint && (
        <>
          <Separator />
          <Row label="Password hint">
            <span className="text-xs text-muted-foreground italic">"{vaultConfig.password_hint}"</span>
          </Row>
        </>
      )}
    </Section>
  );
}
