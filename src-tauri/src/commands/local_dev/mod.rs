//! Local Dev Tauri commands (MVP Phase A).
//!
//! Prefix: `ld_`. Full Phase A: discovery, resources, config gen, MariaDB
//! preflight, sites, process supervisor, doctor, and bootstrap.

pub mod bootstrap;
pub mod config_gen;
pub mod datadir_migration;
pub mod discovery;
pub mod doctor;
pub mod mariadb_guard;
pub mod provision;
pub mod resources;
pub mod runtime_manifest;
pub mod runtime_updater;
pub mod service_specs;
pub mod shell_integration;
pub mod sites;
pub mod supervisor;
pub mod tls;

use bootstrap::{
    bootstrap_install, bootstrap_status_for, bootstrap_uninstall, BootstrapInstallRequest,
    BootstrapInstallResult, BootstrapStatus, BootstrapUninstallRequest, BootstrapUninstallResult,
    DEFAULT_LD_IDENTIFIER,
};
use config_gen::{
    generate_configs, generate_isolated_site, GenerateConfigsRequest, GenerateConfigsResult,
    IsolatedSiteRequest,
};
use discovery::{build_runtime_paths, discover, DiscoveryReport, RuntimePaths};
use doctor::{run_dns_probe_for, run_doctor_for, DnsProbeResult, DoctorReport, DoctorRequest};
use mariadb_guard::{
    probe_mariadb_auth_async, run_preflight, MariadbAuthProbe, MariadbAuthProbeRequest,
    MariadbPreflightReport, MariadbPreflightRequest,
};
use resources::{install_runtime_resources, InstallResourcesResult};
use shell_integration::{ShellIntegrationResult, ShellIntegrationStatus};

/// Discover PHP versions, MariaDB datadir candidates, ports, etc.
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
/// the local-dev directory layout. Idempotent.
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

