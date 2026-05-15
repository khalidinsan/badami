import { createFileRoute } from "@tanstack/react-router";
import { CommandPalette } from "@/components/search/CommandPalette";

export const Route = createFileRoute("/search")({
  component: SearchPage,
});

function SearchPage() {
  return (
    <div className="flex h-screen flex-col overflow-hidden rounded-lg border border-border/30">
      <CommandPalette isWindow onClose={() => {
        import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
          getCurrentWindow().close();
        });
      }} />
    </div>
  );
}
