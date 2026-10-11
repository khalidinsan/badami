//! Read-only discovery of the Badami local-dev runtime: provisioned binaries,
//! MariaDB datadirs, ports, and runtime paths.
//!
//! **Safety:** this module never starts/stops processes, never writes configs,
//! and never mutates or deletes MariaDB datadirs.

use super::runtime_manifest::{self, RuntimeComponent};
use serde::{Deserialize, Serialize};
use std::fs;
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

const RESOLVER_TEST: &str = "/etc/resolver/test";

/// Ports checked for an accepting TCP listener (read-only connect probe).
const SCAN_PORTS: &[u16] = &[80, 8080, 3306, 6379, 53];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimePaths {
    /// `~/Library/Application Support/Badami/local-dev` (string only; not created here).
    pub local_dev_root: String,
    pub config_valet: String,
    pub nginx: String,
    pub fpm: String,
    pub socks: String,
    pub mariadb: String,
    pub valet_server: String,
    pub pids: String,
    pub logs: String,
    pub import: String,
    /// Badami-owned binaries at `<root>/runtime/<role>/<version>/`.
    ///
    /// Populated by [`super::provision`]; absent on a pre-standalone install.
    pub runtime: String,
    /// Badami-owned service data at `<root>/data/` (MariaDB datadir lives here).
    pub data: String,
    /// Per-version php.ini scan dirs at `<root>/config/php/<tag>/`.
    pub php_config: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MyCnfInfo {
    pub path: String,
    pub basedir: Option<String>,
    pub datadir: Option<String>,
    pub socket: Option<String>,
    pub port: Option<u16>,
    pub log_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MariadbCandidate {
    pub path: String,
    pub uuid: String,
    pub bytes: u64,
    pub score: i64,
    pub has_ibdata1: bool,
    pub has_mysql_schema: bool,
    pub my_cnf: Option<MyCnfInfo>,
    /// Seconds since last modification of the directory (best-effort).
    pub modified_secs_ago: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhpVersionInfo {
    /// Display version, e.g. `"7.4"`, `"8.4"`.
    pub version: String,
    /// Compact tag used in binary names, e.g. `"74"`, `"84"`.
    pub tag: String,
    pub available: bool,
    pub reason: Option<String>,
    pub cli_path: Option<String>,
    pub fpm_path: Option<String>,
    pub fpm_conf_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BinaryCandidate {
    pub role: String,
    pub path: String,
    pub version: Option<String>,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortInUse {
    pub port: u16,
    pub listening: bool,
    /// Reserved for future PID resolution (e.g. `lsof`); always `None` in Phase A.
    pub pid: Option<u32>,
    /// Reserved for future process name resolution; always `None` in Phase A.
    pub process: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolverInfo {
    pub path: String,
    pub present: bool,
    pub content: Option<String>,
}

/// Badami-owned runtime binaries, verified against `runtime/manifest.json`.
///
/// Every entry passed [`runtime_manifest::verify`], so a stale or tampered
/// binary is never advertised here even when it is still on disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BadamiRuntimeInventory {
    pub root: String,
    pub detected: bool,
    pub components: Vec<RuntimeComponent>,
    pub nginx_binary: Option<String>,
    pub dnsmasq_binary: Option<String>,
    pub php_versions: Vec<PhpVersionInfo>,
    pub mariadb_binary: Option<String>,
    /// MariaDB `basedir` (the version dir holding `bin/` and `lib/`).
    pub mariadb_basedir: Option<String>,
    pub redis_server: Option<String>,
    /// MariaDB datadir adopted by a completed migration, when one already ran.
    pub data_dir: Option<String>,
    pub datadir_adopted: bool,
    /// Datadirs found under `<local-dev>/data`, best candidate first.
    pub mariadb_candidates: Vec<MariadbCandidate>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveryReport {
    pub platform: String,
    pub arch: String,
    pub runtime_paths: RuntimePaths,
    /// Badami's own provisioned binaries; the only binary source.
    pub badami: BadamiRuntimeInventory,
    pub candidates: Vec<BinaryCandidate>,
    pub ports_in_use: Vec<PortInUse>,
    pub resolver: ResolverInfo,
    /// Notes for Doctor / UI (non-fatal discovery observations).
    pub notes: Vec<String>,
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

/// Arch suffix for arch-tagged resource names (`nginx-arm64` / `nginx-x86`).
pub fn preferred_suffix() -> &'static str {
    match std::env::consts::ARCH {
        "aarch64" => "arm64",
        _ => "x86",
    }
}

pub fn platform_name() -> &'static str {
    match std::env::consts::OS {
        "macos" => "macos",
        "windows" => "windows",
        "linux" => "linux",
        other => other,
    }
}

/// Canonical Badami local-dev runtime root (path string only, does not mkdir).
pub fn local_dev_root() -> Result<PathBuf, String> {
    let home = home_dir().ok_or_else(|| "HOME is not set".to_string())?;
    Ok(home
        .join("Library")
        .join("Application Support")
        .join("Badami")
        .join("local-dev"))
}

/// Build runtime path strings from an arbitrary local-dev root (does not mkdir).
///
/// Used by production (`local_dev_root()`) and by unit tests that inject a temp
/// root so they never race on Application Support.
pub fn runtime_paths_from_root(root: PathBuf) -> RuntimePaths {
    let s = |p: PathBuf| p.to_string_lossy().into_owned();
    RuntimePaths {
        local_dev_root: s(root.clone()),
        config_valet: s(root.join("config").join("valet")),
        nginx: s(root.join("nginx")),
        fpm: s(root.join("fpm")),
        socks: s(root.join("socks")),
        mariadb: s(root.join("mariadb")),
        valet_server: s(root.join("valet-server")),
        pids: s(root.join("pids")),
        logs: s(root.join("logs")),
        import: s(root.join("import")),
        runtime: s(root.join("runtime")),
        data: s(root.join("data")),
        php_config: s(root.join("config").join("php")),
    }
}

pub fn build_runtime_paths() -> Result<RuntimePaths, String> {
    Ok(runtime_paths_from_root(local_dev_root()?))
}

/// Coarse datadir size for scoring/UI, **not** a full recursive tree sum.
///
/// Safety/performance:
/// - never follows symlinks (avoids cycles and escapes)
/// - depth at most 2 (datadir → DB schema dirs → table files)
/// - caps number of subdirs and files scanned
fn estimate_datadir_bytes(path: &Path) -> u64 {
    const MAX_SUBDIRS: usize = 128;
    const MAX_FILES_PER_SUBDIR: usize = 4_000;

    let mut total = 0u64;
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };

    let mut subdirs: Vec<PathBuf> = Vec::new();
    for entry in entries.flatten() {
        let Ok(ft) = entry.file_type() else {
            continue;
        };
        // Never follow symlinks; prevents cycles and walks outside the datadir.
        if ft.is_symlink() {
            continue;
        }
        if ft.is_file() {
            if let Ok(meta) = entry.metadata() {
                total = total.saturating_add(meta.len());
            }
        } else if ft.is_dir() {
            subdirs.push(entry.path());
        }
    }

    subdirs.truncate(MAX_SUBDIRS);
    for sub in subdirs {
        total = total.saturating_add(sum_regular_files_shallow(&sub, MAX_FILES_PER_SUBDIR));
    }
    total
}

/// Sum regular file sizes directly under `dir` (non-recursive). Skips symlinks.
fn sum_regular_files_shallow(dir: &Path, max_files: usize) -> u64 {
    let mut total = 0u64;
    let mut n = 0usize;
    let Ok(entries) = fs::read_dir(dir) else {
        return 0;
    };
    for entry in entries.flatten() {
        if n >= max_files {
            break;
        }
        let Ok(ft) = entry.file_type() else {
            continue;
        };
        if ft.is_symlink() || !ft.is_file() {
            continue;
        }
        n += 1;
        if let Ok(meta) = entry.metadata() {
            total = total.saturating_add(meta.len());
        }
    }
    total
}

fn modified_secs_ago(path: &Path) -> Option<u64> {
    let meta = fs::metadata(path).ok()?;
    let modified = meta.modified().ok()?;
    let elapsed = SystemTime::now().duration_since(modified).ok()?;
    Some(elapsed.as_secs())
}

fn parse_my_cnf(path: &Path) -> Option<MyCnfInfo> {
    let content = fs::read_to_string(path).ok()?;
    let mut basedir = None;
    let mut datadir = None;
    let mut socket = None;
    let mut port = None;
    let mut log_error = None;

    for raw in content.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with('[') {
            continue;
        }
        let (key, value) = match line.split_once('=') {
            Some((k, v)) => (k.trim().to_ascii_lowercase(), strip_quotes(v.trim())),
            None => continue,
        };
        match key.as_str() {
            "basedir" => basedir = Some(value),
            "datadir" => datadir = Some(value),
            "socket" => socket = Some(value),
            "port" => port = value.parse().ok(),
            "log-error" | "log_error" => log_error = Some(value),
            _ => {}
        }
    }

    Some(MyCnfInfo {
        path: path.to_string_lossy().into_owned(),
        basedir,
        datadir,
        socket,
        port,
        log_error,
    })
}

fn strip_quotes(s: &str) -> String {
    let s = s.trim();
    if (s.starts_with('"') && s.ends_with('"')) || (s.starts_with('\'') && s.ends_with('\'')) {
        s[1..s.len() - 1].to_string()
    } else {
        s.to_string()
    }
}

fn score_mariadb_candidate(dir: &Path, uuid: &str) -> MariadbCandidate {
    let ibdata1 = dir.join("ibdata1");
    let mysql_schema = dir.join("mysql");
    let has_ibdata1 = ibdata1.is_file();
    let has_mysql_schema = mysql_schema.is_dir();
    let my_cnf_path = dir.join("my.cnf");
    let my_cnf = if my_cnf_path.is_file() {
        parse_my_cnf(&my_cnf_path)
    } else {
        None
    };

    // Cheap size estimate (no deep recursive walk, see estimate_datadir_bytes).
    let bytes = estimate_datadir_bytes(dir);
    let modified = modified_secs_ago(dir);

    // Score primarily by structural signals; size is a tie-breaker only.
    let mut score: i64 = 0;
    if has_ibdata1 {
        score += 10_000;
        // Prefer larger system tablespace when present (cheap single-file size).
        if let Ok(meta) = fs::metadata(&ibdata1) {
            score += (meta.len() / (1024 * 1024)) as i64; // MiB of ibdata1
        }
    }
    if has_mysql_schema {
        score += 20_000;
    }
    if my_cnf.is_some() {
        score += 5_000;
    }
    // Coarse size as secondary signal (GiB + MiB fractions from shallow estimate)
    score += (bytes / (1024 * 1024 * 1024)) as i64 * 100;
    score += (bytes / (1024 * 1024)) as i64;
    // Prefer recently modified (decay over ~30 days)
    if let Some(secs) = modified {
        let days = (secs / 86_400) as i64;
        score += (30 - days.min(30)) * 10;
    }

    MariadbCandidate {
        path: dir.to_string_lossy().into_owned(),
        uuid: uuid.to_string(),
        bytes,
        score,
        has_ibdata1,
        has_mysql_schema,
        my_cnf,
        modified_secs_ago: modified,
    }
}

fn looks_like_mariadb_datadir(dir: &Path) -> bool {
    // Positive signals for MariaDB/MySQL data
    if dir.join("ibdata1").is_file() || dir.join("mysql").is_dir() {
        return true;
    }
    if dir.join("my.cnf").is_file() {
        // my.cnf with basedir/datadir/socket is a strong signal
        if let Some(cnf) = parse_my_cnf(&dir.join("my.cnf")) {
            if cnf.basedir.is_some() || cnf.datadir.is_some() || cnf.socket.is_some() {
                return true;
            }
        }
    }
    // Redis service UUID dirs hold redis.conf only; skip those.
    if dir.join("redis.conf").is_file() {
        return false;
    }
    // Empty / near-empty UUID shells may be unused MariaDB slots; keep for inventory.
    // Any non-dot entry means this is not an empty shell (and not already matched above).
    let Ok(entries) = fs::read_dir(dir) else {
        return false;
    };
    for entry in entries.flatten() {
        let s = entry.file_name().to_string_lossy().into_owned();
        if s == ".DS_Store" || s.starts_with('.') {
            continue;
        }
        return false;
    }
    true
}

/// Convert compact tag `74` / `84` / `82` → `7.4` / `8.4` / `8.2`.
#[cfg(test)]
fn tag_to_version(tag: &str) -> Option<String> {
    if tag.len() == 2 && tag.chars().all(|c| c.is_ascii_digit()) {
        let major = &tag[0..1];
        let minor = &tag[1..2];
        return Some(format!("{major}.{minor}"));
    }
    if tag.len() == 3 && tag.chars().all(|c| c.is_ascii_digit()) {
        // e.g. 810 → 8.10 (unlikely but safe)
        let major = &tag[0..1];
        let minor = &tag[1..];
        return Some(format!("{major}.{minor}"));
    }
    None
}

fn version_to_tag(version: &str) -> String {
    version.replace('.', "")
}

/// Probe whether something accepts TCP on loopback. IPv4 only; no `0.0.0.0` connect.
fn port_listening(port: u16) -> bool {
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok()
}

fn scan_ports() -> Vec<PortInUse> {
    SCAN_PORTS
        .iter()
        .map(|&port| {
            let listening = port_listening(port);
            PortInUse {
                port,
                listening,
                // PID/process deferred, requires platform tooling; not resolved in Phase A.
                pid: None,
                process: None,
            }
        })
        .collect()
}

fn read_resolver() -> ResolverInfo {
    let path = Path::new(RESOLVER_TEST);
    if path.is_file() {
        let content = fs::read_to_string(path).ok();
        ResolverInfo {
            path: RESOLVER_TEST.to_string(),
            present: true,
            content,
        }
    } else {
        ResolverInfo {
            path: RESOLVER_TEST.to_string(),
            present: false,
            content: None,
        }
    }
}

fn brew_prefixes() -> Vec<PathBuf> {
    let mut prefixes = Vec::new();
    // Apple Silicon default
    prefixes.push(PathBuf::from("/opt/homebrew"));
    // Intel default
    prefixes.push(PathBuf::from("/usr/local"));
    // Custom HOMEBREW_PREFIX
    if let Some(p) = std::env::var_os("HOMEBREW_PREFIX") {
        let pb = PathBuf::from(p);
        if !prefixes.contains(&pb) {
            prefixes.insert(0, pb);
        }
    }
    prefixes
}

fn discover_homebrew_candidates() -> Vec<BinaryCandidate> {
    let roles = [
        ("php", "php"),
        ("php-fpm", "php-fpm"),
        ("nginx", "nginx"),
        ("mariadbd", "mariadbd"),
        ("mysqld", "mysqld"),
        ("redis-server", "redis-server"),
        ("dnsmasq", "dnsmasq"),
    ];
    let mut out = Vec::new();
    for prefix in brew_prefixes() {
        let bin = prefix.join("bin");
        let sbin = prefix.join("sbin");
        for (role, name) in roles {
            for dir in [&bin, &sbin] {
                let p = dir.join(name);
                if p.is_file() {
                    out.push(BinaryCandidate {
                        role: role.to_string(),
                        path: p.to_string_lossy().into_owned(),
                        version: None,
                        source: "homebrew".to_string(),
                    });
                }
            }
        }
    }

    // PATH entries (existence check only)
    if let Some(path_var) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path_var) {
            for (role, name) in roles {
                let p = dir.join(name);
                if p.is_file() {
                    // skip if already listed from brew
                    let path_str = p.to_string_lossy().into_owned();
                    if !out.iter().any(|c| c.path == path_str) {
                        out.push(BinaryCandidate {
                            role: role.to_string(),
                            path: path_str,
                            version: None,
                            source: "path".to_string(),
                        });
                    }
                }
            }
        }
    }

    out
}

/// Datadirs under `<local-dev>/data`, best candidate first. `data/mariadb` is
/// the canonical destination; any other populated dir is a leftover copy.
fn discover_badami_mariadb_candidates(data_root: &Path) -> Vec<MariadbCandidate> {
    let mut out = Vec::new();
    if let Ok(entries) = fs::read_dir(data_root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') || !looks_like_mariadb_datadir(&path) {
                continue;
            }
            out.push(score_mariadb_candidate(&path, &name));
        }
    }
    let mariadb = data_root.join("mariadb");
    if mariadb.is_dir() && !out.iter().any(|c| c.path == mariadb.to_string_lossy()) {
        out.push(score_mariadb_candidate(&mariadb, "mariadb"));
    }
    out.sort_by(|a, b| b.score.cmp(&a.score).then_with(|| b.bytes.cmp(&a.bytes)));
    out
}

