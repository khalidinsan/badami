//! Install and update Badami-owned runtime binaries from upstream archives.
//!
//! The network-facing counterpart to `provision.rs`: instead of copying out of
//! a local install it fetches a published archive, checks the digest
//! when the source publishes one, extracts it into `runtime/<role>/<version>/`,
//! and keeps the result only when the binary answers a version probe. A failed
//! install restores whatever it replaced, so rollback is flipping `selected`.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
#[cfg(target_os = "macos")]
use std::io::Read;
use std::io::Write;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command;

use super::discovery::build_runtime_paths;
use super::runtime_manifest::{self, RuntimeComponent, RuntimeManifest};

/// Archive container a source publishes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ArchiveKind {
    TarGz,
    Zip,
    RawBinary,
}

/// One artifact the user can install.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateSource {
    /// Stable catalog key, also the install request id. Installed components
    /// record it verbatim as their manifest `source`, so a downloaded install
    /// stays traceable without a lookup table; the family prefix (`homebrew-`,
    /// `static-php-cli-`) names the origin.
    pub id: String,
    pub label: String,
    /// One of [`runtime_manifest::ROLES`].
    pub role: String,
    /// Empty when upstream offers nothing for this role/version.
    pub url: String,
    /// Version directory name (`8.4`, `10.11.6`, `2.93`).
    pub version: String,
    pub archive: ArchiveKind,
    /// `None` when the publisher ships no checksum; the note says so.
    pub sha256: Option<String>,
    pub note: String,
}

/// static-php-cli FPM builds confirmed present upstream. A snapshot, not a live
/// index: upstream publishes patch releases this list will not know about.
const PHP_SNAPSHOT: &[&str] = &["8.0.30", "8.1.34", "8.2.32", "8.3.32", "8.4.23", "8.5.8"];

const SPC_BASE: &str = "https://dl.static-php.dev/static-php-cli/common";
const BREW_DNSMASQ_API: &str = "https://formulae.brew.sh/api/formula/dnsmasq.json";
const STAGING_DIR: &str = ".staging";

/// static-php-cli starts at PHP 8.0, so there is no upstream static build for
/// 7.4 and the updater cannot install that version.
pub const NO_UPSTREAM_PHP74: &str = "No upstream static build exists for PHP 7.4 \
     (static-php-cli starts at 8.0), so the updater cannot install this version.";

/// static-php-cli arch token used in its file names.
fn spc_arch() -> &'static str {
    if cfg!(target_arch = "aarch64") {
        "aarch64"
    } else {
        "x86_64"
    }
}

/// Homebrew bottle keys, newest macOS first. arm64 and Intel keys differ.
fn bottle_keys() -> &'static [&'static str] {
    if cfg!(target_arch = "aarch64") {
        &[
            "arm64_tahoe",
            "arm64_sequoia",
            "arm64_sonoma",
            "arm64_golden_gate",
        ]
    } else {
        &["tahoe", "sequoia", "sonoma", "ventura"]
    }
}

/// Badami keys PHP on the minor series (`8.4`), matching the `config/php/<tag>/`
/// ini directories.
fn php_series(patch: &str) -> String {
    let mut parts = patch.split('.');
    match (parts.next(), parts.next()) {
        (Some(major), Some(minor)) => format!("{major}.{minor}"),
        _ => patch.to_string(),
    }
}

/// Primary executable name for a role, used to find the binary after extraction.
pub fn binary_hint(role: &str) -> &'static str {
    match role {
        "nginx" => "nginx",
        "php" => "php-fpm",
        "mariadb" => "mariadbd",
        "redis" => "redis-server",
        "dnsmasq" => "dnsmasq",
        _ => "",
    }
}

/// Static catalog. Live sources are appended by [`resolve_catalog`].
pub fn catalog() -> Vec<UpdateSource> {
    let arch = spc_arch();
    let mut out: Vec<UpdateSource> = PHP_SNAPSHOT
        .iter()
        .map(|patch| UpdateSource {
            id: format!("static-php-cli-php-{patch}"),
            label: format!("PHP {patch} (static-php-cli)"),
            role: "php".to_string(),
            url: format!("{SPC_BASE}/php-{patch}-fpm-macos-{arch}.tar.gz"),
            version: php_series(patch),
            archive: ArchiveKind::TarGz,
            sha256: None,
            note: "static-php-cli publishes no checksum for this build; the download will be unverified"
                .to_string(),
        })
        .collect();
    out.push(UpdateSource {
        id: "static-php-cli-php-7.4".to_string(),
        label: "PHP 7.4 (unavailable upstream)".to_string(),
        role: "php".to_string(),
        url: String::new(),
        version: "7.4".to_string(),
        archive: ArchiveKind::TarGz,
        sha256: None,
        note: NO_UPSTREAM_PHP74.to_string(),
    });
    out
}

/// Catalog plus the sources that have to be read live: the Homebrew bottle API
/// for dnsmasq.
///
/// A source that cannot be read appears as an entry with an empty url and the
/// reason in `note`, so the UI can list it without offering an install.
pub async fn resolve_catalog() -> Result<Vec<UpdateSource>, String> {
    let client = http_client()?;
    let mut out = catalog();
    match brew_dnsmasq(&client).await {
        Ok(source) => out.push(source),
        Err(e) => out.push(unavailable(
            "homebrew-dnsmasq",
            "dnsmasq",
            "dnsmasq (Homebrew bottle)",
            &e,
        )),
    }
    Ok(out)
}

/// Catalog entry standing in for a source that could not be read.
fn unavailable(id: &str, role: &str, label: &str, reason: &str) -> UpdateSource {
    UpdateSource {
        id: id.to_string(),
        label: label.to_string(),
        role: role.to_string(),
        url: String::new(),
        version: String::new(),
        archive: ArchiveKind::TarGz,
        sha256: None,
        note: format!("unavailable: {reason}"),
    }
}

/// Look a source up by id.
pub fn find_source<'a>(sources: &'a [UpdateSource], id: &str) -> Option<&'a UpdateSource> {
    sources.iter().find(|s| s.id == id)
}

/// Client shared by every catalog read and download. The read timeout is
/// generous because bottles and PHP archives are tens of megabytes, but a
/// stalled connection still fails.
fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(concat!("Badami/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(std::time::Duration::from_secs(20))
        .read_timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| format!("build HTTP client: {e}"))
}

