import { useAppTabStore } from "@/stores/appTabStore";
import { useLocation } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

/**
 * Syncs route changes back to the active tab's stored route.
 * This ensures that when you navigate within a tab (e.g. /projects → /projects/abc),
 * the tab remembers the exact sub-page for restore on reopen.
 */
export function useTabRouteSync() {
  const location = useLocation();
  const skipRef = useRef(false);

  useEffect(() => {
    // Don't track route changes for Today/Search windows
    if (location.pathname === "/today" || location.pathname === "/search") return;

    // Skip the first render (initial load navigates to persisted route)
    if (skipRef.current === false) {
      skipRef.current = true;
      return;
    }

    const { activeTabId, tabs, updateActiveRoute } = useAppTabStore.getState();
    if (!activeTabId) return;

    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (!activeTab) return;

    // Only update if the new path is different and still "belongs" to this tab type
    const baseRoute = getBaseRoute(activeTab.route);
    if (location.pathname.startsWith(baseRoute) && location.pathname !== activeTab.route) {
      updateActiveRoute(location.pathname);
    }
  }, [location.pathname]);
}

/** Get the top-level route prefix (e.g. "/projects/abc" → "/projects") */
function getBaseRoute(route: string): string {
  const parts = route.split("/").filter(Boolean);
  return parts.length > 0 ? `/${parts[0]}` : "/";
}
