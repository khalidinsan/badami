//! Site park / link / isolate management for Badami Local Dev.
//!
//! Operates only under `~/Library/Application Support/Badami/local-dev/`
//! (or an injected test root via `*_at` helpers).
//! **Never** mutates or deletes Herd datadir / Herd configs / project source trees
//! (except creating/removing Badami-owned Valet `Sites/` symlinks).
//!
//! Commands:
//! - `ld_list_sites` — scan park paths + Sites/ links from Badami valet config
//! - `ld_park` / `ld_unpark` — add/remove park path in config.json
//! - `ld_link` / `ld_unlink` — symlink under config/valet/Sites/
//! - `ld_isolate_php` / `ld_unisolate` — isolated nginx conf with static socket
//! - `ld_open_site_url` — URL respecting http_port (Mode A `:8080`)
//! - `ld_reload_nginx` — `nginx -t` then `nginx -s reload`

use super::config_gen::{
    ensure_path_under_root, validate_php_version_display, validate_site_name, validate_tld,
    write_isolated_site_conf, write_site_conf, write_valet_config, IsolatedSiteRequest,
    SiteConfOptions,
};
use super::discovery::{build_runtime_paths, discover, preferred_suffix, RuntimePaths};
use super::import_herd::normalize_park_path;
use super::mariadb_guard::{pid_is_alive, read_pid_file};
use super::service_specs::parse_nginx_http_port;
use super::tls::{self, TlsPaths};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

/// Create a symlink. Local Dev is macOS-first; Windows gets a best-effort path
/// so the crate still compiles in the multi-platform release matrix.
fn make_symlink(target: &Path, link: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(target, link)
    }
    #[cfg(windows)]
    {
        if target.is_dir() {
            std::os::windows::fs::symlink_dir(target, link)
        } else {
            std::os::windows::fs::symlink_file(target, link)
        }
    }
}

