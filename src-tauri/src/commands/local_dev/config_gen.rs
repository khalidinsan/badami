//! Config generators for Badami Local Dev runtime layout.
//!
//! Writes under `~/Library/Application Support/Badami/local-dev/` only.
//! Never mutates Herd paths or MariaDB datadirs.
//!
//! Paths are always parameters / discovery-derived — no hardcoded usernames.

use super::discovery::{build_runtime_paths, local_dev_root, RuntimePaths};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

// ── Public types ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerateConfigsRequest {
    /// Valet TLD (default `"test"`).
    pub tld: Option<String>,
    /// Park paths written into `config/valet/config.json`.
    pub park_paths: Option<Vec<String>>,
    /// Loopback address (default `127.0.0.1`).
    pub loopback: Option<String>,
    /// HTTP listen port for Mode A (default `8080`).
    pub http_port: Option<u16>,
    /// Default PHP compact tag for the catch-all server, e.g. `"84"`.
    pub default_php_tag: Option<String>,
    /// PHP tags to generate FPM pools for, e.g. `["74","84"]`.
    pub php_tags: Option<Vec<String>>,
    /// Optional MariaDB wrapper inputs. If omitted, my.cnf is skipped.
    pub mariadb: Option<MariadbWrapperInput>,
    /// Username for nginx/fpm `user` directives (defaults to `$USER`).
    pub username: Option<String>,
    /// Group for fpm (default `"staff"` on macOS).
    pub group: Option<String>,
    /// When true, emit `user` in nginx.conf (Mode B root master). Default false.
    pub nginx_as_root: Option<bool>,
    /// DNS listen port in dnsmasq.conf (default 53).
    pub dns_port: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MariadbWrapperInput {
    /// Absolute discovered datadir (Herd UUID path). Required.
    pub datadir: String,
    /// Absolute discovered basedir (Shared Herd services). Required.
    pub basedir: String,
    /// Socket path; default under local-dev or `/tmp`.
    pub socket: Option<String>,
    /// TCP port (default 3306).
    pub port: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerateConfigsResult {
    pub local_dev_root: String,
    pub written: Vec<String>,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IsolatedSiteRequest {
    pub site_name: String,
    pub tld: Option<String>,
    /// Display version e.g. `"7.4"` (written into `# ISOLATED_PHP_VERSION=`).
    pub php_version: String,
    /// Compact tag e.g. `"74"` for socket name.
    pub php_tag: String,
    pub http_port: Option<u16>,
}

// ── Path helpers ────────────────────────────────────────────────────

fn runtime_username(override_user: Option<&str>) -> String {
    if let Some(u) = override_user {
        if !u.is_empty() {
            return u.to_string();
        }
    }
    std::env::var("USER")
        .or_else(|_| std::env::var("LOGNAME"))
        .unwrap_or_else(|_| "nobody".to_string())
}

fn runtime_group(override_group: Option<&str>) -> String {
    if let Some(g) = override_group {
        if !g.is_empty() {
            return g.to_string();
        }
    }
    // Primary group on macOS developer machines is typically `staff`.
    "staff".to_string()
}

fn ensure_dir(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|e| format!("mkdir {}: {e}", path.display()))
}

fn write_file(path: &Path, contents: &str, written: &mut Vec<String>) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        ensure_dir(parent)?;
    }
    fs::write(path, contents).map_err(|e| format!("write {}: {e}", path.display()))?;
    written.push(path.to_string_lossy().into_owned());
    Ok(())
}

fn replace_all(mut s: String, pairs: &[(&str, &str)]) -> String {
    for (k, v) in pairs {
        s = s.replace(k, v);
    }
    s
}

fn version_from_tag(tag: &str) -> String {
    // "74" → "7.4", "84" → "8.4", "82" → "8.2"
    if tag.len() == 2 && tag.chars().all(|c| c.is_ascii_digit()) {
        let mut chars = tag.chars();
        let major = chars.next().unwrap();
        let minor = chars.next().unwrap();
        format!("{major}.{minor}")
    } else {
        tag.to_string()
    }
}

// ── Generators (pure-ish: only write under local-dev) ────────────────