/// dnsmasq bottle from the Homebrew formula API. Only dnsmasq is offered from
/// Homebrew: it was measured to have no runtime dependencies, while other
/// bottles would need their whole dependency closure relocated.
async fn brew_dnsmasq(client: &reqwest::Client) -> Result<UpdateSource, String> {
    let body: serde_json::Value = client
        .get(BREW_DNSMASQ_API)
        .send()
        .await
        .map_err(|e| format!("GET {BREW_DNSMASQ_API}: {e}"))?
        .json()
        .await
        .map_err(|e| format!("parse {BREW_DNSMASQ_API}: {e}"))?;
    let version = body
        .pointer("/versions/stable")
        .and_then(|v| v.as_str())
        .ok_or_else(|| format!("{BREW_DNSMASQ_API} has no versions.stable"))?;
    let files = body
        .pointer("/bottle/stable/files")
        .ok_or_else(|| format!("{BREW_DNSMASQ_API} has no bottle.stable.files"))?;
    let (key, file) = bottle_keys()
        .iter()
        .find_map(|key| files.get(*key).map(|file| (*key, file)))
        .ok_or_else(|| format!("{BREW_DNSMASQ_API} has no bottle for this macOS version"))?;
    let url = file
        .get("url")
        .and_then(|v| v.as_str())
        .ok_or_else(|| format!("dnsmasq bottle {key} has no url"))?;
    let sha256 = file
        .get("sha256")
        .and_then(|v| v.as_str())
        .ok_or_else(|| format!("dnsmasq bottle {key} has no sha256"))?;
    Ok(UpdateSource {
        id: format!("homebrew-dnsmasq-{version}"),
        label: format!("dnsmasq {version} (Homebrew bottle)"),
        role: "dnsmasq".to_string(),
        url: url.to_string(),
        version: version.to_string(),
        archive: ArchiveKind::TarGz,
        sha256: Some(sha256.to_string()),
        note: format!(
            "Homebrew bottle {key}; sha256 published by formulae.brew.sh. Homebrew is the \
             secondary source and only dnsmasq is offered from it."
        ),
    })
}

/// Stream a source archive into `dest_dir`, hashing as it goes, and return the
/// published file path. A declared digest is enforced before the file is
/// published, so extraction can never see a mismatched archive.
///
/// The `Send` bound on the callback is what keeps the returned future usable
/// from a Tauri command, which requires a `Send` future.
pub async fn download(
    source: &UpdateSource,
    dest_dir: &Path,
    progress: &mut (dyn FnMut(u64, Option<u64>) + Send),
) -> Result<PathBuf, String> {
    if source.url.trim().is_empty() {
        return Err(format!("{} is not downloadable: {}", source.label, source.note));
    }
    let client = http_client()?;
    let mut request = client.get(source.url.trim());
    if let Some(token) = ghcr_token(&client, source).await? {
        request = request.bearer_auth(token);
    }
    let mut response = request
        .send()
        .await
        .map_err(|e| format!("GET {}: {e}", source.url))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("GET {}: HTTP {status}", source.url));
    }
    let total = response.content_length();

    let name = archive_file_name(source);
    let final_path = dest_dir.join(&name);
    let part_path = dest_dir.join(format!("{name}.part"));
    fs::create_dir_all(dest_dir).map_err(|e| format!("mkdir {}: {e}", dest_dir.display()))?;
    let _ = fs::remove_file(&part_path);
    let mut file =
        fs::File::create(&part_path).map_err(|e| format!("create {}: {e}", part_path.display()))?;

    let mut hasher = Sha256::new();
    let mut written: u64 = 0;
    progress(0, total);
    loop {
        let chunk = match response.chunk().await {
            Ok(Some(chunk)) => chunk,
            Ok(None) => break,
            Err(e) => {
                drop(file);
                let _ = fs::remove_file(&part_path);
                return Err(format!("read body of {}: {e}", source.url));
            }
        };
        hasher.update(&chunk[..]);
        if let Err(e) = file.write_all(&chunk) {
            drop(file);
            let _ = fs::remove_file(&part_path);
            return Err(format!("write {}: {e}", part_path.display()));
        }
        written += chunk.len() as u64;
        progress(written, total);
    }
    if let Err(e) = file.flush() {
        drop(file);
        let _ = fs::remove_file(&part_path);
        return Err(format!("flush {}: {e}", part_path.display()));
    }
    drop(file);
    let digest = format!("{:x}", hasher.finalize());
    publish_verified(&part_path, &final_path, source.sha256.as_deref(), &digest)
}

/// Verify a finished download and move it into place.
///
/// Extraction is only reachable once this returns `Ok`, and every failure path
/// deletes the partial file rather than leaving it for a later run to trust.
fn publish_verified(
    part: &Path,
    final_path: &Path,
    expected: Option<&str>,
    actual: &str,
) -> Result<PathBuf, String> {
    if let Some(expected) = expected {
        if !expected.eq_ignore_ascii_case(actual) {
            let _ = fs::remove_file(part);
            return Err(format!(
                "checksum mismatch for {}: expected {expected}, got {actual}; archive discarded before extraction",
                final_path.display()
            ));
        }
    }
    if let Err(e) = fs::rename(part, final_path) {
        let _ = fs::remove_file(part);
        return Err(format!("move {} into place: {e}", final_path.display()));
    }
    Ok(final_path.to_path_buf())
}

/// Homebrew bottles live in GHCR and need an anonymous pull token. The blob
/// request then 307-redirects to a public CDN host, where reqwest drops the
/// Authorization header on the cross-origin hop; the target needs no auth.
async fn ghcr_token(client: &reqwest::Client, source: &UpdateSource) -> Result<Option<String>, String> {
    let Some(formula) = ghcr_formula(&source.url) else {
        return Ok(None);
    };
    let url = format!("https://ghcr.io/token?scope=repository:homebrew/core/{formula}:pull");
    let body: serde_json::Value = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("GET {url}: {e}"))?
        .json()
        .await
        .map_err(|e| format!("parse {url}: {e}"))?;
    let token = body
        .get("token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| format!("{url} returned no token"))?;
    Ok(Some(token.to_string()))
}

