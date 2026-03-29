import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import type { KeyValueEntry } from "@/types/api";

interface KeyValueTableProps {
  items: KeyValueEntry[];
  onChange: (items: KeyValueEntry[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  readOnly?: boolean;
}

export function KeyValueTable({
  items,
  onChange,
  keyPlaceholder = "Key",
  valuePlaceholder = "Value",
  readOnly = false,
}: KeyValueTableProps) {
  const updateItem = (index: number, field: keyof KeyValueEntry, value: string | boolean) => {
    const updated = items.map((item, i) =>
      i === index ? { ...item, [field]: value } : item,
    );
    onChange(updated);
  };

  const addItem = () => {
    onChange([...items, { key: "", value: "", enabled: true }]);
  };

  const removeItem = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-1">
      {/* Header */}
      <div className="grid grid-cols-[28px_1fr_1fr_28px] gap-1 px-1 text-[11px] font-medium text-muted-foreground">
        <span />
        <span>{keyPlaceholder}</span>
        <span>{valuePlaceholder}</span>
        <span />
      </div>

      {/* Rows */}
      {items.map((item, index) => (
        <div
          key={index}
          className="group grid grid-cols-[28px_1fr_1fr_28px] items-center gap-1"
        >
          <Checkbox
            checked={item.enabled}
            onCheckedChange={(checked) =>
              updateItem(index, "enabled", !!checked)
            }
            disabled={readOnly}
            className="h-4 w-4"
          />
          <Input
            value={item.key}
            onChange={(e) => updateItem(index, "key", e.target.value)}
            placeholder={keyPlaceholder}
            disabled={readOnly}
            className="h-7 border-white/10 bg-white/5 text-xs"
          />
          <Input
            value={item.value}
            onChange={(e) => updateItem(index, "value", e.target.value)}
            placeholder={valuePlaceholder}
            disabled={readOnly}
            className="h-7 border-white/10 bg-white/5 text-xs"
          />
          {!readOnly && (
            <button
              onClick={() => removeItem(index)}
              className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ))}

      {/* Add row */}
      {!readOnly && (
        <Button
          variant="ghost"
          size="sm"
          onClick={addItem}
          className="h-7 gap-1 text-xs text-muted-foreground"
        >
          <Plus className="h-3 w-3" />
          Add
        </Button>
      )}
    </div>
  );
}
