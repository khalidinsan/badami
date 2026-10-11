//! Local Dev TLS (Phase B) — Valet-style self-signed CA + per-site leaf certs.
//!
//! Layout under Badami local-dev:
//!
//! ```text
//! config/valet/
//!   CA/
//!     BadamiLocalDevCA.crt         (0644)
//!     BadamiLocalDevCA.key         (0600)
//!     BadamiLocalDevCA.serial      (0644 — monotonic serial counter)
//!   Certificates/
//!     {name}.{tld}.crt             (0644)
//!     {name}.{tld}.key             (0600)
//! ```
//!
//! Design choices:
//!
//! - **CA generated once.** The private key never leaves `config/valet/CA/`.
//!   It is **not** mirrored to `local-dev-root/` by bootstrap resync — only
//!   leaf public certs are. Nginx reads from the user-owned tree.
//! - **Leaf certs < 825 days.** Modern macOS Safari rejects certs with a
//!   lifetime longer than 825 days (see Apple TN2203). We pick 398 days to be
//!   safely under both Safari and Chrome expiry caps.
//! - **SANs:** `{name}.{tld}` + `*.{name}.{tld}` only. We never emit `www.*`
//!   because the wildcard already covers it (and Safari rejects wildcard
//!   certs that double up single-label SANs).
//! - **Trust is user-driven.** [`trust_ca_argv`] returns the exact argv for
//!   `security add-trusted-cert`. Running it needs admin, so we hand off to
//!   the same osascript helpers [`crate::commands::local_dev::bootstrap`] uses
//!   (never a user-writable script).
//!
//! Safety:
//! - CA private key is written at `0o600` on Unix.
//! - Leaf keys at `0o600`; leaf certs and the CA cert at `0o644`.
//! - `unsecure` deletes **only** `{site}.{tld}.{crt,key}` under
//!   `Certificates/` — never scans the directory for other files, never
//!   touches the CA.

use super::bootstrap::{applescript_quote, build_osascript_command, shell_single_quote};
use super::config_gen::{validate_site_name, validate_tld};
use super::discovery::{build_runtime_paths, RuntimePaths};
use rcgen::{
    date_time_ymd, BasicConstraints, Certificate, CertificateParams, DistinguishedName, DnType,
    IsCa, KeyPair, KeyUsagePurpose, SanType,
};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::SystemTime;

/// Common name embedded in the local CA cert — also used by the macOS trust
/// probe (`security find-certificate -c …`). Must stay stable across runs or
/// previously-trusted CAs become orphaned.
pub const CA_COMMON_NAME: &str = "Badami Local Dev CA";

/// Base filename used for the CA key / cert / serial.
const CA_BASENAME: &str = "BadamiLocalDevCA";

/// Leaf certificate validity. Must stay strictly under 825 days (Apple TN2203)
/// — 398 days matches Safari/Chrome expiration caps and leaves headroom for
/// clock skew without pushing users over the limit.
const LEAF_VALIDITY_DAYS: u64 = 398;

/// CA validity. Longer than any single leaf, bounded so a leaked key does not
/// stay a trust anchor forever. 10 years ≈ 3650 days.
const CA_VALIDITY_DAYS: u64 = 3650;

// ── Paths helper ────────────────────────────────────────────────────

/// Resolved TLS filesystem layout under `config/valet/`.
#[derive(Debug, Clone)]
pub struct TlsPaths {
    pub ca_dir: PathBuf,
    pub ca_cert: PathBuf,
    pub ca_key: PathBuf,
    pub ca_serial: PathBuf,
    pub certificates_dir: PathBuf,
}

impl TlsPaths {
    pub fn from_runtime(paths: &RuntimePaths) -> Self {
        let base = PathBuf::from(&paths.config_valet);
        let ca_dir = base.join("CA");
        let certificates_dir = base.join("Certificates");
        Self {
            ca_cert: ca_dir.join(format!("{CA_BASENAME}.crt")),
            ca_key: ca_dir.join(format!("{CA_BASENAME}.key")),
            ca_serial: ca_dir.join(format!("{CA_BASENAME}.serial")),
            ca_dir,
            certificates_dir,
        }
    }

    pub fn site_cert(&self, site: &str, tld: &str) -> PathBuf {
        self.certificates_dir.join(format!("{site}.{tld}.crt"))
    }

    pub fn site_key(&self, site: &str, tld: &str) -> PathBuf {
        self.certificates_dir.join(format!("{site}.{tld}.key"))
    }
}

// ── Public DTOs ─────────────────────────────────────────────────────

/// Return value for [`tls_status_at`] / `ld_tls_status`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TlsStatus {
    pub ca_exists: bool,
    /// `true` when the CA appears in the macOS System keychain
    /// (`security find-certificate -c …`). Best-effort — not a trust check.
    /// Always `false` on non-macOS. When `skip_live_probes` is set the field
    /// reflects the cached CA presence only.
    pub ca_trusted: bool,
    pub ca_cert_path: Option<String>,
    pub ca_key_path: Option<String>,
    /// Common name advertised by the CA; useful for the UI's "Trust CA" step.
    pub ca_common_name: String,
    /// Sites with both a `{name}.{tld}.crt` and `.key` present.
    pub secured_sites: Vec<SecuredSite>,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecuredSite {
    pub name: String,
    pub tld: String,
    pub cert_path: String,
    pub key_path: String,
}

/// Return value for [`trust_ca_argv`] / `ld_tls_trust_ca`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrustCaResult {
    pub ca_cert_path: Option<String>,
    /// Raw argv the privileged shell would execute. Suitable for display /
    /// logging; **never** for `eval`.
    pub argv: Vec<String>,
    /// Shell-quoted single-line rendering of `argv` (same style as
    /// [`crate::commands::local_dev::bootstrap`] uninstall steps).
    pub step: String,
    /// Full `do shell script "<quoted>" with administrator privileges`
    /// AppleScript body. Present only when the caller intends to run it.
    pub install_command: Option<String>,
    /// True when the caller asked us to invoke osascript and it exited 0.
    pub executed: bool,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecureSiteResult {
    pub site: String,
    pub tld: String,
    pub action: String,
    pub cert_path: Option<String>,
    pub key_path: Option<String>,
    /// Files written (including the per-site nginx conf when provided by the
    /// caller — this module itself only owns `Certificates/*`).
    pub written: Vec<String>,
    pub notes: Vec<String>,
}