/// Formula name inside a GHCR blob URL, or `None` for any other host.
fn ghcr_formula(url: &str) -> Option<String> {
    let rest = url.strip_prefix("https://ghcr.io/v2/homebrew/core/")?;
    let name = rest.split('/').next()?;
    (!name.is_empty()).then(|| name.to_string())
}

/// Staged file name: source id plus the URL tail, sanitized, with the archive
/// extension appended when the URL has none (a GHCR blob URL ends in a digest).
fn archive_file_name(source: &UpdateSource) -> String {
    let base = sanitize(&format!("{}-{}", source.id, url_tail(&source.url)));
    match source.archive {
        ArchiveKind::TarGz if !base.ends_with(".tar.gz") => format!("{base}.tar.gz"),
        ArchiveKind::Zip if !base.ends_with(".zip") => format!("{base}.zip"),
        _ => base,
    }
}

fn url_tail(url: &str) -> String {
    let path = url.split(['?', '#']).next().unwrap_or(url);
    path.rsplit('/').next().unwrap_or("archive").to_string()
}

/// Keep only characters that are safe in a single file name.
fn sanitize(raw: &str) -> String {
    raw.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') {
                c
            } else {
                '-'
            }
        })
        .collect()
}

/// Unpack an archive into `dest` and return the primary binary inside it.
pub fn extract(
    archive: &Path,
    kind: ArchiveKind,
    dest: &Path,
    binary_hint: &str,
) -> Result<PathBuf, String> {
    if binary_hint.trim().is_empty() {
        return Err(format!("no primary binary name is known for {}", archive.display()));
    }
    fs::create_dir_all(dest).map_err(|e| format!("mkdir {}: {e}", dest.display()))?;
    match kind {
        ArchiveKind::TarGz => extract_tar_gz(archive, dest)?,
        ArchiveKind::Zip => extract_zip(archive, dest)?,
        ArchiveKind::RawBinary => extract_raw(archive, dest, binary_hint)?,
    }
    collapse_single_root(dest)?;
    let binary = find_binary(dest, binary_hint)?;
    make_executable(&binary)?;
    Ok(binary)
}

/// Archives commonly wrap the payload in one top-level folder, and Homebrew
/// bottles nest `<formula>/<version>/`. Unwrap those while the destination
/// holds exactly one directory, so `binary_rel` names the real layout instead
/// of a redundant prefix.
///
/// Conventional layout directories (`bin/`, `lib/`, ...) are left alone: redis
/// ships `bin/` holding its server beside the dylibs it loads from
/// `@executable_path`, and flattening that would scatter them.
fn collapse_single_root(dest: &Path) -> Result<(), String> {
    loop {
        let mut entries =
            fs::read_dir(dest).map_err(|e| format!("read_dir {}: {e}", dest.display()))?;
        let Some(first) = entries.next() else {
            return Ok(());
        };
        if entries.next().is_some() {
            return Ok(());
        }
        let first = first.map_err(|e| format!("read_dir {}: {e}", dest.display()))?;
        if !first
            .file_type()
            .map_err(|e| format!("file_type: {e}"))?
            .is_dir()
        {
            return Ok(());
        }
        if is_layout_dir(&first.file_name().to_string_lossy()) {
            return Ok(());
        }
        let inner = first.path();
        for entry in fs::read_dir(&inner).map_err(|e| format!("read_dir {}: {e}", inner.display()))? {
            let entry = entry.map_err(|e| format!("read_dir entry: {e}"))?;
            let to = dest.join(entry.file_name());
            fs::rename(entry.path(), &to).map_err(|e| {
                format!("move {} to {}: {e}", entry.path().display(), to.display())
            })?;
        }
        fs::remove_dir(&inner).map_err(|e| format!("remove {}: {e}", inner.display()))?;
    }
}

/// Directory names that carry layout meaning for the supervisor and config
/// generator, so they must survive extraction at the top level.
fn is_layout_dir(name: &str) -> bool {
    matches!(
        name,
        "bin" | "sbin" | "lib" | "share" | "etc" | "var" | "include"
    )
}

fn extract_tar_gz(archive: &Path, dest: &Path) -> Result<(), String> {
    let file = fs::File::open(archive).map_err(|e| format!("open {}: {e}", archive.display()))?;
    let mut tar = tar::Archive::new(flate2::read::GzDecoder::new(file));
    let entries = tar
        .entries()
        .map_err(|e| format!("read tar {}: {e}", archive.display()))?;
    for entry in entries {
        let mut entry = entry.map_err(|e| format!("read tar entry: {e}"))?;
        let raw = entry
            .path()
            .map_err(|e| format!("entry path in {}: {e}", archive.display()))?
            .into_owned();
        let target = safe_join(dest, &raw)?;
        let kind = entry.header().entry_type();
        if kind.is_dir() {
            fs::create_dir_all(&target).map_err(|e| format!("mkdir {}: {e}", target.display()))?;
            continue;
        }
        if !kind.is_file() {
            // Links could point anywhere; none of the catalog archives use them.
            return Err(format!(
                "refusing archive entry {}: only regular files and directories are extracted",
                raw.display()
            ));
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
        }
        let mut out =
            fs::File::create(&target).map_err(|e| format!("create {}: {e}", target.display()))?;
        std::io::copy(&mut entry, &mut out)
            .map_err(|e| format!("extract {}: {e}", target.display()))?;
    }
    Ok(())
}

fn extract_zip(archive: &Path, dest: &Path) -> Result<(), String> {
    let file = fs::File::open(archive).map_err(|e| format!("open {}: {e}", archive.display()))?;
    let mut zip = zip::ZipArchive::new(file)
        .map_err(|e| format!("read zip {}: {e}", archive.display()))?;
    for index in 0..zip.len() {
        let mut entry = zip
            .by_index(index)
            .map_err(|e| format!("read zip entry {index}: {e}"))?;
        let name = entry.name().to_string();
        let Some(relative) = entry.enclosed_name() else {
            return Err(format!("refusing archive entry {name}: path escapes the destination"));
        };
        let target = safe_join(dest, &relative)?;
        if entry.is_dir() {
            fs::create_dir_all(&target).map_err(|e| format!("mkdir {}: {e}", target.display()))?;
            continue;
        }
        if entry.is_symlink() {
            return Err(format!("refusing archive entry {name}: symlinks are not extracted"));
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
        }
        let mut out =
            fs::File::create(&target).map_err(|e| format!("create {}: {e}", target.display()))?;
        std::io::copy(&mut entry, &mut out)
            .map_err(|e| format!("extract {}: {e}", target.display()))?;
    }
    Ok(())
}

