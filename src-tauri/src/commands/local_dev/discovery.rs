//! Read-only discovery of Herd leftovers, PHP/nginx/MariaDB/Redis binaries,
//! ports, and Badami local-dev runtime paths.
//!
//! **Safety:** this module never starts/stops processes, never writes configs,
//! and never mutates or deletes MariaDB datadirs.

use serde::{Deserialize, Serialize};
use std::fs;
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

const PRIVILEGED_HELPER: &str = "/Library/PrivilegedHelperTools/de.beyondco.herd.helper";
const SHARED_HERD_SERVICES: &str = "/Users/Shared/Herd/services";
const HERD_APP_RESOURCES: &str = "/Applications/Herd.app/Contents/Resources";
const RESOLVER_TEST: &str = "/etc/resolver/test";

/// Ports checked for an accepting TCP listener (read-only connect probe).
const SCAN_PORTS: &[u16] = &[80, 8080, 3306, 6379, 53];

// ── Public types ────────────────────────────────────────────────────

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
pub struct FpmConfInfo {
    pub path: String,
    pub version: String,
    pub has_matching_binary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NginxSiteConf {
    pub path: String,
    pub site_name: String,
    /// Parsed from `# ISOLATED_PHP_VERSION=7.4` if present.
    pub isolated_php_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RedisInfo {
    pub shared_path: Option<String>,
    pub version: Option<String>,
    pub redis_server: Option<String>,
    pub redis_cli: Option<String>,
    pub dump_rdb: Option<String>,
    pub service_conf: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValetInfo {
    pub config_path: Option<String>,
    pub tld: Option<String>,
    pub loopback: Option<String>,
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HerdInventory {
    pub detected: bool,
    pub app_path: Option<String>,
    pub home_path: Option<String>,
    pub config_path: Option<String>,
    pub bin_path: Option<String>,
    pub shared_services_path: Option<String>,
    pub resources_path: Option<String>,
    pub privileged_helper_present: bool,
    pub privileged_helper_path: String,
    pub mariadb_candidates: Vec<MariadbCandidate>,
    pub park_paths: Vec<String>,
    pub php_versions: Vec<PhpVersionInfo>,
    pub fpm_confs: Vec<FpmConfInfo>,
    pub nginx_site_confs: Vec<NginxSiteConf>,
    pub redis: Option<RedisInfo>,
    pub valet: Option<ValetInfo>,
    pub nginx_binary: Option<String>,
    pub dnsmasq_binary: Option<String>,
    pub server_php: Option<String>,
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
    pub pid: Option<u32>,
    pub process: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolverInfo {
    pub path: String,
    pub present: bool,
    pub content: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveryReport {
    pub platform: String,
    pub arch: String,
    pub runtime_paths: RuntimePaths,
    pub herd: HerdInventory,
    pub candidates: Vec<BinaryCandidate>,
    pub ports_in_use: Vec<PortInUse>,
    pub resolver: ResolverInfo,
    /// Notes for Doctor / UI (non-fatal discovery observations).
    pub notes: Vec<String>,
}

// ── Path helpers ────────────────────────────────────────────────────

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

/// Arch suffix used by Herd.app Resources binaries (`nginx-arm64` / `nginx-x86`).
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

/// Canonical Badami local-dev runtime root (path string only — does not mkdir).
pub fn local_dev_root() -> Result<PathBuf, String> {
    let home = home_dir().ok_or_else(|| "HOME is not set".to_string())?;
    Ok(home
        .join("Library")
        .join("Application Support")
        .join("Badami")
        .join("local-dev"))
}

pub fn build_runtime_paths() -> Result<RuntimePaths, String> {
    let root = local_dev_root()?;
    let s = |p: PathBuf| p.to_string_lossy().into_owned();
    Ok(RuntimePaths {
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
    })
}

fn herd_home() -> Option<PathBuf> {
    home_dir().map(|h| h.join("Library").join("Application Support").join("Herd"))
}

fn path_if_exists(p: impl AsRef<Path>) -> Option<String> {
    let p = p.as_ref();
    if p.exists() {
        Some(p.to_string_lossy().into_owned())
    } else {
        None
    }
}

fn dir_size_bytes(path: &Path) -> u64 {
    let mut total = 0u64;
    let mut stack = vec![path.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let p = entry.path();
            let Ok(meta) = entry.metadata() else {
                continue;
            };
            if meta.is_dir() {
                stack.push(p);
            } else {
                total = total.saturating_add(meta.len());
            }
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

// ── my.cnf parsing ──────────────────────────────────────────────────

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

// ── MariaDB UUID scoring ────────────────────────────────────────────

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

    let bytes = dir_size_bytes(dir);
    let modified = modified_secs_ago(dir);

    // Score: size (GiB * 100) + schema/ibdata bonuses + my.cnf + recency
    let mut score: i64 = (bytes / (1024 * 1024 * 1024)) as i64 * 100;
    // Also give credit for megabytes so tiny dirs sort above empty
    score += (bytes / (1024 * 1024)) as i64;
    if has_ibdata1 {
        score += 10_000;
    }
    if has_mysql_schema {
        score += 20_000;
    }
    if my_cnf.is_some() {
        score += 5_000;
    }
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
    // Redis service UUID dirs hold redis.conf only — skip those.
    if dir.join("redis.conf").is_file() {
        return false;
    }
    // Empty / near-empty UUID shells may be unused MariaDB slots — keep for inventory.
    let Ok(entries) = fs::read_dir(dir) else {
        return false;
    };
    let mut non_meta = 0u32;
    for entry in entries.flatten() {
        let n = entry.file_name();
        let s = n.to_string_lossy();
        if s == ".DS_Store" || s.starts_with('.') {
            continue;
        }
        non_meta += 1;
        if non_meta > 0 {
            // Has content that isn't redis — still uncertain; only keep if empty.
            return false;
        }
    }
    true // empty shell
}

fn discover_mariadb_candidates(services_dir: &Path) -> Vec<MariadbCandidate> {
    let mut out = Vec::new();
    let Ok(entries) = fs::read_dir(services_dir) else {
        return out;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        // UUID-like service dirs
        if name.len() < 8 || !name.contains('-') {
            continue;
        }
        if !looks_like_mariadb_datadir(&path) {
            continue;
        }
        out.push(score_mariadb_candidate(&path, &name));
    }
    out.sort_by(|a, b| b.score.cmp(&a.score).then_with(|| b.bytes.cmp(&a.bytes)));
    out
}

// ── PHP versions ────────────────────────────────────────────────────

/// Convert compact tag `74` / `84` / `82` → `7.4` / `8.4` / `8.2`.
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

/// Parse `7.4` / `8.4` from fpm conf filename like `7.4-fpm.conf`.
fn version_from_fpm_filename(name: &str) -> Option<String> {
    // strip -fpm.conf / -fpm-debug.conf
    let base = name
        .strip_suffix("-fpm-debug.conf")
        .or_else(|| name.strip_suffix("-fpm.conf"))?;
    if base.chars().all(|c| c.is_ascii_digit() || c == '.') {
        Some(base.to_string())
    } else {
        None
    }
}

fn version_to_tag(version: &str) -> String {
    version.replace('.', "")
}

fn discover_php_versions(
    bin_dir: &Path,
    fpm_dir: Option<&Path>,
) -> (Vec<PhpVersionInfo>, Vec<FpmConfInfo>) {
    use std::collections::{BTreeMap, BTreeSet};

    let mut tags: BTreeSet<String> = BTreeSet::new();
    let mut cli: BTreeMap<String, PathBuf> = BTreeMap::new();
    let mut fpm: BTreeMap<String, PathBuf> = BTreeMap::new();

    if let Ok(entries) = fs::read_dir(bin_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !name.starts_with("php") {
                continue;
            }
            // php74, php74-fpm, php84, php84-fpm (skip bare `php` symlink)
            if let Some(rest) = name.strip_prefix("php") {
                if rest.is_empty() {
                    continue;
                }
                if let Some(tag) = rest.strip_suffix("-fpm") {
                    if tag.chars().all(|c| c.is_ascii_digit()) {
                        tags.insert(tag.to_string());
                        fpm.insert(tag.to_string(), entry.path());
                    }
                } else if rest.chars().all(|c| c.is_ascii_digit()) {
                    tags.insert(rest.to_string());
                    cli.insert(rest.to_string(), entry.path());
                }
            }
        }
    }

    let mut fpm_confs = Vec::new();
    let mut conf_by_version: BTreeMap<String, PathBuf> = BTreeMap::new();

    if let Some(fpm_dir) = fpm_dir {
        if let Ok(entries) = fs::read_dir(fpm_dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                if name.contains("-debug") {
                    continue;
                }
                if let Some(ver) = version_from_fpm_filename(&name) {
                    let tag = version_to_tag(&ver);
                    tags.insert(tag.clone());
                    conf_by_version.insert(ver.clone(), entry.path());
                    let has_bin = fpm.contains_key(&tag) || cli.contains_key(&tag);
                    fpm_confs.push(FpmConfInfo {
                        path: entry.path().to_string_lossy().into_owned(),
                        version: ver,
                        has_matching_binary: has_bin,
                    });
                }
            }
        }
    }
    fpm_confs.sort_by(|a, b| a.version.cmp(&b.version));

    let mut versions = Vec::new();
    for tag in tags {
        let Some(version) = tag_to_version(&tag) else {
            continue;
        };
        let cli_path = cli.get(&tag).map(|p| p.to_string_lossy().into_owned());
        let fpm_path = fpm.get(&tag).map(|p| p.to_string_lossy().into_owned());
        let fpm_conf_path = conf_by_version
            .get(&version)
            .map(|p| p.to_string_lossy().into_owned());

        let (available, reason) = match (&cli_path, &fpm_path) {
            (Some(_), Some(_)) => (true, None),
            (None, None) => (false, Some("missing_binary".to_string())),
            (Some(_), None) => (false, Some("missing_fpm_binary".to_string())),
            (None, Some(_)) => (false, Some("missing_cli_binary".to_string())),
        };

        // Conf without any binary still surfaces as unavailable
        let reason =
            if !available && fpm_conf_path.is_some() && cli_path.is_none() && fpm_path.is_none() {
                Some("missing_binary".to_string())
            } else {
                reason
            };

        versions.push(PhpVersionInfo {
            version,
            tag,
            available,
            reason,
            cli_path,
            fpm_path,
            fpm_conf_path,
        });
    }
    versions.sort_by(|a, b| a.version.cmp(&b.version));
    (versions, fpm_confs)
}

// ── Valet / parks / site confs ──────────────────────────────────────

fn discover_valet(config_path: &Path) -> Option<ValetInfo> {
    if !config_path.is_file() {
        return None;
    }
    let content = fs::read_to_string(config_path).ok()?;
    let json: serde_json::Value = serde_json::from_str(&content).ok()?;
    let tld = json
        .get("tld")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let loopback = json
        .get("loopback")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let mut paths = Vec::new();
    if let Some(arr) = json.get("paths").and_then(|v| v.as_array()) {
        for p in arr {
            if let Some(s) = p.as_str() {
                paths.push(s.to_string());
            }
        }
    }
    Some(ValetInfo {
        config_path: Some(config_path.to_string_lossy().into_owned()),
        tld,
        loopback,
        paths,
    })
}

fn parse_isolated_php_version(content: &str) -> Option<String> {
    for line in content.lines() {
        let trimmed = line.trim().trim_start_matches('#').trim();
        if let Some(rest) = trimmed.strip_prefix("ISOLATED_PHP_VERSION=") {
            let v = rest.trim();
            if !v.is_empty() {
                return Some(v.to_string());
            }
        }
        // also: fastcgi_pass $herd_sock_74;
        if let Some(idx) = line.find("herd_sock_") {
            let rest = &line[idx + "herd_sock_".len()..];
            let tag: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
            if let Some(ver) = tag_to_version(&tag) {
                return Some(ver);
            }
        }
    }
    None
}

fn discover_nginx_site_confs(dirs: &[&Path]) -> Vec<NginxSiteConf> {
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for dir in dirs {
        if !dir.is_dir() {
            continue;
        }
        let Ok(entries) = fs::read_dir(dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            // Skip shared confs
            if matches!(
                name.as_str(),
                "nginx.conf" | "fastcgi_params" | "herd.conf" | "mime.types"
            ) {
                continue;
            }
            // Prefer site-like names (*.test or known isolates)
            let key = path.to_string_lossy().into_owned();
            if !seen.insert(key.clone()) {
                continue;
            }
            let content = fs::read_to_string(&path).unwrap_or_default();
            // Only include if it looks like a server block or has isolation marker
            let looks_like_site = content.contains("server_name")
                || content.contains("ISOLATED_PHP_VERSION")
                || name.contains(".test");
            if !looks_like_site {
                continue;
            }
            out.push(NginxSiteConf {
                path: key,
                site_name: name,
                isolated_php_version: parse_isolated_php_version(&content),
            });
        }
    }
    out.sort_by(|a, b| a.site_name.cmp(&b.site_name));
    out
}

// ── Redis ───────────────────────────────────────────────────────────

fn discover_redis(herd_bin: Option<&Path>) -> Option<RedisInfo> {
    let shared = Path::new(SHARED_HERD_SERVICES).join("redis");
    if !shared.is_dir() && herd_bin.is_none() {
        return None;
    }

    let mut version = None;
    let mut shared_path = None;
    let mut redis_server = None;
    let mut redis_cli = None;

    if shared.is_dir() {
        shared_path = Some(shared.to_string_lossy().into_owned());
        // pick first version dir
        if let Ok(entries) = fs::read_dir(&shared) {
            let mut vers: Vec<_> = entries.flatten().filter(|e| e.path().is_dir()).collect();
            vers.sort_by_key(|e| e.file_name());
            if let Some(v) = vers.last() {
                version = Some(v.file_name().to_string_lossy().into_owned());
                let bin = v.path().join("bin");
                redis_server = path_if_exists(bin.join("redis-server"));
                redis_cli = path_if_exists(bin.join("redis-cli"));
            }
        }
    }

    // Herd bin symlinks as fallback
    if let Some(bin) = herd_bin {
        if redis_server.is_none() {
            redis_server = path_if_exists(bin.join("redis-server"));
        }
        if redis_cli.is_none() {
            redis_cli = path_if_exists(bin.join("redis-cli"));
        }
    }

    let dump_rdb = herd_bin.and_then(|b| path_if_exists(b.join("dump.rdb")));

    // Redis service conf under Herd config/services UUID
    let service_conf = herd_home().and_then(|home| {
        let services = home.join("config").join("services");
        let Ok(entries) = fs::read_dir(services) else {
            return None;
        };
        for entry in entries.flatten() {
            let conf = entry.path().join("redis.conf");
            if conf.is_file() {
                return Some(conf.to_string_lossy().into_owned());
            }
        }
        None
    });

    Some(RedisInfo {
        shared_path,
        version,
        redis_server,
        redis_cli,
        dump_rdb,
        service_conf,
    })
}

// ── Ports (read-only TCP connect) ───────────────────────────────────

fn port_listening(port: u16) -> bool {
    let addr = format!("127.0.0.1:{port}");
    let Ok(mut addrs) = addr.to_socket_addrs() else {
        return false;
    };
    let Some(addr) = addrs.next() else {
        return false;
    };
    TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok()
        || TcpStream::connect_timeout(
            &SocketAddr::from(([0, 0, 0, 0], port)),
            Duration::from_millis(200),
        )
        .is_ok()
}

fn scan_ports() -> Vec<PortInUse> {
    SCAN_PORTS
        .iter()
        .map(|&port| {
            let listening = port_listening(port);
            PortInUse {
                port,
                listening,
                pid: None,
                process: None,
            }
        })
        .collect()
}

// ── Resolver ────────────────────────────────────────────────────────

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

// ── Homebrew / PATH fallbacks (filesystem only — no process spawn) ──

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

// ── Main discovery ──────────────────────────────────────────────────

pub fn discover() -> Result<DiscoveryReport, String> {
    let runtime_paths = build_runtime_paths()?;
    let arch = std::env::consts::ARCH.to_string();
    let platform = platform_name().to_string();
    let mut notes = Vec::new();

    if platform != "macos" {
        notes.push(format!(
            "Local Dev MVP is macOS-only; returning empty Herd inventory on {platform}"
        ));
        return Ok(DiscoveryReport {
            platform,
            arch,
            runtime_paths,
            herd: empty_herd(),
            candidates: discover_homebrew_candidates(),
            ports_in_use: scan_ports(),
            resolver: read_resolver(),
            notes,
        });
    }

    let suffix = preferred_suffix();
    let home = herd_home();
    let home_exists = home.as_ref().map(|p| p.is_dir()).unwrap_or(false);
    let resources = Path::new(HERD_APP_RESOURCES);
    let resources_exist = resources.is_dir();
    let shared = Path::new(SHARED_HERD_SERVICES);
    let shared_exists = shared.is_dir();
    let helper_present = Path::new(PRIVILEGED_HELPER).is_file();

    let detected = home_exists || resources_exist || shared_exists;

    let app_path = if Path::new("/Applications/Herd.app").is_dir() {
        Some("/Applications/Herd.app".to_string())
    } else {
        None
    };

    let config_path = home.as_ref().and_then(|h| path_if_exists(h.join("config")));
    let bin_path = home.as_ref().and_then(|h| path_if_exists(h.join("bin")));
    let home_path = home.as_ref().and_then(path_if_exists);

    // MariaDB candidates under config/services/*
    let mut mariadb_candidates = Vec::new();
    if let Some(ref h) = home {
        let services = h.join("config").join("services");
        if services.is_dir() {
            mariadb_candidates = discover_mariadb_candidates(&services);
        }
    }

    // PHP + FPM
    let (php_versions, fpm_confs) = if let Some(ref h) = home {
        let bin = h.join("bin");
        let fpm_dir = h.join("config").join("fpm");
        if bin.is_dir() {
            discover_php_versions(&bin, Some(fpm_dir.as_path()).filter(|p| p.is_dir()))
        } else {
            (Vec::new(), Vec::new())
        }
    } else {
        (Vec::new(), Vec::new())
    };

    for v in &php_versions {
        if !v.available {
            notes.push(format!(
                "PHP {} unavailable: {}",
                v.version,
                v.reason.as_deref().unwrap_or("unknown")
            ));
        }
    }

    // Valet parks
    let valet = home
        .as_ref()
        .and_then(|h| discover_valet(&h.join("config").join("valet").join("config.json")));
    let park_paths = valet.as_ref().map(|v| v.paths.clone()).unwrap_or_default();

    // Per-site nginx confs (config/nginx + config/valet/Nginx)
    let nginx_site_confs = if let Some(ref h) = home {
        let nginx_dir = h.join("config").join("nginx");
        let valet_nginx = h.join("config").join("valet").join("Nginx");
        discover_nginx_site_confs(&[nginx_dir.as_path(), valet_nginx.as_path()])
    } else {
        Vec::new()
    };

    // Redis
    let redis = discover_redis(home.as_ref().map(|h| h.join("bin")).as_deref());

    // Nginx / dnsmasq / server.php from Herd.app Resources (arch-selected)
    let nginx_binary = path_if_exists(resources.join(format!("nginx-{suffix}")));
    let dnsmasq_binary = path_if_exists(resources.join(format!("dnsmasq-{suffix}")));
    let server_php = path_if_exists(resources.join("valet").join("server.php"));

    // Binary candidates list (Herd first, then brew/path)
    let mut candidates = Vec::new();

    if let Some(ref p) = nginx_binary {
        candidates.push(BinaryCandidate {
            role: "nginx".to_string(),
            path: p.clone(),
            version: None,
            source: "herd_app".to_string(),
        });
    }
    if let Some(ref p) = dnsmasq_binary {
        candidates.push(BinaryCandidate {
            role: "dnsmasq".to_string(),
            path: p.clone(),
            version: None,
            source: "herd_app".to_string(),
        });
    }
    if let Some(ref p) = server_php {
        candidates.push(BinaryCandidate {
            role: "server_php".to_string(),
            path: p.clone(),
            version: None,
            source: "herd_app".to_string(),
        });
    }

    // MariaDB binary from Shared services or best my.cnf basedir
    if let Some(best) = mariadb_candidates.first() {
        if let Some(ref cnf) = best.my_cnf {
            if let Some(ref basedir) = cnf.basedir {
                if let Some(p) = path_if_exists(Path::new(basedir).join("bin").join("mariadbd")) {
                    candidates.push(BinaryCandidate {
                        role: "mariadbd".to_string(),
                        path: p,
                        version: None,
                        source: "herd_shared".to_string(),
                    });
                }
                if let Some(p) =
                    path_if_exists(Path::new(basedir).join("bin").join("mariadb-admin"))
                {
                    candidates.push(BinaryCandidate {
                        role: "mariadb_admin".to_string(),
                        path: p,
                        version: None,
                        source: "herd_shared".to_string(),
                    });
                }
            }
        }
    }
    // Fallback Shared Herd mariadb tree
    let mariadb_shared = Path::new(SHARED_HERD_SERVICES).join("mariadb");
    if mariadb_shared.is_dir() {
        if let Ok(entries) = fs::read_dir(&mariadb_shared) {
            let mut vers: Vec<_> = entries.flatten().filter(|e| e.path().is_dir()).collect();
            vers.sort_by_key(|e| e.file_name());
            if let Some(v) = vers.last() {
                let ver = v.file_name().to_string_lossy().into_owned();
                if let Some(p) = path_if_exists(v.path().join("bin").join("mariadbd")) {
                    if !candidates.iter().any(|c| c.role == "mariadbd") {
                        candidates.push(BinaryCandidate {
                            role: "mariadbd".to_string(),
                            path: p,
                            version: Some(ver.clone()),
                            source: "herd_shared".to_string(),
                        });
                    }
                }
            }
        }
    }

    // PHP bins as candidates
    for v in &php_versions {
        if let Some(ref p) = v.cli_path {
            candidates.push(BinaryCandidate {
                role: format!("php{}", v.tag),
                path: p.clone(),
                version: Some(v.version.clone()),
                source: "herd_bin".to_string(),
            });
        }
        if let Some(ref p) = v.fpm_path {
            candidates.push(BinaryCandidate {
                role: format!("php{}-fpm", v.tag),
                path: p.clone(),
                version: Some(v.version.clone()),
                source: "herd_bin".to_string(),
            });
        }
    }

    if let Some(ref r) = redis {
        if let Some(ref p) = r.redis_server {
            candidates.push(BinaryCandidate {
                role: "redis-server".to_string(),
                path: p.clone(),
                version: r.version.clone(),
                source: "herd_shared".to_string(),
            });
        }
    }

    // Herd bin symlinks for mariadbd
    if let Some(ref h) = home {
        let bin = h.join("bin");
        if let Some(p) = path_if_exists(bin.join("mariadbd")) {
            if !candidates.iter().any(|c| c.role == "mariadbd") {
                candidates.push(BinaryCandidate {
                    role: "mariadbd".to_string(),
                    path: p,
                    version: None,
                    source: "herd_bin".to_string(),
                });
            }
        }
    }

    // Homebrew / PATH fallbacks (do not replace Herd-sourced roles that already exist;
    // still list them as alternate sources)
    for c in discover_homebrew_candidates() {
        candidates.push(c);
    }

    if helper_present {
        notes.push(
            "Herd privileged helper present at /Library/PrivilegedHelperTools/de.beyondco.herd.helper — detect only; never invoke"
                .to_string(),
        );
    }

    if !detected {
        notes.push("No Herd installation detected on this Mac".to_string());
    }

    let herd = HerdInventory {
        detected,
        app_path,
        home_path,
        config_path,
        bin_path,
        shared_services_path: if shared_exists {
            Some(SHARED_HERD_SERVICES.to_string())
        } else {
            None
        },
        resources_path: if resources_exist {
            Some(HERD_APP_RESOURCES.to_string())
        } else {
            None
        },
        privileged_helper_present: helper_present,
        privileged_helper_path: PRIVILEGED_HELPER.to_string(),
        mariadb_candidates,
        park_paths,
        php_versions,
        fpm_confs,
        nginx_site_confs,
        redis,
        valet,
        nginx_binary,
        dnsmasq_binary,
        server_php,
    };

    Ok(DiscoveryReport {
        platform,
        arch,
        runtime_paths,
        herd,
        candidates,
        ports_in_use: scan_ports(),
        resolver: read_resolver(),
        notes,
    })
}

fn empty_herd() -> HerdInventory {
    HerdInventory {
        detected: false,
        app_path: None,
        home_path: None,
        config_path: None,
        bin_path: None,
        shared_services_path: None,
        resources_path: None,
        privileged_helper_present: false,
        privileged_helper_path: PRIVILEGED_HELPER.to_string(),
        mariadb_candidates: Vec::new(),
        park_paths: Vec::new(),
        php_versions: Vec::new(),
        fpm_confs: Vec::new(),
        nginx_site_confs: Vec::new(),
        redis: None,
        valet: None,
        nginx_binary: None,
        dnsmasq_binary: None,
        server_php: None,
    }
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
        // On the developer's Mac with Herd leftovers this is true; still valid if absent.
        if report.herd.detected {
            assert!(
                report.herd.home_path.is_some()
                    || report.herd.resources_path.is_some()
                    || report.herd.shared_services_path.is_some()
            );
        }
    }
}
