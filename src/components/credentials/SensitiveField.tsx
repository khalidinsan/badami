import { useState, useCallback } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CopyButton } from "./CopyButton";

interface SensitiveFieldProps {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  onCopy?: () => void;
  copyLabel?: string;
}

export function SensitiveField({
  label,
  value,
  onChange,
  readOnly,
  placeholder,
  onCopy,
  copyLabel,
}: SensitiveFieldProps) {
  const [visible, setVisible] = useState(false);

  const toggle = useCallback(() => setVisible((v) => !v), []);

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <div className="relative flex items-center gap-1">
        <Input
          type={visible ? "text" : "password"}
          value={value}
          onChange={onChange ? (e) => onChange(e.target.value) : undefined}
          readOnly={readOnly}
          placeholder={placeholder}
          className="h-8 pr-16 text-xs font-mono"
        />
        <div className="absolute right-1 flex items-center gap-0.5">
          <button
            type="button"
            onClick={toggle}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground transition-colors"
          >
            {visible ? (
              <EyeOff className="h-3.5 w-3.5" />
            ) : (
              <Eye className="h-3.5 w-3.5" />
            )}
          </button>
          {onCopy && <CopyButton onCopy={onCopy} label={copyLabel} />}
        </div>
      </div>
    </div>
  );
}
