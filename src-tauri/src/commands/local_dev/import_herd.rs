//! Import parks, PHP isolates, and service config from an existing Herd install.
//!
//! **Safety (hard rules):**
//! - Read-only against Herd paths (never mutates Herd app/data/configs)
//! - Never copies/deletes MariaDB datadir (~15GB stays in place)
//! - Never auto-kills Herd processes
//! - Never starts services
//! - Never calls `de.beyondco.herd.helper`
//!
//! Writes only under Badami `local-dev/` (snapshot + optional generated configs).
//! Does **not** write the app SQLite DB — returns a structured `ImportResult` for
//! the frontend (PR9 wizard) to persist via Turso/local SQL.

use super::config_gen::{
    generate_configs, generate_isolated_site, GenerateConfigsRequest, GenerateConfigsResult,
    IsolatedSiteRequest, MariadbWrapperInput, validate_php_tag, validate_site_name,
};
use super::discovery::{
    build_runtime_paths, discover, DiscoveryReport, MariadbCandidate, NginxSiteConf,
    PhpVersionInfo, RuntimePaths,
};
use super::resources::{install_runtime_resources, InstallResourcesResult};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

// ── Request / result DTOs ───────────────────────────────────────────

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct ImportHerdRequest {
    /// Install bundled valet-server / templates into Application Support (default true).
    pub install_resources: Option<bool>,
    /// Generate Badami configs from import (park paths, FPM, nginx, wrapper my.cnf) (default true).
    pub generate_configs: Option<bool>,
    /// Write isolated-site nginx confs for available PHP isolates (default true).
    pub write_isolated_sites: Option<bool>,
    /// HTTP port for Mode A (default 8080).
    pub http_port: Option<u16>,
    /// Override default PHP display version (e.g. `"8.4"`). Falls back to best available.
    pub default_php_version: Option<String>,
    /// Dry-run: discover + build DTO + write snapshot only; skip resources/config writes
    /// other than the snapshot itself. Default false.
    pub dry_run: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportedPark {
    /// Normalized absolute-ish path (trailing slash stripped; canonical when exists).
    pub path: String,
    /// Raw path(s) from Herd config that collapsed into this entry.
    pub sources: Vec<String>,
    pub exists: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportedSite {
    pub name: String,
    pub tld: String,
    /// Resolved project path when found under a park or Sites link; may be empty.
    pub path: String,
    /// `"parked"` | `"linked"` | `"unknown"`.
    pub kind: String,
    pub php_version: Option<String>,
    pub isolated: bool,
    /// True when isolate was skipped (e.g. PHP binary missing).
    pub skipped: bool,
    pub skip_reason: Option<String>,
    pub source_conf: Option<String>,
    /// Whether an isolated nginx conf was written under Badami local-dev.
    pub conf_written: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportedBinary {
    pub role: String,
    pub path: String,
    pub version: Option<String>,
    /// Normalized source: `herd` | `homebrew` | `system` | `other`.
    pub source: String,
    pub is_selected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportedService {
    pub kind: String,
    pub display_name: String,
    pub enabled: bool,
    pub data_dir: Option<String>,
    pub config_path: Option<String>,
    pub port: Option<u16>,
    pub socket_path: Option<String>,
    pub binary_path: Option<String>,
    pub extra_json: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportSettingsSuggestion {
    pub tld: String,
    pub loopback: String,
    pub http_port: u16,
    pub default_php_version: String,
    pub mariadb_datadir_policy: String,
    pub herd_import_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HerdSnapshot {
    pub version: u32,
    pub imported_at_unix: u64,
    pub platform: String,
    pub arch: String,
    pub herd_home: Option<String>,
    pub parks: Vec<ImportedPark>,
    pub sites: Vec<ImportedSite>,
    pub binaries: Vec<ImportedBinary>,
    pub services: Vec<ImportedService>,
    pub settings: ImportSettingsSuggestion,
    pub selected_mariadb: Option<MariadbCandidate>,
    pub php_versions: Vec<PhpVersionInfo>,
    pub notes: Vec<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportResult {
    pub herd_detected: bool,
    pub snapshot_path: String,
    pub parks: Vec<ImportedPark>,
    pub sites: Vec<ImportedSite>,
    pub binaries: Vec<ImportedBinary>,
    pub services: Vec<ImportedService>,
    pub settings: ImportSettingsSuggestion,
    pub selected_mariadb: Option<MariadbCandidate>,
    /// PHP inventory used for availability decisions (from discovery).
    pub php_versions: Vec<PhpVersionInfo>,
    pub resources: Option<InstallResourcesResult>,
    pub configs: Option<GenerateConfigsResult>,
    pub notes: Vec<String>,
    pub warnings: Vec<String>,
    /// Always false in this PR — import never starts services.
    pub services_started: bool,
    /// Always false — import never kills Herd.
    pub herd_processes_killed: bool,
    /// Always false — datadir is referenced in-place only.
    pub mariadb_datadir_copied: bool,
}

// ── Path normalization ──────────────────────────────────────────────

/// Strip trailing slashes (except root `/`) and optionally canonicalize when the path exists.
pub fn normalize_park_path(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    // Preserve single root.
    let mut s = trimmed.to_string();
    while s.len() > 1 && s.ends_with('/') {
        s.pop();
    }
    // Canonicalize when the path exists (resolves .. and symlinks).
    let p = Path::new(&s);
    if p.exists() {
        if let Ok(canon) = fs::canonicalize(p) {
            return canon.to_string_lossy().into_owned();
        }
    }
    s
}

/// Dedupe park paths from Valet config (Herd often lists Sites with and without trailing slash).
pub fn normalize_park_paths(raw: &[String]) -> Vec<ImportedPark> {
    // Map normalized → sources (preserve first-seen order).
    let mut order: Vec<String> = Vec::new();
    let mut map: BTreeMap<String, Vec<String>> = BTreeMap::new();

    for raw_path in raw {
        let norm = normalize_park_path(raw_path);
        if norm.is_empty() {
            continue;
        }
        if !map.contains_key(&norm) {
            order.push(norm.clone());
            map.insert(norm.clone(), vec![raw_path.clone()]);
        } else if let Some(sources) = map.get_mut(&norm) {
            if !sources.iter().any(|s| s == raw_path) {
                sources.push(raw_path.clone());
            }
        }
    }

    order
        .into_iter()
        .map(|path| {
            let sources = map.remove(&path).unwrap_or_default();
            let exists = Path::new(&path).is_dir();
            ImportedPark {
                path,
                sources,
                exists,
            }
        })
        .collect()
}

fn version_to_tag(version: &str) -> String {
    version.replace('.', "")
}

fn site_name_from_conf(site_name: &str, tld: &str) -> String {
    // "office.test" → "office"; "office.test.conf" → "office"; "office" stays "office"
    let mut name = site_name.trim();
    // Strip trailing .conf first so filenames never leave dots in the site name.
    if let Some(base) = name.strip_suffix(".conf") {
        name = base;
    }
    let suffix = format!(".{tld}");
    if let Some(base) = name.strip_suffix(&suffix) {
        return base.to_string();
    }
    // Fallback: strip last .segment only if it looks like a short tld-ish label
    // (not part of a multi-dot site name we already handled via .{tld}).
    if let Some((base, rest)) = name.rsplit_once('.') {
        if !rest.is_empty()
            && rest.len() <= 8
            && rest.chars().all(|c| c.is_ascii_alphanumeric())
            && !base.is_empty()
        {
            return base.to_string();
        }
    }
    name.to_string()
}

/// Resolve a site directory under park paths or Valet Sites links.
fn resolve_site_path(name: &str, parks: &[ImportedPark], sites_dir: Option<&Path>) -> (String, String) {
    // Linked: Sites/{name} symlink or dir
    if let Some(dir) = sites_dir {
        let link = dir.join(name);
        if link.exists() {
            if let Ok(canon) = fs::canonicalize(&link) {
                return (canon.to_string_lossy().into_owned(), "linked".into());
            }
            return (link.to_string_lossy().into_owned(), "linked".into());
        }
    }
    // Parked: first park containing {park}/{name}
    for park in parks {
        let candidate = Path::new(&park.path).join(name);
        if candidate.is_dir() {
            if let Ok(canon) = fs::canonicalize(&candidate) {
                return (canon.to_string_lossy().into_owned(), "parked".into());
            }
            return (candidate.to_string_lossy().into_owned(), "parked".into());
        }
    }
    (String::new(), "unknown".into())
}

fn normalize_binary_source(source: &str) -> String {
    match source {
        "herd_app" | "herd_bin" | "herd_shared" | "herd" => "herd".into(),
        "homebrew" => "homebrew".into(),
        "path" | "system" => "system".into(),
        other => {
            if other.starts_with("herd") {
                "herd".into()
            } else {
                "other".into()
            }
        }
    }
}

fn role_for_db(role: &str) -> String {
    // Map discovery roles → BinaryRole-ish names used by schema.
    // Collapse mysql/mysqld into mariadb family so PATH mysqld does not
    // compete as a second selected engine when Herd mariadbd is present.
    match role {
        "mariadbd" | "mysqld" | "mysql" => "mariadb".into(),
        "redis-server" => "redis".into(),
        "php-fpm" => "php_fpm".into(),
        r if r.ends_with("-fpm") && r.starts_with("php") => "php_fpm".into(),
        r if r.starts_with("php") => "php".into(),
        r => r.to_string(),
    }
}

/// Selection family for "at most one selected default" logic.
/// Versioned Herd `php74`/`php84` share family `php` with bare PATH `php`.
fn binary_family(role: &str) -> String {
    role_for_db(role)
}

fn pick_default_php_version(
    available: &[&PhpVersionInfo],
    override_v: Option<&str>,
) -> String {
    if let Some(v) = override_v {
        if !v.is_empty() {
            // Prefer override if available; else still return it with a note handled by caller.
            return v.to_string();
        }
    }
    // Prefer 8.4, then highest available.
    if let Some(v) = available.iter().find(|p| p.version == "8.4") {
        return v.version.clone();
    }
    available
        .iter()
        .map(|p| p.version.clone())
        .max()
        .unwrap_or_else(|| "8.4".into())
}

/// Key used for "already selected this slot".
/// - Versioned PHP (`php74` / version `7.4`) → `php:7.4` (multi-select OK per version)
/// - Bare unversioned `php` / `php-fpm` → family only (`php` / `php_fpm`) so PATH php
///   does not co-select next to Herd versioned bins
/// - mariadb/mysqld → `mariadb`
fn binary_select_key(role: &str, version: &Option<String>) -> String {
    let family = binary_family(role);
    // Versioned phpNN / phpNN-fpm keep per-version slots when a version is known.
    let is_versioned_php = role.starts_with("php")
        && role
            .trim_end_matches("-fpm")
            .chars()
            .skip(3)
            .all(|c| c.is_ascii_digit())
        && role.len() > 3;
    if is_versioned_php {
        if let Some(v) = version {
            if !v.is_empty() {
                return format!("{family}:{v}");
            }
        }
        // Derive version from role tag when missing (php74 → 7.4).
        let tag = role.trim_start_matches("php").trim_end_matches("-fpm");
        if tag.len() == 2 && tag.chars().all(|c| c.is_ascii_digit()) {
            let ver = format!("{}.{}", &tag[0..1], &tag[1..2]);
            return format!("{family}:{ver}");
        }
    }
    family
}

fn select_binaries(report: &DiscoveryReport) -> Vec<ImportedBinary> {
    // Prefer Herd-sourced for each logical role; keep alternates unselected.
    // Track both exact select keys and families so bare PATH php/mysqld do not
    // co-select when any Herd phpNN / mariadbd is already selected.
    let mut selected_keys: BTreeSet<String> = BTreeSet::new();
    let mut selected_families: BTreeSet<String> = BTreeSet::new();
    let mut out: Vec<ImportedBinary> = Vec::new();

    // Pass 1: select Herd-sourced binaries first.
    for c in &report.candidates {
        let src = normalize_binary_source(&c.source);
        let key = binary_select_key(&c.role, &c.version);
        let family = binary_family(&c.role);
        let is_selected = if src == "herd" {
            // Herd versioned PHP may select multiple versions; still one per key.
            if selected_keys.insert(key) {
                selected_families.insert(family);
                true
            } else {
                false
            }
        } else {
            false
        };
        let db_role = role_for_db(&c.role);
        out.push(ImportedBinary {
            role: if c.role.starts_with("php") {
                c.role.clone()
            } else {
                db_role
            },
            path: c.path.clone(),
            version: c.version.clone(),
            source: src,
            is_selected,
        });
    }

    // Pass 2: fill gaps with non-Herd candidates only when the family is empty.
    // Prevents system `php` / `mysqld` being selected next to Herd phpNN / mariadbd.
    let mut promote: Vec<usize> = Vec::new();
    for (idx, b) in out.iter().enumerate() {
        if b.is_selected {
            continue;
        }
        let family = binary_family(&b.role);
        if selected_families.contains(&family) {
            continue;
        }
        let key = binary_select_key(&b.role, &b.version);
        if selected_keys.contains(&key) {
            continue;
        }
        promote.push(idx);
        selected_keys.insert(key);
        selected_families.insert(family);
    }
    for idx in promote {
        out[idx].is_selected = true;
    }

    out
}

fn badami_mariadb_socket(paths: &RuntimePaths) -> String {
    format!("{}/mariadb.sock", paths.socks)
}

fn build_services(
    report: &DiscoveryReport,
    selected_mariadb: Option<&MariadbCandidate>,
    paths: &RuntimePaths,
    http_port: u16,
) -> Vec<ImportedService> {
    let mut services = Vec::new();

    // nginx — port matches ImportHerdRequest / generated confs (not hard-coded 8080)
    let nginx_bin = report
        .herd
        .nginx_binary
        .clone()
        .or_else(|| {
            report
                .candidates
                .iter()
                .find(|c| c.role == "nginx")
                .map(|c| c.path.clone())
        });
    services.push(ImportedService {
        kind: "nginx".into(),
        display_name: "Nginx".into(),
        enabled: true,
        data_dir: None,
        config_path: Some(format!("{}/nginx.conf", paths.nginx)),
        port: Some(http_port),
        socket_path: None,
        binary_path: nginx_bin,
        extra_json: None,
    });

    // php-fpm — one service entry per available version
    for v in &report.herd.php_versions {
        if !v.available {
            continue;
        }
        services.push(ImportedService {
            kind: "php_fpm".into(),
            display_name: format!("PHP-FPM {}", v.version),
            enabled: true,
            data_dir: None,
            config_path: Some(format!("{}/{}-fpm.conf", paths.fpm, v.version)),
            port: None,
            socket_path: Some(format!("{}/php{}.sock", paths.socks, v.tag)),
            binary_path: v.fpm_path.clone(),
            extra_json: Some(serde_json::json!({
                "php_version": v.version,
                "php_tag": v.tag,
            })),
        });
    }

    // mariadb — data_dir path only, no copy.
    // socket_path MUST match Badami wrapper my.cnf (paths.socks/mariadb.sock).
    // Herd's live socket is preserved under extra_json.herd_socket for doctor/adopt.
    if let Some(m) = selected_mariadb {
        let basedir = m
            .my_cnf
            .as_ref()
            .and_then(|c| c.basedir.clone());
        let herd_socket = m.my_cnf.as_ref().and_then(|c| c.socket.clone());
        let socket = badami_mariadb_socket(paths);
        let port = m.my_cnf.as_ref().and_then(|c| c.port).or(Some(3306));
        let bin = report
            .candidates
            .iter()
            .find(|c| c.role == "mariadbd" || c.role == "mysqld")
            .map(|c| c.path.clone());
        services.push(ImportedService {
            kind: "mariadb".into(),
            display_name: "MariaDB".into(),
            enabled: true,
            data_dir: Some(m.path.clone()),
            config_path: Some(format!("{}/my.cnf", paths.mariadb)),
            port,
            socket_path: Some(socket),
            binary_path: bin,
            extra_json: Some(serde_json::json!({
                "uuid": m.uuid,
                "bytes": m.bytes,
                "score": m.score,
                "basedir": basedir,
                "policy": "reuse_herd",
                "copied": false,
                "herd_socket": herd_socket,
            })),
        });
    }

    // redis
    if let Some(ref r) = report.herd.redis {
        services.push(ImportedService {
            kind: "redis".into(),
            display_name: "Redis".into(),
            enabled: r.redis_server.is_some(),
            data_dir: r.shared_path.clone(),
            config_path: r.service_conf.clone(),
            port: Some(6379),
            socket_path: None,
            binary_path: r.redis_server.clone(),
            extra_json: Some(serde_json::json!({
                "version": r.version,
                "dump_rdb": r.dump_rdb,
                "redis_cli": r.redis_cli,
            })),
        });
    }

    // dnsmasq
    let dnsmasq_bin = report
        .herd
        .dnsmasq_binary
        .clone()
        .or_else(|| {
            report
                .candidates
                .iter()
                .find(|c| c.role == "dnsmasq")
                .map(|c| c.path.clone())
        });
    services.push(ImportedService {
        kind: "dnsmasq".into(),
        display_name: "Dnsmasq".into(),
        enabled: true,
        data_dir: None,
        config_path: Some(format!("{}/dnsmasq/dnsmasq.conf", paths.local_dev_root)),
        port: Some(53),
        socket_path: None,
        binary_path: dnsmasq_bin,
        extra_json: Some(serde_json::json!({
            "mode_hint": "auto",
            "note": "Import does not start dnsmasq; D0 adopt preferred when Herd already binds :53",
        })),
    });

    services
}

fn import_sites(
    confs: &[NginxSiteConf],
    php_versions: &[PhpVersionInfo],
    parks: &[ImportedPark],
    tld: &str,
    sites_dir: Option<&Path>,
) -> Vec<ImportedSite> {
    let available: BTreeSet<String> = php_versions
        .iter()
        .filter(|v| v.available)
        .map(|v| v.version.clone())
        .collect();

    let mut out = Vec::new();
    let mut seen_names: BTreeSet<String> = BTreeSet::new();

    for conf in confs {
        let name = site_name_from_conf(&conf.site_name, tld);
        if name.is_empty() || !seen_names.insert(name.clone()) {
            continue;
        }

        let (path, kind) = resolve_site_path(&name, parks, sites_dir);
        let isolated = conf.isolated_php_version.is_some();
        let php_version = conf.isolated_php_version.clone();

        let (skipped, skip_reason) = match &php_version {
            Some(v) if isolated && !available.contains(v) => {
                (true, Some(format!("php_{v}_unavailable")))
            }
            _ => (false, None),
        };

        out.push(ImportedSite {
            name,
            tld: tld.to_string(),
            path,
            kind,
            php_version,
            isolated,
            skipped,
            skip_reason,
            source_conf: Some(conf.path.clone()),
            conf_written: false,
        });
    }

    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn ensure_import_dir(paths: &RuntimePaths) -> Result<PathBuf, String> {
    let dir = PathBuf::from(&paths.import);
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir import dir {}: {e}", dir.display()))?;
    Ok(dir)
}

/// Write stable `herd-snapshot.json` plus a timestamped history copy
/// `herd-snapshot-{unix}.json` so a later dry_run/import does not erase the only artifact.
fn write_snapshot(paths: &RuntimePaths, snapshot: &HerdSnapshot) -> Result<String, String> {
    let dir = ensure_import_dir(paths)?;
    let text = serde_json::to_string_pretty(snapshot)
        .map_err(|e| format!("serialize herd-snapshot: {e}"))?
        + "\n";

    let stable = dir.join("herd-snapshot.json");
    fs::write(&stable, &text).map_err(|e| format!("write {}: {e}", stable.display()))?;

    let stamped = dir.join(format!("herd-snapshot-{}.json", snapshot.imported_at_unix));
    // Best-effort history; do not fail import if stamp write fails (disk full etc.).
    if let Err(e) = fs::write(&stamped, &text) {
        // Still return stable path; caller can note the failure separately if needed.
        let _ = e;
    }

    Ok(stable.to_string_lossy().into_owned())
}

fn resolve_mariadb_basedir(selected: &MariadbCandidate, report: &DiscoveryReport) -> Option<String> {
    if let Some(ref cnf) = selected.my_cnf {
        if let Some(ref b) = cnf.basedir {
            if Path::new(b).is_dir() {
                return Some(b.clone());
            }
        }
    }
    // Fallback: Shared Herd mariadb tree latest version
    let shared = Path::new("/Users/Shared/Herd/services/mariadb");
    if shared.is_dir() {
        if let Ok(entries) = fs::read_dir(shared) {
            let mut vers: Vec<_> = entries.flatten().filter(|e| e.path().is_dir()).collect();
            vers.sort_by_key(|e| e.file_name());
            if let Some(v) = vers.last() {
                return Some(v.path().to_string_lossy().into_owned());
            }
        }
    }
    // From candidates
    report
        .candidates
        .iter()
        .find(|c| c.role == "mariadbd")
        .and_then(|c| {
            Path::new(&c.path)
                .parent() // bin
                .and_then(|p| p.parent()) // version root
                .map(|p| p.to_string_lossy().into_owned())
        })
}

/// Core import (blocking). `resource_dir` only needed when installing resources.
pub fn import_herd(
    req: ImportHerdRequest,
    resource_dir: Option<PathBuf>,
) -> Result<ImportResult, String> {
    let dry_run = req.dry_run.unwrap_or(false);
    let do_install = !dry_run && req.install_resources.unwrap_or(true);
    let do_configs = !dry_run && req.generate_configs.unwrap_or(true);
    let do_isolates = !dry_run && req.write_isolated_sites.unwrap_or(true);
    let http_port = req.http_port.unwrap_or(8080);

    let mut notes: Vec<String> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();

    notes.push(
        "Import is read-only against Herd: no kill, no datadir copy/delete, no service start."
            .into(),
    );

    let report = discover()?;
    let paths = build_runtime_paths()?;

    if !report.herd.detected {
        warnings.push("No Herd installation detected — snapshot will be mostly empty.".into());
    }

    // 1) Parks
    let raw_parks = report
        .herd
        .valet
        .as_ref()
        .map(|v| v.paths.clone())
        .unwrap_or_else(|| report.herd.park_paths.clone());
    let parks = normalize_park_paths(&raw_parks);
    if parks.is_empty() {
        notes.push("No park paths found in Herd valet config.".into());
    } else {
        notes.push(format!(
            "Normalized {} park path(s) (deduped trailing slash / canonical).",
            parks.len()
        ));
    }

    let tld = report
        .herd
        .valet
        .as_ref()
        .and_then(|v| v.tld.clone())
        .unwrap_or_else(|| "test".into());
    let loopback = report
        .herd
        .valet
        .as_ref()
        .and_then(|v| v.loopback.clone())
        .unwrap_or_else(|| "127.0.0.1".into());

    // Sites dir for link resolution
    let sites_dir = report.herd.home_path.as_ref().map(|h| {
        PathBuf::from(h)
            .join("config")
            .join("valet")
            .join("Sites")
    });

    // 2) Isolates → sites (skip unavailable PHP)
    let mut sites = import_sites(
        &report.herd.nginx_site_confs,
        &report.herd.php_versions,
        &parks,
        &tld,
        sites_dir.as_deref(),
    );
    let skipped_n = sites.iter().filter(|s| s.skipped).count();
    let isolated_n = sites.iter().filter(|s| s.isolated && !s.skipped).count();
    notes.push(format!(
        "Sites from nginx confs: {} total, {} isolated (available PHP), {} skipped (missing PHP).",
        sites.len(),
        isolated_n,
        skipped_n
    ));
    for s in sites.iter().filter(|s| s.skipped) {
        warnings.push(format!(
            "Skipped isolate {}.{} → PHP {} ({})",
            s.name,
            s.tld,
            s.php_version.as_deref().unwrap_or("?"),
            s.skip_reason.as_deref().unwrap_or("unavailable")
        ));
    }

    // 3) MariaDB score-pick (path only)
    let selected_mariadb = report.herd.mariadb_candidates.first().cloned();
    if let Some(ref m) = selected_mariadb {
        notes.push(format!(
            "Selected MariaDB datadir uuid={} score={} bytes≈{} (in-place reuse; not copied).",
            m.uuid, m.score, m.bytes
        ));
    } else {
        warnings.push("No MariaDB UUID datadir candidates found under Herd config/services.".into());
    }

    // 4) PHP default
    let available_php: Vec<&PhpVersionInfo> = report
        .herd
        .php_versions
        .iter()
        .filter(|v| v.available)
        .collect();
    let default_php = pick_default_php_version(
        &available_php,
        req.default_php_version.as_deref(),
    );
    if let Some(ref ov) = req.default_php_version {
        if !available_php.iter().any(|p| p.version == *ov) {
            warnings.push(format!(
                "Requested default_php_version={ov} is not available; still recorded in settings suggestion."
            ));
        }
    }
    let default_php_tag = version_to_tag(&default_php);
    if validate_php_tag(&default_php_tag).is_err() {
        warnings.push(format!(
            "default PHP tag {default_php_tag:?} is not a two-digit tag; FPM gen may fall back."
        ));
    }

    // 5) Binaries + services DTOs
    let binaries = select_binaries(&report);
    let services = build_services(&report, selected_mariadb.as_ref(), &paths, http_port);

    let settings = ImportSettingsSuggestion {
        tld: tld.clone(),
        loopback: loopback.clone(),
        http_port,
        default_php_version: default_php.clone(),
        mariadb_datadir_policy: "reuse_herd".into(),
        herd_import_path: report
            .herd
            .home_path
            .clone()
            .unwrap_or_default(),
    };

    // Collect notes from discovery that matter for import
    for n in &report.notes {
        if n.contains("unavailable") || n.contains("helper") || n.contains("No Herd") {
            notes.push(n.clone());
        }
    }

    // 6) Optional: install resources
    let mut resources = None;
    if do_install {
        match install_runtime_resources(resource_dir.as_deref()) {
            Ok(r) => {
                notes.push(format!(
                    "Installed runtime resources ({} files) into {}",
                    r.copied_files, r.local_dev_root
                ));
                resources = Some(r);
            }
            Err(e) => {
                warnings.push(format!("install_runtime_resources failed: {e}"));
            }
        }
    } else if dry_run {
        notes.push("dry_run: skipped resource install.".into());
    }

    // 7) Optional: generate configs
    let mut configs = None;
    if do_configs {
        let php_tags: Vec<String> = available_php
            .iter()
            .map(|v| v.tag.clone())
            .filter(|t| validate_php_tag(t).is_ok())
            .collect();
        let php_tags = if php_tags.is_empty() {
            // still emit default tag pool so layout is usable
            vec![if validate_php_tag(&default_php_tag).is_ok() {
                default_php_tag.clone()
            } else {
                "84".into()
            }]
        } else {
            php_tags
        };

        let park_path_strings: Vec<String> = parks.iter().map(|p| p.path.clone()).collect();

        let mariadb_input = selected_mariadb.as_ref().and_then(|m| {
            let basedir = resolve_mariadb_basedir(m, &report)?;
            Some(MariadbWrapperInput {
                datadir: m.path.clone(),
                basedir,
                // Same path as ImportedService.socket_path (Badami socks/, not Herd /tmp).
                socket: Some(badami_mariadb_socket(&paths)),
                port: m.my_cnf.as_ref().and_then(|c| c.port).or(Some(3306)),
                allow_unverified_datadir: Some(false),
            })
        });
        if selected_mariadb.is_some() && mariadb_input.is_none() {
            warnings.push(
                "MariaDB datadir selected but basedir could not be resolved — wrapper my.cnf skipped."
                    .into(),
            );
        }

        let default_tag = if validate_php_tag(&default_php_tag).is_ok() {
            default_php_tag.clone()
        } else {
            php_tags.first().cloned().unwrap_or_else(|| "84".into())
        };

        match generate_configs(GenerateConfigsRequest {
            tld: Some(tld.clone()),
            park_paths: Some(park_path_strings),
            loopback: Some(loopback.clone()),
            http_port: Some(http_port),
            default_php_tag: Some(default_tag),
            php_tags: Some(php_tags),
            mariadb: mariadb_input,
            username: None,
            group: None,
            nginx_as_root: Some(false),
            dns_port: Some(53),
        }) {
            Ok(r) => {
                notes.push(format!("Generated {} config file(s).", r.written.len()));
                for n in &r.notes {
                    notes.push(n.clone());
                }
                configs = Some(r);
            }
            Err(e) => {
                warnings.push(format!("generate_configs failed: {e}"));
            }
        }
    } else if dry_run {
        notes.push("dry_run: skipped config generation.".into());
    }

    // 8) Optional: isolated site confs (available PHP only)
    if do_isolates {
        for site in &mut sites {
            if site.skipped || !site.isolated {
                continue;
            }
            let Some(ref ver) = site.php_version else {
                continue;
            };
            if validate_site_name(&site.name).is_err() {
                warnings.push(format!(
                    "Skipping conf write for invalid site name {:?}",
                    site.name
                ));
                continue;
            }
            let tag = version_to_tag(ver);
            if validate_php_tag(&tag).is_err() {
                warnings.push(format!(
                    "Skipping conf write for {}.{} — bad php tag from version {ver}",
                    site.name, site.tld
                ));
                continue;
            }
            match generate_isolated_site(IsolatedSiteRequest {
                site_name: site.name.clone(),
                tld: Some(site.tld.clone()),
                php_version: ver.clone(),
                php_tag: tag,
                http_port: Some(http_port),
            }) {
                Ok(r) => {
                    site.conf_written = true;
                    notes.push(format!(
                        "Wrote isolated site conf for {}.{} (php {ver}) → {} file(s)",
                        site.name,
                        site.tld,
                        r.written.len()
                    ));
                }
                Err(e) => {
                    warnings.push(format!(
                        "Failed isolated conf for {}.{}: {e}",
                        site.name, site.tld
                    ));
                }
            }
        }
    } else if dry_run {
        notes.push("dry_run: skipped isolated site conf writes.".into());
    }

    // 9) Snapshot (always written — even dry_run; it is the import artifact).
    // Precompute path so notes inside the snapshot include the write target
    // (Issue 7: previously the "Wrote …" line only appeared on ImportResult).
    let imported_at = unix_now();
    let snapshot_path_preview = format!("{}/herd-snapshot.json", paths.import);
    notes.push(format!("Wrote import snapshot → {snapshot_path_preview}"));
    notes.push(format!(
        "Also writing history copy herd-snapshot-{imported_at}.json under import/"
    ));

    let snapshot = HerdSnapshot {
        version: 1,
        imported_at_unix: imported_at,
        platform: report.platform.clone(),
        arch: report.arch.clone(),
        herd_home: report.herd.home_path.clone(),
        parks: parks.clone(),
        sites: sites.clone(),
        binaries: binaries.clone(),
        services: services.clone(),
        settings: settings.clone(),
        selected_mariadb: selected_mariadb.clone(),
        php_versions: report.herd.php_versions.clone(),
        notes: notes.clone(),
        warnings: warnings.clone(),
    };
    let snapshot_path = write_snapshot(&paths, &snapshot)?;

    Ok(ImportResult {
        herd_detected: report.herd.detected,
        snapshot_path,
        parks,
        sites,
        binaries,
        services,
        settings,
        selected_mariadb,
        php_versions: report.herd.php_versions,
        resources,
        configs,
        notes,
        warnings,
        services_started: false,
        herd_processes_killed: false,
        mariadb_datadir_copied: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_park_strips_trailing_slash() {
        // Fixed non-existent path: pure strip behavior (no canonicalize).
        let missing = "/tmp/badami-park-dedupe-noexist-xyz/";
        assert_eq!(
            normalize_park_path(missing),
            "/tmp/badami-park-dedupe-noexist-xyz"
        );
        assert_eq!(normalize_park_path("/"), "/");
        assert_eq!(
            normalize_park_path("  /tmp/badami-park-dedupe-noexist-xyz/  "),
            "/tmp/badami-park-dedupe-noexist-xyz"
        );

        // Canonicalize when path exists: temp dir with trailing slash collapses.
        let tmp = std::env::temp_dir().join(format!(
            "badami-park-canon-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        let with_slash = format!("{}/", tmp.display());
        let norm = normalize_park_path(&with_slash);
        assert!(!norm.ends_with('/') || norm == "/");
        assert_eq!(norm, fs::canonicalize(&tmp).unwrap().to_string_lossy());
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn dedupe_parks_with_trailing_slash() {
        let raw = vec![
            "/tmp/badami-park-dedupe-noexist-a".into(),
            "/tmp/badami-park-dedupe-noexist-a/".into(),
            "/tmp/badami-park-dedupe-noexist-b/".into(),
        ];
        let parks = normalize_park_paths(&raw);
        assert_eq!(parks.len(), 2);
        let parks_entry = parks
            .iter()
            .find(|p| p.path.ends_with("badami-park-dedupe-noexist-a"))
            .expect("parks entry");
        assert_eq!(parks_entry.sources.len(), 2);
        assert!(!parks_entry.path.ends_with('/'));
    }

    #[test]
    fn site_name_strips_tld_and_conf() {
        assert_eq!(site_name_from_conf("office.test", "test"), "office");
        assert_eq!(
            site_name_from_conf("office_sumedang.test", "test"),
            "office_sumedang"
        );
        assert_eq!(site_name_from_conf("office", "test"), "office");
        // Issue 5: strip .conf before .{tld}
        assert_eq!(site_name_from_conf("office.test.conf", "test"), "office");
        assert_eq!(
            site_name_from_conf("office_desa.test.conf", "test"),
            "office_desa"
        );
    }

    #[test]
    fn version_to_tag_basic() {
        assert_eq!(version_to_tag("7.4"), "74");
        assert_eq!(version_to_tag("8.4"), "84");
    }

    #[test]
    fn import_sites_skips_unavailable_php() {
        // Issue 3: pure unit test — no Herd dependency.
        let confs = vec![
            NginxSiteConf {
                path: "/fake/nginx/office.test".into(),
                site_name: "office.test".into(),
                isolated_php_version: Some("7.4".into()),
            },
            NginxSiteConf {
                path: "/fake/nginx/legacy.test".into(),
                site_name: "legacy.test".into(),
                isolated_php_version: Some("8.2".into()),
            },
            NginxSiteConf {
                path: "/fake/nginx/default.test".into(),
                site_name: "default.test".into(),
                isolated_php_version: None,
            },
        ];
        let php = vec![
            PhpVersionInfo {
                version: "7.4".into(),
                tag: "74".into(),
                available: true,
                reason: None,
                cli_path: Some("/bin/php74".into()),
                fpm_path: Some("/bin/php74-fpm".into()),
                fpm_conf_path: None,
            },
            PhpVersionInfo {
                version: "8.2".into(),
                tag: "82".into(),
                available: false,
                reason: Some("missing_binary".into()),
                cli_path: None,
                fpm_path: None,
                fpm_conf_path: Some("/fake/8.2-fpm.conf".into()),
            },
        ];
        let sites = import_sites(&confs, &php, &[], "test", None);
        assert_eq!(sites.len(), 3);

        let office = sites.iter().find(|s| s.name == "office").unwrap();
        assert!(office.isolated);
        assert!(!office.skipped);
        assert!(!office.conf_written);
        assert_eq!(office.php_version.as_deref(), Some("7.4"));

        let legacy = sites.iter().find(|s| s.name == "legacy").unwrap();
        assert!(legacy.isolated);
        assert!(legacy.skipped);
        assert!(!legacy.conf_written);
        assert_eq!(
            legacy.skip_reason.as_deref(),
            Some("php_8.2_unavailable")
        );

        let default = sites.iter().find(|s| s.name == "default").unwrap();
        assert!(!default.isolated);
        assert!(!default.skipped);
    }

    #[test]
    fn binary_select_key_collapses_mysqld_and_bare_php() {
        assert_eq!(
            binary_select_key("php74", &Some("7.4".into())),
            "php:7.4"
        );
        assert_eq!(binary_select_key("php", &None), "php");
        assert_eq!(binary_select_key("mariadbd", &None), "mariadb");
        assert_eq!(binary_select_key("mysqld", &None), "mariadb");
    }

    #[test]
    fn import_dry_run_smoke() {
        let res = import_herd(
            ImportHerdRequest {
                dry_run: Some(true),
                install_resources: Some(false),
                generate_configs: Some(false),
                write_isolated_sites: Some(false),
                http_port: Some(9090),
                default_php_version: None,
            },
            None,
        )
        .expect("import dry_run");

        assert!(!res.services_started);
        assert!(!res.herd_processes_killed);
        assert!(!res.mariadb_datadir_copied);
        assert!(res.snapshot_path.contains("herd-snapshot.json"));
        assert!(Path::new(&res.snapshot_path).is_file());

        // Issue 2: nginx service port follows request http_port
        let nginx = res
            .services
            .iter()
            .find(|s| s.kind == "nginx")
            .expect("nginx service");
        assert_eq!(nginx.port, Some(9090));
        assert_eq!(res.settings.http_port, 9090);

        // Snapshot is valid JSON and includes the "Wrote import snapshot" note (Issue 7)
        let body = fs::read_to_string(&res.snapshot_path).unwrap();
        let v: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(v["version"], 1);
        let snap_notes = v["notes"].as_array().cloned().unwrap_or_default();
        assert!(
            snap_notes
                .iter()
                .any(|n| n.as_str().unwrap_or("").contains("Wrote import snapshot")),
            "snapshot notes must include write path line"
        );

        // Issue 6: history stamp exists
        let stamp = PathBuf::from(&res.snapshot_path).with_file_name(format!(
            "herd-snapshot-{}.json",
            v["imported_at_unix"].as_u64().unwrap_or(0)
        ));
        assert!(
            stamp.is_file(),
            "expected history snapshot at {}",
            stamp.display()
        );

        if res.herd_detected {
            assert!(
                res.parks.len() >= 1,
                "expected at least one park on Herd machine"
            );
            for p in &res.parks {
                assert!(
                    p.path == "/" || !p.path.ends_with('/'),
                    "park not normalized: {}",
                    p.path
                );
            }
            for s in &res.sites {
                if s.skipped {
                    assert!(!s.conf_written);
                    if let Some(ref reason) = s.skip_reason {
                        assert!(
                            reason.starts_with("php_") && reason.ends_with("_unavailable"),
                            "skip_reason format: {reason}"
                        );
                    }
                }
            }
            // Issue 1: MariaDB socket_path is Badami socks/, Herd socket in extra_json
            if let Some(ref m) = res.selected_mariadb {
                assert!(Path::new(&m.path).is_dir() || !m.path.is_empty());
                let svc = res
                    .services
                    .iter()
                    .find(|svc| svc.kind == "mariadb")
                    .expect("mariadb service");
                assert_eq!(svc.data_dir.as_ref(), Some(&m.path));
                let sock = svc.socket_path.as_deref().unwrap_or("");
                assert!(
                    sock.contains("/Badami/local-dev/socks/mariadb.sock")
                        || sock.ends_with("/socks/mariadb.sock"),
                    "socket_path must be Badami wrapper sock, got {sock}"
                );
                assert!(
                    !sock.starts_with("/tmp/"),
                    "must not use Herd /tmp socket as service socket_path"
                );
                if let Some(ref extra) = svc.extra_json {
                    // herd_socket may be null if Herd my.cnf lacked socket
                    assert!(extra.get("herd_socket").is_some());
                    assert_eq!(extra.get("copied").and_then(|v| v.as_bool()), Some(false));
                }
            }

            // Issue 4: no co-selected bare php when Herd phpNN selected
            let selected_php: Vec<_> = res
                .binaries
                .iter()
                .filter(|b| b.is_selected && binary_family(&b.role) == "php")
                .collect();
            let has_versioned = selected_php.iter().any(|b| {
                b.role
                    .trim_end_matches("-fpm")
                    .chars()
                    .skip(3)
                    .all(|c| c.is_ascii_digit())
                    && b.role.len() > 3
            });
            if has_versioned {
                assert!(
                    !selected_php.iter().any(|b| b.role == "php" || b.role == "php-fpm"),
                    "bare PATH php must not be selected next to Herd phpNN"
                );
            }
            // mysqld not selected when mariadb is
            let sel_db: Vec<_> = res
                .binaries
                .iter()
                .filter(|b| b.is_selected && binary_family(&b.role) == "mariadb")
                .collect();
            // At most one mariadb-family selection is ideal; if multiple paths of same role ok,
            // but mysqld role string shouldn't appear selected when mariadb is.
            assert!(
                !sel_db.iter().any(|b| b.role == "mysqld"),
                "mysqld must collapse under mariadb family / not dual-select"
            );
        }
    }

    #[test]
    fn import_with_configs_smoke() {
        // Full path except we still never start services / copy datadir.
        let res = import_herd(
            ImportHerdRequest {
                dry_run: Some(false),
                install_resources: Some(true),
                generate_configs: Some(true),
                write_isolated_sites: Some(true),
                http_port: Some(8080),
                default_php_version: Some("8.4".into()),
            },
            None,
        )
        .expect("import full");

        assert!(!res.services_started);
        assert!(!res.herd_processes_killed);
        assert!(!res.mariadb_datadir_copied);
        assert!(Path::new(&res.snapshot_path).is_file());

        // nginx port + settings agree
        let nginx = res.services.iter().find(|s| s.kind == "nginx").unwrap();
        assert_eq!(nginx.port, Some(8080));
        assert_eq!(res.settings.http_port, 8080);

        if res.herd_detected {
            if let Some(ref cfg) = res.configs {
                assert!(!cfg.written.is_empty());
                let root = PathBuf::from(&cfg.local_dev_root);
                let valet = fs::read_to_string(root.join("config/valet/config.json")).unwrap();
                let v: serde_json::Value = serde_json::from_str(&valet).unwrap();
                let paths = v["paths"].as_array().cloned().unwrap_or_default();
                assert_eq!(paths.len(), res.parks.len());
                for p in &paths {
                    let s = p.as_str().unwrap_or("");
                    assert!(s == "/" || !s.ends_with('/'));
                }

                // Issue 1: wrapper my.cnf socket matches service DTO Badami socket
                if let Some(svc) = res.services.iter().find(|s| s.kind == "mariadb") {
                    let my = fs::read_to_string(root.join("mariadb/my.cnf")).unwrap();
                    let sock = svc.socket_path.as_deref().unwrap_or("");
                    assert!(
                        my.contains(sock),
                        "wrapper my.cnf must contain service socket_path {sock}"
                    );
                    assert!(my.contains("socks/mariadb.sock") || my.contains(&sock.replace('\\', "/")));
                }
            }
            for s in res.sites.iter().filter(|s| s.isolated && !s.skipped) {
                assert!(
                    s.conf_written,
                    "expected conf for available isolate {}.{}",
                    s.name, s.tld
                );
            }
            for s in res.sites.iter().filter(|s| s.skipped) {
                assert!(!s.conf_written);
            }
        }
    }
}