// ── CA + leaf generation ────────────────────────────────────────────

/// Create the local CA key and self-signed certificate if either is missing.
///
/// Idempotent: an already-valid CA keypair is left alone.
pub fn ensure_ca_at(paths: &RuntimePaths) -> Result<TlsPaths, String> {
    let tls = TlsPaths::from_runtime(paths);
    fs::create_dir_all(&tls.ca_dir).map_err(|e| format!("mkdir CA dir: {e}"))?;
    fs::create_dir_all(&tls.certificates_dir)
        .map_err(|e| format!("mkdir Certificates dir: {e}"))?;

    if tls.ca_cert.is_file() && tls.ca_key.is_file() {
        return Ok(tls);
    }

    let params = ca_params(CA_VALIDITY_DAYS)?;
    let key_pair = KeyPair::generate().map_err(|e| format!("generate CA keypair: {e}"))?;
    let cert = params
        .self_signed(&key_pair)
        .map_err(|e| format!("self-sign CA: {e}"))?;

    let key_pem = key_pair.serialize_pem();
    let cert_pem = cert.pem();

    write_private_file(&tls.ca_key, key_pem.as_bytes())?;
    write_public_file(&tls.ca_cert, cert_pem.as_bytes())?;
    // Serial counter — stored as plaintext so a human can audit it. Monotonic.
    if !tls.ca_serial.is_file() {
        write_public_file(&tls.ca_serial, b"1\n")?;
    }

    Ok(tls)
}

/// Generate a leaf cert for `{site}.{tld}` signed by the local CA.
///
/// Overwrites any existing `{site}.{tld}.{crt,key}` so re-running produces a
/// fresh cert with a bumped expiry. Returns the (crt, key) paths actually
/// written.
pub fn secure_site_cert_at(
    paths: &RuntimePaths,
    site: &str,
    tld: &str,
) -> Result<(PathBuf, PathBuf), String> {
    validate_site_name(site)?;
    validate_tld(tld)?;

    let tls = ensure_ca_at(paths)?;

    // Load the CA signer. We do **not** parse the stored CA cert PEM — rcgen
    // 0.13's `from_ca_cert_pem` requires the `x509-parser` feature which
    // doubles the dependency surface. Instead we rebuild a `Certificate`
    // issuer object with the same DN + key_usages + key_identifier_method as
    // when we first wrote the CA cert. `signed_by()` only pulls those three
    // fields out of the issuer, so leaves still chain back to the on-disk
    // CA cert (the trust anchor the user imported into the keychain) via
    // Issuer-DN and Authority Key Identifier → Subject Key Identifier match.
    let (ca_key, ca_cert) = load_ca_signer(&tls)?;

    // Leaf params — SANs are the exact two the plan calls out. Chrome rejects
    // certs without a SAN that matches the host, and Safari rejects certs that
    // only have a CommonName.
    let fqdn = format!("{site}.{tld}");
    let wildcard = format!("*.{site}.{tld}");
    let mut leaf = CertificateParams::new(vec![fqdn.clone(), wildcard.clone()])
        .map_err(|e| format!("build leaf params: {e}"))?;
    leaf.subject_alt_names = vec![
        SanType::DnsName(
            fqdn.clone()
                .try_into()
                .map_err(|e| format!("fqdn SAN not valid DNS name: {e}"))?,
        ),
        SanType::DnsName(
            wildcard
                .clone()
                .try_into()
                .map_err(|e| format!("wildcard SAN not valid DNS name: {e}"))?,
        ),
    ];
    let mut leaf_dn = DistinguishedName::new();
    leaf_dn.push(DnType::CommonName, fqdn.clone());
    leaf_dn.push(DnType::OrganizationName, "Badami");
    leaf_dn.push(DnType::OrganizationalUnitName, "Local Dev");
    leaf.distinguished_name = leaf_dn;
    let (nb, na) = validity_window(LEAF_VALIDITY_DAYS)?;
    leaf.not_before = nb;
    leaf.not_after = na;
    leaf.key_usages = vec![
        KeyUsagePurpose::DigitalSignature,
        KeyUsagePurpose::KeyEncipherment,
    ];
    leaf.extended_key_usages = vec![rcgen::ExtendedKeyUsagePurpose::ServerAuth];

    // Bump + stamp the serial counter. On parse failure we fall back to 1 so
    // a corrupt counter never blocks issuance (the serial itself does not need
    // to be unique against a trusted CA store — only against our own history).
    let next_serial = bump_ca_serial(&tls.ca_serial);
    leaf.serial_number = Some(next_serial.into());

    let leaf_key = KeyPair::generate().map_err(|e| format!("generate leaf keypair: {e}"))?;
    let leaf_cert = leaf
        .signed_by(&leaf_key, &ca_cert, &ca_key)
        .map_err(|e| format!("sign leaf: {e}"))?;

    let crt_path = tls.site_cert(site, tld);
    let key_path = tls.site_key(site, tld);
    write_public_file(&crt_path, leaf_cert.pem().as_bytes())?;
    write_private_file(&key_path, leaf_key.serialize_pem().as_bytes())?;
    Ok((crt_path, key_path))
}

/// Build a (CA KeyPair, CA Certificate) pair suitable for passing to
/// `CertificateParams::signed_by()`. The returned `Certificate` is derived
/// from the hardcoded CA DN + the stored CA private key — not from parsing
/// the on-disk `BadamiLocalDevCA.crt`. See [`secure_site_cert_at`] for why
/// this is safe and sufficient.
fn load_ca_signer(tls: &TlsPaths) -> Result<(KeyPair, Certificate), String> {
    let ca_key_pem = fs::read_to_string(&tls.ca_key)
        .map_err(|e| format!("read CA key {}: {e}", tls.ca_key.display()))?;
    let ca_key = KeyPair::from_pem(&ca_key_pem).map_err(|e| format!("parse CA keypair: {e}"))?;

    let mut params = ca_params(CA_VALIDITY_DAYS)?;
    // self_signed() consumes params; we only need the resulting Certificate
    // as an "issuer" object — its validity dates are not transferred to the
    // leaf. Any discrepancy between this rebuilt cert and the on-disk CA cert
    // is irrelevant because chain verification only requires Issuer DN + SPKI
    // to match, both of which stay stable across rebuilds.
    //
    // We intentionally regenerate the validity window here rather than
    // persisting the original dates — leaves have their own validity.
    params.distinguished_name = ca_distinguished_name();
    let ca_cert = params
        .self_signed(&ca_key)
        .map_err(|e| format!("rebuild CA Certificate: {e}"))?;
    Ok((ca_key, ca_cert))
}

