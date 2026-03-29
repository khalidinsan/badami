import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

interface PasswordOptions {
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  numbers: boolean;
  symbols: boolean;
  excludeAmbiguous: boolean;
}

interface GeneratedPassword {
  password: string;
  strength: string;
}

const DEFAULT_OPTIONS: PasswordOptions = {
  length: 20,
  uppercase: true,
  lowercase: true,
  numbers: true,
  symbols: true,
  excludeAmbiguous: false,
};

export function usePasswordGenerator() {
  const [options, setOptions] = useState<PasswordOptions>(DEFAULT_OPTIONS);
  const [result, setResult] = useState<GeneratedPassword | null>(null);
  const [generating, setGenerating] = useState(false);

  const generate = useCallback(async (opts?: Partial<PasswordOptions>) => {
    const merged = opts ? { ...options, ...opts } : options;
    if (opts) setOptions(merged);
    setGenerating(true);
    try {
      const res = await invoke<GeneratedPassword>("generate_password", {
        options: {
          length: merged.length,
          uppercase: merged.uppercase,
          lowercase: merged.lowercase,
          numbers: merged.numbers,
          symbols: merged.symbols,
          exclude_ambiguous: merged.excludeAmbiguous,
        },
      });
      setResult(res);
      return res;
    } catch (err) {
      console.error("Password generation failed:", err);
      return null;
    } finally {
      setGenerating(false);
    }
  }, [options]);

  const updateOption = useCallback(<K extends keyof PasswordOptions>(
    key: K,
    value: PasswordOptions[K],
  ) => {
    setOptions((prev) => ({ ...prev, [key]: value }));
  }, []);

  return {
    options,
    result,
    generating,
    generate,
    updateOption,
    setOptions,
  };
}
