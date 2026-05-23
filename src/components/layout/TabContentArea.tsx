import { lazy, memo, Suspense, useEffect, useState } from "react";
import { useAppTabStore, type AppTabType } from "@/stores/appTabStore";

// Lazy-loaded page components from route files
const PlanningPage = lazy(() => import("@/routes/planning/index").then((m) => ({ default: m.PlanningPage })));
const ProjectsPage = lazy(() => import("@/routes/projects/index").then((m) => ({ default: m.ProjectsPage })));
const TasksPage = lazy(() => import("@/routes/tasks/index").then((m) => ({ default: m.TasksPage })));
const ServersPage = lazy(() => import("@/routes/servers/index").then((m) => ({ default: m.ServersPage })));
const CredentialsPage = lazy(() => import("@/routes/credentials/index").then((m) => ({ default: m.CredentialsPage })));
const ApiPage = lazy(() => import("@/routes/api/index").then((m) => ({ default: m.ApiPage })));
const DatabasePage = lazy(() => import("@/routes/database/index").then((m) => ({ default: m.DatabasePage })));
const AiPage = lazy(() => import("@/routes/ai/index").then((m) => ({ default: m.AiPage })));
const StatsPage = lazy(() => import("@/routes/stats/index").then((m) => ({ default: m.StatsPage })));
const SettingsPage = lazy(() => import("@/routes/settings/index").then((m) => ({ default: m.SettingsPage })));
const AboutPage = lazy(() => import("@/routes/about/index").then((m) => ({ default: m.AboutPage })));

type SimplePageComponent = React.LazyExoticComponent<() => React.JSX.Element>;

const TAB_COMPONENT_MAP: Partial<Record<AppTabType, SimplePageComponent>> = {
  planning: PlanningPage,
  projects: ProjectsPage,
  tasks: TasksPage,
  servers: ServersPage,
  server: ServersPage,
  credentials: CredentialsPage,
  api: ApiPage,
  database: DatabasePage,
  ai: AiPage,
  stats: StatsPage,
  settings: SettingsPage,
  about: AboutPage,
};

// Tab types rendered by TanStack Router's <Outlet> (project detail)
export const ROUTER_RENDERED_TABS: Set<AppTabType> = new Set(["project"]);

function TabLoading() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}

/** Memoized tab panel — only re-renders when isActive changes */
const TabPanel = memo(function TabPanel({
  type,
  isActive,
}: {
  tabId: string;
  type: AppTabType;
  isActive: boolean;
}) {
  const Component = TAB_COMPONENT_MAP[type];
  if (!Component) return null;

  return (
    <div className={isActive ? "h-full" : "hidden"}>
      <Suspense fallback={<TabLoading />}>
        <Component />
      </Suspense>
    </div>
  );
});

export function TabContentArea() {
  const tabs = useAppTabStore((s) => s.tabs);
  const activeTabId = useAppTabStore((s) => s.activeTabId);
  const [mountedTabIds, setMountedTabIds] = useState<Set<string>>(() => {
    return activeTabId ? new Set([activeTabId]) : new Set();
  });

  // Mount a tab when it becomes active for the first time
  useEffect(() => {
    if (!activeTabId) return;
    setMountedTabIds((prev) => {
      if (prev.has(activeTabId)) return prev;
      const next = new Set(prev);
      next.add(activeTabId);
      return next;
    });
  }, [activeTabId]);

  // Unmount tabs that no longer exist in the store (closed)
  useEffect(() => {
    const tabIds = new Set(tabs.map((t) => t.id));
    setMountedTabIds((prev) => {
      const next = new Set<string>();
      for (const id of prev) {
        if (tabIds.has(id)) next.add(id);
      }
      if (next.size === prev.size) return prev;
      return next;
    });
  }, [tabs]);

  return (
    <div className="h-full">
      {tabs.map((tab) => {
        if (ROUTER_RENDERED_TABS.has(tab.type)) return null;
        if (!mountedTabIds.has(tab.id)) return null;

        return (
          <TabPanel
            key={tab.id}
            tabId={tab.id}
            type={tab.type}
            isActive={tab.id === activeTabId}
          />
        );
      })}
    </div>
  );
}
