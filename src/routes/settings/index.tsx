import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Settings, Timer, Monitor, Rocket, Moon, Sun, KeyRound, Terminal, FolderOpen, Lock, ShieldCheck, RefreshCw, Bot } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSettingsStore } from "@/stores/settingsStore";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import { PemKeyManager } from "@/components/server/PemKeyManager";
import { useMasterPassword } from "@/hooks/useMasterPassword";
import { useVault } from "@/hooks/useVault";
import { SyncSettingsPanel } from "@/components/sync/SyncSettingsPanel";
import { useOpenRouterModels } from "@/hooks/useOpenRouterModels";

export const Route = createFileRoute("/settings/")({
  component: SettingsPage,
});

function SettingsPage() {
  const { loaded, loadSettings, getSetting, setSetting } = useSettingsStore();
  const [autostartEnabled, setAutostartEnabled] = useState(false);

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
    // Persist to localStorage so the loading splash uses the correct theme next boot
    localStorage.setItem("app_theme", newTheme);
    // Apply immediately
    const root = document.documentElement;
    if (newTheme === "dark") {
      root.classList.add("dark");
    } else if (newTheme === "light") {
      root.classList.remove("dark");
    } else {
      // system
      const prefersDark = window.matchMedia(
        "(prefers-color-scheme: dark)",
      ).matches;
      root.classList.toggle("dark", prefersDark);
    }
  };

  const handleAutostartToggle = async (enabled: boolean) => {
    try {
      if (enabled) {
        await enable();
      } else {
        await disable();
      }
      setAutostartEnabled(enabled);
    } catch (err) {
      console.error("Autostart toggle failed:", err);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <div className="mb-6 flex items-center gap-3">
        <Settings className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">Settings</h1>
      </div>

      {/* Theme */}
      <section className="mb-8">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          <Monitor className="h-4 w-4" />
          Appearance
        </h2>
        <div className="space-y-3 rounded-xl border border-border/60 bg-card p-4">
          <div className="flex items-center gap-3">
            {(["light", "dark", "system"] as const).map((t) => (
              <Button
                key={t}
                variant={theme === t ? "default" : "outline"}
                size="sm"
                className="gap-2"
                onClick={() => handleThemeChange(t)}
              >
                {t === "light" && <Sun className="h-3.5 w-3.5" />}
                {t === "dark" && <Moon className="h-3.5 w-3.5" />}
                {t === "system" && <Monitor className="h-3.5 w-3.5" />}
                <span className="capitalize">{t}</span>
              </Button>
            ))}
          </div>
        </div>
      </section>

      <Separator className="my-6" />

      {/* Pomodoro */}
      <section className="mb-8">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          <Timer className="h-4 w-4" />
          Pomodoro Timer
        </h2>
        <div className="space-y-4 rounded-xl border border-border/60 bg-card p-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="work-min" className="text-sm">
              Work duration (min)
            </Label>
            <Input
              id="work-min"
              type="number"
              min={1}
              max={120}
              value={workMin}
              onChange={(e) => setSetting("pomodoro_work_min", e.target.value)}
              className="w-20 text-center"
            />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <Label htmlFor="break-min" className="text-sm">
              Break duration (min)
            </Label>
            <Input
              id="break-min"
              type="number"
              min={1}
              max={60}
              value={breakMin}
              onChange={(e) => setSetting("pomodoro_break_min", e.target.value)}
              className="w-20 text-center"
            />
          </div>
        </div>
      </section>

      <Separator className="my-6" />

      {/* Today Window */}
      <section className="mb-8">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          <Monitor className="h-4 w-4" />
          Today Window
        </h2>
        <div className="space-y-4 rounded-xl border border-border/60 bg-card p-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="always-on-top" className="text-sm">
              Always on top by default
            </Label>
            <Switch
              id="always-on-top"
              checked={alwaysOnTop === "true"}
              onCheckedChange={(checked) =>
                setSetting(
                  "today_window_always_on_top",
                  checked ? "true" : "false",
                )
              }
            />
          </div>
        </div>
      </section>

      <Separator className="my-6" />

      {/* Autostart */}
      <section className="mb-8">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          <Rocket className="h-4 w-4" />
          System
        </h2>
        <div className="space-y-4 rounded-xl border border-border/60 bg-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="autostart" className="text-sm">
                Launch at login
              </Label>
              <p className="text-xs text-muted-foreground">
                Automatically start Badami when you log in
              </p>
            </div>
            <Switch
              id="autostart"
              checked={autostartEnabled}
              onCheckedChange={handleAutostartToggle}
            />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="close-to-tray" className="text-sm">
                Close to system tray
              </Label>
              <p className="text-xs text-muted-foreground">
                Keep app running in the background when window is closed
              </p>
            </div>
            <Switch
              id="close-to-tray"
              checked={closeToTray === "true"}
              onCheckedChange={(checked) =>
                setSetting("close_to_tray", checked ? "true" : "false")
              }
            />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="show-dock-icon" className="text-sm">
                Show app in Dock
              </Label>
              <p className="text-xs text-muted-foreground">
                Display Badami icon in the macOS Dock
              </p>
            </div>
            <Switch
              id="show-dock-icon"
              checked={showDockIcon === "true"}
              onCheckedChange={(checked) =>
                setSetting("show_dock_icon", checked ? "true" : "false")
              }
            />
          </div>
        </div>
      </section>

      <Separator className="my-6" />

      {/* SSH Terminal */}
      <section className="mb-8">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          <Terminal className="h-4 w-4" />
          SSH Terminal
        </h2>
        <div className="space-y-4 rounded-xl border border-border/60 bg-card p-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="ssh-font-size" className="text-sm">
              Font size
            </Label>
            <Input
              id="ssh-font-size"
              type="number"
              min={8}
              max={32}
              value={getSetting("ssh_terminal_font_size", "13")}
              onChange={(e) => setSetting("ssh_terminal_font_size", e.target.value)}
              className="w-20 text-center"
            />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <Label htmlFor="ssh-font-family" className="text-sm">
              Font family
            </Label>
            <Input
              id="ssh-font-family"
              value={getSetting("ssh_terminal_font_family", "JetBrains Mono")}
              onChange={(e) => setSetting("ssh_terminal_font_family", e.target.value)}
              className="w-48"
            />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <Label htmlFor="ssh-theme" className="text-sm">
              Terminal theme
            </Label>
            <Select
              value={getSetting("ssh_terminal_theme", "dark")}
              onValueChange={(v) => setSetting("ssh_terminal_theme", v)}
            >
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dark">Dark</SelectItem>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="monokai">Monokai</SelectItem>
                <SelectItem value="nord">Nord</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="ssh-auto-reconnect" className="text-sm">
                Auto reconnect
              </Label>
              <p className="text-xs text-muted-foreground">
                Automatically reconnect SSH on connection drop
              </p>
            </div>
            <Switch
              id="ssh-auto-reconnect"
              checked={getSetting("ssh_auto_reconnect", "false") === "true"}
              onCheckedChange={(checked) =>
                setSetting("ssh_auto_reconnect", checked ? "true" : "false")
              }
            />
          </div>
          {getSetting("ssh_auto_reconnect", "false") === "true" && (
            <>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="ssh-max-attempts" className="text-sm">
                    Max reconnect attempts
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Stop trying after this many failures
                  </p>
                </div>
                <Input
                  id="ssh-max-attempts"
                  type="number"
                  min={1}
                  max={20}
                  value={getSetting("ssh_auto_reconnect_max_attempts", "5")}
                  onChange={(e) => setSetting("ssh_auto_reconnect_max_attempts", e.target.value)}
                  className="w-20 text-center"
                />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="ssh-keepalive" className="text-sm">
                    Keepalive interval (seconds)
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Send keepalive packet to prevent idle timeout
                  </p>
                </div>
                <Input
                  id="ssh-keepalive"
                  type="number"
                  min={5}
                  max={300}
                  value={getSetting("ssh_keepalive_interval", "30")}
                  onChange={(e) => setSetting("ssh_keepalive_interval", e.target.value)}
                  className="w-20 text-center"
                />
              </div>
            </>
          )}
        </div>
      </section>

      <Separator className="my-6" />

      {/* File Manager */}
      <section className="mb-8">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          <FolderOpen className="h-4 w-4" />
          File Manager
        </h2>
        <div className="space-y-4 rounded-xl border border-border/60 bg-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="fm-show-hidden" className="text-sm">
                Show hidden files
              </Label>
              <p className="text-xs text-muted-foreground">
                Display dotfiles by default in the file manager
              </p>
            </div>
            <Switch
              id="fm-show-hidden"
              checked={getSetting("file_manager_show_hidden", "false") === "true"}
              onCheckedChange={(checked) =>
                setSetting("file_manager_show_hidden", checked ? "true" : "false")
              }
            />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <Label htmlFor="fm-default-path" className="text-sm">
              Default local path
            </Label>
            <Input
              id="fm-default-path"
              value={getSetting("file_manager_default_local_path", "~/Downloads")}
              onChange={(e) => setSetting("file_manager_default_local_path", e.target.value)}
              className="w-48"
              placeholder="~/Downloads"
            />
          </div>
        </div>
      </section>

      <Separator className="my-6" />

      {/* AI Chat */}
      <section className="mb-8">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          <Bot className="h-4 w-4" />
          AI Assistant
        </h2>
        <div className="space-y-4 rounded-xl border border-border/60 bg-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="openrouter-key" className="text-sm">
                OpenRouter API Key
              </Label>
              <p className="text-xs text-muted-foreground">
                Get your key from{" "}
                <a href="https://openrouter.ai/keys" className="text-primary underline" target="_blank" rel="noreferrer">
                  openrouter.ai/keys
                </a>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Input
              id="openrouter-key"
              type="password"
              value={getSetting("openrouter_api_key", "")}
              onChange={(e) => setSetting("openrouter_api_key", e.target.value)}
              placeholder="sk-or-v1-..."
              className="flex-1 font-mono text-xs"
            />
            <TestApiKeyButton />
          </div>
          <Separator />
          <AiModelSelector />
        </div>
      </section>

      <Separator className="my-6" />

      {/* Cross-Device Sync */}
      <section className="mb-8">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          <RefreshCw className="h-4 w-4" />
          Cross-Device Sync
        </h2>
        <SyncSettingsPanel />
      </section>

      <Separator className="my-6" />

      {/* Credential Vault Security */}
      <VaultSecuritySection />

      <Separator className="my-6" />

      {/* PEM Key Manager */}
      <section className="mb-8">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          <KeyRound className="h-4 w-4" />
          PEM Keys
        </h2>
        <div className="rounded-xl border border-border/60 bg-card p-4">
          <PemKeyManager />
        </div>
      </section>
    </div>
  );
}

