import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toByteArray } from "./useCredentials";

interface TotpCode {
  code: string;
  remaining_seconds: number;
  period: number;
}

interface UseTotpOptions {
  encryptedSecret: unknown;
  iv: unknown;
  digits?: number;
  period?: number;
  algorithm?: string;
  enabled?: boolean;
}

export function useTotp({
  encryptedSecret,
  iv,
  digits,
  period = 30,
  algorithm,
  enabled = true,
}: UseTotpOptions) {
  const [code, setCode] = useState<string | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(period);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchCode = useCallback(async () => {
    try {
      const result = await invoke<TotpCode>("totp_generate_code", {
        encryptedSecret: toByteArray(encryptedSecret),
        iv: toByteArray(iv),
        digits: digits ?? null,
        period: period ?? null,
        algorithm: algorithm ?? null,
      });
      setCode(result.code);
      setRemainingSeconds(result.remaining_seconds);
      setError(null);
      return result;
    } catch (err) {
      setError(String(err));
      setCode(null);
      return null;
    }
  }, [encryptedSecret, iv, digits, period, algorithm]);

  useEffect(() => {
    if (!enabled) return;

    // Fetch initially
    fetchCode();

    // Tick every second
    timerRef.current = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          // Refetch when period expires
          fetchCode();
          return period;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [enabled, fetchCode, period]);

  return {
    code,
    remainingSeconds,
    period,
    error,
    refresh: fetchCode,
  };
}
