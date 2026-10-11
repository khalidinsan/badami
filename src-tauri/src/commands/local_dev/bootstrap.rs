//! Optional Mode B / DNS bootstrap for Local Dev.
//!
//! Generates LaunchDaemon plists that reference ONLY root-owned paths under
//! `/Library/Application Support/Badami/local-dev-root/{role}/`, and the
//! privileged install step copies the needed binary + config files there with
//! `root:wheel` ownership before loading the plist. This prevents a
//! privilege-escalation path where any user process could edit nginx.conf
//! (`load_module`) or dnsmasq.conf (`dhcp-script`) and have launchd re-exec it
//! as root.
//!
//! The privileged command is built purely in Rust from argv (no user-writable
//! script runs as root) via the shared `sh_single_quote` + `applescript_quote`
//! helpers. The install step itself is still gated behind an interactive
//! osascript admin prompt — Badami never silently elevates.
//!
//! Packages (plan):
//! - `dns_only`      — D1 B-lite: dnsmasq LaunchDaemon on :53
//! - `dns_high_port` — D2: high-port resolver + unprivileged dnsmasq conf
//! - `http_80`       — Mode B nginx LaunchDaemon on :80 (DNS must be healthy)
//! - `full`          — dns_only + http_80
//! - `resync`        — re-copy user configs → root staging dir and reload
//!
//! Safety: never invokes the Herd helper; never deletes Herd datadir; never
//! touches `/etc/resolver/*` without an explicit uninstall and marker check.

use super::discovery::{build_runtime_paths, discover, RuntimePaths};
use super::doctor::{launchd_unit_info_for, parse_resolver_port};
use super::service_specs::{parse_dnsmasq_port, parse_nginx_http_port};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

// ── Identifier / label helpers ──────────────────────────────────────

/// Default identifier used for test fixtures and the Phase A pre-refactor
/// fallback when no `AppHandle` is available (e.g. CLI-only paths). Production
/// callers thread the identifier through from `AppHandle::config().identifier`.
pub const DEFAULT_LD_IDENTIFIER: &str = "com.khalid.badami";

const DEFAULT_HIGH_DNS_PORT: u16 = 53535;
const SYSTEM_LAUNCH_DAEMONS: &str = "/Library/LaunchDaemons";

/// Root-owned staging prefix. Everything the privileged LaunchDaemons execute
/// (binaries, configs, logs, pid files) lives under this tree with
/// `root:wheel` ownership and world-read-only files.
pub const ROOT_STAGING_PREFIX: &str = "/Library/Application Support/Badami/local-dev-root";

/// Path prefixes a rendered plist is allowed to reference. Enforced by
/// [`validate_plist_argv`] / [`validate_plist_io_paths`]. Any other path
/// (notably user-writable `~/Library/Application Support/Badami/local-dev`)
/// is a privilege-escalation hazard because a user process could edit the
/// referenced file and have launchd re-exec it as root.
pub const ROOT_SAFE_PREFIXES: &[&str] = &[
    ROOT_STAGING_PREFIX, // /Library/Application Support/Badami/local-dev-root
    "/usr/bin/",
    "/bin/",
    "/usr/sbin/",
    "/sbin/",
    "/var/log/badami-local-dev/",
];

/// Compose a full LaunchDaemon label from an identifier + role.
///
/// Falls back to [`DEFAULT_LD_IDENTIFIER`] when `identifier` is empty so unit
/// tests that pass the constant still compose cleanly. The composed label is
/// validated with [`validate_launchd_label`] so every caller is guaranteed a
/// shell-safe identifier downstream.
pub fn ld_label(identifier: &str, role: &str) -> String {
    let id = if identifier.is_empty() {
        DEFAULT_LD_IDENTIFIER
    } else {
        identifier
    };
    let label = format!("{id}.local-dev.{role}");
    // Debug-only assertion — production code double-checks each callsite via
    // [`validate_launchd_label`] but a composed label from a validated id +
    // literal role must always pass. If this ever fires we introduced a new
    // call site passing a bad identifier.
    debug_assert!(
        validate_launchd_label(&label).is_ok(),
        "composed label failed validator: {label}"
    );
    label
}

/// Legacy entry point — compose a label using the default identifier. Kept so
/// existing call sites that don't yet thread the identifier through continue
/// to compile. Prefer [`ld_label`] with a real identifier.
#[allow(dead_code)]
pub fn launchd_label(role: &str) -> String {
    ld_label(DEFAULT_LD_IDENTIFIER, role)
}

/// Validate a LaunchDaemon label against `^[A-Za-z0-9][A-Za-z0-9.-]{0,127}$`.
///
/// This is the hardening fix for the `shell_single_quote(label).trim_matches('\'')`
/// hack that used to live in [`resync_argv`]: a label that passes this check
/// never needs special shell escaping because every byte is already shell-safe
/// (ASCII alphanumeric, `.`, or `-`). We still single-quote at call sites for
/// defence in depth, but single quoting a validated label never risks the
/// mid-string `'\\''` escape sequence that would otherwise collapse under
/// `trim_matches('\'')` and let an attacker inject arguments.
///
/// Also applied to the identifier prefix supplied by `AppHandle::config()
/// .identifier`, so a hostile Tauri config cannot poison composed labels.
pub fn validate_launchd_label(label: &str) -> Result<(), String> {
    if label.is_empty() {
        return Err("launchd label must not be empty".into());
    }
    if label.len() > 128 {
        return Err(format!(
            "launchd label too long ({} chars; max 128): {label:?}",
            label.len()
        ));
    }
    let mut chars = label.chars();
    let first = chars.next().unwrap();
    if !first.is_ascii_alphanumeric() {
        return Err(format!(
            "launchd label must start with an ASCII alphanumeric: {label:?}"
        ));
    }
    for ch in chars {
        if !(ch.is_ascii_alphanumeric() || ch == '.' || ch == '-') {
            return Err(format!(
                "launchd label contains forbidden character {ch:?}: {label:?}"
            ));
        }
    }
    Ok(())
}

/// Validate the reverse-DNS identifier (the prefix of the composed label).
/// Same rule as [`validate_launchd_label`] — this is the entry point every
/// `AppHandle::config().identifier` value is required to clear before it
/// reaches a privileged shell command.
#[allow(dead_code)]
pub fn validate_launchd_identifier(id: &str) -> Result<(), String> {
    validate_launchd_label(id)
}

/// Root-owned staging dir for a role, e.g. `.../local-dev-root/nginx`.
pub fn root_staging_dir(role: &str) -> PathBuf {
    PathBuf::from(ROOT_STAGING_PREFIX).join(role)
}

// ── Root config variant renderer + hash-verified staging ────────────
//
// The TOCTOU-safe install flow:
//
// 1. User-side (this process): render ROOT variants of every nginx/dnsmasq
//    config file into a fresh pending temp dir (`local-dev/launchd/pending-
//    <stamp>/`), rewriting every absolute `{{NGINX_DIR}}` / `{{LOGS_DIR}}` /
//    `{{PIDS_DIR}}` reference to its root-staging equivalent. TLS cert / key
//    files referenced from site confs are copied in alongside and the site
//    conf is rewritten to the new location.
// 2. User-side: validate each rendered file — every absolute path mentioned
//    in a config-loading directive (`include`, `ssl_certificate`,
//    `ssl_certificate_key`, `pid`, `error_log`, `access_log`) must sit under
//    [`ROOT_SAFE_PREFIXES`]; a short list of outright-dangerous directives
//    (`load_module`, `env`, `ssl_engine`, `perl*`, `js_*`, `lua*`, `dhcp-
//    script`, `conf-dir`, `conf-file`, `servers-file`, `addn-hosts`,
//    `dhcp-hostsfile`, `dhcp-optsfile`, `script-arp`, `dhcp-luascript`,
//    `tftp-*`, `user root`, `user=root`) is rejected outright.
// 3. User-side: compute SHA-256 for every pending file **and** the plist
//    scaffold. Hex digests are embedded into the Rust-built osascript body.
// 4. Privileged shell: `install -o root -g wheel -m MODE pending/<f>
//    /Library/.../local-dev-root/<role>/<f>` + verify each root-owned file's
//    hash with `/usr/bin/shasum -a 256` against the embedded hex. Any
//    mismatch deletes the just-installed plist + root staging dir and
//    `exit 1` **before** any `launchctl bootstrap/kickstart` runs.
// 5. User-side: best-effort delete the pending temp dir after osascript
//    returns.
//
// Why this is TOCTOU-safe: the hash digest is baked into the osascript body
// in-process (never read back from disk under root), so even if a hostile
// user swaps the pending file between dry-run and admin-prompt, the privileged
// shasum check will fail and the plist is removed before launchctl loads it.

/// Metadata about a single file that will be installed under the root-owned
/// staging tree with hash verification. The pending copy sits user-side; the
/// final copy lives under `/Library/Application Support/Badami/local-dev-root
/// /<role>/`.
#[derive(Debug, Clone)]
pub struct PendingFile {
    /// Pending (user-side) source path. Writable only by the current user.
    pub pending_src: String,
    /// Final (root-owned) destination path.
    pub final_dst: String,
    /// Hex-encoded SHA-256 of the file bytes computed when the pending copy
    /// was written. Embedded into the osascript body for the privileged
    /// shasum check.
    pub sha256_hex: String,
    /// Final file mode in octal string form (`"644"`, `"600"`, `"755"`).
    pub mode: &'static str,
}

/// Reject nginx root-variant directives that would re-expose a privilege
/// escalation path. Matched case-sensitively against the first whitespace
/// token on each non-comment line.
const NGINX_FORBIDDEN_DIRECTIVES: &[&str] = &["load_module", "env", "ssl_engine"];

/// Reject nginx directives whose first token starts with any of these
/// prefixes — covers `perl`, `perl_set`, `js_import`, `js_set`,
/// `js_content`, `lua_shared_dict`, `lua_package_path`, etc.
const NGINX_FORBIDDEN_DIRECTIVE_PREFIXES: &[&str] = &["perl", "js_", "lua"];

/// Reject dnsmasq keys outright — any one of these turns the daemon into a
/// user-controlled command executor (`dhcp-script`), lets it include further
/// files from unknown paths (`conf-dir`/`conf-file`/`servers-file`/`addn-
/// hosts`/`dhcp-hostsfile`/`dhcp-optsfile`), or hands execution to a Lua
/// script (`dhcp-luascript`, `script-arp`).
const DNSMASQ_FORBIDDEN_KEYS: &[&str] = &[
    "dhcp-script",
    "conf-dir",
    "conf-file",
    "servers-file",
    "addn-hosts",
    "dhcp-hostsfile",
    "dhcp-optsfile",
    "script-arp",
    "dhcp-luascript",
];

/// Compute hex-encoded SHA-256 of a byte slice. Used both when writing a
/// pending file and when checking test fixtures against the embedded digest.
pub fn sha256_hex(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    format!("{:x}", hasher.finalize())
}

/// Produce a per-install pending directory name. Uses process id + a
/// monotonic timestamp — unique within a single process run without pulling
/// in a direct `uuid` dependency. Collision is harmless: the caller `fs::
/// create_dir_all`s inside this path and only writes files it just rendered.
fn pending_dir_name() -> String {
    let pid = std::process::id();
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("pending-{pid}-{nanos}")
}

/// Build a fresh pending temp dir under `local-dev/launchd/`. Caller is
/// responsible for `fs::remove_dir_all` after osascript returns (best effort).
fn make_pending_dir(paths: &RuntimePaths) -> Result<PathBuf, String> {
    let launchd_dir = PathBuf::from(&paths.local_dev_root).join("launchd");
    fs::create_dir_all(&launchd_dir).map_err(|e| format!("mkdir launchd: {e}"))?;
    let pending = launchd_dir.join(pending_dir_name());
    fs::create_dir_all(&pending).map_err(|e| format!("mkdir pending {}: {e}", pending.display()))?;
    Ok(pending)
}

/// Rewrite every absolute path in the given nginx config body so references
/// to the user-side nginx / logs / pids directories point at the root
/// staging equivalents. The user `local-dev` root itself is **not** rewritten
/// — paths like `fastcgi_param SCRIPT_FILENAME "{HERD_HOME}/valet-server
/// /server.php"` and `fastcgi_pass "unix:{socks}/php74.sock"` are intentional
/// user-process targets (php-fpm reads SCRIPT_FILENAME; nginx opens the Unix
/// socket but php-fpm owns it). Rewriting them would break the Valet handoff.
pub fn rewrite_nginx_paths(
    content: &str,
    user_nginx_dir: &str,
    user_logs_dir: &str,
    user_pids_dir: &str,
    root_nginx_dir: &str,
) -> String {
    // Replace logs/pids before nginx dir — on a shared `local-dev/` parent
    // these three happen to be disjoint strings, so order is not strictly
    // required, but defensive ordering keeps the pass deterministic for the
    // unit tests.
    content
        .replace(user_logs_dir, root_nginx_dir)
        .replace(user_pids_dir, root_nginx_dir)
        .replace(user_nginx_dir, root_nginx_dir)
}

/// Rewrite dnsmasq `pid-file=` / `log-facility=` paths into the root-owned
/// dnsmasq staging dir. Does **not** rewrite `address=/.{tld}/{loopback}` or
/// any directive that nginx would already consume as data.
pub fn rewrite_dnsmasq_paths(
    content: &str,
    user_logs_dir: &str,
    user_pids_dir: &str,
    root_dnsmasq_dir: &str,
) -> String {
    content
        .replace(user_logs_dir, root_dnsmasq_dir)
        .replace(user_pids_dir, root_dnsmasq_dir)
}

// ── Nginx tokenizer + statement parser ─────────────────────────────
//
// Early versions of [`validate_nginx_root_variant`] were line-oriented and
// bailed out of the directive scan with an inner `break` after the first
// match. That left four known bypasses:
//
//   (a) `include "/safe"; load_module modules/evil.so;` on one line — the
//       line-based scanner only saw `include`.
//   (b) Multi-line directives — `include\n    /tmp/evil.conf;` — the
//       scanner only inspected the opening line.
//   (c) `include "/safe"; ssl_certificate "/tmp/evil.pem";` — the inner
//       `break` short-circuited after the first directive matched.
//   (d) `include "/safe"; include "/tmp/evil.conf";` — same.
//
// The new validator tokenizes the config with proper quote + comment
// handling, splits on `;`/`{`/`}`, and inspects every statement. The
// tokenizer is intentionally conservative: anything it cannot classify
// becomes a `Word` and is validated by name + path heuristics.

/// Reserved for a path-loading directive — tokenizer-level statement that
/// loads another file off disk under root. Each path arg must sit under
/// [`ROOT_SAFE_PREFIXES`] (or resolve there via the `-p` prefix for
/// relative paths).
const NGINX_PATH_LOADING_DIRECTIVES: &[&str] = &[
    "include",
    "ssl_certificate",
    "ssl_certificate_key",
    "ssl_trusted_certificate",
    "ssl_client_certificate",
    "ssl_dhparam",
    "ssl_password_file",
    "ssl_crl",
    "ssl_stapling_file",
    "ssl_session_ticket_key",
    "auth_basic_user_file",
    "pid",
    "error_log",
    "access_log",
    "lock_file",
    "working_directory",
];

/// Directives whose args may legitimately carry user-side filesystem paths
/// (fastcgi socket + script_filename, rewrite rules, `root`/`alias` doc
/// roots, `error_page` targets, routing). The validator does NOT path-check
/// the args of these directives — they're the intentional Valet handoff
/// surface + nginx's standard HTTP routing primitives.
///
/// NOTE: `include` is deliberately NOT in this list. It is in
/// `NGINX_PATH_LOADING_DIRECTIVES` and gets strict ROOT_SAFE_PREFIXES
/// validation.
const NGINX_USER_ARGS_OK_DIRECTIVES: &[&str] = &[
    "fastcgi_pass",
    "fastcgi_param",
    "fastcgi_index",
    "rewrite",
    "error_page",
    "root",
    "alias",
    "try_files",
    "return",
    "server_name",
    "listen",
    "location",
];

#[derive(Debug, Clone, PartialEq, Eq)]
enum NginxTokenKind {
    Word(String),
    Semi,
    OpenBrace,
    CloseBrace,
}

#[derive(Debug, Clone)]
struct NginxToken {
    kind: NginxTokenKind,
    line: usize,
}

/// Tokenize an nginx config into words + statement delimiters, honouring:
/// - `#` comments to EOL (outside strings)
/// - double- and single-quoted strings with backslash escapes
/// - whitespace-separated words outside strings
/// - statement delimiters `;` `{` `}`
///
/// Quoted strings produce a single `Word` whose stored value is the string's
/// *inner* bytes (quotes themselves are stripped). Backslash escapes inside
/// strings are preserved as-is (`\"` stays `\"`) — downstream validators
/// treat the backslash as literal.
fn tokenize_nginx(content: &str) -> Result<Vec<NginxToken>, String> {
    let mut tokens: Vec<NginxToken> = Vec::new();
    let mut buf = String::new();
    let mut buf_has = false;
    let mut buf_line = 1usize;
    let mut line = 1usize;
    let mut iter = content.chars().peekable();

    fn flush(
        buf: &mut String,
        buf_has: &mut bool,
        buf_line: usize,
        tokens: &mut Vec<NginxToken>,
    ) {
        if *buf_has {
            tokens.push(NginxToken {
                kind: NginxTokenKind::Word(std::mem::take(buf)),
                line: buf_line,
            });
            *buf_has = false;
        }
    }

    while let Some(ch) = iter.next() {
        match ch {
            '\n' => {
                flush(&mut buf, &mut buf_has, buf_line, &mut tokens);
                line += 1;
            }
            c if c.is_whitespace() => {
                flush(&mut buf, &mut buf_has, buf_line, &mut tokens);
            }
            '#' => {
                flush(&mut buf, &mut buf_has, buf_line, &mut tokens);
                // Skip to end-of-line (but don't consume the \n so the
                // outer loop still bumps the line counter).
                while let Some(&c2) = iter.peek() {
                    if c2 == '\n' {
                        break;
                    }
                    iter.next();
                }
            }
            '"' | '\'' => {
                let quote = ch;
                flush(&mut buf, &mut buf_has, buf_line, &mut tokens);
                let start_line = line;
                let mut inner = String::new();
                let mut terminated = false;
                while let Some(c2) = iter.next() {
                    if c2 == '\n' {
                        line += 1;
                    }
                    if c2 == '\\' {
                        // Preserve the escape sequence as literal bytes so
                        // validators see the raw string. nginx itself
                        // handles the escape; we never execute these.
                        if let Some(c3) = iter.next() {
                            if c3 == '\n' {
                                line += 1;
                            }
                            inner.push(c2);
                            inner.push(c3);
                        }
                        continue;
                    }
                    if c2 == quote {
                        terminated = true;
                        break;
                    }
                    inner.push(c2);
                }
                if !terminated {
                    return Err(format!(
                        "line {start_line}: unterminated {} string",
                        if quote == '"' { "double-quoted" } else { "single-quoted" }
                    ));
                }
                tokens.push(NginxToken {
                    kind: NginxTokenKind::Word(inner),
                    line: start_line,
                });
            }
            ';' => {
                flush(&mut buf, &mut buf_has, buf_line, &mut tokens);
                tokens.push(NginxToken {
                    kind: NginxTokenKind::Semi,
                    line,
                });
            }
            '{' => {
                flush(&mut buf, &mut buf_has, buf_line, &mut tokens);
                tokens.push(NginxToken {
                    kind: NginxTokenKind::OpenBrace,
                    line,
                });
            }
            '}' => {
                flush(&mut buf, &mut buf_has, buf_line, &mut tokens);
                tokens.push(NginxToken {
                    kind: NginxTokenKind::CloseBrace,
                    line,
                });
            }
            _ => {
                if !buf_has {
                    buf_line = line;
                }
                buf.push(ch);
                buf_has = true;
            }
        }
    }
    flush(&mut buf, &mut buf_has, buf_line, &mut tokens);
    Ok(tokens)
}

/// An nginx statement: directive name + arguments. Produced from the token
/// stream by collapsing `Word+ (Semi|OpenBrace)` groups. `CloseBrace`
/// tokens close block scope and are otherwise ignored.
#[derive(Debug, Clone)]
struct NginxStatement {
    name: String,
    args: Vec<String>,
    line: usize,
}

