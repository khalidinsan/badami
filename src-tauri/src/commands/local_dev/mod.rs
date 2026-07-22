//! Local Dev Tauri commands (MVP Phase A).
//!
//! Prefix: `ld_`. PR4 process supervisor + PR7 doctor diagnostics and optional
//! Mode B / DNS LaunchDaemon bootstrap scaffolds.

pub mod bootstrap;
pub mod config_gen;
pub mod discovery;
pub mod doctor;
pub mod mariadb_guard;
pub mod resources;
pub mod service_specs;
pub mod supervisor;

use bootstrap::{
    bootstrap_install, bootstrap_status, BootstrapInstallRequest, BootstrapInstallResult,
    BootstrapStatus,
};
use config_gen::{
    generate_configs, generate_isolated_site, GenerateConfigsRequest, GenerateConfigsResult,
    IsolatedSiteRequest,
};
use discovery::{build_runtime_paths, discover, DiscoveryReport, RuntimePaths};
use doctor::{run_dns_probe, run_doctor, DnsProbeResult, DoctorReport, DoctorRequest};
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

// ── Doctor / DNS probe (PR7) ────────────────────────────────────────

/// Full Local Dev diagnostics: binaries, ports, MariaDB preflight, datadir
/// locks, DNS resolve probe (not resolver-file-only), nginx -t, FPM sockets /
/// chdir, Herd helper presence (report only), log sizes, DNS modes D0–D3.
///
/// Never deletes Herd datadir. Never invokes Herd helper.
#[tauri::command]
pub async fn ld_doctor(request: Option<DoctorRequest>) -> Result<DoctorReport, String> {
    let req = request.unwrap_or_default();
    tokio::task::spawn_blocking(move || run_doctor(req))
        .await
        .map_err(|e| format!("ld_doctor task failed: {e}"))?
}

/// Resolve a random (or provided) `*.{tld}` label → expect loopback.
/// Used by Doctor and Open site gate. Resolver file alone is never healthy.
#[tauri::command]
pub async fn ld_dns_probe(
    tld: Option<String>,
    loopback: Option<String>,
    label: Option<String>,
    skip_live: Option<bool>,
) -> Result<DnsProbeResult, String> {
    let tld = tld.unwrap_or_else(|| "test".into());
    let loopback = loopback.unwrap_or_else(|| "127.0.0.1".into());
    let skip = skip_live.unwrap_or(false);
    tokio::task::spawn_blocking(move || {
        Ok(run_dns_probe(
            &tld,
            &loopback,
            label.as_deref(),
            skip,
        ))
    })
    .await
    .map_err(|e| format!("ld_dns_probe task failed: {e}"))?
}

// ── Bootstrap Mode B / DNS (PR7) ────────────────────────────────────

/// Status of Badami LaunchDaemon scaffolds / installed units + resolver.
#[tauri::command]
pub async fn ld_bootstrap_status(tld: Option<String>) -> Result<BootstrapStatus, String> {
    tokio::task::spawn_blocking(move || bootstrap_status(tld.as_deref()))
        .await
        .map_err(|e| format!("ld_bootstrap_status task failed: {e}"))?
}

/// Scaffold LaunchDaemon plists (and optional D2 resolver draft) under
/// local-dev/launchd. Default is dry-run / write-plist only — actual install
/// into `/Library/LaunchDaemons` needs user admin auth (osascript).
///
/// Packages: `dns_only` | `dns_high_port` | `http_80` | `full`.
///
/// Never invokes Herd helper. Never deletes Herd datadir.
#[tauri::command]
pub async fn ld_bootstrap_install(
    request: BootstrapInstallRequest,
) -> Result<BootstrapInstallResult, String> {
    tokio::task::spawn_blocking(move || bootstrap_install(request))
        .await
        .map_err(|e| format!("ld_bootstrap_install task failed: {e}"))?
}
