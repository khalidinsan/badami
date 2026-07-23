//! Service specifications for the Local Dev process supervisor.
//!
//! Specs are built from discovery + generated configs under Badami local-dev home.
//! Pure data + path checks — no process spawn here.

use super::discovery::{build_runtime_paths, discover, DiscoveryReport, RuntimePaths};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

// ── Public types (plan § Process Supervisor Design) ─────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ServiceKind {
    Nginx,
    PhpFpm { version: String },
    MariaDb,
    MySql,
    Redis,
    DnsMasq,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum ServiceStatus {
    Stopped,
    Starting,
    Running {
        pid: u32,
    },
    Unhealthy {
        #[serde(skip_serializing_if = "Option::is_none")]
        pid: Option<u32>,
        reason: String,
    },
    Stopping,
    Error {
        message: String,
    },
    /// Binary or required layout missing — not a panic.
    Unavailable {
        reason: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum HealthCheck {
    PidAlive,
    Tcp { host: String, port: u16 },
    UnixSocket { path: PathBuf },
    Http { url: String, expect_status: u16 },
    Composite { checks: Vec<HealthCheck> },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceSpec {
    pub kind: ServiceKind,
    /// Stable id, e.g. `"php-fpm-8.4"`, `"mariadb"`, `"nginx"`.
    pub id: String,
    pub binary_path: PathBuf,
    pub args: Vec<String>,
    pub pid_file: PathBuf,
    pub log_file: PathBuf,
    pub working_dir: Option<PathBuf>,
    pub env: Vec<(String, String)>,
    pub health: HealthCheck,
    pub auto_restart: bool,
    pub depends_on: Vec<String>,
    /// Refuse start unless these paths exist on disk.
    pub requires_config: Vec<PathBuf>,
    /// Display label for UI.
    pub label: String,
    /// Soft flag: binary missing at build time.
    pub binary_present: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceStatusReport {
    pub id: String,
    pub label: String,
    pub kind: ServiceKind,
    pub status: ServiceStatus,
    pub binary_path: Option<String>,
    pub binary_present: bool,
    pub pid_file: String,
    pub log_file: String,
    pub auto_restart: bool,
    pub notes: Vec<String>,
}

// ── Stack order ─────────────────────────────────────────────────────

/// True if `id` is a php-fpm service (`php-fpm-7.4`, …).
pub fn is_php_fpm_id(id: &str) -> bool {
    id.starts_with("php-fpm-")
}

/// Order service ids for stack start.
///
/// DNS first (best-effort), then MariaDB, Redis, all php-fpm (sorted), nginx last.
/// Unknown ids are appended before nginx.
pub fn stack_start_order(ids: &[String]) -> Vec<String> {
    let mut dns = Vec::new();
    let mut mariadb = Vec::new();
    let mut redis = Vec::new();
    let mut fpm = Vec::new();
    let mut nginx = Vec::new();
    let mut other = Vec::new();

    for id in ids {
        match id.as_str() {
            "dnsmasq" => dns.push(id.clone()),
            "mariadb" | "mysql" => mariadb.push(id.clone()),
            "redis" => redis.push(id.clone()),
            "nginx" => nginx.push(id.clone()),
            s if is_php_fpm_id(s) => fpm.push(id.clone()),
            _ => other.push(id.clone()),
        }
    }
    fpm.sort();
    let mut out = Vec::with_capacity(ids.len());
    out.extend(dns);
    out.extend(mariadb);
    out.extend(redis);
    out.extend(fpm);
    out.extend(other);
    out.extend(nginx);
    out
}

/// Reverse of start order for stack stop.
pub fn stack_stop_order(ids: &[String]) -> Vec<String> {
    let mut v = stack_start_order(ids);
    v.reverse();
    v
}

// ── Config gate ─────────────────────────────────────────────────────

/// Returns Ok if every path in `requires_config` exists; Err with first missing.
pub fn check_requires_config(spec: &ServiceSpec) -> Result<(), String> {
    for p in &spec.requires_config {
        if !p.exists() {
            return Err(format!(
                "requires_config missing for {}: {} — run ld_generate_configs / ld_install_runtime_resources first",
                spec.id,
                p.display()
            ));
        }
    }
    Ok(())
}

// ── Spec builders ───────────────────────────────────────────────────

/// Build all known service specs from live discovery + runtime paths.
pub fn build_all_specs() -> Result<Vec<ServiceSpec>, String> {
    let paths = build_runtime_paths()?;
    let report = discover()?;
    Ok(build_specs_from_discovery(&paths, &report))
}

/// Pure builder (testable with a synthetic report).
pub fn build_specs_from_discovery(paths: &RuntimePaths, report: &DiscoveryReport) -> Vec<ServiceSpec> {
    let mut specs = Vec::new();

    specs.push(build_dnsmasq_spec(paths, report));
    specs.push(build_mariadb_spec(paths, report));
    specs.push(build_redis_spec(paths, report));

    // PHP-FPM: one per discovered version (available or not).
    let mut php_versions = report.herd.php_versions.clone();
    php_versions.sort_by(|a, b| a.version.cmp(&b.version));
    if php_versions.is_empty() {
        // Ensure at least common tags so UI can show Unavailable.
        for (ver, tag) in [("7.4", "74"), ("8.4", "84")] {
            specs.push(build_php_fpm_spec(paths, ver, tag, None, false));
        }
    } else {
        for v in &php_versions {
            specs.push(build_php_fpm_spec(
                paths,
                &v.version,
                &v.tag,
                v.fpm_path.as_deref(),
                v.available,
            ));
        }
    }

    specs.push(build_nginx_spec(paths, report));
    specs
}

fn first_candidate(report: &DiscoveryReport, role: &str) -> Option<PathBuf> {
    report
        .candidates
        .iter()
        .find(|c| c.role == role)
        .map(|c| PathBuf::from(&c.path))
}

/// Parse Mode A listen port from generated nginx confs (default 8080).
///
/// Looks for `listen 127.0.0.1:PORT` / `listen PORT` in `badami.conf` then `nginx.conf`.
pub fn parse_nginx_http_port(paths: &RuntimePaths) -> u16 {
    for name in ["badami.conf", "nginx.conf"] {
        let p = PathBuf::from(&paths.nginx).join(name);
        if let Some(port) = parse_listen_port_from_file(&p) {
            return port;
        }
    }
    8080
}

fn parse_listen_port_from_file(path: &Path) -> Option<u16> {
    let content = std::fs::read_to_string(path).ok()?;
    for raw in content.lines() {
        let line = raw.trim();
        if line.starts_with('#') {
            continue;
        }
        // listen 127.0.0.1:8080 …;  or  listen 8080 …;
        let Some(rest) = line
            .strip_prefix("listen")
            .map(str::trim_start)
            .filter(|s| !s.is_empty())
        else {
            continue;
        };
        // First token before space or semicolon
        let token = rest
            .split(|c: char| c.is_whitespace() || c == ';')
            .next()
            .unwrap_or("");
        if token.is_empty() {
            continue;
        }
        // host:port or bare port
        let port_str = token.rsplit_once(':').map(|(_, p)| p).unwrap_or(token);
        if let Ok(port) = port_str.parse::<u16>() {
            if port > 0 {
                return Some(port);
            }
        }
    }
    None
}

fn build_nginx_spec(paths: &RuntimePaths, report: &DiscoveryReport) -> ServiceSpec {
    let binary = report
        .herd
        .nginx_binary
        .as_ref()
        .map(PathBuf::from)
        .or_else(|| first_candidate(report, "nginx"))
        .unwrap_or_default();
    let conf = PathBuf::from(&paths.nginx).join("nginx.conf");
    let pid_file = PathBuf::from(&paths.pids).join("nginx.pid");
    let log_file = PathBuf::from(&paths.logs).join("nginx-error.log");
    let binary_present = binary.is_file();

    // Health port follows generated conf (not hardcoded 8080).
    let http_port = parse_nginx_http_port(paths);
    let health = HealthCheck::Composite {
        checks: vec![
            HealthCheck::PidAlive,
            HealthCheck::Tcp {
                host: "127.0.0.1".into(),
                port: http_port,
            },
        ],
    };

    // Hard deps: nginx must not start without PHP-FPM (else 502 / stuck unhealthy).
    // Prefer 7.4 when present (legacy office_* apps); include all available versions.
    let mut depends_on = Vec::new();
    for v in &report.herd.php_versions {
        if v.available {
            depends_on.push(format!("php-fpm-{}", v.version));
        }
    }
    // Prefer php-fpm-7.4 first in list for auto-start priority.
    depends_on.sort_by(|a, b| {
        let rank = |s: &str| {
            if s.contains("7.4") {
                0
            } else if s.contains("8.4") {
                1
            } else {
                2
            }
        };
        rank(a).cmp(&rank(b)).then_with(|| a.cmp(b))
    });

    ServiceSpec {
        kind: ServiceKind::Nginx,
        id: "nginx".into(),
        binary_path: binary,
        args: vec![
            "-c".into(),
            conf.to_string_lossy().into_owned(),
            "-p".into(),
            paths.nginx.clone(),
            "-g".into(),
            "daemon on;".into(),
        ],
        pid_file,
        log_file,
        working_dir: Some(PathBuf::from(&paths.nginx)),
        env: vec![],
        health,
        auto_restart: true,
        depends_on,
        requires_config: vec![conf],
        label: "nginx".into(),
        binary_present,
    }
}

fn build_php_fpm_spec(
    paths: &RuntimePaths,
    version: &str,
    tag: &str,
    fpm_path: Option<&str>,
    available: bool,
) -> ServiceSpec {
    let binary = fpm_path.map(PathBuf::from).unwrap_or_default();
    let conf = PathBuf::from(&paths.fpm).join(format!("{version}-fpm.conf"));
    let pid_file = PathBuf::from(&paths.pids).join(format!("php{tag}-fpm.pid"));
    let log_file = PathBuf::from(&paths.logs).join(format!("php-fpm-{tag}.log"));
    let sock = PathBuf::from(&paths.socks).join(format!("php{tag}.sock"));
    let binary_present = available && binary.is_file();

    let health = HealthCheck::Composite {
        checks: vec![
            HealthCheck::PidAlive,
            HealthCheck::UnixSocket { path: sock },
        ],
    };

    // php-fpm -y <pool-conf>  (our pool conf includes [global] + [badami])
    let args = vec!["-y".into(), conf.to_string_lossy().into_owned()];

    ServiceSpec {
        kind: ServiceKind::PhpFpm {
            version: version.to_string(),
        },
        id: format!("php-fpm-{version}"),
        binary_path: binary,
        args,
        pid_file,
        log_file,
        working_dir: None,
        env: vec![],
        health,
        auto_restart: true,
        depends_on: vec![],
        requires_config: vec![conf],
        label: format!("PHP-FPM {version}"),
        binary_present,
    }
}

fn build_mariadb_spec(paths: &RuntimePaths, report: &DiscoveryReport) -> ServiceSpec {
    let wrapper = PathBuf::from(&paths.mariadb).join("my.cnf");
    let pid_file = PathBuf::from(&paths.pids).join("mariadb.pid");
    let log_file = PathBuf::from(&paths.logs).join("mariadb.log");

    // Prefer basedir/bin/mariadbd from wrapper when present; else discovery candidates.
    let binary = resolve_mariadbd_binary(report, &wrapper);
    let binary_present = binary.is_file();

    let port = parse_port_from_mycnf(&wrapper).unwrap_or(3306);
    let socket = parse_socket_from_mycnf(&wrapper)
        .unwrap_or_else(|| PathBuf::from(&paths.socks).join("mariadb.sock"));

    let health = HealthCheck::Composite {
        checks: vec![
            HealthCheck::PidAlive,
            HealthCheck::UnixSocket {
                path: socket.clone(),
            },
            HealthCheck::Tcp {
                host: "127.0.0.1".into(),
                port,
            },
        ],
    };

    ServiceSpec {
        kind: ServiceKind::MariaDb,
        id: "mariadb".into(),
        binary_path: binary,
        args: vec![format!("--defaults-file={}", wrapper.display())],
        pid_file,
        log_file,
        working_dir: None,
        env: vec![],
        health,
        // Hard rule: never auto-restart MariaDB (InnoDB safety).
        auto_restart: false,
        depends_on: vec![],
        requires_config: vec![wrapper],
        label: "MariaDB".into(),
        binary_present,
    }
}

fn resolve_mariadbd_binary(report: &DiscoveryReport, wrapper: &Path) -> PathBuf {
    // 1. Wrapper basedir/bin/mariadbd
    if let Ok(cfg) = super::mariadb_guard::load_wrapper_config(wrapper) {
        let candidate = cfg.basedir.join("bin").join("mariadbd");
        if candidate.is_file() {
            return candidate;
        }
        let mysqld = cfg.basedir.join("bin").join("mysqld");
        if mysqld.is_file() {
            return mysqld;
        }
    }
    // 2. Discovery candidates
    if let Some(p) = first_candidate(report, "mariadbd") {
        return p;
    }
    if let Some(p) = first_candidate(report, "mysqld") {
        return p;
    }
    PathBuf::new()
}

fn parse_port_from_mycnf(path: &Path) -> Option<u16> {
    let s = std::fs::read_to_string(path).ok()?;
    let map = super::config_gen::parse_mycnf_values(&s);
    map.get("port").and_then(|p| p.parse().ok())
}

fn parse_socket_from_mycnf(path: &Path) -> Option<PathBuf> {
    let s = std::fs::read_to_string(path).ok()?;
    let map = super::config_gen::parse_mycnf_values(&s);
    map.get("socket").map(PathBuf::from)
}

/// Resolve mariadb-admin / mysqladmin from the same basedir as mariadbd.
pub fn resolve_mariadb_admin(report: &DiscoveryReport, wrapper: &Path) -> Option<PathBuf> {
    if let Ok(cfg) = super::mariadb_guard::load_wrapper_config(wrapper) {
        for name in ["mariadb-admin", "mysqladmin"] {
            let p = cfg.basedir.join("bin").join(name);
            if p.is_file() {
                return Some(p);
            }
        }
    }
    // Fall back to discovery / herd bin
    for role in ["mariadb-admin", "mysqladmin"] {
        if let Some(p) = first_candidate(report, role) {
            return Some(p);
        }
    }
    // Common Herd bin names
    if let Some(home) = std::env::var_os("HOME") {
        let bin = PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("Herd")
            .join("bin");
        for name in ["mariadb-admin", "mysqladmin"] {
            let p = bin.join(name);
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

fn build_redis_spec(paths: &RuntimePaths, report: &DiscoveryReport) -> ServiceSpec {
    let binary = report
        .herd
        .redis
        .as_ref()
        .and_then(|r| r.redis_server.as_ref())
        .map(PathBuf::from)
        .or_else(|| first_candidate(report, "redis-server"))
        .unwrap_or_default();
    let binary_present = binary.is_file();

    let pid_file = PathBuf::from(&paths.pids).join("redis.pid");
    let log_file = PathBuf::from(&paths.logs).join("redis.log");

    // Always use Badami-owned pid/log paths. Optional Herd conf is included first
    // but CLI flags after conf override pidfile/logfile/bind/port so we own lifecycle.
    let mut args = Vec::new();
    if let Some(conf) = report
        .herd
        .redis
        .as_ref()
        .and_then(|r| r.service_conf.as_ref())
    {
        let conf_pb = PathBuf::from(conf);
        if conf_pb.is_file() {
            args.push(conf.clone());
        }
    }
    // argv-only overrides — no shell. These win over conf for redis-server.
    args.extend([
        "--port".into(),
        "6379".into(),
        "--bind".into(),
        "127.0.0.1".into(),
        "--daemonize".into(),
        "yes".into(),
        "--pidfile".into(),
        pid_file.to_string_lossy().into_owned(),
        "--logfile".into(),
        log_file.to_string_lossy().into_owned(),
    ]);

    let health = HealthCheck::Composite {
        checks: vec![
            HealthCheck::PidAlive,
            HealthCheck::Tcp {
                host: "127.0.0.1".into(),
                port: 6379,
            },
        ],
    };

    ServiceSpec {
        kind: ServiceKind::Redis,
        id: "redis".into(),
        binary_path: binary,
        args,
        pid_file,
        log_file,
        working_dir: None,
        env: vec![],
        health,
        auto_restart: true,
        depends_on: vec![],
        requires_config: vec![],
        label: "Redis".into(),
        binary_present,
    }
}

/// Parse `port=N` from Badami dnsmasq.conf (default 53535 for Mode A unprivileged).
pub fn parse_dnsmasq_port(paths: &RuntimePaths) -> u16 {
    let conf = PathBuf::from(&paths.local_dev_root)
        .join("dnsmasq")
        .join("dnsmasq.conf");
    if let Ok(text) = std::fs::read_to_string(&conf) {
        for line in text.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            if let Some(rest) = line.strip_prefix("port=") {
                if let Ok(p) = rest.trim().parse::<u16>() {
                    if p > 0 {
                        return p;
                    }
                }
            }
        }
    }
    53535 // Mode A default — port 53 needs root
}

fn build_dnsmasq_spec(paths: &RuntimePaths, report: &DiscoveryReport) -> ServiceSpec {
    let binary = report
        .herd
        .dnsmasq_binary
        .as_ref()
        .map(PathBuf::from)
        .or_else(|| first_candidate(report, "dnsmasq"))
        .unwrap_or_default();
    let binary_present = binary.is_file();
    let conf = PathBuf::from(&paths.local_dev_root)
        .join("dnsmasq")
        .join("dnsmasq.conf");
    let pid_file = PathBuf::from(&paths.pids).join("dnsmasq.pid");
    let log_file = PathBuf::from(&paths.logs).join("dnsmasq.log");
    let dns_port = parse_dnsmasq_port(paths);

    // Conf already has pid-file / log-facility / port. Only pass --conf-file so we
    // don't fight daemonize + double flags. dnsmasq daemonizes by default.
    let args = vec![
        "--conf-file".into(),
        conf.to_string_lossy().into_owned(),
    ];

    // dnsmasq daemonizes: parent exits immediately; health must re-read pid-file.
    // Prefer TCP probe on configured port (dnsmasq often binds both UDP+TCP).
    // If TCP fails on some builds, spawn_service still accepts a live pid-file.
    let _ = dns_port; // used by health probe below
    let health = HealthCheck::Composite {
        checks: vec![
            HealthCheck::PidAlive,
            HealthCheck::Tcp {
                host: "127.0.0.1".into(),
                port: dns_port,
            },
        ],
    };

    ServiceSpec {
        kind: ServiceKind::DnsMasq,
        id: "dnsmasq".into(),
        binary_path: binary,
        args,
        pid_file,
        log_file,
        working_dir: None,
        env: vec![],
        health,
        auto_restart: true,
        depends_on: vec![],
        requires_config: vec![conf],
        label: "dnsmasq".into(),
        binary_present,
    }
}

// ── Lookups ─────────────────────────────────────────────────────────

pub fn find_spec<'a>(specs: &'a [ServiceSpec], id: &str) -> Option<&'a ServiceSpec> {
    specs.iter().find(|s| s.id == id)
}

/// Validate service_id is a safe token (no path injection).
pub fn validate_service_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > 64 {
        return Err("service_id must be 1–64 characters".into());
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
    {
        return Err(format!("invalid service_id: {id:?}"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stack_start_order_dns_first_nginx_last() {
        let ids = vec![
            "nginx".into(),
            "php-fpm-8.4".into(),
            "mariadb".into(),
            "redis".into(),
            "dnsmasq".into(),
            "php-fpm-7.4".into(),
        ];
        let ordered = stack_start_order(&ids);
        assert_eq!(ordered.first().map(String::as_str), Some("dnsmasq"));
        assert_eq!(ordered.last().map(String::as_str), Some("nginx"));
        assert!(ordered.iter().position(|s| s == "mariadb").unwrap()
            < ordered.iter().position(|s| s == "redis").unwrap());
        assert!(ordered.iter().position(|s| s == "redis").unwrap()
            < ordered.iter().position(|s| s == "php-fpm-7.4").unwrap());
        // php-fpm sorted
        let i74 = ordered.iter().position(|s| s == "php-fpm-7.4").unwrap();
        let i84 = ordered.iter().position(|s| s == "php-fpm-8.4").unwrap();
        assert!(i74 < i84);
    }

    #[test]
    fn stack_stop_is_reverse_of_start() {
        let ids = vec![
            "nginx".into(),
            "php-fpm-8.4".into(),
            "mariadb".into(),
            "redis".into(),
            "dnsmasq".into(),
        ];
        let start = stack_start_order(&ids);
        let stop = stack_stop_order(&ids);
        let mut rev = start.clone();
        rev.reverse();
        assert_eq!(stop, rev);
        assert_eq!(stop.first().map(String::as_str), Some("nginx"));
        assert_eq!(stop.last().map(String::as_str), Some("dnsmasq"));
    }

    #[test]
    fn validate_service_id_rejects_path() {
        assert!(validate_service_id("../etc").is_err());
        assert!(validate_service_id("php-fpm-8.4").is_ok());
        assert!(validate_service_id("mariadb").is_ok());
        assert!(validate_service_id("a;b").is_err());
    }

    #[test]
    fn check_requires_config_missing() {
        let spec = ServiceSpec {
            kind: ServiceKind::Nginx,
            id: "nginx".into(),
            binary_path: PathBuf::from("/usr/bin/true"),
            args: vec![],
            pid_file: PathBuf::from("/tmp/x.pid"),
            log_file: PathBuf::from("/tmp/x.log"),
            working_dir: None,
            env: vec![],
            health: HealthCheck::PidAlive,
            auto_restart: true,
            depends_on: vec![],
            requires_config: vec![PathBuf::from(
                "/tmp/definitely-missing-badami-nginx-conf-xyz.conf",
            )],
            label: "nginx".into(),
            binary_present: true,
        };
        let err = check_requires_config(&spec).unwrap_err();
        assert!(err.contains("requires_config"));
    }

    #[test]
    fn parse_listen_port_from_badami_style() {
        let dir = std::env::temp_dir().join(format!("badami-ngx-port-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let conf = dir.join("badami.conf");
        std::fs::write(
            &conf,
            "server {\n    listen 127.0.0.1:9080 default_server;\n}\n",
        )
        .unwrap();
        assert_eq!(parse_listen_port_from_file(&conf), Some(9080));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn mariadb_spec_auto_restart_is_false() {
        // Spec builder hardcodes auto_restart: false for MariaDB (kind-level safety).
        let paths = RuntimePaths {
            local_dev_root: "/tmp/ld".into(),
            config_valet: "/tmp/ld/config/valet".into(),
            nginx: "/tmp/ld/nginx".into(),
            fpm: "/tmp/ld/fpm".into(),
            socks: "/tmp/ld/socks".into(),
            mariadb: "/tmp/ld/mariadb".into(),
            valet_server: "/tmp/ld/valet-server".into(),
            pids: "/tmp/ld/pids".into(),
            logs: "/tmp/ld/logs".into(),
            import: "/tmp/ld/import".into(),
        };
        // Use live discovery when available; empty-ish herd still emits a mariadb spec.
        let report = crate::commands::local_dev::discovery::discover()
            .expect("discover returns Ok even without Herd");
        let specs = build_specs_from_discovery(&paths, &report);
        let maria = specs.iter().find(|s| s.id == "mariadb").expect("mariadb");
        assert!(!maria.auto_restart, "MariaDB must never auto_restart");
        assert!(matches!(maria.kind, ServiceKind::MariaDb));
    }
}
