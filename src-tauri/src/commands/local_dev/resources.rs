//! Install bundled Local Dev resources into Application Support.
//!
//! Source: Tauri `bundle.resources` (`resources/local-dev/**`) or, in dev,
//! `src-tauri/resources/local-dev` next to the crate.
//!
//! Destination: `~/Library/Application Support/Badami/local-dev/`
//! Idempotent. Never touches Herd paths or MariaDB datadirs.

use super::discovery::{build_runtime_paths, local_dev_root, RuntimePaths};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallResourcesResult {
    pub local_dev_root: String,
    pub source: String,
    pub copied_files: usize,
    pub created_dirs: Vec<String>,
    pub notes: Vec<String>,
}

/// Directory layout under local-dev (from design).
const LAYOUT_SUBDIRS: &[&str] = &[
    "config/valet",
    "config/valet/Sites",
    "config/valet/Certificates",
    "nginx",
    "nginx/sites",
    "fpm",
    "socks",
    "dnsmasq",
    "mariadb",
    "valet-server",
    "pids",
    "logs",
    "import",
];

/// Ensure the full HERD_HOME-shaped layout exists (idempotent).
pub fn ensure_layout(root: &Path) -> Result<Vec<String>, String> {
    let mut created = Vec::new();
    for rel in LAYOUT_SUBDIRS {
        let p = root.join(rel);
        let existed = p.exists();
        fs::create_dir_all(&p).map_err(|e| format!("mkdir {}: {e}", p.display()))?;
        if !existed {
            created.push(p.to_string_lossy().into_owned());
        }
    }
    Ok(created)
}

/// Locate the packed `local-dev` resource root.
///
/// Order:
/// 1. Explicit override (`BADAMI_LOCAL_DEV_RESOURCES`)
/// 2. `{resource_dir}/resources/local-dev` (Tauri bundle layout)
/// 3. `{resource_dir}/local-dev`
/// 4. Dev fallback: `CARGO_MANIFEST_DIR/resources/local-dev`
pub fn find_resource_pack(resource_dir: Option<&Path>) -> Result<PathBuf, String> {
    if let Ok(p) = std::env::var("BADAMI_LOCAL_DEV_RESOURCES") {
        let pb = PathBuf::from(&p);
        if pb.is_dir() {
            return Ok(pb);
        }
        return Err(format!(
            "BADAMI_LOCAL_DEV_RESOURCES set but not a directory: {p}"
        ));
    }

    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(rd) = resource_dir {
        candidates.push(rd.join("resources").join("local-dev"));
        candidates.push(rd.join("local-dev"));
        // Some Tauri versions flatten with the full relative path preserved.
        candidates.push(rd.to_path_buf());
    }

    // Compile-time crate dir (dev / `cargo test`).
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/local-dev");
    candidates.push(manifest);

    for c in &candidates {
        if c.join("valet-server").is_dir() || c.join("templates").is_dir() {
            return Ok(c.clone());
        }
    }

    Err(format!(
        "could not locate local-dev resource pack; tried: {}",
        candidates
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<_>>()
            .join(", ")
    ))
}

/// Recursively copy `src` → `dst`, overwriting files. Creates parents.
fn copy_dir_recursive(src: &Path, dst: &Path, count: &mut usize) -> Result<(), String> {
    if !src.is_dir() {
        return Err(format!("not a directory: {}", src.display()));
    }
    fs::create_dir_all(dst).map_err(|e| format!("mkdir {}: {e}", dst.display()))?;

    for entry in fs::read_dir(src).map_err(|e| format!("read_dir {}: {e}", src.display()))? {
        let entry = entry.map_err(|e| format!("read_dir entry: {e}"))?;
        let ft = entry
            .file_type()
            .map_err(|e| format!("file_type: {e}"))?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if ft.is_dir() {
            copy_dir_recursive(&from, &to, count)?;
        } else if ft.is_file() {
            if let Some(parent) = to.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
            }
            fs::copy(&from, &to)
                .map_err(|e| format!("copy {} → {}: {e}", from.display(), to.display()))?;
            *count += 1;
        }
        // skip symlinks
    }
    Ok(())
}

/// Install resource pack into Application Support local-dev.
///
/// Copies `valet-server/` and keeps `templates/` available under local-dev
/// for reference (generators also embed templates via `include_str!`).
pub fn install_runtime_resources(
    resource_dir: Option<&Path>,
) -> Result<InstallResourcesResult, String> {
    let root = local_dev_root()?;
    let paths: RuntimePaths = build_runtime_paths()?;
    let created_dirs = ensure_layout(&root)?;

    let source = find_resource_pack(resource_dir)?;
    let mut notes = Vec::new();
    let mut copied_files = 0usize;

    // valet-server tree → local-dev/valet-server
    let vs_src = source.join("valet-server");
    if vs_src.is_dir() {
        let vs_dst = PathBuf::from(&paths.valet_server);
        copy_dir_recursive(&vs_src, &vs_dst, &mut copied_files)?;
        notes.push(format!(
            "installed valet-server → {}",
            vs_dst.display()
        ));
    } else {
        notes.push("warning: valet-server/ missing from resource pack".into());
    }

    // Optional: copy templates for on-disk reference / future non-embedded use.
    let tpl_src = source.join("templates");
    if tpl_src.is_dir() {
        let tpl_dst = root.join("templates");
        copy_dir_recursive(&tpl_src, &tpl_dst, &mut copied_files)?;
        notes.push(format!("installed templates → {}", tpl_dst.display()));
    }

    // Sanity: server.php present
    let server_php = PathBuf::from(&paths.valet_server).join("server.php");
    if !server_php.is_file() {
        return Err(format!(
            "install incomplete: missing {}",
            server_php.display()
        ));
    }

    notes.push("idempotent install complete; Herd paths untouched".into());
    notes.push("MariaDB start not performed".into());

    Ok(InstallResourcesResult {
        local_dev_root: paths.local_dev_root,
        source: source.to_string_lossy().into_owned(),
        copied_files,
        created_dirs,
        notes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn find_resource_pack_dev_fallback() {
        let pack = find_resource_pack(None).expect("dev pack");
        assert!(pack.join("valet-server").is_dir() || pack.join("templates").is_dir());
        assert!(pack.join("valet-server").join("server.php").is_file());
    }

    #[test]
    fn layout_subdirs_cover_design() {
        assert!(LAYOUT_SUBDIRS.iter().any(|s| s.contains("valet")));
        assert!(LAYOUT_SUBDIRS.iter().any(|s| *s == "socks"));
        assert!(LAYOUT_SUBDIRS.iter().any(|s| *s == "mariadb"));
    }
}