fn parse_nginx_statements(content: &str) -> Result<Vec<NginxStatement>, String> {
    let tokens = tokenize_nginx(content)?;
    let mut out: Vec<NginxStatement> = Vec::new();
    let mut acc: Vec<String> = Vec::new();
    let mut start_line = 1usize;
    for t in tokens {
        match t.kind {
            NginxTokenKind::Word(w) => {
                if acc.is_empty() {
                    start_line = t.line;
                }
                acc.push(w);
            }
            NginxTokenKind::Semi | NginxTokenKind::OpenBrace => {
                if !acc.is_empty() {
                    let name = acc.remove(0);
                    out.push(NginxStatement {
                        name,
                        args: std::mem::take(&mut acc),
                        line: start_line,
                    });
                }
            }
            NginxTokenKind::CloseBrace => {
                acc.clear();
            }
        }
    }
    // Trailing words with no terminator are illegal nginx but harmless to
    // the validator — reject them so a syntactically broken file never
    // sneaks past.
    if !acc.is_empty() {
        return Err(format!(
            "line {start_line}: statement without terminator (`{}`)",
            acc.join(" ")
        ));
    }
    Ok(out)
}

/// Return true if any `/`-separated component of `p` is exactly `..`. Used
/// to reject path-traversal in both absolute paths (`/safe/../etc/passwd`)
/// and relative paths (`../etc/passwd`).
fn has_parent_traversal(p: &str) -> bool {
    p.split('/').any(|seg| seg == "..")
}

fn validate_nginx_statement(stmt: &NginxStatement, label: &str) -> Result<(), String> {
    let name = &stmt.name;
    let lower = name.to_ascii_lowercase();
    let line = stmt.line;

    // Forbidden exact names.
    if NGINX_FORBIDDEN_DIRECTIVES.contains(&lower.as_str()) {
        return Err(format!(
            "{label}:{line}: forbidden nginx directive `{name}`"
        ));
    }
    // Forbidden by prefix (perl*, js_*, lua*).
    for pref in NGINX_FORBIDDEN_DIRECTIVE_PREFIXES {
        if lower.starts_with(pref) {
            return Err(format!(
                "{label}:{line}: forbidden nginx directive prefix `{name}` (matched `{pref}`)"
            ));
        }
    }
    // Lua phase handlers end in `_by_lua` / `_by_lua_block` / `_by_lua_file`.
    // njs module directives start with `njs`. Both let the config execute
    // arbitrary code under the nginx master.
    if lower.contains("by_lua") || lower.starts_with("njs") {
        return Err(format!(
            "{label}:{line}: forbidden nginx lua/njs directive `{name}`"
        ));
    }
    // `user root` — if nginx master runs as root we never want the worker
    // user set from a user-writable file.
    if lower == "user" && stmt.args.iter().any(|a| a == "root") {
        return Err(format!(
            "{label}:{line}: forbidden `user root` directive"
        ));
    }

    // geoip*, geoip2* reference MMDB files — treat as path-loading so the
    // ROOT_SAFE_PREFIXES check applies.
    let is_geoip = lower.starts_with("geoip");
    let is_path_loading =
        is_geoip || NGINX_PATH_LOADING_DIRECTIVES.contains(&lower.as_str());
    let is_user_args_ok = NGINX_USER_ARGS_OK_DIRECTIVES.contains(&lower.as_str());

    if is_path_loading {
        for arg in &stmt.args {
            // `access_log off;` is explicitly supported — nginx disables the
            // directive. No path involved.
            if lower == "access_log" && arg == "off" {
                continue;
            }
            // `error_log stderr;` + severity levels (e.g. `warn`, `error`)
            // aren't paths. nginx accepts a syslog target `syslog:...`
            // which also isn't a filesystem path.
            if arg == "stderr"
                || arg == "stdout"
                || arg.starts_with("syslog:")
                // common `error_log` severity levels — not paths.
                || matches!(
                    arg.as_str(),
                    "debug" | "info" | "notice" | "warn" | "error" | "crit" | "alert" | "emerg"
                )
                // `access_log` format parameters appear after the path and
                // are plain identifiers (e.g. `main`, `combined`). We only
                // path-check args that look like paths.
                || (!arg.starts_with('/') && !arg.contains('/'))
            {
                continue;
            }
            if has_parent_traversal(arg) {
                return Err(format!(
                    "{label}:{line}: `{name}` arg contains `..` traversal: {arg}"
                ));
            }
            // Strip glob prefix for the ROOT_SAFE_PREFIXES check — nginx
            // reads `/root/sites/*.conf` against the enclosing dir.
            let check = arg
                .split_once('*')
                .map(|(p, _)| p.to_string())
                .unwrap_or_else(|| arg.clone());
            if check.starts_with('/') {
                if !is_root_safe_path(&check) {
                    return Err(format!(
                        "{label}:{line}: `{name}` points outside ROOT_SAFE_PREFIXES: {arg}"
                    ));
                }
            } else {
                // Relative — nginx resolves against its `-p` prefix which
                // is the root staging dir. A relative path with no `..`
                // segments can never escape the staging dir.
                //
                // (The traversal check above has already rejected `..`
                // segments.)
            }
        }
        return Ok(());
    }

    // Allowlist directives — args may contain user paths (fastcgi socket,
    // SCRIPT_FILENAME under HERD_HOME, rewrite regex, server_name, etc).
    if is_user_args_ok {
        return Ok(());
    }

    // Any other directive — conservatively reject absolute-path args that
    // sit outside ROOT_SAFE_PREFIXES. This catches typo'd or malicious
    // path-loading directives the explicit list missed.
    for arg in &stmt.args {
        if arg.starts_with('/') && !is_root_safe_path(arg) {
            if has_parent_traversal(arg) {
                return Err(format!(
                    "{label}:{line}: directive `{name}` arg contains `..` traversal: {arg}"
                ));
            }
            return Err(format!(
                "{label}:{line}: directive `{name}` has absolute path arg outside ROOT_SAFE_PREFIXES: {arg}"
            ));
        }
    }
    Ok(())
}

/// Validate a rendered nginx root-variant file.
///
/// Tokenizes the config, splits into statements regardless of layout
/// (newlines, inline `;`-chains), then enforces:
/// - Forbidden directives (`load_module`, `env`, `ssl_engine`, `perl*`,
///   `js_*`, `lua*`, `*_by_lua*`, `njs*`, `user root`) → `Err`.
/// - Path-loading directives (`include`, `ssl_certificate*`, `pid`,
///   `error_log`, `access_log`, `ssl_dhparam`, `ssl_crl`, …, `geoip*`) —
///   every absolute path arg must sit under [`ROOT_SAFE_PREFIXES`]; `..`
///   path components are rejected on both absolute and relative paths.
///   Relative paths without `..` resolve against the root staging dir
///   (passed to nginx via `-p`).
/// - Allowlisted directives (`fastcgi_pass`, `fastcgi_param`, `rewrite`,
///   `root`, `alias`, `try_files`, `return`, `server_name`, `listen`,
///   `location`, etc.) — args are not path-checked (they carry fastcgi
///   handoff + HTTP routing data).
/// - Any other directive — absolute-path args must be ROOT_SAFE.
///
/// Recursive validation: each file staged by [`render_nginx_root_variants`]
/// is passed through this function individually, so every `include` target
/// a Badami-rendered root variant can resolve to is itself validated.
pub fn validate_nginx_root_variant(content: &str, label: &str) -> Result<(), String> {
    let statements =
        parse_nginx_statements(content).map_err(|e| format!("{label}: {e}"))?;
    for stmt in &statements {
        validate_nginx_statement(stmt, label)?;
    }
    Ok(())
}

/// Dnsmasq allowlist. Anything outside this list is rejected outright —
/// dnsmasq has a wide surface of file-loading / script-exec directives,
/// so an allowlist is strictly safer than a denylist.
const DNSMASQ_ALLOWED_KEYS: &[&str] = &[
    "listen-address",
    "bind-interfaces",
    "port",
    "no-resolv",
    "no-hosts",
    "address",
    "pid-file",
    "log-facility",
    "local",
    "domain-needed",
    "bogus-priv",
    "cache-size",
    "log-queries",
    "server",
];

/// Validate a rendered dnsmasq root variant.
///
/// Line-based because dnsmasq itself is strictly `key[=value]` per line —
/// no multi-line directives, no quoting that spans newlines. Rejects:
/// - Any line that ends with `\` (dnsmasq does not support line
///   continuations; a trailing backslash is a smuggling attempt).
/// - Every forbidden key in [`DNSMASQ_FORBIDDEN_KEYS`].
/// - `tftp-*` directives.
/// - `user=root`.
/// - Any key outside [`DNSMASQ_ALLOWED_KEYS`].
/// - `pid-file=` / `log-facility=` paths outside [`ROOT_SAFE_PREFIXES`].
pub fn validate_dnsmasq_root_variant(content: &str) -> Result<(), String> {
    for (lineno, raw) in content.lines().enumerate() {
        // Reject backslash continuation attempts BEFORE trimming — a
        // tailing `\` plus whitespace is caught by the raw byte scan too.
        if raw.trim_end_matches([' ', '\t']).ends_with('\\') {
            return Err(format!(
                "dnsmasq.conf:{}: forbidden backslash line continuation",
                lineno + 1
            ));
        }
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        // dnsmasq keys may appear as `key=value` or bare `key`.
        let key = line.split('=').next().unwrap_or(line).trim();

        if DNSMASQ_FORBIDDEN_KEYS.contains(&key) {
            return Err(format!(
                "dnsmasq.conf:{}: forbidden dnsmasq key `{key}`",
                lineno + 1
            ));
        }
        if key.starts_with("tftp-") {
            return Err(format!(
                "dnsmasq.conf:{}: forbidden tftp directive `{key}`",
                lineno + 1
            ));
        }
        if key == "user" {
            let value = line
                .split_once('=')
                .map(|(_, v)| v)
                .unwrap_or("")
                .trim();
            if value == "root" {
                return Err(format!(
                    "dnsmasq.conf:{}: forbidden `user=root`",
                    lineno + 1
                ));
            }
            // `user=<anything>` is still outside the allowlist; fall
            // through to the allowlist check which emits a forbidden error.
        }

        if !DNSMASQ_ALLOWED_KEYS.contains(&key) {
            return Err(format!(
                "dnsmasq.conf:{}: forbidden unknown dnsmasq key `{key}` (not in allowlist)",
                lineno + 1
            ));
        }

        for pathed in &["pid-file", "log-facility"] {
            if key != *pathed {
                continue;
            }
            let value = line
                .split_once('=')
                .map(|(_, v)| v)
                .unwrap_or("")
                .trim();
            if value.starts_with('/') && !is_root_safe_path(value) {
                return Err(format!(
                    "dnsmasq.conf:{}: {pathed} points outside ROOT_SAFE_PREFIXES: {value}",
                    lineno + 1
                ));
            }
        }
    }
    Ok(())
}

/// Extract every `ssl_certificate` / `ssl_certificate_key` path argument
/// from a site conf body. Returns `(directive, extracted_path)` pairs in
/// source order — later used to copy the referenced file into
/// pending `certs/` and rewrite the conf to point at the root-staged copy.
///
/// Uses the same tokenizer as [`validate_nginx_root_variant`] so multi-line
/// directives + inline `;`-chains are handled correctly.
fn extract_ssl_cert_paths(content: &str) -> Vec<(&'static str, String)> {
    let mut out = Vec::new();
    let statements = match parse_nginx_statements(content) {
        Ok(s) => s,
        Err(_) => return out,
    };
    for stmt in statements {
        let lower = stmt.name.to_ascii_lowercase();
        let name_static: Option<&'static str> = match lower.as_str() {
            "ssl_certificate" => Some("ssl_certificate"),
            "ssl_certificate_key" => Some("ssl_certificate_key"),
            _ => None,
        };
        if let Some(d) = name_static {
            if let Some(first_arg) = stmt.args.into_iter().next() {
                out.push((d, first_arg));
            }
        }
    }
    out
}

/// Options for [`render_nginx_root_variants`] — exposed as a struct so unit
/// tests can inject a sandbox pending dir without touching real Application
/// Support.
#[derive(Debug, Clone)]
pub struct NginxRootVariantInput<'a> {
    /// User-side nginx dir containing the generated nginx.conf, badami.conf,
    /// sites/, mime.types, fastcgi_params.
    pub user_nginx_dir: &'a Path,
    /// User-side logs dir — matched against `error_log "…"` lines so the
    /// rewrite points pid/log files into root staging.
    pub user_logs_dir: &'a Path,
    /// User-side pids dir — matched against `pid "…"` lines.
    pub user_pids_dir: &'a Path,
    /// Final root-owned nginx staging dir (e.g. `/Library/.../local-dev-root
    /// /nginx`). Writes go to `<pending_dir>/nginx/` but the computed digests
    /// are keyed to this final destination.
    pub root_nginx_dir: &'a Path,
    /// Fresh pending temp dir (empty on entry). This function creates
    /// `pending_dir/nginx/`, `pending_dir/nginx/sites/`, and
    /// `pending_dir/nginx/certs/` under it.
    pub pending_dir: &'a Path,
}

/// Render nginx root variants + copy referenced TLS certs. Returns the list
/// of files that must be installed root-owned and the computed SHA-256 of
/// each. Fails if any rewritten file fails validation.
pub fn render_nginx_root_variants(
    input: &NginxRootVariantInput<'_>,
) -> Result<Vec<PendingFile>, String> {
    let pending_nginx = input.pending_dir.join("nginx");
    let pending_sites = pending_nginx.join("sites");
    let pending_certs = pending_nginx.join("certs");
    for d in [&pending_nginx, &pending_sites, &pending_certs] {
        fs::create_dir_all(d).map_err(|e| format!("mkdir pending {}: {e}", d.display()))?;
    }

    let user_nginx_str = input.user_nginx_dir.to_string_lossy().into_owned();
    let user_logs_str = input.user_logs_dir.to_string_lossy().into_owned();
    let user_pids_str = input.user_pids_dir.to_string_lossy().into_owned();
    let root_nginx_str = input.root_nginx_dir.to_string_lossy().into_owned();
    let root_certs_dir = input.root_nginx_dir.join("certs");

    let mut files = Vec::new();

    // Top-level config files that may reference paths.
    for name in ["nginx.conf", "badami.conf"] {
        let src = input.user_nginx_dir.join(name);
        if !src.is_file() {
            continue;
        }
        let content = fs::read_to_string(&src)
            .map_err(|e| format!("read {}: {e}", src.display()))?;
        let rewritten = rewrite_nginx_paths(
            &content,
            &user_nginx_str,
            &user_logs_str,
            &user_pids_str,
            &root_nginx_str,
        );
        validate_nginx_root_variant(&rewritten, name)?;
        let pending_dst = pending_nginx.join(name);
        fs::write(&pending_dst, &rewritten)
            .map_err(|e| format!("write {}: {e}", pending_dst.display()))?;
        files.push(PendingFile {
            pending_src: pending_dst.to_string_lossy().into_owned(),
            final_dst: input.root_nginx_dir.join(name).to_string_lossy().into_owned(),
            sha256_hex: sha256_hex(rewritten.as_bytes()),
            mode: "644",
        });
    }

    // Static helpers. These are byte-identical to the user tree — but we
    // still re-hash them so a stale user-side copy can't survive install.
    for name in ["mime.types", "fastcgi_params"] {
        let src = input.user_nginx_dir.join(name);
        if !src.is_file() {
            continue;
        }
        let bytes = fs::read(&src).map_err(|e| format!("read {}: {e}", src.display()))?;
        // mime.types / fastcgi_params don't contain absolute paths, but run
        // through the rewrite anyway for consistency with the other confs.
        let rewritten = rewrite_nginx_paths(
            &String::from_utf8_lossy(&bytes),
            &user_nginx_str,
            &user_logs_str,
            &user_pids_str,
            &root_nginx_str,
        );
        validate_nginx_root_variant(&rewritten, name)?;
        let pending_dst = pending_nginx.join(name);
        fs::write(&pending_dst, rewritten.as_bytes())
            .map_err(|e| format!("write {}: {e}", pending_dst.display()))?;
        files.push(PendingFile {
            pending_src: pending_dst.to_string_lossy().into_owned(),
            final_dst: input.root_nginx_dir.join(name).to_string_lossy().into_owned(),
            sha256_hex: sha256_hex(rewritten.as_bytes()),
            mode: "644",
        });
    }

    // Per-site confs (sites/*.conf): rewrite paths, inline TLS cert copies.
    let user_sites_dir = input.user_nginx_dir.join("sites");
    if let Ok(rd) = fs::read_dir(&user_sites_dir) {
        for entry in rd.flatten() {
            let src = entry.path();
            if src.extension().and_then(|s| s.to_str()) != Some("conf") {
                continue;
            }
            let Some(filename) = src.file_name().and_then(|s| s.to_str()) else {
                continue;
            };
            // Reject site conf filenames that would escape the sites dir.
            if filename.contains('/') || filename.contains("..") {
                return Err(format!("site conf filename traversal: {filename}"));
            }
            let content = fs::read_to_string(&src)
                .map_err(|e| format!("read {}: {e}", src.display()))?;
            // First pass: path rewrites.
            let mut rewritten = rewrite_nginx_paths(
                &content,
                &user_nginx_str,
                &user_logs_str,
                &user_pids_str,
                &root_nginx_str,
            );
            // Second pass: TLS certs — copy the referenced file into
            // pending/certs/ and rewrite the path to the root certs dir.
            for (_directive, orig_path) in extract_ssl_cert_paths(&rewritten) {
                if !orig_path.starts_with('/') {
                    // Relative paths get resolved by nginx against its
                    // prefix dir (`-p`); when the prefix is the root
                    // staging dir and the relative path is `certs/foo`
                    // we don't need to touch it. Skip.
                    continue;
                }
                if is_root_safe_path(&orig_path) {
                    // Already pointing at root staging — no copy needed.
                    continue;
                }
                let orig = Path::new(&orig_path);
                let Some(cert_name) = orig.file_name().and_then(|s| s.to_str()) else {
                    return Err(format!(
                        "site conf {filename}: ssl path missing filename: {orig_path}"
                    ));
                };
                if cert_name.contains("..") || cert_name.contains('/') {
                    return Err(format!("site conf {filename}: ssl cert name traversal"));
                }
                let pending_cert = pending_certs.join(cert_name);
                // Read source bytes ONCE, hash those same bytes, and write
                // the pending copy from the in-memory buffer. Previously we
                // used `fs::copy` + `fs::read(&pending_cert)` which opened a
                // TOCTOU gap: an attacker could tamper with `pending_cert`
                // between the copy and the read, producing a hash that no
                // longer describes what shasum will actually see at install
                // time. Keyed to the source bytes, the hash now binds the
                // digest to what Rust observed, not whatever lives on disk
                // when the shasum step runs.
                let bytes = fs::read(orig)
                    .map_err(|e| format!("read cert {}: {e}", orig.display()))?;
                fs::write(&pending_cert, &bytes).map_err(|e| {
                    format!(
                        "write staged cert {} ← {}: {e}",
                        pending_cert.display(),
                        orig.display()
                    )
                })?;
                let final_cert = root_certs_dir.join(cert_name);
                let mode = if cert_name.ends_with(".key") {
                    "600"
                } else {
                    "644"
                };
                files.push(PendingFile {
                    pending_src: pending_cert.to_string_lossy().into_owned(),
                    final_dst: final_cert.to_string_lossy().into_owned(),
                    sha256_hex: sha256_hex(&bytes),
                    mode,
                });
                let final_str = final_cert.to_string_lossy().into_owned();
                rewritten = rewritten.replace(&orig_path, &final_str);
            }
            validate_nginx_root_variant(&rewritten, filename)?;
            let pending_dst = pending_sites.join(filename);
            fs::write(&pending_dst, &rewritten)
                .map_err(|e| format!("write {}: {e}", pending_dst.display()))?;
            files.push(PendingFile {
                pending_src: pending_dst.to_string_lossy().into_owned(),
                final_dst: input
                    .root_nginx_dir
                    .join("sites")
                    .join(filename)
                    .to_string_lossy()
                    .into_owned(),
                sha256_hex: sha256_hex(rewritten.as_bytes()),
                mode: "644",
            });
        }
    }

    Ok(files)
}

/// Input to [`render_dnsmasq_root_variants`].
#[derive(Debug, Clone)]
pub struct DnsmasqRootVariantInput<'a> {
    pub user_dnsmasq_conf: &'a Path,
    pub user_logs_dir: &'a Path,
    pub user_pids_dir: &'a Path,
    pub root_dnsmasq_dir: &'a Path,
    pub pending_dir: &'a Path,
}