pub fn discover() -> Result<DiscoveryReport, String> {
    let runtime_paths = build_runtime_paths()?;
    let arch = std::env::consts::ARCH.to_string();
    let platform = platform_name().to_string();
    let mut notes = Vec::new();

    if platform != "macos" {
        notes.push(format!(
            "Local Dev is macOS-only; inventory on {platform} is best-effort"
        ));
    }

    let badami = build_badami_inventory(&runtime_paths, &mut notes);
    for c in &badami.mariadb_candidates {
        if !c.has_ibdata1 && !c.has_mysql_schema {
            notes.push(format!(
                "MariaDB datadir {} has no ibdata1 or mysql schema yet",
                c.path
            ));
        }
    }

    // Provisioned Badami binaries are the only source; Homebrew and PATH stay
    // as fallbacks until the user provisions.
    let mut candidates = Vec::new();
    for c in &badami.components {
        candidates.push(BinaryCandidate {
            role: badami_candidate_role(c),
            path: c.binary.clone(),
            version: Some(c.version.clone()),
            source: "badami_runtime".to_string(),
        });
    }
    for c in discover_homebrew_candidates() {
        candidates.push(c);
    }

    if !badami.detected {
        notes.push(format!(
            "No Badami runtime provisioned under {}; using Homebrew / PATH fallbacks",
            runtime_paths.runtime
        ));
    }

    Ok(DiscoveryReport {
        platform,
        arch,
        runtime_paths,
        badami,
        candidates,
        ports_in_use: scan_ports(),
        resolver: read_resolver(),
        notes,
    })
}

