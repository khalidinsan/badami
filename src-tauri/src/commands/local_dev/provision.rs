//! Badami-owned service binaries under `local-dev/runtime/`.
//!
//! Copies a source tree into `runtime/<role>/<version>/`, relocates dylib
//! references when the binaries need it, and records the result in the
//! manifest so the supervisor can resolve a role without scanning the disk.

use serde::{Deserialize, Serialize};
#[cfg(target_os = "macos")]
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use super::discovery::{self, DiscoveryReport, RuntimePaths};
use super::runtime_manifest::{self, RuntimeComponent, RuntimeManifest};

/// Version used when a binary refuses to report one; the plan still proceeds.
pub const UNKNOWN_VERSION: &str = "unknown";

/// Minimal php.ini Badami writes per PHP tag.
///
/// `extension_dir` is deliberately absent so each static-php-cli build keeps
/// its compiled-in default.
const PHP_INI_BODY: &str = "\
; Badami-managed php.ini. Regenerated on provision; edit at your own risk.
memory_limit=512M
upload_max_filesize=64M
post_max_size=64M
max_execution_time=300
; pcre.jit segfaults on some macOS builds.
pcre.jit=0
date.timezone=UTC
error_reporting=E_ALL
display_errors=On
log_errors=On
";

/// One component the provisioner should copy into Badami's runtime tree.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProvisionItem {
    /// One of `runtime_manifest::ROLES`.
    pub role: String,
    pub version: String,
    /// Manifest `source` label, naming where the copy came from.
    pub source: String,
    /// Directory or file the copy is taken from. Read-only.
    pub source_root: PathBuf,
    /// Path of the primary executable relative to the component dir.
    pub binary_rel: String,
    /// Extra `(source, dest_rel)` copies. When non-empty these are the whole
    /// copy set and `source_root` is used only as provenance and relink base.
    pub extra_roots: Vec<(PathBuf, String)>,
    /// True when absolute dylib references must be rewritten (MariaDB).
    pub needs_relink: bool,
    pub display_name: String,
}

/// `libssl*.dylib` / `libcrypto*.dylib` names sitting in `dir`.
fn redis_dylibs(dir: &Path) -> Vec<String> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut names: Vec<String> = entries
        .flatten()
        .filter_map(|e| e.file_name().to_str().map(str::to_string))
        .filter(|n| {
            (n.starts_with("libssl") || n.starts_with("libcrypto"))
                && (n.ends_with(".dylib") || n.ends_with(".so"))
        })
        .collect();
    names.sort();
    names
}

fn file_name_of(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "binary".to_string())
}

/// Run `<bin> <args>` and hand stdout+stderr to `parse`.
///
/// nginx prints its version on stderr, dnsmasq and redis on stdout, so both
/// streams are concatenated before parsing.
fn detect_version(bin: &Path, args: &[&str], parse: fn(&str) -> Option<String>) -> Option<String> {
    let out = Command::new(bin).args(args).output().ok()?;
    let mut text = String::from_utf8_lossy(&out.stdout).to_string();
    text.push_str(&String::from_utf8_lossy(&out.stderr));
    parse(&text)
}

fn parse_nginx_version(text: &str) -> Option<String> {
    let idx = text.find("nginx/")?;
    let v = take_version_chars(&text[idx + "nginx/".len()..]);
    (!v.is_empty()).then_some(v)
}

fn parse_dnsmasq_version(text: &str) -> Option<String> {
    let idx = text.find("version ")?;
    let v = take_version_chars(&text[idx + "version ".len()..]);
    (!v.is_empty()).then_some(v)
}

fn parse_redis_version(text: &str) -> Option<String> {
    let idx = text.find("v=")?;
    let v = take_version_chars(&text[idx + 2..]);
    (!v.is_empty()).then_some(v)
}

fn take_version_chars(s: &str) -> String {
    s.chars()
        .take_while(|c| c.is_ascii_digit() || *c == '.')
        .collect()
}

