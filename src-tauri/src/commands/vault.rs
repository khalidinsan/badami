use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use argon2::{self, Argon2, Algorithm, Params, Version};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

const APP_SECRET: &str = "badami-credential-vault-v1";

/// Holds the current encryption key in memory.
/// - When no master password is set: derived from machine identity.
/// - When master password is set: derived from master password + salt.
/// - When vault is locked: key is None → all decrypt operations fail.
pub struct VaultState {
    inner: Mutex<VaultInner>,
}

struct VaultInner {
    encryption_key: Option<[u8; 32]>,
    is_locked: bool,
    has_master_password: bool,
}

impl VaultState {
    pub fn new() -> Self {
        // Start unlocked with machine-bound key (no master password mode)
        let machine_key = derive_machine_key();
        Self {
            inner: Mutex::new(VaultInner {
                encryption_key: Some(machine_key),
                is_locked: false,
                has_master_password: false,
            }),
        }
    }

    pub fn get_key(&self) -> Result<[u8; 32], String> {
        let inner = self.inner.lock().map_err(|e| format!("Lock error: {e}"))?;
        if inner.is_locked {
            return Err("Vault is locked. Please unlock first.".to_string());
        }
        inner
            .encryption_key
            .ok_or_else(|| "No encryption key available".to_string())
    }
}

/// Derive a deterministic 256-bit key from machine identity.
/// Used when no master password is configured.
fn derive_machine_key() -> [u8; 32] {
    let hostname = hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|_| "unknown-host".to_string());

    let input = format!("{APP_SECRET}:{hostname}");
    let salt = b"badami-machine-salt-v1";

    let params = Params::new(19456, 2, 1, Some(32)).unwrap_or_else(|_| Params::default());
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);

    let mut key = [0u8; 32];
    argon2
        .hash_password_into(input.as_bytes(), salt, &mut key)
        .expect("Argon2 machine key derivation failed");
    key
}

/// Derive a 256-bit key from master password + random salt.
fn derive_master_password_key(password: &str, salt: &[u8]) -> [u8; 32] {
    // Higher cost for user-facing password derivation
    let params = Params::new(65536, 3, 1, Some(32)).unwrap_or_else(|_| Params::default());
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);

    let mut key = [0u8; 32];
    argon2
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .expect("Argon2 master password key derivation failed");
    key
}

// ─── Tauri Commands ─────────────────────────────────────────────────

#[derive(Serialize, Deserialize)]
pub struct VaultStatus {
    pub is_locked: bool,
    pub has_master_password: bool,
}

#[tauri::command]
pub fn vault_get_status(state: tauri::State<'_, VaultState>) -> Result<VaultStatus, String> {
    let inner = state.inner.lock().map_err(|e| format!("Lock error: {e}"))?;
    Ok(VaultStatus {
        is_locked: inner.is_locked,
        has_master_password: inner.has_master_password,
    })
}

/// Lock the vault — clear the encryption key from memory.
#[tauri::command]
pub fn vault_lock(state: tauri::State<'_, VaultState>) -> Result<(), String> {
    let mut inner = state.inner.lock().map_err(|e| format!("Lock error: {e}"))?;
    if !inner.has_master_password {
        return Err("Cannot lock vault without a master password configured".to_string());
    }
    inner.encryption_key = None;
    inner.is_locked = true;
    Ok(())
}

/// Unlock the vault with a master password.
/// Derives the key and stores it in memory.
#[tauri::command]
pub fn vault_unlock(
    password: String,
    salt: Vec<u8>,
    state: tauri::State<'_, VaultState>,
) -> Result<(), String> {
    let key = derive_master_password_key(&password, &salt);
    let mut inner = state.inner.lock().map_err(|e| format!("Lock error: {e}"))?;
    inner.encryption_key = Some(key);
    inner.is_locked = false;
    Ok(())
}

/// Enable master password. Returns the generated salt (to be stored in vault_config).
/// Re-encrypts nothing here — the caller must re-encrypt all existing fields.
#[tauri::command]
pub fn vault_set_master_password(
    password: String,
    state: tauri::State<'_, VaultState>,
) -> Result<Vec<u8>, String> {
    let mut salt = [0u8; 32];
    OsRng.fill_bytes(&mut salt);

    let key = derive_master_password_key(&password, &salt);
    let mut inner = state.inner.lock().map_err(|e| format!("Lock error: {e}"))?;
    inner.encryption_key = Some(key);
    inner.has_master_password = true;
    inner.is_locked = false;

    Ok(salt.to_vec())
}

/// Remove master password — revert to machine-bound key.
/// The caller must re-encrypt all existing fields with the new key.
#[tauri::command]
pub fn vault_remove_master_password(
    state: tauri::State<'_, VaultState>,
) -> Result<(), String> {
    let machine_key = derive_machine_key();
    let mut inner = state.inner.lock().map_err(|e| format!("Lock error: {e}"))?;
    inner.encryption_key = Some(machine_key);
    inner.has_master_password = false;
    inner.is_locked = false;
    Ok(())
}

/// Initialize vault state based on DB config.
/// Called once from frontend after reading vault_config from DB.
#[tauri::command]
pub fn vault_init(
    has_master_password: bool,
    state: tauri::State<'_, VaultState>,
) -> Result<(), String> {
    let mut inner = state.inner.lock().map_err(|e| format!("Lock error: {e}"))?;
    inner.has_master_password = has_master_password;
    if has_master_password {
        // Vault should be locked until user provides master password
        inner.encryption_key = None;
        inner.is_locked = true;
    } else {
        // No master password → use machine-bound key, unlocked
        inner.encryption_key = Some(derive_machine_key());
        inner.is_locked = false;
    }
    Ok(())
}

// ─── Encrypt / Decrypt helpers (used by credentials.rs) ─────────────

pub fn encrypt_value(plaintext: &str, key: &[u8; 32]) -> Result<(Vec<u8>, Vec<u8>), String> {
    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|e| format!("Cipher init error: {e}"))?;

    let mut iv_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut iv_bytes);
    let nonce = Nonce::from_slice(&iv_bytes);

    let encrypted = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| format!("Encryption failed: {e}"))?;

    Ok((encrypted, iv_bytes.to_vec()))
}

pub fn decrypt_value(encrypted: &[u8], iv: &[u8], key: &[u8; 32]) -> Result<String, String> {
    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|e| format!("Cipher init error: {e}"))?;
    let nonce = Nonce::from_slice(iv);

    let decrypted = cipher
        .decrypt(nonce, encrypted)
        .map_err(|e| format!("Decryption failed: {e}"))?;

    String::from_utf8(decrypted).map_err(|e| format!("UTF-8 error: {e}"))
}

/// Encrypt a value using the current vault key. Returns (encrypted_data, iv).
#[tauri::command]
pub fn vault_encrypt(
    plaintext: String,
    state: tauri::State<'_, VaultState>,
) -> Result<(Vec<u8>, Vec<u8>), String> {
    let key = state.get_key()?;
    encrypt_value(&plaintext, &key)
}

/// Decrypt a value using the current vault key.
#[tauri::command]
pub fn vault_decrypt(
    encrypted_data: Vec<u8>,
    iv: Vec<u8>,
    state: tauri::State<'_, VaultState>,
) -> Result<String, String> {
    let key = state.get_key()?;
    decrypt_value(&encrypted_data, &iv, &key)
}
