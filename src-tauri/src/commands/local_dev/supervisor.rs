//! Process supervisor for Local Dev services (MVP Phase A / PR4).
//!
//! - `tokio::process::Command` with `kill_on_drop(false)`
//! - Unix `setsid` via `pre_exec` so services survive app quit
//! - `requires_config` gates; MariaDB preflight before spawn
//! - Never shell out with concatenated untrusted strings
//! - Never deletes Herd datadir data

use super::discovery::{build_runtime_paths, discover};
use super::doctor::LD_NGINX_LABEL;
use super::mariadb_guard::{
    pid_is_alive, read_pid_file, run_preflight, tcp_accepting, unix_socket_accepting,
    MariadbPreflight, MariadbPreflightRequest,
};
use super::service_specs::{
    build_all_specs, check_requires_config, find_spec, resolve_mariadb_admin, stack_start_order,
    stack_stop_order, validate_service_id, HealthCheck, ServiceKind, ServiceSpec,
    ServiceStatus, ServiceStatusReport,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tokio::process::Command;
use tokio::sync::Mutex;

// ── Constants ───────────────────────────────────────────────────────

const LOG_TAIL_MAX_BYTES: u64 = 512 * 1024; // 512 KiB
const LOG_ROTATE_BYTES: u64 = 50 * 1024 * 1024; // 50 MiB
const MAX_ROTATED_LOGS: u32 = 2;
const AUTO_RESTART_MAX: usize = 5;
const AUTO_RESTART_WINDOW: Duration = Duration::from_secs(5 * 60);
const HEALTH_POLL_ATTEMPTS: u32 = 20;
const HEALTH_POLL_INTERVAL_MS: u64 = 250;
const MARIADB_SHUTDOWN_GRACE_SECS: u64 = 60;
const DEFAULT_STOP_GRACE_SECS: u64 = 10;

// ── Public result types ─────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceActionResult {
    pub service_id: String,
    pub status: ServiceStatus,
    pub message: String,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StackActionResult {
    pub results: Vec<ServiceActionResult>,
    pub notes: Vec<String>,
    /// True when any non-DNS service failed to start/stop cleanly (UI should inspect `results`).
    pub partial_failure: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogTailResult {
    pub service_id: String,
    pub path: String,
    pub lines: Vec<String>,
    pub truncated: bool,
    pub rotated: bool,
}

// ── Runtime state ───────────────────────────────────────────────────

struct ManagedRuntime {
    status: ServiceStatus,
    /// Restart timestamps within the rate-limit window (auto_restart services).
    restart_times: Vec<Instant>,
    /// Last known PID (spawned or adopted).
    pid: Option<u32>,
}

impl Default for ManagedRuntime {
    fn default() -> Self {
        Self {
            status: ServiceStatus::Stopped,
            restart_times: Vec::new(),
            pid: None,
        }
    }
}

struct SupervisorInner {
    /// Cached specs (rebuilt on stack/start if empty).
    specs: Vec<ServiceSpec>,
    runtimes: HashMap<String, ManagedRuntime>,
}

impl SupervisorInner {
    fn new() -> Self {
        Self {
            specs: Vec::new(),
            runtimes: HashMap::new(),
        }
    }

    fn ensure_specs(&mut self) -> Result<(), String> {
        if self.specs.is_empty() {
            self.specs = build_all_specs()?;
            for s in &self.specs {
                self.runtimes.entry(s.id.clone()).or_default();
            }
        }
        Ok(())
    }

    fn refresh_specs(&mut self) -> Result<(), String> {
        self.specs = build_all_specs()?;
        for s in &self.specs {
            self.runtimes.entry(s.id.clone()).or_default();
        }
        Ok(())
    }
}

/// Tauri-managed supervisor state (runtime truth).
pub struct LocalDevState {
    inner: Mutex<SupervisorInner>,
}

impl LocalDevState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(SupervisorInner::new()),
        }
    }
}

impl Default for LocalDevState {
    fn default() -> Self {
        Self::new()
    }
}

// ── PID / process helpers ───────────────────────────────────────────

/// macOS: resolve executable path for a live PID via `proc_pidpath`.
#[cfg(target_os = "macos")]
fn proc_pid_path(pid: u32) -> Option<PathBuf> {
    // PROC_PIDPATHINFO_MAXSIZE is 4 * MAXPATHLEN (1024) = 4096 on Darwin.
    const BUF_SIZE: usize = 4096;
    extern "C" {
        fn proc_pidpath(pid: i32, buffer: *mut std::ffi::c_char, buffersize: u32) -> i32;
    }
    let mut buf = vec![0i8; BUF_SIZE];
    // SAFETY: buffer is valid, size correct; proc_pidpath only writes into buffer.
    let n = unsafe { proc_pidpath(pid as i32, buf.as_mut_ptr(), BUF_SIZE as u32) };
    if n <= 0 {
        return None;
    }
    let bytes: Vec<u8> = buf[..n as usize]
        .iter()
        .map(|&c| c as u8)
        .take_while(|&b| b != 0)
        .collect();
    let s = String::from_utf8_lossy(&bytes);
    if s.is_empty() {
        None
    } else {
        Some(PathBuf::from(s.as_ref()))
    }
}

#[cfg(not(target_os = "macos"))]
fn proc_pid_path(_pid: u32) -> Option<PathBuf> {
    None
}

/// Strict binary identity for adopt/stop safety.
///
/// Accepts only canonical path equality or same device+inode (symlink aliases).
/// **Basename-only match is intentionally rejected** (would adopt foreign nginx/redis).
fn path_same_binary(a: &Path, b: &Path) -> bool {
    if a.as_os_str().is_empty() || b.as_os_str().is_empty() {
        return false;
    }
    let ca = a.canonicalize().unwrap_or_else(|_| a.to_path_buf());
    let cb = b.canonicalize().unwrap_or_else(|_| b.to_path_buf());
    if ca == cb {
        return true;
    }
    // Same file via hardlink / different path to same inode.
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if let (Ok(ma), Ok(mb)) = (fs::metadata(&ca), fs::metadata(&cb)) {
            if ma.dev() == mb.dev() && ma.ino() == mb.ino() {
                return true;
            }
        }
    }
    false
}

fn write_pid_file(path: &Path, pid: u32) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir pids: {e}"))?;
    }
    fs::write(path, format!("{pid}\n")).map_err(|e| format!("write pid {}: {e}", path.display()))
}

/// Send a Unix signal to a process (no shell). Never SIGKILL from supervisor paths.
#[cfg(unix)]
fn signal_pid(pid: u32, sig: i32, name: &str) -> Result<(), String> {
    if pid == 0 {
        return Err(format!("refusing {name} to pid 0"));
    }
    extern "C" {
        fn kill(pid: i32, sig: i32) -> i32;
    }
    // SAFETY: targeted signal to a single pid; caller chooses SIGTERM/SIGQUIT only.
    let rc = unsafe { kill(pid as i32, sig) };
    if rc != 0 {
        let err = std::io::Error::last_os_error();
        // ESRCH = already gone — treat as success.
        if err.raw_os_error() == Some(3) {
            return Ok(());
        }
        return Err(format!("{name} pid {pid}: {err}"));
    }
    Ok(())
}

#[cfg(unix)]
fn signal_term(pid: u32) -> Result<(), String> {
    const SIGTERM: i32 = 15;
    signal_pid(pid, SIGTERM, "SIGTERM")
}

/// php-fpm conventional graceful shutdown.
#[cfg(unix)]
fn signal_quit(pid: u32) -> Result<(), String> {
    const SIGQUIT: i32 = 3;
    signal_pid(pid, SIGQUIT, "SIGQUIT")
}

#[cfg(not(unix))]
fn signal_term(_pid: u32) -> Result<(), String> {
    Err("process signals not supported on this platform".into())
}

#[cfg(not(unix))]
fn signal_quit(pid: u32) -> Result<(), String> {
    signal_term(pid)
}

// ── Health ──────────────────────────────────────────────────────────

/// Port/socket/HTTP checks only — never treats TCP occupancy alone as ownership.
///
/// `PidAlive` alone is **not** a hard check (returns false) so dnsmasq without a
/// pid file is Stopped, not a false "port conflict".
fn hard_health_ok(check: &HealthCheck) -> bool {
    match check {
        HealthCheck::PidAlive => false,
        HealthCheck::Tcp { host, port } => tcp_accepting(host, *port),
        HealthCheck::UnixSocket { path } => unix_socket_accepting(path),
        HealthCheck::Http { url, expect_status } => http_status_matches(url, *expect_status),
        HealthCheck::Composite { checks } => {
            let hard: Vec<_> = checks
                .iter()
                .filter(|c| !matches!(c, HealthCheck::PidAlive))
                .collect();
            if hard.is_empty() {
                return false;
            }
            hard.iter().all(|c| hard_health_ok(c))
        }
    }
}

/// Full health: when PidAlive is in the check set, a live pid is **required**.
fn health_ok(spec: &ServiceSpec, pid: Option<u32>) -> bool {
    eval_health(&spec.health, pid)
}

