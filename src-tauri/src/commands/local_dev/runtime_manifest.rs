//! Inventory of Badami-owned runtime binaries under `local-dev/runtime/`.
//!
//! Every component provisioned into `runtime/<role>/<version>/` is recorded
//! here with the SHA-256 of its primary binary, so the supervisor can tell a
//! real install from a half-copied directory and the updater can decide what
//! to replace. This file is the only source of truth for "which binary does
//! role X run" without scanning the disk.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// Bumped when the on-disk shape changes incompatibly.
pub const MANIFEST_SCHEMA: u32 = 1;

pub const MANIFEST_NAME: &str = "manifest.json";

/// Roles that can be provisioned. Matches `BinaryCandidate.role` naming so
/// discovery can report Badami-owned binaries with the same vocabulary.
pub const ROLES: &[&str] = &["nginx", "php", "mariadb", "redis", "dnsmasq"];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeManifest {
    pub schema: u32,
    /// RFC 3339, set on every save.
    pub updated_at: String,
    pub components: Vec<RuntimeComponent>,
}

impl Default for RuntimeManifest {
    fn default() -> Self {
        Self {
            schema: MANIFEST_SCHEMA,
            updated_at: String::new(),
            components: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeComponent {
    /// One of [`ROLES`].
    pub role: String,
    /// Version string as it appears in the directory name (`1.25.4`, `7.4`).
    pub version: String,
    /// Primary executable, absolute.
    pub binary: String,
    /// SHA-256 of `binary` at install time (lowercase hex).
    pub sha256: String,
    /// `local-copy` | `static-php-cli` | `homebrew` | `manual`.
    pub source: String,
    pub arch: String,
    /// RFC 3339.
    pub installed_at: String,
    /// True for the version the supervisor should run when no explicit
    /// version is requested. Exactly one component per role should be set.
    pub selected: bool,
}

impl RuntimeManifest {
    /// Components for one role, newest version first (lexical on version).
    pub fn for_role(&self, role: &str) -> Vec<&RuntimeComponent> {
        let mut v: Vec<&RuntimeComponent> =
            self.components.iter().filter(|c| c.role == role).collect();
        v.sort_by(|a, b| b.version.cmp(&a.version));
        v
    }

    /// The component the supervisor should run for `role`.
    ///
    /// Prefers an explicitly selected entry, else the newest. `version`
    /// narrows to an exact match when given.
    pub fn selected_for(&self, role: &str, version: Option<&str>) -> Option<&RuntimeComponent> {
        let candidates = self.for_role(role);
        if let Some(v) = version {
            return candidates.into_iter().find(|c| c.version == v);
        }
        candidates
            .iter()
            .find(|c| c.selected)
            .copied()
            .or_else(|| candidates.first().copied())
    }

    /// Insert or replace a component, keyed on (role, version).
    pub fn upsert(&mut self, component: RuntimeComponent) {
        self.components
            .retain(|c| !(c.role == component.role && c.version == component.version));
        self.components.push(component);
    }

    /// Drop a component record. Returns true when something was removed.
    pub fn remove(&mut self, role: &str, version: &str) -> bool {
        let before = self.components.len();
        self.components
            .retain(|c| !(c.role == role && c.version == version));
        self.components.len() != before
    }
}

/// `runtime/manifest.json` under the local-dev root.
pub fn manifest_path(runtime_root: &Path) -> PathBuf {
    runtime_root.join(MANIFEST_NAME)
}

/// Read the manifest. A missing or unreadable file yields an empty manifest:
/// callers treat "no manifest" and "manifest with no components" the same way,
/// and a corrupt file must never block the whole Local Dev module.
pub fn load(runtime_root: &Path) -> RuntimeManifest {
    let path = manifest_path(runtime_root);
    let Ok(raw) = fs::read_to_string(&path) else {
        return RuntimeManifest::default();
    };
    match serde_json::from_str::<RuntimeManifest>(&raw) {
        Ok(m) if m.schema == MANIFEST_SCHEMA => m,
        _ => RuntimeManifest::default(),
    }
}

pub fn save(runtime_root: &Path, manifest: &RuntimeManifest) -> Result<(), String> {
    fs::create_dir_all(runtime_root)
        .map_err(|e| format!("mkdir {}: {e}", runtime_root.display()))?;
    let mut out = manifest.clone();
    out.schema = MANIFEST_SCHEMA;
    out.updated_at = now_rfc3339();
    let body = serde_json::to_string_pretty(&out).map_err(|e| format!("serialize manifest: {e}"))?;
    fs::write(manifest_path(runtime_root), body).map_err(|e| format!("write manifest: {e}"))
}

/// `runtime/<role>/<version>` for a provisioned component.
pub fn component_dir(runtime_root: &Path, role: &str, version: &str) -> PathBuf {
    runtime_root.join(role).join(version)
}

pub fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// Lowercase hex SHA-256 of a file, streamed so a 90 MB PHP binary does not
/// have to sit in memory.
pub fn hash_file(path: &Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;

    let mut file =
        fs::File::open(path).map_err(|e| format!("open {}: {e}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = file
            .read(&mut buf)
            .map_err(|e| format!("read {}: {e}", path.display()))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// True when `component.binary` still hashes to the recorded digest.
///
/// A missing file counts as unverified, so a half-copied directory is never
/// reported as installed.
pub fn verify(component: &RuntimeComponent) -> bool {
    let path = Path::new(&component.binary);
    if !path.is_file() {
        return false;
    }
    match hash_file(path) {
        Ok(actual) => actual == component.sha256,
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn component(role: &str, version: &str, selected: bool) -> RuntimeComponent {
        RuntimeComponent {
            role: role.into(),
            version: version.into(),
            binary: format!("/rt/{role}/{version}/bin"),
            sha256: "00".repeat(32),
            source: "local-copy".into(),
            arch: "aarch64".into(),
            installed_at: "2026-01-01T00:00:00Z".into(),
            selected,
        }
    }

    #[test]
    fn load_missing_manifest_is_empty_not_an_error() {
        let dir = std::env::temp_dir().join("badami-manifest-missing");
        let _ = fs::remove_dir_all(&dir);
        let m = load(&dir);
        assert!(m.components.is_empty());
        assert_eq!(m.schema, MANIFEST_SCHEMA);
    }

    #[test]
    fn load_corrupt_manifest_falls_back_to_empty() {
        let dir = std::env::temp_dir().join("badami-manifest-corrupt");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(manifest_path(&dir), "{not json").unwrap();
        assert!(load(&dir).components.is_empty());
    }

    #[test]
    fn selected_for_prefers_the_selected_entry_over_newest() {
        let mut m = RuntimeManifest::default();
        m.upsert(component("php", "7.4", false));
        m.upsert(component("php", "8.4", true));
        assert_eq!(m.selected_for("php", None).unwrap().version, "8.4");
    }

    #[test]
    fn selected_for_without_a_flag_takes_the_newest() {
        let mut m = RuntimeManifest::default();
        m.upsert(component("php", "7.4", false));
        m.upsert(component("php", "8.4", false));
        assert_eq!(m.selected_for("php", None).unwrap().version, "8.4");
    }

    #[test]
    fn upsert_replaces_same_role_and_version() {
        let mut m = RuntimeManifest::default();
        m.upsert(component("nginx", "1.25.4", false));
        let mut newer = component("nginx", "1.25.4", false);
        newer.sha256 = "ff".repeat(32);
        m.upsert(newer);
        assert_eq!(m.components.len(), 1);
        assert_eq!(m.components[0].sha256, "ff".repeat(32));
    }

    #[test]
    fn round_trips_through_disk() {
        let dir = std::env::temp_dir().join("badami-manifest-roundtrip");
        let _ = fs::remove_dir_all(&dir);
        let mut m = RuntimeManifest::default();
        m.upsert(component("mariadb", "10.11.6", true));
        save(&dir, &m).unwrap();

        let back = load(&dir);
        assert_eq!(back.components.len(), 1);
        assert_eq!(back.components[0].version, "10.11.6");
        assert!(!back.updated_at.is_empty(), "save must stamp updated_at");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn schema_mismatch_is_ignored_rather_than_misread() {
        let dir = std::env::temp_dir().join("badami-manifest-schema");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let body = r#"{"schema":999,"updated_at":"","components":[{"role":"nginx","version":"1","binary":"/x","sha256":"00","source":"manual","arch":"arm64","installed_at":"","selected":true}]}"#;
        fs::write(manifest_path(&dir), body).unwrap();
        assert!(load(&dir).components.is_empty());
    }
}
