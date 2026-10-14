//! Shell integration: put the provisioned runtime on the user's `PATH`.
//!
//! Herd does this by appending `export PATH=...` to `~/.zshrc`. That works, but
//! it leaves the block behind after uninstall, and a stale entry silently
//! poisons every new shell. This module does the same job with three rules:
//!
//! 1. The block is delimited by markers, so removing it is exact.
//! 2. Removal never touches anything outside those markers.
//! 3. Nothing is written until the user asks for it, and the state is always
//!    reported from what is on disk rather than from a stored flag.
//!
//! The `bin/` directory Badami adds to `PATH` holds launchers, not the runtime
//! binaries themselves. A launcher pins the PHP version and its `php.ini`, which
//! a bare `PATH` entry cannot do: PHP reads `PHPRC`, not `PHP_INI_SCAN_DIR`, so
//! a direct path entry would run PHP with no ini at all.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

use super::discovery::build_runtime_paths;

/// Markers. Changing either string orphans an existing block, so treat them as
/// a format version rather than as cosmetic text.
const MARKER_START: &str = "# >>> badami local-dev >>>";
const MARKER_END: &str = "# <<< badami local-dev <<<";

/// A launcher pins one PHP version, so it is written per version.
const PHP_VERSIONS: &[(&str, &str)] = &[("8.4", "84"), ("7.4", "74")];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShellIntegrationStatus {
    /// True when the marked block is present in the profile.
    pub installed: bool,
    /// Absolute path of the profile file that was inspected.
    pub profile: String,
    /// Directory added to PATH, whether or not it exists yet.
    pub bin_dir: String,
    /// Launchers that exist right now.
    pub commands: Vec<String>,
    /// True when the block is present but the runtime is gone, which would put
    /// a dead directory on PATH.
    pub stale: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShellIntegrationResult {
    pub installed: bool,
    pub profile: String,
    pub bin_dir: String,
    pub commands: Vec<String>,
    /// One line per action taken, for the UI to show.
    pub notes: Vec<String>,
}

/// The login shell profile. Only zsh and bash are handled: both are on macOS by
/// default, and guessing at others risks editing a file the shell never reads.
fn profile_path() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME").ok_or("HOME is not set")?;
    let home = PathBuf::from(home);
    let shell = std::env::var("SHELL").unwrap_or_default();
    let name = if shell.ends_with("/bash") {
        ".bash_profile"
    } else {
        ".zshrc"
    };
    Ok(home.join(name))
}

fn bin_dir() -> Result<PathBuf, String> {
    Ok(PathBuf::from(build_runtime_paths()?.local_dev_root).join("bin"))
}

/// Commands the launchers expose. Each entry is the name plus the absolute
/// binary it delegates to; a missing binary is skipped rather than written.
fn launchers(paths: &super::discovery::RuntimePaths) -> Vec<(String, String, Option<String>)> {
    let runtime = Path::new(&paths.runtime);
    let mut out: Vec<(String, String, Option<String>)> = Vec::new();

    // The version the supervisor would run. `php` answers to it, so a plain
    // `php` in the terminal matches what the sites actually execute.
    let manifest = super::runtime_manifest::load(runtime);
    let default_version = manifest
        .selected_for("php", None)
        .map(|c| c.version.clone());

    // PHP CLI, one launcher per provisioned version. The default version also
    // answers to plain `php`.
    for (version, tag) in PHP_VERSIONS {
        let cli = runtime.join("php").join(version).join(format!("php{tag}"));
        if !cli.is_file() {
            continue;
        }
        let ini = Path::new(&paths.php_config).join(tag).join("php.ini");
        let ini_arg = ini.is_file().then(|| ini.to_string_lossy().into_owned());
        let target = cli.to_string_lossy().into_owned();
        out.push((format!("php{tag}"), target.clone(), ini_arg.clone()));

        let is_default = default_version.as_deref() == Some(*version);
        if is_default {
            out.push(("php".into(), target, ini_arg));
        }
    }
    // A manifest with no selection leaves `php` unset; fall back to the newest
    // installed version so the command exists either way.
    if !out.iter().any(|(n, _, _)| n == "php") {
        if let Some((_, target, ini)) = out.iter().find(|(n, _, _)| n == "php84") {
            out.push(("php".into(), target.clone(), ini.clone()));
        } else if let Some((_, target, ini)) = out.iter().find(|(n, _, _)| n == "php74") {
            out.push(("php".into(), target.clone(), ini.clone()));
        }
    }

    // MariaDB client. The directory also carries `mysql` and `mysqladmin`
    // aliases, so one entry covers both spellings.
    let mariadb_bin = find_selected(runtime, "mariadb")
        .map(|d| d.join("bin"))
        .filter(|d| d.is_dir());
    if let Some(dir) = mariadb_bin {
        out.push(("mysql".into(), dir.join("mysql").to_string_lossy().into_owned(), None));
        out.push(("mariadb".into(), dir.join("mariadb").to_string_lossy().into_owned(), None));
    }

    // redis-cli, for a quick look at the cache.
    if let Some(dir) = find_selected(runtime, "redis") {
        let cli = dir.join("redis-cli");
        if cli.is_file() {
            out.push(("redis-cli".into(), cli.to_string_lossy().into_owned(), None));
        }
    }

    out
}