/// Copy one planned component into `runtime/<role>/<version>/` and describe it.
pub fn provision_component(
    runtime_root: &Path,
    item: &ProvisionItem,
) -> Result<RuntimeComponent, String> {
    provision_component_inner(runtime_root, item).map(|(component, _relinked)| component)
}

/// [`provision_component`] plus the list of binaries whose dylib references
/// were rewritten, so the caller can report what the relink pass touched.
fn provision_component_inner(
    runtime_root: &Path,
    item: &ProvisionItem,
) -> Result<(RuntimeComponent, Vec<String>), String> {
    if item.role.trim().is_empty() || item.version.trim().is_empty() {
        return Err("component needs a role and version".to_string());
    }
    let dest = runtime_manifest::component_dir(runtime_root, &item.role, &item.version);

    // A retry after a partial copy must not merge old and new files.
    if dest.is_dir() {
        let non_empty = fs::read_dir(&dest)
            .map_err(|e| format!("read_dir {}: {e}", dest.display()))?
            .next()
            .is_some();
        if non_empty {
            fs::remove_dir_all(&dest)
                .map_err(|e| format!("remove {}: {e}", dest.display()))?;
        }
    }
    fs::create_dir_all(&dest).map_err(|e| format!("mkdir {}: {e}", dest.display()))?;

    let mut copied = 0usize;
    if item.extra_roots.is_empty() {
        copy_entry(&item.source_root, &dest, &item.binary_rel, &mut copied)?;
    } else {
        for (src, rel) in &item.extra_roots {
            copy_entry(src, &dest, rel, &mut copied)?;
        }
    }
    if copied == 0 {
        return Err(format!(
            "nothing copied for {} {}",
            item.role, item.version
        ));
    }

    let relinked = if item.needs_relink {
        relink_absolute_dylibs(&dest, &item.source_root)?
    } else {
        Vec::new()
    };

    let binary = dest.join(&item.binary_rel);
    if !binary.is_file() {
        return Err(format!(
            "expected binary missing after copy: {}",
            binary.display()
        ));
    }
    let sha256 = runtime_manifest::hash_file(&binary)?;

    Ok((
        RuntimeComponent {
            role: item.role.clone(),
            version: item.version.clone(),
            binary: binary.to_string_lossy().to_string(),
            sha256,
            source: if item.source.trim().is_empty() {
                "local-copy".to_string()
            } else {
                item.source.clone()
            },
            arch: std::env::consts::ARCH.to_string(),
            installed_at: runtime_manifest::now_rfc3339(),
            selected: false,
        },
        relinked,
    ))
}

/// Copy one source file or directory into `dest/<rel>`.
fn copy_entry(src: &Path, dest: &Path, rel: &str, copied: &mut usize) -> Result<(), String> {
    let to = if rel.is_empty() {
        dest.to_path_buf()
    } else {
        dest.join(rel)
    };
    if src.is_dir() {
        return copy_tree(src, &to, copied);
    }
    if !src.is_file() {
        return Err(format!("source missing: {}", src.display()));
    }
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
    }
    fs::copy(src, &to).map_err(|e| format!("copy {} to {}: {e}", src.display(), to.display()))?;
    *copied += 1;
    Ok(())
}

/// Recursively copy `src` into `dst`, overwriting files and creating parents.
fn copy_tree(src: &Path, dst: &Path, count: &mut usize) -> Result<(), String> {
    if !src.is_dir() {
        return Err(format!("not a directory: {}", src.display()));
    }
    fs::create_dir_all(dst).map_err(|e| format!("mkdir {}: {e}", dst.display()))?;

    for entry in fs::read_dir(src).map_err(|e| format!("read_dir {}: {e}", src.display()))? {
        let entry = entry.map_err(|e| format!("read_dir entry: {e}"))?;
        let ft = entry.file_type().map_err(|e| format!("file_type: {e}"))?;
        let from = entry.path();
        let to = dst.join(entry.file_name());

        if ft.is_symlink() {
            // Client aliases are often symlinks; follow file links, skip dir
            // links so a cycle can never spin the copy.
            let meta = fs::metadata(&from).map_err(|e| format!("stat {}: {e}", from.display()))?;
            if meta.is_file() {
                copy_entry(&from, dst, &entry.file_name().to_string_lossy(), count)?;
            }
            continue;
        }
        if ft.is_dir() {
            copy_tree(&from, &to, count)?;
        } else if ft.is_file() {
            if let Some(parent) = to.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
            }
            fs::copy(&from, &to)
                .map_err(|e| format!("copy {} to {}: {e}", from.display(), to.display()))?;
            *count += 1;
        }
    }
    Ok(())
}