fn extract_raw(archive: &Path, dest: &Path, binary_hint: &str) -> Result<(), String> {
    let name = if binary_hint.trim().is_empty() {
        archive
            .file_name()
            .ok_or_else(|| format!("cannot name the copy of {}", archive.display()))?
            .to_string_lossy()
            .into_owned()
    } else {
        binary_hint.trim().to_string()
    };
    let target = dest.join(&name);
    fs::copy(archive, &target)
        .map_err(|e| format!("copy {} to {}: {e}", archive.display(), target.display()))?;
    Ok(())
}

/// Resolve an archive entry path under `dest`, refusing anything that would
/// escape it: absolute paths, root/prefix components, and `..`.
fn safe_join(dest: &Path, entry: &Path) -> Result<PathBuf, String> {
    let mut out = dest.to_path_buf();
    let mut saw_name = false;
    for component in entry.components() {
        match component {
            Component::Normal(part) => {
                out.push(part);
                saw_name = true;
            }
            Component::CurDir => {}
            Component::ParentDir => {
                return Err(format!(
                    "refusing archive entry {}: contains a `..` component",
                    entry.display()
                ))
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err(format!(
                    "refusing archive entry {}: absolute path",
                    entry.display()
                ))
            }
        }
    }
    if !saw_name {
        return Err(format!("refusing archive entry {}: empty path", entry.display()));
    }
    Ok(out)
}

/// Shallowest file named `hint` under `dest`.
fn find_binary(dest: &Path, hint: &str) -> Result<PathBuf, String> {
    let mut found: Vec<PathBuf> = Vec::new();
    let mut stack = vec![dest.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_dir() {
                stack.push(path);
                continue;
            }
            if kind.is_file() && path.file_name().map(|n| n == hint).unwrap_or(false) {
                found.push(path);
            }
        }
    }
    found.sort_by(|a, b| {
        a.components()
            .count()
            .cmp(&b.components().count())
            .then_with(|| a.cmp(b))
    });
    found
        .into_iter()
        .next()
        .ok_or_else(|| format!("no file named {hint} was extracted from the archive"))
}

/// Archives do not always carry the exec bit, and the smoke test needs it.
#[cfg(unix)]
fn make_executable(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let mut perms = fs::metadata(path)
        .map_err(|e| format!("stat {}: {e}", path.display()))?
        .permissions();
    perms.set_mode(0o755);
    fs::set_permissions(path, perms).map_err(|e| format!("chmod {}: {e}", path.display()))
}

#[cfg(not(unix))]
fn make_executable(_path: &Path) -> Result<(), String> {
    Ok(())
}

/// Move a staged tree into `runtime/<role>/<version>/` and prove it runs.
///
/// An existing directory at the same version is parked first and restored if
/// anything below fails, so a bad update never destroys a working install.
/// The returned component is marked `selected`: an update is meant to be used.
pub fn install(
    runtime_root: &Path,
    source: &UpdateSource,
    staged_binary: &Path,
    staged_root: &Path,
    binary_rel: &str,
) -> Result<RuntimeComponent, String> {
    if source.role.trim().is_empty() || source.version.trim().is_empty() {
        return Err("a component needs both a role and a version".to_string());
    }
    if !staged_root.is_dir() {
        return Err(format!("staged tree missing: {}", staged_root.display()));
    }
    let rel = if binary_rel.trim().is_empty() {
        staged_binary
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .ok_or_else(|| format!("cannot derive a binary path from {}", staged_binary.display()))?
    } else {
        binary_rel.trim().to_string()
    };

    let dest = runtime_manifest::component_dir(runtime_root, &source.role, &source.version);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
    }
    let parked = park_existing(&dest)?;
    if let Err(e) = move_tree(staged_root, &dest) {
        rollback(&dest, parked.as_deref());
        return Err(e);
    }

    let binary = dest.join(&rel);
    if !binary.is_file() {
        rollback(&dest, parked.as_deref());
        return Err(format!("staged binary is missing after install: {}", binary.display()));
    }
    if let Err(e) = make_executable(&binary) {
        rollback(&dest, parked.as_deref());
        return Err(e);
    }
    if let Err(e) = relink_outside_refs(&dest, &binary) {
        rollback(&dest, parked.as_deref());
        return Err(e);
    }
    match probe_version(&binary, &source.role) {
        Ok(text) if !text.trim().is_empty() => {}
        Ok(_) => {
            rollback(&dest, parked.as_deref());
            return Err(format!("{} printed no version; install rejected", binary.display()));
        }
        Err(e) => {
            rollback(&dest, parked.as_deref());
            return Err(e);
        }
    }
    let sha256 = match runtime_manifest::hash_file(&binary) {
        Ok(hash) => hash,
        Err(e) => {
            rollback(&dest, parked.as_deref());
            return Err(e);
        }
    };
    if let Some(parked) = parked {
        let _ = fs::remove_dir_all(parked);
    }

    Ok(RuntimeComponent {
        role: source.role.clone(),
        version: source.version.clone(),
        binary: binary.to_string_lossy().into_owned(),
        sha256,
        source: source.id.clone(),
        arch: std::env::consts::ARCH.to_string(),
        installed_at: runtime_manifest::now_rfc3339(),
        selected: true,
    })
}

/// Move an existing version directory aside so a failed install can put it back.
fn park_existing(dest: &Path) -> Result<Option<PathBuf>, String> {
    if !dest.is_dir() {
        return Ok(None);
    }
    let name = dest
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "version".to_string());
    let parked = dest.with_file_name(format!(
        "{name}.replaced-{}",
        chrono::Utc::now().timestamp_millis()
    ));
    fs::rename(dest, &parked).map_err(|e| format!("park {}: {e}", dest.display()))?;
    Ok(Some(parked))
}

/// Drop a failed install and put back whatever it replaced.
fn rollback(dest: &Path, parked: Option<&Path>) {
    let _ = fs::remove_dir_all(dest);
    if let Some(parked) = parked {
        let _ = fs::rename(parked, dest);
    }
}