/// Highest version directory under `runtime/<role>/`, which is what a launcher
/// should point at when the manifest is unavailable.
fn find_selected(runtime: &Path, role: &str) -> Option<PathBuf> {
    let dir = runtime.join(role);
    let mut versions: Vec<PathBuf> = fs::read_dir(&dir)
        .ok()?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();
    // Lexical order is wrong for `10.11.6` vs `9.x`; compare numerically per
    // dotted segment so the newest wins.
    versions.sort_by(|a, b| version_cmp(a, b));
    versions.pop()
}

fn version_cmp(a: &Path, b: &Path) -> std::cmp::Ordering {
    let key = |p: &Path| -> Vec<u64> {
        p.file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .split('.')
            .map(|s| s.parse::<u64>().unwrap_or(0))
            .collect()
    };
    key(a).cmp(&key(b))
}

/// The launcher script for one command.
///
/// It resolves its own directory so the same text works no matter where the
/// runtime lives, and it pins the ini through `PHPRC` because PHP ignores
/// `PHP_INI_SCAN_DIR` for the CLI.
fn launcher_script(name: &str, target: &str, ini: Option<&str>) -> String {
    let mut s = String::new();
    s.push_str("#!/bin/sh\n");
    s.push_str(&format!("# Badami local-dev launcher for `{name}`. Generated; do not edit.\n"));
    if let Some(ini) = ini {
        s.push_str(&format!("PHPRC=\"{ini}\"\nexport PHPRC\n"));
    }
    s.push_str(&format!("exec \"{target}\" \"$@\"\n"));
    s
}

/// Reads the profile and returns the byte range of the marked block.
fn find_block(text: &str) -> Option<(usize, usize)> {
    let start = text.find(MARKER_START)?;
    let end = text[start..].find(MARKER_END)? + start + MARKER_END.len();
    // Include the trailing newline so removal does not leave a blank line.
    let end = if text[end..].starts_with('\n') { end + 1 } else { end };
    Some((start, end))
}

pub fn status() -> Result<ShellIntegrationStatus, String> {
    // Surfaces the "no install on this machine" error before touching the
    // profile, so a caller on a fresh box gets a clear failure.
    build_runtime_paths()?;
    let profile = profile_path()?;
    let dir = bin_dir()?;

    let text = fs::read_to_string(&profile).unwrap_or_default();
    let installed = find_block(&text).is_some();

    let mut commands = Vec::new();
    if dir.is_dir() {
        if let Ok(entries) = fs::read_dir(&dir) {
            for e in entries.filter_map(|e| e.ok()) {
                if let Some(name) = e.file_name().to_str() {
                    commands.push(name.to_string());
                }
            }
        }
    }
    commands.sort();
    // A block whose bin dir is gone is worse than no block: every new shell
    // gets a dead PATH entry.
    let stale = installed && !dir.is_dir();

    Ok(ShellIntegrationStatus {
        installed,
        profile: profile.to_string_lossy().into_owned(),
        bin_dir: dir.to_string_lossy().into_owned(),
        commands,
        stale,
    })
}

