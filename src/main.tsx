import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { TooltipProvider } from "@/components/ui/tooltip";
import { routeTree } from "./routeTree.gen";
import { invoke } from "@tauri-apps/api/core";
import { initDatabase } from "@/db/client";
import { useSettingsStore } from "@/stores/settingsStore";
import { useSyncStore } from "@/stores/syncStore";
import "@fontsource-variable/plus-jakarta-sans";
import "./index.css";

// Disable native browser right-click context menu globally
document.addEventListener("contextmenu", (e) => e.preventDefault());

// Apply theme immediately from localStorage (no db wait needed)
const savedTheme = localStorage.getItem("app_theme") ?? "dark";
applyTheme(savedTheme);

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

function AppWrapper() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    initDatabase()
      .then(async (result) => {
        if (result.sync_enabled) {
          useSyncStore.getState().setStatus("pending");
        }

        const store = useSettingsStore.getState();
        await store.loadSettings();

        // Auto-repair: settings say sync is on but backend didn't init the replica
        // (happens when sync-config.json is deleted but settings weren't reset).
        // db_enable_sync reads the token from keychain internally — no token needed here.
        if (
          !result.sync_enabled &&
          store.getSetting("sync_enabled", "false") === "true"
        ) {
          const syncUrl = store.getSetting("sync_turso_url", "");
          const syncInterval =
            parseInt(store.getSetting("sync_interval_minutes", "5")) || 5;
          if (syncUrl) {
            useSyncStore.getState().setStatus("pending");
            invoke<{ success: boolean; duration_ms: number }>("db_enable_sync", {
              url: syncUrl,
              syncIntervalMinutes: syncInterval,
            })
              .then(async () => {
                // Re-write all settings to the newly-active replica connection
                const currentSettings = { ...useSettingsStore.getState().settings };
                for (const [key, value] of Object.entries(currentSettings)) {
                  await store.setSetting(key, value);
                }
              })
              .catch((err) => {
                console.error("[sync-repair] failed:", err);
                // Reset sync_enabled so the UI shows setup form instead of broken sync
                store.setSetting("sync_enabled", "false").catch(() => {});
                useSyncStore.getState().setStatus("disabled");
              });
          }
        }

        const theme = store.getSetting("app_theme", "dark");
        // Persist to localStorage so next boot applies theme before db_init
        localStorage.setItem("app_theme", theme);
        applyTheme(theme);

        setReady(true);
      })
      .catch((err) => {
        console.error("Failed to initialize database:", err);
        setError(String(err));
      });
  }, []);

  if (error) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          gap: "12px",
          fontFamily: "system-ui, sans-serif",
          color: "#ff453a",
          background: "#000",
          fontSize: "13px",
        }}
      >
        <span>Failed to start Badami</span>
        <span style={{ color: "#98989d", maxWidth: 360, textAlign: "center" }}>{error}</span>
      </div>
    );
  }

  if (!ready) {
    return <SplashScreen />;
  }

  return (
    <RouterProvider router={router} />
  );
}

function SplashScreen() {
  const isDark = document.documentElement.classList.contains("dark");
  const iconSrc = isDark ? "/icon-white.png" : "/icon.png";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        gap: "16px",
        background: "var(--color-background, #000000)",
        color: "var(--color-foreground, #f5f5f7)",
        fontFamily: '"Plus Jakarta Sans Variable", "Plus Jakarta Sans", system-ui, sans-serif',
      }}
    >
      <img
        src={iconSrc}
        width="48"
        height="48"
        alt="Badami"
        style={{ opacity: 0.9 }}
      />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}>
        <span style={{ fontSize: "15px", fontWeight: 600, letterSpacing: "-0.01em" }}>Badami</span>
        <span style={{ fontSize: "12px", color: "var(--color-muted-foreground, #98989d)" }}>
          Initializing...
        </span>
      </div>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
      <div
        style={{
          width: 18,
          height: 18,
          borderRadius: "50%",
          border: "2px solid rgba(10,132,255,0.2)",
          borderTopColor: "#0a84ff",
          animation: "spin 0.8s linear infinite",
        }}
      />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <TooltipProvider>
      <AppWrapper />
    </TooltipProvider>
  </React.StrictMode>,
);

function applyTheme(theme: string) {
  const root = document.documentElement;
  if (theme === "dark") {
    root.classList.add("dark");
  } else if (theme === "light") {
    root.classList.remove("dark");
  } else {
    // system
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)",
    ).matches;
    root.classList.toggle("dark", prefersDark);
  }
}