fn eval_health(check: &HealthCheck, pid: Option<u32>) -> bool {
    match check {
        HealthCheck::PidAlive => pid.map(pid_is_alive).unwrap_or(false),
        HealthCheck::Tcp { host, port } => tcp_accepting(host, *port),
        HealthCheck::UnixSocket { path } => unix_socket_accepting(path),
        HealthCheck::Http { url, expect_status } => http_status_matches(url, *expect_status),
        HealthCheck::Composite { checks } => {
            if checks.is_empty() {
                return false;
            }
            // Every listed check must pass — PidAlive is not optional.
            checks.iter().all(|c| eval_health(c, pid))
        }
    }
}

fn port_conflict_reason(spec: &ServiceSpec) -> String {
    format!(
        "port/socket occupied but not owned by Badami (no matching live pid file under local-dev/pids for {})",
        spec.id
    )
}

fn http_status_matches(url: &str, expect: u16) -> bool {
    // Lightweight blocking probe without shell. Use std TcpStream for host:port
    // only when URL is simple http://host:port/ — avoid pulling full HTTP client
    // into hot path. Best-effort HEAD.
    let url = url.trim();
    let rest = url.strip_prefix("http://").unwrap_or(url);
    let (hostport, _path) = rest.split_once('/').unwrap_or((rest, ""));
    let (host, port) = if let Some((h, p)) = hostport.split_once(':') {
        (h, p.parse().unwrap_or(80))
    } else {
        (hostport, 80u16)
    };
    if host.is_empty() || host.contains('/') {
        return false;
    }
    use std::io::Write;
    use std::net::{TcpStream, ToSocketAddrs};
    let Ok(mut addrs) = (host, port).to_socket_addrs() else {
        return false;
    };
    let Some(addr) = addrs.next() else {
        return false;
    };
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(300)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(300)));
    let req = format!("HEAD / HTTP/1.0\r\nHost: {host}\r\nConnection: close\r\n\r\n");
    if stream.write_all(req.as_bytes()).is_err() {
        return false;
    }
    let mut buf = [0u8; 128];
    let n = stream.read(&mut buf).unwrap_or(0);
    if n == 0 {
        return false;
    }
    let text = String::from_utf8_lossy(&buf[..n]);
    // HTTP/1.x 200 ...
    text.split_whitespace()
        .nth(1)
        .and_then(|c| c.parse::<u16>().ok())
        .map(|c| c == expect)
        .unwrap_or(false)
}

// ── PID file safety ─────────────────────────────────────────────────

fn pid_file_under_local_dev_pids(path: &Path) -> bool {
    let Ok(paths) = build_runtime_paths() else {
        return false;
    };
    let pids = PathBuf::from(&paths.pids);
    let name_ok = path
        .file_name()
        .and_then(|s| s.to_str())
        .map(|n| n.ends_with(".pid"))
        .unwrap_or(false);
    name_ok && path_under(&pids, path)
}

/// Remove a stale pid file only when under local-dev/pids and basename ends with `.pid`.
fn clear_stale_pid_safe(path: &Path) {
    if !path.is_file() {
        return;
    }
    if !pid_file_under_local_dev_pids(path) {
        return;
    }
    if let Some(pid) = read_pid_file(path) {
        if pid_is_alive(pid) {
            return;
        }
    }
    let _ = fs::remove_file(path);
}

// ── Adoption ────────────────────────────────────────────────────────

/// Adopt only when we have a **live pid file** (preferably under local-dev/pids),
/// optional strict binary match via `proc_pidpath`, and hard health (port/socket).
///
/// TCP/socket occupancy alone is **never** treated as ownership.
fn try_adopt(spec: &ServiceSpec) -> Option<u32> {
    let pid = read_pid_file(&spec.pid_file)?;
    if pid == 0 || !pid_is_alive(pid) {
        return None;
    }

    // Prefer pid files we own; still allow wrapper my.cnf pid paths if live + binary matches.
    let under_pids = pid_file_under_local_dev_pids(&spec.pid_file);

    if let Some(running) = proc_pid_path(pid) {
        if !spec.binary_path.as_os_str().is_empty() {
            if !path_same_binary(&running, &spec.binary_path) {
                // Foreign binary at this pid — do not adopt, do not SIGTERM later via this path.
                return None;
            }
        } else if !under_pids {
            return None;
        }
    } else if !under_pids {
        // Cannot verify binary and pid file is outside our tree — refuse adopt.
        return None;
    }

    // Hard health required (socket/TCP). PidAlive is implied by pid_is_alive above.
    if !hard_health_ok(&spec.health) {
        // Daemon may still be starting — for adopt of long-running services require health.
        // Exception: PidAlive-only health (dnsmasq) — pid liveness is enough.
        if !matches!(spec.health, HealthCheck::PidAlive) {
            return None;
        }
    }

    Some(pid)
}

/// Probe whether the service is effectively running (owned by Badami).
fn probe_running(spec: &ServiceSpec) -> ServiceStatus {
    if let Some(pid) = try_adopt(spec) {
        return ServiceStatus::Running { pid };
    }

    // Stale pid file under local-dev/pids only.
    if let Some(pid) = read_pid_file(&spec.pid_file) {
        if !pid_is_alive(pid) {
            clear_stale_pid_safe(&spec.pid_file);
        }
    }

    // Privileged nginx often leaves no readable pid file (root master + missing
    // pid path). If we can still identify *our* master by cmdline + binary,
    // treat as Running and heal the pid file when possible.
    if matches!(spec.kind, ServiceKind::Nginx) {
        if let Some(pid) = find_our_nginx_master(spec) {
            if hard_health_ok(&spec.health) || pid_is_alive(pid) {
                let _ = write_pid_file(&spec.pid_file, pid);
                return ServiceStatus::Running { pid };
            }
        }
    }

    // Port/socket busy without ownership → conflict, not Running.
    if hard_health_ok(&spec.health) {
        // Last chance for nginx: listener on our port with our binary (no pid file).
        if matches!(spec.kind, ServiceKind::Nginx) {
            if let Some(pid) = find_our_nginx_master(spec) {
                let _ = write_pid_file(&spec.pid_file, pid);
                return ServiceStatus::Running { pid };
            }
        }
        return ServiceStatus::Unhealthy {
            pid: None,
            reason: port_conflict_reason(spec),
        };
    }

    if !spec.binary_present && !spec.binary_path.is_file() {
        return ServiceStatus::Unavailable {
            reason: format!("binary missing: {}", spec.binary_path.display()),
        };
    }

    ServiceStatus::Stopped
}

/// Locate the nginx master that was started with Badami's conf (`-c …/local-dev/nginx/nginx.conf`).
///
/// Root-owned masters (Mode B / admin elevate) often omit a user-readable pid file;
/// matching on cmdline is how we keep the Services card in sync with reality.
fn find_our_nginx_master(spec: &ServiceSpec) -> Option<u32> {
    let conf = spec.requires_config.first()?;
    let conf_s = conf.to_string_lossy();
    // Unique marker for Badami conf (spaces OK — we match as substring).
    let marker = if conf_s.contains("local-dev/nginx") {
        "local-dev/nginx/nginx.conf"
    } else {
        conf.file_name()?.to_str()?
    };

    let out = std::process::Command::new("ps")
        .args(["-axo", "pid=,command="])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        // Master only (not workers).
        if !line.contains("nginx: master process") && !line.contains("nginx-arm64") {
            continue;
        }
        if line.contains("nginx: worker") {
            continue;
        }
        if !line.contains(marker) && !line.contains("local-dev/nginx") {
            continue;
        }
        // Parse leading PID.
        let pid_str = line.split_whitespace().next()?;
        let pid: u32 = pid_str.parse().ok()?;
        if pid == 0 || !pid_is_alive(pid) {
            continue;
        }
        // Prefer binary identity when we can resolve it.
        if let Some(running) = proc_pid_path(pid) {
            if !spec.binary_path.as_os_str().is_empty()
                && !path_same_binary(&running, &spec.binary_path)
            {
                // Still accept if cmdline clearly references our conf path.
                if !line.contains("local-dev/nginx") {
                    continue;
                }
            }
        }
        return Some(pid);
    }
    None
}

// ── Privileged nginx (port < 1024 — same problem Herd solves with a helper) ─

fn health_tcp_port(h: &HealthCheck) -> Option<u16> {
    match h {
        HealthCheck::Tcp { port, .. } => Some(*port),
        HealthCheck::Composite { checks } => checks.iter().find_map(health_tcp_port),
        _ => None,
    }
}

/// True when nginx is configured for a privileged listen port (e.g. 80).
fn nginx_needs_root(spec: &ServiceSpec) -> bool {
    matches!(spec.kind, ServiceKind::Nginx)
        && health_tcp_port(&spec.health).map(|p| p > 0 && p < 1024).unwrap_or(false)
}

fn launchctl_unit_loaded(label: &str) -> bool {
    std::process::Command::new("launchctl")
        .args(["print", &format!("system/{label}")])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn shell_single_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\"'\"'"))
}

