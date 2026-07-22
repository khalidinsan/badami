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
    // "office.test" → "office"; "office" stays "office"
    let suffix = format!(".{tld}");
    if let Some(base) = site_name.strip_suffix(&suffix) {
        base.to_string()
    } else if let Some((base, _rest)) = site_name.rsplit_once('.') {
        // Fallback: strip last .segment if it looks like a tld-ish label
        base.to_string()
    } else {
        site_name.to_string()
    }
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
    match role {
        "mariadbd" => "mariadb".into(),
        "redis-server" => "redis".into(),
        "php-fpm" => "php_fpm".into(),
        r if r.ends_with("-fpm") && r.starts_with("php") => "php_fpm".into(),
        r if r.starts_with("php") && r.chars().skip(3).all(|c| c.is_ascii_digit()) => "php".into(),
        r => r.to_string(),
    }
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

fn binary_select_key(role: &str, version: &Option<String>) -> String {
    let db_role = role_for_db(role);
    if role.starts_with("php") {
        format!("{}:{}", db_role, version.clone().unwrap_or_default())
    } else {
        db_role
    }
}

fn select_binaries(report: &DiscoveryReport) -> Vec<ImportedBinary> {
    // Prefer Herd-sourced for each logical role; keep alternates unselected.
    let mut selected_keys: BTreeSet<String> = BTreeSet::new();
    let mut out: Vec<ImportedBinary> = Vec::new();

    // Pass 1: select Herd-sourced binaries first.
    for c in &report.candidates {
        let src = normalize_binary_source(&c.source);
        let key = binary_select_key(&c.role, &c.version);
        let is_selected = src == "herd" && selected_keys.insert(key);
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

    // Pass 2: fill gaps with non-Herd candidates when no selection exists for that key.
    let mut promote: Vec<usize> = Vec::new();
    for (idx, b) in out.iter().enumerate() {
        if b.is_selected {
            continue;
        }
        let key = binary_select_key(&b.role, &b.version);
        if !selected_keys.contains(&key) {
            promote.push(idx);
            selected_keys.insert(key);
        }
    }
    for idx in promote {
        out[idx].is_selected = true;
    }

    out
}

fn build_services(
    report: &DiscoveryReport,
    selected_mariadb: Option<&MariadbCandidate>,
    paths: &RuntimePaths,
) -> Vec<ImportedService> {
    let mut services = Vec::new();

    // nginx
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
        port: Some(8080),
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

    // mariadb — data_dir path only, no copy
    if let Some(m) = selected_mariadb {
        let basedir = m
            .my_cnf
            .as_ref()
            .and_then(|c| c.basedir.clone());
        let socket = m
            .my_cnf
            .as_ref()
            .and_then(|c| c.socket.clone())
            .or_else(|| Some(format!("{}/mariadb.sock", paths.socks)));
        let port = m.my_cnf.as_ref().and_then(|c| c.port).or(Some(3306));
        let bin = report
            .candidates
            .iter()
            .find(|c| c.role == "mariadbd")
            .map(|c| c.path.clone());
        services.push(ImportedService {
            kind: "mariadb".into(),
            display_name: "MariaDB".into(),
            enabled: true,
            data_dir: Some(m.path.clone()),
            config_path: Some(format!("{}/my.cnf", paths.mariadb)),
            port,
            socket_path: socket,
            binary_path: bin,
            extra_json: Some(serde_json::json!({
                "uuid": m.uuid,
                "bytes": m.bytes,
                "score": m.score,
                "basedir": basedir,
                "policy": "reuse_herd",
                "copied": false,
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

fn write_snapshot(paths: &RuntimePaths, snapshot: &HerdSnapshot) -> Result<String, String> {
    let dir = ensure_import_dir(paths)?;
    let out = dir.join("herd-snapshot.json");
    let text = serde_json::to_string_pretty(snapshot)
        .map_err(|e| format!("serialize herd-snapshot: {e}"))?
        + "\n";
    fs::write(&out, text).map_err(|e| format!("write {}: {e}", out.display()))?;
    Ok(out.to_string_lossy().into_owned())
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
    let services = build_services(&report, selected_mariadb.as_ref(), &paths);

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
                socket: Some(format!("{}/mariadb.sock", paths.socks)),
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

    // 9) Snapshot (always written — even dry_run; it is the import artifact)
    let snapshot = HerdSnapshot {
        version: 1,
        imported_at_unix: unix_now(),
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
    notes.push(format!("Wrote import snapshot → {snapshot_path}"));

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
        assert_eq!(
            normalize_park_path("/tmp/foo/"),
            if Path::new("/tmp/foo").exists() || Path::new("/tmp/foo/").exists() {
                // may canonicalize
                normalize_park_path("/tmp/foo")
            } else {
                "/tmp/foo".to_string()
            }
        );
        assert_eq!(normalize_park_path("/"), "/");
        assert_eq!(normalize_park_path("  /var/tmp/  "), {
            let n = normalize_park_path("/var/tmp");
            n
        });
    }

    #[test]
    fn dedupe_parks_with_trailing_slash() {
        let raw = vec![
            "/tmp/parks".into(),
            "/tmp/parks/".into(),
            "/tmp/other/".into(),
        ];
        let parks = normalize_park_paths(&raw);
        assert_eq!(parks.len(), 2);
        let paths: Vec<_> = parks.iter().map(|p| p.path.clone()).collect();
        assert!(paths.iter().any(|p| p.ends_with("parks") || p.contains("parks")));
        // Sources retained for first park
        let parks_entry = parks
            .iter()
            .find(|p| p.path.contains("parks"))
            .expect("parks entry");
        assert!(parks_entry.sources.len() >= 2);
    }

    #[test]
    fn site_name_strips_tld() {
        assert_eq!(site_name_from_conf("office.test", "test"), "office");
        assert_eq!(
            site_name_from_conf("office_sumedang.test", "test"),
            "office_sumedang"
        );
        assert_eq!(site_name_from_conf("office", "test"), "office");
    }

    #[test]
    fn version_to_tag_basic() {
        assert_eq!(version_to_tag("7.4"), "74");
        assert_eq!(version_to_tag("8.4"), "84");
    }

    #[test]
    fn import_dry_run_smoke() {
        let res = import_herd(
            ImportHerdRequest {
                dry_run: Some(true),
                install_resources: Some(false),
                generate_configs: Some(false),
                write_isolated_sites: Some(false),
                http_port: Some(8080),
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

        // Snapshot is valid JSON
        let body = fs::read_to_string(&res.snapshot_path).unwrap();
        let v: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(v["version"], 1);

        if res.herd_detected {
            // Live machine with Herd: parks should be deduped (Sites slash pair → 1)
            assert!(
                res.parks.len() >= 1,
                "expected at least one park on Herd machine"
            );
            // No park path should end with / (except root)
            for p in &res.parks {
                assert!(
                    p.path == "/" || !p.path.ends_with('/'),
                    "park not normalized: {}",
                    p.path
                );
            }
            // Skipped isolates for unavailable PHP must not have conf_written
            for s in &res.sites {
                if s.skipped {
                    assert!(!s.conf_written);
                }
            }
            // MariaDB if present is path-only
            if let Some(ref m) = res.selected_mariadb {
                assert!(Path::new(&m.path).is_dir() || !m.path.is_empty());
                assert!(
                    res.services
                        .iter()
                        .any(|svc| svc.kind == "mariadb" && svc.data_dir.as_ref() == Some(&m.path))
                );
            }
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

        if res.herd_detected {
            if let Some(ref cfg) = res.configs {
                assert!(!cfg.written.is_empty());
                let root = PathBuf::from(&cfg.local_dev_root);
                let valet = fs::read_to_string(root.join("config/valet/config.json")).unwrap();
                let v: serde_json::Value = serde_json::from_str(&valet).unwrap();
                let paths = v["paths"].as_array().cloned().unwrap_or_default();
                // Deduped parks written into config
                assert_eq!(paths.len(), res.parks.len());
                for p in &paths {
                    let s = p.as_str().unwrap_or("");
                    assert!(s == "/" || !s.ends_with('/'));
                }
            }
            // Available isolates should get confs when write_isolated_sites
            for s in res.sites.iter().filter(|s| s.isolated && !s.skipped) {
                assert!(
                    s.conf_written,
                    "expected conf for available isolate {}.{}",
                    s.name, s.tld
                );
            }
        }
    }
}
