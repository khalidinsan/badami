import { useEffect, useRef, useState, useCallback } from "react";
import { Sidebar } from "./Sidebar";

interface MainLayoutProps {
  children: React.ReactNode;
}

const AUTO_COLLAPSE_WIDTH = 820;

export function MainLayout({ children }: MainLayoutProps) {
  const [collapsed, setCollapsed] = useState(false);
  // tracks whether the current collapsed state was triggered by auto-collapse (not user)
  const autoCollapsedRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      if (width < AUTO_COLLAPSE_WIDTH) {
        // Only auto-collapse if not already collapsed by user
        setCollapsed((prev) => {
          if (!prev) autoCollapsedRef.current = true;
          return true;
        });
      } else {
        // Only auto-expand if WE were the ones who collapsed it
        if (autoCollapsedRef.current) {
          autoCollapsedRef.current = false;
          setCollapsed(false);
        }
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleCollapsedChange = useCallback((value: boolean) => {
    autoCollapsedRef.current = false; // user took control
    setCollapsed(value);
  }, []);

  return (
    <div ref={containerRef} className="flex h-screen overflow-hidden bg-background">
      <Sidebar collapsed={collapsed} onCollapsedChange={handleCollapsedChange} />
      <main id="main-content" className="relative min-w-0 flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