/// Rewrite **only** `dnsmasq/dnsmasq.conf`, at a caller-chosen port.
///
/// Split out from [`ld_generate_configs`] on purpose: repairing DNS must not
/// silently re-emit nginx and FPM config as a side effect. The port that matters
/// is whatever `/etc/resolver/<tld>` already tells macOS to query — a conf
/// generated before a default change (`:53` → `:53535`) leaves DNS permanently
/// dead, since the two halves disagree and `:53` needs root anyway.
#[tauri::command]
pub async fn ld_generate_dnsmasq_conf(
    tld: Option<String>,
    loopback: Option<String>,
    dns_port: u16,
) -> Result<GenerateConfigsResult, String> {
    tokio::task::spawn_blocking(move || {
        let paths = build_runtime_paths()?;
        let tld = tld.unwrap_or_else(|| "test".into());
        let loopback = loopback.unwrap_or_else(|| "127.0.0.1".into());
        let mut written = Vec::new();
        config_gen::write_dnsmasq_conf(&paths, &tld, &loopback, dns_port, &mut written)?;
        Ok(GenerateConfigsResult {
            local_dev_root: paths.local_dev_root,
            written,
            notes: vec![format!("dnsmasq.conf rewritten for *.{tld} on port {dns_port}")],
        })
    })
    .await
    .map_err(|e| format!("ld_generate_dnsmasq_conf task failed: {e}"))?
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

/// Lightweight TCP/socket + empty-password auth probe for Database registration.
///
/// Returns `{ ok, needs_password, … }`. Does **not** create `db_connections` rows
/// or write keychain — registration stays in TypeScript (`createConnection` +
/// conditional `save_db_password`).
#[tauri::command]
pub async fn ld_probe_mariadb_auth(
    request: Option<MariadbAuthProbeRequest>,
) -> Result<MariadbAuthProbe, String> {
    let req = request.unwrap_or_default();
    Ok(probe_mariadb_auth_async(req).await)
}

// Site park / link / isolate / open / nginx reload — see `sites` module
// (`ld_list_sites`, `ld_park`, `ld_unpark`, `ld_link`, `ld_unlink`,
// `ld_isolate_php`, `ld_unisolate`, `ld_open_site_url`, `ld_reload_nginx`).


// ── Doctor / DNS probe (PR7) ────────────────────────────────────────

/// Full Local Dev diagnostics: binaries, ports, MariaDB preflight (inspect-only
/// — no stale pid/socket unlink), datadir locks, DNS resolve probe (not
/// resolver-file-only), nginx -t, FPM sockets / chdir, log sizes, DNS modes
/// D0–D3.
///
/// Never mutates disk beyond optional `nginx -t` subprocess.
#[tauri::command]
pub async fn ld_doctor(
    app: tauri::AppHandle,
    request: Option<DoctorRequest>,
) -> Result<DoctorReport, String> {
    let req = request.unwrap_or_default();
    let identifier = resolve_identifier(&app);
    tokio::task::spawn_blocking(move || run_doctor_for(&identifier, req))
        .await
        .map_err(|e| format!("ld_doctor task failed: {e}"))?
}

/// Resolve a random (or provided) `*.{tld}` label → expect loopback.
/// Used by Doctor and Open site gate. Resolver file alone is never healthy.
#[tauri::command]
pub async fn ld_dns_probe(
    app: tauri::AppHandle,
    tld: Option<String>,
    loopback: Option<String>,
    label: Option<String>,
    skip_live: Option<bool>,
) -> Result<DnsProbeResult, String> {
    let tld = tld.unwrap_or_else(|| "test".into());
    let loopback = loopback.unwrap_or_else(|| "127.0.0.1".into());
    let skip = skip_live.unwrap_or(false);
    let identifier = resolve_identifier(&app);
    tokio::task::spawn_blocking(move || {
        Ok(run_dns_probe_for(
            &identifier,
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

/// Resolve the identifier used to compose LaunchDaemon labels, falling back
/// to [`DEFAULT_LD_IDENTIFIER`] when the Tauri config has an empty value
/// (unit tests + first-run before `.setup(...)` finishes).
fn resolve_identifier(app: &tauri::AppHandle) -> String {
    let id = app.config().identifier.clone();
    if id.is_empty() {
        DEFAULT_LD_IDENTIFIER.to_string()
    } else {
        id
    }
}

/// Status of Badami LaunchDaemon scaffolds / installed units + resolver.
#[tauri::command]
pub async fn ld_bootstrap_status(
    app: tauri::AppHandle,
    tld: Option<String>,
) -> Result<BootstrapStatus, String> {
    let identifier = resolve_identifier(&app);
    tokio::task::spawn_blocking(move || bootstrap_status_for(&identifier, tld.as_deref()))
        .await
        .map_err(|e| format!("ld_bootstrap_status task failed: {e}"))?
}

/// Scaffold LaunchDaemon plists (and optional D2 resolver draft) under
/// local-dev/launchd.
///
/// **`dry_run` (default true)** still **writes** plists/scripts under Application
/// Support — it only skips privileged install into `/Library/LaunchDaemons`.
/// System install needs user admin auth (osascript) via
/// `attempt_privileged_install` when `dry_run=false`. The privileged command
/// is composed in Rust from argv only; no user-writable script is executed
/// as root (TOCTOU-safe).
///
/// Packages: `dns_only` | `dns_high_port` | `http_80` | `full` | `resync`.
#[tauri::command]
pub async fn ld_bootstrap_install(
    app: tauri::AppHandle,
    request: BootstrapInstallRequest,
) -> Result<BootstrapInstallResult, String> {
    let identifier = resolve_identifier(&app);
    let mut req = request;
    if req.identifier.is_none() {
        req.identifier = Some(identifier);
    }
    tokio::task::spawn_blocking(move || bootstrap_install(req))
        .await
        .map_err(|e| format!("ld_bootstrap_install task failed: {e}"))?
}

/// Remove a Badami-managed LaunchDaemon package (and optionally the resolver
/// file). The resolver file is only removed when it carries the
/// `# managed-by: badami` marker, unless `confirm_resolver=true`.
///
/// Packages: `dns_only` | `http_80` | `full` | `resolver`.
#[tauri::command]
pub async fn ld_bootstrap_uninstall(
    app: tauri::AppHandle,
    request: BootstrapUninstallRequest,
) -> Result<BootstrapUninstallResult, String> {
    let identifier = resolve_identifier(&app);
    let mut req = request;
    if req.identifier.is_none() {
        req.identifier = Some(identifier);
    }
    tokio::task::spawn_blocking(move || bootstrap_uninstall(req))
        .await
        .map_err(|e| format!("ld_bootstrap_uninstall task failed: {e}"))?
}

/// Report whether the runtime is on `PATH`, read from the profile on disk.
#[tauri::command]
pub async fn ld_shell_integration_status() -> Result<ShellIntegrationStatus, String> {
    tokio::task::spawn_blocking(shell_integration::status)
        .await
        .map_err(|e| format!("ld_shell_integration_status task failed: {e}"))?
}

/// Write the launchers and append the marked block to the shell profile.
#[tauri::command]
pub async fn ld_shell_integration_install() -> Result<ShellIntegrationResult, String> {
    tokio::task::spawn_blocking(shell_integration::install)
        .await
        .map_err(|e| format!("ld_shell_integration_install task failed: {e}"))?
}

/// Remove the marked block and the launchers. Touches nothing else.
#[tauri::command]
pub async fn ld_shell_integration_uninstall() -> Result<ShellIntegrationResult, String> {
    tokio::task::spawn_blocking(shell_integration::uninstall)
        .await
        .map_err(|e| format!("ld_shell_integration_uninstall task failed: {e}"))?
}

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
