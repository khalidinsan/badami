import { useEffect, useRef, useCallback } from "react";
import { useCredentialStore } from "@/stores/credentialStore";

export function useVault() {
  const {
    vaultConfig,
    isVaultLocked,
    initVault,
    lockVault,
    unlockVault,
    loadVaultConfig,
  } = useCredentialStore();

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoLockMinutes = vaultConfig?.auto_lock_minutes ?? 15;
  const hasMasterPassword = vaultConfig?.has_master_password === 1;

  // Reset idle timer on user activity
  const resetIdleTimer = useCallback(() => {
    if (!hasMasterPassword || isVaultLocked) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(
      () => {
        lockVault();
      },
      autoLockMinutes * 60 * 1000,
    );
  }, [hasMasterPassword, isVaultLocked, autoLockMinutes, lockVault]);

  // Auto-lock timer
  useEffect(() => {
    if (!hasMasterPassword || isVaultLocked) return;

    const events = ["mousedown", "keydown", "scroll", "touchstart"];
    for (const event of events) {
      window.addEventListener(event, resetIdleTimer);
    }
    resetIdleTimer();

    return () => {
      for (const event of events) {
        window.removeEventListener(event, resetIdleTimer);
      }
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [hasMasterPassword, isVaultLocked, resetIdleTimer]);

  return {
    vaultConfig,
    isVaultLocked,
    hasMasterPassword,
    initVault,
    lockVault,
    unlockVault,
    loadVaultConfig,
  };
}