/// Write `config/valet/config.json`.
pub fn write_valet_config(
    paths: &RuntimePaths,
    tld: &str,
    park_paths: &[String],
    loopback: &str,
    written: &mut Vec<String>,
) -> Result<(), String> {
    let dir = PathBuf::from(&paths.config_valet);
    ensure_dir(&dir)?;
    ensure_dir(&dir.join("Sites"))?;
    ensure_dir(&dir.join("Certificates"))?;

    let body = serde_json::json!({
        "tld": tld,
        "loopback": loopback,
        "paths": park_paths,
    });
    let text = serde_json::to_string_pretty(&body)
        .map_err(|e| format!("serialize valet config: {e}"))?
        + "\n";
    write_file(&dir.join("config.json"), &text, written)
}

/// Write nginx.conf + badami.conf + static helpers (mime.types, fastcgi_params).
pub fn write_nginx_configs(
    paths: &RuntimePaths,
    http_port: u16,
    default_php_tag: &str,
    username: &str,
    group: &str,
    nginx_as_root: bool,
    written: &mut Vec<String>,
) -> Result<(), String> {
    let nginx_dir = PathBuf::from(&paths.nginx);
    ensure_dir(&nginx_dir)?;
    ensure_dir(&nginx_dir.join("sites"))?;

    let local_dev = &paths.local_dev_root;
    let socks = &paths.socks;
    let logs = &paths.logs;
    let pids = &paths.pids;
    let valet_php = format!("{}/valet-server/server.php", local_dev);
    let default_sock = format!("{}/php{}.sock", socks, default_php_tag);
    let http_listen = format!("127.0.0.1:{http_port}");

    let user_directive = if nginx_as_root {
        format!("user \"{username}\" {group};")
    } else {
        // Mode A: unprivileged master — omit user directive.
        String::new()
    };

    let nginx_conf = replace_all(
        include_str!("../../../resources/local-dev/templates/nginx/nginx.conf.tpl").to_string(),
        &[
            ("{{USER_DIRECTIVE}}", &user_directive),
            ("{{LOGS_DIR}}", logs),
            ("{{PIDS_DIR}}", pids),
            ("{{NGINX_DIR}}", &paths.nginx),
        ],
    );
    write_file(&nginx_dir.join("nginx.conf"), &nginx_conf, written)?;

    let badami_conf = replace_all(
        include_str!("../../../resources/local-dev/templates/nginx/badami.conf.tpl").to_string(),
        &[
            ("{{HTTP_LISTEN}}", &http_listen),
            ("{{VALET_SERVER_PHP}}", &valet_php),
            ("{{DEFAULT_PHP_SOCK}}", &default_sock),
            ("{{NGINX_DIR}}", &paths.nginx),
            ("{{LOCAL_DEV_HOME}}", local_dev),
        ],
    );
    write_file(&nginx_dir.join("badami.conf"), &badami_conf, written)?;

    write_file(
        &nginx_dir.join("fastcgi_params"),
        include_str!("../../../resources/local-dev/templates/nginx/fastcgi_params"),
        written,
    )?;
    write_file(
        &nginx_dir.join("mime.types"),
        include_str!("../../../resources/local-dev/templates/nginx/mime.types"),
        written,
    )?;

    Ok(())
}

/// Write an isolated-site nginx conf under `nginx/sites/{name}.conf`.
pub fn write_isolated_site_conf(
    paths: &RuntimePaths,
    req: &IsolatedSiteRequest,
    written: &mut Vec<String>,
) -> Result<(), String> {
    let tld = req.tld.as_deref().unwrap_or("test");
    let http_port = req.http_port.unwrap_or(8080);
    let http_listen = format!("127.0.0.1:{http_port}");
    let sock = format!("{}/php{}.sock", paths.socks, req.php_tag);
    let valet_php = format!("{}/valet-server/server.php", paths.local_dev_root);

    let body = replace_all(
        include_str!("../../../resources/local-dev/templates/nginx/site.conf.tpl").to_string(),
        &[
            ("{{PHP_VERSION}}", &req.php_version),
            ("{{HTTP_LISTEN}}", &http_listen),
            ("{{SITE_NAME}}", &req.site_name),
            ("{{TLD}}", tld),
            ("{{VALET_SERVER_PHP}}", &valet_php),
            ("{{PHP_SOCK}}", &sock),
            ("{{NGINX_DIR}}", &paths.nginx),
            ("{{LOCAL_DEV_HOME}}", &paths.local_dev_root),
        ],
    );

    let out = PathBuf::from(&paths.nginx)
        .join("sites")
        .join(format!("{}.conf", req.site_name));
    write_file(&out, &body, written)
}