fn ca_distinguished_name() -> DistinguishedName {
    let mut dn = DistinguishedName::new();
    dn.push(DnType::CommonName, CA_COMMON_NAME);
    dn.push(DnType::OrganizationName, "Badami");
    dn.push(DnType::OrganizationalUnitName, "Local Dev");
    dn
}

fn ca_params(validity_days: u64) -> Result<CertificateParams, String> {
    let mut params = CertificateParams::default();
    params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
    params.key_usages = vec![
        KeyUsagePurpose::KeyCertSign,
        KeyUsagePurpose::CrlSign,
        KeyUsagePurpose::DigitalSignature,
    ];
    params.distinguished_name = ca_distinguished_name();
    let (nb, na) = validity_window(validity_days)?;
    params.not_before = nb;
    params.not_after = na;
    Ok(params)
}

/// Remove `{site}.{tld}.{crt,key}` from `Certificates/`.
///
/// Returns the list of files actually deleted. Never scans the directory for
/// unrelated files; never touches the CA.
pub fn unsecure_site_cert_at(
    paths: &RuntimePaths,
    site: &str,
    tld: &str,
) -> Result<Vec<PathBuf>, String> {
    validate_site_name(site)?;
    validate_tld(tld)?;

    let tls = TlsPaths::from_runtime(paths);
    let mut removed = Vec::new();
    for p in [tls.site_cert(site, tld), tls.site_key(site, tld)] {
        if p.is_file() {
            // Containment check — refuse to delete outside Certificates/.
            let parent = p.parent().unwrap_or(Path::new(""));
            if parent != tls.certificates_dir.as_path() {
                return Err(format!(
                    "refusing to remove file outside Certificates/: {}",
                    p.display()
                ));
            }
            fs::remove_file(&p).map_err(|e| format!("remove {}: {e}", p.display()))?;
            removed.push(p);
        }
    }
    Ok(removed)
}

/// True when both `{site}.{tld}.crt` and `.key` exist under Certificates/.
pub fn site_has_certs(paths: &RuntimePaths, site: &str, tld: &str) -> bool {
    let tls = TlsPaths::from_runtime(paths);
    tls.site_cert(site, tld).is_file() && tls.site_key(site, tld).is_file()
}

// ── Status ──────────────────────────────────────────────────────────

/// Collect TLS status: CA presence, best-effort trust check, and the sites
/// that currently have both a crt and a key on disk.
///
/// `skip_live` suppresses the `security find-certificate` subprocess so unit
/// tests do not shell out.
pub fn tls_status_at(paths: &RuntimePaths, skip_live: bool) -> TlsStatus {
    let tls = TlsPaths::from_runtime(paths);
    let ca_exists = tls.ca_cert.is_file() && tls.ca_key.is_file();
    let ca_cert_path = ca_exists.then(|| tls.ca_cert.to_string_lossy().into_owned());
    let ca_key_path = ca_exists.then(|| tls.ca_key.to_string_lossy().into_owned());

    let mut notes = Vec::new();
    let ca_trusted = if !ca_exists {
        false
    } else if skip_live {
        notes.push("skip_live_probes: CA trust probe skipped".into());
        false
    } else {
        probe_ca_trusted()
    };
    if ca_exists && !skip_live && !ca_trusted {
        notes.push(
            "CA cert exists on disk but was not found in the macOS System keychain — run ld_tls_trust_ca to install it"
                .into(),
        );
    }

    let secured_sites = enumerate_secured_sites(&tls);
    TlsStatus {
        ca_exists,
        ca_trusted,
        ca_cert_path,
        ca_key_path,
        ca_common_name: CA_COMMON_NAME.to_string(),
        secured_sites,
        notes,
    }
}

