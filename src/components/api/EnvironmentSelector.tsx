import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ApiEnvironmentRow } from "@/types/db";

interface EnvironmentSelectorProps {
  environments: ApiEnvironmentRow[];
  activeId: string | null;
  onSelect: (id: string) => void;
}

const ENV_COLORS: Record<string, string> = {
  Production: "#ef4444",
  Staging: "#f59e0b",
  Development: "#22c55e",
  Local: "#3b82f6",
};

export function EnvironmentSelector({
  environments,
  activeId,
  onSelect,
}: EnvironmentSelectorProps) {
  if (environments.length === 0) {
    return (
      <span className="text-[11px] text-muted-foreground">No environments</span>
    );
  }

  return (
    <Select value={activeId || ""} onValueChange={onSelect}>
      <SelectTrigger className="h-6 w-36 border-white/10 bg-white/5 text-[11px]">
        <SelectValue placeholder="Select environment" />
      </SelectTrigger>
      <SelectContent>
        {environments.map((env) => (
          <SelectItem key={env.id} value={env.id}>
            <div className="flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{
                  backgroundColor: ENV_COLORS[env.name] || "#6b7280",
                }}
              />
              <span className="text-xs">{env.name}</span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
