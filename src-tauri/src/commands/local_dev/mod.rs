//! Local Dev Tauri commands (MVP Phase A).
//!
//! Prefix: `ld_`. PR4 adds process supervisor (start/stop/status/stack/logs)
//! with config gates, MariaDB preflight, and detach semantics.

pub mod config_gen;
pub mod discovery;
pub mod mariadb_guard;
pub mod resources;
pub mod service_specs;
pub mod supervisor;

use config_gen::{
    generate_configs, generate_isolated_site, GenerateConfigsRequest, GenerateConfigsResult,
    IsolatedSiteRequest,
};
use discovery::{build_runtime_paths, discover, DiscoveryReport, RuntimePaths};
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
