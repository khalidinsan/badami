//! Cross-platform SSH public-key authentication helpers.
//!
//! `ssh2::Session::userauth_pubkey_memory` is only available on Unix. On
//! Windows we stage the PEM to a temp file and call `userauth_pubkey_file`.

use ssh2::Session;
#[cfg(windows)]
use std::fs;
#[cfg(windows)]
use std::path::PathBuf;

/// Authenticate with an in-memory PEM private key (and optional passphrase).
pub fn userauth_pubkey_pem(
    session: &Session,
    username: &str,
    pem: &str,
    passphrase: Option<&str>,
) -> Result<(), String> {
    #[cfg(unix)]
    {
        session
            .userauth_pubkey_memory(username, None, pem, passphrase)
            .map_err(|e| format!("Auth failed: {e}"))
    }

    #[cfg(windows)]
    {
        let dir = std::env::temp_dir().join("badami-ssh-keys");
        fs::create_dir_all(&dir).map_err(|e| format!("Temp dir error: {e}"))?;
        // Unique name so concurrent connects don't clobber each other.
        let path: PathBuf = dir.join(format!(
            "key-{}-{}.pem",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        fs::write(&path, pem).map_err(|e| format!("Write temp key failed: {e}"))?;
        let result = session
            .userauth_pubkey_file(username, None, &path, passphrase)
            .map_err(|e| format!("Auth failed: {e}"));
        let _ = fs::remove_file(&path);
        result
    }
}
