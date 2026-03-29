import { createFileRoute } from "@tanstack/react-router";
import { CommandPalette } from "@/components/search/CommandPalette";

export const Route = createFileRoute("/search")({
  component: SearchPage,
});

function SearchPage() {
  return <CommandPalette isWindow onClose={() => {
    import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      getCurrentWindow().close();
    });
  }} />;
}