/// Move a staged tree into place, falling back to a copy when the staging area
/// is on another filesystem (rename then fails with EXDEV).
fn move_tree(src: &Path, dst: &Path) -> Result<(), String> {
    match fs::rename(src, dst) {
        Ok(()) => Ok(()),
        Err(_) => {
            copy_tree(src, dst)?;
            fs::remove_dir_all(src).map_err(|e| format!("remove staged {}: {e}", src.display()))
        }
    }
}

fn copy_tree(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("mkdir {}: {e}", dst.display()))?;
    for entry in fs::read_dir(src).map_err(|e| format!("read_dir {}: {e}", src.display()))? {
        let entry = entry.map_err(|e| format!("read_dir entry: {e}"))?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        let kind = entry
            .file_type()
            .map_err(|e| format!("file_type {}: {e}", from.display()))?;
        if kind.is_dir() {
            copy_tree(&from, &to)?;
        } else if kind.is_file() {
            fs::copy(&from, &to)
                .map_err(|e| format!("copy {} to {}: {e}", from.display(), to.display()))?;
        }
    }
    Ok(())
}

/// Version probe used as the install smoke test. nginx prints its version on
/// stderr while the other roles use stdout, so both streams are concatenated.
fn probe_version(binary: &Path, role: &str) -> Result<String, String> {
    let arg = match role {
        "nginx" | "php" => "-v",
        _ => "--version",
    };
    let out = Command::new(binary)
        .arg(arg)
        .output()
        .map_err(|e| format!("run {} {arg}: {e}", binary.display()))?;
    let mut text = String::from_utf8_lossy(&out.stdout).into_owned();
    text.push_str(&String::from_utf8_lossy(&out.stderr));
    if !out.status.success() {
        return Err(format!(
            "{} {arg} exited with {}: {}",
            binary.display(),
            out.status,
            text.trim()
        ));
    }
    Ok(text)
}

/// Point every dylib reference that leaves the version directory at the copy
/// inside it, then re-sign: rewriting load commands invalidates the signature.
///
/// Same treatment as `provision.rs::relink_absolute_dylibs`; the two must
/// converge on one helper rather than drift apart.
#[cfg(target_os = "macos")]
fn relink_outside_refs(dest: &Path, primary: &Path) -> Result<Vec<String>, String> {
    // Every rewrite points at a sibling `lib/`, so without one there is nothing
    // to do and no reason to require the Xcode command line tools. Static builds
    // (PHP, nginx, dnsmasq) and redis (which resolves via @executable_path)
    // install untouched on a machine that has never run xcode-select.
    let lib_dir = dest.join("lib");
    if !lib_dir.is_dir() {
        return Ok(Vec::new());
    }
    let candidates = mach_o_candidates(dest, primary);
    if candidates.is_empty() {
        return Ok(Vec::new());
    }
    let install_name_tool = find_tool("install_name_tool").ok_or_else(|| {
        "install_name_tool not found in PATH; cannot relink the downloaded binaries \
         (install the Xcode command line tools)"
            .to_string()
    })?;
    let otool = find_tool("otool").ok_or_else(|| {
        "otool not found in PATH; cannot inspect the downloaded binaries \
         (install the Xcode command line tools)"
            .to_string()
    })?;
    let codesign = find_tool("codesign")
        .ok_or_else(|| "codesign not found in PATH; cannot re-sign relinked binaries".to_string())?;

    let mut relinked = Vec::new();
    for binary in candidates {
        let mut seen = std::collections::HashSet::new();
        let mut changed = false;
        for dep in otool_dependencies(&otool, &binary)? {
            if !seen.insert(dep.clone()) {
                continue;
            }
            let Some(replacement) = loader_ref(&binary, &lib_dir, &dep) else {
                continue;
            };
            let out = Command::new(&install_name_tool)
                .arg("-change")
                .arg(&dep)
                .arg(&replacement)
                .arg(&binary)
                .output()
                .map_err(|e| format!("run install_name_tool on {}: {e}", binary.display()))?;
            if !out.status.success() {
                return Err(format!(
                    "install_name_tool failed on {}: {}",
                    binary.display(),
                    String::from_utf8_lossy(&out.stderr).trim()
                ));
            }
            changed = true;
        }
        if !changed {
            continue;
        }
        let out = Command::new(&codesign)
            .arg("--force")
            .arg("-s")
            .arg("-")
            .arg(&binary)
            .output()
            .map_err(|e| format!("run codesign on {}: {e}", binary.display()))?;
        if !out.status.success() {
            return Err(format!(
                "codesign failed on {}: {}",
                binary.display(),
                String::from_utf8_lossy(&out.stderr).trim()
            ));
        }
        relinked.push(binary.to_string_lossy().into_owned());
    }
    Ok(relinked)
}

#[cfg(not(target_os = "macos"))]
fn relink_outside_refs(_dest: &Path, _primary: &Path) -> Result<Vec<String>, String> {
    // These sources are macOS builds; there is nothing to relink elsewhere.
    Ok(Vec::new())
}

/// `@loader_path` reference for a dylib that ships inside the version dir, or
/// `None` when the reference is already relative or has no local counterpart.
#[cfg(target_os = "macos")]
fn loader_ref(owner: &Path, lib_dir: &Path, dep: &str) -> Option<String> {
    const PREFIX: &str = "@@HOMEBREW_PREFIX@@";
    let from_homebrew = dep.starts_with(PREFIX);
    if dep.starts_with('@') && !from_homebrew {
        return None;
    }
    let path = Path::new(dep.strip_prefix(PREFIX).unwrap_or(dep));
    if !from_homebrew && !path.is_absolute() {
        return None;
    }
    if path.starts_with(lib_dir) {
        return None;
    }
    let name = path.file_name()?.to_string_lossy().into_owned();
    if !lib_dir.join(&name).is_file() {
        return None;
    }
    let rel = relative_from(owner.parent()?, lib_dir)?;
    Some(if rel == "." {
        format!("@loader_path/{name}")
    } else {
        format!("@loader_path/{rel}/{name}")
    })
}