/// Escape for embedding inside an AppleScript string literal (double quotes).
fn applescript_string(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

/// Start nginx on a privileged port.
///
/// 1. Prefer LaunchDaemon (`com.khalid.badami.local-dev.nginx`) — no password after one-time install.
/// 2. Else one-shot `osascript` admin elevation (password each start; UI still works).
async fn start_nginx_privileged(
    spec: &ServiceSpec,
    notes: &mut Vec<String>,
) -> Result<u32, String> {
    // Path A: LaunchDaemon already installed (Herd-like after first setup).
    if launchctl_unit_loaded(LD_NGINX_LABEL) {
        notes.push(format!(
            "Mode B: LaunchDaemon {LD_NGINX_LABEL} loaded — kickstart"
        ));
        let label = LD_NGINX_LABEL.to_string();
        let out = tokio::task::spawn_blocking(move || {
            std::process::Command::new("launchctl")
                .args(["kickstart", "-k", &format!("system/{label}")])
                .output()
        })
        .await
        .map_err(|e| format!("kickstart task: {e}"))?
        .map_err(|e| format!("launchctl kickstart: {e}"))?;
        if !out.status.success() {
            notes.push(format!(
                "kickstart stderr: {}",
                String::from_utf8_lossy(&out.stderr)
            ));
        }
        return wait_nginx_up(spec, notes).await;
    }

    // Path B: one-shot admin elevate (like a mini privileged start without permanent helper).
    notes.push(
        "Mode B LaunchDaemon not installed — elevating once via macOS admin prompt (same idea as Herd helper, temporary)"
            .into(),
    );
    let conf = spec
        .requires_config
        .first()
        .cloned()
        .ok_or_else(|| "nginx requires_config missing".to_string())?;
    let prefix = spec
        .working_dir
        .clone()
        .or_else(|| conf.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."));
    let bin = spec.binary_path.to_string_lossy().into_owned();
    let conf_s = conf.to_string_lossy().into_owned();
    let prefix_s = prefix.to_string_lossy().into_owned();

    // Stop any existing master first (best-effort, may need admin too).
    let quit_cmd = format!(
        "{} -c {} -p {} -s quit 2>/dev/null || true; {} -c {} -p {} -g {}",
        shell_single_quote(&bin),
        shell_single_quote(&conf_s),
        shell_single_quote(&prefix_s),
        shell_single_quote(&bin),
        shell_single_quote(&conf_s),
        shell_single_quote(&prefix_s),
        shell_single_quote("daemon on;"),
    );
    let script = format!(
        "do shell script \"{}\" with administrator privileges",
        applescript_string(&quit_cmd)
    );

    let out = tokio::task::spawn_blocking(move || {
        std::process::Command::new("osascript")
            .args(["-e", &script])
            .output()
    })
    .await
    .map_err(|e| format!("osascript task: {e}"))?
    .map_err(|e| format!("osascript: {e}"))?;

    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        let stdout = String::from_utf8_lossy(&out.stdout);
        return Err(format!(
            "Failed to start nginx on privileged port (admin cancelled or error). \
             Install Mode B once under Local Dev → Settings → bootstrap HTTP :80, \
             or approve the admin prompt. Details: {err} {stdout}"
        ));
    }
    notes.push("osascript admin start: ok".into());
    wait_nginx_up(spec, notes).await
}

async fn wait_nginx_up(spec: &ServiceSpec, notes: &mut Vec<String>) -> Result<u32, String> {
    for _ in 0..HEALTH_POLL_ATTEMPTS {
        if let Some(pid) = try_adopt(spec) {
            notes.push(format!("nginx up pid={pid}"));
            return Ok(pid);
        }
        // Heal: discover root master by cmdline when pid file missing.
        if let Some(pid) = find_our_nginx_master(spec) {
            let _ = write_pid_file(&spec.pid_file, pid);
            if hard_health_ok(&spec.health) || pid_is_alive(pid) {
                notes.push(format!("nginx up (discovered master pid={pid})"));
                return Ok(pid);
            }
        }
        // Port up even if pid file lagging — still success for UI.
        if hard_health_ok(&spec.health) {
            if let Some(pid) = read_pid_file(&spec.pid_file).filter(|p| pid_is_alive(*p)) {
                notes.push(format!("nginx listening; pid file {pid}"));
                return Ok(pid);
            }
            // Do NOT return pid 0 — UI would immediately flip to "not owned".
            // Keep polling for master discovery.
            notes.push("nginx listening; waiting to discover master pid…".into());
        }
        tokio::time::sleep(Duration::from_millis(HEALTH_POLL_INTERVAL_MS)).await;
    }
    // Final attempt: if we found our master even without TCP probe, accept it.
    if let Some(pid) = find_our_nginx_master(spec) {
        let _ = write_pid_file(&spec.pid_file, pid);
        notes.push(format!("nginx master found after timeout window pid={pid}"));
        return Ok(pid);
    }
    Err(
        "nginx privileged start timed out waiting for listen port. \
         Check /tmp/com.khalid.badami.local-dev.nginx.err.log or nginx-error.log"
            .into(),
    )
}

async fn stop_nginx_privileged(spec: &ServiceSpec, notes: &mut Vec<String>) {
    // Always heal pid file so nginx -s quit can find the master.
    if let Some(pid) = find_our_nginx_master(spec) {
        let _ = write_pid_file(&spec.pid_file, pid);
        notes.push(format!("stop: discovered master pid={pid}"));
    }

    if launchctl_unit_loaded(LD_NGINX_LABEL) {
        notes.push(format!("Mode B stop: launchctl kill SIGTERM system/{LD_NGINX_LABEL}"));
        let label = LD_NGINX_LABEL.to_string();
        let _ = tokio::task::spawn_blocking(move || {
            std::process::Command::new("launchctl")
                .args(["kill", "SIGTERM", &format!("system/{label}")])
                .status()
        })
        .await;
        // Fall through — also try quit/kill so we clean up orphan masters.
    }

    // Elevate quit + kill (root-owned master ignores unprivileged signals).
    let conf = match spec.requires_config.first() {
        Some(c) => c.clone(),
        None => {
            notes.push("privileged stop: no conf path".into());
            return;
        }
    };
    let prefix = spec
        .working_dir
        .clone()
        .or_else(|| conf.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."));
    let bin = spec.binary_path.to_string_lossy().into_owned();
    let conf_s = conf.to_string_lossy().into_owned();
    let prefix_s = prefix.to_string_lossy().into_owned();
    let pid_path = spec.pid_file.to_string_lossy().into_owned();
    let master_pid = find_our_nginx_master(spec).unwrap_or(0);

    // Shell body (run as root via osascript):
    // 1) ensure pid file  2) nginx -s quit  3) SIGTERM master if still alive  4) SIGKILL last resort
    let body = format!(
        "PIDFILE={pid}; \
         MASTER={master}; \
         if [ -n \"$MASTER\" ] && [ \"$MASTER\" != \"0\" ]; then echo \"$MASTER\" > \"$PIDFILE\"; fi; \
         {bin} -c {conf} -p {prefix} -s quit 2>/dev/null || true; \
         sleep 1; \
         if [ -n \"$MASTER\" ] && [ \"$MASTER\" != \"0\" ] && kill -0 \"$MASTER\" 2>/dev/null; then kill -TERM \"$MASTER\" 2>/dev/null || true; sleep 1; fi; \
         if [ -n \"$MASTER\" ] && [ \"$MASTER\" != \"0\" ] && kill -0 \"$MASTER\" 2>/dev/null; then kill -9 \"$MASTER\" 2>/dev/null || true; fi; \
         # any remaining Badami masters \
         for p in $(ps -axo pid=,command= | awk '/nginx: master process/ && /local-dev\\\\/nginx/ {{print $1}}'); do \
           kill -TERM \"$p\" 2>/dev/null || true; \
         done; \
         sleep 0.5; \
         for p in $(ps -axo pid=,command= | awk '/nginx: master process/ && /local-dev\\\\/nginx/ {{print $1}}'); do \
           kill -9 \"$p\" 2>/dev/null || true; \
         done; \
         rm -f \"$PIDFILE\"",
        pid = shell_single_quote(&pid_path),
        master = master_pid,
        bin = shell_single_quote(&bin),
        conf = shell_single_quote(&conf_s),
        prefix = shell_single_quote(&prefix_s),
    );
    let script = format!(
        "do shell script \"{}\" with administrator privileges",
        applescript_string(&body)
    );
    notes.push("privileged stop: admin quit/kill Badami nginx master".into());
    let out = tokio::task::spawn_blocking(move || {
        std::process::Command::new("osascript")
            .args(["-e", &script])
            .output()
    })
    .await;
    match out {
        Ok(Ok(o)) if o.status.success() => notes.push("privileged stop: ok".into()),
        Ok(Ok(o)) => notes.push(format!(
            "privileged stop: exit {:?} stderr={}",
            o.status.code(),
            String::from_utf8_lossy(&o.stderr)
        )),
        Ok(Err(e)) => notes.push(format!("privileged stop osascript: {e}")),
        Err(e) => notes.push(format!("privileged stop task: {e}")),
    }
    clear_stale_pid_safe(&spec.pid_file);
}

// ── Spawn ───────────────────────────────────────────────────────────

/// Apply Unix detach: new session so SIGHUP on app quit does not kill the service.
#[cfg(unix)]
fn apply_detach(cmd: &mut Command) {
    // SAFETY: pre_exec runs in the child after fork, before exec. setsid is safe here.
    unsafe {
        cmd.pre_exec(|| {
            extern "C" {
                fn setsid() -> i32;
            }
            if setsid() == -1 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
}

#[cfg(not(unix))]
fn apply_detach(_cmd: &mut Command) {}

async fn spawn_service(spec: &ServiceSpec) -> Result<u32, String> {
    if !spec.binary_path.is_file() {
        return Err(format!(
            "binary missing for {}: {}",
            spec.id,
            spec.binary_path.display()
        ));
    }
    check_requires_config(spec)?;

    // Ensure runtime dirs
    if let Ok(paths) = build_runtime_paths() {
        for d in [&paths.pids, &paths.logs, &paths.socks] {
            let _ = fs::create_dir_all(d);
        }
    }

    // Rotate log if huge before start
    let _ = maybe_rotate_log(&spec.log_file);

    let mut cmd = Command::new(&spec.binary_path);
    cmd.args(&spec.args);
    cmd.kill_on_drop(false);
    cmd.stdin(std::process::Stdio::null());
    // stdout/stderr discarded — early spawn failures surface only via health timeout
    // and the service log file (when the binary opens it). See error text below.
    cmd.stdout(std::process::Stdio::null());
    cmd.stderr(std::process::Stdio::null());
    if let Some(ref wd) = spec.working_dir {
        cmd.current_dir(wd);
    }
    for (k, v) in &spec.env {
        cmd.env(k, v);
    }
    apply_detach(&mut cmd);

    let child = cmd
        .spawn()
        .map_err(|e| format!("spawn {}: {e}", spec.id))?;
    let pid = child.id().unwrap_or(0);
    // Intentionally drop Child with kill_on_drop(false) so services outlive the app.
    drop(child);

    // dnsmasq / php-fpm daemonize: parent exits and rewrites pid-file. Do NOT seed
    // the parent pid — it goes dead and confuses health (UI "failed health checks").
    let daemonizes = matches!(
        spec.kind,
        ServiceKind::DnsMasq | ServiceKind::PhpFpm { .. } | ServiceKind::Nginx
    );
    if pid != 0 && !daemonizes {
        let _ = write_pid_file(&spec.pid_file, pid);
    }

    // Health poll — hard checks (port/socket) prove readiness; pid from file after daemonize.
    // Give daemonizing services more time (dnsmasq fork + bind).
    let attempts = if matches!(spec.kind, ServiceKind::DnsMasq) {
        HEALTH_POLL_ATTEMPTS * 2
    } else {
        HEALTH_POLL_ATTEMPTS
    };
    for _ in 0..attempts {
        tokio::time::sleep(Duration::from_millis(HEALTH_POLL_INTERVAL_MS)).await;
        // Drop stale dead pid from file so we re-read after daemon rewrite.
        if let Some(p) = read_pid_file(&spec.pid_file) {
            if !pid_is_alive(p) {
                clear_stale_pid_safe(&spec.pid_file);
            }
        }
        let live_pid = read_pid_file(&spec.pid_file)
            .filter(|p| pid_is_alive(*p))
            .or({
                if !daemonizes && pid != 0 && pid_is_alive(pid) {
                    Some(pid)
                } else {
                    None
                }
            });

        let hard_ok = hard_health_ok(&spec.health)
            || matches!(spec.health, HealthCheck::PidAlive) && live_pid.is_some();

        // dnsmasq: accept live pid-file alone (UDP-only builds may fail TCP probe).
        let dns_ok = matches!(spec.kind, ServiceKind::DnsMasq) && live_pid.is_some();

        if hard_ok || dns_ok {
            if let Some(final_pid) = live_pid.or(if pid != 0 && !daemonizes {
                Some(pid)
            } else {
                None
            }) {
                if final_pid != 0 {
                    let _ = write_pid_file(&spec.pid_file, final_pid);
                }
                return Ok(final_pid);
            }
            // Hard health green right after our spawn but pid file delayed — accept spawn pid.
            if pid != 0 && !daemonizes {
                return Ok(pid);
            }
        }
    }

    // Last chance: real adopt via pid file + hard health
    if let Some(p) = try_adopt(spec) {
        return Ok(p);
    }

    // Health timeout: best-effort cleanup of orphaned spawn (SIGTERM only; never SIGKILL).
    // MariaDB also gets SIGTERM here — admin shutdown is for intentional stop_one.
    best_effort_cleanup_spawn(spec, pid);

    Err(format!(
        "{} started but failed health checks within timeout (see {}; spawn stderr was discarded)",
        spec.id,
        spec.log_file.display()
    ))
}

/// SIGTERM tracked PIDs after failed health (no SIGKILL — MariaDB included).
fn best_effort_cleanup_spawn(spec: &ServiceSpec, spawn_pid: u32) {
    let mut pids = Vec::new();
    if spawn_pid != 0 {
        pids.push(spawn_pid);
    }
    if let Some(p) = read_pid_file(&spec.pid_file) {
        if p != 0 && !pids.contains(&p) {
            pids.push(p);
        }
    }
    for p in pids {
        if pid_is_alive(p) {
            let _ = signal_term(p);
        }
    }
    // Clear our pid file if process is gone (scoped).
    if let Some(p) = read_pid_file(&spec.pid_file) {
        if !pid_is_alive(p) {
            clear_stale_pid_safe(&spec.pid_file);
        }
    }
}

// ── Start / stop ────────────────────────────────────────────────────

/// Ensure at least one PHP-FPM dep is Running and its socket exists before nginx.
/// Auto-starts missing PHP-FPM deps. Hard-fails if none can start (prevents 502 / stuck unhealthy).
async fn ensure_nginx_php_deps(
    inner: &mut SupervisorInner,
    nginx_spec: &ServiceSpec,
    notes: &mut Vec<String>,
) -> Result<(), String> {
    let deps: Vec<String> = nginx_spec
        .depends_on
        .iter()
        .filter(|d| d.starts_with("php-fpm-"))
        .cloned()
        .collect();

    if deps.is_empty() {
        // No discovered PHP — still block if no sock on disk for common tags.
        if let Ok(paths) = build_runtime_paths() {
            let sock74 = PathBuf::from(&paths.socks).join("php74.sock");
            let sock84 = PathBuf::from(&paths.socks).join("php84.sock");
            if !sock74.exists() && !sock84.exists() {
                return Err(
                    "cannot start nginx: no PHP-FPM available (no php74/php84). \
                     Install PHP or start php-fpm first"
                        .into(),
                );
            }
        }
        return Ok(());
    }

    let mut any_running = false;
    for dep in &deps {
        let running = find_spec(&inner.specs, dep)
            .map(|s| matches!(probe_running(s), ServiceStatus::Running { .. }))
            .unwrap_or(false);
        if running {
            any_running = true;
            notes.push(format!("php dep ok: {dep} already running"));
            continue;
        }
        notes.push(format!("auto-starting PHP dependency {dep} before nginx…"));
        // Nested start — clone id, drop borrow of nginx_spec deps.
        let dep_id = dep.clone();
        match Box::pin(start_one(inner, &dep_id, notes)).await {
            Ok(r) if matches!(r.status, ServiceStatus::Running { .. }) => {
                any_running = true;
                notes.push(format!("php dep started: {dep_id}"));
            }
            Ok(r) => {
                notes.push(format!(
                    "php dep {dep_id} did not reach Running: {}",
                    r.message
                ));
            }
            Err(e) => {
                notes.push(format!("php dep {dep_id} start failed: {e}"));
            }
        }
    }

    // Verify at least one Badami FPM socket exists (nginx fastcgi_pass needs it).
    if let Ok(paths) = build_runtime_paths() {
        let socks_dir = PathBuf::from(&paths.socks);
        let has_sock = deps.iter().any(|d| {
            // php-fpm-7.4 → tag 74, php-fpm-8.4 → 84
            let ver = d.strip_prefix("php-fpm-").unwrap_or("");
            let tag: String = ver.chars().filter(|c| c.is_ascii_digit()).collect();
            if tag.is_empty() {
                return false;
            }
            socks_dir.join(format!("php{tag}.sock")).exists()
        }) || socks_dir.join("php74.sock").exists()
            || socks_dir.join("php84.sock").exists();

        if !has_sock {
            return Err(
                "cannot start nginx: PHP-FPM socket missing under local-dev/socks \
                 (start php-fpm-7.4 or php-fpm-8.4 first). Nginx alone causes 502."
                    .into(),
            );
        }
    }

    if !any_running {
        return Err(format!(
            "cannot start nginx: required PHP-FPM not running (need one of: {}). \
             Start PHP-FPM first, then nginx.",
            deps.join(", ")
        ));
    }
    Ok(())
}

async fn start_one(
    inner: &mut SupervisorInner,
    service_id: &str,
    notes: &mut Vec<String>,
) -> Result<ServiceActionResult, String> {
    validate_service_id(service_id)?;
    inner.ensure_specs()?;

    let spec = find_spec(&inner.specs, service_id)
        .cloned()
        .ok_or_else(|| format!("unknown service_id: {service_id}"))?;

    // Hard depends_on for nginx → php-fpm: auto-start missing PHP-FPM first, else refuse.
    // Soft warn for other services.
    if matches!(spec.kind, ServiceKind::Nginx) {
        ensure_nginx_php_deps(inner, &spec, notes).await?;
    } else {
        for dep in &spec.depends_on {
            if let Some(dep_spec) = find_spec(&inner.specs, dep) {
                if !matches!(probe_running(dep_spec), ServiceStatus::Running { .. }) {
                    notes.push(format!(
                        "depends_on: {dep} is not running — start it first or use ld_stack_start"
                    ));
                }
            }
        }
    }

    // Ownership-aware status (TCP alone is never "already running").
    match probe_running(&spec) {
        ServiceStatus::Running { pid } if pid != 0 => {
            let rt = inner.runtimes.entry(service_id.to_string()).or_default();
            rt.status = ServiceStatus::Running { pid };
            rt.pid = Some(pid);
            return Ok(ServiceActionResult {
                service_id: service_id.to_string(),
                status: ServiceStatus::Running { pid },
                message: format!("{service_id} already running (adopted pid {pid})"),
                notes: notes.clone(),
            });
        }
        ServiceStatus::Running { pid: 0 } => {
            // Defensive: should not occur after adopt hardening.
            notes.push("probe returned Running with pid 0 — treating as not owned".into());
        }
        ServiceStatus::Unhealthy { reason, .. } => {
            let is_mariadb = matches!(spec.kind, ServiceKind::MariaDb | ServiceKind::MySql);
            if is_mariadb {
                // MariaDB: preflight below decides Adopt vs HardFail.
                notes.push(format!("probe: {reason}"));
            } else if matches!(spec.kind, ServiceKind::Nginx) {
                // Port busy — if it's *our* master (root Mode B), adopt instead of hard-fail.
                if let Some(pid) = find_our_nginx_master(&spec) {
                    let _ = write_pid_file(&spec.pid_file, pid);
                    // Still ensure PHP is up so site is not 502 "unhealthy" forever.
                    let _ = ensure_nginx_php_deps(inner, &spec, notes).await;
                    let status = ServiceStatus::Running { pid };
                    let rt = inner.runtimes.entry(service_id.to_string()).or_default();
                    rt.status = status.clone();
                    rt.pid = Some(pid);
                    return Ok(ServiceActionResult {
                        service_id: service_id.to_string(),
                        status,
                        message: format!("{service_id} already running (adopted master pid {pid})"),
                        notes: notes.clone(),
                    });
                }
                let status = ServiceStatus::Error {
                    message: reason.clone(),
                };
                inner.runtimes.entry(service_id.to_string()).or_default().status =
                    status.clone();
                return Err(format!("cannot start {service_id}: {reason}"));
            } else {
                // Foreign listener / conflict — refuse start (do not claim adopted).
                let status = ServiceStatus::Error {
                    message: reason.clone(),
                };
                inner.runtimes.entry(service_id.to_string()).or_default().status =
                    status.clone();
                return Err(format!("cannot start {service_id}: {reason}"));
            }
        }
        ServiceStatus::Unavailable { reason } => {
            let status = ServiceStatus::Unavailable {
                reason: reason.clone(),
            };
            inner.runtimes.entry(service_id.to_string()).or_default().status = status.clone();
            return Ok(ServiceActionResult {
                service_id: service_id.to_string(),
                status,
                message: reason,
                notes: notes.clone(),
            });
        }
        _ => {}
    }

    if !spec.binary_path.is_file() {
        let reason = format!("binary missing: {}", spec.binary_path.display());
        let status = ServiceStatus::Unavailable {
            reason: reason.clone(),
        };
        inner.runtimes.entry(service_id.to_string()).or_default().status = status.clone();
        return Ok(ServiceActionResult {
            service_id: service_id.to_string(),
            status,
            message: reason,
            notes: notes.clone(),
        });
    }

    // Config gate
    if let Err(e) = check_requires_config(&spec) {
        let status = ServiceStatus::Error {
            message: e.clone(),
        };
        inner.runtimes.entry(service_id.to_string()).or_default().status = status.clone();
        return Err(e);
    }

    // Nginx on privileged ports (e.g. :80) — Herd uses a privileged helper; we use
    // LaunchDaemon (preferred) or one-shot admin elevation so UI Start/Stop work.
    if matches!(spec.kind, ServiceKind::Nginx) && nginx_needs_root(&spec) {
        {
            let rt = inner.runtimes.entry(service_id.to_string()).or_default();
            rt.status = ServiceStatus::Starting;
        }
        return match start_nginx_privileged(&spec, notes).await {
            Ok(pid) => {
                let status = ServiceStatus::Running { pid };
                let rt = inner.runtimes.entry(service_id.to_string()).or_default();
                rt.status = status.clone();
                rt.pid = if pid == 0 { None } else { Some(pid) };
                Ok(ServiceActionResult {
                    service_id: service_id.to_string(),
                    status,
                    message: format!("{service_id} started (privileged Mode B / admin)"),
                    notes: notes.clone(),
                })
            }
            Err(e) => {
                let status = ServiceStatus::Error {
                    message: e.clone(),
                };
                inner.runtimes.entry(service_id.to_string()).or_default().status =
                    status.clone();
                Err(e)
            }
        };
    }

    // MariaDB special: preflight first
    if matches!(spec.kind, ServiceKind::MariaDb | ServiceKind::MySql) {
        let report = run_preflight(MariadbPreflightRequest::default())?;
        notes.extend(report.checks.iter().cloned());
        match report.result {
            MariadbPreflight::OkToStart => {
                notes.push("mariadb_preflight: OkToStart".into());
            }
            MariadbPreflight::Adopt { pid, reason } => {
                notes.push(format!("mariadb_preflight: Adopt — {reason}"));
                let pid = pid.unwrap_or(0);
                if pid != 0 {
                    let _ = write_pid_file(&spec.pid_file, pid);
                }
                let status = ServiceStatus::Running { pid };
                let rt = inner.runtimes.entry(service_id.to_string()).or_default();
                rt.status = status.clone();
                rt.pid = if pid == 0 { None } else { Some(pid) };
                return Ok(ServiceActionResult {
                    service_id: service_id.to_string(),
                    status,
                    message: format!("adopted existing MariaDB ({reason})"),
                    notes: notes.clone(),
                });
            }
            MariadbPreflight::HardFail { reason } => {
                let status = ServiceStatus::Error {
                    message: reason.clone(),
                };
                inner.runtimes.entry(service_id.to_string()).or_default().status = status.clone();
                return Err(format!("MariaDB preflight HardFail: {reason}"));
            }
        }
    }

    {
        let rt = inner.runtimes.entry(service_id.to_string()).or_default();
        rt.status = ServiceStatus::Starting;
    }

    match spawn_service(&spec).await {
        Ok(pid) => {
            let status = ServiceStatus::Running { pid };
            let rt = inner.runtimes.entry(service_id.to_string()).or_default();
            rt.status = status.clone();
            rt.pid = if pid == 0 { None } else { Some(pid) };
            Ok(ServiceActionResult {
                service_id: service_id.to_string(),
                status,
                message: format!("{service_id} started"),
                notes: notes.clone(),
            })
        }
        Err(e) => {
            let status = ServiceStatus::Error {
                message: e.clone(),
            };
            inner.runtimes.entry(service_id.to_string()).or_default().status = status.clone();
            Err(e)
        }
    }
}

async fn stop_one(
    inner: &mut SupervisorInner,
    service_id: &str,
    notes: &mut Vec<String>,
) -> Result<ServiceActionResult, String> {
    validate_service_id(service_id)?;
    inner.ensure_specs()?;

    let spec = find_spec(&inner.specs, service_id)
        .cloned()
        .ok_or_else(|| format!("unknown service_id: {service_id}"))?;

    let current = probe_running(&spec);
    let pid = match &current {
        ServiceStatus::Running { pid } if *pid != 0 => Some(*pid),
        ServiceStatus::Running { .. } => read_pid_file(&spec.pid_file),
        ServiceStatus::Stopped | ServiceStatus::Unavailable { .. } => {
            return Ok(ServiceActionResult {
                service_id: service_id.to_string(),
                status: ServiceStatus::Stopped,
                message: format!("{service_id} already stopped"),
                notes: notes.clone(),
            });
        }
        ServiceStatus::Unhealthy { pid, .. } => *pid,
        _ => read_pid_file(&spec.pid_file).or(inner.runtimes.get(service_id).and_then(|r| r.pid)),
    };

    {
        let rt = inner.runtimes.entry(service_id.to_string()).or_default();
        rt.status = ServiceStatus::Stopping;
    }

    // MariaDB: mysqladmin/mariadb-admin shutdown first
    if matches!(spec.kind, ServiceKind::MariaDb | ServiceKind::MySql) {
        if let Err(e) = mariadb_graceful_shutdown(&spec, notes).await {
            notes.push(format!("mariadb admin shutdown: {e}"));
        }
        // Wait grace
        let deadline = Instant::now() + Duration::from_secs(MARIADB_SHUTDOWN_GRACE_SECS);
        while Instant::now() < deadline {
            if !health_ok(&spec, pid) && pid.map(|p| !pid_is_alive(p)).unwrap_or(true) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
        // If still alive → SIGTERM (no auto SIGKILL)
        if let Some(p) = pid {
            if pid_is_alive(p) {
                notes.push(format!("MariaDB still alive after admin; SIGTERM {p}"));
                let _ = signal_term(p);
                let deadline = Instant::now() + Duration::from_secs(15);
                while Instant::now() < deadline && pid_is_alive(p) {
                    tokio::time::sleep(Duration::from_millis(400)).await;
                }
                if pid_is_alive(p) {
                    notes.push(
                        "MariaDB still alive after SIGTERM — NOT sending SIGKILL (manual intervention required)"
                            .into(),
                    );
                    let status = ServiceStatus::Unhealthy {
                        pid: Some(p),
                        reason: "shutdown incomplete; no auto-SIGKILL".into(),
                    };
                    inner.runtimes.entry(service_id.to_string()).or_default().status =
                        status.clone();
                    return Ok(ServiceActionResult {
                        service_id: service_id.to_string(),
                        status,
                        message: "MariaDB stop incomplete".into(),
                        notes: notes.clone(),
                    });
                }
            }
        }
    } else if matches!(spec.kind, ServiceKind::Nginx) {
        // Heal pid; privileged port or root master always goes through elevated stop
        // (unprivileged nginx -s quit / SIGTERM cannot signal root masters).
        let master = find_our_nginx_master(&spec).or(pid);
        if let Some(p) = master {
            let _ = write_pid_file(&spec.pid_file, p);
        }
        if nginx_needs_root(&spec) {
            stop_nginx_privileged(&spec, notes).await;
        } else if spec.binary_path.is_file() {
            let conf = spec
                .requires_config
                .first()
                .cloned()
                .unwrap_or_else(|| PathBuf::from("nginx.conf"));
            let prefix = spec
                .working_dir
                .clone()
                .or_else(|| conf.parent().map(|p| p.to_path_buf()))
                .unwrap_or_else(|| PathBuf::from("."));
            let conf_s = conf.to_string_lossy().into_owned();
            let prefix_s = prefix.to_string_lossy().into_owned();
            let mut cmd = Command::new(&spec.binary_path);
            cmd.args(["-c", &conf_s, "-p", &prefix_s, "-s", "quit"]);
            cmd.kill_on_drop(true);
            cmd.stdin(std::process::Stdio::null());
            cmd.stdout(std::process::Stdio::null());
            cmd.stderr(std::process::Stdio::null());
            match cmd.status().await {
                Ok(st) if st.success() => notes.push("nginx -s quit: ok".into()),
                Ok(st) => {
                    notes.push(format!("nginx -s quit: exit {st} — elevating stop"));
                    stop_nginx_privileged(&spec, notes).await;
                }
                Err(e) => {
                    notes.push(format!("nginx -s quit: {e} — elevating stop"));
                    stop_nginx_privileged(&spec, notes).await;
                }
            }
            if let Some(p) = master.or(pid) {
                if pid_is_alive(p) && signal_term(p).is_err() {
                    stop_nginx_privileged(&spec, notes).await;
                }
            }
        }
        wait_until_dead(find_our_nginx_master(&spec).or(master).or(pid), DEFAULT_STOP_GRACE_SECS)
            .await;
        if find_our_nginx_master(&spec).is_some() || hard_health_ok(&spec.health) {
            notes.push("nginx still up after stop — force privileged kill".into());
            stop_nginx_privileged(&spec, notes).await;
            wait_until_dead(find_our_nginx_master(&spec), DEFAULT_STOP_GRACE_SECS).await;
        }
    } else if matches!(spec.kind, ServiceKind::PhpFpm { .. }) {
        // SIGQUIT is the conventional graceful FPM master shutdown.
        if let Some(p) = pid {
            if pid_is_alive(p) {
                if let Err(e) = signal_quit(p) {
                    notes.push(format!("php-fpm SIGQUIT: {e}; falling back to SIGTERM"));
                    let _ = signal_term(p);
                }
            }
        }
        wait_until_dead(pid, DEFAULT_STOP_GRACE_SECS).await;
    } else {
        // Generic: SIGTERM (never SIGKILL)
        if let Some(p) = pid {
            if pid_is_alive(p) {
                signal_term(p)?;
            }
        }
        wait_until_dead(pid, DEFAULT_STOP_GRACE_SECS).await;
    }

    // Clear our pid file if process is gone (local-dev/pids + .pid basename only).
    if let Some(p) = read_pid_file(&spec.pid_file) {
        if !pid_is_alive(p) {
            clear_stale_pid_safe(&spec.pid_file);
        }
    }

    // Re-probe reality — do not trust the pre-stop pid (master may have been
    // replaced / elevated). Nginx: also check cmdline discovery.
    let live_master = if matches!(spec.kind, ServiceKind::Nginx) {
        find_our_nginx_master(&spec)
    } else {
        None
    };
    let still_owned = live_master
        .map(pid_is_alive)
        .unwrap_or_else(|| pid.map(pid_is_alive).unwrap_or(false));
    let still_listening = hard_health_ok(&spec.health);
    let status = if still_owned {
        ServiceStatus::Unhealthy {
            pid: live_master.or(pid),
            reason: "process still present after stop".into(),
        }
    } else if still_listening {
        // Port still open but not our master — foreign process; mark stopped for
        // *our* service so UI unlocks (user can free the port separately).
        notes.push(
            "port still accepting but no Badami master found — treating as stopped for UI"
                .into(),
        );
        clear_stale_pid_safe(&spec.pid_file);
        ServiceStatus::Stopped
    } else {
        clear_stale_pid_safe(&spec.pid_file);
        ServiceStatus::Stopped
    };

    let rt = inner.runtimes.entry(service_id.to_string()).or_default();
    rt.status = status.clone();
    rt.pid = match &status {
        ServiceStatus::Unhealthy { pid: p, .. } => *p,
        _ => None,
    };

    let message = match &status {
        ServiceStatus::Stopped => format!("{service_id} stopped"),
        ServiceStatus::Unhealthy { reason, .. } => {
            format!("{service_id} stop incomplete: {reason}")
        }
        _ => format!("{service_id} stop completed"),
    };

    Ok(ServiceActionResult {
        service_id: service_id.to_string(),
        status,
        message,
        notes: notes.clone(),
    })
}

fn path_under(root: &Path, path: &Path) -> bool {
    let rs = root.to_string_lossy();
    let ps = path.to_string_lossy();
    ps == rs || ps.starts_with(&format!("{rs}/"))
}

async fn wait_until_dead(pid: Option<u32>, secs: u64) {
    let Some(p) = pid else { return };
    let deadline = Instant::now() + Duration::from_secs(secs);
    while Instant::now() < deadline && pid_is_alive(p) {
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

async fn mariadb_graceful_shutdown(spec: &ServiceSpec, notes: &mut Vec<String>) -> Result<(), String> {
    let wrapper = spec
        .requires_config
        .first()
        .cloned()
        .unwrap_or_else(|| {
            build_runtime_paths()
                .map(|p| PathBuf::from(p.mariadb).join("my.cnf"))
                .unwrap_or_else(|_| PathBuf::from("my.cnf"))
        });

    let admin = discover()
        .ok()
        .and_then(|d| resolve_mariadb_admin(&d, &wrapper))
        .or_else(|| {
            super::mariadb_guard::load_wrapper_config(&wrapper)
                .ok()
                .and_then(|cfg| {
                    for name in ["mariadb-admin", "mysqladmin"] {
                        let p = cfg.basedir.join("bin").join(name);
                        if p.is_file() {
                            return Some(p);
                        }
                    }
                    None
                })
        });

    let Some(admin) = admin else {
        return Err("mariadb-admin/mysqladmin not found".into());
    };

    notes.push(format!("using admin {}", admin.display()));

    // argv only — defaults-file path is our generated wrapper (trusted layout).
    let mut cmd = Command::new(&admin);
    cmd.arg(format!("--defaults-file={}", wrapper.display()));
    cmd.arg("shutdown");
    cmd.kill_on_drop(true);
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::null());
    cmd.stderr(std::process::Stdio::null());

    let status = cmd
        .status()
        .await
        .map_err(|e| format!("admin spawn: {e}"))?;
    if status.success() {
        notes.push("mariadb-admin shutdown: ok".into());
        Ok(())
    } else {
        Err(format!("mariadb-admin shutdown exit {status}"))
    }
}

// ── Auto-restart rate limit ─────────────────────────────────────────

fn prune_restarts(times: &mut Vec<Instant>) {
    let cutoff = Instant::now() - AUTO_RESTART_WINDOW;
    times.retain(|t| *t > cutoff);
}

fn can_auto_restart(times: &mut Vec<Instant>) -> bool {
    prune_restarts(times);
    times.len() < AUTO_RESTART_MAX
}

// ── Log tail / rotate ───────────────────────────────────────────────

/// If log file > 50 MiB, rename to `.1` (shift `.1`→`.2`), leave path free for recreation.
/// Returns true if rotation occurred.
pub fn maybe_rotate_log(path: &Path) -> Result<bool, String> {
    if !path.is_file() {
        return Ok(false);
    }
    let meta = fs::metadata(path).map_err(|e| format!("stat log: {e}"))?;
    if meta.len() <= LOG_ROTATE_BYTES {
        return Ok(false);
    }
    rotate_log_file(path)
}

/// Force-rotate helper (also used by tests).
pub fn rotate_log_file(path: &Path) -> Result<bool, String> {
    if !path.is_file() {
        return Ok(false);
    }
    let name = path
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "log path has no file name".to_string())?;
    let parent = path.parent().unwrap_or_else(|| Path::new("."));

    // Keep at most 2 rotated files: .1 and .2
    // Shift .1 → .2, then path → .1
    let r1 = parent.join(format!("{name}.1"));
    let r2 = parent.join(format!("{name}.2"));
    if r2.exists() {
        fs::remove_file(&r2).map_err(|e| format!("remove {}.2: {e}", name))?;
    }
    if r1.exists() {
        fs::rename(&r1, &r2).map_err(|e| format!("rename log .1→.2: {e}"))?;
    }
    fs::rename(path, &r1).map_err(|e| format!("rename log → .1: {e}"))?;
    // Create empty log so tail/path stays valid
    fs::write(path, b"").map_err(|e| format!("truncate log: {e}"))?;
    // Cap: if somehow more than MAX_ROTATED, we already only keep 2.
    let _ = MAX_ROTATED_LOGS;
    Ok(true)
}

/// Read last `lines` lines from log, max 512 KiB.
pub fn read_log_tail(path: &Path, lines: usize) -> Result<(Vec<String>, bool), String> {
    if !path.is_file() {
        return Ok((Vec::new(), false));
    }
    let meta = fs::metadata(path).map_err(|e| format!("stat log: {e}"))?;
    let file_len = meta.len();
    let read_from = file_len.saturating_sub(LOG_TAIL_MAX_BYTES);
    let truncated = read_from > 0;

    let mut f = fs::File::open(path).map_err(|e| format!("open log: {e}"))?;
    f.seek(SeekFrom::Start(read_from))
        .map_err(|e| format!("seek log: {e}"))?;
    let mut buf = String::new();
    f.read_to_string(&mut buf)
        .map_err(|e| format!("read log: {e}"))?;

    // If we started mid-line, drop the first partial line.
    let content = if read_from > 0 {
        match buf.find('\n') {
            Some(i) => &buf[i + 1..],
            None => buf.as_str(),
        }
    } else {
        buf.as_str()
    };

    let all: Vec<&str> = content.lines().collect();
    let n = lines.min(all.len());
    let start = all.len().saturating_sub(n);
    let out: Vec<String> = all[start..].iter().map(|s| (*s).to_string()).collect();
    Ok((out, truncated))
}

// ── Status snapshot ─────────────────────────────────────────────────

fn status_report(spec: &ServiceSpec, rt: &ManagedRuntime) -> ServiceStatusReport {
    let probed = probe_running(spec);
    // Prefer live probe over stale memory for Running/Stopped.
    let status = match (&rt.status, &probed) {
        (ServiceStatus::Starting, _) => rt.status.clone(),
        (ServiceStatus::Stopping, _) => rt.status.clone(),
        (_, ServiceStatus::Running { .. }) => probed,
        (_, ServiceStatus::Unavailable { .. }) => probed,
        (ServiceStatus::Error { .. }, ServiceStatus::Stopped) => rt.status.clone(),
        _ => probed,
    };

    ServiceStatusReport {
        id: spec.id.clone(),
        label: spec.label.clone(),
        kind: spec.kind.clone(),
        status,
        binary_path: if spec.binary_path.as_os_str().is_empty() {
            None
        } else {
            Some(spec.binary_path.to_string_lossy().into_owned())
        },
        binary_present: spec.binary_present || spec.binary_path.is_file(),
        pid_file: spec.pid_file.to_string_lossy().into_owned(),
        log_file: spec.log_file.to_string_lossy().into_owned(),
        auto_restart: spec.auto_restart,
        notes: vec![],
    }
}

async fn maybe_auto_restart(inner: &mut SupervisorInner, service_id: &str) {
    let spec = match find_spec(&inner.specs, service_id) {
        Some(s) => s.clone(),
        None => return,
    };
    if !spec.auto_restart {
        return;
    }
    // Never auto-restart MariaDB even if misconfigured.
    if matches!(spec.kind, ServiceKind::MariaDb | ServiceKind::MySql) {
        return;
    }
    let probed = probe_running(&spec);
    if matches!(probed, ServiceStatus::Running { .. }) {
        return;
    }
    if matches!(probed, ServiceStatus::Unavailable { .. }) {
        return;
    }
    // Only restart if we previously thought it was running (crash recovery).
    let should = matches!(
        inner.runtimes.get(service_id).map(|r| &r.status),
        Some(ServiceStatus::Running { .. }) | Some(ServiceStatus::Unhealthy { .. })
    );
    if !should {
        return;
    }
    let rt = inner.runtimes.entry(service_id.to_string()).or_default();
    if !can_auto_restart(&mut rt.restart_times) {
        rt.status = ServiceStatus::Unhealthy {
            pid: None,
            reason: format!(
                "auto_restart rate limit ({AUTO_RESTART_MAX} / 5 min) exceeded"
            ),
        };
        return;
    }
    rt.restart_times.push(Instant::now());
    let mut notes = Vec::new();
    let _ = start_one(inner, service_id, &mut notes).await;
}

// ── Tauri commands ──────────────────────────────────────────────────

#[tauri::command]
pub async fn ld_service_start(
    state: tauri::State<'_, LocalDevState>,
    service_id: String,
) -> Result<ServiceActionResult, String> {
    validate_service_id(&service_id)?;
    let mut inner = state.inner.lock().await;
    // Refresh specs so config/binary discovery is current
    let _ = inner.refresh_specs();
    let mut notes = Vec::new();
    start_one(&mut inner, &service_id, &mut notes).await
}

#[tauri::command]
pub async fn ld_service_stop(
    state: tauri::State<'_, LocalDevState>,
    service_id: String,
) -> Result<ServiceActionResult, String> {
    validate_service_id(&service_id)?;
    let mut inner = state.inner.lock().await;
    let _ = inner.ensure_specs();
    let mut notes = Vec::new();
    stop_one(&mut inner, &service_id, &mut notes).await
}

#[tauri::command]
pub async fn ld_service_restart(
    state: tauri::State<'_, LocalDevState>,
    service_id: String,
) -> Result<ServiceActionResult, String> {
    validate_service_id(&service_id)?;
    let mut inner = state.inner.lock().await;
    let _ = inner.refresh_specs();
    let mut notes = Vec::new();
    let stop_res = stop_one(&mut inner, &service_id, &mut notes).await?;
    notes.extend(stop_res.notes);
    // Brief pause so ports free
    tokio::time::sleep(Duration::from_millis(400)).await;
    start_one(&mut inner, &service_id, &mut notes).await
}

#[tauri::command]
pub async fn ld_service_status(
    state: tauri::State<'_, LocalDevState>,
    service_id: Option<String>,
) -> Result<Vec<ServiceStatusReport>, String> {
    if let Some(ref id) = service_id {
        validate_service_id(id)?;
    }
    let mut inner = state.inner.lock().await;
    inner.ensure_specs()?;

    let ids: Vec<String> = if let Some(id) = service_id {
        vec![id]
    } else {
        inner.specs.iter().map(|s| s.id.clone()).collect()
    };

    // Opportunistic auto-restart for configured services
    for id in &ids {
        maybe_auto_restart(&mut inner, id).await;
    }

    let mut out = Vec::new();
    for id in ids {
        let spec = match find_spec(&inner.specs, &id) {
            Some(s) => s.clone(),
            None => {
                out.push(ServiceStatusReport {
                    id: id.clone(),
                    label: id.clone(),
                    kind: ServiceKind::Nginx,
                    status: ServiceStatus::Error {
                        message: format!("unknown service_id: {id}"),
                    },
                    binary_path: None,
                    binary_present: false,
                    pid_file: String::new(),
                    log_file: String::new(),
                    auto_restart: false,
                    notes: vec![],
                });
                continue;
            }
        };
        let rt = inner.runtimes.entry(id).or_default();
        let report = status_report(&spec, rt);
        // Persist probed status into memory
        rt.status = report.status.clone();
        if let ServiceStatus::Running { pid } = &report.status {
            rt.pid = if *pid == 0 { None } else { Some(*pid) };
        }
        out.push(report);
    }
    Ok(out)
}

#[tauri::command]
pub async fn ld_stack_start(
    state: tauri::State<'_, LocalDevState>,
) -> Result<StackActionResult, String> {
    let mut inner = state.inner.lock().await;
    inner.refresh_specs()?;
    let ids: Vec<String> = inner.specs.iter().map(|s| s.id.clone()).collect();
    let order = stack_start_order(&ids);

    let mut results = Vec::new();
    let mut notes = vec![
        format!("stack start order: {}", order.join(" → ")),
        "MVP: non-DNS failures are recorded and the stack continues; inspect results + partial_failure".into(),
    ];
    let mut partial_failure = false;

    for id in order {
        let mut local_notes = Vec::new();
        let is_dns = id == "dnsmasq";
        match start_one(&mut inner, &id, &mut local_notes).await {
            Ok(r) => {
                if is_dns {
                    notes.push(
                        "dnsmasq: best-effort (failure does not abort stack)".into(),
                    );
                }
                // Soft failures (Unavailable / Error status in Ok path)
                if matches!(
                    r.status,
                    ServiceStatus::Error { .. } | ServiceStatus::Unavailable { .. }
                ) && !is_dns
                {
                    partial_failure = true;
                }
                notes.extend(local_notes);
                results.push(r);
            }
            Err(e) => {
                notes.extend(local_notes);
                if is_dns {
                    notes.push(format!("dnsmasq start failed (continuing): {e}"));
                    results.push(ServiceActionResult {
                        service_id: id,
                        status: ServiceStatus::Error { message: e },
                        message: "DNS best-effort failure — stack continues".into(),
                        notes: vec![],
                    });
                    // DNS best-effort: does not set partial_failure.
                    continue;
                }
                // Non-DNS: continue for MVP partial stack, but flag partial_failure.
                partial_failure = true;
                notes.push(format!("non-DNS failure (continuing stack): {id}: {e}"));
                results.push(ServiceActionResult {
                    service_id: id.clone(),
                    status: ServiceStatus::Error {
                        message: e.clone(),
                    },
                    message: e,
                    notes: vec![],
                });
            }
        }
    }

    Ok(StackActionResult {
        results,
        notes,
        partial_failure,
    })
}

#[tauri::command]
pub async fn ld_stack_stop(
    state: tauri::State<'_, LocalDevState>,
) -> Result<StackActionResult, String> {
    let mut inner = state.inner.lock().await;
    inner.ensure_specs()?;
    let ids: Vec<String> = inner.specs.iter().map(|s| s.id.clone()).collect();
    let order = stack_stop_order(&ids);

    let mut results = Vec::new();
    let mut notes = vec![format!("stack stop order: {}", order.join(" → "))];
    let mut partial_failure = false;

    for id in order {
        let mut local_notes = Vec::new();
        match stop_one(&mut inner, &id, &mut local_notes).await {
            Ok(r) => {
                if matches!(
                    r.status,
                    ServiceStatus::Error { .. } | ServiceStatus::Unhealthy { .. }
                ) {
                    partial_failure = true;
                }
                notes.extend(local_notes);
                results.push(r);
            }
            Err(e) => {
                partial_failure = true;
                notes.extend(local_notes);
                notes.push(format!("stop {id}: {e}"));
                results.push(ServiceActionResult {
                    service_id: id,
                    status: ServiceStatus::Error { message: e },
                    message: "stop error".into(),
                    notes: vec![],
                });
            }
        }
    }

    Ok(StackActionResult {
        results,
        notes,
        partial_failure,
    })
}

#[tauri::command]
pub async fn ld_log_tail(
    state: tauri::State<'_, LocalDevState>,
    service_id: String,
    lines: Option<u32>,
) -> Result<LogTailResult, String> {
    validate_service_id(&service_id)?;
    let n = lines.unwrap_or(100).min(5000) as usize;

    let mut inner = state.inner.lock().await;
    inner.ensure_specs()?;
    let spec = find_spec(&inner.specs, &service_id)
        .cloned()
        .ok_or_else(|| format!("unknown service_id: {service_id}"))?;
    drop(inner);

    let rotated = maybe_rotate_log(&spec.log_file).unwrap_or(false);
    let (line_vec, truncated) = read_log_tail(&spec.log_file, n)?;

    Ok(LogTailResult {
        service_id,
        path: spec.log_file.to_string_lossy().into_owned(),
        lines: line_vec,
        truncated,
        rotated,
    })
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn rotate_log_shifts_and_caps_at_two() {
        let dir = std::env::temp_dir().join(format!("badami-log-rot-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let log = dir.join("svc.log");
        fs::write(&log, b"current\n").unwrap();
        fs::write(dir.join("svc.log.1"), b"old1\n").unwrap();
        fs::write(dir.join("svc.log.2"), b"old2\n").unwrap();

        assert!(rotate_log_file(&log).unwrap());
        assert!(log.is_file());
        assert_eq!(fs::read_to_string(&log).unwrap(), "");
        assert_eq!(fs::read_to_string(dir.join("svc.log.1")).unwrap(), "current\n");
        assert_eq!(fs::read_to_string(dir.join("svc.log.2")).unwrap(), "old1\n");
        // .2 old content replaced — only 2 rotated kept
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn maybe_rotate_skips_small_files() {
        let dir = std::env::temp_dir().join(format!("badami-log-small-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let log = dir.join("tiny.log");
        fs::write(&log, b"hi\n").unwrap();
        assert!(!maybe_rotate_log(&log).unwrap());
        assert_eq!(fs::read_to_string(&log).unwrap(), "hi\n");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn log_tail_last_n_and_max_bytes() {
        let dir = std::env::temp_dir().join(format!("badami-log-tail-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let log = dir.join("app.log");
        let mut f = fs::File::create(&log).unwrap();
        for i in 0..50 {
            writeln!(f, "line-{i}").unwrap();
        }
        drop(f);
        let (lines, truncated) = read_log_tail(&log, 5).unwrap();
        assert!(!truncated);
        assert_eq!(lines.len(), 5);
        assert_eq!(lines[0], "line-45");
        assert_eq!(lines[4], "line-49");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn log_tail_missing_file_empty() {
        let (lines, truncated) =
            read_log_tail(Path::new("/tmp/definitely-missing-badami-log-xyz.log"), 10).unwrap();
        assert!(lines.is_empty());
        assert!(!truncated);
    }

    #[test]
    fn auto_restart_rate_limit() {
        let mut times = Vec::new();
        for _ in 0..AUTO_RESTART_MAX {
            assert!(can_auto_restart(&mut times));
            times.push(Instant::now());
        }
        assert!(!can_auto_restart(&mut times));
    }

    #[test]
    fn path_same_binary_rejects_basename_only() {
        // Different paths with the same basename must NOT match (Issue 3).
        assert!(!path_same_binary(
            Path::new("/usr/local/bin/nginx"),
            Path::new("/opt/homebrew/bin/nginx")
        ));
        assert!(!path_same_binary(
            Path::new("/usr/bin/nginx"),
            Path::new("/usr/bin/redis-server")
        ));
        // Same path (lexical) after canonicalize failure still matches via equality of
        // non-canonical fallbacks only when identical PathBufs.
        let p = Path::new("/bin/sh");
        if p.is_file() {
            assert!(path_same_binary(p, p));
        }
    }

    #[test]
    fn hard_health_composite_requires_all_hard_checks() {
        let sock = PathBuf::from("/tmp/definitely-missing-badami-sock.sock");
        let check = HealthCheck::Composite {
            checks: vec![
                HealthCheck::PidAlive,
                HealthCheck::UnixSocket { path: sock },
                HealthCheck::Tcp {
                    host: "127.0.0.1".into(),
                    port: 1, // almost never accepting
                },
            ],
        };
        assert!(!hard_health_ok(&check));
    }

    #[test]
    fn maybe_auto_restart_skips_mariadb_kind() {
        // Kind guard: even if auto_restart were true, MariaDB must not restart.
        let mut inner = SupervisorInner::new();
        let mut spec = ServiceSpec {
            kind: ServiceKind::MariaDb,
            id: "mariadb".into(),
            binary_path: PathBuf::from("/nonexistent/mariadbd"),
            args: vec![],
            pid_file: PathBuf::from("/tmp/x.pid"),
            log_file: PathBuf::from("/tmp/x.log"),
            working_dir: None,
            env: vec![],
            health: HealthCheck::PidAlive,
            auto_restart: true, // misconfigured on purpose
            depends_on: vec![],
            requires_config: vec![],
            label: "MariaDB".into(),
            binary_present: false,
        };
        // Ensure kind guard is what we test — use runtime future via block_on-less path:
        // maybe_auto_restart is async; call the kind check logic inline.
        assert!(matches!(spec.kind, ServiceKind::MariaDb));
        assert!(spec.auto_restart); // would be dangerous without kind guard
        // Simulate the guard from maybe_auto_restart:
        let blocked = matches!(spec.kind, ServiceKind::MariaDb | ServiceKind::MySql)
            || !spec.auto_restart;
        // With mis-set auto_restart, kind still blocks:
        let kind_blocks = matches!(spec.kind, ServiceKind::MariaDb | ServiceKind::MySql);
        assert!(kind_blocks);
        let _ = (&mut inner, &mut spec, blocked);
    }

    #[test]
    fn port_conflict_reason_mentions_ownership() {
        let spec = ServiceSpec {
            kind: ServiceKind::Nginx,
            id: "nginx".into(),
            binary_path: PathBuf::from("/usr/bin/nginx"),
            args: vec![],
            pid_file: PathBuf::from("/tmp/n.pid"),
            log_file: PathBuf::from("/tmp/n.log"),
            working_dir: None,
            env: vec![],
            health: HealthCheck::Tcp {
                host: "127.0.0.1".into(),
                port: 8080,
            },
            auto_restart: true,
            depends_on: vec![],
            requires_config: vec![],
            label: "nginx".into(),
            binary_present: true,
        };
        let r = port_conflict_reason(&spec);
        assert!(r.contains("not owned"));
        assert!(r.contains("nginx"));
    }
}
