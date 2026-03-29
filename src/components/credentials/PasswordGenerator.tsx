import { useEffect, useState } from "react";
import {
  Dices,
  Copy,
  Check,
  RefreshCw,
  ShieldCheck,
  Shield,
  ShieldAlert,
  ShieldX,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { usePasswordGenerator } from "@/hooks/usePasswordGenerator";
import { cn } from "@/lib/utils";

interface PasswordGeneratorProps {
  onUsePassword?: (password: string) => void;
}

const STRENGTH_MAP: Record<
  string,
  { icon: typeof ShieldCheck; color: string; bg: string }
> = {
  "Very Strong": { icon: ShieldCheck, color: "text-green-500", bg: "bg-green-500" },
  Strong: { icon: Shield, color: "text-blue-500", bg: "bg-blue-500" },
  Medium: { icon: ShieldAlert, color: "text-yellow-500", bg: "bg-yellow-500" },
  Weak: { icon: ShieldX, color: "text-red-500", bg: "bg-red-500" },
};

export function PasswordGenerator({ onUsePassword }: PasswordGeneratorProps) {
  const { options, result, generating, generate, updateOption } =
    usePasswordGenerator();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    generate();
  }, []);

  const handleCopy = async () => {
    if (!result) return;
    await invoke("credential_copy_plain_to_clipboard", {
      value: result.password,
    });
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const strength = result ? STRENGTH_MAP[result.strength] : null;

  // Strength bar segments
  const strengthLevel =
    result?.strength === "Very Strong"
      ? 4
      : result?.strength === "Strong"
        ? 3
        : result?.strength === "Medium"
          ? 2
          : 1;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-xs"
        >
          <Dices className="h-3 w-3" />
          Generate
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-4">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Dices className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Password Generator</h3>
          </div>

          {/* Generated password */}
          <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
            <p className="break-all font-mono text-sm font-medium leading-relaxed">
              {result?.password ?? "..."}
            </p>
            <div className="mt-2 flex items-center justify-between">
              {/* Strength */}
              <div className="flex items-center gap-2">
                <div className="flex gap-0.5">
                  {[1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      className={cn(
                        "h-1 w-5 rounded-full transition-colors",
                        i <= strengthLevel
                          ? strength?.bg ?? "bg-muted"
                          : "bg-muted",
                      )}
                    />
                  ))}
                </div>
                <span className={cn("text-[11px] font-medium", strength?.color)}>
                  {result?.strength ?? "—"}
                </span>
              </div>

              {/* Buttons */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => generate()}
                  disabled={generating}
                  className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground transition-colors"
                >
                  <RefreshCw
                    className={cn(
                      "h-3.5 w-3.5",
                      generating && "animate-spin",
                    )}
                  />
                </button>
                <button
                  onClick={handleCopy}
                  className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground transition-colors"
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5 text-green-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>
          </div>

          <Separator />

          {/* Options */}
          <div className="space-y-2.5">
            {/* Length slider */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Length</Label>
                <span className="text-xs font-mono text-muted-foreground">
                  {options.length}
                </span>
              </div>
              <input
                type="range"
                min={4}
                max={128}
                value={options.length}
                onChange={(e) => {
                  updateOption("length", parseInt(e.target.value));
                }}
                onMouseUp={() => generate()}
                onTouchEnd={() => generate()}
                className="w-full accent-primary"
              />
            </div>

            {/* Char type checkboxes */}
            <div className="grid grid-cols-2 gap-2">
              {[
                { key: "uppercase" as const, label: "Uppercase (A-Z)" },
                { key: "lowercase" as const, label: "Lowercase (a-z)" },
                { key: "numbers" as const, label: "Numbers (0-9)" },
                { key: "symbols" as const, label: "Symbols (!@#)" },
              ].map(({ key, label }) => (
                <label
                  key={key}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <Checkbox
                    checked={options[key]}
                    onCheckedChange={(checked) => {
                      updateOption(key, !!checked);
                      setTimeout(() => generate(), 0);
                    }}
                  />
                  <span className="text-xs">{label}</span>
                </label>
              ))}
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                checked={options.excludeAmbiguous}
                onCheckedChange={(checked) => {
                  updateOption("excludeAmbiguous", !!checked);
                  setTimeout(() => generate(), 0);
                }}
              />
              <span className="text-xs">Exclude ambiguous (0, O, l, 1, I)</span>
            </label>
          </div>

          {/* Use button */}
          {onUsePassword && result && (
            <>
              <Separator />
              <Button
                size="sm"
                className="w-full text-xs"
                onClick={() => onUsePassword(result.password)}
              >
                Use this password
              </Button>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