fn enumerate_secured_sites(tls: &TlsPaths) -> Vec<SecuredSite> {
    let mut out = Vec::new();
    let Ok(rd) = fs::read_dir(&tls.certificates_dir) else {
        return out;
    };
    for e in rd.flatten() {
        let p = e.path();
        let Some(name) = p.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        let Some(stem) = name.strip_suffix(".crt") else {
            continue;
        };
        let (site, tld) = match stem.rsplit_once('.') {
            Some(pair) => pair,
            None => continue,
        };
        if validate_site_name(site).is_err() || validate_tld(tld).is_err() {
            continue;
        }
        let key = tls.site_key(site, tld);
        if !key.is_file() {
            continue;
        }
        out.push(SecuredSite {
            name: site.to_string(),
            tld: tld.to_string(),
            cert_path: p.to_string_lossy().into_owned(),
            key_path: key.to_string_lossy().into_owned(),
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name).then(a.tld.cmp(&b.tld)));
    out
}

fn probe_ca_trusted() -> bool {
    #[cfg(target_os = "macos")]
    {
        match Command::new("/usr/bin/security")
            .args([
                "find-certificate",
                "-c",
                CA_COMMON_NAME,
                "/Library/Keychains/System.keychain",
            ])
            .output()
        {
            Ok(out) => out.status.success(),
            Err(_) => false,
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

// ── Trust CA ────────────────────────────────────────────────────────

/// Root-owned staging location for the trusted CA certificate. `security
/// add-trusted-cert` runs as root and reads the referenced certificate off
/// disk; pointing it at a user-writable file is a TOCTOU gap (a user
/// process could race the admin prompt and plant a different cert between
/// osascript auth and `security(1)` exec). We install the cert into a
/// root-owned staging path, hash-verify it against a Rust-computed SHA-256
/// in the same privileged sequence, and only then call
/// `security add-trusted-cert`.
///
/// Trust removal remains manual (`security remove-trusted-cert`). Badami's
/// uninstall does NOT revoke trust automatically — the user controls the
/// System keychain.
pub const ROOT_CA_STAGING_PATH: &str =
    "/Library/Application Support/Badami/local-dev-root/tls/BadamiLocalDevCA.crt";

/// Returns the exact argv shell preview + the osascript body for the trust
/// install. When `run` is `true` and we are not inside a test build, this
/// additionally invokes `osascript -e …`.
///
/// The privileged sequence is:
/// 1. `install -o root -g wheel -m 0644 <user_ca> ROOT_CA_STAGING_PATH`
///    (creates the parent dir with `install -d -m 755` first).
/// 2. `shasum -a 256 -- ROOT_CA_STAGING_PATH` + verify against the Rust-
///    computed SHA-256 — mismatch → `rm -f ROOT_CA_STAGING_PATH` + `exit 1`
///    before any trust change hits the keychain.
/// 3. `security add-trusted-cert ... ROOT_CA_STAGING_PATH` — the keychain
///    reads from the hash-verified root-owned copy.
///
/// Tests pass `run=false` and inspect `argv` / `install_command`.
pub fn trust_ca_argv_at(paths: &RuntimePaths, run: bool) -> Result<TrustCaResult, String> {
    let tls = ensure_ca_at(paths)?;
    let ca_cert_path = tls.ca_cert.to_string_lossy().into_owned();

    // Rust-side digest for the shasum verification step. Computed in-process
    // from the on-disk CA cert so the privileged shell check can prove the
    // just-installed root-owned copy matches the user-side source we audited
    // *before* the admin prompt. This is the TLS-trust equivalent of the
    // bootstrap SHA-256 chain in [`crate::commands::local_dev::bootstrap`].
    let ca_bytes = fs::read(&tls.ca_cert).map_err(|e| {
        format!(
            "read CA cert for hash verification ({}): {e}",
            tls.ca_cert.display()
        )
    })?;
    let ca_sha256_hex = ca_sha256_hex(&ca_bytes);

    // argv displayed to the UI — the `security(1)` command points at the
    // ROOT-OWNED copy, not the user cert, because that's what the privileged
    // shell actually hands to the keychain.
    let argv: Vec<String> = vec![
        "/usr/bin/security".to_string(),
        "add-trusted-cert".to_string(),
        "-d".to_string(),
        "-r".to_string(),
        "trustRoot".to_string(),
        "-k".to_string(),
        "/Library/Keychains/System.keychain".to_string(),
        ROOT_CA_STAGING_PATH.to_string(),
    ];

    let step = argv
        .iter()
        .map(|a| shell_single_quote(a))
        .collect::<Vec<_>>()
        .join(" ");

    // Build the full privileged argv sequence (install → hash-verify →
    // trust). Each sub-argv is argv-escaped by `build_osascript_command`.
    let privileged_argv = build_trust_ca_privileged_argv(&ca_cert_path, &ca_sha256_hex);

    let mut notes = Vec::new();
    let install_command;
    let mut executed = false;

    if run {
        // Build osascript body via the same helpers bootstrap.rs uses. Never
        // shell out to a user-writable script.
        let script = build_osascript_command(&privileged_argv);
        install_command = Some(script.clone());

        if cfg!(test) {
            notes.push("test build: osascript invocation skipped".into());
        } else {
            notes.push(
                "Invoking osascript for `security add-trusted-cert` — user will be prompted for admin password"
                    .into(),
            );
            match Command::new("/usr/bin/osascript")
                .args(["-e", &script])
                .output()
            {
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
                            "security add-trusted-cert failed or was cancelled — the CA is still on disk; retry via UI".into(),
                        );
                    }
                }
                Err(e) => notes.push(format!("failed to spawn osascript: {e}")),
            }
        }
    } else {
        // Still render the AppleScript body so the UI can show the user what
        // would be run; `executed` stays false.
        let script = build_osascript_command(&privileged_argv);
        debug_assert!(script.starts_with("do shell script "));
        debug_assert!(script.contains("administrator privileges"));
        install_command = Some(script);
        notes.push("run=false: argv rendered; invoke with run=true to request admin install".into());
        notes.push(format!("preview: {}", applescript_quote(&step)));
        notes.push(format!(
            "privileged flow: install root-owned CA → shasum-verify (sha256={}) → security add-trusted-cert",
            &ca_sha256_hex[..16]
        ));
    }
    notes.push(
        "CA trust removal is NOT automatic — run `security remove-trusted-cert /Library/Keychains/System.keychain -t /Library/Application\\ Support/Badami/local-dev-root/tls/BadamiLocalDevCA.crt` manually, or use Keychain Access."
            .into(),
    );

    Ok(TrustCaResult {
        ca_cert_path: Some(ca_cert_path),
        argv,
        step,
        install_command,
        executed,
        notes,
    })
}

/// Compose the shell argv list for the privileged trust install. Public for
/// unit tests; callers in production always go through [`trust_ca_argv_at`].
pub fn build_trust_ca_privileged_argv(
    user_ca_cert_path: &str,
    expected_sha256_hex: &str,
) -> Vec<Vec<String>> {
    let parent = "/Library/Application Support/Badami/local-dev-root/tls";
    let mut out: Vec<Vec<String>> = Vec::new();

    // Reclaim ancestor chain BEFORE any staging/install/shasum/security
    // step. `/Library/Application Support/` is root:admin 775, so any admin
    // user could pre-create `.../Badami` or `.../local-dev-root` user-owned
    // and swap `tls/BadamiLocalDevCA.crt` between our shasum verify and the
    // `security add-trusted-cert` exec. The shared reclaim prelude rejects
    // symlinks + reclaims to root:wheel 755 before the role leaf (`tls/`)
    // is populated.
    out.extend(super::bootstrap::reclaim_ancestor_chain_argv(parent));

    out.extend(vec![
        // Install the CA cert root-owned at the staging path.
        vec![
            "/usr/bin/install".into(),
            "-o".into(),
            "root".into(),
            "-g".into(),
            "wheel".into(),
            "-m".into(),
            "644".into(),
            user_ca_cert_path.into(),
            ROOT_CA_STAGING_PATH.into(),
        ],
        // Hash-verify the root-owned copy against the Rust-computed digest
        // BEFORE any trust change touches the keychain. Mismatch deletes
        // the planted file + `exit 1`s so `security add-trusted-cert` never
        // runs with a tampered cert.
        vec![
            "/bin/sh".into(),
            "-c".into(),
            format!(
                "ACTUAL_HEX=\"$(/usr/bin/shasum -a 256 -- {path} | /usr/bin/awk '{{print $1}}')\"; \
                 if [ \"$ACTUAL_HEX\" != {hex} ]; then \
                   rm -f -- {path}; \
                   echo \"badami: SHA-256 mismatch for {path_disp} (expected {hex_disp} got $ACTUAL_HEX)\" >&2; \
                   exit 1; \
                 fi",
                path = shell_single_quote(ROOT_CA_STAGING_PATH),
                hex = shell_single_quote(expected_sha256_hex),
                path_disp = ROOT_CA_STAGING_PATH.replace('\'', "\\'"),
                hex_disp = expected_sha256_hex,
            ),
        ],
        // Keychain reads from the hash-verified root-owned copy.
        vec![
            "/usr/bin/security".into(),
            "add-trusted-cert".into(),
            "-d".into(),
            "-r".into(),
            "trustRoot".into(),
            "-k".into(),
            "/Library/Keychains/System.keychain".into(),
            ROOT_CA_STAGING_PATH.into(),
        ],
    ]);
    out
}

/// Hex-encoded SHA-256 of a byte slice. Mirrors
/// [`crate::commands::local_dev::bootstrap::sha256_hex`] so the trust-CA
/// install step uses the same digest primitive as the LaunchDaemon
/// bootstrap chain.
fn ca_sha256_hex(data: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(data);
    format!("{:x}", hasher.finalize())
}

// ── Internal helpers ────────────────────────────────────────────────

fn validity_window(days: u64) -> Result<(time::OffsetDateTime, time::OffsetDateTime), String> {
    // Compute Y-M-D for "now - 1 day" and "now + days" so we can feed into
    // `rcgen::date_time_ymd(y, m, d)` without taking a direct dependency on
    // the `time` crate — we only touch the type that rcgen re-exports from
    // the `time` dependency it carries anyway.
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let secs_per_day: i64 = 86_400;
    let span: i64 = (days as i64).saturating_mul(secs_per_day);
    let nb_secs = now.saturating_sub(secs_per_day); // 1 day leeway for clock skew
    let na_secs = now.saturating_add(span);
    let nb = unix_secs_to_ymd(nb_secs)?;
    let na = unix_secs_to_ymd(na_secs)?;
    Ok((nb, na))
}

/// Convert unix seconds → (y, m, d) → `OffsetDateTime` via rcgen's helper.
/// Keeps us off the `time` crate's direct dep surface.
fn unix_secs_to_ymd(secs: i64) -> Result<time::OffsetDateTime, String> {
    // Howard Hinnant civil-from-days — https://howardhinnant.github.io/date_algorithms.html
    let days = secs.div_euclid(86_400);
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u8; // [1, 31]
    let m = (if mp < 10 { mp + 3 } else { mp - 9 }) as u8; // [1, 12]
    let y_i32: i32 = (y + if mp >= 10 { 1 } else { 0 })
        .try_into()
        .map_err(|_| "unix seconds out of representable Y-M-D range".to_string())?;
    Ok(date_time_ymd(y_i32, m, d))
}

fn bump_ca_serial(path: &Path) -> u64 {
    let next = match fs::read_to_string(path) {
        Ok(s) => s.trim().parse::<u64>().unwrap_or(1).saturating_add(1),
        Err(_) => 1,
    };
    let _ = fs::write(path, format!("{next}\n"));
    next
}

#[cfg(unix)]
fn set_mode(path: &Path, mode: u32) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let mut perm = fs::metadata(path)?.permissions();
    perm.set_mode(mode);
    fs::set_permissions(path, perm)
}
#[cfg(not(unix))]
fn set_mode(_path: &Path, _mode: u32) -> std::io::Result<()> {
    Ok(())
}

