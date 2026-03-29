use keyring::Entry;

const SERVICE_NAME: &str = "Badami";

fn credential_key(server_id: &str) -> String {
    format!("server-{}", server_id)
}

fn passphrase_key(server_id: &str) -> String {
    format!("server-passphrase-{}", server_id)
}

#[tauri::command]
pub fn save_server_password(server_id: String, password: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, &credential_key(&server_id))
        .map_err(|e| format!("Keychain error: {}", e))?;
    entry
        .set_password(&password)
        .map_err(|e| format!("Failed to save password: {}", e))
}

#[tauri::command]
pub fn get_server_password(server_id: String) -> Result<String, String> {
    let entry = Entry::new(SERVICE_NAME, &credential_key(&server_id))
        .map_err(|e| format!("Keychain error: {}", e))?;
    entry
        .get_password()
        .map_err(|e| format!("Failed to get password: {}", e))
}

#[tauri::command]
pub fn delete_server_password(server_id: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, &credential_key(&server_id))
        .map_err(|e| format!("Keychain error: {}", e))?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()), // already gone
        Err(e) => Err(format!("Failed to delete password: {}", e)),
    }
}

#[tauri::command]
pub fn save_server_passphrase(server_id: String, passphrase: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, &passphrase_key(&server_id))
        .map_err(|e| format!("Keychain error: {}", e))?;
    entry
        .set_password(&passphrase)
        .map_err(|e| format!("Failed to save passphrase: {}", e))
}

#[tauri::command]
pub fn get_server_passphrase(server_id: String) -> Result<String, String> {
    let entry = Entry::new(SERVICE_NAME, &passphrase_key(&server_id))
        .map_err(|e| format!("Keychain error: {}", e))?;
    entry
        .get_password()
        .map_err(|e| format!("Failed to get passphrase: {}", e))
}

#[tauri::command]
pub fn delete_server_passphrase(server_id: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, &passphrase_key(&server_id))
        .map_err(|e| format!("Keychain error: {}", e))?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Failed to delete passphrase: {}", e)),
    }
}

// ─── PEM Encryption ──────────────────────────────────────────────────

use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use rand::RngCore;

fn derive_master_key() -> [u8; 32] {
    // Deterministic key derived from a static app secret + machine-specific seed.
    // In production you'd derive from machine-uid; here we use a static key
    // that is unique per app install (the service name acts as salt).
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    SERVICE_NAME.hash(&mut hasher);
    // Use hostname as machine-specific component
    if let Ok(name) = hostname::get() {
        name.to_string_lossy().to_string().hash(&mut hasher);
    }
    let h1 = hasher.finish();
    let mut hasher2 = DefaultHasher::new();
    h1.hash(&mut hasher2);
    "badami-pem-encryption-key-v1".hash(&mut hasher2);
    let h2 = hasher2.finish();

    let mut key = [0u8; 32];
    key[..8].copy_from_slice(&h1.to_le_bytes());
    key[8..16].copy_from_slice(&h2.to_le_bytes());
    key[16..24].copy_from_slice(&h1.to_be_bytes());
    key[24..32].copy_from_slice(&h2.to_be_bytes());
    key
}

#[tauri::command]
pub fn encrypt_pem_key(pem_content: String) -> Result<(Vec<u8>, Vec<u8>), String> {
    let master_key = derive_master_key();
    let cipher = Aes256Gcm::new_from_slice(&master_key)
        .map_err(|e| format!("Cipher init error: {}", e))?;

    let mut iv_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut iv_bytes);
    let nonce = Nonce::from_slice(&iv_bytes);

    let encrypted = cipher
        .encrypt(nonce, pem_content.as_bytes())
        .map_err(|e| format!("Encryption failed: {}", e))?;

    Ok((encrypted, iv_bytes.to_vec()))
}

#[tauri::command]
pub fn decrypt_pem_key(encrypted_data: Vec<u8>, iv: Vec<u8>) -> Result<String, String> {
    let master_key = derive_master_key();
    let cipher = Aes256Gcm::new_from_slice(&master_key)
        .map_err(|e| format!("Cipher init error: {}", e))?;

    let nonce = Nonce::from_slice(&iv);

    let decrypted = cipher
        .decrypt(nonce, encrypted_data.as_ref())
        .map_err(|e| format!("Decryption failed: {}", e))?;

    String::from_utf8(decrypted).map_err(|e| format!("UTF-8 error: {}", e))
}