/// Write FPM pool confs for each PHP tag. **Always sets chdir = valet-server (KD24).**
pub fn write_fpm_pools(
    paths: &RuntimePaths,
    php_tags: &[String],
    username: &str,
    group: &str,
    written: &mut Vec<String>,
) -> Result<(), String> {
    let fpm_dir = PathBuf::from(&paths.fpm);
    ensure_dir(&fpm_dir)?;
    let tpl = include_str!("../../../resources/local-dev/templates/fpm/pool.conf.tpl");

    for tag in php_tags {
        let version = version_from_tag(tag);
        let body = replace_all(
            tpl.to_string(),
            &[
                ("{{PHP_VERSION}}", &version),
                ("{{PHP_TAG}}", tag),
                ("{{PIDS_DIR}}", &paths.pids),
                ("{{LOGS_DIR}}", &paths.logs),
                ("{{USERNAME}}", username),
                ("{{GROUP}}", group),
                ("{{SOCKS_DIR}}", &paths.socks),
                ("{{VALET_SERVER_DIR}}", &paths.valet_server),
            ],
        );
        let filename = format!("{version}-fpm.conf");
        write_file(&fpm_dir.join(filename), &body, written)?;
    }
    Ok(())
}

/// Write dnsmasq.conf: `address=/.{tld}/127.0.0.1`, listen 127.0.0.1.
pub fn write_dnsmasq_conf(
    paths: &RuntimePaths,
    tld: &str,
    loopback: &str,
    dns_port: u16,
    written: &mut Vec<String>,
) -> Result<(), String> {
    let dir = PathBuf::from(&paths.local_dev_root).join("dnsmasq");
    ensure_dir(&dir)?;
    let port_s = dns_port.to_string();
    let body = replace_all(
        include_str!("../../../resources/local-dev/templates/dnsmasq/dnsmasq.conf.tpl").to_string(),
        &[
            ("{{TLD}}", tld),
            ("{{LISTEN_ADDRESS}}", loopback),
            ("{{DNS_PORT}}", &port_s),
            ("{{LOOPBACK}}", loopback),
        ],
    );
    write_file(&dir.join("dnsmasq.conf"), &body, written)
}

/// Write MariaDB **wrapper** my.cnf only. Never runs install_db. Never rewrites
/// datadir without the caller supplying the discovered path.
pub fn write_mariadb_wrapper(
    paths: &RuntimePaths,
    input: &MariadbWrapperInput,
    written: &mut Vec<String>,
    notes: &mut Vec<String>,
) -> Result<(), String> {
    if input.datadir.trim().is_empty() || input.basedir.trim().is_empty() {
        return Err("mariadb wrapper requires non-empty datadir and basedir".into());
    }

    // Refuse to point datadir at empty string or relative junk.
    let datadir = PathBuf::from(&input.datadir);
    let basedir = PathBuf::from(&input.basedir);
    if !datadir.is_absolute() || !basedir.is_absolute() {
        return Err("mariadb datadir and basedir must be absolute paths".into());
    }

    let mariadb_dir = PathBuf::from(&paths.mariadb);
    ensure_dir(&mariadb_dir)?;

    let socket = input
        .socket
        .clone()
        .unwrap_or_else(|| format!("{}/mariadb.sock", paths.socks));
    let port = input.port.unwrap_or(3306);
    let port_s = port.to_string();
    let pid_file = format!("{}/mariadb.pid", paths.pids);
    let log_error = format!("{}/mariadb.log", paths.logs);

    let body = replace_all(
        include_str!("../../../resources/local-dev/templates/mariadb/my.cnf.tpl").to_string(),
        &[
            ("{{BASEDIR}}", &input.basedir),
            ("{{DATADIR}}", &input.datadir),
            ("{{SOCKET}}", &socket),
            ("{{PORT}}", &port_s),
            ("{{PID_FILE}}", &pid_file),
            ("{{LOG_ERROR}}", &log_error),
        ],
    );
    write_file(&mariadb_dir.join("my.cnf"), &body, written)?;
    notes.push(
        "MariaDB wrapper my.cnf written; start is NOT exposed in this PR — use ld_mariadb_preflight only."
            .into(),
    );
    notes.push(
        "Never run install_db against a non-empty datadir; wrapper reuses discovered paths only."
            .into(),
    );
    Ok(())
}

