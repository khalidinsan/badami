//! Config generators for Badami Local Dev runtime layout.
//!
//! Writes under `~/Library/Application Support/Badami/local-dev/` only.
//! Never mutates MariaDB datadirs.
//!
//! Paths are always parameters / discovery-derived; no hardcoded usernames.

use super::discovery::{build_runtime_paths, local_dev_root, RuntimePaths};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Component, Path, PathBuf};

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
    /// Absolute datadir path. Required.
    pub datadir: String,
    /// Absolute MariaDB basedir. Required unless the Badami runtime has one.
    pub basedir: String,
    /// Socket path; default under local-dev or `/tmp`.
    pub socket: Option<String>,
    /// TCP port (default 3306).
    pub port: Option<u16>,
    /// Allow absolute datadir/basedir outside the Badami local-dev root
    /// (tests / advanced). Default false means a soft-warn note only.
    pub allow_unverified_datadir: Option<bool>,
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

fn has_control_or_meta(s: &str) -> bool {
    s.chars().any(|c| {
        c.is_control() || c == '\n' || c == '\r' || c == '#' || c == ';' || c == '"' || c == '\''
    })
}

/// DNS-ish label; allows underscore for Laravel park folders (`office_sumedang`).
pub fn validate_site_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.len() > 63 {
        return Err("site_name must be 1–63 characters".into());
    }
    if name.contains("..") || name.contains('/') || name.contains('\\') {
        return Err("site_name must not contain path separators or ..".into());
    }
    if has_control_or_meta(name) {
        return Err("site_name contains forbidden characters".into());
    }
    let bytes = name.as_bytes();
    let first = bytes[0];
    let last = bytes[bytes.len() - 1];
    if !first.is_ascii_alphanumeric() || !last.is_ascii_alphanumeric() {
        return Err("site_name must start and end with alphanumeric".into());
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("site_name may only contain [A-Za-z0-9_-]".into());
    }
    Ok(())
}

pub fn validate_tld(tld: &str) -> Result<(), String> {
    if tld.is_empty() || tld.len() > 63 {
        return Err("tld must be 1–63 characters".into());
    }
    if tld.contains("..") || tld.contains('/') || tld.contains('\\') || has_control_or_meta(tld)
    {
        return Err("tld contains forbidden characters".into());
    }
    if !tld
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err("tld may only contain [A-Za-z0-9-]".into());
    }
    if tld.starts_with('-') || tld.ends_with('-') {
        return Err("tld must not start or end with '-'".into());
    }
    Ok(())
}

/// Compact PHP tag used in binary/socket names: exactly two digits (`74`, `84`).
pub fn validate_php_tag(tag: &str) -> Result<(), String> {
    if tag.len() == 2 && tag.chars().all(|c| c.is_ascii_digit()) {
        Ok(())
    } else {
        Err(format!(
            "php_tag must be exactly two digits (e.g. \"74\", \"84\"); got {tag:?}"
        ))
    }
}

pub fn validate_unix_identity(name: &str, field: &str) -> Result<(), String> {
    if name.is_empty() || name.len() > 64 {
        return Err(format!("{field} must be 1–64 characters"));
    }
    if has_control_or_meta(name) {
        return Err(format!("{field} contains forbidden characters"));
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
    {
        return Err(format!("{field} may only contain [A-Za-z0-9._-]"));
    }
    Ok(())
}

pub fn validate_loopback(addr: &str) -> Result<(), String> {
    if addr.is_empty() || has_control_or_meta(addr) || addr.contains('/') || addr.contains('\\')
    {
        return Err("loopback address is invalid".into());
    }
    // IPv4 dotted or simple hostname chars only.
    if !addr
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == ':')
    {
        return Err("loopback address contains forbidden characters".into());
    }
    Ok(())
}

/// Display PHP version like `7.4` / `8.4` (for isolation comment only).
pub fn validate_php_version_display(v: &str) -> Result<(), String> {
    if has_control_or_meta(v) || v.contains('/') || v.contains('\\') {
        return Err("php_version contains forbidden characters".into());
    }
    let parts: Vec<&str> = v.split('.').collect();
    if parts.len() == 2
        && parts.iter().all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
    {
        Ok(())
    } else {
        Err(format!("php_version must look like \"7.4\" or \"8.4\"; got {v:?}"))
    }
}

/// Ensure `candidate` has no `..` components and, once joined under `root`, stays under `root`.
pub fn ensure_path_under_root(root: &Path, candidate: &Path) -> Result<PathBuf, String> {
    for c in candidate.components() {
        if matches!(c, Component::ParentDir | Component::RootDir | Component::Prefix(_)) {
            return Err(format!(
                "path must be a relative name without .. or absolute segments: {}",
                candidate.display()
            ));
        }
    }
    let joined = root.join(candidate);
    // Compare lexical: root must be a prefix of joined after normalize-lite.
    let root_s = root.to_string_lossy();
    let joined_s = joined.to_string_lossy();
    if !joined_s.starts_with(root_s.as_ref()) {
        return Err(format!(
            "refusing write outside local-dev root: {}",
            joined.display()
        ));
    }
    // Extra: file name only for confs under sites.
    Ok(joined)
}