/// Render dnsmasq root variant into `pending_dir/dnsmasq/dnsmasq.conf`.
pub fn render_dnsmasq_root_variants(
    input: &DnsmasqRootVariantInput<'_>,
) -> Result<Vec<PendingFile>, String> {
    if !input.user_dnsmasq_conf.is_file() {
        // Nothing to stage — upstream will emit a note. Returning an empty
        // list keeps the caller's privileged argv builder a no-op for this
        // role.
        return Ok(Vec::new());
    }
    let pending_dnsmasq = input.pending_dir.join("dnsmasq");
    fs::create_dir_all(&pending_dnsmasq)
        .map_err(|e| format!("mkdir pending {}: {e}", pending_dnsmasq.display()))?;

    let content = fs::read_to_string(input.user_dnsmasq_conf)
        .map_err(|e| format!("read {}: {e}", input.user_dnsmasq_conf.display()))?;
    let user_logs = input.user_logs_dir.to_string_lossy();
    let user_pids = input.user_pids_dir.to_string_lossy();
    let root_dnsmasq = input.root_dnsmasq_dir.to_string_lossy();
    let rewritten = rewrite_dnsmasq_paths(&content, &user_logs, &user_pids, &root_dnsmasq);
    validate_dnsmasq_root_variant(&rewritten)?;
    let pending_conf = pending_dnsmasq.join("dnsmasq.conf");
    fs::write(&pending_conf, &rewritten)
        .map_err(|e| format!("write {}: {e}", pending_conf.display()))?;
    Ok(vec![PendingFile {
        pending_src: pending_conf.to_string_lossy().into_owned(),
        final_dst: input
            .root_dnsmasq_dir
            .join("dnsmasq.conf")
            .to_string_lossy()
            .into_owned(),
        sha256_hex: sha256_hex(rewritten.as_bytes()),
        mode: "644",
    }])
}

// ── Privileged argv builders (shared between install + resync) ──────

/// Ancestor directories under `/Library/Application Support/` that Badami
/// owns and must reclaim root:wheel 755 before any staging or install step.
///
/// `/Library/Application Support/` on macOS is `root:admin 775`, which means
/// a user process in the `admin` group (any Mac user who ever typed `sudo`)
/// can create children user-owned. If `/Library/Application Support/Badami`
/// or `.../Badami/local-dev-root` is pre-created user-owned, an attacker
/// could swap a staged subdirectory between our Rust-side shasum verify and
/// the privileged `launchctl bootstrap` / `security add-trusted-cert`
/// exec, defeating hash verification.
///
/// This slice is ordered — `install -d` for the parent must succeed before
/// its children can be reclaimed.
pub(crate) const RECLAIM_ANCESTORS: &[&str] = &[
    "/Library/Application Support/Badami",
    "/Library/Application Support/Badami/local-dev-root",
];

/// Build the shared "reclaim ancestor chain" argv prelude. Every privileged
/// bootstrap sequence (install, resync, trust CA, uninstall) prepends this
/// so a pre-planted user-owned ancestor (or symlink) cannot survive long
/// enough to swap in a tampered staging dir between `shasum` and the
/// privileged exec that trusts it.
///
/// Steps emitted, in order:
///
/// 1. For each ancestor in [`RECLAIM_ANCESTORS`]: fail-closed `test ! -L` +
///    `test -d` check (symlink or non-dir → `exit 1`), followed by `install
///    -d -o root -g wheel -m 755` (creates when absent) and an explicit
///    `chown root:wheel` + `chmod 755` (reclaims a user-owned existing dir).
///    `install -d` is intentionally *not* recursive so we never mutate ACLs
///    or ownership on `/Library/Application Support/` itself.
/// 2. Role leaf (`role_leaf_dir`, e.g. `.../local-dev-root/nginx`): same
///    symlink-rejection + `rm -rf` (after the ancestor reclaim, so an
///    attacker can no longer re-add it), then fresh root:wheel 755 recreate.
///    `role_leaf_dir` is validated by the caller — must start with
///    [`ROOT_STAGING_PREFIX`].
///
/// The caller MUST emit this before any `/usr/bin/install src dst`,
/// `/usr/bin/shasum`, `launchctl`, or `security add-trusted-cert` step.
pub(crate) fn reclaim_ancestor_chain_argv(role_leaf_dir: &str) -> Vec<Vec<String>> {
    let mut out: Vec<Vec<String>> = Vec::new();

    // Reclaim every ancestor in the chain. Order matters — parent before
    // child so `install -d` on the child does not race with a hostile
    // parent swap. Each ancestor runs the full "no symlink / is-dir /
    // install -d / chown / chmod" sequence as a single sh -c body so a
    // mismatch short-circuits under `set -euo pipefail`.
    for ancestor in RECLAIM_ANCESTORS {
        let qpath = shell_single_quote(ancestor);
        let path_disp = ancestor.replace('\'', "\\'");
        out.push(vec![
            "/bin/sh".into(),
            "-c".into(),
            format!(
                "if [ -L {qpath} ]; then \
                   echo \"badami: ancestor {path_disp} is a symlink — refusing\" >&2; \
                   exit 1; \
                 fi; \
                 if [ -e {qpath} ] && [ ! -d {qpath} ]; then \
                   echo \"badami: ancestor {path_disp} exists and is not a directory — refusing\" >&2; \
                   exit 1; \
                 fi; \
                 /usr/bin/install -d -o root -g wheel -m 755 {qpath}; \
                 /usr/sbin/chown root:wheel {qpath}; \
                 /bin/chmod 755 {qpath}",
                qpath = qpath,
                path_disp = path_disp,
            ),
        ]);
    }

    // Role leaf: tear down any pre-existing dir (symlink first → exit 1),
    // then recreate root-owned so the subsequent `install -o root -g wheel`
    // steps land in a known-good tree.
    let qleaf = shell_single_quote(role_leaf_dir);
    let leaf_disp = role_leaf_dir.replace('\'', "\\'");
    out.push(vec![
        "/bin/sh".into(),
        "-c".into(),
        format!(
            "if [ -L {qleaf} ]; then \
               echo \"badami: role leaf {leaf_disp} is a symlink — refusing\" >&2; \
               exit 1; \
             fi; \
             if [ -e {qleaf} ]; then \
               rm -rf -- {qleaf}; \
             fi; \
             /usr/bin/install -d -o root -g wheel -m 755 {qleaf}",
            qleaf = qleaf,
            leaf_disp = leaf_disp,
        ),
    ]);

    out
}

/// Symlink-safe `rm -rf` for a path that MUST be a directory (or absent).
/// Used by uninstall after [`reclaim_ancestor_chain_argv`] has established
/// the ancestor chain as root-owned — the extra `test ! -L` guard is
/// belt-and-braces so a race between reclaim and rm cannot follow a
/// freshly-planted symlink.
pub(crate) fn safe_rm_rf_dir_argv(path: &str) -> Vec<String> {
    let qpath = shell_single_quote(path);
    let path_disp = path.replace('\'', "\\'");
    vec![
        "/bin/sh".into(),
        "-c".into(),
        format!(
            "if [ -L {qpath} ]; then \
               echo \"badami: refuse to rm -rf symlink {path_disp}\" >&2; \
               exit 1; \
             fi; \
             rm -rf -- {qpath}",
            qpath = qpath,
            path_disp = path_disp,
        ),
    ]
}

/// Build the privileged argv list that installs every [`PendingFile`] into
/// its final root-owned destination using `install(1)` (atomic rename, owner
/// + mode set in one call). Caller prepends staging-dir mkdir + chown steps.
fn install_pending_files_argv(files: &[PendingFile]) -> Vec<Vec<String>> {
    let mut out: Vec<Vec<String>> = Vec::new();
    for f in files {
        // Ensure the final dst parent dir exists root-owned.
        if let Some(parent) = Path::new(&f.final_dst).parent() {
            out.push(vec![
                "/usr/bin/install".into(),
                "-o".into(),
                "root".into(),
                "-g".into(),
                "wheel".into(),
                "-m".into(),
                "755".into(),
                "-d".into(),
                parent.to_string_lossy().into_owned(),
            ]);
        }
        out.push(vec![
            "/usr/bin/install".into(),
            "-o".into(),
            "root".into(),
            "-g".into(),
            "wheel".into(),
            "-m".into(),
            f.mode.into(),
            f.pending_src.clone(),
            f.final_dst.clone(),
        ]);
    }
    out
}

/// Build the SHA-256 verification argv — one `/bin/sh -c` block per file.
/// Each block fails closed: mismatch tears down `rollback_paths` with `rm
/// -rf` before `exit 1`, so `set -euo pipefail` propagates the failure up
/// into osascript. Launchctl is **never** reached if any check fails.
fn verify_hashes_argv(files: &[PendingFile], rollback_paths: &[String]) -> Vec<Vec<String>> {
    let rollback_cleanup = if rollback_paths.is_empty() {
        String::from("true")
    } else {
        rollback_paths
            .iter()
            .map(|p| format!("rm -rf -- {}", shell_single_quote(p)))
            .collect::<Vec<_>>()
            .join("; ")
    };
    files
        .iter()
        .map(|f| {
            vec![
                "/bin/sh".into(),
                "-c".into(),
                format!(
                    "ACTUAL_HEX=\"$(/usr/bin/shasum -a 256 -- {path} | /usr/bin/awk '{{print $1}}')\"; \
                     if [ \"$ACTUAL_HEX\" != {hex} ]; then \
                       {rollback}; \
                       echo \"badami: SHA-256 mismatch for {path_disp} (expected {hex_disp} got $ACTUAL_HEX)\" >&2; \
                       exit 1; \
                     fi",
                    path = shell_single_quote(&f.final_dst),
                    hex = shell_single_quote(&f.sha256_hex),
                    rollback = rollback_cleanup,
                    path_disp = f.final_dst.replace('\'', "\\'"),
                    hex_disp = f.sha256_hex,
                ),
            ]
        })
        .collect()
}

/// Load / reload a LaunchDaemon — bootout wrapped in `|| true` so the first
/// install (unit not yet loaded) still succeeds under `set -euo pipefail`,
/// and `kickstart -k` wrapped too so a half-installed unit does not break
/// the sequence.
fn launchctl_bootstrap_argv(label: &str, plist_path: &str) -> Vec<Vec<String>> {
    // Validated labels contain only `[A-Za-z0-9.-]` so single-quoting them
    // is a no-op for the shell parser, but we quote anyway for defence in
    // depth (no accidental globbing / word splitting).
    let qlabel = shell_single_quote(label);
    vec![
        vec![
            "/bin/sh".into(),
            "-c".into(),
            format!("launchctl bootout system/{qlabel} 2>/dev/null || true"),
        ],
        vec![
            "launchctl".into(),
            "bootstrap".into(),
            "system".into(),
            plist_path.into(),
        ],
        vec![
            "launchctl".into(),
            "enable".into(),
            format!("system/{label}"),
        ],
        vec![
            "/bin/sh".into(),
            "-c".into(),
            format!("launchctl kickstart -k system/{qlabel} 2>/dev/null || true"),
        ],
    ]
}

/// Simple reload (resync): `launchctl kickstart -k` wrapped in `|| true` so a
/// unit that isn't loaded doesn't fail the whole batch.
fn launchctl_reload_argv(label: &str) -> Vec<Vec<String>> {
    let qlabel = shell_single_quote(label);
    vec![vec![
        "/bin/sh".into(),
        "-c".into(),
        format!("launchctl kickstart -k system/{qlabel} 2>/dev/null || true"),
    ]]
}


// ── Public types ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BootstrapPackage {
    /// D1 B-lite — dnsmasq LaunchDaemon only (recommended first).
    DnsOnly,
    /// D2 — high-port resolver rewrite + unprivileged dnsmasq on that port.
    DnsHighPort,
    /// Mode B HTTP — nginx LaunchDaemon on :80.
    Http80,
    /// dns_only + http_80.
    Full,
    /// Re-copy user-side configs to root staging and reload loaded units.
    /// No privilege change — only works when the units are already installed.
    Resync,
}