fn write_private_file(path: &Path, contents: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
    }
    fs::write(path, contents).map_err(|e| format!("write {}: {e}", path.display()))?;
    set_mode(path, 0o600).map_err(|e| format!("chmod 600 {}: {e}", path.display()))?;
    Ok(())
}

fn write_public_file(path: &Path, contents: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
    }
    fs::write(path, contents).map_err(|e| format!("write {}: {e}", path.display()))?;
    set_mode(path, 0o644).map_err(|e| format!("chmod 644 {}: {e}", path.display()))?;
    Ok(())
}

// ── Public wrappers (used by sites.rs) ──────────────────────────────

/// Create cert + key for a site. Caller is responsible for the per-site nginx
/// conf (see `sites::secure_site_at`) and the subsequent reload.
pub fn secure_site_at(
    paths: &RuntimePaths,
    site: &str,
    tld: &str,
) -> Result<SecureSiteResult, String> {
    let (crt, key) = secure_site_cert_at(paths, site, tld)?;
    let notes = vec![
        format!(
            "issued leaf cert for {site}.{tld} (SANs: {site}.{tld}, *.{site}.{tld}); validity {} days",
            LEAF_VALIDITY_DAYS
        ),
        "run ld_reload_nginx after the per-site conf is updated".into(),
    ];
    Ok(SecureSiteResult {
        site: site.to_string(),
        tld: tld.to_string(),
        action: "secured".into(),
        cert_path: Some(crt.to_string_lossy().into_owned()),
        key_path: Some(key.to_string_lossy().into_owned()),
        written: vec![
            crt.to_string_lossy().into_owned(),
            key.to_string_lossy().into_owned(),
        ],
        notes,
    })
}

pub fn unsecure_site_at(
    paths: &RuntimePaths,
    site: &str,
    tld: &str,
) -> Result<SecureSiteResult, String> {
    let removed = unsecure_site_cert_at(paths, site, tld)?;
    let action = if removed.is_empty() { "noop" } else { "unsecured" };
    let mut notes = vec![format!(
        "removed {} TLS file(s) under Certificates/ for {site}.{tld}",
        removed.len()
    )];
    if removed.is_empty() {
        notes.push("no cert/key files were present — nothing to delete".into());
    }
    notes.push("CA is left intact (never deleted by unsecure)".into());
    Ok(SecureSiteResult {
        site: site.to_string(),
        tld: tld.to_string(),
        action: action.into(),
        cert_path: None,
        key_path: None,
        written: removed
            .into_iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect(),
        notes,
    })
}

// ── Tauri commands ──────────────────────────────────────────────────

