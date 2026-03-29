import { KeyValueTable } from "../KeyValueTable";
import type { KeyValueEntry } from "@/types/api";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";

const PRESET_HEADERS: { key: string; value: string }[] = [
  { key: "Content-Type", value: "application/json" },
  { key: "Content-Type", value: "application/x-www-form-urlencoded" },
  { key: "Content-Type", value: "multipart/form-data" },
  { key: "Accept", value: "application/json" },
  { key: "Accept", value: "*/*" },
  { key: "Authorization", value: "Bearer " },
  { key: "Cache-Control", value: "no-cache" },
  { key: "User-Agent", value: "Badami/1.0" },
];

interface HeadersTabProps {
  headers: KeyValueEntry[];
  onChange: (headers: KeyValueEntry[]) => void;
}

export function HeadersTab({ headers, onChange }: HeadersTabProps) {
  const addPreset = (preset: { key: string; value: string }) => {
    onChange([...headers, { key: preset.key, value: preset.value, enabled: true }]);
  };

  return (
    <div className="p-3">
      <div className="mb-2 flex items-center justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-6 gap-1 text-[11px] text-muted-foreground">
              Presets <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-60 overflow-y-auto">
            {PRESET_HEADERS.map((p, i) => (
              <DropdownMenuItem key={i} onClick={() => addPreset(p)} className="text-xs">
                <span className="font-medium">{p.key}:</span>&nbsp;
                <span className="text-muted-foreground">{p.value}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <KeyValueTable
        items={headers}
        onChange={onChange}
        keyPlaceholder="Header"
        valuePlaceholder="Value"
      />
    </div>
  );
}