/// Generate the full set of runtime configs under local-dev.
pub fn generate_configs(req: GenerateConfigsRequest) -> Result<GenerateConfigsResult, String> {
    let paths = build_runtime_paths()?;
    let root = local_dev_root()?;

    // Layout dirs (idempotent).
    for sub in [
        &paths.config_valet,
        &paths.nginx,
        &paths.fpm,
        &paths.socks,
        &paths.mariadb,
        &paths.valet_server,
        &paths.pids,
        &paths.logs,
        &paths.import,
    ] {
        ensure_dir(Path::new(sub))?;
    }
    ensure_dir(&root.join("dnsmasq"))?;
    ensure_dir(&PathBuf::from(&paths.nginx).join("sites"))?;

    let tld = req.tld.as_deref().unwrap_or("test");
    let loopback = req.loopback.as_deref().unwrap_or("127.0.0.1");
    let http_port = req.http_port.unwrap_or(8080);
    let default_php_tag = req.default_php_tag.as_deref().unwrap_or("84");
    let php_tags = req
        .php_tags
        .clone()
        .unwrap_or_else(|| vec!["74".into(), "84".into()]);
    let username = runtime_username(req.username.as_deref());
    let group = runtime_group(req.group.as_deref());
    let nginx_as_root = req.nginx_as_root.unwrap_or(false);
    let dns_port = req.dns_port.unwrap_or(53);
    let park_paths = req.park_paths.unwrap_or_default();

    let mut written = Vec::new();
    let mut notes = Vec::new();

    write_valet_config(&paths, tld, &park_paths, loopback, &mut written)?;
    write_nginx_configs(
        &paths,
        http_port,
        default_php_tag,
        &username,
        &group,
        nginx_as_root,
        &mut written,
    )?;
    write_fpm_pools(&paths, &php_tags, &username, &group, &mut written)?;
    write_dnsmasq_conf(&paths, tld, loopback, dns_port, &mut written)?;

    if let Some(ref m) = req.mariadb {
        write_mariadb_wrapper(&paths, m, &mut written, &mut notes)?;
    } else {
        notes.push("MariaDB wrapper skipped (no mariadb input).".into());
    }

    notes.push(format!(
        "Generated configs for user={username} group={group} http_port={http_port} tld={tld}"
    ));
    notes.push("No njs; static fastcgi_pass sockets only.".into());
    notes.push("FPM pools include chdir = valet-server (KD24).".into());

    Ok(GenerateConfigsResult {
        local_dev_root: paths.local_dev_root,
        written,
        notes,
    })
}

/// Write a single isolated site conf (helper for future site isolate command).
pub fn generate_isolated_site(req: IsolatedSiteRequest) -> Result<GenerateConfigsResult, String> {
    let paths = build_runtime_paths()?;
    ensure_dir(&PathBuf::from(&paths.nginx).join("sites"))?;
    let mut written = Vec::new();
    write_isolated_site_conf(&paths, &req, &mut written)?;
    Ok(GenerateConfigsResult {
        local_dev_root: paths.local_dev_root,
        written,
        notes: vec![format!(
            "Isolated site conf for {}.{} → php{}",
            req.site_name,
            req.tld.as_deref().unwrap_or("test"),
            req.php_tag
        )],
    })
}

// ── Parse helpers used by guards ────────────────────────────────────

/// Parse key=value pairs from a simple my.cnf (`[mysqld]` section, plus pre-section keys).
pub fn parse_mycnf_values(contents: &str) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    let mut section = String::new();
    for line in contents.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with(';') {
            continue;
        }
        if line.starts_with('[') && line.ends_with(']') {
            section = line[1..line.len() - 1].to_ascii_lowercase();
            continue;
        }
        // Accept keys before any section or inside [mysqld].
        if !section.is_empty() && section != "mysqld" {
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            map.insert(
                k.trim().to_ascii_lowercase(),
                v.trim().trim_matches('"').trim_matches('\'').to_string(),
            );
        }
    }
    map
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_from_tag_basic() {
        assert_eq!(version_from_tag("74"), "7.4");
        assert_eq!(version_from_tag("84"), "8.4");
    }

    #[test]
    fn parse_mycnf_extracts_datadir() {
        let c = r#"
# comment
[mysqld]
basedir = /Users/Shared/Herd/services/mariadb/10.11.6
datadir = /tmp/fake-datadir
socket = /tmp/x.sock
port = 3306
log-error = /tmp/err.log

[client]
socket = /tmp/x.sock
"#;
        let m = parse_mycnf_values(c);
        assert_eq!(
            m.get("datadir").map(String::as_str),
            Some("/tmp/fake-datadir")
        );
        assert_eq!(
            m.get("basedir").map(String::as_str),
            Some("/Users/Shared/Herd/services/mariadb/10.11.6")
        );
        assert_eq!(m.get("socket").map(String::as_str), Some("/tmp/x.sock"));
        assert_eq!(m.get("port").map(String::as_str), Some("3306"));
    }

    #[test]
    fn replace_all_works() {
        let s = replace_all("a={{X}} b={{Y}}".into(), &[("{{X}}", "1"), ("{{Y}}", "2")]);
        assert_eq!(s, "a=1 b=2");
    }
}

