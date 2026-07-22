//! Local Dev Tauri commands (MVP Phase A).
//!
//! Prefix: `ld_`. Discovery in this PR is **read-only** — no process start/stop,
//! no config writes, no datadir mutation.

pub mod discovery;

use discovery::{build_runtime_paths, discover, DiscoveryReport, RuntimePaths};

/// Discover Herd leftovers, PHP versions, MariaDB datadir candidates, ports, etc.
///
/// Pure inventory — never starts services or modifies disk beyond reading.
#[tauri::command]
pub async fn ld_discover() -> Result<DiscoveryReport, String> {
    // Directory walks + port probes are blocking; keep the async runtime free.
    tokio::task::spawn_blocking(discover)
        .await
        .map_err(|e| format!("ld_discover task failed: {e}"))?
}

/// Canonical Badami local-dev runtime paths (strings only; does not create dirs).
#[tauri::command]
pub async fn ld_get_runtime_paths() -> Result<RuntimePaths, String> {
    build_runtime_paths()
}

/// Alias for UI / plan naming (`ld_get_paths`).
#[tauri::command]
pub async fn ld_get_paths() -> Result<RuntimePaths, String> {
    build_runtime_paths()
}
