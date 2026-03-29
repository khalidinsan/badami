use bytesize::ByteSize;
use serde::Serialize;
use ssh2::Session;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

// All blocking SSH/SFTP operations time out after this many seconds.
// Prevents the app from freezing when the server closes an idle connection.
const SSH_TIMEOUT_SECS: u32 = 30;
// Send an SSH keepalive every N seconds to prevent server-side idle disconnect.
const SSH_KEEPALIVE_SECS: u32 = 60;

/// Represents a remote file/directory entry.
#[derive(Debug, Clone, Serialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub size_formatted: String,
    pub kind: String, // "file" | "directory" | "symlink"
    pub permissions: String,
    pub owner: String,
    pub modified_at: String,
    pub is_hidden: bool,
}

/// An authenticated SFTP session.
struct SftpConnection {
    session: Session,
    _tcp: TcpStream,
}

unsafe impl Send for SftpConnection {}

type SftpSessionMap = Arc<Mutex<HashMap<String, Arc<Mutex<SftpConnection>>>>>;

pub struct SftpState {
    sessions: SftpSessionMap,
}

impl SftpState {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl Default for SftpState {
    fn default() -> Self {
        Self::new()
    }
}

fn unix_mode_to_string(mode: u32) -> String {
    let mut s = String::with_capacity(10);
    let kinds = mode & 0o170000;
    s.push(match kinds {
        0o040000 => 'd',
        0o120000 => 'l',
        _ => '-',
    });
    for shift in [6, 3, 0] {
        let bits = (mode >> shift) & 7;
        s.push(if bits & 4 != 0 { 'r' } else { '-' });
        s.push(if bits & 2 != 0 { 'w' } else { '-' });
        s.push(if bits & 1 != 0 { 'x' } else { '-' });
    }
    s
}

fn format_time(secs: u64) -> String {
    let dt = chrono::DateTime::from_timestamp(secs as i64, 0);
    match dt {
        Some(d) => d.format("%Y-%m-%d %H:%M:%S").to_string(),
        None => String::new(),
    }
}

/// Connect to an SSH server for SFTP operations.
#[tauri::command]
pub async fn sftp_connect(
    app: AppHandle,
    session_id: String,
    host: String,
    port: u16,
    username: String,
    auth_type: String,
    password: Option<String>,
    pem_content: Option<String>,
    passphrase: Option<String>,
) -> Result<String, String> {
    let sid = session_id.clone();

    // Cancel any existing session with the same ID
    {
        let state = app.state::<SftpState>();
        let mut sessions = state.sessions.lock().unwrap();
        sessions.remove(&sid);
    }

    let conn = tokio::task::spawn_blocking(move || -> Result<SftpConnection, String> {
        let addr = format!("{}:{}", host, port);
        let tcp = TcpStream::connect(&addr)
            .map_err(|e| format!("Connection failed: {}", e))?;

        // Set TCP-level timeouts so that operations on a dead connection fail
        // instead of blocking forever (prevents the black-screen freeze).
        let timeout = Some(Duration::from_secs(SSH_TIMEOUT_SECS as u64));
        tcp.set_read_timeout(timeout)
            .map_err(|e| format!("TCP read timeout error: {}", e))?;
        tcp.set_write_timeout(timeout)
            .map_err(|e| format!("TCP write timeout error: {}", e))?;

        let tcp_clone = tcp.try_clone()
            .map_err(|e| format!("TCP clone failed: {}", e))?;

        let mut session = Session::new()
            .map_err(|e| format!("SSH session error: {}", e))?;
        // ssh2-level timeout for every blocking socket call (milliseconds).
        session.set_timeout(SSH_TIMEOUT_SECS * 1_000);
        session.set_tcp_stream(tcp);
        session
            .handshake()
            .map_err(|e| format!("SSH handshake failed: {}", e))?;

        match auth_type.as_str() {
            "password" => {
                let pw = password.ok_or("Password required")?;
                session
                    .userauth_password(&username, &pw)
                    .map_err(|e| format!("Auth failed: {}", e))?;
            }
            "pem_file" | "pem_saved" => {
                let pem = pem_content.ok_or("PEM key content required")?;
                session
                    .userauth_pubkey_memory(&username, None, &pem, None)
                    .map_err(|e| format!("Auth failed: {}", e))?;
            }
            "pem_passphrase" => {
                let pem = pem_content.ok_or("PEM key content required")?;
                let pp = passphrase.as_deref();
                session
                    .userauth_pubkey_memory(&username, None, &pem, pp)
                    .map_err(|e| format!("Auth failed: {}", e))?;
            }
            _ => return Err(format!("Unknown auth type: {}", auth_type)),
        }

        if !session.authenticated() {
            return Err("Authentication failed".to_string());
        }

        // Enable SSH-level keepalive so the server does not drop idle sessions.
        // This fires every SSH_KEEPALIVE_SECS seconds of inactivity.
        session.set_keepalive(false, SSH_KEEPALIVE_SECS);

        // Verify SFTP subsystem works
        session
            .sftp()
            .map_err(|e| format!("SFTP subsystem error: {}", e))?;

        Ok(SftpConnection {
            session,
            _tcp: tcp_clone,
        })
    })
    .await
    .map_err(|e| format!("Task error: {}", e))??;

    let state = app.state::<SftpState>();
    let mut sessions = state.sessions.lock().unwrap();
    sessions.insert(sid.clone(), Arc::new(Mutex::new(conn)));

    Ok(sid)
}

/// Disconnect an SFTP session.
#[tauri::command]
pub fn sftp_disconnect(app: AppHandle, session_id: String) -> Result<(), String> {
    let state = app.state::<SftpState>();
    let mut sessions = state.sessions.lock().unwrap();
    sessions.remove(&session_id);
    Ok(())
}

/// List directory contents via SFTP.
#[tauri::command]
pub async fn sftp_list_dir(
    app: AppHandle,
    session_id: String,
    path: String,
) -> Result<Vec<FileEntry>, String> {
    let state = app.state::<SftpState>();
    let conn = {
        let sessions = state.sessions.lock().unwrap();
        sessions
            .get(&session_id)
            .ok_or("SFTP session not found")?
            .clone()
    };

    tokio::task::spawn_blocking(move || {
        let conn = conn.lock().unwrap();
        conn.session.set_blocking(true);
        let sftp = conn
            .session
            .sftp()
            .map_err(|e| format!("SFTP error: {}", e))?;

        let dir_path = std::path::Path::new(&path);
        let entries = sftp
            .readdir(dir_path)
            .map_err(|e| format!("readdir failed: {}", e))?;

        let mut result: Vec<FileEntry> = entries
            .into_iter()
            .filter_map(|(pathbuf, stat)| {
                let name = pathbuf.file_name()?.to_string_lossy().to_string();
                if name == "." || name == ".." {
                    return None;
                }
                let full_path = if path.ends_with('/') {
                    format!("{}{}", path, name)
                } else {
                    format!("{}/{}", path, name)
                };
                let kind = if stat.is_dir() {
                    "directory"
                } else if stat.file_type().is_symlink() {
                    "symlink"
                } else {
                    "file"
                };
                let size = stat.size.unwrap_or(0);
                let perms = stat.perm.map(unix_mode_to_string).unwrap_or_default();
                let uid = stat.uid.unwrap_or(0);
                let mtime = stat.mtime.unwrap_or(0);

                Some(FileEntry {
                    name: name.clone(),
                    path: full_path,
                    size,
                    size_formatted: ByteSize(size).to_string(),
                    kind: kind.to_string(),
                    permissions: perms,
                    owner: uid.to_string(),
                    modified_at: format_time(mtime),
                    is_hidden: name.starts_with('.'),
                })
            })
            .collect();

        // Sort: directories first, then by name
        result.sort_by(|a, b| {
            let dir_a = a.kind == "directory";
            let dir_b = b.kind == "directory";
            dir_b.cmp(&dir_a).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });

        Ok(result)
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

/// Create a directory via SFTP.
#[tauri::command]
pub async fn sftp_mkdir(
    app: AppHandle,
    session_id: String,
    path: String,
) -> Result<(), String> {
    let conn = get_sftp_conn(&app, &session_id)?;
    tokio::task::spawn_blocking(move || {
        let conn = conn.lock().unwrap();
        conn.session.set_blocking(true);
        let sftp = conn.session.sftp().map_err(|e| format!("SFTP error: {}", e))?;
        sftp.mkdir(Path::new(&path), 0o755)
            .map_err(|e| format!("mkdir failed: {}", e))
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

/// Rename/move a remote file or directory.
#[tauri::command]
pub async fn sftp_rename(
    app: AppHandle,
    session_id: String,
    old_path: String,
    new_path: String,
) -> Result<(), String> {
    let conn = get_sftp_conn(&app, &session_id)?;
    tokio::task::spawn_blocking(move || {
        let conn = conn.lock().unwrap();
        conn.session.set_blocking(true);
        let sftp = conn.session.sftp().map_err(|e| format!("SFTP error: {}", e))?;
        sftp.rename(Path::new(&old_path), Path::new(&new_path), None)
            .map_err(|e| format!("rename failed: {}", e))
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

/// Delete a remote file.
#[tauri::command]
pub async fn sftp_delete_file(
    app: AppHandle,
    session_id: String,
    path: String,
) -> Result<(), String> {
    let conn = get_sftp_conn(&app, &session_id)?;
    tokio::task::spawn_blocking(move || {
        let conn = conn.lock().unwrap();
        conn.session.set_blocking(true);
        let sftp = conn.session.sftp().map_err(|e| format!("SFTP error: {}", e))?;
        sftp.unlink(Path::new(&path))
            .map_err(|e| format!("delete failed: {}", e))
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

/// Delete a remote directory (must be empty).
#[tauri::command]
pub async fn sftp_rmdir(
    app: AppHandle,
    session_id: String,
    path: String,
) -> Result<(), String> {
    let conn = get_sftp_conn(&app, &session_id)?;
    tokio::task::spawn_blocking(move || {
        let conn = conn.lock().unwrap();
        conn.session.set_blocking(true);
        let sftp = conn.session.sftp().map_err(|e| format!("SFTP error: {}", e))?;
        sftp.rmdir(Path::new(&path))
            .map_err(|e| format!("rmdir failed: {}", e))
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

/// Read a remote text file (for inline editing).
#[tauri::command]
pub async fn sftp_read_file(
    app: AppHandle,
    session_id: String,
    path: String,
) -> Result<String, String> {
    let conn = get_sftp_conn(&app, &session_id)?;
    tokio::task::spawn_blocking(move || {
        let conn = conn.lock().unwrap();
        conn.session.set_blocking(true);
        let sftp = conn.session.sftp().map_err(|e| format!("SFTP error: {}", e))?;
        let mut file = sftp
            .open(Path::new(&path))
            .map_err(|e| format!("open failed: {}", e))?;
        let mut contents = String::new();
        file.read_to_string(&mut contents)
            .map_err(|e| format!("read failed: {}", e))?;
        Ok(contents)
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

/// Write content to a remote text file.
#[tauri::command]
pub async fn sftp_write_file(
    app: AppHandle,
    session_id: String,
    path: String,
    content: String,
) -> Result<(), String> {
    let conn = get_sftp_conn(&app, &session_id)?;
    tokio::task::spawn_blocking(move || {
        let conn = conn.lock().unwrap();
        conn.session.set_blocking(true);
        let sftp = conn.session.sftp().map_err(|e| format!("SFTP error: {}", e))?;
        let mut file = sftp
            .create(Path::new(&path))
            .map_err(|e| format!("create failed: {}", e))?;
        file.write_all(content.as_bytes())
            .map_err(|e| format!("write failed: {}", e))?;
        Ok(())
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

/// Download a remote file to a local path, with progress events.
#[tauri::command]
pub async fn sftp_download(
    app: AppHandle,
    session_id: String,
    remote_path: String,
    local_path: String,
    transfer_id: String,
) -> Result<(), String> {
    let conn = get_sftp_conn(&app, &session_id)?;
    let app_h = app.clone();

    tokio::task::spawn_blocking(move || {
        let conn = conn.lock().unwrap();
        conn.session.set_blocking(true);
        let sftp = conn.session.sftp().map_err(|e| format!("SFTP error: {}", e))?;

        let stat = sftp
            .stat(Path::new(&remote_path))
            .map_err(|e| format!("stat failed: {}", e))?;
        let total_size = stat.size.unwrap_or(0);

        let mut remote_file = sftp
            .open(Path::new(&remote_path))
            .map_err(|e| format!("open failed: {}", e))?;

        let mut local_file = std::fs::File::create(&local_path)
            .map_err(|e| format!("local create failed: {}", e))?;

        let mut buf = [0u8; 32768];
        let mut transferred: u64 = 0;

        loop {
            let n = remote_file
                .read(&mut buf)
                .map_err(|e| format!("read error: {}", e))?;
            if n == 0 {
                break;
            }
            local_file
                .write_all(&buf[..n])
                .map_err(|e| format!("write error: {}", e))?;
            transferred += n as u64;

            let progress = if total_size > 0 {
                ((transferred as f64 / total_size as f64) * 100.0) as u32
            } else {
                0
            };
            let _ = app_h.emit(
                &format!("transfer-progress-{}", transfer_id),
                serde_json::json!({
                    "transferred": transferred,
                    "total": total_size,
                    "progress": progress,
                }),
            );
        }

        let _ = app_h.emit(
            &format!("transfer-progress-{}", transfer_id),
            serde_json::json!({ "transferred": total_size, "total": total_size, "progress": 100 }),
        );

        Ok(())
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

/// Upload a local file to a remote path, with progress events.
#[tauri::command]
pub async fn sftp_upload(
    app: AppHandle,
    session_id: String,
    local_path: String,
    remote_path: String,
    transfer_id: String,
) -> Result<(), String> {
    let conn = get_sftp_conn(&app, &session_id)?;
    let app_h = app.clone();

    tokio::task::spawn_blocking(move || {
        let conn = conn.lock().unwrap();
        conn.session.set_blocking(true);
        let sftp = conn.session.sftp().map_err(|e| format!("SFTP error: {}", e))?;

        let metadata = std::fs::metadata(&local_path)
            .map_err(|e| format!("local stat failed: {}", e))?;
        let total_size = metadata.len();

        let mut local_file = std::fs::File::open(&local_path)
            .map_err(|e| format!("local open failed: {}", e))?;

        let mut remote_file = sftp
            .create(Path::new(&remote_path))
            .map_err(|e| format!("remote create failed: {}", e))?;

        let mut buf = [0u8; 32768];
        let mut transferred: u64 = 0;

        loop {
            let n = local_file
                .read(&mut buf)
                .map_err(|e| format!("read error: {}", e))?;
            if n == 0 {
                break;
            }
            remote_file
                .write_all(&buf[..n])
                .map_err(|e| format!("write error: {}", e))?;
            transferred += n as u64;

            let progress = if total_size > 0 {
                ((transferred as f64 / total_size as f64) * 100.0) as u32
            } else {
                0
            };
            let _ = app_h.emit(
                &format!("transfer-progress-{}", transfer_id),
                serde_json::json!({
                    "transferred": transferred,
                    "total": total_size,
                    "progress": progress,
                }),
            );
        }

        let _ = app_h.emit(
            &format!("transfer-progress-{}", transfer_id),
            serde_json::json!({ "transferred": total_size, "total": total_size, "progress": 100 }),
        );

        Ok(())
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

/// Stat a single remote path.
#[tauri::command]
pub async fn sftp_stat(
    app: AppHandle,
    session_id: String,
    path: String,
) -> Result<FileEntry, String> {
    let conn = get_sftp_conn(&app, &session_id)?;
    tokio::task::spawn_blocking(move || {
        let conn = conn.lock().unwrap();
        conn.session.set_blocking(true);
        let sftp = conn.session.sftp().map_err(|e| format!("SFTP error: {}", e))?;
        let stat = sftp
            .stat(Path::new(&path))
            .map_err(|e| format!("stat failed: {}", e))?;

        let name = Path::new(&path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| path.clone());
        let kind = if stat.is_dir() {
            "directory"
        } else if stat.file_type().is_symlink() {
            "symlink"
        } else {
            "file"
        };
        let size = stat.size.unwrap_or(0);

        Ok(FileEntry {
            name: name.clone(),
            path: path.clone(),
            size,
            size_formatted: ByteSize(size).to_string(),
            kind: kind.to_string(),
            permissions: stat.perm.map(unix_mode_to_string).unwrap_or_default(),
            owner: stat.uid.unwrap_or(0).to_string(),
            modified_at: format_time(stat.mtime.unwrap_or(0)),
            is_hidden: name.starts_with('.'),
        })
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

// ── Helper ───────────────────────────────────────────────────────────

fn get_sftp_conn(
    app: &AppHandle,
    session_id: &str,
) -> Result<Arc<Mutex<SftpConnection>>, String> {
    let state = app.state::<SftpState>();
    let sessions = state.sessions.lock().unwrap();
    sessions
        .get(session_id)
        .cloned()
        .ok_or_else(|| "SFTP session not found".to_string())
}
