//! Local Dev Tauri commands (MVP Phase A).
//!
//! Prefix: `ld_`. Discovery, resource install, config generators, MariaDB
//! preflight, Herd import, site park/link/isolate, nginx reload, and process
//! supervisor (start/stop/status/stack/logs).

pub mod config_gen;
pub mod discovery;
pub mod import_herd;
pub mod mariadb_guard;
pub mod resources;
pub mod service_specs;
pub mod sites;
pub mod supervisor;

use config_gen::{
    generate_configs, generate_isolated_site, GenerateConfigsRequest, GenerateConfigsResult,
    IsolatedSiteRequest,
};
use discovery::{build_runtime_paths, discover, DiscoveryReport, RuntimePaths};
use import_herd::{import_herd, ImportHerdRequest, ImportResult};
use mariadb_guard::{run_preflight, MariadbPreflightReport, MariadbPreflightRequest};
use resources::{install_runtime_resources, InstallResourcesResult};

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

/// Copy bundled `resources/local-dev/**` into Application Support and create
/// the HERD_HOME-shaped directory layout. Idempotent. Never touches Herd.
#[tauri::command]
pub async fn ld_install_runtime_resources(
    app: tauri::AppHandle,
) -> Result<InstallResourcesResult, String> {
    use tauri::Manager;
    let resource_dir = app.path().resource_dir().ok();
    tokio::task::spawn_blocking(move || {
        install_runtime_resources(resource_dir.as_deref())
    })
    .await
    .map_err(|e| format!("ld_install_runtime_resources task failed: {e}"))?
}

/// Generate nginx / FPM / dnsmasq / valet config.json / optional MariaDB wrapper
/// my.cnf under Badami local-dev. No process start. No install_db.
#[tauri::command]
pub async fn ld_generate_configs(
    request: GenerateConfigsRequest,
) -> Result<GenerateConfigsResult, String> {
    tokio::task::spawn_blocking(move || generate_configs(request))
        .await
        .map_err(|e| format!("ld_generate_configs task failed: {e}"))?
}

/// Write an isolated-site nginx conf with a **static** unix socket (no njs).
#[tauri::command]
pub async fn ld_generate_isolated_site(
    request: IsolatedSiteRequest,
) -> Result<GenerateConfigsResult, String> {
    tokio::task::spawn_blocking(move || generate_isolated_site(request))
        .await
        .map_err(|e| format!("ld_generate_isolated_site task failed: {e}"))?
}

/// MariaDB pre-start checklist. Also used by supervisor before spawn.
///
/// Returns OkToStart | Adopt { pid } | HardFail { reason }.
#[tauri::command]
pub async fn ld_mariadb_preflight(
    request: Option<MariadbPreflightRequest>,
) -> Result<MariadbPreflightReport, String> {
    let req = request.unwrap_or_default();
    tokio::task::spawn_blocking(move || run_preflight(req))
        .await
        .map_err(|e| format!("ld_mariadb_preflight task failed: {e}"))?
}

/// Import parks, isolates, and service config from an existing Herd install.
///
/// Read-only against Herd (no kill, no datadir copy/delete). Writes Badami
/// snapshot + optional configs under `local-dev/`. Does **not** persist to the
/// app SQLite DB — returns `ImportResult` for the frontend (PR9) to store.
/// Never starts services.
#[tauri::command]
pub async fn ld_import_herd(
    app: tauri::AppHandle,
    request: Option<ImportHerdRequest>,
) -> Result<ImportResult, String> {
    use tauri::Manager;
    let req = request.unwrap_or_default();
    let resource_dir = app.path().resource_dir().ok();
    tokio::task::spawn_blocking(move || import_herd(req, resource_dir))
        .await
        .map_err(|e| format!("ld_import_herd task failed: {e}"))?
}

// Site park / link / isolate / open / nginx reload — see `sites` module
// (`ld_list_sites`, `ld_park`, `ld_unpark`, `ld_link`, `ld_unlink`,
// `ld_isolate_php`, `ld_unisolate`, `ld_open_site_url`, `ld_reload_nginx`).

/// Test helpers shared across `local_dev` modules.
#[cfg(test)]
pub mod test_support {
    use std::sync::{Mutex, MutexGuard, OnceLock};

    /// Global lock for integration tests that mutate the real Badami
    /// Application Support `local-dev/` tree (import configs, etc.).
    ///
    /// Sites park/link unit tests prefer injectable temp `RuntimePaths` and do
    /// **not** need this lock. Import smokes that rewrite valet `config.json`
    /// under Application Support **must** take it.
    pub fn local_dev_fs_lock() -> MutexGuard<'static, ()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
            .lock()
            .unwrap_or_else(|e| e.into_inner())
    }
}
