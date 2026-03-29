use bytesize::ByteSize;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use suppaftp::{FtpStream, NativeTlsConnector, NativeTlsFtpStream};
use tauri::{AppHandle, Emitter, Manager};

use super::sftp::FileEntry;

// FTP read/write timeout — prevents hanging on a dead connection.
const FTP_TIMEOUT_SECS: u64 = 30;

/// Wrapper for plain vs TLS FTP connections.
pub enum FtpConn {
    Plain(FtpStream),
    Tls(NativeTlsFtpStream),
}

unsafe impl Send for FtpConn {}

/// Dispatch a method call on whichever variant is active.
macro_rules! ftp_dispatch {
    ($self:expr, $method:ident $(, $arg:expr)*) => {
        match $self {
            FtpConn::Plain(s) => s.$method($($arg),*),
            FtpConn::Tls(s) => s.$method($($arg),*),
        }
    };
}

type FtpSessionMap = Arc<Mutex<HashMap<String, Arc<Mutex<FtpConn>>>>>;

pub struct FtpState {
    sessions: FtpSessionMap,
}

impl FtpState {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl Default for FtpState {
    fn default() -> Self {
        Self::new()
    }
}

/// Connect to an FTP/FTPS server.
#[tauri::command]
pub async fn ftp_connect(
    app: AppHandle,
    session_id: String,
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    use_tls: bool,
) -> Result<String, String> {
    let sid = session_id.clone();

    // Remove existing session
    {
        let state = app.state::<FtpState>();
        let mut sessions = state.sessions.lock().unwrap();
        if let Some(old) = sessions.remove(&sid) {
            if let Ok(mut s) = old.lock() {
                match &mut *s {
                    FtpConn::Plain(f) => { let _ = f.quit(); }
                    FtpConn::Tls(f) => { let _ = f.quit(); }
                }
            }
        }
    }

    let conn = tokio::task::spawn_blocking(move || -> Result<FtpConn, String> {
        let addr = format!("{}:{}", host, port);
        let pw = password.unwrap_or_default();

        if use_tls {
            let native_tls = suppaftp::native_tls::TlsConnector::new()
                .map_err(|e| format!("TLS init failed: {}", e))?;
            let ctx = NativeTlsConnector::from(native_tls);
            let mut ftp = NativeTlsFtpStream::connect_secure_implicit(&addr, ctx, &host)
                .map_err(|e| format!("FTPS connection failed: {}", e))?;
            ftp.login(&username, &pw)
                .map_err(|e| format!("FTP login failed: {}", e))?;
            ftp.transfer_type(suppaftp::types::FileType::Binary)
                .map_err(|e| format!("Transfer type error: {}", e))?;
            // Set timeouts on the underlying TcpStream to prevent infinite hang
            let timeout = Some(Duration::from_secs(FTP_TIMEOUT_SECS));
            ftp.get_ref().set_read_timeout(timeout).ok();
            ftp.get_ref().set_write_timeout(timeout).ok();
            Ok(FtpConn::Tls(ftp))
        } else {
            // Use connect_timeout for the initial TCP connection
            let addr_sa: std::net::SocketAddr = addr
                .parse()
                .map_err(|e| format!("Invalid address: {}", e))?;
            let mut ftp = FtpStream::connect_timeout(addr_sa, Duration::from_secs(FTP_TIMEOUT_SECS))
                .map_err(|e| format!("FTP connection failed: {}", e))?;
            ftp.login(&username, &pw)
                .map_err(|e| format!("FTP login failed: {}", e))?;
            ftp.transfer_type(suppaftp::types::FileType::Binary)
                .map_err(|e| format!("Transfer type error: {}", e))?;
            // Set read/write timeouts on the underlying TcpStream
            let timeout = Some(Duration::from_secs(FTP_TIMEOUT_SECS));
            ftp.get_ref().set_read_timeout(timeout).ok();
            ftp.get_ref().set_write_timeout(timeout).ok();
            Ok(FtpConn::Plain(ftp))
        }
    })
    .await
    .map_err(|e| format!("Task error: {}", e))??;

    let state = app.state::<FtpState>();
    let mut sessions = state.sessions.lock().unwrap();
    sessions.insert(sid.clone(), Arc::new(Mutex::new(conn)));

    Ok(sid)
}

/// Disconnect an FTP session.
#[tauri::command]
pub fn ftp_disconnect(app: AppHandle, session_id: String) -> Result<(), String> {
    let state = app.state::<FtpState>();
    let mut sessions = state.sessions.lock().unwrap();
    if let Some(conn) = sessions.remove(&session_id) {
        if let Ok(mut c) = conn.lock() {
            match &mut *c {
                FtpConn::Plain(f) => { let _ = f.quit(); }
                FtpConn::Tls(f) => { let _ = f.quit(); }
            }
        }
    }
    Ok(())
}

/// List directory contents via FTP.
#[tauri::command]
pub async fn ftp_list_dir(
    app: AppHandle,
    session_id: String,
    path: String,
) -> Result<Vec<FileEntry>, String> {
    let conn = get_ftp_conn(&app, &session_id)?;

    tokio::task::spawn_blocking(move || {
        let mut c = conn.lock().unwrap();

        ftp_dispatch!(&mut *c, cwd, &path)
            .map_err(|e| format!("CWD failed: {}", e))?;

        let list = ftp_dispatch!(&mut *c, list, None)
            .map_err(|e| format!("LIST failed: {}", e))?;

        let pwd = ftp_dispatch!(&mut *c, pwd).unwrap_or_else(|_| path.clone());

        let mut entries: Vec<FileEntry> = list
            .iter()
            .filter_map(|line| parse_ftp_list_line(line, &pwd))
            .collect();

        entries.sort_by(|a, b| {
            let dir_a = a.kind == "directory";
            let dir_b = b.kind == "directory";
            dir_b.cmp(&dir_a).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });

        Ok(entries)
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

/// Create a remote directory via FTP.
#[tauri::command]
pub async fn ftp_mkdir(
    app: AppHandle,
    session_id: String,
    path: String,
) -> Result<(), String> {
    let conn = get_ftp_conn(&app, &session_id)?;
    tokio::task::spawn_blocking(move || {
        let mut c = conn.lock().unwrap();
        ftp_dispatch!(&mut *c, mkdir, &path)
            .map_err(|e| format!("mkdir failed: {}", e))?;
        Ok(())
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

/// Rename/move a remote file via FTP.
#[tauri::command]
pub async fn ftp_rename(
    app: AppHandle,
    session_id: String,
    old_path: String,
    new_path: String,
) -> Result<(), String> {
    let conn = get_ftp_conn(&app, &session_id)?;
    tokio::task::spawn_blocking(move || {
        let mut c = conn.lock().unwrap();
        ftp_dispatch!(&mut *c, rename, &old_path, &new_path)
            .map_err(|e| format!("rename failed: {}", e))
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

/// Delete a remote file via FTP.
#[tauri::command]
pub async fn ftp_delete_file(
    app: AppHandle,
    session_id: String,
    path: String,
) -> Result<(), String> {
    let conn = get_ftp_conn(&app, &session_id)?;
    tokio::task::spawn_blocking(move || {
        let mut c = conn.lock().unwrap();
        ftp_dispatch!(&mut *c, rm, &path)
            .map_err(|e| format!("delete failed: {}", e))
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

/// Remove a remote directory via FTP.
#[tauri::command]
pub async fn ftp_rmdir(
    app: AppHandle,
    session_id: String,
    path: String,
) -> Result<(), String> {
    let conn = get_ftp_conn(&app, &session_id)?;
    tokio::task::spawn_blocking(move || {
        let mut c = conn.lock().unwrap();
        ftp_dispatch!(&mut *c, rmdir, &path)
            .map_err(|e| format!("rmdir failed: {}", e))
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

/// Download a file from FTP with progress events.
#[tauri::command]
pub async fn ftp_download(
    app: AppHandle,
    session_id: String,
    remote_path: String,
    local_path: String,
    transfer_id: String,
) -> Result<(), String> {
    let conn = get_ftp_conn(&app, &session_id)?;
    let app_h = app.clone();

    tokio::task::spawn_blocking(move || {
        let mut c = conn.lock().unwrap();

        let total_size = ftp_dispatch!(&mut *c, size, &remote_path).unwrap_or(0);

        let cursor = ftp_dispatch!(&mut *c, retr_as_buffer, &remote_path)
            .map_err(|e| format!("download failed: {}", e))?;
        let bytes = cursor.into_inner();

        std::fs::write(&local_path, &bytes)
            .map_err(|e| format!("local write failed: {}", e))?;

        let _ = app_h.emit(
            &format!("transfer-progress-{}", transfer_id),
            serde_json::json!({
                "transferred": bytes.len(),
                "total": total_size,
                "progress": 100,
            }),
        );

        Ok(())
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

/// Upload a file to FTP with progress events.
#[tauri::command]
pub async fn ftp_upload(
    app: AppHandle,
    session_id: String,
    local_path: String,
    remote_path: String,
    transfer_id: String,
) -> Result<(), String> {
    let conn = get_ftp_conn(&app, &session_id)?;
    let app_h = app.clone();

    tokio::task::spawn_blocking(move || {
        let mut c = conn.lock().unwrap();

        let data = std::fs::read(&local_path)
            .map_err(|e| format!("local read failed: {}", e))?;

        let total_size = data.len();
        let mut cursor = std::io::Cursor::new(data);

        ftp_dispatch!(&mut *c, put_file, &remote_path, &mut cursor)
            .map_err(|e| format!("upload failed: {}", e))?;

        let _ = app_h.emit(
            &format!("transfer-progress-{}", transfer_id),
            serde_json::json!({
                "transferred": total_size,
                "total": total_size,
                "progress": 100,
            }),
        );

        Ok(())
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

// ── Helpers ──────────────────────────────────────────────────────────

fn get_ftp_conn(
    app: &AppHandle,
    session_id: &str,
) -> Result<Arc<Mutex<FtpConn>>, String> {
    let state = app.state::<FtpState>();
    let sessions = state.sessions.lock().unwrap();
    sessions
        .get(session_id)
        .cloned()
        .ok_or_else(|| "FTP session not found".to_string())
}

/// Parse a Unix-style FTP LIST line into a FileEntry.
fn parse_ftp_list_line(line: &str, parent_path: &str) -> Option<FileEntry> {
    // Unix format: drwxr-xr-x  2 owner group  4096 Jan  1 12:00 filename
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() < 9 {
        return None;
    }

    let perms = parts[0];
    let owner = parts[2].to_string();
    let size: u64 = parts[4].parse().unwrap_or(0);

    // Name = everything from part[8] onward (may contain spaces)
    let name = parts[8..].join(" ");
    if name == "." || name == ".." {
        return None;
    }

    // Handle symlinks: "name -> target"
    let display_name = if let Some(idx) = name.find(" -> ") {
        name[..idx].to_string()
    } else {
        name.clone()
    };

    let kind = match perms.chars().next()? {
        'd' => "directory",
        'l' => "symlink",
        _ => "file",
    };

    let full_path = if parent_path.ends_with('/') {
        format!("{}{}", parent_path, display_name)
    } else {
        format!("{}/{}", parent_path, display_name)
    };

    // Date part: parts[5..8] e.g. "Jan  1 12:00" or "Jan  1  2024"
    let date_str = format!("{} {} {}", parts[5], parts[6], parts[7]);

    Some(FileEntry {
        name: display_name.clone(),
        path: full_path,
        size,
        size_formatted: ByteSize(size).to_string(),
        kind: kind.to_string(),
        permissions: perms.to_string(),
        owner,
        modified_at: date_str,
        is_hidden: display_name.starts_with('.'),
    })
}