// ─── Test API Key Button ────────────────────────────────────────────

function TestApiKeyButton() {
  const { getSetting } = useSettingsStore();
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<"idle" | "success" | "error">("idle");

  const handleTest = async () => {
    const apiKey = getSetting("openrouter_api_key", "");
    if (!apiKey) {
      setResult("error");
      return;
    }
    setTesting(true);
    setResult("idle");
    try {
      const res = await fetch("https://openrouter.ai/api/v1/auth/key", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (res.ok) {
        setResult("success");
      } else {
        setResult("error");
      }
    } catch {
      setResult("error");
    } finally {
      setTesting(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      className={`h-8 text-xs gap-1.5 ${result === "success" ? "border-green-500 text-green-500" : result === "error" ? "border-destructive text-destructive" : ""}`}
      onClick={handleTest}
      disabled={testing}
    >
      {testing ? (
        <RefreshCw className="h-3 w-3 animate-spin" />
      ) : result === "success" ? (
        "✓ Valid"
      ) : result === "error" ? (
        "✗ Invalid"
      ) : (
        "Test"
      )}
    </Button>
  );
}

// ─── AI Model Selector (dynamic from OpenRouter) ────────────────────

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
  const currentModel = getSetting("ai_model", "openai/gpt-4o-mini");

  const filtered = search
    ? models.filter((m) => m.name.toLowerCase().includes(search.toLowerCase()) || m.id.toLowerCase().includes(search.toLowerCase()))
    : models.slice(0, 50);

  const selectedModelData = models.find((m) => m.id === currentModel);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm">Default model</Label>
        <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={refresh} disabled={loading}>
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>
      <Input
        placeholder="Search models..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="h-8 text-xs"
      />
      <div className="max-h-[240px] overflow-y-auto rounded-md border border-border/40">
        {filtered.length === 0 && (
          <p className="px-3 py-4 text-center text-xs text-muted-foreground">
            {loading ? "Loading models..." : "No models found"}
          </p>
        )}
        {filtered.map((m) => (
          <button
            key={m.id}
            onClick={() => setSetting("ai_model", m.id)}
            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-muted/40 border-b border-border/20 last:border-0 ${currentModel === m.id ? "bg-primary/10 text-primary" : "text-foreground"}`}
          >
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{m.name}</p>
              <p className="truncate text-[10px] text-muted-foreground/60">{m.id}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-[10px] text-muted-foreground">
                <span className="text-green-500">{formatPrice(m.pricing?.prompt)}</span>
                {" / "}
                <span className="text-blue-500">{formatPrice(m.pricing?.completion)}</span>
              </p>
              <p className="text-[9px] text-muted-foreground/50">
                {m.context_length ? `${Math.round(m.context_length / 1000)}k ctx` : ""}
              </p>
            </div>
          </button>
        ))}
      </div>

      {/* Selected model info */}
      {selectedModelData && (
        <div className="rounded-md bg-muted/30 px-3 py-2 text-[11px]">
          <p className="font-medium">{selectedModelData.name}</p>
          <div className="mt-1 flex items-center gap-3 text-muted-foreground">
            <span>Input: <span className="text-green-500 font-medium">{formatPrice(selectedModelData.pricing?.prompt)}/1M</span></span>
            <span>Output: <span className="text-blue-500 font-medium">{formatPrice(selectedModelData.pricing?.completion)}/1M</span></span>
            {selectedModelData.context_length && (
              <span>Context: {Math.round(selectedModelData.context_length / 1000)}k</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Vault Security Section ─────────────────────────────────────────

function VaultSecuritySection() {
  const { vaultConfig, hasMasterPassword, loadVaultConfig } = useVault();
  const {
    processing,
    enableMasterPassword,
    removeMasterPassword,
    changeMasterPassword,
    setAutoLockMinutes,
  } = useMasterPassword();

  const [mode, setMode] = useState<"idle" | "enable" | "change" | "remove">("idle");
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [hint, setHint] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    loadVaultConfig();
  }, []);

  const resetForm = () => {
    setMode("idle");
    setCurrentPassword("");
    setPassword("");
    setConfirmPassword("");
    setHint("");
    setError("");
  };

  const handleEnable = async () => {
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    try {
      await enableMasterPassword(password, hint);
      resetForm();
    } catch {
      setError("Failed to enable master password");
    }
  };

  const handleChange = async () => {
    if (!currentPassword) {
      setError("Enter your current password");
      return;
    }
    if (password.length < 8) {
      setError("New password must be at least 8 characters");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    try {
      await changeMasterPassword(currentPassword, password, hint);
      resetForm();
    } catch {
      setError("Failed to change master password — current password incorrect?");
    }
  };

  const handleRemove = async () => {
    if (!currentPassword) {
      setError("Enter your current password to confirm");
      return;
    }
    try {
      await removeMasterPassword(currentPassword);
      resetForm();
    } catch {
      setError("Failed to remove — current password incorrect?");
    }
  };

  const autoLockMin = vaultConfig?.auto_lock_minutes ?? 15;

  return (
    <section className="mb-8">
      <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        <Lock className="h-4 w-4" />
        Credential Vault
      </h2>
      <div className="space-y-4 rounded-xl border border-border/60 bg-card p-4">
        {/* Status */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className={hasMasterPassword ? "h-4 w-4 text-green-500" : "h-4 w-4 text-muted-foreground"} />
            <div>
              <Label className="text-sm">Master Password</Label>
              <p className="text-xs text-muted-foreground">
                {hasMasterPassword
                  ? "Enabled — vault locks after idle timeout"
                  : "Disabled — using machine-bound encryption"}
              </p>
            </div>
          </div>
          {mode === "idle" && (
            <div className="flex items-center gap-2">
              {hasMasterPassword ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    onClick={() => setMode("change")}
                  >
                    Change
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs text-destructive"
                    onClick={() => setMode("remove")}
                  >
                    Remove
                  </Button>
                </>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  onClick={() => setMode("enable")}
                >
                  Enable
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Enable / Change form */}
        {(mode === "enable" || mode === "change") && (
          <div className="space-y-3 rounded-lg border border-border/40 bg-muted/20 p-3">
            <p className="text-xs font-medium">
              {mode === "enable" ? "Set Master Password" : "Change Master Password"}
            </p>
            {mode === "change" && (
              <Input
                type="password"
                placeholder="Current password"
                value={currentPassword}
                onChange={(e) => { setCurrentPassword(e.target.value); setError(""); }}
                className="h-8 text-sm"
                autoFocus
              />
            )}
            <Input
              type="password"
              placeholder="New password (min 8 chars)"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(""); }}
              className="h-8 text-sm"
              autoFocus={mode === "enable"}
            />
            <Input
              type="password"
              placeholder="Confirm password"
              value={confirmPassword}
              onChange={(e) => { setConfirmPassword(e.target.value); setError(""); }}
              className="h-8 text-sm"
            />
            <Input
              placeholder="Password hint (optional)"
              value={hint}
              onChange={(e) => setHint(e.target.value)}
              className="h-8 text-sm"
            />
            {error && (
              <p className="text-xs text-destructive">{error}</p>
            )}
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" className="text-xs" onClick={resetForm}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="text-xs"
                onClick={mode === "enable" ? handleEnable : handleChange}
                disabled={processing}
              >
                {processing ? "Processing..." : mode === "enable" ? "Enable" : "Change Password"}
              </Button>
            </div>
          </div>
        )}

        {/* Remove confirmation */}
        {mode === "remove" && (
          <div className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            <p className="text-xs text-destructive font-medium">
              Remove master password? All credentials will be re-encrypted with the machine-bound key.
            </p>
            <Input
              type="password"
              placeholder="Enter current password to confirm"
              value={currentPassword}
              onChange={(e) => { setCurrentPassword(e.target.value); setError(""); }}
              className="h-8 text-sm"
              autoFocus
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" className="text-xs" onClick={resetForm}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="text-xs"
                onClick={handleRemove}
                disabled={processing}
              >
                {processing ? "Processing..." : "Remove"}
              </Button>
            </div>
          </div>
        )}

        {/* Auto-lock timeout */}
        {hasMasterPassword && (
          <>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm">Auto-lock timeout</Label>
                <p className="text-xs text-muted-foreground">
                  Lock vault after inactivity
                </p>
              </div>
              <Select
                value={String(autoLockMin)}
                onValueChange={(v) => setAutoLockMinutes(parseInt(v))}
              >
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">5 min</SelectItem>
                  <SelectItem value="10">10 min</SelectItem>
                  <SelectItem value="15">15 min</SelectItem>
                  <SelectItem value="30">30 min</SelectItem>
                  <SelectItem value="60">1 hour</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </>
        )}

        {/* Password hint */}
        {hasMasterPassword && vaultConfig?.password_hint && (
          <>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm">Password hint</Label>
                <p className="text-xs text-muted-foreground italic">
                  "{vaultConfig.password_hint}"
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