#[cfg(test)]
mod smoke_write {
    use super::*;

    #[test]
    fn smoke_generate_and_install() {
        let install = crate::commands::local_dev::resources::install_runtime_resources(None)
            .expect("install");
        assert!(install.copied_files > 0);
        assert!(std::path::Path::new(&install.local_dev_root)
            .join("valet-server/server.php")
            .is_file());

        let res = generate_configs(GenerateConfigsRequest {
            tld: Some("test".into()),
            park_paths: Some(vec!["/tmp/parked-sites".into()]),
            loopback: Some("127.0.0.1".into()),
            http_port: Some(8080),
            default_php_tag: Some("84".into()),
            php_tags: Some(vec!["74".into(), "84".into()]),
            mariadb: Some(MariadbWrapperInput {
                datadir: "/tmp/fake-badami-datadir-smoke".into(),
                basedir: "/tmp/fake-badami-basedir-smoke".into(),
                socket: Some("/tmp/badami-mariadb-smoke.sock".into()),
                port: Some(3306),
            }),
            username: Some("testuser".into()),
            group: Some("staff".into()),
            nginx_as_root: Some(false),
            dns_port: Some(53),
        })
        .expect("generate");
        assert!(!res.written.is_empty());
        let root = std::path::PathBuf::from(&res.local_dev_root);
        let nginx = std::fs::read_to_string(root.join("nginx/badami.conf")).unwrap();
        assert!(nginx.contains("127.0.0.1:8080"));
        assert!(nginx.contains("HERD_HOME"));
        assert!(!nginx.contains("js_import"));
        // Config body must use static unix: sockets (comment text may mention variable maps).
        assert!(nginx.contains("fastcgi_pass unix:"));
        assert!(!nginx.contains("fastcgi_pass $"));
        let fpm = std::fs::read_to_string(root.join("fpm/8.4-fpm.conf")).unwrap();
        assert!(fpm.contains("chdir ="));
        assert!(fpm.contains("valet-server"));
        let my = std::fs::read_to_string(root.join("mariadb/my.cnf")).unwrap();
        assert!(my.contains("/tmp/fake-badami-datadir-smoke"));
        assert!(my.contains("/tmp/fake-badami-basedir-smoke"));
        // log/pid paths live under Application Support (HOME-derived at runtime — not hardcoded in source).
        assert!(my.contains("log-error"));

        let site = generate_isolated_site(IsolatedSiteRequest {
            site_name: "office".into(),
            tld: Some("test".into()),
            php_version: "7.4".into(),
            php_tag: "74".into(),
            http_port: Some(8080),
        })
        .expect("site");
        assert!(!site.written.is_empty());

        // Preflight against wrapper with skip live; datadir empty path may hard-fail only on missing keys
        let report = crate::commands::local_dev::mariadb_guard::run_preflight(
            crate::commands::local_dev::mariadb_guard::MariadbPreflightRequest {
                skip_live_probes: Some(true),
                ..Default::default()
            },
        )
        .expect("preflight");
        // Should be OkToStart (no live server, no live pid) or HardFail only if unexpected
        match report.result {
            crate::commands::local_dev::mariadb_guard::MariadbPreflight::OkToStart => {}
            crate::commands::local_dev::mariadb_guard::MariadbPreflight::Adopt { .. } => {}
            crate::commands::local_dev::mariadb_guard::MariadbPreflight::HardFail { ref reason } => {
                panic!("unexpected hard fail: {reason:?} checks={:?}", report.checks);
            }
        }
        assert!(report.ready_for_mariadb_start || matches!(report.result, crate::commands::local_dev::mariadb_guard::MariadbPreflight::Adopt { .. }));
    }
}