/// Rewrite absolute dylib references under `dest/bin` to `@loader_path` form.
///
/// MariaDB links `libssl`/`libcrypto` by absolute path, so the copy is
/// broken until every reference is retargeted at the sibling `lib/` dir and
/// the (now invalid) signature is replaced with an ad-hoc one.
#[cfg(target_os = "macos")]
fn relink_absolute_dylibs(dest: &Path, basedir: &Path) -> Result<Vec<String>, String> {
    let install_name_tool = find_tool("install_name_tool").ok_or_else(|| {
        "install_name_tool not found in PATH; cannot relink MariaDB \
         (install the Xcode command line tools)"
            .to_string()
    })?;
    let otool = find_tool("otool").ok_or_else(|| {
        "otool not found in PATH; cannot inspect MariaDB dylib references \
         (install the Xcode command line tools)"
            .to_string()
    })?;
    let codesign = find_tool("codesign").ok_or_else(|| {
        "codesign not found in PATH; cannot re-sign relinked MariaDB binaries".to_string()
    })?;

    let bin_dir = dest.join("bin");
    if !bin_dir.is_dir() {
        return Err(format!("no bin/ directory to relink in {}", dest.display()));
    }
    let base = basedir.to_string_lossy().to_string();
    if base.is_empty() {
        return Err("cannot relink without a source basedir".to_string());
    }

    let mut relinked = Vec::new();
    let entries = fs::read_dir(&bin_dir).map_err(|e| format!("read_dir {}: {e}", bin_dir.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("read_dir entry: {e}"))?;
        if !entry.file_type().map_err(|e| format!("file_type: {e}"))?.is_file() {
            continue;
        }
        let bin = entry.path();
        let deps = otool_dependencies(&otool, &bin)?;
        let mut seen = HashSet::new();
        let mut changed = false;
        for dep in deps {
            if !dep.starts_with(&base) || !seen.insert(dep.clone()) {
                continue;
            }
            let Some(name) = Path::new(&dep).file_name().map(|n| n.to_string_lossy().to_string())
            else {
                continue;
            };
            let new_ref = format!("@loader_path/../lib/{name}");
            let out = Command::new(&install_name_tool)
                .arg("-change")
                .arg(&dep)
                .arg(&new_ref)
                .arg(&bin)
                .output()
                .map_err(|e| format!("run install_name_tool on {}: {e}", bin.display()))?;
            if !out.status.success() {
                return Err(format!(
                    "install_name_tool failed on {}: {}",
                    bin.display(),
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
            .arg(&bin)
            .output()
            .map_err(|e| format!("run codesign on {}: {e}", bin.display()))?;
        if !out.status.success() {
            return Err(format!(
                "codesign failed on {}: {}",
                bin.display(),
                String::from_utf8_lossy(&out.stderr).trim()
            ));
        }
        relinked.push(bin.to_string_lossy().to_string());
    }
    Ok(relinked)
}

#[cfg(not(target_os = "macos"))]
fn relink_absolute_dylibs(dest: &Path, _basedir: &Path) -> Result<Vec<String>, String> {
    Err(format!(
        "relinking is only supported on macOS (requested for {})",
        dest.display()
    ))
}

/// Dylib references reported by `otool -L`. Non-Mach-O files yield an empty list.
#[cfg(target_os = "macos")]
fn otool_dependencies(otool: &Path, bin: &Path) -> Result<Vec<String>, String> {
    let out = Command::new(otool)
        .arg("-L")
        .arg(bin)
        .output()
        .map_err(|e| format!("run otool on {}: {e}", bin.display()))?;
    if !out.status.success() {
        return Ok(Vec::new());
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let mut deps = Vec::new();
    for (i, line) in text.lines().enumerate() {
        if i == 0 {
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProvisionOutcome {
    pub role: String,
    pub version: String,
    pub ok: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProvisionReport {
    pub outcomes: Vec<ProvisionOutcome>,
    pub manifest: RuntimeManifest,
    pub notes: Vec<String>,
}

/// Provision every item, streaming a status line before each one.
///
/// One failing role never aborts the others; failures land in `outcomes` with
/// the error string. The manifest is saved exactly once, at the end.
pub fn provision_all(
    runtime_root: &Path,
    items: &[ProvisionItem],
    progress: &mut dyn FnMut(&str),
) -> ProvisionReport {
    let mut manifest = runtime_manifest::load(runtime_root);
    let mut outcomes = Vec::with_capacity(items.len());
    let mut notes = Vec::new();

    for item in items {
        progress(&format!(
            "Copying {} {} from {}",
            item.display_name,
            item.version,
            item.source_root.display()
        ));
        match provision_component_inner(runtime_root, item) {
            Ok((mut component, relinked)) => {
                // Re-provisioning the running version must not drop its selection.
                if let Some(previous) = manifest
                    .components
                    .iter()
                    .find(|c| c.role == component.role && c.version == component.version)
                {
                    component.selected = previous.selected;
                }
                for bin in &relinked {
                    notes.push(format!("relinked dylib references in {bin}"));
                }
                progress(&format!("{} {} ready", item.display_name, item.version));
                manifest.upsert(component);
                outcomes.push(ProvisionOutcome {
                    role: item.role.clone(),
                    version: item.version.clone(),
                    ok: true,
                    error: None,
                });
            }
            Err(err) => {
                progress(&format!(
                    "{} {} failed: {err}",
                    item.display_name, item.version
                ));
                notes.push(format!("{} {}: {err}", item.role, item.version));
                outcomes.push(ProvisionOutcome {
                    role: item.role.clone(),
                    version: item.version.clone(),
                    ok: false,
                    error: Some(err),
                });
            }
        }
    }

    manifest.updated_at = runtime_manifest::now_rfc3339();
    if let Err(e) = runtime_manifest::save(runtime_root, &manifest) {
        notes.push(format!("manifest save failed: {e}"));
    }

    ProvisionReport {
        outcomes,
        manifest,
        notes,
    }
}

/// Mark one role/version as the one the supervisor should run.
pub fn select_version(
    runtime_root: &Path,
    role: &str,
    version: &str,
) -> Result<RuntimeManifest, String> {
    let mut manifest = runtime_manifest::load(runtime_root);
    let present = manifest
        .components
        .iter()
        .any(|c| c.role == role && c.version == version);
    if !present {
        return Err(format!("{role} {version} is not provisioned"));
    }
    for component in manifest.components.iter_mut() {
        if component.role == role {
            component.selected = component.version == version;
        }
    }
    runtime_manifest::save(runtime_root, &manifest)?;
    Ok(manifest)
}

/// Write `<php_config>/<tag>/php.ini` and return the file path.
///
/// `tag` is the dotted version with the dot stripped (`7.4` -> `74`), which is
/// also the value `PHP_INI_SCAN_DIR` points at.
pub fn write_php_ini(paths: &RuntimePaths, tag: &str) -> Result<PathBuf, String> {
    if tag.trim().is_empty() {
        return Err("php tag is empty".to_string());
    }
    let dir = PathBuf::from(&paths.php_config).join(tag);
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir {}: {e}", dir.display()))?;
    let path = dir.join("php.ini");
    fs::write(&path, PHP_INI_BODY).map_err(|e| format!("write {}: {e}", path.display()))?;
    Ok(path)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledVersion {
    pub version: String,
    pub selected: bool,
    pub verified: bool,
    pub binary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoleStatus {
    pub role: String,
    pub installed: Vec<InstalledVersion>,
    pub missing_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProvisionStatus {
    pub manifest: RuntimeManifest,
    pub roles: Vec<RoleStatus>,
    pub notes: Vec<String>,
}

/// What Badami currently owns, per role, with per-binary verification.
pub fn status(runtime_root: &Path) -> ProvisionStatus {
    let manifest = runtime_manifest::load(runtime_root);
    let mut roles = Vec::with_capacity(runtime_manifest::ROLES.len());
    let mut notes = Vec::new();

    for role in runtime_manifest::ROLES {
        let components = manifest.for_role(role);
        if components.is_empty() {
            roles.push(RoleStatus {
                role: (*role).to_string(),
                installed: Vec::new(),
                missing_reason: Some(format!("no Badami-owned {role} yet")),
            });
            continue;
        }
        // The supervisor resolves a role through `selected_for`, which falls
        // back to the newest version when nothing is pinned. Report that same
        // answer here, or the UI would show no version as in use while one is
        // actually running.
        let effective = manifest.selected_for(role, None).map(|c| c.version.clone());
        let mut installed = Vec::with_capacity(components.len());
        for component in components {
            let verified = runtime_manifest::verify(component);
            if !verified {
                notes.push(format!(
                    "{} {} binary failed verification",
                    component.role, component.version
                ));
            }
            installed.push(InstalledVersion {
                version: component.version.clone(),
                selected: effective.as_deref() == Some(component.version.as_str()),
                verified,
                binary: component.binary.clone(),
            });
        }
        roles.push(RoleStatus {
            role: (*role).to_string(),
            installed,
            missing_reason: None,
        });
    }

    ProvisionStatus {
        manifest,
        roles,
        notes,
    }
}

/// Current Badami-owned runtime inventory per role.
#[tauri::command]
pub async fn ld_provision_status() -> Result<ProvisionStatus, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let paths = discovery::build_runtime_paths()?;
        Ok(status(Path::new(&paths.runtime)))
    })
    .await
    .map_err(|e| format!("ld_provision_status task failed: {e}"))?
}

/// Choose the version a role should run.
#[tauri::command]
pub async fn ld_provision_select(role: String, version: String) -> Result<RuntimeManifest, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let paths = discovery::build_runtime_paths()?;
        select_version(Path::new(&paths.runtime), &role, &version)
    })
    .await
    .map_err(|e| format!("ld_provision_select task failed: {e}"))?
}

/// Write the per-tag php.ini and return its absolute path.
#[tauri::command]
pub async fn ld_provision_write_php_ini(tag: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let paths = discovery::build_runtime_paths()?;
        let path = write_php_ini(&paths, &tag)?;
        Ok(path.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| format!("ld_provision_write_php_ini task failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::discovery::runtime_paths_from_root;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_dir(label: &str) -> PathBuf {
        let n = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        std::env::temp_dir().join(format!("badami-provision-{label}-{n}"))
    }

    fn fake_component(root: &Path, role: &str, version: &str, selected: bool) -> RuntimeComponent {
        let dir = root.join(role).join(version);
        fs::create_dir_all(&dir).unwrap();
        let bin = dir.join("binary");
        fs::write(&bin, format!("{role}-{version}")).unwrap();
        RuntimeComponent {
            role: role.to_string(),
            version: version.to_string(),
            binary: bin.to_string_lossy().to_string(),
            sha256: runtime_manifest::hash_file(&bin).unwrap(),
            source: "local-copy".to_string(),
            arch: std::env::consts::ARCH.to_string(),
            installed_at: runtime_manifest::now_rfc3339(),
            selected,
        }
    }

    fn file_item(source: &Path, role: &str, version: &str) -> ProvisionItem {
        ProvisionItem {
            role: role.to_string(),
            version: version.to_string(),
            source: "local-copy".to_string(),
            source_root: source.to_path_buf(),
            binary_rel: file_name_of(source),
            extra_roots: Vec::new(),
            needs_relink: false,
            display_name: role.to_string(),
        }
    }

    #[test]
    fn provision_component_copies_and_hashes() {
        let root = unique_dir("copy");
        let _ = fs::remove_dir_all(&root);
        let src = root.join("src").join("nginx-arm64");
        fs::create_dir_all(src.parent().unwrap()).unwrap();
        fs::write(&src, b"fake nginx binary").unwrap();

        let runtime_root = root.join("runtime");
        let component = provision_component(&runtime_root, &file_item(&src, "nginx", "1.25.4")).unwrap();

        let dest = runtime_root.join("nginx").join("1.25.4").join("nginx-arm64");
        assert!(dest.is_file());
        assert_eq!(fs::read(&dest).unwrap(), b"fake nginx binary");
        assert_eq!(component.binary, dest.to_string_lossy());
        assert_eq!(component.sha256, runtime_manifest::hash_file(&src).unwrap());
        assert_eq!(component.source, "local-copy");
        assert!(!component.selected);
        assert!(runtime_manifest::verify(&component));

        // Nothing is written to the manifest until provision_all saves it.
        assert!(runtime_manifest::load(&runtime_root).components.is_empty());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn provision_component_clears_partial_directory() {
        let root = unique_dir("retry");
        let _ = fs::remove_dir_all(&root);
        let src = root.join("src").join("dnsmasq-arm64");
        fs::create_dir_all(src.parent().unwrap()).unwrap();
        fs::write(&src, b"fresh").unwrap();

        let runtime_root = root.join("runtime");
        let stale = runtime_root.join("dnsmasq").join("2.90");
        fs::create_dir_all(&stale).unwrap();
        fs::write(stale.join("leftover"), b"junk").unwrap();

        provision_component(&runtime_root, &file_item(&src, "dnsmasq", "2.90")).unwrap();

        assert!(!stale.join("leftover").exists());
        assert_eq!(fs::read(stale.join("dnsmasq-arm64")).unwrap(), b"fresh");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn provision_component_copies_extra_roots() {
        let root = unique_dir("extra");
        let _ = fs::remove_dir_all(&root);
        let src_dir = root.join("php-bin");
        fs::create_dir_all(&src_dir).unwrap();
        fs::write(src_dir.join("php74"), b"cli").unwrap();
        fs::write(src_dir.join("php74-fpm"), b"fpm").unwrap();

        let runtime_root = root.join("runtime");
        let item = ProvisionItem {
            role: "php".into(),
            version: "7.4".into(),
            source: "local-copy".into(),
            source_root: src_dir.clone(),
            binary_rel: "php74-fpm".into(),
            extra_roots: vec![
                (src_dir.join("php74"), "php74".into()),
                (src_dir.join("php74-fpm"), "php74-fpm".into()),
            ],
            needs_relink: false,
            display_name: "PHP 7.4".into(),
        };
        let component = provision_component(&runtime_root, &item).unwrap();
        let dest = runtime_root.join("php").join("7.4");
        assert!(dest.join("php74").is_file());
        assert!(dest.join("php74-fpm").is_file());
        assert_eq!(component.sha256, runtime_manifest::hash_file(&dest.join("php74-fpm")).unwrap());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn select_version_flips_flags() {
        let root = unique_dir("select");
        let _ = fs::remove_dir_all(&root);
        let runtime_root = root.join("runtime");

        let mut manifest = RuntimeManifest::default();
        manifest.upsert(fake_component(&runtime_root, "nginx", "1.25.4", true));
        manifest.upsert(fake_component(&runtime_root, "nginx", "1.27.0", false));
        runtime_manifest::save(&runtime_root, &manifest).unwrap();

        let after = select_version(&runtime_root, "nginx", "1.27.0").unwrap();
        assert!(after.selected_for("nginx", Some("1.27.0")).unwrap().selected);
        assert!(!after.selected_for("nginx", Some("1.25.4")).unwrap().selected);
        assert_eq!(after.for_role("nginx").iter().filter(|c| c.selected).count(), 1);

        // Reload from disk to prove the flag was persisted.
        let reloaded = runtime_manifest::load(&runtime_root);
        assert!(reloaded.selected_for("nginx", Some("1.27.0")).unwrap().selected);
        assert!(select_version(&runtime_root, "nginx", "9.9.9").is_err());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn status_reports_verified_then_unverified_after_tamper() {
        let root = unique_dir("tamper");
        let _ = fs::remove_dir_all(&root);
        let runtime_root = root.join("runtime");

        let component = fake_component(&runtime_root, "nginx", "1.25.4", true);
        let binary = component.binary.clone();
        let mut manifest = RuntimeManifest::default();
        manifest.upsert(component);
        runtime_manifest::save(&runtime_root, &manifest).unwrap();

        let before = status(&runtime_root);
        let nginx = before.roles.iter().find(|r| r.role == "nginx").unwrap();
        assert_eq!(nginx.installed.len(), 1);
        assert!(nginx.installed[0].verified);
        assert!(nginx.installed[0].selected);
        assert!(nginx.missing_reason.is_none());
        assert!(before.notes.is_empty());

        fs::write(&binary, b"tampered").unwrap();

        let after = status(&runtime_root);
        let nginx = after.roles.iter().find(|r| r.role == "nginx").unwrap();
        assert!(!nginx.installed[0].verified);
        assert!(after.notes.iter().any(|n| n.contains("failed verification")));
        let php = after.roles.iter().find(|r| r.role == "php").unwrap();
        assert!(php.installed.is_empty());
        assert_eq!(php.missing_reason.as_deref(), Some("no Badami-owned php yet"));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn write_php_ini_creates_scan_dir_file() {
        let root = unique_dir("ini");
        let _ = fs::remove_dir_all(&root);
        let paths = runtime_paths_from_root(root.clone());

        let path = write_php_ini(&paths, "84").unwrap();
        assert_eq!(path, PathBuf::from(&paths.php_config).join("84").join("php.ini"));
        let body = fs::read_to_string(&path).unwrap();
        assert!(body.contains("memory_limit=512M"));
        assert!(body.contains("pcre.jit=0"));
        assert!(!body.contains("extension_dir"));

        assert!(write_php_ini(&paths, "  ").is_err());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn provision_all_keeps_going_after_a_failure() {
        let root = unique_dir("batch");
        let _ = fs::remove_dir_all(&root);
        let good_src = root.join("good").join("nginx-arm64");
        fs::create_dir_all(good_src.parent().unwrap()).unwrap();
        fs::write(&good_src, b"ok").unwrap();

        let runtime_root = root.join("runtime");
        let items = vec![
            file_item(&root.join("missing").join("nothing"), "nginx", "1.0.0"),
            file_item(&good_src, "nginx", "1.25.4"),
        ];

        let mut seen = Vec::new();
        let mut progress = |msg: &str| seen.push(msg.to_string());
        let report = provision_all(&runtime_root, &items, &mut progress);

        assert_eq!(report.outcomes.len(), 2);
        assert!(!report.outcomes[0].ok);
        assert!(report.outcomes[0].error.is_some());
        assert!(report.outcomes[1].ok);
        assert_eq!(report.manifest.components.len(), 1);
        assert!(!report.notes.is_empty());
        assert!(seen.len() >= 3);
        assert!(runtime_manifest::manifest_path(&runtime_root).is_file());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn version_parsers_extract_expected_strings() {
        assert_eq!(
            parse_nginx_version("nginx version: nginx/1.25.4"),
            Some("1.25.4".to_string())
        );
        assert_eq!(
            parse_dnsmasq_version("Dnsmasq version 2.90  Copyright (c) 2000-2024"),
            Some("2.90".to_string())
        );
        assert_eq!(
            parse_redis_version("Redis server v=7.4.7 sha=00000000:00000000 malloc=libc"),
            Some("7.4.7".to_string())
        );
        assert_eq!(parse_nginx_version("no version here"), None);
    }

}
