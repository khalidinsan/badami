import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { TooltipProvider } from "@/components/ui/tooltip";
import { routeTree } from "./routeTree.gen";
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
      <svg
        width="36"
        height="36"
        viewBox="0 0 36 36"
        fill="none"
        style={{ opacity: 0.9 }}
      >
        <circle cx="18" cy="18" r="18" fill="#0a84ff" opacity="0.15" />
        <circle cx="18" cy="18" r="18" fill="none" stroke="#0a84ff" strokeWidth="1.5" opacity="0.4" />
        <text x="18" y="23" textAnchor="middle" fill="#0a84ff" fontSize="15" fontWeight="600"
          fontFamily='"Plus Jakarta Sans Variable", system-ui, sans-serif'>B</text>
      </svg>
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
