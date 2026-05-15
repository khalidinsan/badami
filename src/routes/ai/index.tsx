import { createFileRoute } from "@tanstack/react-router";
import { AiChat } from "@/components/ai/AiChat";

export const Route = createFileRoute("/ai/")({
  component: AiPage,
});

function AiPage() {
  return (
    <div className="h-full">
      <AiChat />
    </div>
  );
}
