import { useState } from "react";
import { Bell, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { formatDateTime } from "@/lib/dateUtils";
import type { ReminderRow } from "@/types/db";

interface ReminderPickerProps {
  reminders: ReminderRow[];
  onAdd: (remindAt: string) => void;
  onDelete: (id: string) => void;
}

export function ReminderPicker({ reminders, onAdd, onDelete }: ReminderPickerProps) {
  const [adding, setAdding] = useState(false);
  const [dateVal, setDateVal] = useState("");
  const [timeVal, setTimeVal] = useState("");

  const handleAdd = () => {
    if (!dateVal) return;
    const time = timeVal || "09:00";
    const remindAt = `${dateVal}T${time}:00.000Z`;
    onAdd(remindAt);
    setDateVal("");
    setTimeVal("");
    setAdding(false);
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <Bell className="h-3 w-3 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">
            Reminders{reminders.length > 0 && ` (${reminders.length})`}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5"
          onClick={() => setAdding(true)}
        >
          <Plus className="h-3 w-3" />
        </Button>
      </div>

      {reminders.length > 0 && (
        <div className="space-y-1">
          {reminders.map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between rounded-md bg-muted/30 px-2 py-1"
            >
              <span className="text-[11px] text-muted-foreground">
                {formatDateTime(r.remind_at)}
                {r.is_sent ? " (sent)" : ""}
              </span>
              <button
                onClick={() => onDelete(r.id)}
                className="text-muted-foreground/50 hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {adding && (
        <div className="mt-1.5 flex items-center gap-2">
          <DatePicker
            value={dateVal || null}
            onChange={(date) => setDateVal(date ?? "")}
            size="sm"
            clearable={false}
          />
          <Input
            type="time"
            value={timeVal}
            onChange={(e) => setTimeVal(e.target.value)}
            className="h-7 w-24 text-xs"
          />
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={handleAdd}>
            Add
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => { setAdding(false); setDateVal(""); setTimeVal(""); }}
          >
            Cancel
          </Button>
        </div>
      )}

      {reminders.length === 0 && !adding && (
        <p className="text-[11px] text-muted-foreground/50">No reminders</p>
      )}
    </div>
  );
}