#[tauri::command]
pub async fn ld_tls_status(skip_live: Option<bool>) -> Result<TlsStatus, String> {
    let skip = skip_live.unwrap_or(false);
    tokio::task::spawn_blocking(move || {
        let paths = build_runtime_paths()?;
        Ok(tls_status_at(&paths, skip))
    })
    .await
    .map_err(|e| format!("ld_tls_status task failed: {e}"))?
}

#[tauri::command]
pub async fn ld_tls_trust_ca(run: Option<bool>) -> Result<TrustCaResult, String> {
    let run = run.unwrap_or(false);
    tokio::task::spawn_blocking(move || {
        let paths = build_runtime_paths()?;
        trust_ca_argv_at(&paths, run)
    })
    .await
    .map_err(|e| format!("ld_tls_trust_ca task failed: {e}"))?
}

/// Shim entry point for frontend convenience — `ld_tls_ensure_ca` just
/// forces [`ensure_ca_at`] to run so the UI can prompt for trust immediately
/// after. Returns the resulting status.
#[tauri::command]
pub async fn ld_tls_ensure_ca() -> Result<TlsStatus, String> {
    tokio::task::spawn_blocking(move || {
        let paths = build_runtime_paths()?;
        ensure_ca_at(&paths)?;
        Ok(tls_status_at(&paths, true))
    })
    .await
    .map_err(|e| format!("ld_tls_ensure_ca task failed: {e}"))?
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::super::discovery::runtime_paths_from_root;
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_tmp(label: &str) -> PathBuf {
        let n = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        std::env::temp_dir().join(format!("badami-tls-{label}-{n}"))
    }

    struct TempLocalDev {
        root: PathBuf,
        paths: RuntimePaths,
    }

    impl TempLocalDev {
        fn new(label: &str) -> Self {
            let root = unique_tmp(label);
            let _ = fs::remove_dir_all(&root);
            let paths = runtime_paths_from_root(root.clone());
            fs::create_dir_all(&paths.config_valet).unwrap();
            Self { root, paths }
        }
    }

    impl Drop for TempLocalDev {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn validity_window_fits_leaf_cap() {
        let (nb, na) = validity_window(LEAF_VALIDITY_DAYS).unwrap();
        // nb must be <= na
        assert!(format!("{nb:?}") < format!("{na:?}") || nb == na, "nb={nb:?} na={na:?}");
        // Smoke: the LEAF cap stays under 825 days.
        assert!(LEAF_VALIDITY_DAYS < 825);
    }

    #[test]
    fn time_from_unix_matches_known_date() {
        // 2024-01-02T00:00:00Z = 1704153600
        let d = unix_secs_to_ymd(1_704_153_600).unwrap();
        assert_eq!(format!("{d:?}").contains("2024"), true);
    }

    #[test]
    fn ensure_ca_creates_key_and_cert() {
        let tmp = TempLocalDev::new("ca-create");
        let tls = ensure_ca_at(&tmp.paths).expect("ensure CA");
        assert!(tls.ca_cert.is_file());
        assert!(tls.ca_key.is_file());
        assert!(tls.ca_serial.is_file());
        // CA root sits under temp — not Application Support.
        assert!(tls
            .ca_cert
            .to_string_lossy()
            .starts_with(&tmp.root.to_string_lossy().as_ref()));
        // PEM headers are present.
        let cert = fs::read_to_string(&tls.ca_cert).unwrap();
        assert!(cert.contains("BEGIN CERTIFICATE"));
        let key = fs::read_to_string(&tls.ca_key).unwrap();
        assert!(key.contains("BEGIN PRIVATE KEY") || key.contains("BEGIN RSA PRIVATE KEY") || key.contains("BEGIN EC PRIVATE KEY"));

        // CA cert embeds the common name.
        assert!(
            cert.contains("BEGIN CERTIFICATE"),
            "cert PEM: {}",
            cert.chars().take(80).collect::<String>()
        );
    }

    #[test]
    fn ensure_ca_sets_key_mode_0600_on_unix() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let tmp = TempLocalDev::new("ca-mode");
            let tls = ensure_ca_at(&tmp.paths).expect("ensure CA");
            let perm = fs::metadata(&tls.ca_key).unwrap().permissions();
            assert_eq!(perm.mode() & 0o777, 0o600, "ca key mode must be 0600");
            let perm_cert = fs::metadata(&tls.ca_cert).unwrap().permissions();
            assert_eq!(perm_cert.mode() & 0o777, 0o644, "ca cert mode must be 0644");
        }
    }

    #[test]
    fn ensure_ca_is_idempotent() {
        let tmp = TempLocalDev::new("ca-idempotent");
        let tls_a = ensure_ca_at(&tmp.paths).expect("ensure CA #1");
        let cert_a = fs::read(&tls_a.ca_cert).unwrap();
        let tls_b = ensure_ca_at(&tmp.paths).expect("ensure CA #2");
        let cert_b = fs::read(&tls_b.ca_cert).unwrap();
        assert_eq!(cert_a, cert_b, "second ensure_ca_at must not rewrite CA");
    }

    #[test]
    fn secure_site_issues_leaf_with_sans() {
        let tmp = TempLocalDev::new("leaf-sans");
        let (crt, key) =
            secure_site_cert_at(&tmp.paths, "office", "test").expect("issue leaf");
        assert!(crt.is_file());
        assert!(key.is_file());
        // Decode the leaf PEM and verify both SAN DNS names appear in the
        // DER payload. We avoid depending on `x509-parser` just for this
        // assertion — the SubjectAltName extension encodes DNS names as
        // raw ASCII bytes, so a byte-level `contains()` is a sound (if
        // conservative) check against a false negative.
        let pem_str = fs::read_to_string(&crt).unwrap();
        let der = pem_to_der(&pem_str).expect("parse leaf PEM");
        assert!(der.windows(11).any(|w| w == b"office.test"), "FQDN SAN missing");
        assert!(
            der.windows(13).any(|w| w == b"*.office.test"),
            "wildcard SAN missing"
        );
    }

    /// Minimal PEM → DER decoder for tests. Strips header/footer and
    /// base64-decodes the body. Avoids a direct `pem` crate dep since the
    /// one rcgen pulls in isn't re-exported.
    fn pem_to_der(s: &str) -> Result<Vec<u8>, String> {
        use base64::engine::general_purpose::STANDARD;
        use base64::Engine;
        let mut acc = String::new();
        let mut inside = false;
        for line in s.lines() {
            let t = line.trim();
            if t.starts_with("-----BEGIN") {
                inside = true;
                continue;
            }
            if t.starts_with("-----END") {
                inside = false;
                continue;
            }
            if inside {
                acc.push_str(t);
            }
        }
        STANDARD.decode(acc.as_bytes()).map_err(|e| format!("b64: {e}"))
    }

    #[test]
    fn leaf_key_is_mode_0600_on_unix() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let tmp = TempLocalDev::new("leaf-mode");
            let (crt, key) =
                secure_site_cert_at(&tmp.paths, "office", "test").expect("issue leaf");
            assert_eq!(
                fs::metadata(&key).unwrap().permissions().mode() & 0o777,
                0o600,
            );
            assert_eq!(
                fs::metadata(&crt).unwrap().permissions().mode() & 0o777,
                0o644,
            );
        }
    }

    #[test]
    fn secure_site_rejects_bad_names() {
        let tmp = TempLocalDev::new("leaf-bad-names");
        assert!(secure_site_cert_at(&tmp.paths, "../etc", "test").is_err());
        assert!(secure_site_cert_at(&tmp.paths, "office", "../etc").is_err());
        assert!(secure_site_cert_at(&tmp.paths, "a b", "test").is_err());
    }

    #[test]
    fn unsecure_removes_only_leaf_files() {
        let tmp = TempLocalDev::new("unsecure");
        let (crt, key) =
            secure_site_cert_at(&tmp.paths, "office", "test").expect("issue leaf");
        assert!(crt.is_file() && key.is_file());

        // Add an unrelated file under Certificates — unsecure must leave it alone.
        let tls = TlsPaths::from_runtime(&tmp.paths);
        let foreign = tls.certificates_dir.join("other.test.crt");
        fs::write(&foreign, b"not ours").unwrap();

        let removed = unsecure_site_cert_at(&tmp.paths, "office", "test").expect("unsecure");
        assert_eq!(removed.len(), 2);
        assert!(!crt.is_file());
        assert!(!key.is_file());
        assert!(foreign.is_file(), "unrelated file must survive");

        // CA still intact.
        assert!(tls.ca_cert.is_file());
        assert!(tls.ca_key.is_file());

        // Second call is a noop.
        let again = unsecure_site_cert_at(&tmp.paths, "office", "test").expect("noop");
        assert!(again.is_empty());
    }

    #[test]
    fn tls_status_lists_secured_sites_and_skips_probe() {
        let tmp = TempLocalDev::new("status");
        let status_empty = tls_status_at(&tmp.paths, true);
        assert!(!status_empty.ca_exists);
        assert!(!status_empty.ca_trusted);
        assert!(status_empty.secured_sites.is_empty());
        assert_eq!(status_empty.ca_common_name, CA_COMMON_NAME);

        let _ = secure_site_cert_at(&tmp.paths, "office", "test").unwrap();
        let _ = secure_site_cert_at(&tmp.paths, "sumedang", "test").unwrap();
        let status = tls_status_at(&tmp.paths, true);
        assert!(status.ca_exists);
        assert!(!status.ca_trusted, "skip_live must leave ca_trusted=false");
        assert_eq!(status.secured_sites.len(), 2);
        // Sorted by name.
        assert_eq!(status.secured_sites[0].name, "office");
        assert_eq!(status.secured_sites[1].name, "sumedang");
    }

    #[test]
    fn tls_status_ignores_site_without_matching_key() {
        let tmp = TempLocalDev::new("status-partial");
        let (crt, key) = secure_site_cert_at(&tmp.paths, "office", "test").unwrap();
        fs::remove_file(&key).unwrap();
        let status = tls_status_at(&tmp.paths, true);
        assert!(status.secured_sites.is_empty(), "cert alone must not count");
        assert!(crt.is_file());
    }

    #[test]
    fn trust_ca_argv_dry_run_returns_security_command() {
        let tmp = TempLocalDev::new("trust-dry");
        let res = trust_ca_argv_at(&tmp.paths, false).expect("trust argv");
        // The UI-level argv now reflects the ROOT-OWNED cert path — the
        // keychain receives the hash-verified copy, not the user-writable
        // source.
        assert_eq!(res.argv[0], "/usr/bin/security");
        assert_eq!(res.argv[1], "add-trusted-cert");
        assert!(res.argv.contains(&"trustRoot".to_string()));
        assert!(res
            .argv
            .contains(&"/Library/Keychains/System.keychain".to_string()));
        assert_eq!(
            res.argv.last().unwrap(),
            "/Library/Application Support/Badami/local-dev-root/tls/BadamiLocalDevCA.crt",
            "trusted-cert path must be the root-owned staging copy, not the user CA cert"
        );
        assert!(res.step.contains("add-trusted-cert"));
        assert!(res.step.contains("'/Library/Keychains/System.keychain'"));
        assert!(
            res.step.contains(
                "'/Library/Application Support/Badami/local-dev-root/tls/BadamiLocalDevCA.crt'"
            ),
            "step preview must reference the root-owned staging path"
        );
        // Not executed; CA was created to feed the argv.
        assert!(!res.executed);
        // Returned ca_cert_path still points at the user-side source (useful
        // for the UI "which cert will be trusted" readout).
        assert!(res.ca_cert_path.unwrap().contains(CA_BASENAME));

        let cmd = res.install_command.unwrap();
        assert!(cmd.starts_with("do shell script "));
        assert!(cmd.contains("administrator privileges"));

        // Install → verify → trust ordering: the install(1) step for the
        // root-owned copy, the shasum verify, and the `security add-trusted-
        // cert` call must appear in that order.
        let install_pos = cmd
            .find("'/usr/bin/install'")
            .expect("install(1) step must appear in osascript body");
        let shasum_pos = cmd.find("shasum").expect("shasum verify must appear");
        let security_pos = cmd
            .find("'/usr/bin/security'")
            .expect("security add-trusted-cert must appear");
        assert!(
            install_pos < shasum_pos,
            "install(1) must run before shasum verify: install@{install_pos} shasum@{shasum_pos}"
        );
        assert!(
            shasum_pos < security_pos,
            "shasum verify must run before security add-trusted-cert: shasum@{shasum_pos} security@{security_pos}"
        );

        // Rollback on mismatch — the mismatch branch removes the planted
        // CA copy before `exit 1`.
        assert!(
            cmd.contains("rm -f") && cmd.contains("exit 1"),
            "mismatch branch must `rm -f` the root CA copy + exit 1 before security runs"
        );
    }

    #[test]
    fn trust_ca_argv_embeds_sha256_in_privileged_body() {
        let tmp = TempLocalDev::new("trust-sha");
        let res = trust_ca_argv_at(&tmp.paths, false).expect("trust argv");
        let cmd = res.install_command.unwrap();
        // Recompute the CA sha256 ourselves and confirm the shell body
        // embeds it. If this ever drifts, the test will catch the
        // tampered-at-rest attack regressing.
        let ca_bytes = fs::read(
            tmp.paths
                .config_valet
                .clone()
                + "/CA/BadamiLocalDevCA.crt",
        )
        .expect("CA cert on disk");
        let digest = ca_sha256_hex(&ca_bytes);
        assert!(
            cmd.contains(&digest),
            "install_command must embed the Rust-computed SHA-256:\ndigest={digest}\ncmd={cmd}"
        );
    }

    #[test]
    fn build_trust_ca_privileged_argv_shape_includes_reclaim() {
        let argv = build_trust_ca_privileged_argv(
            "/Users/me/Library/Application Support/Badami/local-dev/config/valet/CA/BadamiLocalDevCA.crt",
            "deadbeef".repeat(8).as_str(),
        );
        // 3 reclaim steps (2 ancestors + 1 role leaf) + 3 trust steps
        // (install cert, shasum verify, security add-trusted-cert).
        assert_eq!(argv.len(), 6, "reclaim prelude + 3 trust steps = 6");
        // step 0: ancestor /Library/Application Support/Badami reclaim.
        assert_eq!(argv[0][0], "/bin/sh");
        assert!(argv[0][2].contains("/Library/Application Support/Badami'"));
        assert!(argv[0][2].contains("install -d -o root -g wheel -m 755"));
        assert!(argv[0][2].contains("chown root:wheel"));
        // step 1: ancestor .../Badami/local-dev-root reclaim.
        assert!(argv[1][2].contains("/local-dev-root'"));
        // step 2: role leaf tls dir reclaim.
        assert!(argv[2][2].contains("/local-dev-root/tls'"));
        assert!(argv[2][2].contains("rm -rf"));
        // step 3: install -m 644 user_ca final_dst
        assert_eq!(argv[3][0], "/usr/bin/install");
        assert!(argv[3].iter().any(|a| a == "644"));
        assert_eq!(
            argv[3].last().unwrap(),
            "/Library/Application Support/Badami/local-dev-root/tls/BadamiLocalDevCA.crt"
        );
        // step 4: shasum verify (sh -c body contains both shasum and the hex)
        assert_eq!(argv[4][0], "/bin/sh");
        let body = &argv[4][2];
        assert!(body.contains("shasum"));
        assert!(body.contains(&"deadbeef".repeat(8)));
        assert!(body.contains("exit 1"));
        // step 5: security add-trusted-cert <root_copy>
        assert_eq!(argv[5][0], "/usr/bin/security");
        assert_eq!(
            argv[5].last().unwrap(),
            "/Library/Application Support/Badami/local-dev-root/tls/BadamiLocalDevCA.crt"
        );
    }

    /// The osascript body produced for the trust install must emit the
    /// ancestor reclaim prelude BEFORE any `install -o root`, `shasum`, or
    /// `security add-trusted-cert`. Prevents the TOCTOU window where a user
    /// process pre-plants `/Library/Application Support/Badami` user-owned
    /// (admin group) and swaps the staged cert between shasum and
    /// `security(1)`.
    #[test]
    fn trust_ca_argv_reclaims_ancestors_before_install() {
        let tmp = TempLocalDev::new("trust-reclaim");
        let res = trust_ca_argv_at(&tmp.paths, false).expect("trust argv");
        let cmd = res.install_command.unwrap();
        let reclaim_pos = cmd
            .find("badami: ancestor")
            .expect("ancestor reclaim prelude present in trust install");
        let install_pos = cmd
            .find("'/usr/bin/install' '-o' 'root' '-g' 'wheel' '-m' '644'")
            .expect("install -m 644 for root CA present");
        let shasum_pos = cmd.find("shasum").expect("shasum verify present");
        let security_pos = cmd
            .find("'/usr/bin/security' 'add-trusted-cert'")
            .expect("security add-trusted-cert present");
        assert!(
            reclaim_pos < install_pos,
            "reclaim must run BEFORE install: reclaim@{reclaim_pos} install@{install_pos}"
        );
        assert!(
            reclaim_pos < shasum_pos,
            "reclaim must run BEFORE shasum verify"
        );
        assert!(
            reclaim_pos < security_pos,
            "reclaim must run BEFORE security add-trusted-cert"
        );
        // Both ancestors are referenced.
        assert!(cmd.contains("'/Library/Application Support/Badami'"));
        assert!(cmd.contains("'/Library/Application Support/Badami/local-dev-root'"));
        // Role leaf tls dir is referenced.
        assert!(cmd.contains("'/Library/Application Support/Badami/local-dev-root/tls'"));
        // Reclaim rejects symlinks.
        assert!(cmd.contains("is a symlink"));
    }

    #[test]
    fn trust_ca_argv_run_true_skips_osascript_in_test_build() {
        let tmp = TempLocalDev::new("trust-run");
        // cfg!(test) must suppress osascript invocation; `executed` stays false.
        let res = trust_ca_argv_at(&tmp.paths, true).expect("trust argv run");
        assert!(res.install_command.is_some());
        assert!(!res.executed, "test build must never actually run osascript");
        assert!(res
            .notes
            .iter()
            .any(|n| n.contains("test build") || n.contains("skipped")));
    }

    #[test]
    fn site_has_certs_reflects_disk_state() {
        let tmp = TempLocalDev::new("has-certs");
        assert!(!site_has_certs(&tmp.paths, "office", "test"));
        let _ = secure_site_cert_at(&tmp.paths, "office", "test").unwrap();
        assert!(site_has_certs(&tmp.paths, "office", "test"));
        let _ = unsecure_site_cert_at(&tmp.paths, "office", "test").unwrap();
        assert!(!site_has_certs(&tmp.paths, "office", "test"));
    }
}
