import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
  HardDrive,
  Import,
  LayoutGrid,
  Settings2,
  Stethoscope,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ServicesPanel } from "@/components/local-dev/ServicesPanel";
import { LogViewer } from "@/components/local-dev/LogViewer";
import { DnsDegradedBanner } from "@/components/local-dev/DnsDegradedBanner";
import { HerdConflictBanner } from "@/components/local-dev/HerdConflictBanner";
import { SitesPanel } from "@/components/local-dev/SitesPanel";
import { ImportHerdWizard } from "@/components/local-dev/ImportHerdWizard";
import { DoctorPanel } from "@/components/local-dev/DoctorPanel";
import { BinarySettings } from "@/components/local-dev/BinarySettings";
import { acquireStatusPolling, useLocalDevStore } from "@/stores/localDevStore";
import { useAppTabStore } from "@/stores/appTabStore";
import { isMacOS } from "@/lib/platform";

export const Route = createFileRoute("/local-dev/")({
  component: () => null,
});

type LocalDevTab = "services" | "sites" | "import" | "doctor" | "settings";

export function LocalDevPage() {
  const mac = isMacOS();
  const discover = useLocalDevStore((s) => s.discover);
  const discovery = useLocalDevStore((s) => s.discovery);
  const loadSettings = useLocalDevStore((s) => s.loadSettings);
  const listSites = useLocalDevStore((s) => s.listSites);
  const loadHerdStatus = useLocalDevStore((s) => s.loadHerdStatus);
  const loadBootstrapStatus = useLocalDevStore((s) => s.loadBootstrapStatus);
  const probeDns = useLocalDevStore((s) => s.probeDns);
  const [tab, setTab] = useState<LocalDevTab>("services");
  /** In the store so a failed service action can reveal the pane on its own. */
  const logsOpen = useLocalDevStore((s) => s.logsOpen);
  /** Only poll while a local-dev tab is the active (visible) tab — not keep-alive hidden. */
  const localDevActive = useAppTabStore((s) => {
    const t = s.tabs.find((x) => x.id === s.activeTabId);
    return t?.type === "local-dev";
  });

  useEffect(() => {
    if (!mac || !localDevActive) return;
    void discover();
    void loadSettings();
    // Sites feed the required-PHP-version set behind the honest service counts,
    // so the Services tab needs them too — not just the Sites tab.
    void listSites();
    void loadHerdStatus();
    // The infra strip reports DNS and the effective HTTP port from these two:
    // bootstrap status carries the real listen/bind ports, and the probe is the
    // only proof that resolution works.
    void loadBootstrapStatus();
    void probeDns();
    return acquireStatusPolling();
  }, [
    mac,
    localDevActive,
    discover,
    loadSettings,
    listSites,
    loadHerdStatus,
    loadBootstrapStatus,
    probeDns,
  ]);

  const openDoctor = useCallback(() => setTab("doctor"), []);
  const openBootstrap = useCallback(() => setTab("settings"), []);
  /**
   * Doctor's "View nginx log" — select the service and expand the log pane.
   * Asking for a log is explicit, so overriding the collapsed default is right.
   */
  const showServiceLog = useCallback((serviceId: string) => {
    useLocalDevStore.getState().revealServiceLog(serviceId);
    setTab("services");
  }, []);

  if (!mac) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <HardDrive className="mb-3 h-10 w-10 text-muted-foreground/30" />
        <h1 className="mb-1 text-lg font-semibold">Local Dev is macOS-only</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          The local PHP / nginx / MariaDB stack uses macOS paths and Herd inventory. It is hidden
          from the sidebar on other platforms.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/40 px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold">Local Dev</h1>
          <p className="text-xs text-muted-foreground">
            Local nginx, PHP-FPM, MariaDB, Redis, and DNS — separate from remote Servers
            {discovery?.herd.detected ? " · Herd inventory detected" : ""}
          </p>
        </div>
      </div>

      {/* Herd running is a hard conflict (ports + datadir); Herd merely being
          installed is not. This banner only fires on the former. */}
      <HerdConflictBanner />

      {/* The Services tab carries its own always-on DNS strip, so the banner
          would be redundant there. */}
      {tab !== "services" && <DnsDegradedBanner />}

      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as LocalDevTab)}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <div className="border-b border-border/40 px-4 pt-2">
          <TabsList variant="line" className="h-9">
            <TabsTrigger value="services" className="gap-1.5 text-xs">
              <HardDrive className="h-3.5 w-3.5" />
              Services
            </TabsTrigger>
            <TabsTrigger value="sites" className="gap-1.5 text-xs">
              <LayoutGrid className="h-3.5 w-3.5" />
              Sites
            </TabsTrigger>
            <TabsTrigger value="import" className="gap-1.5 text-xs">
              <Import className="h-3.5 w-3.5" />
              Import
            </TabsTrigger>
            <TabsTrigger value="doctor" className="gap-1.5 text-xs">
              <Stethoscope className="h-3.5 w-3.5" />
              Doctor
            </TabsTrigger>
            <TabsTrigger value="settings" className="gap-1.5 text-xs">
              <Settings2 className="h-3.5 w-3.5" />
              Settings
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="services" className="mt-0 min-h-0 flex-1 data-[state=inactive]:hidden">
          <div className="flex h-full min-h-0 flex-col">
            <div className="min-h-0 flex-1">
              <ServicesPanel onOpenDoctor={openDoctor} onOpenBootstrap={openBootstrap} />
            </div>
            {/* Collapsed: a single header bar. Expanded: takes back its pane. */}
            <div className={logsOpen ? "min-h-[180px] flex-[2] shrink-0" : "shrink-0"}>
              <LogViewer className="h-full" active={localDevActive && tab === "services"} />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="sites" className="mt-0 min-h-0 flex-1 data-[state=inactive]:hidden">
          <SitesPanel />
        </TabsContent>

        <TabsContent value="import" className="mt-0 min-h-0 flex-1 data-[state=inactive]:hidden">
          <ImportHerdWizard />
        </TabsContent>

        <TabsContent value="doctor" className="mt-0 min-h-0 flex-1 data-[state=inactive]:hidden">
          <DoctorPanel onOpenBootstrap={openBootstrap} onShowServiceLog={showServiceLog} />
        </TabsContent>

        <TabsContent value="settings" className="mt-0 min-h-0 flex-1 data-[state=inactive]:hidden">
          <BinarySettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}