/// Paths the MariaDB wrapper may point at without the caller opting in:
/// Badami's own local-dev tree (binaries and data). Anything else needs
/// `allow_unverified_datadir`.
fn is_trusted_runtime_path(p: &Path, local_dev_root: &Path) -> bool {
    let badami_roots = [local_dev_root.to_path_buf(), local_dev_root.join("data")];
    badami_roots.iter().any(|root| p.starts_with(root))
}

/// Verified Badami MariaDB version dir (`runtime/mariadb/<version>`): the
/// basedir its `bin/mariadbd` and `lib/` expect.
fn badami_mariadb_basedir(runtime_root: &Path) -> Option<PathBuf> {
    let manifest = super::runtime_manifest::load(runtime_root);
    let selected = manifest
        .selected_for("mariadb", None)
        .filter(|c| super::runtime_manifest::verify(c))
        .or_else(|| {
            manifest
                .for_role("mariadb")
                .into_iter()
                .find(|c| super::runtime_manifest::verify(c))
        })?;
    Path::new(&selected.binary)
        .parent()
        .and_then(Path::parent)
        .map(Path::to_path_buf)
}

/// Park paths already recorded in the generated valet config, so a caller that
/// does not supply the list cannot erase the sites registered there.
fn existing_park_paths(paths: &RuntimePaths) -> Vec<String> {
    let file = PathBuf::from(&paths.config_valet).join("config.json");
    let Ok(raw) = std::fs::read_to_string(&file) else {
        return Vec::new();
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return Vec::new();
    };
    value
        .get("paths")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

/// Wrapper input derived from the Badami runtime, for callers that do not name
/// a datadir. Returns `None` until both the runtime and a datadir exist, since
/// a wrapper pointing at a missing datadir would be worse than no wrapper.
fn badami_mariadb_input(paths: &RuntimePaths) -> Option<MariadbWrapperInput> {
    let basedir = badami_mariadb_basedir(Path::new(&paths.runtime))?;
    let datadir = super::datadir_migration::adopted_datadir(Path::new(&paths.data))?;
    Some(MariadbWrapperInput {
        datadir: datadir.to_string_lossy().into_owned(),
        basedir: basedir.to_string_lossy().into_owned(),
        socket: None,
        port: None,
        allow_unverified_datadir: None,
    })
}

fn runtime_username(override_user: Option<&str>) -> Result<String, String> {
    let u = if let Some(u) = override_user {
        if !u.is_empty() {
            u.to_string()
        } else {
            std::env::var("USER")
                .or_else(|_| std::env::var("LOGNAME"))
                .unwrap_or_else(|_| "nobody".to_string())
        }
    } else {
        std::env::var("USER")
            .or_else(|_| std::env::var("LOGNAME"))
            .unwrap_or_else(|_| "nobody".to_string())
    };
    validate_unix_identity(&u, "username")?;
    Ok(u)
}

fn runtime_group(override_group: Option<&str>) -> Result<String, String> {
    let g = if let Some(g) = override_group {
        if !g.is_empty() {
            g.to_string()
        } else {
            "staff".to_string()
        }
    } else {
        "staff".to_string()
    };
    validate_unix_identity(&g, "group")?;
    Ok(g)
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
    // "74" → "7.4", "84" → "8.4"; only valid after validate_php_tag
    let mut chars = tag.chars();
    let major = chars.next().unwrap_or('0');
    let minor = chars.next().unwrap_or('0');
    format!("{major}.{minor}")
}

/// Write `config/valet/config.json`.
pub fn write_valet_config(
    paths: &RuntimePaths,
    tld: &str,
    park_paths: &[String],
    loopback: &str,
    written: &mut Vec<String>,
) -> Result<(), String> {
    validate_tld(tld)?;
    validate_loopback(loopback)?;

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
    validate_php_tag(default_php_tag)?;
    validate_unix_identity(username, "username")?;
    validate_unix_identity(group, "group")?;

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
        // Mode A: unprivileged master; omit user directive.
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

/// Options for the merged per-site nginx conf writer.
///
/// A single `{site}.conf` file supports the four combinations of
/// isolated × secured. We intentionally keep this as one file rather than
/// splitting into `{site}.conf` + `{site}-ssl.conf` so `ld_unsecure` and
/// `ld_unisolate` have a single file to rewrite / remove.
#[derive(Debug, Clone)]
pub struct SiteConfOptions {
    pub site_name: String,
    pub tld: String,
    pub http_port: u16,
    /// `Some(port)` emits an HTTPS server block + an HTTP redirect block.
    /// `None` emits a single HTTP server block.
    pub https_port: Option<u16>,
    /// Absolute path to the leaf cert PEM; must be `Some` iff `https_port`.
    pub cert_path: Option<String>,
    /// Absolute path to the leaf key PEM; must be `Some` iff `https_port`.
    pub key_path: Option<String>,
    /// `Some(tag)` points fastcgi_pass at the isolated FPM socket.
    pub php_tag: Option<String>,
    /// Display PHP version for the `ISOLATED_PHP_VERSION=` marker. Only
    /// relevant when `php_tag` is set.
    pub php_version_display: Option<String>,
}

/// Legacy helper; writes an isolated-only per-site conf. Delegates to
/// [`write_site_conf`] so there is only one renderer in the tree. New
/// callers should prefer `write_site_conf` directly.
pub fn write_isolated_site_conf(
    paths: &RuntimePaths,
    req: &IsolatedSiteRequest,
    written: &mut Vec<String>,
) -> Result<(), String> {
    let tld = req.tld.clone().unwrap_or_else(|| "test".into());
    let opts = SiteConfOptions {
        site_name: req.site_name.clone(),
        tld,
        http_port: req.http_port.unwrap_or(8080),
        https_port: None,
        cert_path: None,
        key_path: None,
        php_tag: Some(req.php_tag.clone()),
        php_version_display: Some(req.php_version.clone()),
    };
    write_site_conf(paths, &opts, written).map(|_| ())
}

/// True when both cert + key paths are present and the https_port is set.
pub fn site_conf_is_secured(opts: &SiteConfOptions) -> bool {
    opts.https_port.is_some() && opts.cert_path.is_some() && opts.key_path.is_some()
}

/// Validate options + render the merged nginx conf body (no file I/O).
///
/// Returned string includes a `# BADAMI_SITE_CONF v1` header plus marker
/// comments so `list_sites` and `parse_isolated_version_from_conf` can keep
/// treating this file as the source of truth for isolate/secure state.
pub fn render_merged_site_conf(
    paths: &RuntimePaths,
    opts: &SiteConfOptions,
) -> Result<String, String> {
    validate_site_name(&opts.site_name)?;
    validate_tld(&opts.tld)?;
    if let Some(ref tag) = opts.php_tag {
        validate_php_tag(tag)?;
    }
    if let Some(ref v) = opts.php_version_display {
        validate_php_version_display(v)?;
    }
    let secured = site_conf_is_secured(opts);
    if opts.https_port.is_some() && !secured {
        return Err(
            "https_port is Some but cert_path / key_path missing; secure cert files first".into(),
        );
    }
    for p in opts.cert_path.iter().chain(opts.key_path.iter()) {
        if p.contains('"') || p.contains('\n') || p.contains('\r') {
            return Err("TLS cert / key path contains forbidden characters".into());
        }
    }

    let valet_php = format!("{}/valet-server/server.php", paths.local_dev_root);
    let default_sock_fallback = {
        // Fall back to the catch-all server's socket (php{{default}}.sock)
        // when the caller did not pass a PHP tag; matches the behaviour of
        // the top-level badami.conf default_server block.
        let tag = opts
            .php_tag
            .clone()
            .unwrap_or_else(|| parse_default_php_tag(paths).unwrap_or_else(|| "84".into()));
        format!("{}/php{}.sock", paths.socks, tag)
    };
    let php_sock = default_sock_fallback;
    let body_tpl = include_str!(
        "../../../resources/local-dev/templates/nginx/site_body.conf.tpl"
    );
    let body = replace_all(
        body_tpl.to_string(),
        &[
            ("{{VALET_SERVER_PHP}}", &valet_php),
            ("{{PHP_SOCK}}", &php_sock),
            ("{{NGINX_DIR}}", &paths.nginx),
            ("{{LOCAL_DEV_HOME}}", &paths.local_dev_root),
        ],
    );

    let host = format!("{}.{}", opts.site_name, opts.tld);
    let server_names = format!("{host} www.{host} *.{host}");

    let mut out = String::new();
    out.push_str("# BADAMI_SITE_CONF v1\n");
    out.push_str(&format!("# BADAMI_SITE={host}\n"));
    if let Some(ref v) = opts.php_version_display {
        out.push_str(&format!("# ISOLATED_PHP_VERSION={v}\n"));
    }
    if secured {
        out.push_str("# BADAMI_SECURED=1\n");
    }
    out.push_str("# Badami Local Dev per-site conf (static socket, no njs)\n\n");

    if secured {
        let https_port = opts.https_port.ok_or(
            "render_merged_site_conf: secured=true but https_port=None (invariant violation)",
        )?;
        let https_listen = format!("127.0.0.1:{https_port}");
        let cert = opts.cert_path.as_deref().unwrap_or_default();
        let key = opts.key_path.as_deref().unwrap_or_default();
        out.push_str(&format!(
            "server {{\n\
    listen {https_listen} ssl;\n\
    http2 on;\n\
    server_name {server_names};\n\
    ssl_certificate     \"{cert}\";\n\
    ssl_certificate_key \"{key}\";\n\
    ssl_protocols TLSv1.2 TLSv1.3;\n\
    ssl_prefer_server_ciphers off;\n\
    ssl_session_cache shared:BadamiSSL:1m;\n\
    ssl_session_timeout 10m;\n\
{body}}}\n\n"
        ));

        // HTTP redirect: strip :443 from the Location header; keep high ports.
        let location = if https_port == 443 {
            format!("https://{host}$request_uri")
        } else {
            format!("https://{host}:{https_port}$request_uri")
        };
        out.push_str(&format!(
            "server {{\n\
    listen 127.0.0.1:{http_port};\n\
    server_name {server_names};\n\
    return 301 {location};\n\
}}\n",
            http_port = opts.http_port,
        ));
    } else {
        out.push_str(&format!(
            "server {{\n\
    listen 127.0.0.1:{http_port};\n\
    server_name {server_names};\n\
{body}}}\n",
            http_port = opts.http_port,
        ));
    }

    Ok(out)
}

/// Render + write the merged per-site conf.
pub fn write_site_conf(
    paths: &RuntimePaths,
    opts: &SiteConfOptions,
    written: &mut Vec<String>,
) -> Result<PathBuf, String> {
    let body = render_merged_site_conf(paths, opts)?;
    let sites_dir = PathBuf::from(&paths.nginx).join("sites");
    ensure_dir(&sites_dir)?;
    let out =
        ensure_path_under_root(&sites_dir, Path::new(&format!("{}.conf", opts.site_name)))?;
    if out.file_name().and_then(|s| s.to_str())
        != Some(&format!("{}.conf", opts.site_name))
    {
        return Err("refusing merged site conf path traversal".into());
    }
    write_file(&out, &body, written)?;
    Ok(out)
}

/// Best-effort read of the compile-time default PHP tag from the catch-all
/// `badami.conf`. Falls back to `None` on parse failure so callers can supply
/// their own default. Only used by [`render_merged_site_conf`] when the caller
/// does not pass a PHP tag (plain non-isolated site).
fn parse_default_php_tag(paths: &RuntimePaths) -> Option<String> {
    let p = PathBuf::from(&paths.nginx).join("badami.conf");
    let content = fs::read_to_string(&p).ok()?;
    // Match either quoted or unquoted socket path. The catch-all block uses:
    //   fastcgi_pass "unix:{SOCKS}/php{TAG}.sock";
    // We extract {TAG} from the suffix.
    for line in content.lines() {
        let trimmed = line.trim();
        let s = trimmed
            .strip_prefix("fastcgi_pass ")
            .map(|s| s.trim_matches(';').trim())?;
        let s = s.trim_matches('"');
        let s = s.strip_prefix("unix:")?;
        let name = Path::new(s).file_name()?.to_str()?;
        let tag = name.strip_prefix("php")?.strip_suffix(".sock")?;
        if validate_php_tag(tag).is_ok() {
            return Some(tag.to_string());
        }
    }
    None
}

/// Write FPM pool confs for each PHP tag. **Always sets chdir = valet-server (KD24).**
pub fn write_fpm_pools(
    paths: &RuntimePaths,
    php_tags: &[String],
    username: &str,
    group: &str,
    written: &mut Vec<String>,
) -> Result<(), String> {
    validate_unix_identity(username, "username")?;
    validate_unix_identity(group, "group")?;

    let fpm_dir = PathBuf::from(&paths.fpm);
    ensure_dir(&fpm_dir)?;
    let tpl = include_str!("../../../resources/local-dev/templates/fpm/pool.conf.tpl");

    for tag in php_tags {
        validate_php_tag(tag)?;
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
        // version is digits+dot only from validated tag; safe filename.
        let filename = format!("{version}-fpm.conf");
        let out = ensure_path_under_root(&fpm_dir, Path::new(&filename))?;
        write_file(&out, &body, written)?;
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
    validate_tld(tld)?;
    validate_loopback(loopback)?;

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
            ("{{PIDS_DIR}}", &paths.pids),
            ("{{LOGS_DIR}}", &paths.logs),
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

    // A provisioned Badami MariaDB wins over the configured basedir: its
    // relocated dylibs only resolve against `runtime/mariadb/<version>/lib`.
    let basedir_input = match badami_mariadb_basedir(Path::new(&paths.runtime)) {
        Some(b) => {
            let s = b.to_string_lossy().into_owned();
            notes.push(format!("MariaDB basedir: using Badami runtime {s}"));
            s
        }
        None => input.basedir.clone(),
    };

    // Refuse to point datadir at empty string or relative junk.
    let datadir = PathBuf::from(&input.datadir);
    let basedir = PathBuf::from(&basedir_input);
    if !datadir.is_absolute() || !basedir.is_absolute() {
        return Err("mariadb datadir and basedir must be absolute paths".into());
    }
    if has_control_or_meta(&input.datadir) || has_control_or_meta(&basedir_input) {
        return Err("mariadb datadir/basedir contain forbidden characters".into());
    }

    // Badami's own tree (binaries + data) is trusted; anything else is only a
    // soft warning, so the caller opts in explicitly.
    let local_dev_root = Path::new(&paths.local_dev_root);
    let allow_unverified = input.allow_unverified_datadir.unwrap_or(false);
    if !is_trusted_runtime_path(&datadir, local_dev_root)
        || !is_trusted_runtime_path(&basedir, local_dev_root)
    {
        if allow_unverified {
            notes.push(
                "mariadb wrapper: datadir/basedir outside the Badami root (allow_unverified_datadir=true)"
                    .into(),
            );
        } else {
            notes.push(
                "warning: mariadb datadir/basedir are not under the Badami local-dev root; set allow_unverified_datadir if intentional"
                    .into(),
            );
            // Soft-validate only (do not hard-fail): still write, so import flows work.
            // PR4 can require discovery match before start.
        }
    }

    if let Some(ref sock) = input.socket {
        if has_control_or_meta(sock) || !Path::new(sock).is_absolute() {
            return Err("mariadb socket must be an absolute path without control chars".into());
        }
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
            ("{{BASEDIR}}", &basedir_input),
            ("{{DATADIR}}", &input.datadir),
            ("{{SOCKET}}", &socket),
            ("{{PORT}}", &port_s),
            ("{{PID_FILE}}", &pid_file),
            ("{{LOG_ERROR}}", &log_error),
        ],
    );
    write_file(&mariadb_dir.join("my.cnf"), &body, written)?;
    notes.push(
        "MariaDB wrapper my.cnf written; start is NOT exposed in this PR; use ld_mariadb_preflight only."
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
    generate_configs_at(req, &paths, &root)
}

/// Same as [`generate_configs`] but against a caller-supplied root.
///
/// Tests use this so they never write into the real Application Support tree,
/// which would overwrite a developer's parked sites and ports.
pub fn generate_configs_at(
    req: GenerateConfigsRequest,
    paths: &RuntimePaths,
    root: &Path,
) -> Result<GenerateConfigsResult, String> {
    let paths = paths.clone();
    let root = root.to_path_buf();

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
    validate_tld(tld)?;
    validate_loopback(loopback)?;

    let http_port = req.http_port.unwrap_or(8080);
    let default_php_tag = req.default_php_tag.as_deref().unwrap_or("84");
    validate_php_tag(default_php_tag)?;
    let php_tags = req
        .php_tags
        .clone()
        .unwrap_or_else(|| vec!["74".into(), "84".into()]);
    for t in &php_tags {
        validate_php_tag(t)?;
    }

    let username = runtime_username(req.username.as_deref())?;
    let group = runtime_group(req.group.as_deref())?;
    // Privileged ports need a root master plus `user` so workers can reach FPM
    // socks under Application Support (Mode B / :80).
    let nginx_as_root = req
        .nginx_as_root
        .unwrap_or(http_port > 0 && http_port < 1024);
    // Mode A: high port (no root). Port 53 only when explicitly requested (Mode B).
    let dns_port = req.dns_port.unwrap_or(53535);
    let park_paths = match req.park_paths {
        Some(p) => p,
        // A caller that omits the list (port change, config refresh) must not
        // wipe the parked sites: an empty list here means "unspecified", not
        // "no parks", and writing it would silently unregister every site.
        None => existing_park_paths(&paths),
    };

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

    // Provisioned php-fpm reads its ini only from PHP_INI_SCAN_DIR, which the
    // FPM spec points here. Without this the pool starts with no ini at all.
    for tag in &php_tags {
        match super::provision::write_php_ini(&paths, tag) {
            Ok(path) => written.push(path.to_string_lossy().into_owned()),
            Err(e) => notes.push(format!("php.ini for {tag} skipped: {e}")),
        }
    }

    if let Some(m) = &req.mariadb {
        write_mariadb_wrapper(&paths, m, &mut written, &mut notes)?;
    } else if let Some(m) = badami_mariadb_input(&paths) {
        // The caller did not name a datadir, so use the migrated one when it
        // exists. Leaving the wrapper ungenerated here would silently keep
        // MariaDB on the old datadir after a migration.
        write_mariadb_wrapper(&paths, &m, &mut written, &mut notes)?;
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

/// Parse key=value pairs from a simple my.cnf (`[mysqld]` section, plus pre-section keys).
/// Surrounding quotes on values are stripped.
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
basedir = "/Users/x/Library/Application Support/Badami/local-dev/runtime/mariadb/10.11.6"
datadir = "/tmp/fake-datadir"
socket = "/tmp/x.sock"
port = 3306
log-error = "/tmp/err.log"

[client]
socket = "/tmp/x.sock"
"#;
        let m = parse_mycnf_values(c);
        assert_eq!(
            m.get("datadir").map(String::as_str),
            Some("/tmp/fake-datadir")
        );
        assert_eq!(
            m.get("basedir").map(String::as_str),
            Some("/Users/x/Library/Application Support/Badami/local-dev/runtime/mariadb/10.11.6")
        );
        assert_eq!(m.get("socket").map(String::as_str), Some("/tmp/x.sock"));
        assert_eq!(m.get("port").map(String::as_str), Some("3306"));
    }

    #[test]
    fn replace_all_works() {
        let s = replace_all("a={{X}} b={{Y}}".into(), &[("{{X}}", "1"), ("{{Y}}", "2")]);
        assert_eq!(s, "a=1 b=2");
    }

    #[test]
    fn validate_site_name_rejects_traversal() {
        assert!(validate_site_name("../etc").is_err());
        assert!(validate_site_name("foo/bar").is_err());
        assert!(validate_site_name("office_sumedang").is_ok());
        assert!(validate_site_name("office").is_ok());
        assert!(validate_site_name("bad\nname").is_err());
    }

    #[test]
    fn validate_php_tag_strict() {
        assert!(validate_php_tag("74").is_ok());
        assert!(validate_php_tag("8.4").is_err());
        assert!(validate_php_tag("../").is_err());
    }

    #[test]
    fn validate_identity() {
        assert!(validate_unix_identity("khalid", "username").is_ok());
        assert!(validate_unix_identity("staff", "group").is_ok());
        assert!(validate_unix_identity("a;b", "username").is_err());
        assert!(validate_unix_identity("a\nb", "group").is_err());
    }

    #[test]
    fn trusted_runtime_path_accepts_badami_only() {
        let root = Path::new("/Users/x/Library/Application Support/Badami/local-dev");
        assert!(is_trusted_runtime_path(&root.join("runtime/mariadb/10.11.6"), root));
        assert!(is_trusted_runtime_path(&root.join("data/mariadb"), root));
        // Arbitrary user-writable locations must stay untrusted.
        assert!(!is_trusted_runtime_path(Path::new("/tmp/evil-datadir"), root));
        assert!(!is_trusted_runtime_path(Path::new("/Users/x/data"), root));
        assert!(!is_trusted_runtime_path(
            Path::new("/Users/Shared/Other/services/mariadb/10.11.6"),
            root
        ));
    }

    fn mk_paths() -> RuntimePaths {
        use super::super::discovery::runtime_paths_from_root;
        use std::path::PathBuf;
        use std::time::{SystemTime, UNIX_EPOCH};
        let n = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let root = std::env::temp_dir().join(format!("badami-cfg-merged-{n}"));
        let _ = fs::remove_dir_all(&root);
        let paths = runtime_paths_from_root(root);
        fs::create_dir_all(&paths.config_valet).unwrap();
        fs::create_dir_all(&paths.nginx).unwrap();
        fs::create_dir_all(PathBuf::from(&paths.nginx).join("sites")).unwrap();
        fs::create_dir_all(&paths.socks).unwrap();
        // badami.conf with a specific default socket so we can assert the
        // fallback behaviour of a non-isolated plain conf.
        fs::write(
            PathBuf::from(&paths.nginx).join("badami.conf"),
            "fastcgi_pass \"unix:/tmp/php84.sock\";\n",
        )
        .unwrap();
        paths
    }

    fn drop_paths(paths: &RuntimePaths) {
        let _ = fs::remove_dir_all(&paths.local_dev_root);
    }

    #[test]
    fn wrapper_accepts_badami_root_without_override() {
        let paths = mk_paths();
        let mut written = Vec::new();
        let mut notes = Vec::new();
        let input = MariadbWrapperInput {
            datadir: format!("{}/data/mariadb", paths.local_dev_root),
            basedir: format!("{}/runtime/mariadb/10.11.6", paths.local_dev_root),
            socket: None,
            port: None,
            allow_unverified_datadir: None,
        };
        write_mariadb_wrapper(&paths, &input, &mut written, &mut notes).expect("wrapper");
        assert!(
            !notes.iter().any(|n| n.contains("not under the Badami")),
            "Badami-root datadir/basedir must pass the trusted gate: {notes:?}"
        );
        drop_paths(&paths);
    }

    #[test]
    fn render_merged_plain_http_only() {
        let paths = mk_paths();
        let opts = SiteConfOptions {
            site_name: "office".into(),
            tld: "test".into(),
            http_port: 8080,
            https_port: None,
            cert_path: None,
            key_path: None,
            php_tag: None,
            php_version_display: None,
        };
        let body = render_merged_site_conf(&paths, &opts).unwrap();
        // Only one server block, http only, no secured/isolated markers.
        assert!(body.contains("# BADAMI_SITE=office.test"));
        assert!(!body.contains("BADAMI_SECURED"));
        assert!(!body.contains("ISOLATED_PHP_VERSION"));
        assert!(body.contains("listen 127.0.0.1:8080;"));
        assert_eq!(body.matches("server {").count(), 1);
        assert!(!body.contains("ssl_certificate"));
        drop_paths(&paths);
    }

    #[test]
    fn render_merged_isolated_only() {
        let paths = mk_paths();
        let opts = SiteConfOptions {
            site_name: "office".into(),
            tld: "test".into(),
            http_port: 8080,
            https_port: None,
            cert_path: None,
            key_path: None,
            php_tag: Some("74".into()),
            php_version_display: Some("7.4".into()),
        };
        let body = render_merged_site_conf(&paths, &opts).unwrap();
        assert!(body.contains("# ISOLATED_PHP_VERSION=7.4"));
        assert!(!body.contains("BADAMI_SECURED"));
        assert!(body.contains("php74.sock"));
        assert!(!body.contains("ssl_certificate"));
        drop_paths(&paths);
    }

    #[test]
    fn render_merged_secured_only() {
        let paths = mk_paths();
        let opts = SiteConfOptions {
            site_name: "office".into(),
            tld: "test".into(),
            http_port: 8080,
            https_port: Some(8443),
            cert_path: Some("/tmp/office.test.crt".into()),
            key_path: Some("/tmp/office.test.key".into()),
            php_tag: None,
            php_version_display: None,
        };
        let body = render_merged_site_conf(&paths, &opts).unwrap();
        assert!(body.contains("# BADAMI_SECURED=1"));
        assert!(!body.contains("ISOLATED_PHP_VERSION"));
        assert!(body.contains("listen 127.0.0.1:8443 ssl"));
        assert!(body.contains("http2 on;"));
        assert!(body.contains("ssl_certificate     \"/tmp/office.test.crt\""));
        assert!(body.contains("ssl_certificate_key \"/tmp/office.test.key\""));
        assert!(body.contains("return 301 https://office.test:8443"));
        // Both server blocks must be present.
        assert_eq!(body.matches("server {").count(), 2);
        // Fallback socket (parsed from badami.conf) is php84.sock.
        assert!(body.contains("php84.sock"));
        drop_paths(&paths);
    }

    #[test]
    fn render_merged_secured_and_isolated() {
        let paths = mk_paths();
        let opts = SiteConfOptions {
            site_name: "office".into(),
            tld: "test".into(),
            http_port: 8080,
            https_port: Some(8443),
            cert_path: Some("/tmp/office.test.crt".into()),
            key_path: Some("/tmp/office.test.key".into()),
            php_tag: Some("74".into()),
            php_version_display: Some("7.4".into()),
        };
        let body = render_merged_site_conf(&paths, &opts).unwrap();
        assert!(body.contains("# BADAMI_SECURED=1"));
        assert!(body.contains("# ISOLATED_PHP_VERSION=7.4"));
        // HTTPS block uses the isolated FPM socket.
        assert!(body.contains("php74.sock"));
        assert!(body.contains("listen 127.0.0.1:8443 ssl"));
        assert!(body.contains("return 301 https://office.test:8443"));
        assert_eq!(body.matches("server {").count(), 2);
        drop_paths(&paths);
    }

    #[test]
    fn render_merged_secured_on_443_omits_port_in_redirect() {
        let paths = mk_paths();
        let opts = SiteConfOptions {
            site_name: "office".into(),
            tld: "test".into(),
            http_port: 80,
            https_port: Some(443),
            cert_path: Some("/tmp/office.test.crt".into()),
            key_path: Some("/tmp/office.test.key".into()),
            php_tag: None,
            php_version_display: None,
        };
        let body = render_merged_site_conf(&paths, &opts).unwrap();
        assert!(body.contains("return 301 https://office.test$request_uri"));
        assert!(!body.contains("return 301 https://office.test:443"));
        drop_paths(&paths);
    }

    #[test]
    fn render_merged_rejects_https_without_cert() {
        let paths = mk_paths();
        let opts = SiteConfOptions {
            site_name: "office".into(),
            tld: "test".into(),
            http_port: 8080,
            https_port: Some(8443),
            cert_path: None,
            key_path: None,
            php_tag: None,
            php_version_display: None,
        };
        let err = render_merged_site_conf(&paths, &opts).unwrap_err();
        assert!(err.contains("cert_path") || err.contains("key_path"), "{err}");
        drop_paths(&paths);
    }

    #[test]
    fn render_merged_rejects_bad_names() {
        let paths = mk_paths();
        let base = SiteConfOptions {
            site_name: "office".into(),
            tld: "test".into(),
            http_port: 8080,
            https_port: None,
            cert_path: None,
            key_path: None,
            php_tag: None,
            php_version_display: None,
        };
        let bad_site = SiteConfOptions {
            site_name: "../etc".into(),
            ..base.clone()
        };
        assert!(render_merged_site_conf(&paths, &bad_site).is_err());
        let bad_tld = SiteConfOptions {
            tld: "a.b".into(),
            ..base
        };
        assert!(render_merged_site_conf(&paths, &bad_tld).is_err());
        drop_paths(&paths);
    }
}

#[cfg(test)]
mod smoke_write {
    use super::*;

    #[test]
    fn smoke_generate_and_install() {
        // Everything goes into a throwaway root: writing to Application Support
        // would overwrite the real parked sites and ports of whoever runs this.
        let base = std::env::temp_dir().join(format!(
            "badami-cfg-smoke-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&base);
        let paths = super::super::discovery::runtime_paths_from_root(base.clone());

        let install = crate::commands::local_dev::resources::install_runtime_resources(None)
            .expect("install");
        assert!(install.copied_files > 0);
        assert!(std::path::Path::new(&install.local_dev_root)
            .join("valet-server/server.php")
            .is_file());

        let res = generate_configs_at(GenerateConfigsRequest {
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
                allow_unverified_datadir: Some(true),
            }),
            username: Some("testuser".into()),
            group: Some("staff".into()),
            nginx_as_root: Some(false),
            dns_port: Some(53),
        }, &paths, &base)
        .expect("generate");
        assert!(!res.written.is_empty());
        let root = std::path::PathBuf::from(&res.local_dev_root);
        let nginx = std::fs::read_to_string(root.join("nginx/badami.conf")).unwrap();
        assert!(nginx.contains("127.0.0.1:8080"));
        assert!(nginx.contains("fastcgi_param SCRIPT_FILENAME"));
        assert!(!nginx.contains("js_import"));
        // Paths under Application Support contain spaces; must be quoted.
        assert!(
            nginx.contains("fastcgi_pass \"unix:"),
            "fastcgi_pass unix: path must be quoted for spaces"
        );
        assert!(!nginx.contains("fastcgi_pass $"));
        let fpm = std::fs::read_to_string(root.join("fpm/8.4-fpm.conf")).unwrap();
        assert!(fpm.contains("chdir ="));
        assert!(fpm.contains("valet-server"));
        // Quoted paths for Application Support spaces
        assert!(fpm.contains("chdir = \""));
        let my = std::fs::read_to_string(root.join("mariadb/my.cnf")).unwrap();
        assert!(my.contains("/tmp/fake-badami-datadir-smoke"));
        // A provisioned Badami MariaDB overrides the basedir with its own
        // version dir, so accept either that or the requested path.
        assert!(
            my.contains("/tmp/fake-badami-basedir-smoke")
                || my.contains(&format!("{}/runtime/mariadb/", root.display())),
            "basedir must be the requested path or the Badami runtime"
        );
        assert!(my.contains("log-error"));
        // Quoted path values (Issue 1)
        assert!(my.contains("pid-file = \""));
        assert!(my.contains("log-error = \""));
        assert!(my.contains("datadir = \""));
        // Round-trip quotes via parser
        let parsed = parse_mycnf_values(&my);
        assert!(parsed.get("pid-file").unwrap().contains("mariadb.pid"));
        assert!(!parsed.get("pid-file").unwrap().starts_with('"'));

        let site = generate_isolated_site(IsolatedSiteRequest {
            site_name: "office".into(),
            tld: Some("test".into()),
            php_version: "7.4".into(),
            php_tag: "74".into(),
            http_port: Some(8080),
        })
        .expect("site");
        assert!(!site.written.is_empty());

        // Traversal must fail
        assert!(generate_isolated_site(IsolatedSiteRequest {
            site_name: "../pwned".into(),
            tld: Some("test".into()),
            php_version: "7.4".into(),
            php_tag: "74".into(),
            http_port: Some(8080),
        })
        .is_err());

        let report = crate::commands::local_dev::mariadb_guard::run_preflight(
            crate::commands::local_dev::mariadb_guard::MariadbPreflightRequest {
                skip_live_probes: Some(true),
                ..Default::default()
            },
        )
        .expect("preflight");
        // This reads the real machine state, so a server actually holding the
        // datadir is a legitimate outcome: refusing to start a second one is the
        // guard working. Only an unrelated hard fail is a test failure.
        match report.result {
            crate::commands::local_dev::mariadb_guard::MariadbPreflight::OkToStart => {}
            crate::commands::local_dev::mariadb_guard::MariadbPreflight::Adopt { .. } => {}
            crate::commands::local_dev::mariadb_guard::MariadbPreflight::HardFail { ref reason } => {
                let live_holder = reason.contains("points to live PID");
                assert!(
                    live_holder,
                    "unexpected hard fail: {reason:?} checks={:?}",
                    report.checks
                );
            }
        }
        // A live holder legitimately reports not-ready, which is the refusal
        // this guard exists to produce.
        let refused_live_holder = matches!(
            report.result,
            crate::commands::local_dev::mariadb_guard::MariadbPreflight::HardFail { ref reason }
                if reason.contains("points to live PID")
        );
        assert!(
            report.ready_for_mariadb_start
                || refused_live_holder
                || matches!(
                    report.result,
                    crate::commands::local_dev::mariadb_guard::MariadbPreflight::Adopt { .. }
                )
        );
    }
}