/// Relative walk from `from_dir` down to `to_dir`, both absolute.
#[cfg(target_os = "macos")]
fn relative_from(from_dir: &Path, to_dir: &Path) -> Option<String> {
    let from: Vec<Component> = from_dir.components().collect();
    let to: Vec<Component> = to_dir.components().collect();
    let common = from
        .iter()
        .zip(to.iter())
        .take_while(|(a, b)| a == b)
        .count();
    if common == 0 {
        return None;
    }
    let mut parts: Vec<String> = Vec::new();
    for _ in common..from.len() {
        parts.push("..".to_string());
    }
    for component in &to[common..] {
        parts.push(component.as_os_str().to_string_lossy().into_owned());
    }
    Some(if parts.is_empty() {
        ".".to_string()
    } else {
        parts.join("/")
    })
}

/// Executables and dylibs worth inspecting. Every catalog layout keeps them in
/// bin/, sbin/, or lib/; the primary's own directory is added for archives that
/// wrap everything in a top-level folder.
#[cfg(target_os = "macos")]
fn mach_o_candidates(dest: &Path, primary: &Path) -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = ["bin", "sbin", "lib"]
        .iter()
        .map(|sub| dest.join(sub))
        .collect();
    if let Some(parent) = primary.parent() {
        roots.push(parent.to_path_buf());
    }
    let mut out = Vec::new();
    for root in roots {
        collect_mach_o(&root, &mut out);
    }
    if is_mach_o(primary) && !out.iter().any(|p| p == primary) {
        out.push(primary.to_path_buf());
    }
    out
}

#[cfg(target_os = "macos")]
fn collect_mach_o(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_dir() {
            collect_mach_o(&path, out);
        } else if kind.is_file() && is_mach_o(&path) {
            out.push(path);
        }
    }
}

#[cfg(target_os = "macos")]
fn is_mach_o(path: &Path) -> bool {
    let Ok(mut file) = fs::File::open(path) else {
        return false;
    };
    let mut magic = [0u8; 4];
    if file.read_exact(&mut magic).is_err() {
        return false;
    }
    matches!(
        &magic,
        [0xcf, 0xfa, 0xed, 0xfe]
            | [0xfe, 0xed, 0xfa, 0xcf]
            | [0xce, 0xfa, 0xed, 0xfe]
            | [0xfe, 0xed, 0xfa, 0xce]
            | [0xca, 0xfe, 0xba, 0xbe]
    )
}

/// Dylib references reported by `otool -L`. Non-Mach-O files yield no refs.
#[cfg(target_os = "macos")]
fn otool_dependencies(otool: &Path, binary: &Path) -> Result<Vec<String>, String> {
    let out = Command::new(otool)
        .arg("-L")
        .arg(binary)
        .output()
        .map_err(|e| format!("run otool on {}: {e}", binary.display()))?;
    if !out.status.success() {
        return Ok(Vec::new());
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let mut deps = Vec::new();
    for (index, line) in text.lines().enumerate() {
        // Line 0 is the file itself, not a dependency.
        if index == 0 {
            continue;
        }
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let path = line.split(" (").next().unwrap_or(line).trim();
        if !path.is_empty() {
            deps.push(path.to_string());
        }
    }
    Ok(deps)
}

#[cfg(target_os = "macos")]
fn find_tool(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(name))
        .find(|p| p.is_file())
}

/// Remove a component and its version directory.
///
/// Refuses to remove the selected version when it is the only one for its role,
/// because that would leave the role with nothing to run.
pub fn uninstall(runtime_root: &Path, role: &str, version: &str) -> Result<RuntimeManifest, String> {
    let mut manifest = runtime_manifest::load(runtime_root);
    let Some(component) = manifest
        .components
        .iter()
        .find(|c| c.role == role && c.version == version)
        .cloned()
    else {
        return Err(format!("{role} {version} is not installed"));
    };
    if component.selected && manifest.for_role(role).len() <= 1 {
        return Err(format!(
            "{role} {version} is the selected and only {role} install; install or select another \
             version first"
        ));
    }

    let dir = runtime_manifest::component_dir(runtime_root, role, version);
    if dir.is_dir() {
        fs::remove_dir_all(&dir).map_err(|e| format!("remove {}: {e}", dir.display()))?;
    }
    manifest.remove(role, version);
    if component.selected {
        // Keep the one-selected-per-role invariant when its holder goes away.
        let next = manifest.for_role(role).first().map(|c| c.version.clone());
        if let Some(next) = next {
            for c in manifest.components.iter_mut() {
                if c.role == role {
                    c.selected = c.version == next;
                }
            }
        }
    }
    runtime_manifest::save(runtime_root, &manifest)?;
    Ok(manifest)
}

/// Catalog of runtime binaries the user can install or update to.
#[tauri::command]
pub async fn ld_runtime_sources() -> Result<Vec<UpdateSource>, String> {
    resolve_catalog().await
}

/// Download, verify, extract, and install one catalog source.
#[tauri::command]
pub async fn ld_runtime_install(source_id: String) -> Result<RuntimeComponent, String> {
    let sources = resolve_catalog().await?;
    let source = find_source(&sources, &source_id)
        .ok_or_else(|| format!("unknown runtime source: {source_id}"))?
        .clone();
    if source.url.trim().is_empty() {
        return Err(format!("{} is unavailable: {}", source.label, source.note));
    }

    let runtime_root = PathBuf::from(build_runtime_paths()?.runtime);
    let staging = runtime_root.join(STAGING_DIR).join(sanitize(&source.id));
    let _ = fs::remove_dir_all(&staging);
    fs::create_dir_all(&staging).map_err(|e| format!("mkdir {}: {e}", staging.display()))?;

    let archive = match download(&source, &staging, &mut |_bytes: u64, _total: Option<u64>| {}).await
    {
        Ok(path) => path,
        Err(e) => {
            let _ = fs::remove_dir_all(&staging);
            return Err(e);
        }
    };
    let extract_dir = staging.join("extracted");
    let staged_binary = match extract(
        &archive,
        source.archive,
        &extract_dir,
        binary_hint(&source.role),
    ) {
        Ok(path) => path,
        Err(e) => {
            let _ = fs::remove_dir_all(&staging);
            return Err(e);
        }
    };
    let binary_rel = staged_binary
        .strip_prefix(&extract_dir)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();

    // Unpacking MariaDB and relinking its 87 executables is blocking work.
    let root = runtime_root.clone();
    let task_source = source.clone();
    let task_binary = staged_binary.clone();
    let task_root = extract_dir.clone();
    let installed = tokio::task::spawn_blocking(move || {
        install(&root, &task_source, &task_binary, &task_root, &binary_rel)
    })
    .await
    .map_err(|e| format!("ld_runtime_install task failed: {e}"))?;

    let component = match installed {
        Ok(component) => component,
        Err(e) => {
            let _ = fs::remove_dir_all(&staging);
            return Err(e);
        }
    };

    // Exactly one component per role is selected, so a fresh install wins.
    let mut manifest = runtime_manifest::load(&runtime_root);
    for existing in manifest.components.iter_mut() {
        if existing.role == component.role {
            existing.selected = false;
        }
    }
    manifest.upsert(component.clone());
    if let Err(e) = runtime_manifest::save(&runtime_root, &manifest) {
        let _ = fs::remove_dir_all(&staging);
        return Err(e);
    }
    let _ = fs::remove_dir_all(&staging);
    Ok(component)
}