// ── DTOs ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SiteInfo {
    pub name: String,
    pub tld: String,
    pub url: String,
    pub path: String,
    /// `"parked"` | `"linked"`.
    pub kind: String,
    pub php_version: Option<String>,
    pub isolated: bool,
    pub secured: bool,
    /// Absolute path to Badami isolated conf when present.
    pub conf_path: Option<String>,
    /// Parent park directory for parked sites.
    pub park_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListSitesResult {
    pub sites: Vec<SiteInfo>,
    pub park_paths: Vec<String>,
    pub tld: String,
    pub loopback: String,
    pub http_port: u16,
    pub https_port: u16,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParkResult {
    pub park_paths: Vec<String>,
    pub path: String,
    pub action: String,
    pub written: Vec<String>,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkResult {
    pub site: String,
    pub path: String,
    pub link_path: String,
    pub action: String,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IsolateResult {
    pub site: String,
    pub php_version: Option<String>,
    pub conf_path: Option<String>,
    pub action: String,
    pub written: Vec<String>,
    pub notes: Vec<String>,
    /// True when isolate was refused because PHP binary is missing.
    pub refused: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenSiteUrlResult {
    pub site: String,
    pub tld: String,
    pub http_port: u16,
    pub https_port: Option<u16>,
    pub secured: bool,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecureSiteCommandResult {
    pub site: String,
    pub tld: String,
    pub action: String,
    pub secured: bool,
    pub cert_path: Option<String>,
    pub key_path: Option<String>,
    pub conf_path: Option<String>,
    pub written: Vec<String>,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReloadNginxResult {
    pub ok: bool,
    pub test_ok: bool,
    pub reloaded: bool,
    pub binary: Option<String>,
    pub conf: Option<String>,
    pub stdout: String,
    pub stderr: String,
    pub notes: Vec<String>,
}

// ── Valet config helpers ────────────────────────────────────────────

#[derive(Debug, Clone)]
struct ValetConfig {
    tld: String,
    loopback: String,
    paths: Vec<String>,
}

fn valet_config_path(paths: &RuntimePaths) -> PathBuf {
    PathBuf::from(&paths.config_valet).join("config.json")
}

fn sites_dir(paths: &RuntimePaths) -> PathBuf {
    PathBuf::from(&paths.config_valet).join("Sites")
}

fn isolated_conf_path(paths: &RuntimePaths, site: &str) -> Result<PathBuf, String> {
    let sites = PathBuf::from(&paths.nginx).join("sites");
    // Confined under nginx/sites/{validated_name}.conf (no traversal).
    ensure_path_under_root(&sites, Path::new(&format!("{site}.conf")))
}

fn read_valet_config(paths: &RuntimePaths) -> ValetConfig {
    let p = valet_config_path(paths);
    let mut cfg = ValetConfig {
        tld: "test".into(),
        loopback: "127.0.0.1".into(),
        paths: Vec::new(),
    };
    if !p.is_file() {
        return cfg;
    }
    let Ok(content) = fs::read_to_string(&p) else {
        return cfg;
    };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) else {
        return cfg;
    };
    if let Some(t) = json.get("tld").and_then(|v| v.as_str()) {
        if !t.is_empty() {
            cfg.tld = t.to_string();
        }
    }
    if let Some(l) = json.get("loopback").and_then(|v| v.as_str()) {
        if !l.is_empty() {
            cfg.loopback = l.to_string();
        }
    }
    if let Some(arr) = json.get("paths").and_then(|v| v.as_array()) {
        for item in arr {
            if let Some(s) = item.as_str() {
                let n = normalize_park_path(s);
                if !n.is_empty() {
                    cfg.paths.push(n);
                }
            }
        }
    }
    // Dedupe preserving order
    let mut seen = BTreeSet::new();
    cfg.paths.retain(|p| seen.insert(p.clone()));
    cfg
}

fn write_parks(
    paths: &RuntimePaths,
    tld: &str,
    loopback: &str,
    park_paths: &[String],
) -> Result<Vec<String>, String> {
    validate_tld(tld)?;
    let mut written = Vec::new();
    write_valet_config(paths, tld, park_paths, loopback, &mut written)?;
    Ok(written)
}

/// Default HTTPS listen port in Mode A (unprivileged). Mirrors
/// `local_dev_settings.https_port` default seed from migration 022. Callers
/// that persist a different value in SQLite pass it through `ld_list_sites`
/// / `ld_secure` arguments.
pub const DEFAULT_HTTPS_PORT: u16 = 8443;

/// Build site URL. When `secured` is true an `https://host[:port]` URL is
/// emitted (port omitted for `:443`); otherwise `http://` with `http_port`.
pub fn site_url(name: &str, tld: &str, http_port: u16, https_port: u16, secured: bool) -> String {
    let host = format!("{name}.{tld}");
    if secured {
        if https_port == 443 {
            format!("https://{host}")
        } else {
            format!("https://{host}:{https_port}")
        }
    } else if http_port == 80 {
        format!("http://{host}")
    } else {
        format!("http://{host}:{http_port}")
    }
}

/// Map display PHP version (`7.4` / `8.4`) → compact tag (`74` / `84`).
///
/// Herd / Badami socket names use exactly two digits. Only single-digit
/// major.minor forms are accepted.
fn version_to_tag(version: &str) -> Result<String, String> {
    validate_php_version_display(version)?;
    let parts: Vec<&str> = version.split('.').collect();
    if parts.len() != 2
        || parts[0].len() != 1
        || parts[1].len() != 1
        || !parts[0].chars().all(|c| c.is_ascii_digit())
        || !parts[1].chars().all(|c| c.is_ascii_digit())
    {
        return Err(format!(
            "php version tag must be N.M with single digits (e.g. \"7.4\", \"8.4\"); got {version:?}"
        ));
    }
    Ok(format!("{}{}", parts[0], parts[1]))
}

fn parse_isolated_version_from_conf(content: &str) -> Option<String> {
    for line in content.lines() {
        let trimmed = line.trim().trim_start_matches('#').trim();
        if let Some(rest) = trimmed.strip_prefix("ISOLATED_PHP_VERSION=") {
            let v = rest.trim();
            if !v.is_empty() {
                return Some(v.to_string());
            }
        }
    }
    None
}

/// True when the per-site conf carries the `# BADAMI_SECURED=1` marker.
fn parse_secured_marker_from_conf(content: &str) -> bool {
    for line in content.lines() {
        let trimmed = line.trim().trim_start_matches('#').trim();
        if trimmed == "BADAMI_SECURED=1" {
            return true;
        }
    }
    false
}

/// Combined read of per-site conf state. Returns:
/// (isolated, php_version_display, secured, conf_path_if_present).
fn read_site_conf_state(
    paths: &RuntimePaths,
    site: &str,
) -> (bool, Option<String>, bool, Option<String>) {
    let Ok(conf) = isolated_conf_path(paths, site) else {
        return (false, None, false, None);
    };
    if !conf.is_file() {
        return (false, None, false, None);
    }
    let content = fs::read_to_string(&conf).unwrap_or_default();
    let ver = parse_isolated_version_from_conf(&content);
    let secured = parse_secured_marker_from_conf(&content);
    (
        ver.is_some(),
        ver,
        secured,
        Some(conf.to_string_lossy().into_owned()),
    )
}

#[allow(dead_code)]
fn read_isolation(paths: &RuntimePaths, site: &str) -> (bool, Option<String>, Option<String>) {
    let (isolated, ver, _, conf) = read_site_conf_state(paths, site);
    (isolated, ver, conf)
}

fn resolve_link_target(link: &Path) -> Option<String> {
    if let Ok(canon) = fs::canonicalize(link) {
        return Some(canon.to_string_lossy().into_owned());
    }
    if let Ok(target) = fs::read_link(link) {
        if target.is_absolute() {
            return Some(target.to_string_lossy().into_owned());
        }
        if let Some(parent) = link.parent() {
            return Some(parent.join(target).to_string_lossy().into_owned());
        }
        return Some(target.to_string_lossy().into_owned());
    }
    None
}

fn is_hidden_or_junk(name: &str) -> bool {
    name.starts_with('.')
        || name == "node_modules"
        || name == "vendor"
        || name.eq_ignore_ascii_case("thumbs.db")
        || name == "Desktop.ini"
}

// ── Core: list sites ────────────────────────────────────────────────

/// Scan valet config park paths + Sites/ links and build site inventory.
///
/// `https_port` governs the URL emitted for sites flagged `secured`. Defaults
/// to [`DEFAULT_HTTPS_PORT`] (`8443`) when the caller passes `None` — SQLite
/// `local_dev_settings.https_port` is the source of truth from the frontend's
/// perspective.
pub fn list_sites_at(
    paths: &RuntimePaths,
    https_port: Option<u16>,
) -> Result<ListSitesResult, String> {
    let cfg = read_valet_config(paths);
    let http_port = parse_nginx_http_port(paths);
    let https_port = https_port.unwrap_or(DEFAULT_HTTPS_PORT);
    let mut notes = Vec::new();

    if !valet_config_path(paths).is_file() {
        notes.push(
            "No valet config.json yet — run ld_generate_configs or ld_import_herd first.".into(),
        );
    }

    // Map name → SiteInfo (linked wins over parked for same name).
    let mut by_name: BTreeMap<String, SiteInfo> = BTreeMap::new();

    // 1) Linked sites under config/valet/Sites/
    let links_dir = sites_dir(paths);
    if links_dir.is_dir() {
        if let Ok(entries) = fs::read_dir(&links_dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                if is_hidden_or_junk(&name) {
                    continue;
                }
                if validate_site_name(&name).is_err() {
                    notes.push(format!("skipping invalid link name: {name}"));
                    continue;
                }
                let link_path = entry.path();
                let meta = fs::symlink_metadata(&link_path).ok();
                let is_link = meta
                    .as_ref()
                    .map(|m| m.file_type().is_symlink())
                    .unwrap_or(false);
                let is_dir = link_path.is_dir();
                if !is_link && !is_dir {
                    continue;
                }
                let target = resolve_link_target(&link_path)
                    .unwrap_or_else(|| link_path.to_string_lossy().into_owned());
                let (isolated, php_version, secured_marker, conf_path) =
                    read_site_conf_state(paths, &name);
                let secured = secured_marker && tls::site_has_certs(paths, &name, &cfg.tld);
                by_name.insert(
                    name.clone(),
                    SiteInfo {
                        name: name.clone(),
                        tld: cfg.tld.clone(),
                        url: site_url(&name, &cfg.tld, http_port, https_port, secured),
                        path: target,
                        kind: "linked".into(),
                        php_version,
                        isolated,
                        secured,
                        conf_path,
                        park_path: Some(links_dir.to_string_lossy().into_owned()),
                    },
                );
            }
        }
    }

    // 2) Parked sites: immediate children of each park path
    for park in &cfg.paths {
        let park_p = Path::new(park);
        if !park_p.is_dir() {
            notes.push(format!("park path missing or not a directory: {park}"));
            continue;
        }
        // Skip scanning the Badami Sites dir as a park (links already handled).
        let is_badami_sites = park_p
            .canonicalize()
            .ok()
            .and_then(|c| links_dir.canonicalize().ok().map(|l| c == l))
            .unwrap_or(false);
        if is_badami_sites {
            continue;
        }

        let Ok(entries) = fs::read_dir(park_p) else {
            notes.push(format!("cannot read park path: {park}"));
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if is_hidden_or_junk(&name) {
                continue;
            }
            let child = entry.path();
            if !child.is_dir() {
                continue;
            }
            if validate_site_name(&name).is_err() {
                continue;
            }
            if by_name.contains_key(&name) {
                continue;
            }
            let path_str = fs::canonicalize(&child)
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_else(|_| child.to_string_lossy().into_owned());
            let (isolated, php_version, secured_marker, conf_path) =
                read_site_conf_state(paths, &name);
            let secured = secured_marker && tls::site_has_certs(paths, &name, &cfg.tld);
            by_name.insert(
                name.clone(),
                SiteInfo {
                    name: name.clone(),
                    tld: cfg.tld.clone(),
                    url: site_url(&name, &cfg.tld, http_port, https_port, secured),
                    path: path_str,
                    kind: "parked".into(),
                    php_version,
                    isolated,
                    secured,
                    conf_path,
                    park_path: Some(park.clone()),
                },
            );
        }
    }

    // 3) Isolated / secured confs without a matching park/link entry (orphan confs)
    let sites_conf_dir = PathBuf::from(&paths.nginx).join("sites");
    if sites_conf_dir.is_dir() {
        if let Ok(entries) = fs::read_dir(&sites_conf_dir) {
            for entry in entries.flatten() {
                let fname = entry.file_name().to_string_lossy().into_owned();
                let Some(name) = fname.strip_suffix(".conf") else {
                    continue;
                };
                if by_name.contains_key(name) {
                    continue;
                }
                if validate_site_name(name).is_err() {
                    continue;
                }
                let content = fs::read_to_string(entry.path()).unwrap_or_default();
                let php_version = parse_isolated_version_from_conf(&content);
                let isolated = php_version.is_some();
                let secured_marker = parse_secured_marker_from_conf(&content);
                let secured = secured_marker && tls::site_has_certs(paths, name, &cfg.tld);
                by_name.insert(
                    name.to_string(),
                    SiteInfo {
                        name: name.to_string(),
                        tld: cfg.tld.clone(),
                        url: site_url(name, &cfg.tld, http_port, https_port, secured),
                        path: String::new(),
                        kind: "parked".into(),
                        php_version,
                        isolated,
                        secured,
                        conf_path: Some(entry.path().to_string_lossy().into_owned()),
                        park_path: None,
                    },
                );
                notes.push(format!(
                    "orphan isolate conf without park/link path: {name}"
                ));
            }
        }
    }

    let sites: Vec<SiteInfo> = by_name.into_values().collect();
    notes.push(format!(
        "Found {} site(s) across {} park path(s); http_port={http_port} https_port={https_port}",
        sites.len(),
        cfg.paths.len()
    ));

    Ok(ListSitesResult {
        sites,
        park_paths: cfg.paths,
        tld: cfg.tld,
        loopback: cfg.loopback,
        http_port,
        https_port,
        notes,
    })
}

pub fn list_sites(https_port: Option<u16>) -> Result<ListSitesResult, String> {
    list_sites_at(&build_runtime_paths()?, https_port)
}

// ── Park / unpark ───────────────────────────────────────────────────

/// Add a park path to valet config.json (normalized, deduped).
///
/// Parks are source-code trees (e.g. `~/Herd`, project folders). Parking is
/// **config-only** — never deletes or mutates the directory or Herd data.
pub fn park_path_at(paths: &RuntimePaths, raw_path: &str) -> Result<ParkResult, String> {
    let mut cfg = read_valet_config(paths);

    let norm = normalize_park_path(raw_path);
    if norm.is_empty() {
        return Err("park path is empty".into());
    }
    let p = Path::new(&norm);
    if !p.is_dir() {
        return Err(format!("park path is not a directory: {norm}"));
    }

    let mut notes = Vec::new();
    if cfg.paths.iter().any(|x| x == &norm) {
        notes.push(format!("already parked: {norm}"));
        return Ok(ParkResult {
            park_paths: cfg.paths,
            path: norm,
            action: "noop".into(),
            written: vec![],
            notes,
        });
    }

    cfg.paths.push(norm.clone());
    let written = write_parks(paths, &cfg.tld, &cfg.loopback, &cfg.paths)?;
    notes.push(format!("parked {norm}"));

    Ok(ParkResult {
        park_paths: cfg.paths,
        path: norm,
        action: "parked".into(),
        written,
        notes,
    })
}

pub fn park_path(raw_path: &str) -> Result<ParkResult, String> {
    park_path_at(&build_runtime_paths()?, raw_path)
}

/// Remove a park path from valet config.json. Never deletes the directory.
pub fn unpark_path_at(paths: &RuntimePaths, raw_path: &str) -> Result<ParkResult, String> {
    let mut cfg = read_valet_config(paths);
    let norm = normalize_park_path(raw_path);
    if norm.is_empty() {
        return Err("park path is empty".into());
    }

    let before = cfg.paths.len();
    cfg.paths
        .retain(|p| p != &norm && normalize_park_path(p) != norm);

    if cfg.paths.len() == before {
        let target_canon = Path::new(&norm)
            .canonicalize()
            .ok()
            .map(|p| p.to_string_lossy().into_owned());
        if let Some(ref canon) = target_canon {
            cfg.paths.retain(|p| {
                Path::new(p)
                    .canonicalize()
                    .map(|c| c.to_string_lossy() != *canon)
                    .unwrap_or(true)
            });
        }
    }

    if cfg.paths.len() == before {
        return Ok(ParkResult {
            park_paths: cfg.paths,
            path: norm,
            action: "noop".into(),
            written: vec![],
            notes: vec!["path was not in park list".into()],
        });
    }

    let written = write_parks(paths, &cfg.tld, &cfg.loopback, &cfg.paths)?;
    Ok(ParkResult {
        park_paths: cfg.paths,
        path: norm.clone(),
        action: "unparked".into(),
        written,
        notes: vec![
            format!("unparked {norm} (directory left intact)"),
            "never deletes project files or Herd data".into(),
        ],
    })
}

pub fn unpark_path(raw_path: &str) -> Result<ParkResult, String> {
    unpark_path_at(&build_runtime_paths()?, raw_path)
}

// ── Link / unlink ───────────────────────────────────────────────────

/// Create `config/valet/Sites/{site}` → `path` symlink for a custom domain.
pub fn link_site_at(
    paths: &RuntimePaths,
    site: &str,
    target_path: &str,
) -> Result<LinkResult, String> {
    validate_site_name(site)?;
    let links = sites_dir(paths);
    fs::create_dir_all(&links).map_err(|e| format!("mkdir Sites: {e}"))?;

    let target = normalize_park_path(target_path);
    if target.is_empty() {
        return Err("link target path is empty".into());
    }
    let target_p = Path::new(&target);
    if !target_p.exists() {
        return Err(format!("link target does not exist: {target}"));
    }
    // Valet links are project directories (follow symlink-to-dir via is_dir).
    if !target_p.is_dir() {
        return Err(format!("link target must be a directory: {target}"));
    }

    let link_path = links.join(site);
    // Refuse path traversal: link must live under Sites.
    let links_canon = links.canonicalize().unwrap_or_else(|_| links.clone());
    if let Ok(parent) = link_path
        .parent()
        .ok_or_else(|| "invalid link path".to_string())?
        .canonicalize()
    {
        if parent != links_canon {
            return Err("refusing link outside Badami Sites/".into());
        }
    }

    let mut notes = Vec::new();

    if link_path.exists() || link_path.symlink_metadata().is_ok() {
        let meta =
            fs::symlink_metadata(&link_path).map_err(|e| format!("stat existing link: {e}"))?;
        if meta.file_type().is_symlink() {
            fs::remove_file(&link_path).map_err(|e| format!("remove existing symlink: {e}"))?;
            notes.push("replaced existing symlink".into());
        } else if meta.is_dir() {
            return Err(format!(
                "Sites/{site} is a real directory; refusing to overwrite (unlink first or pick another name)"
            ));
        } else {
            return Err(format!("Sites/{site} already exists and is not a symlink"));
        }
    }

    let abs_target = fs::canonicalize(target_p)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or(target.clone());

    make_symlink(Path::new(&abs_target), &link_path).map_err(|e| {
        format!(
            "symlink {} → {}: {e}",
            link_path.display(),
            abs_target
        )
    })?;
    notes.push(format!("linked {site} → {abs_target}"));

    // Ensure Sites park path is listed so Valet server.php can find links.
    let mut cfg = read_valet_config(paths);
    let sites_str = links
        .canonicalize()
        .unwrap_or(links.clone())
        .to_string_lossy()
        .into_owned();
    if !cfg.paths.iter().any(|p| {
        Path::new(p)
            .canonicalize()
            .map(|c| c.to_string_lossy() == sites_str)
            .unwrap_or(p == &sites_str)
    }) {
        cfg.paths.push(sites_str.clone());
        if let Err(e) = write_parks(paths, &cfg.tld, &cfg.loopback, &cfg.paths) {
            notes.push(format!("warning: could not add Sites to park paths: {e}"));
        } else {
            notes.push("added Sites/ to park paths".into());
        }
    }

    Ok(LinkResult {
        site: site.to_string(),
        path: abs_target,
        link_path: link_path.to_string_lossy().into_owned(),
        action: "linked".into(),
        notes,
    })
}

pub fn link_site(site: &str, target_path: &str) -> Result<LinkResult, String> {
    link_site_at(&build_runtime_paths()?, site, target_path)
}

/// Remove `config/valet/Sites/{site}` symlink only. Never deletes the target.
pub fn unlink_site_at(paths: &RuntimePaths, site: &str) -> Result<LinkResult, String> {
    validate_site_name(site)?;
    let links = sites_dir(paths);
    let link_path = links.join(site);

    if !link_path.exists() && link_path.symlink_metadata().is_err() {
        return Ok(LinkResult {
            site: site.to_string(),
            path: String::new(),
            link_path: link_path.to_string_lossy().into_owned(),
            action: "noop".into(),
            notes: vec![format!("no link Sites/{site}")],
        });
    }

    let meta = fs::symlink_metadata(&link_path).map_err(|e| format!("stat link: {e}"))?;
    let target = resolve_link_target(&link_path).unwrap_or_default();

    if meta.file_type().is_symlink() {
        fs::remove_file(&link_path).map_err(|e| format!("unlink symlink: {e}"))?;
    } else if meta.is_dir() {
        return Err(format!(
            "Sites/{site} is a real directory, not a symlink; refusing to delete"
        ));
    } else {
        fs::remove_file(&link_path).map_err(|e| format!("remove: {e}"))?;
    }

    Ok(LinkResult {
        site: site.to_string(),
        path: target,
        link_path: link_path.to_string_lossy().into_owned(),
        action: "unlinked".into(),
        notes: vec![
            format!("removed Sites/{site} symlink"),
            "target project directory left intact".into(),
        ],
    })
}

pub fn unlink_site(site: &str) -> Result<LinkResult, String> {
    unlink_site_at(&build_runtime_paths()?, site)
}

// ── Isolate / unisolate ─────────────────────────────────────────────

fn php_version_available(version: &str) -> Result<(bool, Option<String>), String> {
    let report = discover()?;
    let match_v = report
        .herd
        .php_versions
        .iter()
        .find(|v| v.version == version);
    match match_v {
        Some(v) if v.available => Ok((true, v.fpm_path.clone().or(v.cli_path.clone()))),
        Some(v) => Ok((
            false,
            Some(
                v.reason
                    .clone()
                    .unwrap_or_else(|| format!("php {version} not available")),
            ),
        )),
        None => Ok((
            false,
            Some(format!("php {version} not found in discovery inventory")),
        )),
    }
}

/// Write isolated nginx conf with static unix socket. Refuses if PHP binary missing.
///
/// Preserves any pre-existing `BADAMI_SECURED=1` marker — if the site is
/// already secured we re-render the merged conf with both isolated + secured
/// flags set so the TLS listener stays in place.
pub fn isolate_php_at(
    paths: &RuntimePaths,
    site: &str,
    version: &str,
) -> Result<IsolateResult, String> {
    validate_site_name(site)?;
    validate_php_version_display(version)?;
    let tag = version_to_tag(version)?;

    let (available, reason) = php_version_available(version)?;
    if !available {
        return Ok(IsolateResult {
            site: site.to_string(),
            php_version: Some(version.to_string()),
            conf_path: None,
            action: "refused".into(),
            written: vec![],
            notes: vec![reason.unwrap_or_else(|| format!("php {version} unavailable"))],
            refused: true,
        });
    }

    let cfg = read_valet_config(paths);
    let http_port = parse_nginx_http_port(paths);

    let mut written = Vec::new();
    // Preserve TLS state if the site is already secured.
    let (_, _, prev_secured, _) = read_site_conf_state(paths, site);
    let secured_now = prev_secured && tls::site_has_certs(paths, site, &cfg.tld);
    if secured_now {
        let tls_paths = TlsPaths::from_runtime(paths);
        let opts = SiteConfOptions {
            site_name: site.to_string(),
            tld: cfg.tld.clone(),
            http_port,
            https_port: Some(DEFAULT_HTTPS_PORT),
            cert_path: Some(
                tls_paths
                    .site_cert(site, &cfg.tld)
                    .to_string_lossy()
                    .into_owned(),
            ),
            key_path: Some(
                tls_paths
                    .site_key(site, &cfg.tld)
                    .to_string_lossy()
                    .into_owned(),
            ),
            php_tag: Some(tag.clone()),
            php_version_display: Some(version.to_string()),
        };
        write_site_conf(paths, &opts, &mut written).map(|_| ())?;
    } else {
        let req = IsolatedSiteRequest {
            site_name: site.to_string(),
            tld: Some(cfg.tld.clone()),
            php_version: version.to_string(),
            php_tag: tag.clone(),
            http_port: Some(http_port),
        };
        write_isolated_site_conf(paths, &req, &mut written)?;
    }

    let conf = isolated_conf_path(paths, site)?;
    Ok(IsolateResult {
        site: site.to_string(),
        php_version: Some(version.to_string()),
        conf_path: Some(conf.to_string_lossy().into_owned()),
        action: "isolated".into(),
        written,
        notes: vec![
            format!(
                "isolated {site}.{} → php{tag} (static socket; secured={secured_now})",
                cfg.tld
            ),
            "run ld_reload_nginx to apply".into(),
        ],
        refused: false,
    })
}

pub fn isolate_php(site: &str, version: &str) -> Result<IsolateResult, String> {
    isolate_php_at(&build_runtime_paths()?, site, version)
}

/// Remove isolated site conf under `nginx/sites/`. Never touches Herd nginx confs.
///
/// If the per-site conf also carries `BADAMI_SECURED=1`, we re-render the
/// conf as "secured only" instead of deleting it — the TLS listener and leaf
/// cert files stay in place so the site keeps serving over https while
/// falling back to the default FPM socket.
pub fn unisolate_site_at(paths: &RuntimePaths, site: &str) -> Result<IsolateResult, String> {
    validate_site_name(site)?;
    // Path-component-safe confinement (same helper as conf writer).
    let conf = isolated_conf_path(paths, site)?;

    if !conf.is_file() {
        return Ok(IsolateResult {
            site: site.to_string(),
            php_version: None,
            conf_path: Some(conf.to_string_lossy().into_owned()),
            action: "noop".into(),
            written: vec![],
            notes: vec![format!("no isolate conf for {site}")],
            refused: false,
        });
    }

    let content = fs::read_to_string(&conf).unwrap_or_default();
    let php_version = parse_isolated_version_from_conf(&content);
    let secured_marker = parse_secured_marker_from_conf(&content);
    let cfg = read_valet_config(paths);
    let http_port = parse_nginx_http_port(paths);

    let secured_now = secured_marker && tls::site_has_certs(paths, site, &cfg.tld);
    if secured_now {
        // Re-render without the isolated marker but with secured bits intact.
        let tls_paths = TlsPaths::from_runtime(paths);
        let opts = SiteConfOptions {
            site_name: site.to_string(),
            tld: cfg.tld.clone(),
            http_port,
            https_port: Some(DEFAULT_HTTPS_PORT),
            cert_path: Some(
                tls_paths
                    .site_cert(site, &cfg.tld)
                    .to_string_lossy()
                    .into_owned(),
            ),
            key_path: Some(
                tls_paths
                    .site_key(site, &cfg.tld)
                    .to_string_lossy()
                    .into_owned(),
            ),
            php_tag: None,
            php_version_display: None,
        };
        let mut written = Vec::new();
        write_site_conf(paths, &opts, &mut written).map(|_| ())?;
        return Ok(IsolateResult {
            site: site.to_string(),
            php_version,
            conf_path: Some(conf.to_string_lossy().into_owned()),
            action: "unisolated".into(),
            written,
            notes: vec![
                format!("removed isolate from {site} (secured conf kept)"),
                "run ld_reload_nginx to apply".into(),
            ],
            refused: false,
        });
    }

    fs::remove_file(&conf).map_err(|e| format!("remove isolate conf: {e}"))?;

    Ok(IsolateResult {
        site: site.to_string(),
        php_version,
        conf_path: Some(conf.to_string_lossy().into_owned()),
        action: "unisolated".into(),
        written: vec![],
        notes: vec![
            format!("removed isolate conf for {site}"),
            "site now uses default PHP socket via catch-all server".into(),
            "run ld_reload_nginx to apply".into(),
        ],
        refused: false,
    })
}

pub fn unisolate_site(site: &str) -> Result<IsolateResult, String> {
    unisolate_site_at(&build_runtime_paths()?, site)
}

// ── Open URL ────────────────────────────────────────────────────────

/// Pure wrapper over the DNS probe so tests can swap in a deterministic one.
/// The signature mirrors `(tld, loopback) -> healthy` so neither tests nor
/// the production call site need to construct a `DnsProbeResult`.
#[allow(dead_code)]
pub type DnsHealthProbe = dyn Fn(&str, &str) -> bool + Send + Sync;

/// Error prefix used when the gate refuses to return a URL — the frontend
/// looks for this literal to decide whether to show the "DNS unhealthy" dialog
/// with a *Open anyway* button that re-invokes with `force=true`.
pub const DNS_UNHEALTHY_PREFIX: &str = "DNS_UNHEALTHY:";

/// Default production probe: run the live DNS resolve + loopback check.
fn default_dns_probe(tld: &str, loopback: &str) -> bool {
    super::doctor::run_dns_probe(tld, loopback, None, false).healthy
}

#[allow(dead_code)]
pub fn open_site_url_at(paths: &RuntimePaths, site: &str) -> Result<OpenSiteUrlResult, String> {
    open_site_url_at_with_probe(paths, site, false, None, &default_dns_probe)
}

/// Identifier-aware / probe-injectable variant.
///
/// When `force` is false and the probe returns unhealthy, this returns an
/// `Err("DNS_UNHEALTHY: …")`. The UI distinguishes this from other errors and
/// can offer an *Open anyway* retry. `force=true` skips the probe entirely so
/// users can still open sites while debugging DNS (localhost + manual host
/// entries both work).
///
/// `https_port` controls the port used in the emitted URL when the site is
/// secured on disk (`BADAMI_SECURED=1` + both cert and key present). Passing
/// `None` falls back to [`DEFAULT_HTTPS_PORT`].
pub fn open_site_url_at_with_probe(
    paths: &RuntimePaths,
    site: &str,
    force: bool,
    https_port: Option<u16>,
    probe: &(dyn Fn(&str, &str) -> bool + Send + Sync),
) -> Result<OpenSiteUrlResult, String> {
    validate_site_name(site)?;
    let cfg = read_valet_config(paths);
    let http_port = parse_nginx_http_port(paths);
    let https_port = https_port.unwrap_or(DEFAULT_HTTPS_PORT);

    if !force && !probe(&cfg.tld, &cfg.loopback) {
        return Err(format!(
            "{} DNS probe for *.{} failed (expected loopback {}). Install DNS Mode B-lite (D1), use high-port resolver (D2), or disable browser secure DNS. Call ld_open_site_url with force=true to open anyway.",
            DNS_UNHEALTHY_PREFIX, cfg.tld, cfg.loopback
        ));
    }

    let (_, _, secured_marker, _) = read_site_conf_state(paths, site);
    let secured = secured_marker && tls::site_has_certs(paths, site, &cfg.tld);
    let url = site_url(site, &cfg.tld, http_port, https_port, secured);
    Ok(OpenSiteUrlResult {
        site: site.to_string(),
        tld: cfg.tld,
        http_port,
        https_port: if secured { Some(https_port) } else { None },
        secured,
        url,
    })
}

#[allow(dead_code)]
pub fn open_site_url(site: &str) -> Result<OpenSiteUrlResult, String> {
    open_site_url_at(&build_runtime_paths()?, site)
}

pub fn open_site_url_with_force(
    site: &str,
    force: bool,
    https_port: Option<u16>,
) -> Result<OpenSiteUrlResult, String> {
    open_site_url_at_with_probe(
        &build_runtime_paths()?,
        site,
        force,
        https_port,
        &default_dns_probe,
    )
}

// ── Secure / unsecure (Phase B TLS) ────────────────────────────────

/// Secure a site: generate a leaf cert (CA auto-created on first run) and
/// write / rewrite the per-site nginx conf so it listens on `https_port`
/// (SSL) plus an HTTP → HTTPS redirect on `http_port`.
///
/// Preserves any pre-existing `ISOLATED_PHP_VERSION=…` isolate state. On
/// failure the leaf cert files + the conf are left in whatever state they
/// were in before — callers can retry.
pub fn secure_site_at(
    paths: &RuntimePaths,
    site: &str,
    https_port: Option<u16>,
) -> Result<SecureSiteCommandResult, String> {
    validate_site_name(site)?;
    let cfg = read_valet_config(paths);
    validate_tld(&cfg.tld)?;
    let http_port = parse_nginx_http_port(paths);
    let https_port = https_port.unwrap_or(DEFAULT_HTTPS_PORT);

    // 1. Issue certs under config/valet/Certificates/.
    let tls_result = tls::secure_site_at(paths, site, &cfg.tld)?;
    let cert_path = tls_result.cert_path.clone();
    let key_path = tls_result.key_path.clone();

    // 2. Rewrite the per-site conf preserving any existing isolate state.
    let (prev_isolated, prev_version, _, _) = read_site_conf_state(paths, site);
    let (php_tag, php_version_display) = if prev_isolated {
        let v = prev_version
            .clone()
            .ok_or_else(|| "secured: isolated conf missing version marker".to_string())?;
        validate_php_version_display(&v)?;
        let tag = version_to_tag(&v)?;
        (Some(tag), Some(v))
    } else {
        (None, None)
    };
    let opts = SiteConfOptions {
        site_name: site.to_string(),
        tld: cfg.tld.clone(),
        http_port,
        https_port: Some(https_port),
        cert_path: cert_path.clone(),
        key_path: key_path.clone(),
        php_tag,
        php_version_display,
    };

    let mut written: Vec<String> = tls_result.written.clone();
    let conf = write_site_conf(paths, &opts, &mut written)?;

    let mut notes = tls_result.notes.clone();
    notes.push(format!(
        "wrote merged https conf for {site}.{} on :{https_port}",
        cfg.tld
    ));
    notes.push(
        "run ld_tls_trust_ca (admin) if you have not yet trusted the Badami CA".into(),
    );
    notes.push("run ld_reload_nginx to apply".into());

    Ok(SecureSiteCommandResult {
        site: site.to_string(),
        tld: cfg.tld,
        action: "secured".into(),
        secured: true,
        cert_path,
        key_path,
        conf_path: Some(conf.to_string_lossy().into_owned()),
        written,
        notes,
    })
}

pub fn secure_site(site: &str, https_port: Option<u16>) -> Result<SecureSiteCommandResult, String> {
    secure_site_at(&build_runtime_paths()?, site, https_port)
}

/// Unsecure a site: remove the leaf cert + key files (never the CA) and
/// rewrite / remove the per-site nginx conf.
///
/// If the site is still isolated, the conf is rewritten as isolated-only. If
/// neither isolated nor secured, the per-site conf is removed outright and
/// the site falls back to the catch-all server.
pub fn unsecure_site_at(
    paths: &RuntimePaths,
    site: &str,
) -> Result<SecureSiteCommandResult, String> {
    validate_site_name(site)?;
    let cfg = read_valet_config(paths);
    validate_tld(&cfg.tld)?;
    let http_port = parse_nginx_http_port(paths);

    // 1. Delete leaf cert + key (idempotent).
    let tls_result = tls::unsecure_site_at(paths, site, &cfg.tld)?;
    let mut written = tls_result.written.clone();
    let mut notes = tls_result.notes.clone();

    // 2. Rewrite / remove the per-site conf.
    let (prev_isolated, prev_version, _, _) = read_site_conf_state(paths, site);
    let conf_path = isolated_conf_path(paths, site)?;
    let conf_removed_or_updated = if prev_isolated {
        let v = prev_version
            .ok_or_else(|| "unsecure: isolated conf missing version marker".to_string())?;
        validate_php_version_display(&v)?;
        let tag = version_to_tag(&v)?;
        let opts = SiteConfOptions {
            site_name: site.to_string(),
            tld: cfg.tld.clone(),
            http_port,
            https_port: None,
            cert_path: None,
            key_path: None,
            php_tag: Some(tag),
            php_version_display: Some(v),
        };
        write_site_conf(paths, &opts, &mut written)?;
        notes.push("conf rewritten as isolated-only (TLS removed)".into());
        Some(conf_path.to_string_lossy().into_owned())
    } else if conf_path.is_file() {
        fs::remove_file(&conf_path)
            .map_err(|e| format!("remove per-site conf: {e}"))?;
        notes.push(format!(
            "removed per-site conf {} (site falls back to catch-all)",
            conf_path.display()
        ));
        Some(conf_path.to_string_lossy().into_owned())
    } else {
        notes.push("no per-site conf existed; nothing to remove".into());
        None
    };

    notes.push("run ld_reload_nginx to apply".into());

    Ok(SecureSiteCommandResult {
        site: site.to_string(),
        tld: cfg.tld,
        action: "unsecured".into(),
        secured: false,
        cert_path: None,
        key_path: None,
        conf_path: conf_removed_or_updated,
        written,
        notes,
    })
}

pub fn unsecure_site(site: &str) -> Result<SecureSiteCommandResult, String> {
    unsecure_site_at(&build_runtime_paths()?, site)
}

// ── Nginx reload ────────────────────────────────────────────────────

fn find_nginx_binary() -> Option<PathBuf> {
    if let Ok(report) = discover() {
        if let Some(ref b) = report.herd.nginx_binary {
            let p = PathBuf::from(b);
            if p.is_file() {
                return Some(p);
            }
        }
        if let Some(c) = report.candidates.iter().find(|c| c.role == "nginx") {
            let p = PathBuf::from(&c.path);
            if p.is_file() {
                return Some(p);
            }
        }
    }

    let suffix = preferred_suffix();
    let candidates = [
        format!("/Applications/Herd.app/Contents/Resources/nginx-{suffix}"),
        "/Applications/Herd.app/Contents/Resources/nginx-arm64".into(),
        "/Applications/Herd.app/Contents/Resources/nginx-x86".into(),
        "/opt/homebrew/bin/nginx".into(),
        "/usr/local/bin/nginx".into(),
        "/usr/bin/nginx".into(),
    ];
    for c in candidates {
        let p = PathBuf::from(&c);
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

fn run_nginx(
    binary: &Path,
    conf: &Path,
    prefix: &Path,
    signal_args: &[&str],
) -> (bool, String, String) {
    let conf_s = conf.to_string_lossy();
    let prefix_s = prefix.to_string_lossy();
    let mut args: Vec<&str> = vec!["-c", conf_s.as_ref(), "-p", prefix_s.as_ref()];
    args.extend_from_slice(signal_args);

    let output = Command::new(binary).args(&args).output();
    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
            let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
            (out.status.success(), stdout, stderr)
        }
        Err(e) => (false, String::new(), format!("spawn failed: {e}")),
    }
}

/// Require Badami-owned pid file: under `local-dev/pids/`, basename `nginx.pid`.
fn nginx_pid_path(paths: &RuntimePaths) -> Result<PathBuf, String> {
    let pids = PathBuf::from(&paths.pids);
    let pid = ensure_path_under_root(&pids, Path::new("nginx.pid"))?;
    if pid.file_name().and_then(|s| s.to_str()) != Some("nginx.pid") {
        return Err("refusing unexpected nginx pid basename".into());
    }
    Ok(pid)
}

/// Guard before HUP: pid file must be under local-dev/pids and process alive.
fn check_nginx_pid_for_reload(paths: &RuntimePaths, notes: &mut Vec<String>) -> Result<(), String> {
    let pid_path = nginx_pid_path(paths)?;
    let Some(pid) = read_pid_file(&pid_path) else {
        return Err(
            "nginx.pid missing under local-dev/pids — start nginx first (ld_service_start nginx)"
                .into(),
        );
    };
    if !pid_is_alive(pid) {
        return Err(format!(
            "nginx.pid={pid} is dead/stale — start nginx first (ld_service_start nginx)"
        ));
    }
    notes.push(format!(
        "pid gate: nginx.pid={pid} alive under local-dev/pids"
    ));
    Ok(())
}

/// `nginx -t` then `nginx -s reload` against Badami-generated conf.
///
/// Safety: Badami `-c`/`-p` only; pid file must live under `local-dev/pids/nginx.pid`
/// and refer to a live process before HUP (avoids signaling foreign masters).
pub fn reload_nginx_at(paths: &RuntimePaths) -> Result<ReloadNginxResult, String> {
    let conf = PathBuf::from(&paths.nginx).join("nginx.conf");
    let prefix = PathBuf::from(&paths.nginx);
    let mut notes = Vec::new();

    if !conf.is_file() {
        return Ok(ReloadNginxResult {
            ok: false,
            test_ok: false,
            reloaded: false,
            binary: None,
            conf: Some(conf.to_string_lossy().into_owned()),
            stdout: String::new(),
            stderr: String::new(),
            notes: vec!["nginx.conf missing — run ld_generate_configs first".into()],
        });
    }

    // Pid ownership gate before any signal.
    if let Err(e) = check_nginx_pid_for_reload(paths, &mut notes) {
        return Ok(ReloadNginxResult {
            ok: false,
            test_ok: false,
            reloaded: false,
            binary: None,
            conf: Some(conf.to_string_lossy().into_owned()),
            stdout: String::new(),
            stderr: String::new(),
            notes: {
                notes.push(e);
                notes
            },
        });
    }

    let Some(binary) = find_nginx_binary() else {
        return Ok(ReloadNginxResult {
            ok: false,
            test_ok: false,
            reloaded: false,
            binary: None,
            conf: Some(conf.to_string_lossy().into_owned()),
            stdout: String::new(),
            stderr: String::new(),
            notes: {
                notes.push("nginx binary not found (Herd Resources / Homebrew / PATH)".into());
                notes
            },
        });
    };

    let (test_ok, t_out, t_err) = run_nginx(&binary, &conf, &prefix, &["-t"]);
    notes.push(if test_ok {
        "nginx -t: ok".into()
    } else {
        format!("nginx -t: failed — {}", t_err.trim())
    });

    if !test_ok {
        return Ok(ReloadNginxResult {
            ok: false,
            test_ok: false,
            reloaded: false,
            binary: Some(binary.to_string_lossy().into_owned()),
            conf: Some(conf.to_string_lossy().into_owned()),
            stdout: t_out,
            stderr: t_err,
            notes,
        });
    }

    let (reload_ok, r_out, r_err) = run_nginx(&binary, &conf, &prefix, &["-s", "reload"]);
    notes.push(if reload_ok {
        "nginx -s reload: ok".into()
    } else {
        format!(
            "nginx -s reload: failed ({}) — is nginx running? try ld_service_restart nginx",
            r_err.trim()
        )
    });

    Ok(ReloadNginxResult {
        ok: reload_ok,
        test_ok: true,
        reloaded: reload_ok,
        binary: Some(binary.to_string_lossy().into_owned()),
        conf: Some(conf.to_string_lossy().into_owned()),
        stdout: format!("{t_out}{r_out}"),
        stderr: format!("{t_err}{r_err}"),
        notes,
    })
}

pub fn reload_nginx() -> Result<ReloadNginxResult, String> {
    reload_nginx_at(&build_runtime_paths()?)
}

// ── Tauri commands ──────────────────────────────────────────────────

#[tauri::command]
pub async fn ld_list_sites(https_port: Option<u16>) -> Result<ListSitesResult, String> {
    tokio::task::spawn_blocking(move || list_sites(https_port))
        .await
        .map_err(|e| format!("ld_list_sites task failed: {e}"))?
}

#[tauri::command]
pub async fn ld_park(path: String) -> Result<ParkResult, String> {
    tokio::task::spawn_blocking(move || park_path(&path))
        .await
        .map_err(|e| format!("ld_park task failed: {e}"))?
}

#[tauri::command]
pub async fn ld_unpark(path: String) -> Result<ParkResult, String> {
    tokio::task::spawn_blocking(move || unpark_path(&path))
        .await
        .map_err(|e| format!("ld_unpark task failed: {e}"))?
}

#[tauri::command]
pub async fn ld_link(site: String, path: String) -> Result<LinkResult, String> {
    tokio::task::spawn_blocking(move || link_site(&site, &path))
        .await
        .map_err(|e| format!("ld_link task failed: {e}"))?
}

#[tauri::command]
pub async fn ld_unlink(site: String) -> Result<LinkResult, String> {
    tokio::task::spawn_blocking(move || unlink_site(&site))
        .await
        .map_err(|e| format!("ld_unlink task failed: {e}"))?
}

#[tauri::command]
pub async fn ld_isolate_php(site: String, version: String) -> Result<IsolateResult, String> {
    tokio::task::spawn_blocking(move || isolate_php(&site, &version))
        .await
        .map_err(|e| format!("ld_isolate_php task failed: {e}"))?
}

#[tauri::command]
pub async fn ld_unisolate(site: String) -> Result<IsolateResult, String> {
    tokio::task::spawn_blocking(move || unisolate_site(&site))
        .await
        .map_err(|e| format!("ld_unisolate task failed: {e}"))?
}

#[tauri::command]
pub async fn ld_open_site_url(
    site: String,
    force: Option<bool>,
    https_port: Option<u16>,
) -> Result<OpenSiteUrlResult, String> {
    let force = force.unwrap_or(false);
    tokio::task::spawn_blocking(move || open_site_url_with_force(&site, force, https_port))
        .await
        .map_err(|e| format!("ld_open_site_url task failed: {e}"))?
}

#[tauri::command]
pub async fn ld_secure(
    site: String,
    https_port: Option<u16>,
) -> Result<SecureSiteCommandResult, String> {
    tokio::task::spawn_blocking(move || secure_site(&site, https_port))
        .await
        .map_err(|e| format!("ld_secure task failed: {e}"))?
}

#[tauri::command]
pub async fn ld_unsecure(site: String) -> Result<SecureSiteCommandResult, String> {
    tokio::task::spawn_blocking(move || unsecure_site(&site))
        .await
        .map_err(|e| format!("ld_unsecure task failed: {e}"))?
}

#[tauri::command]
pub async fn ld_reload_nginx() -> Result<ReloadNginxResult, String> {
    tokio::task::spawn_blocking(reload_nginx)
        .await
        .map_err(|e| format!("ld_reload_nginx task failed: {e}"))?
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::discovery::runtime_paths_from_root;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_tmp(label: &str) -> PathBuf {
        let n = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        std::env::temp_dir().join(format!("badami-sites-{label}-{n}"))
    }

    /// Isolated local-dev tree under /tmp — never touches Application Support.
    struct TempLocalDev {
        root: PathBuf,
        paths: RuntimePaths,
    }

    impl TempLocalDev {
        fn new(label: &str) -> Self {
            let root = unique_tmp(label);
            let _ = fs::remove_dir_all(&root);
            let paths = runtime_paths_from_root(root.clone());
            for sub in [
                &paths.config_valet,
                &paths.nginx,
                &format!("{}/sites", paths.nginx),
                &paths.pids,
                &paths.socks,
                &paths.logs,
            ] {
                fs::create_dir_all(sub).unwrap();
            }
            fs::create_dir_all(sites_dir(&paths)).unwrap();
            // Minimal valet config
            let mut written = Vec::new();
            write_valet_config(&paths, "test", &[], "127.0.0.1", &mut written).unwrap();
            // Minimal badami.conf for http_port parsing
            fs::write(
                PathBuf::from(&paths.nginx).join("badami.conf"),
                "listen 127.0.0.1:8080;\n",
            )
            .unwrap();
            Self { root, paths }
        }
    }

    impl Drop for TempLocalDev {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn site_url_mode_a_includes_port() {
        assert_eq!(
            site_url("office", "test", 8080, 8443, false),
            "http://office.test:8080"
        );
        assert_eq!(site_url("office", "test", 80, 8443, false), "http://office.test");
        assert_eq!(
            site_url("office_oku", "test", 9090, 8443, false),
            "http://office_oku.test:9090"
        );
        // Secured → https, port omitted for :443, included for 8443.
        assert_eq!(
            site_url("office", "test", 8080, 8443, true),
            "https://office.test:8443"
        );
        assert_eq!(
            site_url("office", "test", 80, 443, true),
            "https://office.test"
        );
    }

    #[test]
    fn version_to_tag_maps_display() {
        assert_eq!(version_to_tag("7.4").unwrap(), "74");
        assert_eq!(version_to_tag("8.4").unwrap(), "84");
        assert!(version_to_tag("bad").is_err());
        assert!(version_to_tag("../x").is_err());
        // Multi-digit major/minor rejected (Herd tags are two digits).
        assert!(version_to_tag("10.0").is_err());
        assert!(version_to_tag("7.10").is_err());
    }

    #[test]
    fn validate_site_name_used_on_link() {
        let tmp = TempLocalDev::new("validate");
        assert!(link_site_at(&tmp.paths, "../etc", "/tmp").is_err());
        assert!(link_site_at(&tmp.paths, "foo/bar", "/tmp").is_err());
        assert!(unlink_site_at(&tmp.paths, "bad\nname").is_err());
        assert!(isolate_php_at(&tmp.paths, "a;b", "7.4").is_err());
    }

    #[test]
    fn link_rejects_file_target() {
        let tmp = TempLocalDev::new("link-file");
        let file = unique_tmp("not-a-dir");
        fs::write(&file, b"x").unwrap();
        let err = link_site_at(&tmp.paths, "badlink", &file.to_string_lossy()).unwrap_err();
        assert!(
            err.contains("directory"),
            "expected directory requirement: {err}"
        );
        let _ = fs::remove_file(&file);
    }

    #[test]
    fn parse_isolated_version_comment() {
        let c = "# ISOLATED_PHP_VERSION=7.4\nserver {}\n";
        assert_eq!(
            parse_isolated_version_from_conf(c).as_deref(),
            Some("7.4")
        );
        assert!(parse_isolated_version_from_conf("server {}").is_none());
    }

    #[test]
    fn park_unpark_roundtrip_temp_root() {
        let tmp = TempLocalDev::new("park");
        let park_dir = unique_tmp("park-src");
        fs::create_dir_all(&park_dir).unwrap();
        let child = park_dir.join("demo_site_xyz");
        fs::create_dir_all(&child).unwrap();

        let res = park_path_at(&tmp.paths, &park_dir.to_string_lossy()).expect("park");
        assert_eq!(res.action, "parked");
        let norm = normalize_park_path(&park_dir.to_string_lossy());
        assert!(res.park_paths.iter().any(|p| p == &norm));

        let listed = list_sites_at(&tmp.paths, None).expect("list");
        assert!(listed.park_paths.iter().any(|p| p == &norm));
        assert!(
            listed
                .sites
                .iter()
                .any(|s| s.name == "demo_site_xyz" && s.kind == "parked"),
            "expected demo_site_xyz in {:?}",
            listed.sites.iter().map(|s| &s.name).collect::<Vec<_>>()
        );

        let un = unpark_path_at(&tmp.paths, &park_dir.to_string_lossy()).expect("unpark");
        assert_eq!(un.action, "unparked");
        // Project tree left intact
        assert!(park_dir.is_dir());
        assert!(child.is_dir());
        let _ = fs::remove_dir_all(&park_dir);
    }

    #[test]
    fn link_unlink_roundtrip_temp_root() {
        let tmp = TempLocalDev::new("link");
        let target = unique_tmp("link-target");
        fs::create_dir_all(&target).unwrap();

        let res = link_site_at(&tmp.paths, "badami_link_test", &target.to_string_lossy())
            .expect("link");
        assert_eq!(res.action, "linked");
        assert!(Path::new(&res.link_path).symlink_metadata().is_ok());

        let listed = list_sites_at(&tmp.paths, None).expect("list");
        let site = listed
            .sites
            .iter()
            .find(|s| s.name == "badami_link_test")
            .expect("linked site listed");
        assert_eq!(site.kind, "linked");

        let un = unlink_site_at(&tmp.paths, "badami_link_test").expect("unlink");
        assert_eq!(un.action, "unlinked");
        assert!(target.is_dir());
        let _ = fs::remove_dir_all(&target);
    }

    #[test]
    fn isolate_refuses_missing_php_or_writes_when_available() {
        let tmp = TempLocalDev::new("iso-refuse");
        // 5.0 almost certainly missing from discovery inventory
        match isolate_php_at(&tmp.paths, "office", "5.0") {
            Ok(r) => {
                assert!(r.refused, "should refuse unavailable php: {:?}", r.notes);
                assert_eq!(r.action, "refused");
            }
            Err(e) => {
                eprintln!("isolate_php skipped: {e}");
            }
        }
    }

    #[test]
    fn open_site_url_respects_port_temp() {
        let tmp = TempLocalDev::new("url");
        // Inject a healthy probe so the test does not depend on the host's
        // live resolver — this unit is about URL composition, not DNS.
        let healthy = |_tld: &str, _lo: &str| true;
        let res = open_site_url_at_with_probe(&tmp.paths, "office", false, None, &healthy).expect("url");
        assert_eq!(res.url, "http://office.test:8080");
        assert_eq!(res.http_port, 8080);

        // Port 80 omits :80
        fs::write(
            PathBuf::from(&tmp.paths.nginx).join("badami.conf"),
            "listen 127.0.0.1:80;\n",
        )
        .unwrap();
        let res80 =
            open_site_url_at_with_probe(&tmp.paths, "office", false, None, &healthy).expect("url80");
        assert_eq!(res80.url, "http://office.test");
    }

    #[test]
    fn unisolate_noop_missing_temp() {
        let tmp = TempLocalDev::new("uniso");
        let res = unisolate_site_at(&tmp.paths, "zzz_nonexistent_site_xyz").expect("unisolate");
        assert_eq!(res.action, "noop");
    }

    #[test]
    fn isolate_unisolate_temp_when_php74_available() {
        let report = match discover() {
            Ok(r) => r,
            Err(_) => return,
        };
        let has_74 = report
            .herd
            .php_versions
            .iter()
            .any(|v| v.version == "7.4" && v.available);
        if !has_74 {
            return;
        }

        let tmp = TempLocalDev::new("iso74");
        let res = isolate_php_at(&tmp.paths, "badami_iso_test", "7.4").expect("isolate");
        if res.refused {
            return;
        }
        assert_eq!(res.action, "isolated");
        let conf = res.conf_path.expect("conf");
        // Conf lives under temp root, not Application Support
        assert!(conf.starts_with(&tmp.root.to_string_lossy().as_ref()));
        assert!(Path::new(&conf).is_file());
        let body = fs::read_to_string(&conf).unwrap();
        assert!(body.contains("ISOLATED_PHP_VERSION=7.4"));
        // Quoted since c050354 — socket paths under "Application Support" contain
        // a space, so `fastcgi_pass unix:…` unquoted is a config error.
        assert!(body.contains("fastcgi_pass \"unix:"));
        assert!(!body.contains("js_import"));

        let un = unisolate_site_at(&tmp.paths, "badami_iso_test").expect("unisolate");
        assert_eq!(un.action, "unisolated");
        assert!(!Path::new(&conf).exists());
    }

    #[test]
    fn reload_refuses_without_live_pid() {
        let tmp = TempLocalDev::new("reload");
        // Write a dummy nginx.conf so we get past missing-conf
        fs::write(
            PathBuf::from(&tmp.paths.nginx).join("nginx.conf"),
            "events {}\nhttp {}\n",
        )
        .unwrap();
        let res = reload_nginx_at(&tmp.paths).expect("reload");
        assert!(!res.ok);
        assert!(!res.reloaded);
        assert!(
            res.notes.iter().any(|n| n.contains("nginx.pid")),
            "expected pid gate note: {:?}",
            res.notes
        );
    }

    #[test]
    fn isolated_conf_path_rejects_traversal_name() {
        let tmp = TempLocalDev::new("trav");
        // validate_site_name catches this at API boundary; ensure helper also safe
        assert!(isolated_conf_path(&tmp.paths, "../pwned").is_err());
    }

    #[test]
    fn open_site_url_dns_gate_unhealthy_without_force() {
        let tmp = TempLocalDev::new("dns-gate-unh");
        let probe = |_tld: &str, _lo: &str| false;
        let err = open_site_url_at_with_probe(&tmp.paths, "office", false, None, &probe).unwrap_err();
        assert!(
            err.starts_with(DNS_UNHEALTHY_PREFIX),
            "expected DNS_UNHEALTHY prefix, got {err}"
        );
        assert!(err.contains("force=true"));
    }

    #[test]
    fn open_site_url_dns_gate_force_bypasses_probe() {
        let tmp = TempLocalDev::new("dns-gate-force");
        // Probe would say unhealthy; force=true skips it entirely.
        let probe = |_tld: &str, _lo: &str| false;
        let res = open_site_url_at_with_probe(&tmp.paths, "office", true, None, &probe).unwrap();
        assert_eq!(res.site, "office");
        assert_eq!(res.tld, "test");
        assert!(res.url.starts_with("http://office.test"));
    }

    #[test]
    fn open_site_url_dns_gate_healthy_returns_url() {
        let tmp = TempLocalDev::new("dns-gate-ok");
        let probe = |_tld: &str, _lo: &str| true;
        let res = open_site_url_at_with_probe(&tmp.paths, "office", false, None, &probe).unwrap();
        assert!(res.url.starts_with("http://office.test"));
    }

    #[test]
    fn open_site_url_dns_gate_rejects_invalid_site_regardless_of_force() {
        let tmp = TempLocalDev::new("dns-gate-bad");
        let probe = |_tld: &str, _lo: &str| true;
        assert!(open_site_url_at_with_probe(&tmp.paths, "../etc", true, None, &probe).is_err());
        assert!(open_site_url_at_with_probe(&tmp.paths, "bad name", false, None, &probe).is_err());
    }

    // ── Phase B TLS wiring ─────────────────────────────────────────

    #[test]
    fn secure_site_writes_merged_conf_and_lists_secured() {
        let tmp = TempLocalDev::new("secure-merged");
        // Park a dir so the site shows up in list_sites.
        let park = unique_tmp("secure-src");
        fs::create_dir_all(park.join("office")).unwrap();
        park_path_at(&tmp.paths, &park.to_string_lossy()).unwrap();

        let res = secure_site_at(&tmp.paths, "office", Some(8443)).expect("secure");
        assert_eq!(res.action, "secured");
        assert!(res.secured);
        let conf_path = res.conf_path.unwrap();
        let body = fs::read_to_string(&conf_path).unwrap();
        // Marker + two server blocks (https + http redirect).
        assert!(body.contains("# BADAMI_SECURED=1"));
        assert!(body.contains("# BADAMI_SITE=office.test"));
        assert!(body.contains("listen 127.0.0.1:8443 ssl"));
        assert!(body.contains("ssl_certificate     \""));
        assert!(body.contains("ssl_certificate_key \""));
        assert!(body.contains("return 301 https://office.test:8443"));
        assert!(body.contains("listen 127.0.0.1:8080;"));
        // No isolated marker because the site wasn't previously isolated.
        assert!(!body.contains("ISOLATED_PHP_VERSION="));

        // list_sites must flip `secured` on the office entry and use https.
        let listed = list_sites_at(&tmp.paths, Some(8443)).unwrap();
        let site = listed
            .sites
            .iter()
            .find(|s| s.name == "office")
            .expect("office listed");
        assert!(site.secured, "secured must reflect cert+conf state");
        assert_eq!(site.url, "https://office.test:8443");

        // ld_open_site_url with injected healthy probe must emit https url.
        let healthy = |_tld: &str, _lo: &str| true;
        let open_res =
            open_site_url_at_with_probe(&tmp.paths, "office", false, Some(8443), &healthy).unwrap();
        assert!(open_res.secured);
        assert_eq!(open_res.https_port, Some(8443));
        assert_eq!(open_res.url, "https://office.test:8443");
    }

    #[test]
    fn secure_then_isolate_merges_both_blocks() {
        let report = match discover() {
            Ok(r) => r,
            Err(_) => return,
        };
        let has_74 = report
            .herd
            .php_versions
            .iter()
            .any(|v| v.version == "7.4" && v.available);
        if !has_74 {
            // Skip when the host does not have php 7.4 installed.
            return;
        }

        let tmp = TempLocalDev::new("secure-plus-isolate");
        // Secure first.
        let secured = secure_site_at(&tmp.paths, "office", Some(8443)).expect("secure");
        assert!(secured.secured);
        let conf_path = secured.conf_path.unwrap();
        // Then isolate — merged conf must keep both markers.
        let iso = isolate_php_at(&tmp.paths, "office", "7.4").expect("isolate");
        assert_eq!(iso.action, "isolated");
        let body = fs::read_to_string(&conf_path).unwrap();
        assert!(body.contains("# ISOLATED_PHP_VERSION=7.4"));
        assert!(body.contains("# BADAMI_SECURED=1"));
        assert!(body.contains("listen 127.0.0.1:8443 ssl"));
        // Isolated FPM socket is wired into the https server block.
        assert!(body.contains("php74.sock"));
        // Still has the http redirect.
        assert!(body.contains("return 301 https://office.test:8443"));
    }

    #[test]
    fn unsecure_removes_leaf_and_rewrites_conf_to_plain() {
        let tmp = TempLocalDev::new("unsecure-plain");
        // Secure a site first so there's something to remove.
        let _ = secure_site_at(&tmp.paths, "office", Some(8443)).unwrap();
        let tls_paths = tls::TlsPaths::from_runtime(&tmp.paths);
        let crt_before = tls_paths.site_cert("office", "test");
        let key_before = tls_paths.site_key("office", "test");
        assert!(crt_before.is_file() && key_before.is_file());

        // Add an unrelated file under Certificates/ to assert unsecure never
        // touches anything other than the two files it owns.
        let foreign = tls_paths.certificates_dir.join("foreign.test.crt");
        fs::write(&foreign, b"not ours").unwrap();

        let res = unsecure_site_at(&tmp.paths, "office").expect("unsecure");
        assert_eq!(res.action, "unsecured");
        assert!(!res.secured);
        // Leaf files gone; foreign file untouched.
        assert!(!crt_before.is_file());
        assert!(!key_before.is_file());
        assert!(foreign.is_file(), "unrelated file must survive unsecure");

        // CA key + cert untouched.
        assert!(tls_paths.ca_cert.is_file());
        assert!(tls_paths.ca_key.is_file());

        // Per-site conf removed outright (no isolate markers left).
        let conf = isolated_conf_path(&tmp.paths, "office").unwrap();
        assert!(!conf.is_file());

        // Second call is idempotent.
        let again = unsecure_site_at(&tmp.paths, "office").unwrap();
        assert_eq!(again.action, "unsecured");
        assert!(again.written.is_empty());
    }

    #[test]
    fn unsecure_keeps_isolate_when_both_present() {
        let report = match discover() {
            Ok(r) => r,
            Err(_) => return,
        };
        if !report
            .herd
            .php_versions
            .iter()
            .any(|v| v.version == "7.4" && v.available)
        {
            return;
        }
        let tmp = TempLocalDev::new("unsecure-keep-iso");
        isolate_php_at(&tmp.paths, "office", "7.4").expect("isolate");
        secure_site_at(&tmp.paths, "office", Some(8443)).expect("secure");

        let res = unsecure_site_at(&tmp.paths, "office").expect("unsecure");
        assert_eq!(res.action, "unsecured");
        let conf = isolated_conf_path(&tmp.paths, "office").unwrap();
        assert!(conf.is_file(), "conf must survive — isolate still active");
        let body = fs::read_to_string(&conf).unwrap();
        assert!(body.contains("# ISOLATED_PHP_VERSION=7.4"));
        assert!(!body.contains("# BADAMI_SECURED=1"));
        assert!(!body.contains("listen 127.0.0.1:8443 ssl"));
        assert!(body.contains("php74.sock"));
    }

    #[test]
    fn secure_rejects_bad_site_name() {
        let tmp = TempLocalDev::new("secure-bad-name");
        assert!(secure_site_at(&tmp.paths, "../etc", Some(8443)).is_err());
        assert!(secure_site_at(&tmp.paths, "a b", None).is_err());
    }
}
