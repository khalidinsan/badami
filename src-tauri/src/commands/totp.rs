use super::vault::VaultState;
use serde::Serialize;
use totp_rs::{Algorithm, TOTP, Secret};

#[derive(Serialize)]
pub struct TotpCode {
    pub code: String,
    pub remaining_seconds: u64,
    pub period: u64,
}

fn parse_algorithm(alg: &str) -> Algorithm {
    match alg.to_uppercase().as_str() {
        "SHA256" => Algorithm::SHA256,
        "SHA512" => Algorithm::SHA512,
        _ => Algorithm::SHA1,
    }
}

/// Generate a TOTP code from an encrypted secret.
/// Decrypts the secret using the vault key, then generates the current code.
#[tauri::command]
pub fn totp_generate_code(
    encrypted_secret: Vec<u8>,
    iv: Vec<u8>,
    digits: Option<u32>,
    period: Option<u64>,
    algorithm: Option<String>,
    state: tauri::State<'_, VaultState>,
) -> Result<TotpCode, String> {
    let key = state.get_key()?;
    let secret_str = super::vault::decrypt_value(&encrypted_secret, &iv, &key)?;

    let digits = digits.unwrap_or(6) as usize;
    let period = period.unwrap_or(30);
    let alg = parse_algorithm(&algorithm.unwrap_or_else(|| "SHA1".to_string()));

    // Parse the secret — support both raw base32 and otpauth:// URIs
    let secret_bytes = Secret::Encoded(secret_str.trim().to_string())
        .to_bytes()
        .map_err(|e| format!("Invalid TOTP secret: {e}"))?;

    let totp = TOTP::new(alg, digits, 1, period, secret_bytes, None, "badami".to_string())
        .map_err(|e| format!("TOTP init error: {e}"))?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("Time error: {e}"))?
        .as_secs();

    let code = totp.generate(now);
    let remaining = period - (now % period);

    Ok(TotpCode {
        code,
        remaining_seconds: remaining,
        period,
    })
}

/// Validate a TOTP secret (check it's valid base32) without storing it.
#[tauri::command]
pub fn totp_validate_secret(secret: String) -> Result<bool, String> {
    match Secret::Encoded(secret.trim().to_string()).to_bytes() {
        Ok(_) => Ok(true),
        Err(_) => Ok(false),
    }
}