#[cfg(test)]
fn empty_badami(root: &str) -> BadamiRuntimeInventory {
    BadamiRuntimeInventory {
        root: root.to_string(),
        detected: false,
        components: Vec::new(),
        nginx_binary: None,
        dnsmasq_binary: None,
        php_versions: Vec::new(),
        mariadb_binary: None,
        mariadb_basedir: None,
        redis_server: None,
        data_dir: None,
        datadir_adopted: false,
        mariadb_candidates: Vec::new(),
    }
}

/// Read `runtime/manifest.json` and keep only components whose binary still
/// hashes correctly. A stale or tampered entry is treated as absent.
pub(crate) fn build_badami_inventory(
    runtime_paths: &RuntimePaths,
    notes: &mut Vec<String>,
) -> BadamiRuntimeInventory {
    let root = runtime_paths.runtime.clone();
    let manifest = runtime_manifest::load(Path::new(&root));
    let mut components = Vec::new();
    for c in &manifest.components {
        if runtime_manifest::verify(c) {
            components.push(c.clone());
        } else {
            notes.push(format!(
                "Badami runtime {} {} ignored: binary missing or hash mismatch",
                c.role, c.version
            ));
        }
    }

    // `fpm_path` is the component binary; the CLI sits next to it as `php<tag>`.
    // Sort by version so the list is deterministic: the UI and the supervisor
    // both treat the first entry as the default when nothing is pinned.
    let mut php_versions: Vec<PhpVersionInfo> = components
        .iter()
        .filter(|c| c.role == "php")
        .map(|c| {
            let tag = version_to_tag(&c.version);
            let cli = Path::new(&c.binary)
                .parent()
                .map(|dir| dir.join(format!("php{tag}")))
                .filter(|p| p.is_file())
                .map(|p| p.to_string_lossy().into_owned());
            PhpVersionInfo {
                version: c.version.clone(),
                tag,
                available: true,
                reason: None,
                cli_path: cli,
                fpm_path: Some(c.binary.clone()),
                fpm_conf_path: None,
            }
        })
        .collect();
    php_versions.sort_by(|a, b| a.version.cmp(&b.version));

    let mariadb_binary = verified_component(&manifest, "mariadb").map(|c| c.binary.clone());
    // The version dir is the MariaDB basedir: `<version>/bin/mariadbd`.
    let mariadb_basedir = mariadb_binary.as_deref().and_then(|b| {
        Path::new(b)
            .parent()
            .and_then(Path::parent)
            .map(|p| p.to_string_lossy().into_owned())
    });

    let adopted = super::datadir_migration::adopted_datadir(Path::new(&runtime_paths.data));
    let (data_dir, datadir_adopted) = match adopted {
        Some(p) => (Some(p.to_string_lossy().into_owned()), true),
        None => (None, false),
    };

    // Filled here rather than by the caller so every report carries the same
    // datadir view, including the ones built directly in tests.
    let mariadb_candidates = discover_badami_mariadb_candidates(Path::new(&runtime_paths.data));

    BadamiRuntimeInventory {
        root,
        detected: !components.is_empty(),
        components,
        nginx_binary: verified_component(&manifest, "nginx").map(|c| c.binary.clone()),
        dnsmasq_binary: verified_component(&manifest, "dnsmasq").map(|c| c.binary.clone()),
        php_versions,
        mariadb_binary,
        mariadb_basedir,
        mariadb_candidates,
        redis_server: verified_component(&manifest, "redis").map(|c| c.binary.clone()),
        data_dir,
        datadir_adopted,
    }
}

