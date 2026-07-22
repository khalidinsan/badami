import { useEffect, useState } from "react";
import { Loader2, Save, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLocalDevStore } from "@/stores/localDevStore";
import {
  DEFAULT_LOCAL_DEV_SETTINGS,
  type LocalDevSettingKey,
} from "@/types/localDev";
import { BootstrapCard } from "@/components/local-dev/BootstrapCard";

function settingValue(
  settings: Record<string, string>,
  key: LocalDevSettingKey,
): string {
  return settings[key] ?? DEFAULT_LOCAL_DEV_SETTINGS[key] ?? "";
}

export function BinarySettings() {
  const settings = useLocalDevStore((s) => s.settings);
  const settingsBusy = useLocalDevStore((s) => s.settingsBusy);
  const discovery = useLocalDevStore((s) => s.discovery);
  const loadSettings = useLocalDevStore((s) => s.loadSettings);
  const saveSetting = useLocalDevStore((s) => s.saveSetting);
  const discover = useLocalDevStore((s) => s.discover);

  const [httpPort, setHttpPort] = useState("8080");
  const [defaultPhp, setDefaultPhp] = useState("8.4");
  const [tld, setTld] = useState("test");
  const [loopback, setLoopback] = useState("127.0.0.1");

  useEffect(() => {
    void loadSettings();
    if (!discovery) void discover();
  }, [loadSettings, discovery, discover]);

  useEffect(() => {
    setHttpPort(settingValue(settings, "http_port"));
    setDefaultPhp(settingValue(settings, "default_php_version"));
    setTld(settingValue(settings, "tld"));
    setLoopback(settingValue(settings, "loopback"));
  }, [settings]);

  const phpOptions =
    discovery?.herd.php_versions?.filter((v) => v.available).map((v) => v.version) ?? [];
  const phpChoices = Array.from(new Set([...phpOptions, "8.4", "8.3", "7.4", defaultPhp]));

  const paths = discovery?.runtime_paths;

  const saveAll = async () => {
    await saveSetting("http_port", httpPort.trim() || "8080");
    await saveSetting("default_php_version", defaultPhp);
    await saveSetting("tld", tld.trim() || "test");
    await saveSetting("loopback", loopback.trim() || "127.0.0.1");
  };

  return (
    <div className="h-full overflow-auto p-4 md:p-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <div>
          <h2 className="text-sm font-semibold">Settings</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Module config stored in local_dev_settings. Paths are read-only from discovery.
          </p>
        </div>

        <Card className="py-4">
          <CardHeader className="px-4 pb-2 pt-0">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Settings2 className="h-4 w-4" />
              HTTP & DNS
            </CardTitle>
            <CardDescription className="text-xs">
              Mode A uses an unprivileged http_port (default 8080). Changing port requires
              regenerating configs (Import or generate).
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 px-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="http-port" className="text-xs">
                HTTP port
              </Label>
              <Input
                id="http-port"
                value={httpPort}
                onChange={(e) => setHttpPort(e.target.value)}
                className="h-8 text-xs"
                inputMode="numeric"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Default PHP</Label>
              <Select value={defaultPhp} onValueChange={setDefaultPhp}>
                <SelectTrigger className="h-8 w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {phpChoices.map((v) => (
                    <SelectItem key={v} value={v} className="text-xs">
                      PHP {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tld" className="text-xs">
                TLD
              </Label>
              <Input
                id="tld"
                value={tld}
                onChange={(e) => setTld(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="loopback" className="text-xs">
                Loopback
              </Label>
              <Input
                id="loopback"
                value={loopback}
                onChange={(e) => setLoopback(e.target.value)}
                className="h-8 font-mono text-xs"
              />
            </div>
            <div className="sm:col-span-2">
              <Button
                size="sm"
                className="h-8 gap-1.5 text-xs"
                disabled={settingsBusy}
                onClick={() => void saveAll()}
              >
                {settingsBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                Save settings
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="py-4">
          <CardHeader className="px-4 pb-2 pt-0">
            <CardTitle className="text-sm">Read-only paths</CardTitle>
            <CardDescription className="text-xs">
              Badami local-dev runtime layout (Application Support). Never points at Herd
              datadir for deletion.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 px-4">
            {!paths ? (
              <p className="text-xs text-muted-foreground">Run discovery to load paths.</p>
            ) : (
              <dl className="space-y-1.5 font-mono text-[11px]">
                {(
                  [
                    ["Root", paths.local_dev_root],
                    ["Valet config", paths.config_valet],
                    ["Nginx", paths.nginx],
                    ["FPM", paths.fpm],
                    ["Socks", paths.socks],
                    ["MariaDB wrapper", paths.mariadb],
                    ["Valet server", paths.valet_server],
                    ["PIDs", paths.pids],
                    ["Logs", paths.logs],
                    ["Import snapshots", paths.import],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="grid grid-cols-[110px_1fr] gap-2">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="truncate" title={value}>
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            )}

            {discovery?.herd.detected && (
              <div className="mt-3 rounded-md border border-border/50 bg-muted/30 p-2 text-[11px]">
                <p className="mb-1 font-medium not-italic">Herd inventory (read-only)</p>
                <p className="font-mono text-muted-foreground">
                  {discovery.herd.home_path ?? discovery.herd.app_path ?? "detected"}
                </p>
                {discovery.herd.nginx_binary && (
                  <p className="mt-1 font-mono text-muted-foreground">
                    nginx: {discovery.herd.nginx_binary}
                  </p>
                )}
                {discovery.herd.dnsmasq_binary && (
                  <p className="font-mono text-muted-foreground">
                    dnsmasq: {discovery.herd.dnsmasq_binary}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-1">
                  {(discovery.herd.php_versions ?? []).map((v) => (
                    <Badge
                      key={v.tag}
                      variant={v.available ? "secondary" : "outline"}
                      className="h-5 text-[10px]"
                    >
                      php{v.tag}
                      {v.available ? "" : " · missing"}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <BootstrapCard />
      </div>
    </div>
  );
}