/// Writes the launchers and appends the marked block to the profile.
pub fn install() -> Result<ShellIntegrationResult, String> {
    let paths = build_runtime_paths()?;
    let profile = profile_path()?;
    let dir = bin_dir()?;
    let mut notes = Vec::new();

    fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;

    let mut written = Vec::new();
    for (name, target, ini) in launchers(&paths) {
        if !Path::new(&target).is_file() {
            notes.push(format!("skipped {name}: {target} is missing"));
            continue;
        }
        let path = dir.join(&name);
        fs::write(&path, launcher_script(&name, &target, ini.as_deref()))
            .map_err(|e| format!("write {}: {e}", path.display()))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o755))
                .map_err(|e| format!("chmod {}: {e}", path.display()))?;
        }
        written.push(name);
    }
    if written.is_empty() {
        return Err("no runtime binaries found; provision the runtime first".into());
    }
    notes.push(format!("wrote {} launcher(s) to {}", written.len(), dir.display()));

    let mut text = fs::read_to_string(&profile).unwrap_or_default();
    // Replace an existing block rather than stacking a second one.
    if let Some((start, end)) = find_block(&text) {
        text.replace_range(start..end, "");
        notes.push("replaced the existing block".into());
    }

    let block = format!(
        "{MARKER_START}\n# Managed by Badami. Remove through Settings, not by hand.\nexport PATH=\"{}:$PATH\"\n{MARKER_END}\n",
        dir.display()
    );
    if !text.is_empty() && !text.ends_with('\n') {
        text.push('\n');
    }
    text.push_str(&block);
    fs::write(&profile, &text).map_err(|e| format!("write {}: {e}", profile.display()))?;
    notes.push(format!("updated {}", profile.display()));
    notes.push("open a new terminal, or run: source ~/.zshrc".into());

    Ok(ShellIntegrationResult {
        installed: true,
        profile: profile.to_string_lossy().into_owned(),
        bin_dir: dir.to_string_lossy().into_owned(),
        commands: written,
        notes,
    })
}

/// Removes the marked block and the launchers. Nothing outside the markers is
/// touched, which is the whole reason for having them.
pub fn uninstall() -> Result<ShellIntegrationResult, String> {
    let profile = profile_path()?;
    let dir = bin_dir()?;
    let mut notes = Vec::new();

    let text = fs::read_to_string(&profile).unwrap_or_default();
    match find_block(&text) {
        Some((start, end)) => {
            let mut next = text.clone();
            next.replace_range(start..end, "");
            fs::write(&profile, next).map_err(|e| format!("write {}: {e}", profile.display()))?;
            notes.push(format!("removed the block from {}", profile.display()));
        }
        None => notes.push("no block found; nothing to remove".into()),
    }

    if dir.is_dir() {
        fs::remove_dir_all(&dir).map_err(|e| format!("remove {}: {e}", dir.display()))?;
        notes.push(format!("removed {}", dir.display()));
    }

    Ok(ShellIntegrationResult {
        installed: false,
        profile: profile.to_string_lossy().into_owned(),
        bin_dir: dir.to_string_lossy().into_owned(),
        commands: Vec::new(),
        notes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn block_is_found_and_removed_exactly() {
        let text = "export FOO=1\n# >>> badami local-dev >>>\nexport PATH=\"/x:$PATH\"\n# <<< badami local-dev <<<\nexport BAR=2\n";
        let (start, end) = find_block(text).expect("block");
        let mut out = text.to_string();
        out.replace_range(start..end, "");
        assert_eq!(out, "export FOO=1\nexport BAR=2\n");
        assert!(find_block(&out).is_none());
    }

    #[test]
    fn uninstall_leaves_other_content_untouched() {
        // The point of the markers: a profile full of other tools survives.
        let text = "# Herd injected PHP binary.\nexport PATH=\"/herd/bin:$PATH\"\n# >>> badami local-dev >>>\nexport PATH=\"/b:$PATH\"\n# <<< badami local-dev <<<\nexport JAVA_HOME=/x\n";
        let (start, end) = find_block(text).unwrap();
        let mut out = text.to_string();
        out.replace_range(start..end, "");
        assert!(out.contains("Herd injected PHP binary"));
        assert!(out.contains("export JAVA_HOME=/x"));
        assert!(!out.contains("badami local-dev"));
    }

    #[test]
    fn missing_block_is_not_an_error() {
        assert!(find_block("export PATH=/usr/bin\n").is_none());
        assert!(find_block("").is_none());
    }

    #[test]
    fn launcher_pins_ini_through_phprc() {
        let s = launcher_script("php84", "/r/php84", Some("/c/84/php.ini"));
        assert!(s.contains("PHPRC=\"/c/84/php.ini\""), "{s}");
        assert!(s.contains("exec \"/r/php84\" \"$@\""), "{s}");
        assert!(s.starts_with("#!/bin/sh\n"));
    }

    #[test]
    fn launcher_without_ini_still_execs() {
        let s = launcher_script("mysql", "/r/mysql", None);
        assert!(!s.contains("PHPRC"), "{s}");
        assert!(s.contains("exec \"/r/mysql\" \"$@\""), "{s}");
    }

    #[test]
    fn newest_version_wins_over_lexical_order() {
        // `10.11.6` must beat `9.6.0`, which plain string order gets wrong.
        let a = PathBuf::from("/r/mariadb/9.6.0");
        let b = PathBuf::from("/r/mariadb/10.11.6");
        assert_eq!(version_cmp(&a, &b), std::cmp::Ordering::Less);
    }
}
