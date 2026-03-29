import { Repeat } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { describeRRule } from "@/lib/recurrence";

interface RecurrencePickerProps {
  value: string | null;
  onChange: (rule: string | null) => void;
}

const PRESETS = [
  { value: "__none__", label: "No repeat" },
  { value: "RRULE:FREQ=DAILY", label: "Every day" },
  { value: "RRULE:FREQ=WEEKLY", label: "Every week" },
  { value: "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", label: "Weekdays" },
  { value: "RRULE:FREQ=MONTHLY", label: "Every month" },
];

export function RecurrencePicker({ value, onChange }: RecurrencePickerProps) {
  const currentPreset = PRESETS.find((p) => p.value === value)?.value
    ?? (value ? "__custom__" : "__none__");

  return (
    <div className="flex items-center gap-3">
      <span className="flex w-20 items-center gap-1 text-xs text-muted-foreground">
        <Repeat className="h-3 w-3" />
        Repeat
      </span>
      <Select
        value={currentPreset}
        onValueChange={(v) => {
          if (v === "__none__") onChange(null);
          else if (v === "__custom__") return; // ignore
          else onChange(v);
        }}
      >
        <SelectTrigger className="h-7 flex-1 text-xs">
          <SelectValue placeholder="No repeat">
            {value ? describeRRule(value) : "No repeat"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {PRESETS.map((p) => (
            <SelectItem key={p.value} value={p.value}>
              {p.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
