use super::vault::VaultState;
use serde::{Deserialize, Serialize};
use tauri::Emitter;

#[derive(Serialize, Deserialize)]
pub struct EncryptedFieldResult {
    pub field_key: String,
    pub field_label: String,
    pub encrypted_value: Vec<u8>,
    pub iv: Vec<u8>,
}

/// Encrypt multiple sensitive fields at once.
/// Input: Vec of (field_key, field_label, plaintext_value)
/// Output: Vec of EncryptedFieldResult
#[tauri::command]
pub fn credential_encrypt_fields(
    fields: Vec<(String, String, String)>,
    state: tauri::State<'_, VaultState>,
) -> Result<Vec<EncryptedFieldResult>, String> {
    let key = state.get_key()?;

    let mut results = Vec::new();
    for (field_key, field_label, plaintext) in fields {
        let (encrypted, iv) = super::vault::encrypt_value(&plaintext, &key)?;
        results.push(EncryptedFieldResult {
            field_key,
            field_label,
            encrypted_value: encrypted,
            iv,
        });
    }

    Ok(results)
}

/// Decrypt a single field value.
#[tauri::command]
pub fn credential_decrypt_field(
    encrypted_value: Vec<u8>,
    iv: Vec<u8>,
    state: tauri::State<'_, VaultState>,
) -> Result<String, String> {
    let key = state.get_key()?;
    super::vault::decrypt_value(&encrypted_value, &iv, &key)
}

/// Copy a decrypted value to clipboard and auto-clear after 30 seconds.
#[tauri::command]
pub async fn credential_copy_to_clipboard(
    encrypted_value: Vec<u8>,
    iv: Vec<u8>,
    app: tauri::AppHandle,
    state: tauri::State<'_, VaultState>,
) -> Result<(), String> {
    let key = state.get_key()?;
    let plaintext = super::vault::decrypt_value(&encrypted_value, &iv, &key)?;

    let mut clipboard =
        arboard::Clipboard::new().map_err(|e| format!("Clipboard error: {e}"))?;
    clipboard
        .set_text(plaintext.clone())
        .map_err(|e| format!("Clipboard set error: {e}"))?;

    // Auto-clear after 30 seconds
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(30)).await;
        if let Ok(mut cb) = arboard::Clipboard::new() {
            let current = cb.get_text().unwrap_or_default();
            if current == plaintext {
                let _ = cb.set_text(String::new());
            }
        }
        let _ = app.emit("clipboard-cleared", ());
    });

    Ok(())
}

/// Copy a plain (non-encrypted) value to clipboard with auto-clear.
#[tauri::command]
pub async fn credential_copy_plain_to_clipboard(
    value: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let mut clipboard =
        arboard::Clipboard::new().map_err(|e| format!("Clipboard error: {e}"))?;
    clipboard
        .set_text(value.clone())
        .map_err(|e| format!("Clipboard set error: {e}"))?;

    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(30)).await;
        if let Ok(mut cb) = arboard::Clipboard::new() {
            let current = cb.get_text().unwrap_or_default();
            if current == value {
                let _ = cb.set_text(String::new());
            }
        }
        let _ = app.emit("clipboard-cleared", ());
    });

    Ok(())
}
