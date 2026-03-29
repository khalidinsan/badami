import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import * as credentialQueries from "@/db/queries/credentials";
import { useCredentialStore } from "@/stores/credentialStore";
import { toByteArray } from "./useCredentials";

/**
 * Hook for managing master password: set, remove, change.
 * Handles the full re-encryption flow when the key changes.
 */
export function useMasterPassword() {
  const {
    loadVaultConfig,
    vaultConfig,
  } = useCredentialStore();
  const [processing, setProcessing] = useState(false);

  /**
   * Enable master password for the first time.
   * 1. Decrypt all sensitive data with current (machine) key
   * 2. Set master password (changes key in memory)
   * 3. Re-encrypt all sensitive data with new key
   * 4. Save salt + hint in vault_config
   */
  const enableMasterPassword = useCallback(
    async (password: string, hint: string) => {
      setProcessing(true);
      try {
        // Step 1: Decrypt everything with current key
        const decrypted = await decryptAllSensitiveData();

        // Step 2: Set master password in Rust (changes the in-memory key)
        const salt = await invoke<number[]>("vault_set_master_password", {
          password,
        });

        // Step 3: Re-encrypt everything with the new key
        await reEncryptAllData(decrypted);

        // Step 4: Update vault_config
        await credentialQueries.updateVaultConfig({
          has_master_password: 1,
          password_hint: hint || null,
          argon2_salt: salt,
        });

        await loadVaultConfig();
        toast.success("Master password enabled");
      } catch (err) {
        console.error("Failed to enable master password:", err);
        toast.error("Failed to enable master password");
        throw err;
      } finally {
        setProcessing(false);
      }
    },
    [loadVaultConfig],
  );

  /**
   * Remove master password — revert to machine-bound key.
   * 1. Verify current password by unlocking vault
   * 2. Decrypt all sensitive data with current (master) key
   * 3. Remove master password (reverts to machine key)
   * 4. Re-encrypt all with machine key
   * 5. Clear salt+hint from vault_config
   */
  const removeMasterPassword = useCallback(async (currentPassword: string) => {
    setProcessing(true);
    try {
      // Unlock first (verifies password + puts key in memory)
      const config = useCredentialStore.getState().vaultConfig;
      if (!config?.argon2_salt) throw new Error("Vault not configured");
      const salt = toByteArray(config.argon2_salt);
      await invoke("vault_unlock", { password: currentPassword, salt });
      useCredentialStore.setState({ isVaultLocked: false });

      const decrypted = await decryptAllSensitiveData();

      await invoke("vault_remove_master_password");

      await reEncryptAllData(decrypted);

      await credentialQueries.updateVaultConfig({
        has_master_password: 0,
        password_hint: null,
        argon2_salt: null,
      });

      await loadVaultConfig();
      toast.success("Master password removed");
    } catch (err) {
      console.error("Failed to remove master password:", err);
      toast.error("Failed to remove master password");
      throw err;
    } finally {
      setProcessing(false);
    }
  }, [loadVaultConfig]);

  /**
   * Change master password.
   * 1. Verify current password by unlocking vault
   * 2. Decrypt all with old key
   * 3. Set new master password (changes key)
   * 4. Re-encrypt all with new key
   * 5. Update salt+hint in vault_config
   */
  const changeMasterPassword = useCallback(
    async (currentPassword: string, newPassword: string, newHint: string) => {
      setProcessing(true);
      try {
        // Unlock first (verifies current password + puts key in memory)
        const config = useCredentialStore.getState().vaultConfig;
        if (!config?.argon2_salt) throw new Error("Vault not configured");
        const salt = toByteArray(config.argon2_salt);
        await invoke("vault_unlock", { password: currentPassword, salt });
        useCredentialStore.setState({ isVaultLocked: false });

        const decrypted = await decryptAllSensitiveData();

        const newSalt = await invoke<number[]>("vault_set_master_password", {
          password: newPassword,
        });

        await reEncryptAllData(decrypted);

        await credentialQueries.updateVaultConfig({
          password_hint: newHint || null,
          argon2_salt: newSalt,
        });

        await loadVaultConfig();
        toast.success("Master password changed");
      } catch (err) {
        console.error("Failed to change master password:", err);
        toast.error("Failed to change master password");
        throw err;
      } finally {
        setProcessing(false);
      }
    },
    [loadVaultConfig],
  );

  /**
   * Update auto-lock timeout.
   */
  const setAutoLockMinutes = useCallback(
    async (minutes: number) => {
      await credentialQueries.updateVaultConfig({
        auto_lock_minutes: minutes,
      });
      await loadVaultConfig();
    },
    [loadVaultConfig],
  );

  return {
    processing,
    vaultConfig,
    enableMasterPassword,
    removeMasterPassword,
    changeMasterPassword,
    setAutoLockMinutes,
  };
}

// ─── Internal helpers ───────────────────────────────────────────────

interface DecryptedData {
  fields: { id: string; plaintext: string }[];
  totps: { id: string; plaintext: string }[];
  envVars: { id: string; plaintext: string }[];
}

/** Decrypt all sensitive credential data using the current key. */
async function decryptAllSensitiveData(): Promise<DecryptedData> {
  const [fields, totps, envVars] = await Promise.all([
    credentialQueries.getAllSensitiveFields(),
    credentialQueries.getAllTotpRecords(),
    credentialQueries.getAllEnvVars(),
  ]);

  const decryptedFields: { id: string; plaintext: string }[] = [];
  for (const f of fields) {
    if (f.encrypted_value && f.iv) {
      const plaintext = await invoke<string>("vault_decrypt", {
        encryptedData: toByteArray(f.encrypted_value),
        iv: toByteArray(f.iv),
      });
      decryptedFields.push({ id: f.id, plaintext });
    }
  }

  const decryptedTotps: { id: string; plaintext: string }[] = [];
  for (const t of totps) {
    const plaintext = await invoke<string>("vault_decrypt", {
      encryptedData: toByteArray(t.encrypted_secret),
      iv: toByteArray(t.iv),
    });
    decryptedTotps.push({ id: t.id, plaintext });
  }

  const decryptedEnvVars: { id: string; plaintext: string }[] = [];
  for (const v of envVars) {
    const plaintext = await invoke<string>("vault_decrypt", {
      encryptedData: toByteArray(v.encrypted_value),
      iv: toByteArray(v.iv),
    });
    decryptedEnvVars.push({ id: v.id, plaintext });
  }

  return { fields: decryptedFields, totps: decryptedTotps, envVars: decryptedEnvVars };
}

/** Re-encrypt all sensitive data using the current (new) key. */
async function reEncryptAllData(data: DecryptedData): Promise<void> {
  for (const f of data.fields) {
    const [encrypted, iv] = await invoke<[number[], number[]]>("vault_encrypt", {
      plaintext: f.plaintext,
    });
    await credentialQueries.updateFieldEncryption(f.id, encrypted, iv);
  }

  for (const t of data.totps) {
    const [encrypted, iv] = await invoke<[number[], number[]]>("vault_encrypt", {
      plaintext: t.plaintext,
    });
    await credentialQueries.updateTotpEncryption(t.id, encrypted, iv);
  }

  for (const v of data.envVars) {
    const [encrypted, iv] = await invoke<[number[], number[]]>("vault_encrypt", {
      plaintext: v.plaintext,
    });
    await credentialQueries.updateEnvVarEncryption(v.id, encrypted, iv);
  }
}