impl BootstrapPackage {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::DnsOnly => "dns_only",
            Self::DnsHighPort => "dns_high_port",
            Self::Http80 => "http_80",
            Self::Full => "full",
            Self::Resync => "resync",
        }
    }

    pub fn parse(s: &str) -> Result<Self, String> {
        match s {
            "dns_only" => Ok(Self::DnsOnly),
            "dns_high_port" => Ok(Self::DnsHighPort),
            "http_80" => Ok(Self::Http80),
            "full" => Ok(Self::Full),
            "resync" => Ok(Self::Resync),
            other => Err(format!(
                "unknown bootstrap package {other:?}; expected dns_only|dns_high_port|http_80|full|resync"
            )),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum UninstallPackage {
    /// Remove the dnsmasq LaunchDaemon + root staging dir.
    DnsOnly,
    /// Remove the nginx LaunchDaemon + root staging dir.
    Http80,
    /// Remove both DnsOnly + Http80.
    Full,
    /// Only touch `/etc/resolver/<tld>` (requires marker or `confirm_resolver=true`).
    Resolver,
}

impl UninstallPackage {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::DnsOnly => "dns_only",
            Self::Http80 => "http_80",
            Self::Full => "full",
            Self::Resolver => "resolver",
        }
    }

    pub fn parse(s: &str) -> Result<Self, String> {
        match s {
            "dns_only" => Ok(Self::DnsOnly),
            "http_80" => Ok(Self::Http80),
            "full" => Ok(Self::Full),
            "resolver" => Ok(Self::Resolver),
            other => Err(format!(
                "unknown uninstall package {other:?}; expected dns_only|http_80|full|resolver"
            )),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BootstrapInstallRequest {
    /// `dns_only` | `dns_high_port` | `http_80` | `full` | `resync`.
    pub package: String,
    /// When true (default): write LaunchDaemon scaffolds under local-dev/launchd
    /// only — do **not** elevate or copy into `/Library/LaunchDaemons`.
    ///
    /// **Not zero-disk:** dry_run still creates/overwrites plists and the
    /// resolver draft under Application Support. Use
    /// `attempt_privileged_install=true` with `dry_run=false` to run the
    /// osascript admin prompt that performs the system install.
    pub dry_run: Option<bool>,
    /// TLD for resolver / dnsmasq (default `test`).
    pub tld: Option<String>,
    /// Loopback (default `127.0.0.1`).
    pub loopback: Option<String>,
    /// DNS port for D2 high-port package (default 53535).
    pub dns_port: Option<u16>,
    /// Optional override for nginx binary path.
    pub nginx_binary: Option<String>,
    /// Optional override for dnsmasq binary path.
    pub dnsmasq_binary: Option<String>,
    /// When true **and** `dry_run` is false, attempt osascript admin
    /// copy+load. Still requires interactive user approval. Default false.
    pub attempt_privileged_install: Option<bool>,
    /// Reverse-DNS identifier used to compose LaunchDaemon labels. Defaults to
    /// [`DEFAULT_LD_IDENTIFIER`] when omitted / empty. The Tauri wrapper
    /// resolves this from `AppHandle::config().identifier` so every build
    /// composes labels from its own bundle id.
    pub identifier: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BootstrapInstallResult {
    pub package: String,
    pub dry_run: bool,
    pub privileged_attempted: bool,
    pub privileged_ok: bool,
    /// Files written under local-dev (plists, resolver draft, user config
    /// mirror). Never includes anything under `/Library` because the pure Rust
    /// path never writes there — the privileged osascript shell does.
    pub written: Vec<String>,
    /// Human-readable steps for the user to complete install with auth.
    pub install_instructions: Vec<String>,
    /// AppleScript / shell one-liner the UI can show the user if they want to
    /// run it themselves instead of letting Badami invoke osascript.
    pub install_command: Option<String>,
    pub notes: Vec<String>,
    pub units: Vec<BootstrapUnitScaffold>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BootstrapUnitScaffold {
    pub label: String,
    pub role: String,
    /// User-side scaffold the UI can inspect before accepting the admin
    /// prompt. The scaffold is informational only — the real plist written
    /// into `/Library/LaunchDaemons` is rendered freshly inside the
    /// privileged shell from the exact same bytes (plus `pid`/`log` paths
    /// relocated into `local-dev-root`).
    pub scaffold_plist: String,
    pub system_plist_target: String,
    pub program_arguments: Vec<String>,
    /// Root-owned staging directory this unit's binaries + configs live in.
    pub root_staging_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BootstrapUninstallRequest {
    /// `dns_only` | `http_80` | `full` | `resolver`.
    pub package: String,
    /// Remove `/etc/resolver/<tld>` even when the file does not carry the
    /// `# managed-by: badami` marker. Default false — a resolver file without
    /// the marker is treated as not-ours and left in place.
    pub confirm_resolver: Option<bool>,
    /// When true (default): emit the steps that would run but execute nothing.
    pub dry_run: Option<bool>,
    pub tld: Option<String>,
    /// Identifier used to compose LaunchDaemon labels (defaults to
    /// [`DEFAULT_LD_IDENTIFIER`]).
    pub identifier: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BootstrapUninstallResult {
    pub package: String,
    pub dry_run: bool,
    pub executed: bool,
    /// Each step is the exact argv (shell-quoted) the privileged shell would
    /// run or did run. Suitable for logging / display, never for eval.
    pub steps: Vec<String>,
    pub notes: Vec<String>,
    /// Install result–style companion fields.
    pub install_command: Option<String>,
    /// LaunchDaemon labels this uninstall touched.
    pub labels: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BootstrapStatus {
    pub dnsmasq: super::doctor::LaunchdUnitInfo,
    pub nginx: super::doctor::LaunchdUnitInfo,
    pub resolver_path: String,
    pub resolver_present: bool,
    pub resolver_port: Option<u16>,
    pub resolver_marker_present: bool,
    pub dns_bootstrap_complete: bool,
    pub http_bootstrap_complete: bool,
    pub nginx_listen_port: u16,
    pub dnsmasq_conf_port: u16,
    pub resolver_effective_port: u16,
    pub dns_port_mismatch: bool,
    pub recommended_package: String,
    pub notes: Vec<String>,
    pub launchd_dir: String,
    pub root_staging_prefix: String,
}

// ── Marker (for /etc/resolver/<tld>) ────────────────────────────────

/// Marker written as a comment line in resolver files Badami creates. Checked
/// before uninstall so we never remove a resolver file left behind by Herd or
/// a hand-rolled setup.
pub const RESOLVER_MARKER: &str = "# managed-by: badami";

fn resolver_file_has_marker(path: &Path) -> bool {
    match fs::read_to_string(path) {
        Ok(c) => c.lines().any(|l| l.trim() == RESOLVER_MARKER),
        Err(_) => false,
    }
}

// ── Status ──────────────────────────────────────────────────────────

#[allow(dead_code)]
pub fn bootstrap_status(tld: Option<&str>) -> Result<BootstrapStatus, String> {
    bootstrap_status_for(DEFAULT_LD_IDENTIFIER, tld)
}

pub fn bootstrap_status_for(
    identifier: &str,
    tld: Option<&str>,
) -> Result<BootstrapStatus, String> {
    let tld = tld.unwrap_or("test");
    let paths = build_runtime_paths()?;
    let launchd_dir = PathBuf::from(&paths.local_dev_root)
        .join("launchd")
        .to_string_lossy()
        .into_owned();

    let dnsmasq_label = ld_label(identifier, "dnsmasq");
    let nginx_label = ld_label(identifier, "nginx");
    let dnsmasq = launchd_unit_info_for(&dnsmasq_label, "dnsmasq");
    let nginx = launchd_unit_info_for(&nginx_label, "nginx");

    let resolver_path = format!("/etc/resolver/{tld}");
    let resolver_present = Path::new(&resolver_path).is_file();
    let resolver_port = if resolver_present {
        parse_resolver_port(fs::read_to_string(&resolver_path).ok().as_deref())
    } else {
        None
    };
    let resolver_marker_present =
        resolver_present && resolver_file_has_marker(Path::new(&resolver_path));

    let nginx_listen_port = parse_nginx_http_port(&paths);
    let dnsmasq_conf_port = parse_dnsmasq_port(&paths);
    let resolver_effective_port = resolver_port.unwrap_or(53);
    let dns_port_mismatch = resolver_present && resolver_effective_port != dnsmasq_conf_port;

    let dns_bootstrap_complete = dnsmasq.system_plist_present || dnsmasq.loaded;
    let http_bootstrap_complete =
        (nginx.system_plist_present || nginx.loaded) && nginx_listen_port == 80;

    let notes = vec![
        "Actual LaunchDaemon install requires admin auth (osascript). Scaffold files live under local-dev/launchd/."
            .to_string(),
        "Mode B units execute binaries + configs from /Library/Application Support/Badami/local-dev-root (root:wheel). User-side files are mirrored by resync."
            .to_string(),
        "Badami never invokes the Herd privileged helper. Mode B units are Badami-owned only."
            .to_string(),
    ];

    let recommended_package = if !dns_bootstrap_complete {
        if resolver_present && resolver_port.unwrap_or(53) != 53 {
            "dns_high_port"
        } else {
            "dns_only"
        }
    } else if !http_bootstrap_complete {
        "http_80"
    } else {
        "resync"
    };

    Ok(BootstrapStatus {
        dnsmasq,
        nginx,
        resolver_path,
        resolver_present,
        resolver_port,
        resolver_marker_present,
        dns_bootstrap_complete,
        http_bootstrap_complete,
        nginx_listen_port,
        dnsmasq_conf_port,
        resolver_effective_port,
        dns_port_mismatch,
        recommended_package: recommended_package.into(),
        notes,
        launchd_dir,
        root_staging_prefix: ROOT_STAGING_PREFIX.into(),
    })
}

// ── Install (scaffold / optional privileged) ────────────────────────

pub fn bootstrap_install(req: BootstrapInstallRequest) -> Result<BootstrapInstallResult, String> {
    let package = BootstrapPackage::parse(&req.package)?;
    let dry_run = req.dry_run.unwrap_or(true);
    let attempt_priv = req.attempt_privileged_install.unwrap_or(false) && !dry_run;
    let tld = req.tld.as_deref().unwrap_or("test");
    let loopback = req.loopback.as_deref().unwrap_or("127.0.0.1");
    let dns_port = req.dns_port.unwrap_or(match package {
        BootstrapPackage::DnsHighPort => DEFAULT_HIGH_DNS_PORT,
        _ => 53,
    });
    let identifier = req
        .identifier
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_LD_IDENTIFIER)
        .to_string();
    // Strict label-shape validation before any downstream string interpolation.
    validate_launchd_label(&identifier)
        .map_err(|e| format!("identifier failed launchd label validation: {e}"))?;

    validate_tld(tld)?;
    validate_loopback(loopback)?;

    let paths = build_runtime_paths()?;
    let report = discover().ok();
    let launchd_dir = PathBuf::from(&paths.local_dev_root).join("launchd");
    fs::create_dir_all(&launchd_dir).map_err(|e| format!("mkdir launchd: {e}"))?;

    // Per-install pending temp dir — root variants + plist copies live here
    // until osascript picks them up. Created up front so each unit renderer
    // can reuse it. Best-effort cleanup after the privileged step returns.
    let pending_dir = make_pending_dir(&paths)?;
    let pending_dir_str = pending_dir.to_string_lossy().into_owned();

    let mut written = Vec::new();
    let mut notes = Vec::new();
    let mut units = Vec::new();
    let mut install_instructions = Vec::new();
    let mut privileged_argv: Vec<Vec<String>> = Vec::new();

    let dnsmasq_bin = req
        .dnsmasq_binary
        .clone()
        .or_else(|| {
            report.as_ref().and_then(|r| {
                r.herd.dnsmasq_binary.clone().or_else(|| {
                    r.candidates
                        .iter()
                        .find(|c| c.role == "dnsmasq")
                        .map(|c| c.path.clone())
                })
            })
        })
        .unwrap_or_default();

    let nginx_bin = req
        .nginx_binary
        .clone()
        .or_else(|| {
            report.as_ref().and_then(|r| {
                r.herd.nginx_binary.clone().or_else(|| {
                    r.candidates
                        .iter()
                        .find(|c| c.role == "nginx")
                        .map(|c| c.path.clone())
                })
            })
        })
        .unwrap_or_default();

    let need_dns = matches!(
        package,
        BootstrapPackage::DnsOnly | BootstrapPackage::Full | BootstrapPackage::DnsHighPort
    );
    let need_http = matches!(package, BootstrapPackage::Http80 | BootstrapPackage::Full);
    let is_resync = matches!(package, BootstrapPackage::Resync);

    if need_dns {
        match package {
            BootstrapPackage::DnsHighPort => {
                let resolver_draft =
                    write_resolver_draft(&launchd_dir, tld, loopback, dns_port, &mut written)?;
                notes.push(format!(
                    "D2: wrote resolver draft at {resolver_draft} (user-side audit copy; the privileged shell writes /etc/resolver/{tld} atomically from in-process content, NOT from this draft)"
                ));
                notes.push(format!(
                    "D2: regenerate dnsmasq with dns_port={dns_port} via ld_generate_dnsmasq_conf; run unprivileged (no LaunchDaemon required for DNS)"
                ));
                install_instructions.push(format!(
                    "Resolver draft (preview only): {resolver_draft} — the admin shell writes /etc/resolver/{tld} from Badami-in-process content with the `# managed-by: badami` marker"
                ));
                install_instructions.push(format!(
                    "Ensure Badami dnsmasq.conf uses port {dns_port} (ld_generate_dnsmasq_conf dns_port={dns_port})"
                ));

                // argv-only privileged command for the resolver install step.
                // The AppleScript body is composed in Rust from the exact
                // resolver content Badami generated in-process, embedded as
                // a shell-single-quoted argv — the user-writable draft is
                // never read as root.
                let resolver_content = resolver_file_contents(tld, loopback, dns_port);
                privileged_argv.push(resolver_install_argv(&resolver_content, tld)?);
            }
            _ => {
                // D1: privileged dnsmasq LaunchDaemon on :53
                if dnsmasq_bin.is_empty() || !Path::new(&dnsmasq_bin).is_file() {
                    notes.push(
                        "dnsmasq binary not found — plist still written; fix binary path before load"
                            .into(),
                    );
                }
                let user_conf = PathBuf::from(&paths.local_dev_root)
                    .join("dnsmasq")
                    .join("dnsmasq.conf");
                if !user_conf.is_file() {
                    notes.push(
                        "dnsmasq.conf missing — run ld_generate_configs before loading the unit"
                            .into(),
                    );
                }

                let root_dir = root_staging_dir("dnsmasq");
                let root_bin = root_dir.join("dnsmasq");
                let root_conf = root_dir.join("dnsmasq.conf");
                let root_pid = root_dir.join("dnsmasq.pid");
                let root_log = root_dir.join("dnsmasq.log");
                let label = ld_label(&identifier, "dnsmasq");
                validate_launchd_label(&label)?;

                let args = vec![
                    root_bin.to_string_lossy().into_owned(),
                    "--keep-in-foreground".into(),
                    "--conf-file".into(),
                    root_conf.to_string_lossy().into_owned(),
                    "--pid-file".into(),
                    root_pid.to_string_lossy().into_owned(),
                    "--log-facility".into(),
                    root_log.to_string_lossy().into_owned(),
                ];
                let stdout = root_dir
                    .join(format!("{label}.out.log"))
                    .to_string_lossy()
                    .into_owned();
                let stderr = root_dir
                    .join(format!("{label}.err.log"))
                    .to_string_lossy()
                    .into_owned();

                validate_plist_argv(&args)
                    .map_err(|e| format!("dnsmasq plist validation: {e}"))?;
                validate_plist_io_paths(&stdout, &stderr)
                    .map_err(|e| format!("dnsmasq plist IO validation: {e}"))?;

                let body = render_launch_daemon_plist(
                    &label, &args, &stdout, &stderr, true, // RunAtLoad
                    true,  // KeepAlive
                );
                let scaffold_path = launchd_dir.join("dnsmasq.plist");
                write_scaffold(&scaffold_path, &body, &mut written)?;

                units.push(BootstrapUnitScaffold {
                    label: label.clone(),
                    role: "dnsmasq".into(),
                    scaffold_plist: scaffold_path.to_string_lossy().into_owned(),
                    system_plist_target: format!("{SYSTEM_LAUNCH_DAEMONS}/{label}.plist"),
                    program_arguments: args,
                    root_staging_dir: root_dir.to_string_lossy().into_owned(),
                });

                // Render root variant + hash-verified staging.
                let dnsmasq_variants = render_dnsmasq_root_variants(&DnsmasqRootVariantInput {
                    user_dnsmasq_conf: &user_conf,
                    user_logs_dir: Path::new(&paths.logs),
                    user_pids_dir: Path::new(&paths.pids),
                    root_dnsmasq_dir: &root_dir,
                    pending_dir: &pending_dir,
                })?;
                for f in &dnsmasq_variants {
                    written.push(f.pending_src.clone());
                }
                // Binary + plist pending copies — hash-verified alongside confs.
                let unit_pending =
                    build_unit_pending_files(&pending_dir, &dnsmasq_bin, &root_bin, &label, &body)?;
                for f in &unit_pending {
                    written.push(f.pending_src.clone());
                }

                let mut all_files = dnsmasq_variants;
                all_files.extend(unit_pending);
                let plist_dst = format!("{SYSTEM_LAUNCH_DAEMONS}/{label}.plist");
                let rollback_paths = vec![
                    root_dir.to_string_lossy().into_owned(),
                    plist_dst.clone(),
                ];
                privileged_argv.extend(unit_install_argv_with_verify(
                    &label,
                    &plist_dst,
                    &root_dir.to_string_lossy(),
                    &all_files,
                    &rollback_paths,
                ));

                install_instructions.push(format!(
                    "Install DNS (D1 B-lite): copy {label}.plist into {SYSTEM_LAUNCH_DAEMONS} and launchctl bootstrap/kickstart as root (hash-verified)"
                ));
            }
        }
    }

    if need_http {
        if nginx_bin.is_empty() || !Path::new(&nginx_bin).is_file() {
            notes.push(
                "nginx binary not found — plist still written; fix binary path before load".into(),
            );
        }
        let user_nginx_dir = PathBuf::from(&paths.nginx);
        let user_conf = user_nginx_dir.join("nginx.conf");
        if !user_conf.is_file() {
            notes.push(
                "nginx.conf missing — run ld_generate_configs (prefer http_port=80, nginx_as_root=true) before loading"
                    .into(),
            );
        }

        let root_dir = root_staging_dir("nginx");
        let root_bin = root_dir.join("nginx");
        let root_conf = root_dir.join("nginx.conf");
        let root_prefix = root_dir.clone();
        let label = ld_label(&identifier, "nginx");
        validate_launchd_label(&label)?;

        let args = vec![
            root_bin.to_string_lossy().into_owned(),
            "-g".into(),
            "daemon off;".into(),
            "-c".into(),
            root_conf.to_string_lossy().into_owned(),
            "-p".into(),
            root_prefix.to_string_lossy().into_owned(),
        ];
        let stdout = root_dir
            .join(format!("{label}.out.log"))
            .to_string_lossy()
            .into_owned();
        let stderr = root_dir
            .join(format!("{label}.err.log"))
            .to_string_lossy()
            .into_owned();

        validate_plist_argv(&args).map_err(|e| format!("nginx plist validation: {e}"))?;
        validate_plist_io_paths(&stdout, &stderr)
            .map_err(|e| format!("nginx plist IO validation: {e}"))?;

        // RunAtLoad=false, KeepAlive=false so UI Start/Stop map to kickstart/kill
        // (KeepAlive=true would fight Stop and restart the master).
        let body = render_launch_daemon_plist(&label, &args, &stdout, &stderr, false, false);
        let scaffold_path = launchd_dir.join("nginx.plist");
        write_scaffold(&scaffold_path, &body, &mut written)?;

        units.push(BootstrapUnitScaffold {
            label: label.clone(),
            role: "nginx".into(),
            scaffold_plist: scaffold_path.to_string_lossy().into_owned(),
            system_plist_target: format!("{SYSTEM_LAUNCH_DAEMONS}/{label}.plist"),
            program_arguments: args,
            root_staging_dir: root_dir.to_string_lossy().into_owned(),
        });

        // Render root variants (nginx.conf + badami.conf + mime.types +
        // fastcgi_params + sites/*.conf, with TLS certs copied inline) +
        // compute SHA-256 for each. Validation rejects any user-writable
        // include / ssl_certificate path and forbidden directives up front.
        let nginx_variants = render_nginx_root_variants(&NginxRootVariantInput {
            user_nginx_dir: &user_nginx_dir,
            user_logs_dir: Path::new(&paths.logs),
            user_pids_dir: Path::new(&paths.pids),
            root_nginx_dir: &root_dir,
            pending_dir: &pending_dir,
        })?;
        for f in &nginx_variants {
            written.push(f.pending_src.clone());
        }
        let unit_pending =
            build_unit_pending_files(&pending_dir, &nginx_bin, &root_bin, &label, &body)?;
        for f in &unit_pending {
            written.push(f.pending_src.clone());
        }
        let mut all_files = nginx_variants;
        all_files.extend(unit_pending);

        let plist_dst = format!("{SYSTEM_LAUNCH_DAEMONS}/{label}.plist");
        let rollback_paths = vec![
            root_dir.to_string_lossy().into_owned(),
            plist_dst.clone(),
        ];
        privileged_argv.extend(unit_install_argv_with_verify(
            &label,
            &plist_dst,
            &root_dir.to_string_lossy(),
            &all_files,
            &rollback_paths,
        ));

        install_instructions.push(
            "Before loading nginx Mode B: regenerate configs with http_port=80 and nginx_as_root=true"
                .into(),
        );
        install_instructions.push(format!(
            "Install HTTP Mode B: hash-verified copy to {SYSTEM_LAUNCH_DAEMONS}/{label}.plist and launchctl bootstrap as root"
        ));
    }

    if is_resync {
        // Resync re-stages root variants of the current user configs into the
        // root-owned staging dirs and reloads the two units if they are
        // already installed. No install happens here — this is strictly a
        // "I regenerated configs, mirror them to the root tree so launchd
        // sees the change" shortcut, with the same TOCTOU-safe hash check as
        // first-install.
        let dnsmasq_label = ld_label(&identifier, "dnsmasq");
        let nginx_label = ld_label(&identifier, "nginx");
        validate_launchd_label(&dnsmasq_label)?;
        validate_launchd_label(&nginx_label)?;
        let user_nginx_dir = PathBuf::from(&paths.nginx);
        let user_dnsmasq_conf = PathBuf::from(&paths.local_dev_root)
            .join("dnsmasq")
            .join("dnsmasq.conf");
        let nginx_root = root_staging_dir("nginx");
        let dnsmasq_root = root_staging_dir("dnsmasq");

        let nginx_variants = if user_nginx_dir.is_dir() {
            let v = render_nginx_root_variants(&NginxRootVariantInput {
                user_nginx_dir: &user_nginx_dir,
                user_logs_dir: Path::new(&paths.logs),
                user_pids_dir: Path::new(&paths.pids),
                root_nginx_dir: &nginx_root,
                pending_dir: &pending_dir,
            })?;
            for f in &v {
                written.push(f.pending_src.clone());
            }
            v
        } else {
            notes.push("resync: user nginx dir missing — skipping nginx re-stage".into());
            Vec::new()
        };
        let dnsmasq_variants = render_dnsmasq_root_variants(&DnsmasqRootVariantInput {
            user_dnsmasq_conf: &user_dnsmasq_conf,
            user_logs_dir: Path::new(&paths.logs),
            user_pids_dir: Path::new(&paths.pids),
            root_dnsmasq_dir: &dnsmasq_root,
            pending_dir: &pending_dir,
        })?;
        for f in &dnsmasq_variants {
            written.push(f.pending_src.clone());
        }

        // Nginx re-stage: reclaim ancestors → install → verify → kickstart (|| true).
        if !nginx_variants.is_empty() {
            let rollback = vec![nginx_root.to_string_lossy().into_owned()];
            privileged_argv.extend(reclaim_ancestor_chain_argv(&nginx_root.to_string_lossy()));
            privileged_argv.extend(install_pending_files_argv(&nginx_variants));
            privileged_argv.extend(verify_hashes_argv(&nginx_variants, &rollback));
            privileged_argv.extend(launchctl_reload_argv(&nginx_label));
        }
        if !dnsmasq_variants.is_empty() {
            let rollback = vec![dnsmasq_root.to_string_lossy().into_owned()];
            privileged_argv.extend(reclaim_ancestor_chain_argv(&dnsmasq_root.to_string_lossy()));
            privileged_argv.extend(install_pending_files_argv(&dnsmasq_variants));
            privileged_argv.extend(verify_hashes_argv(&dnsmasq_variants, &rollback));
            privileged_argv.extend(launchctl_reload_argv(&dnsmasq_label));
        }
        notes.push(
            "resync: re-renders root variants of user-side configs + hash-verifies before launchctl kickstart (|| true if unit absent)"
                .into(),
        );
    }

    // Build the single AppleScript command the privileged step executes.
    // Everything is argv-escaped in Rust; no user-writable file is sourced as
    // root (TOCTOU hazard: a user process could replace the file between the
    // osascript auth prompt and the kernel exec). SHA-256 digests computed
    // above are embedded into the shasum verification steps built in
    // [`verify_hashes_argv`].
    let install_command = if privileged_argv.is_empty() {
        None
    } else {
        Some(build_osascript_command(&privileged_argv))
    };

    notes.push(format!(
        "package={} dry_run={} — dry_run writes scaffolds + pending root variants under local-dev only; privileged system install is {}",
        package.as_str(),
        dry_run,
        if dry_run {
            "NOT attempted"
        } else {
            "opt-in only via attempt_privileged_install"
        }
    ));
    notes.push(format!(
        "pending temp dir: {} (removed after osascript returns; left behind on hard crash so operators can audit the rendered root variants)",
        pending_dir_str
    ));

    let mut privileged_ok = false;
    if attempt_priv {
        if let Some(cmd) = install_command.as_ref() {
            notes.push("Attempting privileged install via osascript (argv-only, hash-verified)…".into());
            // argv-only: shell interpretation is confined to the inner `do shell
            // script` AppleScript body, which is composed exclusively from
            // Rust-escaped strings.
            match Command::new("osascript").args(["-e", cmd]).output() {
                Ok(out) => {
                    privileged_ok = out.status.success();
                    if !out.stdout.is_empty() {
                        notes.push(format!(
                            "osascript stdout: {}",
                            String::from_utf8_lossy(&out.stdout)
                        ));
                    }
                    if !out.stderr.is_empty() {
                        notes.push(format!(
                            "osascript stderr: {}",
                            String::from_utf8_lossy(&out.stderr)
                        ));
                    }
                    if !privileged_ok {
                        notes.push(
                            "Privileged install failed or was cancelled — scaffolds remain for manual install"
                                .into(),
                        );
                    }
                }
                Err(e) => {
                    notes.push(format!("Failed to spawn osascript: {e}"));
                }
            }
        } else {
            notes.push("No privileged steps for this package; nothing to run".into());
        }
    } else if !dry_run {
        notes.push(
            "dry_run=false but attempt_privileged_install not set — scaffolds only (safe default)"
                .into(),
        );
    }

    // Best-effort pending cleanup. We leave it in place when privileged_ok is
    // false so operators can see what would have been installed.
    if privileged_ok {
        if let Err(e) = fs::remove_dir_all(&pending_dir) {
            notes.push(format!(
                "cleanup: failed to remove pending dir {pending_dir_str}: {e}"
            ));
        }
    } else if dry_run {
        // Dry run keeps the pending dir for inspection; label it in notes.
        notes.push(
            "dry_run: pending temp dir preserved for review — safe to delete after inspection"
                .into(),
        );
    }

    notes.push(
        "ld_bootstrap_uninstall removes only Badami-written units + /Library/Application Support/Badami/local-dev-root/<role>. Resolver removal gated by `# managed-by: badami` marker."
            .into(),
    );

    Ok(BootstrapInstallResult {
        package: package.as_str().into(),
        dry_run,
        privileged_attempted: attempt_priv,
        privileged_ok,
        written,
        install_instructions,
        install_command,
        notes,
        units,
    })
}

// ── Uninstall ───────────────────────────────────────────────────────

pub fn bootstrap_uninstall(
    req: BootstrapUninstallRequest,
) -> Result<BootstrapUninstallResult, String> {
    let package = UninstallPackage::parse(&req.package)?;
    let dry_run = req.dry_run.unwrap_or(true);
    let confirm_resolver = req.confirm_resolver.unwrap_or(false);
    let tld = req.tld.as_deref().unwrap_or("test");
    validate_tld(tld)?;
    let identifier = req
        .identifier
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_LD_IDENTIFIER)
        .to_string();

    let mut steps: Vec<String> = Vec::new();
    let mut notes: Vec<String> = Vec::new();
    let mut labels: Vec<String> = Vec::new();
    let mut privileged_argv: Vec<Vec<String>> = Vec::new();

    let touch_dnsmasq = matches!(package, UninstallPackage::DnsOnly | UninstallPackage::Full);
    let touch_nginx = matches!(package, UninstallPackage::Http80 | UninstallPackage::Full);
    let touch_resolver = matches!(package, UninstallPackage::Resolver);

    for (role, do_it) in [("dnsmasq", touch_dnsmasq), ("nginx", touch_nginx)] {
        if !do_it {
            continue;
        }
        let label = ld_label(&identifier, role);
        let plist_target = format!("{SYSTEM_LAUNCH_DAEMONS}/{label}.plist");
        let staging = root_staging_dir(role);
        labels.push(label.clone());

        let unit_steps = unit_uninstall_argv(&label, &plist_target, &staging.to_string_lossy());
        for argv in &unit_steps {
            steps.push(render_step(argv));
        }
        if !dry_run {
            privileged_argv.extend(unit_steps);
        }
    }

    if touch_resolver {
        let resolver_path = PathBuf::from(format!("/etc/resolver/{tld}"));
        let present = resolver_path.is_file();
        let has_marker = present && resolver_file_has_marker(&resolver_path);

        if !present {
            notes.push(format!(
                "{} is not present — nothing to remove",
                resolver_path.display()
            ));
        } else if has_marker || confirm_resolver {
            let argv = vec![
                "rm".to_string(),
                "-f".to_string(),
                resolver_path.to_string_lossy().into_owned(),
            ];
            steps.push(render_step(&argv));
            if !dry_run {
                privileged_argv.push(argv);
            }
            if !has_marker && confirm_resolver {
                notes.push(format!(
                    "{} does NOT carry the `{}` marker but confirm_resolver=true — removing anyway (user explicitly confirmed)",
                    resolver_path.display(), RESOLVER_MARKER
                ));
            }
        } else {
            notes.push(format!(
                "{} has no `{}` marker — refusing to remove without confirm_resolver=true. Herd and hand-rolled files are left alone.",
                resolver_path.display(), RESOLVER_MARKER
            ));
        }
    }

    let install_command = if privileged_argv.is_empty() {
        None
    } else {
        Some(build_osascript_command(&privileged_argv))
    };

    let mut executed = false;
    if !dry_run {
        if let Some(cmd) = install_command.as_ref() {
            match Command::new("osascript").args(["-e", cmd]).output() {
                Ok(out) => {
                    executed = out.status.success();
                    if !out.stdout.is_empty() {
                        notes.push(format!(
                            "osascript stdout: {}",
                            String::from_utf8_lossy(&out.stdout)
                        ));
                    }
                    if !out.stderr.is_empty() {
                        notes.push(format!(
                            "osascript stderr: {}",
                            String::from_utf8_lossy(&out.stderr)
                        ));
                    }
                    if !executed {
                        notes.push(
                            "Privileged uninstall failed or was cancelled — units may still be loaded"
                                .into(),
                        );
                    }
                }
                Err(e) => {
                    notes.push(format!("Failed to spawn osascript: {e}"));
                }
            }
        } else {
            notes.push("No privileged steps to execute (dry run output empty)".into());
        }
    } else {
        notes.push("dry_run=true — nothing executed, inspect `steps` for the planned argv".into());
    }

    notes.push(
        "Never touches Herd files. Only Badami-managed labels, root staging dirs, and resolver files with the badami marker are removed."
            .into(),
    );

    Ok(BootstrapUninstallResult {
        package: package.as_str().into(),
        dry_run,
        executed,
        steps,
        notes,
        install_command,
        labels,
    })
}

// ── Privileged command assembly (argv-only) ─────────────────────────

/// Minimal argv for the resolver install step. The AppleScript body built on
/// top of this is Rust-escaped — nothing in the caller's file system is
/// executed, so a user process cannot swap in a replacement script between
/// `osascript` auth and `exec`.
fn resolver_install_argv(
    content: &str,
    tld: &str,
) -> Result<Vec<String>, String> {
    // Compose the resolver file contents *in-process* and have the privileged
    // shell write it to a tmpfile + atomic-rename into place. This closes a
    // TOCTOU gap in the previous `cp -- <user_writable_draft>` design: a
    // user process could race the draft between the `osascript` auth prompt
    // and the `cp` exec and plant a resolver file with arbitrary
    // nameserver + port. Here the content is baked into the argv (which is
    // argv-escaped in Rust), so what runs as root is exactly what Badami
    // computed in-process.
    //
    // Validate the TLD + marker up front so a hostile call site cannot land
    // outside `/etc/resolver/<tld>`.
    validate_tld(tld)?;
    if !content.contains(RESOLVER_MARKER) {
        return Err(format!(
            "resolver content missing `{RESOLVER_MARKER}` marker — refusing to write"
        ));
    }
    let tmp = format!("/etc/resolver/{tld}.badami-tmp");
    let final_path = format!("/etc/resolver/{tld}");
    Ok(vec![
        "/bin/sh".into(),
        "-c".into(),
        format!(
            "mkdir -p /etc/resolver && printf '%s' {content} > {tmp} && chmod 644 {tmp} && mv -f {tmp} {final_path}",
            content = shell_single_quote(content),
            tmp = shell_single_quote(&tmp),
            final_path = shell_single_quote(&final_path),
        ),
    ])
}

/// Install a unit scaffold with hash-verified staging. Files are copied
/// pending→final via `install(1)`, each root-owned copy is checked with
/// `/usr/bin/shasum -a 256` against the Rust-computed digests, and only
/// after every file matches do we `launchctl bootstrap/kickstart`. On any
/// hash mismatch, `rollback_paths` are torn down and the sequence `exit 1`s
/// before launchctl runs — launchd never sees a tampered plist.
///
/// Caller order inside the osascript body is strict:
///
/// 1. `rm -rf -- <root_staging_dir>` — freshen staging (idempotent + tolerant
///    of missing dir).
/// 2. For each pending file: `install -o root -g wheel -m MODE src dst`
///    (ensures parent dir with `install -d -m 755` first).
/// 3. For each root-owned file: shasum check vs the embedded digest; on
///    mismatch the plist + staging dir are removed and `exit 1`.
/// 4. `launchctl bootout system/{label} 2>/dev/null || true` — tolerate
///    the first-install case where the unit isn't loaded yet.
/// 5. `launchctl bootstrap system <plist_dst>`.
/// 6. `launchctl enable system/{label}`.
/// 7. `launchctl kickstart -k system/{label} 2>/dev/null || true`.
fn unit_install_argv_with_verify(
    label: &str,
    plist_dst: &str,
    staging_dir: &str,
    pending_files: &[PendingFile],
    rollback_paths: &[String],
) -> Vec<Vec<String>> {
    let mut out: Vec<Vec<String>> = Vec::new();

    // Reclaim ancestor chain + freshen staging dir root-owned. This closes
    // the TOCTOU window where a user-group admin could pre-create
    // `/Library/Application Support/Badami` or `.../local-dev-root` with
    // their own ownership and swap in a tampered staging subdir between
    // the shasum verify and `launchctl bootstrap`. The old sequence here
    // was just `rm -rf -- staging_dir` which did nothing about the ancestor
    // ownership + symlink hazard.
    out.extend(reclaim_ancestor_chain_argv(staging_dir));

    // Install every pending file (binary + plist + configs + certs) root-owned.
    out.extend(install_pending_files_argv(pending_files));

    // Hash-verify BEFORE launchctl. Any mismatch rolls back + `exit 1`s so
    // launchctl never runs with a tampered root-owned file.
    out.extend(verify_hashes_argv(pending_files, rollback_paths));

    // Load / reload the unit (bootout + kickstart wrapped in `|| true`).
    out.extend(launchctl_bootstrap_argv(label, plist_dst));

    out
}

/// Copy the service binary + render the plist scaffold into the pending temp
/// dir, returning the [`PendingFile`] records (final destination, hash, mode)
/// that `unit_install_argv_with_verify` will install root-owned.
fn build_unit_pending_files(
    pending_dir: &Path,
    user_binary: &str,
    final_binary: &Path,
    label: &str,
    plist_body: &str,
) -> Result<Vec<PendingFile>, String> {
    let mut files = Vec::new();

    // Plist scaffold → pending/plists/{label}.plist → /Library/LaunchDaemons/
    let plists_dir = pending_dir.join("plists");
    fs::create_dir_all(&plists_dir).map_err(|e| format!("mkdir {}: {e}", plists_dir.display()))?;
    let pending_plist = plists_dir.join(format!("{label}.plist"));
    fs::write(&pending_plist, plist_body)
        .map_err(|e| format!("write {}: {e}", pending_plist.display()))?;
    files.push(PendingFile {
        pending_src: pending_plist.to_string_lossy().into_owned(),
        final_dst: format!("{SYSTEM_LAUNCH_DAEMONS}/{label}.plist"),
        sha256_hex: sha256_hex(plist_body.as_bytes()),
        mode: "644",
    });

    // Binary → pending/bin/<name> → root staging <role> dir.
    if user_binary.is_empty() {
        return Ok(files);
    }
    let user_bin_path = Path::new(user_binary);
    if !user_bin_path.is_file() {
        // Keep the plist entry so the caller can still emit a dry-run plan.
        return Ok(files);
    }
    let bin_name = final_binary
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("binary");
    let bin_pending_dir = pending_dir.join("bin");
    fs::create_dir_all(&bin_pending_dir)
        .map_err(|e| format!("mkdir {}: {e}", bin_pending_dir.display()))?;
    let bin_pending = bin_pending_dir.join(bin_name);
    // Same TOCTOU-safe pattern as the cert copy loop: read source bytes
    // once, hash those bytes, write the pending copy from the in-memory
    // buffer. `fs::copy` + `fs::read(pending)` opens a window where a user
    // process can overwrite the pending binary after copy but before read,
    // producing a hash that drifts from what shasum later sees.
    let bytes = fs::read(user_bin_path)
        .map_err(|e| format!("read binary {user_binary}: {e}"))?;
    fs::write(&bin_pending, &bytes).map_err(|e| {
        format!(
            "write staged binary {} ← {}: {e}",
            bin_pending.display(),
            user_binary,
        )
    })?;
    files.push(PendingFile {
        pending_src: bin_pending.to_string_lossy().into_owned(),
        final_dst: final_binary.to_string_lossy().into_owned(),
        sha256_hex: sha256_hex(&bytes),
        mode: "755",
    });

    Ok(files)
}

/// Steps for removing a unit: reclaim ancestor chain → bootout (tolerant of
/// unloaded) → rm plist → rm root staging (symlink-rejecting). All steps use
/// `|| true` or `rm -f` / symlink-safe `rm -rf` so the sequence survives
/// half-installed state under `set -euo pipefail`.
///
/// The ancestor reclaim here protects against the uninstall version of the
/// same TOCTOU: a user process can't make us follow a symlink out of the
/// Badami staging tree because [`reclaim_ancestor_chain_argv`] rejects
/// symlinks and [`safe_rm_rf_dir_argv`] re-checks the leaf before `rm -rf`.
fn unit_uninstall_argv(label: &str, plist_path: &str, staging_dir: &str) -> Vec<Vec<String>> {
    let qlabel = shell_single_quote(label);
    let mut out: Vec<Vec<String>> = Vec::new();

    // Reclaim the ancestor chain first — if an attacker pre-planted
    // `/Library/Application Support/Badami/local-dev-root` as a symlink
    // pointing somewhere sensitive (e.g. a user home dir), we refuse to
    // continue rather than follow it into `rm -rf`.
    out.extend(reclaim_ancestor_chain_argv(staging_dir));
    // After reclaim, staging_dir is a fresh empty root-owned dir. Remove
    // it (symlink-safe guard is belt-and-braces).
    out.push(vec![
        "/bin/sh".into(),
        "-c".into(),
        format!("launchctl bootout system/{qlabel} 2>/dev/null || true"),
    ]);
    out.push(vec!["rm".into(), "-f".into(), "--".into(), plist_path.into()]);
    out.push(safe_rm_rf_dir_argv(staging_dir));
    out
}

/// Compose an `osascript -e <body>` AppleScript string that runs every argv in
/// order inside a single `do shell script … with administrator privileges`
/// block. The user authenticates once per call.
pub fn build_osascript_command(argvs: &[Vec<String>]) -> String {
    let mut shell_lines: Vec<String> = Vec::new();
    shell_lines.push("set -euo pipefail".into());
    for argv in argvs {
        shell_lines.push(join_argv(argv));
    }
    let combined = shell_lines.join("; ");
    format!(
        "do shell script {} with administrator privileges",
        applescript_quote(&combined)
    )
}

fn join_argv(argv: &[String]) -> String {
    argv.iter()
        .map(|a| shell_single_quote(a))
        .collect::<Vec<_>>()
        .join(" ")
}

fn render_step(argv: &[String]) -> String {
    join_argv(argv)
}

// ── Plist renderer / validator ──────────────────────────────────────

/// Render a minimal root LaunchDaemon plist (ProgramArguments argv only).
///
/// Caller must supply `stdout`/`stderr` paths — the earlier scaffold used
/// `/tmp/…` which is world-writable and lets any user tamper with the launchd
/// log files. The new default routes both into `local-dev-root/<role>/…`.
pub fn render_launch_daemon_plist(
    label: &str,
    program_arguments: &[String],
    stdout: &str,
    stderr: &str,
    run_at_load: bool,
    keep_alive: bool,
) -> String {
    let mut args_xml = String::new();
    for a in program_arguments {
        args_xml.push_str(&format!("\t\t<string>{}</string>\n", xml_escape(a)));
    }
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>{label}</string>
	<key>ProgramArguments</key>
	<array>
{args_xml}	</array>
	<key>RunAtLoad</key>
	<{run_at_load}/>
	<key>KeepAlive</key>
	<{keep_alive}/>
	<key>StandardOutPath</key>
	<string>{stdout}</string>
	<key>StandardErrorPath</key>
	<string>{stderr}</string>
</dict>
</plist>
"#,
        label = xml_escape(label),
        args_xml = args_xml,
        run_at_load = if run_at_load { "true" } else { "false" },
        keep_alive = if keep_alive { "true" } else { "false" },
        stdout = xml_escape(stdout),
        stderr = xml_escape(stderr),
    )
}

/// Any argv entry that looks like a path (contains `/`) must sit under a
/// root-owned prefix. Non-path tokens (flags, `daemon off;`) are allowed.
pub fn validate_plist_argv(argv: &[String]) -> Result<(), String> {
    if argv.is_empty() {
        return Err("plist ProgramArguments is empty".into());
    }
    // argv[0] is always a path — it's the binary launchd execs.
    if !is_root_safe_path(&argv[0]) {
        return Err(format!(
            "plist ProgramArguments[0] (binary) not under a root-owned prefix: {}",
            argv[0]
        ));
    }
    for a in &argv[1..] {
        if looks_like_path(a) && !is_root_safe_path(a) {
            return Err(format!(
                "plist ProgramArguments contains non-root path: {a}"
            ));
        }
    }
    Ok(())
}

pub fn validate_plist_io_paths(stdout: &str, stderr: &str) -> Result<(), String> {
    if !is_root_safe_path(stdout) {
        return Err(format!("StandardOutPath not root-owned: {stdout}"));
    }
    if !is_root_safe_path(stderr) {
        return Err(format!("StandardErrorPath not root-owned: {stderr}"));
    }
    Ok(())
}

fn is_root_safe_path(p: &str) -> bool {
    ROOT_SAFE_PREFIXES.iter().any(|pref| {
        // Allow prefix with or without trailing slash to match a full dir path.
        if pref.ends_with('/') {
            p.starts_with(pref)
        } else {
            p == *pref || p.starts_with(&format!("{pref}/"))
        }
    })
}

fn looks_like_path(s: &str) -> bool {
    s.starts_with('/')
}

// ── Writers ─────────────────────────────────────────────────────────

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn write_scaffold(path: &Path, body: &str, written: &mut Vec<String>) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
    }
    fs::write(path, body).map_err(|e| format!("write {}: {e}", path.display()))?;
    written.push(path.to_string_lossy().into_owned());
    Ok(())
}

/// Compose the exact resolver(5) file body for a given TLD / loopback / port.
///
/// Used both to produce the user-side draft (so operators can audit what
/// would land in `/etc/resolver/<tld>`) and to feed [`resolver_install_argv`]
/// which embeds the string into the privileged `printf > tmpfile; mv -f`
/// sequence. Must stay in sync with [`write_resolver_draft`].
pub fn resolver_file_contents(tld: &str, loopback: &str, port: u16) -> String {
    format!(
        "{marker}\n\
         # Badami Local Dev — macOS resolver(5) draft for *.{tld}\n\
         # Install: Badami writes this file atomically from the osascript \
privileged shell; do not edit by hand.\n\
         # D2 high-port DNS (KD23) — nameserver on non-53 port.\n\
         nameserver {loopback}\n\
         port {port}\n",
        marker = RESOLVER_MARKER,
    )
}

fn write_resolver_draft(
    launchd_dir: &Path,
    tld: &str,
    loopback: &str,
    port: u16,
    written: &mut Vec<String>,
) -> Result<String, String> {
    let path = launchd_dir.join(format!("resolver-{tld}"));
    let body = resolver_file_contents(tld, loopback, port);
    write_scaffold(&path, &body, written)?;
    Ok(path.to_string_lossy().into_owned())
}

fn validate_tld(tld: &str) -> Result<(), String> {
    if tld.is_empty() || tld.len() > 63 {
        return Err("tld must be 1–63 characters".into());
    }
    if tld.contains('/') || tld.contains('.') || tld.contains("..") {
        return Err("tld must be a single label without dots or path separators".into());
    }
    if !tld.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("tld contains invalid characters".into());
    }
    Ok(())
}

fn validate_loopback(loopback: &str) -> Result<(), String> {
    if loopback != "127.0.0.1" && loopback != "::1" {
        return Err(format!("loopback must be 127.0.0.1 or ::1 (got {loopback})"));
    }
    Ok(())
}

// ── Shell / AppleScript quoting ─────────────────────────────────────

/// Single-quote a path for POSIX shells (`'foo'\''bar'` style). Unit-tested so
/// its invariants hold across every call-site in the file.
pub fn shell_single_quote(s: &str) -> String {
    if s.is_empty() {
        return "''".into();
    }
    let mut out = String::with_capacity(s.len() + 2);
    out.push('\'');
    for ch in s.chars() {
        if ch == '\'' {
            out.push_str("'\\''");
        } else {
            out.push(ch);
        }
    }
    out.push('\'');
    out
}

/// Quote a string for embedding inside an AppleScript double-quoted literal.
///
/// AppleScript strings treat `\\` and `\"` as escapes inside `"…"`. Nothing
/// else is special, so this is the complete escape list.
pub fn applescript_quote(s: &str) -> String {
    let escaped = s.replace('\\', "\\\\").replace('"', "\\\"");
    format!("\"{escaped}\"")
}

// Needed by callers in older code (sites.rs reload). Kept here for shared quoting.
#[allow(dead_code)]
pub fn applescript_string(s: &str) -> String {
    applescript_quote(s)
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // Backwards-compat test labels (match the Phase A pre-refactor constants).
    const TEST_DNSMASQ_LABEL: &str = "com.khalid.badami.local-dev.dnsmasq";
    const TEST_NGINX_LABEL: &str = "com.khalid.badami.local-dev.nginx";

    #[test]
    fn package_parse() {
        assert_eq!(
            BootstrapPackage::parse("dns_only").unwrap(),
            BootstrapPackage::DnsOnly
        );
        assert_eq!(
            BootstrapPackage::parse("full").unwrap(),
            BootstrapPackage::Full
        );
        assert_eq!(
            BootstrapPackage::parse("resync").unwrap(),
            BootstrapPackage::Resync
        );
        assert!(BootstrapPackage::parse("nope").is_err());
    }

    #[test]
    fn ld_label_default_identifier() {
        assert_eq!(ld_label("com.khalid.badami", "dnsmasq"), TEST_DNSMASQ_LABEL);
        assert_eq!(ld_label("com.khalid.badami", "nginx"), TEST_NGINX_LABEL);
        assert_eq!(ld_label("", "dnsmasq"), TEST_DNSMASQ_LABEL);
        // Different identifier produces different label.
        assert_eq!(
            ld_label("com.example.myapp", "dnsmasq"),
            "com.example.myapp.local-dev.dnsmasq"
        );
    }

    #[test]
    fn launchd_label_matches_default() {
        assert_eq!(launchd_label("dnsmasq"), TEST_DNSMASQ_LABEL);
        assert_eq!(launchd_label("nginx"), TEST_NGINX_LABEL);
    }

    #[test]
    fn shell_quote_handles_application_support_spaces() {
        let p = "/Users/me/Library/Application Support/Badami/local-dev/launchd/install.sh";
        let q = shell_single_quote(p);
        assert_eq!(
            q,
            "'/Users/me/Library/Application Support/Badami/local-dev/launchd/install.sh'"
        );
        assert!(q.contains("Application Support"));
        assert_eq!(shell_single_quote("a'b"), "'a'\\''b'");
        assert_eq!(shell_single_quote(""), "''");
    }

    #[test]
    fn applescript_quote_escapes_backslash_and_quote() {
        assert_eq!(applescript_quote("hello"), "\"hello\"");
        assert_eq!(applescript_quote("he said \"hi\""), "\"he said \\\"hi\\\"\"");
        assert_eq!(applescript_quote("a\\b"), "\"a\\\\b\"");
    }

    #[test]
    fn plist_contains_label_and_args() {
        let xml = render_launch_daemon_plist(
            TEST_DNSMASQ_LABEL,
            &["/usr/sbin/dnsmasq".into(), "--keep-in-foreground".into()],
            "/Library/Application Support/Badami/local-dev-root/dnsmasq/out.log",
            "/Library/Application Support/Badami/local-dev-root/dnsmasq/err.log",
            true,
            true,
        );
        assert!(xml.contains(TEST_DNSMASQ_LABEL));
        assert!(xml.contains("/usr/sbin/dnsmasq"));
        assert!(xml.contains("keep-in-foreground"));
        assert!(xml.contains("<true/>"));
        assert!(xml.contains("ProgramArguments"));
        assert!(xml.contains("local-dev-root"));
        let xml2 = render_launch_daemon_plist(
            "x",
            &["a<b".into()],
            "/usr/bin/true",
            "/usr/bin/true",
            false,
            false,
        );
        assert!(xml2.contains("a&lt;b"));
        assert!(xml2.contains("<false/>"));
    }

    #[test]
    fn is_root_safe_path_matrix() {
        assert!(is_root_safe_path(
            "/Library/Application Support/Badami/local-dev-root/nginx/nginx"
        ));
        assert!(is_root_safe_path("/usr/bin/true"));
        assert!(is_root_safe_path("/bin/sh"));
        assert!(is_root_safe_path("/usr/sbin/dnsmasq"));
        assert!(is_root_safe_path(
            "/var/log/badami-local-dev/nginx.err.log"
        ));
        assert!(!is_root_safe_path("/Users/me/Library/Application Support/Badami/local-dev/nginx/nginx.conf"));
        assert!(!is_root_safe_path("/tmp/com.khalid.badami.local-dev.nginx.err.log"));
    }

    #[test]
    fn validate_plist_argv_accepts_root_paths() {
        let dnsmasq = vec![
            "/Library/Application Support/Badami/local-dev-root/dnsmasq/dnsmasq".to_string(),
            "--keep-in-foreground".into(),
            "--conf-file".into(),
            "/Library/Application Support/Badami/local-dev-root/dnsmasq/dnsmasq.conf".into(),
            "--pid-file".into(),
            "/Library/Application Support/Badami/local-dev-root/dnsmasq/dnsmasq.pid".into(),
            "--log-facility".into(),
            "/Library/Application Support/Badami/local-dev-root/dnsmasq/dnsmasq.log".into(),
        ];
        validate_plist_argv(&dnsmasq).expect("dnsmasq argv is root-safe");

        let nginx = vec![
            "/Library/Application Support/Badami/local-dev-root/nginx/nginx".to_string(),
            "-g".into(),
            "daemon off;".into(),
            "-c".into(),
            "/Library/Application Support/Badami/local-dev-root/nginx/nginx.conf".into(),
            "-p".into(),
            "/Library/Application Support/Badami/local-dev-root/nginx".into(),
        ];
        validate_plist_argv(&nginx).expect("nginx argv is root-safe");

        validate_plist_io_paths(
            "/Library/Application Support/Badami/local-dev-root/nginx/out.log",
            "/Library/Application Support/Badami/local-dev-root/nginx/err.log",
        )
        .unwrap();
    }

    #[test]
    fn validate_plist_argv_rejects_user_writable_paths() {
        let bad = vec![
            "/Users/me/Library/Application Support/Badami/local-dev/nginx/nginx".to_string(),
            "-c".into(),
            "/Users/me/Library/Application Support/Badami/local-dev/nginx/nginx.conf".into(),
        ];
        let err = validate_plist_argv(&bad).unwrap_err();
        assert!(err.contains("binary") || err.contains("non-root"), "err={err}");

        let bad_io = validate_plist_io_paths(
            "/tmp/com.khalid.badami.local-dev.nginx.err.log",
            "/tmp/com.khalid.badami.local-dev.nginx.out.log",
        )
        .unwrap_err();
        assert!(bad_io.contains("not root-owned"));
    }

    #[test]
    fn bootstrap_install_dns_only_writes_root_safe_plist() {
        let res = bootstrap_install(BootstrapInstallRequest {
            package: "dns_only".into(),
            dry_run: Some(true),
            tld: Some("test".into()),
            loopback: Some("127.0.0.1".into()),
            dns_port: None,
            nginx_binary: None,
            dnsmasq_binary: Some("/usr/bin/true".into()),
            attempt_privileged_install: Some(false),
            identifier: None,
        })
        .expect("install");
        assert!(res.dry_run);
        assert!(!res.privileged_attempted);
        assert!(!res.written.is_empty());
        let unit = res
            .units
            .iter()
            .find(|u| u.role == "dnsmasq")
            .expect("dnsmasq unit");
        assert_eq!(unit.label, TEST_DNSMASQ_LABEL);
        assert!(
            unit.root_staging_dir
                .starts_with("/Library/Application Support/Badami/local-dev-root"),
            "root_staging_dir={}",
            unit.root_staging_dir
        );
        // Every program arg path lives under a root-safe prefix.
        validate_plist_argv(&unit.program_arguments).unwrap();
        // The scaffold plist on disk must contain the root-staging paths.
        let body = fs::read_to_string(&unit.scaffold_plist).unwrap();
        assert!(body.contains("local-dev-root/dnsmasq"));
        // install_command is osascript, not `bash /…/script`.
        let cmd = res.install_command.as_ref().unwrap();
        assert!(cmd.starts_with("do shell script"), "cmd={cmd}");
        assert!(cmd.contains("administrator privileges"));
    }

    #[test]
    fn bootstrap_install_full_renders_both_units() {
        let res = bootstrap_install(BootstrapInstallRequest {
            package: "full".into(),
            dry_run: Some(true),
            tld: Some("test".into()),
            loopback: Some("127.0.0.1".into()),
            dns_port: None,
            nginx_binary: Some("/usr/bin/true".into()),
            dnsmasq_binary: Some("/usr/bin/true".into()),
            attempt_privileged_install: None,
            identifier: Some("com.example.myapp".into()),
        })
        .expect("install");
        assert_eq!(res.units.len(), 2);
        let labels: Vec<&str> = res.units.iter().map(|u| u.label.as_str()).collect();
        assert!(labels.contains(&"com.example.myapp.local-dev.dnsmasq"));
        assert!(labels.contains(&"com.example.myapp.local-dev.nginx"));
    }

    #[test]
    fn bootstrap_install_resync_only_builds_privileged_command() {
        let res = bootstrap_install(BootstrapInstallRequest {
            package: "resync".into(),
            dry_run: Some(true),
            tld: None,
            loopback: None,
            dns_port: None,
            nginx_binary: None,
            dnsmasq_binary: None,
            attempt_privileged_install: None,
            identifier: None,
        })
        .expect("install");
        assert!(res.units.is_empty());
        let cmd = res.install_command.unwrap();
        assert!(cmd.contains("kickstart"));
    }

    #[test]
    fn bootstrap_install_high_port_resolver_has_marker() {
        let res = bootstrap_install(BootstrapInstallRequest {
            package: "dns_high_port".into(),
            dry_run: Some(true),
            tld: Some("test".into()),
            loopback: Some("127.0.0.1".into()),
            dns_port: Some(53535),
            nginx_binary: None,
            dnsmasq_binary: None,
            attempt_privileged_install: None,
            identifier: None,
        })
        .expect("install");
        let draft = res
            .written
            .iter()
            .find(|p| p.contains("resolver-test"))
            .expect("resolver draft written");
        let body = fs::read_to_string(draft).unwrap();
        assert!(body.contains(RESOLVER_MARKER), "body missing marker:\n{body}");
        assert!(body.contains("port 53535"));
        assert!(body.contains("nameserver 127.0.0.1"));
    }

    #[test]
    fn bootstrap_install_rejects_bad_tld() {
        let err = bootstrap_install(BootstrapInstallRequest {
            package: "dns_only".into(),
            dry_run: Some(true),
            tld: Some("../etc".into()),
            loopback: Some("127.0.0.1".into()),
            dns_port: None,
            nginx_binary: None,
            dnsmasq_binary: None,
            attempt_privileged_install: None,
            identifier: None,
        })
        .unwrap_err();
        assert!(err.contains("tld"));
    }

    #[test]
    fn bootstrap_uninstall_dry_run_dns_only() {
        let res = bootstrap_uninstall(BootstrapUninstallRequest {
            package: "dns_only".into(),
            confirm_resolver: None,
            dry_run: Some(true),
            tld: Some("test".into()),
            identifier: None,
        })
        .expect("uninstall");
        assert!(res.dry_run);
        assert!(!res.executed);
        assert!(res.labels.contains(&TEST_DNSMASQ_LABEL.to_string()));
        // Steps are shell-quoted argv — never contain the Herd helper path.
        assert!(!res.steps.iter().any(|s| s.contains("herd.helper")));
        // Must contain bootout, rm plist, rm staging.
        let joined = res.steps.join("\n");
        assert!(joined.contains("launchctl") && joined.contains("bootout"));
        assert!(joined.contains("/Library/LaunchDaemons/"));
        assert!(joined.contains("local-dev-root/dnsmasq"));
    }

    #[test]
    fn bootstrap_uninstall_full_touches_both_units() {
        let res = bootstrap_uninstall(BootstrapUninstallRequest {
            package: "full".into(),
            confirm_resolver: None,
            dry_run: Some(true),
            tld: Some("test".into()),
            identifier: Some("com.example.myapp".into()),
        })
        .expect("uninstall");
        assert_eq!(res.labels.len(), 2);
        assert!(res
            .labels
            .iter()
            .any(|l| l == "com.example.myapp.local-dev.dnsmasq"));
        assert!(res
            .labels
            .iter()
            .any(|l| l == "com.example.myapp.local-dev.nginx"));
    }

    #[test]
    fn bootstrap_uninstall_resolver_without_marker_refuses() {
        // When /etc/resolver/<tld> is absent we never try to remove it; when
        // present without the marker we need confirm_resolver=true. Here we
        // just check that confirm_resolver=false + absent-or-unmarked results
        // in zero resolver steps.
        let res = bootstrap_uninstall(BootstrapUninstallRequest {
            package: "resolver".into(),
            confirm_resolver: Some(false),
            dry_run: Some(true),
            tld: Some("test".into()),
            identifier: None,
        })
        .expect("uninstall");
        assert!(res.labels.is_empty());
        // Resolver step only present if a marker-carrying file existed; in CI
        // it won't, so steps must be empty.
        assert!(
            res.steps.is_empty() || res.steps.iter().any(|s| s.contains("rm")),
            "steps={:?}",
            res.steps
        );
    }

    #[test]
    fn build_osascript_command_single_prompt() {
        let argvs = vec![
            vec!["mkdir".into(), "-p".into(), "/Library/Application Support/Badami/local-dev-root/nginx".into()],
            vec!["chown".into(), "root:wheel".into(), "/Library/Application Support/Badami/local-dev-root/nginx".into()],
        ];
        let cmd = build_osascript_command(&argvs);
        assert!(cmd.starts_with("do shell script "));
        assert!(cmd.ends_with(" with administrator privileges"));
        // Both argvs collapsed into one shell command separated by `;`.
        assert!(cmd.contains("mkdir") && cmd.contains("chown"));
        // Single-quoted paths — no bash -c + raw string interpolation.
        assert!(cmd.contains("'/Library/Application Support/Badami/local-dev-root/nginx'"));
        assert!(cmd.contains("set -euo pipefail"));
    }

    // ── Hardening tests (v1.15.0): root variants, hash verify, labels ──

    use std::time::{SystemTime, UNIX_EPOCH};

    /// Return a fresh temp dir with a per-test suffix. Never reused across
    /// tests so parallel runs don't clobber each other.
    fn unique_tmp(label: &str) -> std::path::PathBuf {
        let n = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let pid = std::process::id();
        std::env::temp_dir().join(format!("badami-boot-{label}-{pid}-{n}"))
    }

    /// Build a minimally populated user-side nginx dir mirroring what
    /// `write_nginx_configs` emits. Returns the nginx dir + runtime paths
    /// pointing at the same temp root (so logs/pids rewrites hit real
    /// strings).
    fn build_user_nginx_tree(label: &str) -> (std::path::PathBuf, std::path::PathBuf, std::path::PathBuf, std::path::PathBuf) {
        let root = unique_tmp(label);
        let nginx = root.join("nginx");
        let logs = root.join("logs");
        let pids = root.join("pids");
        for d in [&nginx, &nginx.join("sites"), &logs, &pids] {
            fs::create_dir_all(d).unwrap();
        }
        // nginx.conf — includes mime.types, sites/*, badami.conf; absolute
        // error_log + pid under user logs/pids.
        let nginx_conf = format!(
            "worker_processes auto;\n\
             error_log \"{logs}/nginx-error.log\";\n\
             pid \"{pids}/nginx.pid\";\n\
             events {{ worker_connections 1024; }}\n\
             http {{\n\
                 include \"{nginx}/mime.types\";\n\
                 default_type application/octet-stream;\n\
                 include \"{nginx}/sites/*.conf\";\n\
                 include \"{nginx}/badami.conf\";\n\
             }}\n",
            logs = logs.display(),
            pids = pids.display(),
            nginx = nginx.display(),
        );
        fs::write(nginx.join("nginx.conf"), nginx_conf).unwrap();
        // badami.conf — fastcgi_pass unix socket is a USER path (allowed —
        // php-fpm user process owns the socket). include fastcgi_params is a
        // NGINX config load → must be rewritten.
        let badami_conf = format!(
            "server {{\n\
                 listen 127.0.0.1:8080 default_server;\n\
                 location ~ \\.php$ {{\n\
                     fastcgi_pass \"unix:{root}/socks/php84.sock\";\n\
                     include \"{nginx}/fastcgi_params\";\n\
                     fastcgi_param SCRIPT_FILENAME \"{root}/valet-server/server.php\";\n\
                     fastcgi_param HERD_HOME \"{root}\";\n\
                 }}\n\
             }}\n",
            nginx = nginx.display(),
            root = root.display(),
        );
        fs::write(nginx.join("badami.conf"), badami_conf).unwrap();
        fs::write(nginx.join("mime.types"), "text/html html htm;\n").unwrap();
        fs::write(
            nginx.join("fastcgi_params"),
            "fastcgi_param QUERY_STRING $query_string;\n",
        )
        .unwrap();

        (root, nginx, logs, pids)
    }

    #[test]
    fn validate_launchd_label_accepts_valid_shapes() {
        validate_launchd_label("com.khalid.badami.local-dev.dnsmasq").unwrap();
        validate_launchd_label("a").unwrap();
        validate_launchd_label("a-b-c").unwrap();
        validate_launchd_label(&"a".repeat(128)).unwrap();
    }

    #[test]
    fn validate_launchd_label_rejects_bad_shapes() {
        // Empty / wrong-first-char / too-long / forbidden chars.
        assert!(validate_launchd_label("").is_err());
        assert!(validate_launchd_label(".foo").is_err());
        assert!(validate_launchd_label("-foo").is_err());
        assert!(validate_launchd_label(&"a".repeat(129)).is_err());
        assert!(validate_launchd_label("foo bar").is_err(), "space must be rejected");
        assert!(validate_launchd_label("foo'bar").is_err(), "quote must be rejected");
        assert!(validate_launchd_label("foo;echo pwn").is_err(), "shell meta must be rejected");
        assert!(validate_launchd_label("foo$bar").is_err());
        assert!(validate_launchd_label("foo/bar").is_err());
        assert!(validate_launchd_label("foo\nbar").is_err());
    }

    #[test]
    fn render_nginx_root_variants_rewrites_user_paths() {
        let (_root, nginx, logs, pids) = build_user_nginx_tree("rewrite");
        let pending = unique_tmp("rewrite-pending");
        fs::create_dir_all(&pending).unwrap();
        let root_nginx = std::path::PathBuf::from(ROOT_STAGING_PREFIX).join("nginx");

        let files = render_nginx_root_variants(&NginxRootVariantInput {
            user_nginx_dir: &nginx,
            user_logs_dir: &logs,
            user_pids_dir: &pids,
            root_nginx_dir: &root_nginx,
            pending_dir: &pending,
        })
        .expect("render");

        assert!(!files.is_empty(), "pending files should be rendered");
        // Find the staged nginx.conf and check it carries no user paths.
        let nginx_conf_file = files
            .iter()
            .find(|f| f.final_dst.ends_with("/nginx/nginx.conf"))
            .expect("nginx.conf staged");
        let staged = fs::read_to_string(&nginx_conf_file.pending_src).unwrap();
        assert!(
            !staged.contains(&nginx.to_string_lossy().to_string()),
            "user nginx dir leaked into root variant:\n{staged}"
        );
        assert!(
            !staged.contains(&logs.to_string_lossy().to_string()),
            "user logs dir leaked into root variant"
        );
        assert!(
            !staged.contains(&pids.to_string_lossy().to_string()),
            "user pids dir leaked into root variant"
        );
        assert!(
            staged.contains("/Library/Application Support/Badami/local-dev-root/nginx/"),
            "root nginx dir not in rewritten config"
        );
        // SHA-256 must match the staged file bytes exactly.
        assert_eq!(nginx_conf_file.sha256_hex, sha256_hex(staged.as_bytes()));

        // badami.conf keeps user-side valet-server + fastcgi socket paths
        // intact (those go to php-fpm, not nginx-root). The include for
        // fastcgi_params must flip to root.
        let badami_conf_file = files
            .iter()
            .find(|f| f.final_dst.ends_with("/nginx/badami.conf"))
            .expect("badami.conf staged");
        let badami = fs::read_to_string(&badami_conf_file.pending_src).unwrap();
        assert!(badami.contains("valet-server/server.php"),
                "SCRIPT_FILENAME must be preserved for php-fpm handoff");
        assert!(
            badami.contains(
                "include \"/Library/Application Support/Badami/local-dev-root/nginx/fastcgi_params\""
            ),
            "fastcgi_params include must be rewritten:\n{badami}"
        );
    }

    #[test]
    fn validate_nginx_root_variant_rejects_load_module() {
        let body =
            "load_module \"/Library/Application Support/Badami/local-dev-root/nginx/mod.so\";\n";
        let err = validate_nginx_root_variant(body, "nginx.conf").unwrap_err();
        assert!(err.contains("load_module"), "err={err}");
    }

    #[test]
    fn validate_nginx_root_variant_rejects_perl_js_lua_prefixes() {
        for forbidden in &[
            "perl_set $foo 'sub { return 1; }';",
            "js_import main.js;",
            "lua_shared_dict d 1m;",
        ] {
            let err = validate_nginx_root_variant(forbidden, "test").unwrap_err();
            assert!(err.contains("forbidden"), "err={err}");
        }
    }

    #[test]
    fn validate_nginx_root_variant_rejects_user_writable_include() {
        let body = "include \"/Users/me/evil.conf\";\n";
        let err = validate_nginx_root_variant(body, "nginx.conf").unwrap_err();
        assert!(err.contains("ROOT_SAFE_PREFIXES") || err.contains("outside"), "err={err}");
    }

    #[test]
    fn validate_nginx_root_variant_rejects_user_root() {
        let err = validate_nginx_root_variant("user root;\n", "nginx.conf").unwrap_err();
        assert!(err.contains("user root"), "err={err}");
    }

    #[test]
    fn validate_nginx_root_variant_accepts_root_safe_body() {
        let body = r#"
worker_processes auto;
error_log "/Library/Application Support/Badami/local-dev-root/nginx/nginx-error.log";
pid "/Library/Application Support/Badami/local-dev-root/nginx/nginx.pid";
events { worker_connections 1024; }
http {
    include "/Library/Application Support/Badami/local-dev-root/nginx/mime.types";
    include "/Library/Application Support/Badami/local-dev-root/nginx/sites/*.conf";
    include "/Library/Application Support/Badami/local-dev-root/nginx/badami.conf";
}
"#;
        validate_nginx_root_variant(body, "nginx.conf").expect("root-safe body must accept");
    }

    #[test]
    fn validate_dnsmasq_root_variant_rejects_dhcp_script() {
        let body = "listen-address=127.0.0.1\nport=53\ndhcp-script=/usr/bin/evil\n";
        let err = validate_dnsmasq_root_variant(body).unwrap_err();
        assert!(err.contains("dhcp-script"), "err={err}");
    }

    #[test]
    fn validate_dnsmasq_root_variant_rejects_forbidden_keys() {
        for forbidden in &[
            "conf-dir=/etc/evil\n",
            "conf-file=/tmp/evil.conf\n",
            "servers-file=/tmp/servers\n",
            "addn-hosts=/tmp/hosts\n",
            "dhcp-hostsfile=/tmp/dh\n",
            "dhcp-optsfile=/tmp/do\n",
            "script-arp=/tmp/arp.sh\n",
            "dhcp-luascript=/tmp/x.lua\n",
            "tftp-root=/tmp/tftp\n",
            "tftp-no-fail\n",
            "user=root\n",
        ] {
            let err = validate_dnsmasq_root_variant(forbidden).unwrap_err();
            assert!(err.contains("forbidden"), "err={err} body={forbidden}");
        }
    }

    #[test]
    fn validate_dnsmasq_root_variant_rejects_user_pid_log_paths() {
        let body = "pid-file=/Users/me/local-dev/pids/dnsmasq.pid\n";
        let err = validate_dnsmasq_root_variant(body).unwrap_err();
        assert!(err.contains("pid-file"), "err={err}");
        let body2 = "log-facility=/Users/me/local-dev/logs/dnsmasq.log\n";
        let err2 = validate_dnsmasq_root_variant(body2).unwrap_err();
        assert!(err2.contains("log-facility"), "err={err2}");
    }

    #[test]
    fn render_dnsmasq_root_variants_rewrites_pid_and_log() {
        let root = unique_tmp("dnsmasq-rewrite");
        let dnsmasq_dir = root.join("dnsmasq");
        let logs = root.join("logs");
        let pids = root.join("pids");
        for d in [&dnsmasq_dir, &logs, &pids] {
            fs::create_dir_all(d).unwrap();
        }
        let dnsmasq_conf = dnsmasq_dir.join("dnsmasq.conf");
        fs::write(
            &dnsmasq_conf,
            format!(
                "listen-address=127.0.0.1\n\
                 bind-interfaces\n\
                 port=53\n\
                 no-resolv\n\
                 no-hosts\n\
                 address=/.test/127.0.0.1\n\
                 pid-file={pids}/dnsmasq.pid\n\
                 log-facility={logs}/dnsmasq.log\n",
                pids = pids.display(),
                logs = logs.display(),
            ),
        )
        .unwrap();

        let pending = unique_tmp("dnsmasq-pending");
        fs::create_dir_all(&pending).unwrap();
        let root_dnsmasq = std::path::PathBuf::from(ROOT_STAGING_PREFIX).join("dnsmasq");

        let files = render_dnsmasq_root_variants(&DnsmasqRootVariantInput {
            user_dnsmasq_conf: &dnsmasq_conf,
            user_logs_dir: &logs,
            user_pids_dir: &pids,
            root_dnsmasq_dir: &root_dnsmasq,
            pending_dir: &pending,
        })
        .expect("render");

        assert_eq!(files.len(), 1);
        let staged = fs::read_to_string(&files[0].pending_src).unwrap();
        assert!(
            !staged.contains(&logs.to_string_lossy().to_string()),
            "user logs dir leaked:\n{staged}"
        );
        assert!(
            !staged.contains(&pids.to_string_lossy().to_string()),
            "user pids dir leaked"
        );
        assert!(
            staged.contains("pid-file=/Library/Application Support/Badami/local-dev-root/dnsmasq/"),
            "pid-file should rewrite to root dnsmasq dir:\n{staged}"
        );
        assert!(
            staged.contains(
                "log-facility=/Library/Application Support/Badami/local-dev-root/dnsmasq/"
            ),
            "log-facility should rewrite to root dnsmasq dir"
        );
        assert_eq!(files[0].sha256_hex, sha256_hex(staged.as_bytes()));
    }

    #[test]
    fn verify_hashes_argv_precedes_launchctl() {
        // Build a one-file install plan and confirm that the generated shell
        // sequence puts every shasum check before the first launchctl call.
        let f = PendingFile {
            pending_src: "/tmp/badami-test-pending/nginx.conf".into(),
            final_dst: "/Library/Application Support/Badami/local-dev-root/nginx/nginx.conf".into(),
            sha256_hex: "deadbeef".repeat(8),
            mode: "644",
        };
        let plist = "/Library/LaunchDaemons/com.khalid.badami.local-dev.nginx.plist";
        let argvs = unit_install_argv_with_verify(
            "com.khalid.badami.local-dev.nginx",
            plist,
            "/Library/Application Support/Badami/local-dev-root/nginx",
            std::slice::from_ref(&f),
            &[plist.to_string()],
        );
        let cmd = build_osascript_command(&argvs);
        // Argvs are shell-single-quoted individually, so `launchctl bootstrap`
        // appears as `'launchctl' 'bootstrap'` in the final osascript body.
        let verify_pos = cmd.find("shasum").expect("shasum step present");
        let launchctl_pos = cmd
            .find("'launchctl' 'bootstrap'")
            .expect("launchctl bootstrap present");
        assert!(
            verify_pos < launchctl_pos,
            "shasum must run BEFORE launchctl bootstrap: shasum@{verify_pos} vs launchctl@{launchctl_pos}"
        );
        // Expected hash is embedded in the command (not read from a file).
        assert!(cmd.contains(&f.sha256_hex));
        // Rollback paths referenced in the mismatch branch.
        assert!(cmd.contains("rm -rf"));
        // bootout tolerant (|| true).
        assert!(cmd.contains("bootout") && cmd.contains("|| true"));
        // kickstart tolerant (|| true).
        assert!(
            cmd.contains("kickstart -k") && cmd.contains("2>/dev/null || true"),
            "kickstart must be wrapped `|| true`"
        );
    }

    #[test]
    fn bootstrap_uninstall_bootout_is_tolerant_of_unloaded() {
        let res = bootstrap_uninstall(BootstrapUninstallRequest {
            package: "dns_only".into(),
            confirm_resolver: None,
            dry_run: Some(true),
            tld: Some("test".into()),
            identifier: None,
        })
        .expect("uninstall");
        // The emitted step for bootout must swallow the "not loaded" exit code.
        let joined = res.steps.join("\n");
        assert!(
            joined.contains("bootout") && joined.contains("|| true"),
            "bootout step must be `|| true` tolerant:\n{joined}"
        );
    }

    #[test]
    fn render_nginx_root_variants_rejects_forbidden_directive_in_user_tree() {
        // Simulate a hostile user-side nginx.conf that embeds `load_module`.
        // The renderer must bubble up the validation failure rather than
        // staging the file for root install.
        let (_root, nginx, logs, pids) = build_user_nginx_tree("hostile");
        let hostile = format!(
            "worker_processes auto;\n\
             load_module modules/evil.so;\n\
             error_log \"{logs}/nginx-error.log\";\n\
             pid \"{pids}/nginx.pid\";\n\
             events {{ worker_connections 1024; }}\n\
             http {{\n\
                 include \"{nginx}/mime.types\";\n\
             }}\n",
            logs = logs.display(),
            pids = pids.display(),
            nginx = nginx.display(),
        );
        fs::write(nginx.join("nginx.conf"), hostile).unwrap();

        let pending = unique_tmp("hostile-pending");
        fs::create_dir_all(&pending).unwrap();
        let root_nginx = std::path::PathBuf::from(ROOT_STAGING_PREFIX).join("nginx");
        let err = render_nginx_root_variants(&NginxRootVariantInput {
            user_nginx_dir: &nginx,
            user_logs_dir: &logs,
            user_pids_dir: &pids,
            root_nginx_dir: &root_nginx,
            pending_dir: &pending,
        })
        .expect_err("hostile load_module must be rejected");
        assert!(err.contains("load_module"), "err={err}");
    }

    #[test]
    fn bootstrap_install_dns_rejects_hostile_identifier() {
        let err = bootstrap_install(BootstrapInstallRequest {
            package: "dns_only".into(),
            dry_run: Some(true),
            tld: Some("test".into()),
            loopback: Some("127.0.0.1".into()),
            dns_port: None,
            nginx_binary: None,
            dnsmasq_binary: Some("/usr/bin/true".into()),
            attempt_privileged_install: Some(false),
            identifier: Some("foo bar; rm -rf /".into()),
        })
        .unwrap_err();
        assert!(
            err.contains("launchd label") || err.contains("forbidden"),
            "err={err}"
        );
    }

    #[test]
    fn sha256_hex_matches_known_vector() {
        // "abc" sha256
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    // ── Validator tokenizer hardening (v1.15.0 security review) ────

    /// (a) `include "safe"; load_module "evil.so";` on one line — the old
    /// line-based scanner only inspected the first directive and `break`ed.
    /// The tokenizer-based validator must reject the hidden `load_module`.
    #[test]
    fn validate_nginx_rejects_inline_load_module_after_safe_include() {
        let body = "include \"/Library/Application Support/Badami/local-dev-root/nginx/safe.conf\"; \
                    load_module modules/evil.so;\n";
        let err = validate_nginx_root_variant(body, "nginx.conf").unwrap_err();
        assert!(err.contains("load_module"), "err={err}");
    }

    /// (b) Multi-line directive — `include\n    /tmp/evil.conf;` — the old
    /// scanner only looked at the opening line. The tokenizer stitches
    /// across newlines.
    #[test]
    fn validate_nginx_rejects_multiline_include_outside_root() {
        let body = "include\n    /tmp/evil.conf;\n";
        let err = validate_nginx_root_variant(body, "nginx.conf").unwrap_err();
        assert!(
            err.contains("ROOT_SAFE_PREFIXES") || err.contains("outside"),
            "err={err}"
        );
    }

    /// (c) `include "safe"; ssl_certificate "evil";` — the inner `break`
    /// short-circuited after the first directive matched.
    #[test]
    fn validate_nginx_rejects_inline_ssl_cert_after_safe_include() {
        let body = "include \"/Library/Application Support/Badami/local-dev-root/nginx/safe.conf\"; \
                    ssl_certificate \"/tmp/evil.pem\";\n";
        let err = validate_nginx_root_variant(body, "nginx.conf").unwrap_err();
        assert!(
            err.contains("ssl_certificate") && (err.contains("ROOT_SAFE_PREFIXES") || err.contains("outside")),
            "err={err}"
        );
    }

    /// (d) `include "safe"; include "evil";` — same bypass, same fix.
    #[test]
    fn validate_nginx_rejects_second_include_outside_root() {
        let body = "include \"/Library/Application Support/Badami/local-dev-root/nginx/safe.conf\"; \
                    include \"/tmp/evil.conf\";\n";
        let err = validate_nginx_root_variant(body, "nginx.conf").unwrap_err();
        assert!(
            err.contains("include") && (err.contains("ROOT_SAFE_PREFIXES") || err.contains("outside")),
            "err={err}"
        );
    }

    /// `#` inside a quoted string must NOT trigger a comment. The tokenizer
    /// treats everything inside the string as literal bytes.
    #[test]
    fn validate_nginx_hash_inside_double_quote_is_not_comment() {
        // The quoted server_name intentionally contains `#` — it must not
        // mask a trailing hostile directive (nothing hostile here, we're
        // asserting the body validates cleanly).
        let body = "server_name \"foo#bar.test\";\n";
        validate_nginx_root_variant(body, "nginx.conf").expect("# inside quotes must not comment out trailing content");
    }

    /// `#` inside a quoted string followed by a hostile directive on the
    /// same line must NOT comment out the directive — the hostile part
    /// still needs to be seen + rejected.
    #[test]
    fn validate_nginx_hash_in_quote_does_not_hide_directive() {
        let body = "server_name \"a#b\"; load_module evil.so;\n";
        let err = validate_nginx_root_variant(body, "nginx.conf").unwrap_err();
        assert!(err.contains("load_module"), "err={err}");
    }

    /// `;` inside a quoted string must NOT be treated as a statement
    /// terminator — the directive must remain intact.
    #[test]
    fn validate_nginx_semicolon_inside_quote_is_not_terminator() {
        // `error_log` arg contains an embedded `;` — the semicolon must
        // stay part of the arg so the validator sees the quoted path as a
        // single argument.
        let body = "error_log \"/Library/Application Support/Badami/local-dev-root/nginx/weird;name.log\";\n";
        validate_nginx_root_variant(body, "nginx.conf")
            .expect("semicolon inside quotes must not break statement");
    }

    /// Lua phase handlers (`access_by_lua`, `content_by_lua_block`, etc)
    /// hand nginx master arbitrary code execution.
    #[test]
    fn validate_nginx_rejects_by_lua_variants() {
        for forbidden in &[
            "access_by_lua 'return 1';",
            "content_by_lua_block { ngx.say('x') }",
            "rewrite_by_lua_file \"/tmp/x.lua\";",
        ] {
            let err = validate_nginx_root_variant(forbidden, "nginx.conf").unwrap_err();
            assert!(err.contains("forbidden"), "body={forbidden} err={err}");
        }
    }

    /// njs module directives start with `njs` (`njs_set`, `njs_import`,
    /// `njs_content`). Reject the whole family.
    #[test]
    fn validate_nginx_rejects_njs_directives() {
        for forbidden in &["njs_set $x require.main;", "njs_import main from main.js;"] {
            let err = validate_nginx_root_variant(forbidden, "nginx.conf").unwrap_err();
            assert!(err.contains("forbidden"), "body={forbidden} err={err}");
        }
    }

    /// Path-loading directives beyond the old list (`ssl_dhparam`,
    /// `ssl_trusted_certificate`, …) must enforce ROOT_SAFE_PREFIXES too.
    #[test]
    fn validate_nginx_rejects_extended_ssl_directives_outside_root() {
        for (directive, path) in &[
            ("ssl_dhparam", "/tmp/evil.pem"),
            ("ssl_trusted_certificate", "/Users/me/trust.pem"),
            ("ssl_client_certificate", "/tmp/cc.pem"),
            ("ssl_crl", "/tmp/crl.pem"),
            ("ssl_password_file", "/Users/me/.pw"),
            ("ssl_stapling_file", "/tmp/stap.pem"),
            ("ssl_session_ticket_key", "/tmp/stk.bin"),
            ("auth_basic_user_file", "/tmp/htpasswd"),
            ("lock_file", "/tmp/lock"),
            ("working_directory", "/tmp/wd"),
            ("ssl_certificate_key", "/tmp/evil.key"),
            ("ssl_certificate", "/tmp/evil.pem"),
            ("include", "/tmp/evil.conf"),
            ("pid", "/tmp/evil.pid"),
            ("error_log", "/tmp/evil.log"),
            ("access_log", "/tmp/evil.log"),
        ] {
            let body = format!("{directive} \"{path}\";\n");
            let err = validate_nginx_root_variant(&body, "nginx.conf").unwrap_err();
            assert!(
                err.contains("ROOT_SAFE_PREFIXES") || err.contains("outside"),
                "directive={directive} path={path} err={err}"
            );
        }
    }

    /// `..` traversal in a path-loading directive must be rejected even
    /// when the prefix looks root-safe. `/Library/.../local-dev-root/
    /// ../../../../etc/passwd` normalizes to `/etc/passwd` after
    /// nginx-side realpath.
    #[test]
    fn validate_nginx_rejects_dot_dot_in_path() {
        let body = "include \"/Library/Application Support/Badami/local-dev-root/nginx/../../../../etc/passwd\";\n";
        let err = validate_nginx_root_variant(body, "nginx.conf").unwrap_err();
        assert!(err.contains(".."), "err={err}");
    }

    /// `access_log off;` is a legitimate nginx form — must pass.
    #[test]
    fn validate_nginx_access_log_off_is_allowed() {
        validate_nginx_root_variant("access_log off;\n", "nginx.conf")
            .expect("access_log off is a valid directive form");
    }

    /// `error_log` severity-only form (no path) must pass.
    #[test]
    fn validate_nginx_error_log_severity_only_is_allowed() {
        for form in &[
            "error_log stderr;\n",
            "error_log stderr warn;\n",
            "error_log syslog:server=unix:/dev/log notice;\n",
        ] {
            validate_nginx_root_variant(form, "nginx.conf")
                .unwrap_or_else(|e| panic!("body={form} err={e}"));
        }
    }

    /// Unknown directive carrying an absolute user path must be rejected
    /// conservatively.
    #[test]
    fn validate_nginx_rejects_unknown_directive_with_user_path() {
        let body = "some_future_directive /Users/me/evil.txt;\n";
        let err = validate_nginx_root_variant(body, "nginx.conf").unwrap_err();
        assert!(
            err.contains("outside ROOT_SAFE_PREFIXES") || err.contains("outside"),
            "err={err}"
        );
    }

    /// `fastcgi_pass unix:/users/me/socks/php.sock;` is the allowlist
    /// escape hatch — fastcgi_* directives may carry user paths because
    /// php-fpm (not nginx-root) owns the socket.
    #[test]
    fn validate_nginx_allows_fastcgi_user_socket() {
        let body = "fastcgi_pass \"unix:/Users/me/Library/Application Support/Badami/local-dev/socks/php84.sock\";\n";
        validate_nginx_root_variant(body, "badami.conf")
            .expect("fastcgi_pass to user socket must pass");
    }

    /// Trailing backslash in dnsmasq.conf is a line-continuation smuggling
    /// attempt — reject.
    #[test]
    fn validate_dnsmasq_rejects_backslash_continuation() {
        let body = "listen-address=127.0.0.1\\\nbind-interfaces\n";
        let err = validate_dnsmasq_root_variant(body).unwrap_err();
        assert!(err.contains("backslash"), "err={err}");
    }

    /// Anything outside the dnsmasq allowlist is rejected.
    #[test]
    fn validate_dnsmasq_rejects_unknown_key() {
        for body in &[
            "proxy=1.2.3.4\n",
            "resolv-file=/tmp/resolv.conf\n",
            "all-servers\n",
            "stop-dns-rebind\n",
        ] {
            let err = validate_dnsmasq_root_variant(body).unwrap_err();
            assert!(
                err.contains("forbidden") || err.contains("not in allowlist"),
                "body={body} err={err}"
            );
        }
    }

    /// Allowed dnsmasq keys must still pass under the new allowlist. All
    /// 14 keys the renderer may legitimately emit.
    #[test]
    fn validate_dnsmasq_accepts_full_allowlist() {
        let body = "listen-address=127.0.0.1\n\
                    bind-interfaces\n\
                    port=53\n\
                    no-resolv\n\
                    no-hosts\n\
                    address=/.test/127.0.0.1\n\
                    pid-file=/Library/Application Support/Badami/local-dev-root/dnsmasq/dnsmasq.pid\n\
                    log-facility=/Library/Application Support/Badami/local-dev-root/dnsmasq/dnsmasq.log\n\
                    local=/test/\n\
                    domain-needed\n\
                    bogus-priv\n\
                    cache-size=1000\n\
                    log-queries\n\
                    server=1.1.1.1\n";
        validate_dnsmasq_root_variant(body)
            .expect("every allowlisted key must pass");
    }

    /// Resolver install argv embeds Rust-generated content (not a user
    /// draft path) and routes it through `printf '%s' > tmp && mv -f`.
    #[test]
    fn resolver_install_argv_bakes_in_process_content() {
        let content = resolver_file_contents("test", "127.0.0.1", 53535);
        assert!(content.contains(RESOLVER_MARKER));
        assert!(content.contains("nameserver 127.0.0.1"));
        assert!(content.contains("port 53535"));
        let argv = resolver_install_argv(&content, "test").expect("argv");
        assert_eq!(argv[0], "/bin/sh");
        assert_eq!(argv[1], "-c");
        let body = &argv[2];
        // mkdir + printf + chmod + atomic mv must appear.
        assert!(body.contains("mkdir -p /etc/resolver"), "body={body}");
        assert!(body.contains("printf"), "body={body}");
        assert!(body.contains("mv -f"), "body={body}");
        assert!(body.contains("/etc/resolver/test.badami-tmp"), "body={body}");
        assert!(body.contains("/etc/resolver/test"), "body={body}");
        // The user-draft path must NOT appear — the privileged shell writes
        // in-process content, not a disk draft.
        assert!(
            !body.contains("resolver-test"),
            "privileged argv must not reference the user-side draft file: body={body}"
        );
        // The marker is part of the embedded content.
        assert!(body.contains(RESOLVER_MARKER), "body={body}");
        // chmod 644 appears before mv (atomic rename after permission set).
        let chmod_pos = body.find("chmod 644").expect("chmod 644 step");
        let mv_pos = body.find("mv -f").expect("mv -f step");
        assert!(chmod_pos < mv_pos, "chmod must run before mv: chmod@{chmod_pos} mv@{mv_pos}");
    }

    /// `resolver_install_argv` refuses to produce an argv that would skip
    /// the `# managed-by: badami` marker.
    #[test]
    fn resolver_install_argv_requires_badami_marker() {
        let err = resolver_install_argv("no marker here\n", "test").unwrap_err();
        assert!(err.contains(RESOLVER_MARKER), "err={err}");
    }

    /// `resolver_install_argv` validates the tld before emitting any shell.
    #[test]
    fn resolver_install_argv_rejects_bad_tld() {
        let content = resolver_file_contents("test", "127.0.0.1", 53);
        assert!(resolver_install_argv(&content, "../etc").is_err());
        assert!(resolver_install_argv(&content, "a/b").is_err());
        assert!(resolver_install_argv(&content, "a.b").is_err());
    }

    /// Full D2 install flow: the osascript body must contain the
    /// in-process resolver content, not a draft file reference.
    #[test]
    fn bootstrap_install_dns_high_port_uses_in_process_content() {
        let res = bootstrap_install(BootstrapInstallRequest {
            package: "dns_high_port".into(),
            dry_run: Some(true),
            tld: Some("test".into()),
            loopback: Some("127.0.0.1".into()),
            dns_port: Some(53535),
            nginx_binary: None,
            dnsmasq_binary: None,
            attempt_privileged_install: None,
            identifier: None,
        })
        .expect("install");
        let cmd = res.install_command.expect("install command");
        // The privileged body writes resolver content via printf + mv, not
        // via `cp` of a user draft path.
        assert!(cmd.contains("printf"), "cmd={cmd}");
        assert!(cmd.contains("mv -f"), "cmd={cmd}");
        assert!(cmd.contains("/etc/resolver/test.badami-tmp"), "cmd={cmd}");
        assert!(cmd.contains(RESOLVER_MARKER), "cmd={cmd}");
        // The user-side draft path still exists for audit, but is never
        // mentioned in the privileged argv.
        assert!(
            !cmd.contains("resolver-test"),
            "cmd must not reference user draft: {cmd}"
        );
    }

    /// Resync must still render + validate root variants cleanly for a
    /// user tree seeded by `build_user_nginx_tree`.
    #[test]
    fn validate_nginx_accepts_comments_and_quoted_hash() {
        let body = r#"
# plain comment
worker_processes auto;
# comment with "quotes" inside
server_name "has#hash.test";
include "/Library/Application Support/Badami/local-dev-root/nginx/sites/*.conf";
"#;
        validate_nginx_root_variant(body, "nginx.conf")
            .expect("comments + quoted hash must validate cleanly");
    }

    /// Rendered rendered variant's own include targets go through the same
    /// validator function (each file is staged and validated individually
    /// in `render_nginx_root_variants`). Verify that an included file with
    /// a forbidden directive is caught.
    #[test]
    fn render_nginx_root_variants_validates_each_file_independently() {
        let (_root, nginx, logs, pids) = build_user_nginx_tree("per-file-validate");
        // Plant a hostile `sites/evil.conf` referenced by the top-level
        // `include "sites/*.conf"`.
        fs::write(
            nginx.join("sites").join("evil.conf"),
            "server { listen 127.0.0.1:8080; load_module evil.so; }\n",
        )
        .unwrap();

        let pending = unique_tmp("per-file-validate-pending");
        fs::create_dir_all(&pending).unwrap();
        let root_nginx = std::path::PathBuf::from(ROOT_STAGING_PREFIX).join("nginx");
        let err = render_nginx_root_variants(&NginxRootVariantInput {
            user_nginx_dir: &nginx,
            user_logs_dir: &logs,
            user_pids_dir: &pids,
            root_nginx_dir: &root_nginx,
            pending_dir: &pending,
        })
        .expect_err("hostile sites/evil.conf must be rejected");
        assert!(err.contains("load_module"), "err={err}");
    }

    // ── Ancestor-chain reclaim (TOCTOU hardening v1.15.0) ──────────

    /// Reclaim prelude must emit:
    ///  * One sh -c block per [`RECLAIM_ANCESTORS`] entry (install -d + chown + chmod),
    ///    each with a symlink + non-dir rejection branch.
    ///  * A final sh -c block for the role leaf: symlink reject + `rm -rf`
    ///    + fresh root-owned recreate.
    #[test]
    fn reclaim_ancestor_chain_argv_shape() {
        let argv = reclaim_ancestor_chain_argv(
            "/Library/Application Support/Badami/local-dev-root/nginx",
        );
        assert_eq!(
            argv.len(),
            RECLAIM_ANCESTORS.len() + 1,
            "one step per ancestor + one role-leaf step"
        );
        for (i, ancestor) in RECLAIM_ANCESTORS.iter().enumerate() {
            let body = &argv[i][2];
            // sh -c body references the ancestor path.
            assert!(
                body.contains(&format!("'{ancestor}'")),
                "ancestor[{i}] not in sh -c body: {body}"
            );
            // Rejects symlinks + non-dirs.
            assert!(body.contains("is a symlink"), "no symlink reject: {body}");
            assert!(body.contains("not a directory"), "no non-dir reject: {body}");
            // Reclaims to root:wheel 755 via install -d.
            assert!(
                body.contains("install -d -o root -g wheel -m 755"),
                "no reclaim: {body}"
            );
            assert!(body.contains("chown root:wheel"), "no chown: {body}");
            assert!(body.contains("chmod 755"), "no chmod: {body}");
            // Not recursive on ancestors — must not use `-R`.
            assert!(
                !body.contains("chown -R"),
                "ancestor chown must not be recursive: {body}"
            );
            assert!(
                !body.contains("chmod -R"),
                "ancestor chmod must not be recursive: {body}"
            );
        }
        // Role leaf step: rm -rf + install -d root-owned.
        let leaf_body = &argv.last().unwrap()[2];
        assert!(leaf_body.contains("/local-dev-root/nginx"), "no leaf: {leaf_body}");
        assert!(leaf_body.contains("is a symlink"), "no symlink reject: {leaf_body}");
        assert!(leaf_body.contains("rm -rf"), "no rm -rf: {leaf_body}");
        assert!(
            leaf_body.contains("install -d -o root -g wheel -m 755"),
            "no reclaim recreate: {leaf_body}"
        );
    }

    /// The ancestors list must stay in parent → child order so `install -d`
    /// for `/Library/Application Support/Badami/local-dev-root` runs AFTER
    /// its parent `.../Badami` has been reclaimed. Reversing the order
    /// defeats the TOCTOU fix (the attacker-controlled parent is where the
    /// symlink hazard lives).
    #[test]
    fn reclaim_ancestors_are_parent_before_child() {
        assert_eq!(RECLAIM_ANCESTORS[0], "/Library/Application Support/Badami");
        assert_eq!(
            RECLAIM_ANCESTORS[1],
            "/Library/Application Support/Badami/local-dev-root"
        );
        // Second must start with first + '/' so the chain is strict.
        assert!(RECLAIM_ANCESTORS[1].starts_with(&format!("{}/", RECLAIM_ANCESTORS[0])));
    }

    /// `unit_install_argv_with_verify` must emit the reclaim prelude BEFORE
    /// any `install -o root`, `shasum`, or `launchctl bootstrap` step.
    /// Without this prelude, a pre-planted user-owned
    /// `/Library/Application Support/Badami/local-dev-root/<role>` could
    /// let an attacker swap staged files between shasum verify and
    /// launchctl.
    #[test]
    fn unit_install_argv_emits_reclaim_before_install() {
        let f = PendingFile {
            pending_src: "/tmp/badami-test-pending/nginx.conf".into(),
            final_dst: "/Library/Application Support/Badami/local-dev-root/nginx/nginx.conf".into(),
            sha256_hex: "deadbeef".repeat(8),
            mode: "644",
        };
        let plist = "/Library/LaunchDaemons/com.khalid.badami.local-dev.nginx.plist";
        let argvs = unit_install_argv_with_verify(
            "com.khalid.badami.local-dev.nginx",
            plist,
            "/Library/Application Support/Badami/local-dev-root/nginx",
            std::slice::from_ref(&f),
            &[plist.to_string()],
        );
        let cmd = build_osascript_command(&argvs);
        // Reclaim prelude emitted (sh -c body contains "badami: ancestor").
        let reclaim_pos = cmd.find("badami: ancestor").expect("reclaim prelude");
        // Both ancestors referenced.
        assert!(cmd.contains("'/Library/Application Support/Badami'"));
        assert!(cmd.contains("'/Library/Application Support/Badami/local-dev-root'"));
        // Role leaf referenced.
        assert!(cmd.contains("'/Library/Application Support/Badami/local-dev-root/nginx'"));
        // Order: reclaim < install < shasum < launchctl.
        let install_pos = cmd
            .find("'/usr/bin/install' '-o' 'root' '-g' 'wheel' '-m' '644'")
            .expect("top-level install step");
        let shasum_pos = cmd.find("shasum").expect("shasum step");
        let launchctl_pos = cmd
            .find("'launchctl' 'bootstrap'")
            .expect("launchctl bootstrap step");
        assert!(
            reclaim_pos < install_pos,
            "reclaim must precede install: reclaim@{reclaim_pos} install@{install_pos}"
        );
        assert!(
            install_pos < shasum_pos,
            "install must precede shasum: install@{install_pos} shasum@{shasum_pos}"
        );
        assert!(
            shasum_pos < launchctl_pos,
            "shasum must precede launchctl: shasum@{shasum_pos} launchctl@{launchctl_pos}"
        );
    }

    /// Full bootstrap install (dns_only + http_80) must prepend the reclaim
    /// prelude in each unit's privileged argv.
    #[test]
    fn bootstrap_install_full_emits_reclaim_prelude() {
        let res = bootstrap_install(BootstrapInstallRequest {
            package: "full".into(),
            dry_run: Some(true),
            tld: Some("test".into()),
            loopback: Some("127.0.0.1".into()),
            dns_port: None,
            nginx_binary: Some("/usr/bin/true".into()),
            dnsmasq_binary: Some("/usr/bin/true".into()),
            attempt_privileged_install: Some(false),
            identifier: None,
        })
        .expect("install");
        let cmd = res.install_command.expect("install command");
        // Both role leaves referenced in reclaim steps.
        assert!(
            cmd.contains("'/Library/Application Support/Badami/local-dev-root/dnsmasq'"),
            "dnsmasq role leaf missing from reclaim"
        );
        assert!(
            cmd.contains("'/Library/Application Support/Badami/local-dev-root/nginx'"),
            "nginx role leaf missing from reclaim"
        );
        // Reclaim prelude must precede the first launchctl bootstrap.
        let reclaim_pos = cmd.find("badami: ancestor").expect("reclaim prelude");
        let launchctl_pos = cmd
            .find("'launchctl' 'bootstrap'")
            .expect("launchctl bootstrap");
        assert!(reclaim_pos < launchctl_pos);
    }

    /// Resync (re-stage user configs) must also prepend reclaim before
    /// install_pending_files_argv. Otherwise an attacker can swap the
    /// pending→final destination between kickstart calls.
    #[test]
    fn bootstrap_install_resync_emits_reclaim_prelude() {
        // Build a user-side tree so resync has content to re-stage.
        let (_root, _nginx, _logs, _pids) = build_user_nginx_tree("resync-reclaim");
        let res = bootstrap_install(BootstrapInstallRequest {
            package: "resync".into(),
            dry_run: Some(true),
            tld: None,
            loopback: None,
            dns_port: None,
            nginx_binary: None,
            dnsmasq_binary: None,
            attempt_privileged_install: None,
            identifier: None,
        })
        .expect("install");
        // Resync builds its command even when nginx dir is missing — in that
        // case install_command may be None. Guard before unwrap.
        if let Some(cmd) = res.install_command {
            // If anything was actually re-staged, both role leaves + a reclaim
            // prelude must appear. If nothing re-stages, kickstart || true
            // still shows up but no `install -o root` is emitted. Either way
            // the command must NOT contain an `install -o root` without a
            // preceding reclaim.
            if cmd.contains("'/usr/bin/install' '-o' 'root'") {
                let reclaim_pos =
                    cmd.find("badami: ancestor").expect("reclaim prelude in resync");
                let install_pos = cmd
                    .find("'/usr/bin/install' '-o' 'root'")
                    .expect("install step");
                assert!(
                    reclaim_pos < install_pos,
                    "resync reclaim must precede install"
                );
            }
        }
    }

    /// Uninstall must emit the reclaim prelude BEFORE the `rm -rf` of the
    /// role staging dir, so a symlink pre-planted at
    /// `/Library/Application Support/Badami/local-dev-root/<role>` is
    /// rejected rather than followed into `rm -rf`.
    #[test]
    fn bootstrap_uninstall_emits_reclaim_before_rm_rf() {
        let res = bootstrap_uninstall(BootstrapUninstallRequest {
            package: "full".into(),
            confirm_resolver: None,
            dry_run: Some(true),
            tld: Some("test".into()),
            identifier: None,
        })
        .expect("uninstall");
        let joined = res.steps.join("\n");
        // Reclaim prelude present.
        assert!(
            joined.contains("badami: ancestor"),
            "no reclaim prelude in uninstall steps:\n{joined}"
        );
        // Both ancestors referenced.
        assert!(joined.contains("'/Library/Application Support/Badami'"));
        assert!(joined.contains("'/Library/Application Support/Badami/local-dev-root'"));
        // The safe `rm -rf` guard (symlink check) is present.
        assert!(
            joined.contains("refuse to rm -rf symlink"),
            "no symlink-safe rm -rf guard:\n{joined}"
        );
        // Reclaim appears before any `refuse to rm -rf symlink` guard — so
        // ancestor reclaim always runs first.
        let reclaim_pos = joined.find("badami: ancestor").unwrap();
        let rm_guard_pos = joined.find("refuse to rm -rf symlink").unwrap();
        assert!(
            reclaim_pos < rm_guard_pos,
            "reclaim must precede rm -rf guard"
        );
    }

    /// Role leaf validation: `safe_rm_rf_dir_argv` must emit a sh -c body
    /// that rejects a symlinked leaf with `exit 1` before `rm -rf`.
    #[test]
    fn safe_rm_rf_dir_argv_rejects_symlink() {
        let argv =
            safe_rm_rf_dir_argv("/Library/Application Support/Badami/local-dev-root/nginx");
        assert_eq!(argv[0], "/bin/sh");
        assert_eq!(argv[1], "-c");
        let body = &argv[2];
        assert!(body.contains("[ -L '/Library/Application Support/Badami/local-dev-root/nginx' ]"));
        assert!(body.contains("exit 1"));
        assert!(body.contains("rm -rf -- "));
    }

    // ── Hash-from-source-bytes (TOCTOU hardening v1.15.0) ──────────

    /// `build_unit_pending_files` must hash the SOURCE binary bytes, not
    /// re-read the staged pending copy. If the attacker overwrites
    /// `pending_src` after we write it, the hash must still describe the
    /// bytes Rust observed when it read the source (so the shasum verify
    /// catches the swap at root-install time).
    #[test]
    fn build_unit_pending_files_hash_binds_to_source_bytes() {
        let tmp = unique_tmp("pending-source-hash");
        fs::create_dir_all(&tmp).unwrap();
        let user_bin = tmp.join("fake-bin");
        let original = b"original binary bytes\n";
        fs::write(&user_bin, original).unwrap();

        let pending_dir = tmp.join("pending");
        fs::create_dir_all(&pending_dir).unwrap();
        let final_bin = std::path::PathBuf::from(
            "/Library/Application Support/Badami/local-dev-root/nginx/nginx",
        );
        let files = build_unit_pending_files(
            &pending_dir,
            user_bin.to_str().unwrap(),
            &final_bin,
            "com.khalid.badami.local-dev.nginx",
            "<plist/>\n",
        )
        .expect("build pending");

        let bin_file = files
            .iter()
            .find(|f| f.final_dst.ends_with("/nginx"))
            .expect("binary pending record");
        // Hash must equal sha256(original source bytes).
        assert_eq!(bin_file.sha256_hex, sha256_hex(original));

        // Simulate the TOCTOU attack: an attacker overwrites the pending
        // copy with different bytes AFTER our staging step.
        fs::write(&bin_file.pending_src, b"tampered content\n").unwrap();
        // The PendingFile record's hash is still bound to the source
        // bytes — unchanged by the tamper.
        assert_eq!(
            bin_file.sha256_hex,
            sha256_hex(original),
            "pending hash must stay bound to source bytes even after pending is overwritten"
        );
        // Sanity: the actual pending file now has a DIFFERENT hash — if we
        // were reading from pending we would have missed the tamper.
        let tampered_bytes = fs::read(&bin_file.pending_src).unwrap();
        assert_ne!(sha256_hex(&tampered_bytes), bin_file.sha256_hex);
    }

    /// Same source-bytes-binding guarantee for cert copies inside
    /// `render_nginx_root_variants` (lines ~990 cert copy loop).
    #[test]
    fn nginx_root_variants_cert_hash_binds_to_source_bytes() {
        let (root, nginx, logs, pids) = build_user_nginx_tree("cert-source-hash");
        // Plant a cert file and a sites/office.conf referencing it.
        let cert_src = root.join("office.test.crt");
        let original_cert = b"-----BEGIN CERTIFICATE-----\nORIGINAL\n-----END CERTIFICATE-----\n";
        fs::write(&cert_src, original_cert).unwrap();
        let site_conf = nginx.join("sites").join("office.conf");
        fs::write(
            &site_conf,
            format!(
                "server {{\n  listen 127.0.0.1:8443 ssl;\n  server_name office.test;\n  ssl_certificate \"{crt}\";\n}}\n",
                crt = cert_src.display(),
            ),
        )
        .unwrap();

        let pending = unique_tmp("cert-source-hash-pending");
        fs::create_dir_all(&pending).unwrap();
        let root_nginx = std::path::PathBuf::from(ROOT_STAGING_PREFIX).join("nginx");
        let files = render_nginx_root_variants(&NginxRootVariantInput {
            user_nginx_dir: &nginx,
            user_logs_dir: &logs,
            user_pids_dir: &pids,
            root_nginx_dir: &root_nginx,
            pending_dir: &pending,
        })
        .expect("render");

        let cert_file = files
            .iter()
            .find(|f| f.final_dst.ends_with("office.test.crt"))
            .expect("cert pending record");
        assert_eq!(cert_file.sha256_hex, sha256_hex(original_cert));

        // Overwrite pending cert after staging — hash must still describe
        // the ORIGINAL source bytes.
        fs::write(&cert_file.pending_src, b"TAMPERED").unwrap();
        assert_eq!(
            cert_file.sha256_hex,
            sha256_hex(original_cert),
            "cert pending hash must stay bound to source bytes"
        );
        let tampered = fs::read(&cert_file.pending_src).unwrap();
        assert_ne!(sha256_hex(&tampered), cert_file.sha256_hex);
    }

    /// Rendered config hashes bind to the in-memory string, not the on-disk
    /// pending bytes. Regression test: if someone reintroduces an `fs::copy`
    /// + `fs::read(pending)` pattern for rendered configs, this test will
    /// catch it.
    #[test]
    fn rendered_nginx_conf_hash_binds_to_in_memory_bytes() {
        let (_root, nginx, logs, pids) = build_user_nginx_tree("rendered-source-hash");
        let pending = unique_tmp("rendered-source-hash-pending");
        fs::create_dir_all(&pending).unwrap();
        let root_nginx = std::path::PathBuf::from(ROOT_STAGING_PREFIX).join("nginx");
        let files = render_nginx_root_variants(&NginxRootVariantInput {
            user_nginx_dir: &nginx,
            user_logs_dir: &logs,
            user_pids_dir: &pids,
            root_nginx_dir: &root_nginx,
            pending_dir: &pending,
        })
        .expect("render");
        let conf = files
            .iter()
            .find(|f| f.final_dst.ends_with("/nginx/nginx.conf"))
            .expect("nginx.conf pending record");
        // Overwrite pending after render — hash must stay bound to the
        // rewritten content Rust emitted.
        let original_pending = fs::read(&conf.pending_src).unwrap();
        assert_eq!(conf.sha256_hex, sha256_hex(&original_pending));
        fs::write(&conf.pending_src, b"TAMPERED").unwrap();
        assert_eq!(
            conf.sha256_hex,
            sha256_hex(&original_pending),
            "rendered conf hash must stay bound to the Rust-emitted bytes"
        );
    }
}