/// Candidate role name for a provisioned component (`php74`, `php74-fpm`, `mariadbd`).
fn badami_candidate_role(c: &RuntimeComponent) -> String {
    match c.role.as_str() {
        "php" => format!("php{}", version_to_tag(&c.version)),
        "mariadb" => "mariadbd".to_string(),
        other => other.to_string(),
    }
}

/// The component for `role`: the selected one, else the newest, but never one
/// whose binary is missing or hashes differently.
fn verified_component<'a>(
    manifest: &'a runtime_manifest::RuntimeManifest,
    role: &str,
) -> Option<&'a RuntimeComponent> {
    if let Some(c) = manifest
        .selected_for(role, None)
        .filter(|c| runtime_manifest::verify(c))
    {
        return Some(c);
    }
    manifest
        .for_role(role)
        .into_iter()
        .find(|c| runtime_manifest::verify(c))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preferred_suffix_is_arch_aware() {
        let s = preferred_suffix();
        assert!(s == "arm64" || s == "x86");
    }

    #[test]
    fn tag_version_roundtrip() {
        assert_eq!(tag_to_version("74").as_deref(), Some("7.4"));
        assert_eq!(tag_to_version("84").as_deref(), Some("8.4"));
        assert_eq!(version_to_tag("8.2"), "82");
    }

    #[test]
    fn strip_quotes_works() {
        assert_eq!(strip_quotes("\"/tmp/x\""), "/tmp/x");
        assert_eq!(strip_quotes("/tmp/x"), "/tmp/x");
    }

    #[test]
    fn discover_smoke() {
        let report = discover().expect("discover");
        assert!(!report.runtime_paths.local_dev_root.is_empty());
        assert!(report.runtime_paths.local_dev_root.contains("local-dev"));
        assert_eq!(report.ports_in_use.len(), SCAN_PORTS.len());
        assert_eq!(report.badami.root, report.runtime_paths.runtime);
    }

    #[test]
    fn badami_candidates_come_from_the_data_dir() {
        let root = std::env::temp_dir().join(format!("badami-cand-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let data = root.join("data");
        let datadir = data.join("mariadb");
        std::fs::create_dir_all(&datadir).unwrap();
        std::fs::write(datadir.join("ibdata1"), b"x").unwrap();
        std::fs::create_dir_all(datadir.join("mysql")).unwrap();

        let cands = discover_badami_mariadb_candidates(&data);
        assert_eq!(cands.len(), 1);
        assert_eq!(cands[0].path, datadir.to_string_lossy());
        assert!(cands[0].has_ibdata1 && cands[0].has_mysql_schema);
        let _ = std::fs::remove_dir_all(&root);
    }

    fn fake_component(binary: &Path, sha256: &str) -> RuntimeComponent {
        RuntimeComponent {
            role: "nginx".into(),
            version: "1.25.4".into(),
            binary: binary.to_string_lossy().into_owned(),
            sha256: sha256.into(),
            source: "manual".into(),
            arch: "arm64".into(),
            installed_at: String::new(),
            selected: true,
        }
    }

    #[test]
    fn badami_inventory_ignores_tampered_component() {
        let root = std::env::temp_dir().join(format!("badami-disc-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let paths = runtime_paths_from_root(root.clone());
        let dir = runtime_manifest::component_dir(Path::new(&paths.runtime), "nginx", "1.25.4");
        std::fs::create_dir_all(&dir).unwrap();
        let bin = dir.join("nginx");
        std::fs::write(&bin, b"real nginx").unwrap();

        let mut manifest = runtime_manifest::RuntimeManifest::default();
        manifest.upsert(fake_component(&bin, "deadbeef"));
        runtime_manifest::save(Path::new(&paths.runtime), &manifest).unwrap();

        let mut notes = Vec::new();
        let inv = build_badami_inventory(&paths, &mut notes);
        assert!(inv.nginx_binary.is_none(), "tampered binary must not be used");
        assert!(!inv.detected);
        assert!(notes.iter().any(|n| n.contains("hash mismatch")));

        let good = runtime_manifest::hash_file(&bin).unwrap();
        manifest.upsert(fake_component(&bin, &good));
        runtime_manifest::save(Path::new(&paths.runtime), &manifest).unwrap();

        let mut notes = Vec::new();
        let inv = build_badami_inventory(&paths, &mut notes);
        let expected = bin.to_string_lossy().into_owned();
        assert_eq!(inv.nginx_binary.as_deref(), Some(expected.as_str()));
        assert!(inv.detected);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn empty_badami_matches_no_manifest() {
        let inv = empty_badami("/tmp/nowhere/runtime");
        assert!(!inv.detected);
        assert!(inv.components.is_empty());
        assert!(inv.nginx_binary.is_none());
        assert!(!inv.datadir_adopted);
    }
}
