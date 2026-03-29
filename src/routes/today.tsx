import { createFileRoute } from "@tanstack/react-router";
import { StickyNote } from "@/components/today/StickyNote";

export const Route = createFileRoute("/today")({
  component: TodayPage,
});

function TodayPage() {
  return <StickyNote />;
}
