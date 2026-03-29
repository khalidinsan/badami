use ssh2::{Channel, Session};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

// All blocking SSH operations time out after this many seconds.
const SSH_TIMEOUT_SECS: u32 = 30;
// Send SSH keepalive every N seconds of inactivity to prevent server-side idle disconnect.
const SSH_KEEPALIVE_SECS: u32 = 60;

/// A live SSH shell session with a PTY channel.
struct LiveSshSession {
    session: Session,
    channel: Channel,
    _tcp: TcpStream,
    /// Set to true to signal the read thread to stop.
    cancel: Arc<AtomicBool>,
}

// SAFETY: ssh2::Session and Channel are internally reference-counted.
// We guard all access behind a Mutex, so no concurrent use occurs.
unsafe impl Send for LiveSshSession {}

type SessionMap = Arc<Mutex<HashMap<String, Arc<Mutex<LiveSshSession>>>>>;

pub struct SshState {
    sessions: SessionMap,
}

impl SshState {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl Default for SshState {
    fn default() -> Self {
        Self::new()
    }
}

/// Connect to an SSH server, open a PTY, and start streaming output back
/// to the frontend via Tauri events.
#[tauri::command]
pub async fn ssh_connect(
    app: AppHandle,
    session_id: String,
    host: String,
    port: u16,
    username: String,
    auth_type: String,
    password: Option<String>,
    pem_content: Option<String>,
    passphrase: Option<String>,
    cols: u32,
    rows: u32,
) -> Result<String, String> {
    // Cancel + evict any existing session with the same ID so the old read
    // thread stops before we start a new one.
    {
        let state = app.state::<SshState>();
        let mut sessions = state.sessions.lock().unwrap();
        if let Some(old) = sessions.remove(&session_id) {
            if let Ok(old) = old.lock() {
                old.cancel.store(true, Ordering::SeqCst);
            }
        }
    }

    let sid = session_id.clone();
    let app_handle = app.clone();

    let live = tokio::task::spawn_blocking(move || -> Result<LiveSshSession, String> {
        let addr = format!("{}:{}", host, port);
        let tcp = TcpStream::connect(&addr)
            .map_err(|e| format!("Connection failed: {}", e))?;

        // Set TCP-level timeouts so operations on a dead socket fail quickly.
        let tcp_timeout = Some(Duration::from_secs(SSH_TIMEOUT_SECS as u64));
        tcp.set_read_timeout(tcp_timeout)
            .map_err(|e| format!("TCP read timeout: {}", e))?;
        tcp.set_write_timeout(tcp_timeout)
            .map_err(|e| format!("TCP write timeout: {}", e))?;

        // Keep a clone for the session (ssh2 needs the stream to stay alive)
        let tcp_clone = tcp.try_clone()
            .map_err(|e| format!("TCP clone failed: {}", e))?;

        let mut session = Session::new()
            .map_err(|e| format!("SSH session error: {}", e))?;
        // ssh2-level timeout for every blocking operation (milliseconds).
        // This ensures ssh_resize (which temporarily sets blocking mode) cannot
        // hang forever on a dead connection and starve the tokio thread pool.
        session.set_timeout(SSH_TIMEOUT_SECS * 1_000);
        session.set_tcp_stream(tcp);
        session
            .handshake()
            .map_err(|e| format!("SSH handshake failed: {}", e))?;

        // Authenticate
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
        session.set_keepalive(false, SSH_KEEPALIVE_SECS);

        // Open a PTY channel
        let mut channel = session
            .channel_session()
            .map_err(|e| format!("Channel error: {}", e))?;

        channel
            .request_pty("xterm-256color", None, Some((cols, rows, 0, 0)))
            .map_err(|e| format!("PTY request failed: {}", e))?;

        channel
            .shell()
            .map_err(|e| format!("Shell request failed: {}", e))?;

        // Set channel to non-blocking for the read loop
        session.set_blocking(false);

        Ok(LiveSshSession {
            session,
            channel,
            _tcp: tcp_clone,
            cancel: Arc::new(AtomicBool::new(false)),
        })
    })
    .await
    .map_err(|e| format!("Task error: {}", e))??;

    let cancel = Arc::clone(&live.cancel);
    let live = Arc::new(Mutex::new(live));

    // Store session
    let state = app_handle.state::<SshState>();
    {
        let mut sessions = state.sessions.lock().unwrap();
        sessions.insert(sid.clone(), Arc::clone(&live));
    }

    // Spawn a background thread to read output from the channel and emit events
    let read_sid = sid.clone();
    let read_live = Arc::clone(&live);
    let read_sessions = Arc::clone(&state.sessions);
    let read_cancel = Arc::clone(&cancel);
    thread::spawn(move || {
        let event_name = format!("ssh-output-{}", read_sid);
        let mut buf = [0u8; 4096];
        loop {
            // Stop if cancelled (happens when ssh_disconnect is called or a new
            // connection replaces this session).
            if read_cancel.load(Ordering::SeqCst) {
                break;
            }

            let result = {
                let mut live = read_live.lock().unwrap();
                live.channel.read(&mut buf)
            };

            match result {
                Ok(0) => {
                    // Channel EOF — remote closed
                    let _ = app_handle.emit(&event_name, "\r\n[Connection closed]\r\n");
                    let _ = app_handle.emit(
                        &format!("ssh-status-{}", read_sid),
                        "disconnected",
                    );
                    let mut sessions = read_sessions.lock().unwrap();
                    sessions.remove(&read_sid);
                    break;
                }
                Ok(n) => {
                    // Convert bytes to string (terminal data may be partial UTF-8, so use lossy)
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_handle.emit(&event_name, &data);
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    // Non-blocking: no data yet, sleep briefly
                    thread::sleep(std::time::Duration::from_millis(10));
                }
                Err(_) => {
                    // Read error — connection likely dead
                    let _ = app_handle.emit(&event_name, "\r\n[Connection lost]\r\n");
                    let _ = app_handle.emit(
                        &format!("ssh-status-{}", read_sid),
                        "disconnected",
                    );
                    let mut sessions = read_sessions.lock().unwrap();
                    sessions.remove(&read_sid);
                    break;
                }
            }
        }
    });

    // Emit initial connected status
    let _ = app.emit(&format!("ssh-status-{}", sid), "connected");

    Ok(sid)
}

/// Write user input to the SSH channel.
#[tauri::command]
pub fn ssh_write(
    app: AppHandle,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let state = app.state::<SshState>();
    // Clone the Arc then release the sessions lock before blocking on SSH I/O.
    let live = {
        let sessions = state.sessions.lock().unwrap();
        sessions
            .get(&session_id)
            .ok_or("Session not found")?
            .clone()
    };
    let mut live = live.lock().unwrap();
    live.channel
        .write_all(data.as_bytes())
        .map_err(|e| format!("Write failed: {}", e))?;
    live.channel
        .flush()
        .map_err(|e| format!("Flush failed: {}", e))?;
    Ok(())
}

/// Resize the PTY window.
#[tauri::command]
pub fn ssh_resize(
    app: AppHandle,
    session_id: String,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    let state = app.state::<SshState>();
    let live = {
        let sessions = state.sessions.lock().unwrap();
        sessions
            .get(&session_id)
            .ok_or("Session not found")?
            .clone()
    };
    let mut live = live.lock().unwrap();
    // Temporarily enable blocking mode for the resize request.
    // IMPORTANT: restore non-blocking BEFORE returning, regardless of outcome,
    // so subsequent reads/writes use the correct mode.
    live.session.set_blocking(true);
    let result = live
        .channel
        .request_pty_size(cols, rows, None, None)
        .map_err(|e| format!("Resize failed: {}", e));
    // Always restore non-blocking, even when the operation failed or timed out.
    live.session.set_blocking(false);
    result
}

/// Disconnect an SSH session.
#[tauri::command]
pub fn ssh_disconnect(
    app: AppHandle,
    session_id: String,
) -> Result<(), String> {
    let state = app.state::<SshState>();
    let mut sessions = state.sessions.lock().unwrap();
    if let Some(live) = sessions.remove(&session_id) {
        if let Ok(mut live) = live.lock() {
            // Signal read thread to stop
            live.cancel.store(true, Ordering::SeqCst);
            let _ = live.channel.send_eof();
            let _ = live.channel.close();
            let _ = live.channel.wait_close();
        }
    }
    drop(sessions);
    let _ = app.emit(&format!("ssh-status-{}", session_id), "disconnected");
    Ok(())
}
