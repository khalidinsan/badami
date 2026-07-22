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
    write_isolated_site_conf, write_valet_config, IsolatedSiteRequest,
};
use super::discovery::{build_runtime_paths, discover, preferred_suffix, RuntimePaths};
use super::import_herd::normalize_park_path;
use super::mariadb_guard::{pid_is_alive, read_pid_file};
use super::service_specs::parse_nginx_http_port;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::os::unix::fs::symlink;
use std::path::{Path, PathBuf};
use std::process::Command;

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
    pub url: String,
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

/// Build site URL respecting Mode A http_port (omit port when 80).
pub fn site_url(name: &str, tld: &str, http_port: u16) -> String {
    let host = format!("{name}.{tld}");
    if http_port == 80 {
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

fn read_isolation(paths: &RuntimePaths, site: &str) -> (bool, Option<String>, Option<String>) {
    let Ok(conf) = isolated_conf_path(paths, site) else {
        return (false, None, None);
    };
    if !conf.is_file() {
        return (false, None, None);
    }
    let content = fs::read_to_string(&conf).unwrap_or_default();
    let ver = parse_isolated_version_from_conf(&content);
    (true, ver, Some(conf.to_string_lossy().into_owned()))
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
pub fn list_sites_at(paths: &RuntimePaths) -> Result<ListSitesResult, String> {
    let cfg = read_valet_config(paths);
    let http_port = parse_nginx_http_port(paths);
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
                let (isolated, php_version, conf_path) = read_isolation(paths, &name);
                by_name.insert(
                    name.clone(),
                    SiteInfo {
                        name: name.clone(),
                        tld: cfg.tld.clone(),
                        url: site_url(&name, &cfg.tld, http_port),
                        path: target,
                        kind: "linked".into(),
                        php_version,
                        isolated,
                        secured: false,
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
            let (isolated, php_version, conf_path) = read_isolation(paths, &name);
            by_name.insert(
                name.clone(),
                SiteInfo {
                    name: name.clone(),
                    tld: cfg.tld.clone(),
                    url: site_url(&name, &cfg.tld, http_port),
                    path: path_str,
                    kind: "parked".into(),
                    php_version,
                    isolated,
                    secured: false,
                    conf_path,
                    park_path: Some(park.clone()),
                },
            );
        }
    }

    // 3) Isolated confs without a matching park/link entry (orphan isolates)
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
                by_name.insert(
                    name.to_string(),
                    SiteInfo {
                        name: name.to_string(),
                        tld: cfg.tld.clone(),
                        url: site_url(name, &cfg.tld, http_port),
                        path: String::new(),
                        kind: "parked".into(),
                        php_version,
                        isolated: true,
                        secured: false,
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
        "Found {} site(s) across {} park path(s); http_port={http_port}",
        sites.len(),
        cfg.paths.len()
    ));

    Ok(ListSitesResult {
        sites,
        park_paths: cfg.paths,
        tld: cfg.tld,
        loopback: cfg.loopback,
        http_port,
        notes,
    })
}

pub fn list_sites() -> Result<ListSitesResult, String> {
    list_sites_at(&build_runtime_paths()?)
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

    symlink(&abs_target, &link_path).map_err(|e| {
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
    let req = IsolatedSiteRequest {
        site_name: site.to_string(),
        tld: Some(cfg.tld.clone()),
        php_version: version.to_string(),
        php_tag: tag.clone(),
        http_port: Some(http_port),
    };
    write_isolated_site_conf(paths, &req, &mut written)?;

    let conf = isolated_conf_path(paths, site)?;
    Ok(IsolateResult {
        site: site.to_string(),
        php_version: Some(version.to_string()),
        conf_path: Some(conf.to_string_lossy().into_owned()),
        action: "isolated".into(),
        written,
        notes: vec![
            format!("isolated {site}.{} → php{tag} (static socket)", cfg.tld),
            "run ld_reload_nginx to apply".into(),
        ],
        refused: false,
    })
}

pub fn isolate_php(site: &str, version: &str) -> Result<IsolateResult, String> {
    isolate_php_at(&build_runtime_paths()?, site, version)
}

/// Remove isolated site conf under `nginx/sites/`. Never touches Herd nginx confs.
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

    let php_version = fs::read_to_string(&conf)
        .ok()
        .and_then(|c| parse_isolated_version_from_conf(&c));

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

pub fn open_site_url_at(paths: &RuntimePaths, site: &str) -> Result<OpenSiteUrlResult, String> {
    validate_site_name(site)?;
    let cfg = read_valet_config(paths);
    let http_port = parse_nginx_http_port(paths);
    let url = site_url(site, &cfg.tld, http_port);
    Ok(OpenSiteUrlResult {
        site: site.to_string(),
        tld: cfg.tld,
        http_port,
        url,
    })
}

pub fn open_site_url(site: &str) -> Result<OpenSiteUrlResult, String> {
    open_site_url_at(&build_runtime_paths()?, site)
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
pub async fn ld_list_sites() -> Result<ListSitesResult, String> {
    tokio::task::spawn_blocking(list_sites)
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
pub async fn ld_open_site_url(site: String) -> Result<OpenSiteUrlResult, String> {
    tokio::task::spawn_blocking(move || open_site_url(&site))
        .await
        .map_err(|e| format!("ld_open_site_url task failed: {e}"))?
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
        assert_eq!(site_url("office", "test", 8080), "http://office.test:8080");
        assert_eq!(site_url("office", "test", 80), "http://office.test");
        assert_eq!(
            site_url("office_oku", "test", 9090),
            "http://office_oku.test:9090"
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

        let listed = list_sites_at(&tmp.paths).expect("list");
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

        let listed = list_sites_at(&tmp.paths).expect("list");
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
        let res = open_site_url_at(&tmp.paths, "office").expect("url");
        assert_eq!(res.url, "http://office.test:8080");
        assert_eq!(res.http_port, 8080);

        // Port 80 omits :80
        fs::write(
            PathBuf::from(&tmp.paths.nginx).join("badami.conf"),
            "listen 127.0.0.1:80;\n",
        )
        .unwrap();
        let res80 = open_site_url_at(&tmp.paths, "office").expect("url80");
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
        assert!(body.contains("fastcgi_pass unix:"));
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
}
