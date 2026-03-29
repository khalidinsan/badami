import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useCredentialStore } from "@/stores/credentialStore";
import * as credentialQueries from "@/db/queries/credentials";
import type { CredentialFieldRow, CredentialEnvVarRow } from "@/types/db";

/**
 * tauri-plugin-sql binding stores JavaScript arrays as JSON-encoded TEXT
 * in SQLite (not a true BLOB). When reading back, the value is a JSON string
 * like "[123,45,...]" instead of number[]. This normalizes any format back
 * to a plain number[] so Rust's Vec<u8> deserializer accepts it.
 */
export function toByteArray(val: unknown): number[] {
  if (!val) return [];
  if (Array.isArray(val)) return val as number[];
  if (val instanceof Uint8Array) return Array.from(val);
  if (typeof val === "string") {
    try {
      const parsed: unknown = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed as number[];
    } catch { /* empty */ }
  }
  return [];
}

export function useCredentials(projectId?: string) {
  const {
    credentials,
    loading,
    loadAllCredentials,
    loadCredentialsByProject,
    createCredential,
    updateCredential,
    deleteCredential,
  } = useCredentialStore();

  const reload = useCallback(() => {
    if (projectId) {
      loadCredentialsByProject(projectId);
    } else {
      loadAllCredentials();
    }
  }, [projectId, loadAllCredentials, loadCredentialsByProject]);

  const getFields = useCallback(
    async (credentialId: string): Promise<CredentialFieldRow[]> => {
      return credentialQueries.getFieldsByCredential(credentialId);
    },
    [],
  );

  const getEnvVars = useCallback(
    async (credentialId: string): Promise<CredentialEnvVarRow[]> => {
      return credentialQueries.getEnvVarsByCredential(credentialId);
    },
    [],
  );

  const decryptField = useCallback(
    async (encryptedValue: unknown, iv: unknown): Promise<string> => {
      return invoke<string>("credential_decrypt_field", {
        encryptedValue: toByteArray(encryptedValue),
        iv: toByteArray(iv),
      });
    },
    [],
  );

  const encryptFields = useCallback(
    async (
      fields: [string, string, string][],
    ): Promise<
      { field_key: string; field_label: string; encrypted_value: number[]; iv: number[] }[]
    > => {
      return invoke("credential_encrypt_fields", { fields });
    },
    [],
  );

  const copyToClipboard = useCallback(
    async (encryptedValue: unknown, iv: unknown) => {
      await invoke("credential_copy_to_clipboard", {
        encryptedValue: toByteArray(encryptedValue),
        iv: toByteArray(iv),
      });
    },
    [],
  );

  const copyPlainToClipboard = useCallback(async (value: string) => {
    await invoke("credential_copy_plain_to_clipboard", { value });
  }, []);

  const saveFieldsForCredential = useCallback(
    async (
      credentialId: string,
      sensitiveFields: Record<string, { label: string; value: string }>,
      plainFields: Record<string, { label: string; value: string }>,
    ) => {
      // Delete existing fields
      await credentialQueries.deleteFieldsByCredential(credentialId);

      let order = 0;

      // Save plain fields
      for (const [key, { label, value }] of Object.entries(plainFields)) {
        await credentialQueries.createCredentialField({
          credential_id: credentialId,
          field_key: key,
          field_label: label,
          plain_value: value,
          is_sensitive: 0,
          field_order: order++,
        });
      }

      // Encrypt and save sensitive fields
      const toEncrypt: [string, string, string][] = Object.entries(
        sensitiveFields,
      ).map(([key, { label, value }]) => [key, label, value]);

      if (toEncrypt.length > 0) {
        const encrypted = await encryptFields(toEncrypt);
        for (const field of encrypted) {
          await credentialQueries.createCredentialField({
            credential_id: credentialId,
            field_key: field.field_key,
            field_label: field.field_label,
            encrypted_value: field.encrypted_value,
            iv: field.iv,
            is_sensitive: 1,
            field_order: order++,
          });
        }
      }
    },
    [encryptFields],
  );

  const saveEnvVars = useCallback(
    async (
      credentialId: string,
      vars: { key: string; value: string }[],
    ) => {
      await credentialQueries.deleteEnvVarsByCredential(credentialId);
      for (let i = 0; i < vars.length; i++) {
        const { key, value } = vars[i];
        const [encrypted] = await encryptFields([[key, key, value]]);
        await credentialQueries.createEnvVar({
          credential_id: credentialId,
          var_key: key,
          encrypted_value: encrypted.encrypted_value,
          iv: encrypted.iv,
          var_order: i,
        });
      }
    },
    [encryptFields],
  );

  return {
    credentials,
    loading,
    reload,
    createCredential,
    updateCredential,
    deleteCredential,
    getFields,
    getEnvVars,
    decryptField,
    encryptFields,
    copyToClipboard,
    copyPlainToClipboard,
    saveFieldsForCredential,
    saveEnvVars,
  };
}
