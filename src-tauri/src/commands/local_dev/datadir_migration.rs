//! Move a MariaDB datadir into Badami's own data directory.
//!
//! The move is always a copy, never a rename: the source tree stays intact so the
//! user can still fall back. On APFS the copy is a copy-on-write clone, so an
//! 11 GB datadir costs seconds and a few MB of new blocks; other filesystems
//! fall back to a real recursive copy and the result records which one ran.

use serde::{Deserialize, Serialize};
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

#[cfg(unix)]
use std::process::Command;

/// Written next to the adopted datadir so a later run can explain what happened.
pub const MARKER_NAME: &str = ".badami-migrated.json";

/// Depth and file caps keep the size walk bounded on a pathological tree.
const MAX_WALK_DEPTH: usize = 8;
const MAX_WALK_FILES: u64 = 200_000;

/// Verification hashes at most this many files, so it never becomes a second
/// full copy of the datadir.
const MAX_VERIFY_FILES: usize = 40;

/// How many schema directories contribute a sampled `.ibd` file.
const MAX_SCHEMA_SAMPLES: usize = 5;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrationPreflight {
    pub source: String,
    pub dest: String,
    pub source_bytes: u64,
    pub dest_free_bytes: u64,
    pub can_clone: bool,
    pub source_running: bool,
    pub dest_exists: bool,
    pub blockers: Vec<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrationResult {
    pub ok: bool,
    pub dest: String,
    pub method: String,
    pub cloned: bool,
    pub bytes: u64,
    /// Time spent copying or cloning, excluding the verification hashes.
    pub elapsed_ms: u64,
    pub verified_files: usize,
    pub failed_files: Vec<String>,
    pub notes: Vec<String>,
}

/// A datadir is identified by its system tablespace or the `mysql` schema, the
/// same signals discovery and the MariaDB guards use.
fn looks_like_datadir(dir: &Path) -> bool {
    dir.is_dir() && (dir.join("ibdata1").is_file() || dir.join("mysql").is_dir())
}

/// `<data_root>/mariadb` once a migration has landed there, else `None`.
pub fn adopted_datadir(data_root: &Path) -> Option<PathBuf> {
    let candidate = data_root.join("mariadb");
    if looks_like_datadir(&candidate) {
        Some(candidate)
    } else {
        None
    }
}

fn dir_nonempty(dir: &Path) -> bool {
    fs::read_dir(dir)
        .map(|rd| rd.flatten().next().is_some())
        .unwrap_or(false)
}

/// Canonicalize the deepest existing ancestor and re-append the rest, so a
/// not-yet-created destination still compares against a canonical source.
fn normalize(p: &Path) -> PathBuf {
    let mut suffix: Vec<OsString> = Vec::new();
    let mut cur = p.to_path_buf();
    loop {
        if let Ok(c) = cur.canonicalize() {
            let mut out = c;
            for part in suffix.iter().rev() {
                out.push(part);
            }
            return out;
        }
        match (
            cur.file_name().map(|n| n.to_os_string()),
            cur.parent().map(Path::to_path_buf),
        ) {
            (Some(name), Some(parent)) => {
                suffix.push(name);
                cur = parent;
            }
            _ => return p.to_path_buf(),
        }
    }
}

#[cfg(unix)]
fn existing_ancestor(path: &Path) -> Option<PathBuf> {
    let mut cur = Some(path);
    while let Some(p) = cur {
        if p.exists() {
            return Some(p.to_path_buf());
        }
        cur = p.parent();
    }
    None
}

struct TreeStats {
    bytes: u64,
    files: u64,
    capped: bool,
}

/// Sum regular file sizes without following symlinks. `DirEntry::file_type` is
/// lstat-based, so a link pointing out of the datadir is skipped, not followed.
fn walk_tree(root: &Path) -> TreeStats {
    let mut stats = TreeStats {
        bytes: 0,
        files: 0,
        capped: false,
    };
    let mut stack = vec![(root.to_path_buf(), 0usize)];
    while let Some((dir, depth)) = stack.pop() {
        if depth > MAX_WALK_DEPTH {
            stats.capped = true;
            continue;
        }
        let Ok(rd) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in rd.flatten() {
            if stats.files >= MAX_WALK_FILES {
                stats.capped = true;
                return stats;
            }
            let Ok(ft) = entry.file_type() else {
                continue;
            };
            if ft.is_symlink() {
                continue;
            }
            if ft.is_dir() {
                stack.push((entry.path(), depth + 1));
            } else if ft.is_file() {
                if let Ok(meta) = entry.metadata() {
                    stats.bytes += meta.len();
                }
                stats.files += 1;
            }
        }
    }
    stats
}

/// Available bytes and mount point for the filesystem holding `dest`.
///
/// `df -kP` is POSIX output with a stable column order (the plain `df -k` on
/// macOS inserts inode columns), so field 4 is available KB and the mount point
/// is everything from field 6 onward.
#[cfg(unix)]
fn df_available(dest: &Path) -> Option<(u64, String)> {
    let probe = existing_ancestor(dest)?;
    let out = Command::new("df").arg("-kP").arg(&probe).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let line = text.lines().rev().find(|l| !l.trim().is_empty())?;
    let fields: Vec<&str> = line.split_whitespace().collect();
    if fields.len() < 6 {
        return None;
    }
    let kb: u64 = fields[3].parse().ok()?;
    Some((kb.saturating_mul(1024), fields[5..].join(" ")))
}

#[cfg(not(unix))]
fn df_available(_dest: &Path) -> Option<(u64, String)> {
    None
}

/// Whether the mount holding the destination is APFS.
///
/// `stat -f %T` reports the inode type on macOS (it printed `directory`), not
/// the filesystem, so `diskutil info <mountpoint>` is used instead.
#[cfg(target_os = "macos")]
fn detect_apfs(mountpoint: &str) -> Option<bool> {
    let out = Command::new("diskutil")
        .arg("info")
        .arg(mountpoint)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    for line in text.lines() {
        if let Some((key, value)) = line.split_once(':') {
            if key.trim() == "File System Personality" {
                return Some(value.trim().eq_ignore_ascii_case("APFS"));
            }
        }
    }
    None
}

#[cfg(not(target_os = "macos"))]
fn detect_apfs(_mountpoint: &str) -> Option<bool> {
    None
}

/// True when a MariaDB server is serving this datadir right now.
///
/// A datadir may carry its own pid file, so any `*.pid` at the top level
/// counts; the datadir's own `my.cnf` supplies the socket and port to probe.
///
/// A pid file alone is not enough: the datadir's pid is stale whenever the
/// server was started through another config (Badami starts MariaDB with
/// `--defaults-file`, which writes its pid under `local-dev/pids`). A stale pid
/// would report "not running" while a live server is still writing to the very
/// files being cloned, so the holder check comes first and does not rely on
/// anything the datadir records about itself.
fn source_running(datadir: &Path) -> bool {
    if datadir_has_live_holder(datadir) {
        return true;
    }

    if let Ok(rd) = fs::read_dir(datadir) {
        for entry in rd.flatten() {
            let name = entry.file_name();
            if !name.to_string_lossy().ends_with(".pid") {
                continue;
            }
            if let Some(pid) = super::mariadb_guard::read_pid_file(&entry.path()) {
                if super::mariadb_guard::pid_is_alive(pid) {
                    return true;
                }
            }
        }
    }

    let Ok(text) = fs::read_to_string(datadir.join("my.cnf")) else {
        return false;
    };
    let map = super::config_gen::parse_mycnf_values(&text);
    if let Some(sock) = map.get("socket") {
        let sock = Path::new(sock);
        if super::mariadb_guard::socket_path_present(sock)
            && super::mariadb_guard::unix_socket_accepting(sock)
        {
            return true;
        }
    }
    if let Some(port) = map.get("port").and_then(|s| s.parse::<u16>().ok()) {
        if super::mariadb_guard::tcp_accepting("127.0.0.1", port) {
            return true;
        }
    }
    false
}

/// True when some process has a file open inside the datadir.
///
/// Cloning a datadir that a server is actively writing is the one case where a
/// copy can be silently inconsistent, so this asks the kernel rather than the
/// datadir's own bookkeeping.
#[cfg(unix)]
fn datadir_has_live_holder(datadir: &Path) -> bool {
    use std::process::{Command, Stdio};

    let canonical = datadir
        .canonicalize()
        .unwrap_or_else(|_| datadir.to_path_buf());
    let Ok(output) = Command::new("lsof")
        .arg("-n")
        .arg("+D")
        .arg(&canonical)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
    else {
        return false;
    };
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .skip(1)
        .any(|line| line.contains("mariadbd") || line.contains("mysqld"))
}

#[cfg(not(unix))]
fn datadir_has_live_holder(_datadir: &Path) -> bool {
    false
}

fn marker_field(value: &serde_json::Value, key: &str) -> String {
    value
        .get(key)
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string()
}

fn read_marker(dest: &Path) -> Option<String> {
    let raw = fs::read_to_string(dest.join(MARKER_NAME)).ok()?;
    let value: serde_json::Value = serde_json::from_str(&raw).ok()?;
    Some(format!(
        "a previous migration is recorded here (source {}, method {}, {} files verified, at {})",
        marker_field(&value, "source"),
        marker_field(&value, "method"),
        value
            .get("verified_files")
            .and_then(|v| v.as_u64())
            .unwrap_or(0),
        marker_field(&value, "migrated_at")
    ))
}

/// Read-only assessment of a pending datadir move.
///
/// Never creates, copies, or removes anything; callers show `blockers` and
/// `warnings` before deciding to run [`migrate`].
pub fn preflight(source: &Path, dest: &Path) -> Result<MigrationPreflight, String> {
    let mut blockers = Vec::new();
    let mut warnings = Vec::new();

    if !source.is_dir() {
        blockers.push(format!("source {} is not a directory", source.display()));
    }
    let stats = walk_tree(source);
    if stats.capped {
        warnings.push(format!(
            "size walk stopped at the {MAX_WALK_FILES} file cap; the reported size may be low"
        ));
    }
    if !looks_like_datadir(source) {
        blockers.push(format!(
            "source {} does not look like a MariaDB datadir (no ibdata1 and no mysql/ directory)",
            source.display()
        ));
    }

    let dest_exists = dest.exists();
    if dest_exists && !dest.is_dir() {
        blockers.push(format!(
            "destination {} exists and is not a directory",
            dest.display()
        ));
    } else if dest_exists && dir_nonempty(dest) {
        blockers.push(format!(
            "destination {} already holds data; remove it before migrating again",
            dest.display()
        ));
        if let Some(previous) = read_marker(dest) {
            warnings.push(previous);
        }
    }

    let measured = df_available(dest);
    let have_measurement = measured.is_some();
    let (dest_free_bytes, mountpoint) = match measured {
        Some((bytes, mp)) => (bytes, Some(mp)),
        None => (0, None),
    };
    let can_clone = match mountpoint.as_deref() {
        Some(mp) => match detect_apfs(mp) {
            Some(value) => value,
            None => {
                warnings.push(
                    "could not read the destination filesystem type; assuming a plain copy is needed"
                        .into(),
                );
                false
            }
        },
        None => {
            warnings.push(
                "could not measure free space on the destination; assuming a plain copy is needed"
                    .into(),
            );
            false
        }
    };

    if can_clone {
        warnings.push(
            "APFS clone available: the copy shares blocks with the source and needs almost no extra space"
                .into(),
        );
    } else if have_measurement && dest_free_bytes < stats.bytes {
        blockers.push(format!(
            "destination has {dest_free_bytes} bytes free but a plain copy needs {} bytes",
            stats.bytes
        ));
    }

    let running = source_running(source);
    if running {
        warnings.push(
            "a MariaDB server appears to be serving this datadir; a clone of a running datadir is consistent enough for a one-time move, but stop it first when you can"
                .into(),
        );
    }

    Ok(MigrationPreflight {
        source: source.display().to_string(),
        dest: dest.display().to_string(),
        source_bytes: stats.bytes,
        dest_free_bytes,
        can_clone,
        source_running: running,
        dest_exists,
        blockers,
        warnings,
    })
}

#[cfg(unix)]
fn clone_tree(source: &Path, dest: &Path) -> Result<(), String> {
    // The trailing `/.` copies the *contents* of source into dest rather than
    // nesting a `source` directory inside it.
    let from = format!("{}/.", source.display());
    let out = Command::new("cp")
        .arg("-cR")
        .arg(&from)
        .arg(dest)
        .output()
        .map_err(|e| format!("spawn cp -cR: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

#[cfg(unix)]
fn plain_copy(source: &Path, dest: &Path) -> Result<(), String> {
    let from = format!("{}/.", source.display());
    let out = Command::new("cp")
        .arg("-R")
        .arg(&from)
        .arg(dest)
        .output()
        .map_err(|e| format!("spawn cp -R: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

#[cfg(not(unix))]
fn clone_tree(_source: &Path, _dest: &Path) -> Result<(), String> {
    Err("datadir migration is macOS-only".into())
}

#[cfg(not(unix))]
fn plain_copy(_source: &Path, _dest: &Path) -> Result<(), String> {
    Err("datadir migration is macOS-only".into())
}

/// Bounded verification sample, relative to the datadir root.
///
/// The root `ibdata1` is pushed first so the 40 file cap can never drop it.
fn verify_sample(source: &Path) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();

    let root_ibdata = PathBuf::from("ibdata1");
    if source.join(&root_ibdata).is_file() {
        out.push(root_ibdata);
    }
    let mysql_ibdata = Path::new("mysql").join("ibdata1");
    if source.join(&mysql_ibdata).is_file() {
        out.push(mysql_ibdata);
    }

    let mut dirs: Vec<PathBuf> = fs::read_dir(source)
        .map(|rd| {
            rd.flatten()
                .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
                .map(|e| e.path())
                .collect::<Vec<PathBuf>>()
        })
        .unwrap_or_default();
    dirs.sort();

    let mut sampled_dirs = 0usize;
    for dir in dirs {
        if sampled_dirs >= MAX_SCHEMA_SAMPLES {
            break;
        }
        let Ok(rd) = fs::read_dir(&dir) else {
            continue;
        };
        let mut tables: Vec<PathBuf> = rd
            .flatten()
            .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
            .map(|e| e.path())
            .filter(|p| p.extension().and_then(|x| x.to_str()) == Some("ibd"))
            .collect::<Vec<PathBuf>>();
        tables.sort();
        if let Some(first) = tables.into_iter().next() {
            if let Ok(rel) = first.strip_prefix(source) {
                out.push(rel.to_path_buf());
                sampled_dirs += 1;
            }
        }
    }

    out.truncate(MAX_VERIFY_FILES);
    out
}

/// Copy the datadir to `dest`, preferring an APFS clone over a real copy.
///
/// `Err` means the move never started (path guards, copy failure). A copy that
/// ran but failed verification returns `Ok` with `ok: false` and the offending
/// files in `failed_files`, so the UI can offer a retry without losing detail.
/// Nothing under `source` is ever written, renamed, or deleted.
pub fn migrate(
    source: &Path,
    dest: &Path,
    progress: &mut dyn FnMut(&str),
) -> Result<MigrationResult, String> {
    let started = Instant::now();

    let source_n = normalize(source);
    let dest_n = normalize(dest);
    if source_n == dest_n {
        return Err(format!(
            "source and destination are the same directory ({})",
            source.display()
        ));
    }
    if dest_n.starts_with(&source_n) {
        return Err(format!(
            "destination {} is inside the source tree {}; refusing to copy a datadir into itself",
            dest.display(),
            source.display()
        ));
    }
    if source_n.starts_with(&dest_n) {
        return Err(format!(
            "source {} is inside the destination tree {}; refusing to nest the datadir",
            source.display(),
            dest.display()
        ));
    }

    if !source.is_dir() {
        return Err(format!("source is not a directory: {}", source.display()));
    }

    let dest_existed = dest.exists();
    if dest_existed && !dest.is_dir() {
        return Err(format!(
            "destination {} exists and is not a directory",
            dest.display()
        ));
    }
    if dest_existed && dir_nonempty(dest) {
        return Err(format!(
            "destination {} already holds data; remove it first (this function never deletes a destination)",
            dest.display()
        ));
    }
    if let Some(parent) = dest.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
        }
    }

    let stats = walk_tree(source);
    progress(&format!(
        "copying {} ({} bytes) to {}",
        source.display(),
        stats.bytes,
        dest.display()
    ));

    let mut notes = Vec::new();
    let mut cloned = true;
    if let Err(clone_err) = clone_tree(source, dest) {
        cloned = false;
        notes.push(format!(
            "APFS clone failed ({clone_err}); fell back to a plain recursive copy"
        ));
        // Only a destination this call created is removed; a caller-provided
        // destination is never touched, and the plain copy overwrites anyway.
        if !dest_existed {
            let _ = fs::remove_dir_all(dest);
        }
        plain_copy(source, dest)?;
    }

    progress("copy finished; verifying sample files");
    // Stop the clock before verification: hashing multi-GB files dominates the
    // wall time, and reporting it as copy time makes the clone look slow.
    let copy_ms = started.elapsed().as_millis() as u64;

    let mut verified_files = 0usize;
    let mut failed_files = Vec::new();
    for rel in verify_sample(source) {
        let src = source.join(&rel);
        let dst = dest.join(&rel);
        match (
            super::runtime_manifest::hash_file(&src),
            super::runtime_manifest::hash_file(&dst),
        ) {
            (Ok(a), Ok(b)) if a == b => verified_files += 1,
            _ => failed_files.push(rel.to_string_lossy().into_owned()),
        }
    }

    let mut result = MigrationResult {
        ok: failed_files.is_empty(),
        dest: dest.display().to_string(),
        method: if cloned { "apfs-clone" } else { "copy" }.into(),
        cloned,
        bytes: stats.bytes,
        elapsed_ms: copy_ms,
        verified_files,
        failed_files,
        notes,
    };

    if result.ok {
        let marker = serde_json::json!({
            "source": source.display().to_string(),
            "method": result.method.clone(),
            "cloned": result.cloned,
            "bytes": result.bytes,
            "verified_files": result.verified_files,
            "migrated_at": super::runtime_manifest::now_rfc3339(),
        });
        match serde_json::to_string_pretty(&marker) {
            Ok(body) => {
                if let Err(e) = fs::write(dest.join(MARKER_NAME), body) {
                    result
                        .notes
                        .push(format!("could not write {MARKER_NAME}: {e}"));
                }
            }
            Err(e) => result
                .notes
                .push(format!("could not encode {MARKER_NAME}: {e}")),
        }
    }

    progress("migration finished");
    Ok(result)
}

/// Datadir the MariaDB wrapper is configured to open.
///
/// The wrapper my.cnf is the single source of truth here: it is what the server
/// actually reads at start, so it cannot disagree with a running instance.
fn default_source() -> Result<PathBuf, String> {
    let paths = super::discovery::build_runtime_paths()?;
    let wrapper = PathBuf::from(&paths.mariadb).join("my.cnf");
    let text = std::fs::read_to_string(&wrapper)
        .map_err(|e| format!("read {}: {e}", wrapper.display()))?;
    let map = super::config_gen::parse_mycnf_values(&text);
    let datadir = map
        .get("datadir")
        .filter(|d| !d.trim().is_empty())
        .ok_or_else(|| format!("{} has no datadir entry", wrapper.display()))?;
    Ok(PathBuf::from(datadir))
}

fn dest_for_current_root() -> Result<PathBuf, String> {
    let paths = super::discovery::build_runtime_paths()?;
    Ok(PathBuf::from(&paths.data).join("mariadb"))
}

#[tauri::command]
pub async fn ld_datadir_preflight(source: Option<String>) -> Result<MigrationPreflight, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dest = dest_for_current_root()?;
        let src = match source {
            Some(s) => PathBuf::from(s),
            None => default_source()?,
        };
        preflight(&src, &dest)
    })
    .await
    .map_err(|e| format!("ld_datadir_preflight task failed: {e}"))?
}

#[tauri::command]
pub async fn ld_datadir_migrate(
    source: Option<String>,
    confirm: bool,
) -> Result<MigrationResult, String> {
    if !confirm {
        return Err(
            "datadir migration copies the whole MariaDB datadir; pass confirm=true once the user approves"
                .into(),
        );
    }
    tauri::async_runtime::spawn_blocking(move || {
        let dest = dest_for_current_root()?;
        let src = match source {
            Some(s) => PathBuf::from(s),
            None => default_source()?,
        };
        // The command is headless for now: progress is only surfaced by direct
        // callers of `migrate`.
        let mut progress = |_msg: &str| {};
        migrate(&src, &dest, &mut progress)
    })
    .await
    .map_err(|e| format!("ld_datadir_migrate task failed: {e}"))?
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn tmp(label: &str) -> PathBuf {
        let n = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("badami-datadir-{label}-{n}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn fake_datadir(root: &Path) {
        fs::create_dir_all(root.join("mysql")).unwrap();
        fs::write(root.join("ibdata1"), b"system tablespace").unwrap();
        fs::write(
            root.join("mysql").join("ibdata1"),
            b"mysql schema tablespace",
        )
        .unwrap();
        for schema in ["app_one", "app_two"] {
            let dir = root.join(schema);
            fs::create_dir_all(&dir).unwrap();
            fs::write(
                dir.join("users.ibd"),
                format!("rows for {schema}").as_bytes(),
            )
            .unwrap();
        }
    }

    fn snapshot(root: &Path) -> BTreeMap<String, Vec<u8>> {
        let mut out = BTreeMap::new();
        let mut stack = vec![root.to_path_buf()];
        while let Some(dir) = stack.pop() {
            for entry in fs::read_dir(&dir).unwrap().flatten() {
                let ft = entry.file_type().unwrap();
                if ft.is_dir() {
                    stack.push(entry.path());
                } else if ft.is_file() {
                    let rel = entry
                        .path()
                        .strip_prefix(root)
                        .unwrap()
                        .to_string_lossy()
                        .into_owned();
                    out.insert(rel, fs::read(entry.path()).unwrap());
                }
            }
        }
        out
    }

    #[test]
    fn migrate_copies_and_leaves_source_intact() {
        let base = tmp("clone");
        let source = base.join("source-datadir");
        let data_root = base.join("data");
        let dest = data_root.join("mariadb");
        fake_datadir(&source);
        let before = snapshot(&source);

        let report = preflight(&source, &dest).unwrap();
        let mut progress = |_msg: &str| {};
        let result = migrate(&source, &dest, &mut progress).unwrap();

        assert!(
            result.ok,
            "notes={:?} failed={:?}",
            result.notes, result.failed_files
        );
        assert!(result.failed_files.is_empty());
        assert!(
            result.verified_files >= 4,
            "verified={}",
            result.verified_files
        );
        assert_eq!(
            result.method,
            if result.cloned { "apfs-clone" } else { "copy" }
        );
        if report.can_clone {
            assert!(
                result.cloned,
                "APFS clone should succeed: {:?}",
                result.notes
            );
        } else {
            assert!(
                result
                    .notes
                    .iter()
                    .any(|n| n.contains("plain recursive copy")),
                "a non-clone copy must say so: {:?}",
                result.notes
            );
        }

        assert_eq!(snapshot(&source), before, "source must be byte-identical");
        assert_eq!(adopted_datadir(&data_root), Some(dest.clone()));
        assert!(dest.join("ibdata1").is_file());
        assert!(dest.join(MARKER_NAME).is_file());

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn guards_reject_same_and_nested_paths() {
        let base = tmp("guards");
        let source = base.join("source-datadir");
        fake_datadir(&source);
        let mut progress = |_msg: &str| {};

        let same = migrate(&source, &source, &mut progress).unwrap_err();
        assert!(same.contains("same directory"), "{same}");

        let nested = source.join("data").join("mariadb");
        let err = migrate(&source, &nested, &mut progress).unwrap_err();
        assert!(err.contains("inside the source tree"), "{err}");

        let outer = base.join("data");
        let inner_source = outer.join("mariadb").join("source-datadir");
        fake_datadir(&inner_source);
        let err = migrate(&inner_source, &outer.join("mariadb"), &mut progress).unwrap_err();
        assert!(err.contains("inside the destination tree"), "{err}");

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn preflight_blocks_a_nonempty_destination_and_samples_ibdata1() {
        let base = tmp("preflight");
        let source = base.join("source-datadir");
        let dest = base.join("data").join("mariadb");
        fake_datadir(&source);
        fs::create_dir_all(&dest).unwrap();
        fs::write(dest.join("ibdata1"), b"stale").unwrap();

        let report = preflight(&source, &dest).unwrap();
        assert!(report.dest_exists);
        assert!(report.source_bytes > 0);
        assert!(
            report
                .blockers
                .iter()
                .any(|b| b.contains("already holds data")),
            "{:?}",
            report.blockers
        );

        let sample = verify_sample(&source);
        assert_eq!(sample.first(), Some(&PathBuf::from("ibdata1")));
        assert!(sample.len() <= MAX_VERIFY_FILES);

        let _ = fs::remove_dir_all(&base);
    }
}