/// Remove an installed component and its version directory.
#[tauri::command]
pub async fn ld_runtime_uninstall(role: String, version: String) -> Result<RuntimeManifest, String> {
    let runtime_root = PathBuf::from(build_runtime_paths()?.runtime);
    tokio::task::spawn_blocking(move || uninstall(&runtime_root, &role, &version))
        .await
        .map_err(|e| format!("ld_runtime_uninstall task failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "badami-runtime-updater-{name}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Build a one-entry tar.gz whose header name is written verbatim, so a
    /// hostile name survives the builder's own path validation.
    fn tar_gz_with(dir: &Path, file_name: &str, entry_name: &str, body: &[u8]) -> PathBuf {
        let path = dir.join(file_name);
        let file = fs::File::create(&path).unwrap();
        let encoder = flate2::write::GzEncoder::new(file, flate2::Compression::fast());
        let mut builder = tar::Builder::new(encoder);
        let mut header = tar::Header::new_old();
        let bytes = entry_name.as_bytes();
        header.as_old_mut().name[..bytes.len()].copy_from_slice(bytes);
        header.set_size(body.len() as u64);
        header.set_mode(0o644);
        header.set_cksum();
        builder.append(&header, body).unwrap();
        builder.into_inner().unwrap().finish().unwrap();
        path
    }

    fn write_component(root: &Path, role: &str, version: &str, selected: bool) -> RuntimeComponent {
        let binary = runtime_manifest::component_dir(root, role, version)
            .join("bin")
            .join("server");
        fs::create_dir_all(binary.parent().unwrap()).unwrap();
        fs::write(&binary, format!("{role} {version}")).unwrap();
        RuntimeComponent {
            role: role.to_string(),
            version: version.to_string(),
            binary: binary.to_string_lossy().into_owned(),
            sha256: runtime_manifest::hash_file(&binary).unwrap(),
            source: "manual".to_string(),
            arch: std::env::consts::ARCH.to_string(),
            installed_at: runtime_manifest::now_rfc3339(),
            selected,
        }
    }

    /// Stand-in for a downloaded binary: prints a version line so the smoke
    /// test passes on `exit_code == 0`, and exits non-zero otherwise.
    fn staged_script(root: &Path, name: &str, exit_code: u8) -> (PathBuf, PathBuf) {
        let staged_root = root.join("extracted");
        let binary = staged_root.join("bin").join(name);
        fs::create_dir_all(binary.parent().unwrap()).unwrap();
        fs::write(
            &binary,
            format!("#!/bin/sh\necho \"{name} 1.0\"\nexit {exit_code}\n"),
        )
        .unwrap();
        (staged_root, binary)
    }

    fn source_for(role: &str, version: &str) -> UpdateSource {
        UpdateSource {
            id: "manual-test".to_string(),
            label: "test".to_string(),
            role: role.to_string(),
            url: String::new(),
            version: version.to_string(),
            archive: ArchiveKind::Zip,
            sha256: None,
            note: String::new(),
        }
    }

    #[test]
    fn php_74_is_reported_unavailable_instead_of_attempted() {
        let catalog = catalog();
        let entry = find_source(&catalog, "static-php-cli-php-7.4").expect("7.4 must be listed");
        assert!(entry.url.is_empty(), "7.4 has no upstream URL");
        assert_eq!(entry.version, "7.4");
        assert!(
            entry.note.contains("No upstream static build"),
            "the note must state why 7.4 is unavailable: {}",
            entry.note
        );
        assert!(
            !catalog
                .iter()
                .any(|s| s.role == "php" && s.version == "7.4" && !s.url.is_empty()),
            "no php 7.4 entry may be installable"
        );
    }

    #[test]
    fn catalog_only_lists_sources_badami_can_fetch() {
        for source in catalog() {
            assert!(
                source.id.starts_with("static-php-cli-") || source.id.starts_with("homebrew-"),
                "unexpected catalog origin: {}",
                source.id
            );
            if !source.url.is_empty() {
                assert!(
                    source.url.starts_with("https://dl.static-php.dev/")
                        || source.url.starts_with("https://formulae.brew.sh/"),
                    "{} points at an unvetted host: {}",
                    source.id,
                    source.url
                );
            }
        }
        assert!(
            !catalog().iter().any(|s| s.role == "mariadb" || s.role == "redis"),
            "no third-party index may offer MariaDB or Redis"
        );
    }

    #[test]
    fn catalog_never_invents_a_checksum() {
        for source in catalog() {
            match source.sha256.as_deref() {
                Some(digest) => assert_eq!(digest.len(), 64, "{} has a malformed digest", source.id),
                None if !source.url.is_empty() => assert!(
                    source.note.contains("unverified"),
                    "{} must say the download is unverified",
                    source.id
                ),
                None => {}
            }
        }
    }

    #[test]
    fn extract_refuses_a_parent_dir_entry() {
        let dir = test_dir("tar-traversal");
        let archive = tar_gz_with(&dir, "evil.tar.gz", "../evil", b"pwn");
        let dest = dir.join("extract");
        let err = extract(&archive, ArchiveKind::TarGz, &dest, "php-fpm").unwrap_err();
        assert!(err.contains(".."), "{err}");
        assert!(
            !dir.join("evil").exists(),
            "nothing may be written outside the destination"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn extract_refuses_an_absolute_entry() {
        let dir = test_dir("tar-absolute");
        let archive = tar_gz_with(&dir, "abs.tar.gz", "/tmp/badami-evil", b"pwn");
        let dest = dir.join("extract");
        let err = extract(&archive, ArchiveKind::TarGz, &dest, "php-fpm").unwrap_err();
        assert!(err.contains("absolute"), "{err}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn safe_join_rejects_escaping_entry_paths() {
        let dest = Path::new("/tmp/badami-safe-join");
        assert!(safe_join(dest, Path::new("../evil")).is_err());
        assert!(safe_join(dest, Path::new("bin/../../evil")).is_err());
        assert!(safe_join(dest, Path::new("/etc/passwd")).is_err());
        assert!(safe_join(dest, Path::new("")).is_err());
        assert_eq!(
            safe_join(dest, Path::new("bin/redis-server")).unwrap(),
            dest.join("bin/redis-server")
        );
        assert_eq!(
            safe_join(dest, Path::new("./bin/./redis-server")).unwrap(),
            dest.join("bin/redis-server")
        );
    }

    #[test]
    fn checksum_mismatch_discards_the_archive_before_extraction() {
        let dir = test_dir("checksum-mismatch");
        let part = dir.join("mariadb.zip.part");
        fs::write(&part, b"not the archive you asked for").unwrap();
        let final_path = dir.join("mariadb.zip");

        let err = publish_verified(&part, &final_path, Some(&"0".repeat(64)), &"1".repeat(64))
            .unwrap_err();
        assert!(err.contains("checksum mismatch"), "{err}");
        assert!(!part.exists(), "the partial download must be deleted");
        assert!(
            !final_path.exists(),
            "a mismatched archive must never be published for extraction"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn matching_checksum_publishes_the_archive() {
        let dir = test_dir("checksum-ok");
        let part = dir.join("php.tar.gz.part");
        fs::write(&part, b"archive").unwrap();
        let digest = runtime_manifest::hash_file(&part).unwrap();
        let final_path = dir.join("php.tar.gz");

        let published = publish_verified(&part, &final_path, Some(&digest), &digest).unwrap();
        assert_eq!(published, final_path);
        assert!(final_path.is_file());
        assert!(!part.exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn uninstall_refuses_the_selected_and_only_component() {
        let root = test_dir("uninstall-guard");
        let mut manifest = RuntimeManifest::default();
        manifest.upsert(write_component(&root, "redis", "7.4.11", true));
        runtime_manifest::save(&root, &manifest).unwrap();

        let err = uninstall(&root, "redis", "7.4.11").unwrap_err();
        assert!(err.contains("only"), "{err}");
        assert_eq!(runtime_manifest::load(&root).components.len(), 1);
        assert!(runtime_manifest::component_dir(&root, "redis", "7.4.11").is_dir());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn uninstall_of_the_selected_version_promotes_a_survivor() {
        let root = test_dir("uninstall-promote");
        let mut manifest = RuntimeManifest::default();
        manifest.upsert(write_component(&root, "redis", "7.2.14", false));
        manifest.upsert(write_component(&root, "redis", "7.4.11", true));
        runtime_manifest::save(&root, &manifest).unwrap();

        let after = uninstall(&root, "redis", "7.4.11").unwrap();
        assert_eq!(after.components.len(), 1);
        assert_eq!(after.components[0].version, "7.2.14");
        assert!(after.components[0].selected, "the survivor must become selected");
        assert!(!runtime_manifest::component_dir(&root, "redis", "7.4.11").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn uninstall_of_an_unknown_component_errors() {
        let root = test_dir("uninstall-unknown");
        let err = uninstall(&root, "php", "9.9").unwrap_err();
        assert!(err.contains("not installed"), "{err}");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn install_rejects_a_binary_that_fails_its_version_probe() {
        let root = test_dir("install-probe");
        let staging = test_dir("install-probe-staging");
        let (staged_root, staged_binary) = staged_script(&staging, "redis-server", 3);

        let err = install(
            &root,
            &source_for("redis", "7.4.11"),
            &staged_binary,
            &staged_root,
            "bin/redis-server",
        )
        .unwrap_err();
        assert!(err.contains("exited with"), "{err}");
        assert!(
            !runtime_manifest::component_dir(&root, "redis", "7.4.11").exists(),
            "a failed install must leave nothing behind"
        );
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&staging);
    }

    #[test]
    fn a_failed_reinstall_restores_the_previous_version_directory() {
        let root = test_dir("install-rollback");
        let dest = runtime_manifest::component_dir(&root, "redis", "7.4.11");
        fs::create_dir_all(dest.join("bin")).unwrap();
        fs::write(dest.join("bin").join("redis-server"), "#!/bin/sh\nexit 0\n").unwrap();
        fs::write(dest.join("keep.txt"), "previous install").unwrap();

        let staging = test_dir("install-rollback-staging");
        let (staged_root, staged_binary) = staged_script(&staging, "redis-server", 4);

        assert!(install(
            &root,
            &source_for("redis", "7.4.11"),
            &staged_binary,
            &staged_root,
            "bin/redis-server",
        )
        .is_err());
        assert_eq!(
            fs::read_to_string(dest.join("keep.txt")).unwrap(),
            "previous install",
            "the replaced install must come back"
        );
        let leftovers: Vec<String> = fs::read_dir(root.join("redis"))
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|name| name.contains(".replaced-"))
            .collect();
        assert!(leftovers.is_empty(), "no parked directory may survive: {leftovers:?}");
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&staging);
    }

    #[test]
    fn install_marks_the_new_component_selected() {
        let root = test_dir("install-selected");
        let staging = test_dir("install-selected-staging");
        let (staged_root, staged_binary) = staged_script(&staging, "dnsmasq", 0);

        let component = install(
            &root,
            &source_for("dnsmasq", "2.93"),
            &staged_binary,
            &staged_root,
            "bin/dnsmasq",
        )
        .unwrap();
        assert!(component.selected);
        assert_eq!(component.role, "dnsmasq");
        assert_eq!(component.version, "2.93");
        assert!(runtime_manifest::verify(&component));
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&staging);
    }
}
