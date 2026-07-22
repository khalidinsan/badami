import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
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

export function LocalDevPage() {
  const mac = isMacOS();
  const discover = useLocalDevStore((s) => s.discover);
  const discovery = useLocalDevStore((s) => s.discovery);
  const loadSettings = useLocalDevStore((s) => s.loadSettings);
  /** Only poll while a local-dev tab is the active (visible) tab — not keep-alive hidden. */
  const localDevActive = useAppTabStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    return tab?.type === "local-dev";
  });

  useEffect(() => {
    if (!mac || !localDevActive) return;
    void discover();
    void loadSettings();
    return acquireStatusPolling();
  }, [mac, localDevActive, discover, loadSettings]);

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

      <DnsDegradedBanner />

      <Tabs defaultValue="services" className="flex min-h-0 flex-1 flex-col gap-0">
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
            <div className="min-h-0 flex-[3]">
              <ServicesPanel />
            </div>
            <div className="min-h-[160px] flex-[2]">
              <LogViewer className="h-full" />
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
          <DoctorPanel />
        </TabsContent>

        <TabsContent value="settings" className="mt-0 min-h-0 flex-1 data-[state=inactive]:hidden">
          <BinarySettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}
