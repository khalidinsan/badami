use ssh2::{Channel, ErrorCode, Session};
use std::collections::HashMap;
use std::io::{ErrorKind, Read, Write};
use std::net::TcpStream;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

// All blocking SSH operations time out after this many seconds.
const SSH_TIMEOUT_SECS: u32 = 30;
// Default SSH keepalive interval (seconds of inactivity).
const SSH_KEEPALIVE_SECS: u32 = 15;
// How often the read loop polls when idle. 1ms keeps typing echo snappy
// without burning a full core (we only spin this hard while the session lives).
const READ_POLL_MS: u64 = 1;
// Max bytes drained/emitted per read-loop wake to bound event size.
const READ_BUF_SIZE: usize = 32 * 1024;
// How long a non-blocking write may retry on WouldBlock before giving up.
const WRITE_RETRY_TIMEOUT: Duration = Duration::from_secs(5);

/// A live SSH shell session with a PTY channel.
struct LiveSshSession {
    session: Session,
    channel: Channel,
    _tcp: TcpStream,
    /// Set to true to signal the read thread to stop.
    cancel: Arc<AtomicBool>,
    /// Configured keepalive interval (seconds).
    keepalive_secs: u32,
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

/// libssh2 `LIBSSH2_ERROR_EAGAIN` (-37) — operation would block in non-blocking mode.
fn is_again(err: &ssh2::Error) -> bool {
    // Prefer the typed code; fall back to message for older bindings.
    match err.code() {
        ErrorCode::Session(-37) => true,
        _ => {
            let msg = err.message();
            msg.contains("would block") || msg.contains("EAGAIN")
        }
    }
}

/// True when an I/O error is the non-blocking "try again" signal.
fn io_would_block(err: &std::io::Error) -> bool {
    err.kind() == ErrorKind::WouldBlock
        || err.kind() == ErrorKind::TimedOut
        || err.to_string().contains("would block")
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
    keepalive_secs: Option<u32>,
) -> Result<String, String> {
    // Clamp to a sane range; treat None/0 as the default.
    let keepalive_interval = match keepalive_secs {
        Some(s) if s > 0 => s.clamp(5, 300),
        _ => SSH_KEEPALIVE_SECS,
    };

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

        // Disable Nagle so interactive keystrokes are not delayed.
        tcp.set_nodelay(true).ok();

        // Keep a clone for the session (ssh2 needs the stream to stay alive)
        let tcp_clone = tcp
            .try_clone()
            .map_err(|e| format!("TCP clone failed: {}", e))?;

        let mut session =
            Session::new().map_err(|e| format!("SSH session error: {}", e))?;
        // Timeout only matters for the rare ops we still run blocking
        // (handshake/auth above, exec_command). The interactive path stays
        // non-blocking forever after connect — flipping modes races the
        // reader and was a source of spurious "Connection lost".
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

        // want_reply=false: we only need to keep NAT/firewall mappings warm.
        // want_reply=true in non-blocking mode returns EAGAIN mid-flight and
        // previously killed sessions when we treated any Err as fatal.
        session.set_keepalive(false, keepalive_interval);

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

        // Interactive path is non-blocking for the lifetime of the session.
        session.set_blocking(false);

        Ok(LiveSshSession {
            session,
            channel,
            _tcp: tcp_clone,
            cancel: Arc::new(AtomicBool::new(false)),
            keepalive_secs: keepalive_interval,
        })
    })
    .await
    .map_err(|e| format!("Task error: {}", e))??;

    let cancel = Arc::clone(&live.cancel);
    let keepalive_secs = live.keepalive_secs;
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
        let mut buf = vec![0u8; READ_BUF_SIZE];
        // First keepalive check soon after connect, then honor returned seconds.
        let mut next_keepalive = Instant::now() + Duration::from_secs(keepalive_secs.max(5) as u64);

        enum Tick {
            /// Coalesced payload ready to emit (may be empty if only keepalive ran).
            Chunk(String),
            Eof,
            Idle,
            Dead(&'static str),
        }

        loop {
            if read_cancel.load(Ordering::SeqCst) {
                break;
            }

            let tick = {
                let mut live = match read_live.lock() {
                    Ok(g) => g,
                    Err(_) => break,
                };

                // Keepalive on a timer — NEVER every poll tick. In non-blocking
                // mode keepalive_send returns EAGAIN when a packet is in flight;
                // that is normal and must not kill the session.
                if Instant::now() >= next_keepalive {
                    match live.session.keepalive_send() {
                        Ok(secs_until_next) => {
                            let wait = (secs_until_next as u64).clamp(1, keepalive_secs.max(5) as u64);
                            next_keepalive = Instant::now() + Duration::from_secs(wait);
                        }
                        Err(ref e) if is_again(e) => {
                            // Packet in flight — retry shortly.
                            next_keepalive = Instant::now() + Duration::from_secs(1);
                        }
                        Err(_) => {
                            // Real failure (socket dead, etc.)
                            // Fall through only if channel also looks dead; a
                            // lone keepalive error while the channel still
                            // reads is rare — treat as soft and back off.
                            next_keepalive = Instant::now() + Duration::from_secs(5);
                        }
                    }
                }

                // Drain as much as is immediately available so a burst of
                // shell output becomes one IPC event instead of dozens.
                let mut acc = Vec::new();
                let mut saw_eof = false;
                let mut fatal: Option<&'static str> = None;

                loop {
                    match live.channel.read(&mut buf) {
                        Ok(0) => {
                            // libssh2 reports EOF as Ok(0) only when channel.eof().
                            saw_eof = true;
                            break;
                        }
                        Ok(n) => {
                            acc.extend_from_slice(&buf[..n]);
                            // Cap one emit so we release the lock & emit promptly.
                            if acc.len() >= READ_BUF_SIZE {
                                break;
                            }
                        }
                        Err(ref e) if io_would_block(e) => break,
                        Err(ref e)
                            if e.kind() == ErrorKind::ConnectionReset
                                || e.kind() == ErrorKind::BrokenPipe
                                || e.kind() == ErrorKind::ConnectionAborted =>
                        {
                            fatal = Some("Connection reset by peer");
                            break;
                        }
                        Err(_) => {
                            // Many libssh2 transient codes map to Other. Only
                            // declare death if the channel has actually EOFed
                            // or the socket is gone — otherwise keep polling.
                            if live.channel.eof() {
                                saw_eof = true;
                            } else {
                                // Soft error: don't kill. Brief idle.
                                fatal = None;
                            }
                            break;
                        }
                    }
                }

                if let Some(reason) = fatal {
                    Tick::Dead(reason)
                } else if saw_eof && acc.is_empty() {
                    Tick::Eof
                } else if acc.is_empty() {
                    Tick::Idle
                } else {
                    Tick::Chunk(String::from_utf8_lossy(&acc).into_owned())
                }
            };

            match tick {
                Tick::Eof => {
                    let _ = app_handle.emit(&event_name, "\r\n[Connection closed]\r\n");
                    let _ = app_handle.emit(
                        &format!("ssh-status-{}", read_sid),
                        "disconnected",
                    );
                    let mut sessions = read_sessions.lock().unwrap();
                    sessions.remove(&read_sid);
                    break;
                }
                Tick::Chunk(data) => {
                    let _ = app_handle.emit(&event_name, &data);
                    // Hot path: don't sleep — immediately try to read more.
                }
                Tick::Idle => {
                    thread::sleep(Duration::from_millis(READ_POLL_MS));
                }
                Tick::Dead(reason) => {
                    let _ = app_handle.emit(
                        &event_name,
                        &format!("\r\n[{}]\r\n", reason),
                    );
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
///
/// Stays in non-blocking mode for the whole call. Flipping to blocking on
/// every keystroke raced the reader and added multi-ms latency per char.
#[tauri::command]
pub fn ssh_write(
    app: AppHandle,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let state = app.state::<SshState>();
    let live_arc = {
        let sessions = state.sessions.lock().unwrap();
        sessions
            .get(&session_id)
            .ok_or("Session not found")?
            .clone()
    };

    let bytes = data.into_bytes();
    if bytes.is_empty() {
        return Ok(());
    }

    let deadline = Instant::now() + WRITE_RETRY_TIMEOUT;
    let mut offset = 0usize;

    while offset < bytes.len() {
        // Scope the lock so we can drop it on WouldBlock and let the reader run
        // (which frees SSH window space the write may be waiting on).
        let write_result = {
            let mut live = live_arc
                .lock()
                .map_err(|_| "Session lock poisoned".to_string())?;
            live.session.set_blocking(false);
            live.channel.write(&bytes[offset..])
        };

        match write_result {
            Ok(0) => return Err("Write returned 0 bytes".into()),
            Ok(n) => offset += n,
            Err(ref e) if io_would_block(e) => {
                if Instant::now() >= deadline {
                    return Err("Write timed out".into());
                }
                thread::sleep(Duration::from_micros(200));
            }
            Err(e) => return Err(format!("Write failed: {}", e)),
        }
    }

    // Do NOT flush on every keystroke — libssh2 already pushes data on write
    // for interactive channels, and flush is a full round-trip that made
    // typing feel lagged.
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
    let mut live = live.lock().map_err(|_| "Session lock poisoned".to_string())?;

    // Non-blocking resize with a short retry — avoids the blocking-mode flip.
    live.session.set_blocking(false);
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        match live.channel.request_pty_size(cols, rows, None, None) {
            Ok(()) => return Ok(()),
            Err(ref e) if is_again(e) => {
                if Instant::now() >= deadline {
                    return Err("Resize timed out".into());
                }
                thread::sleep(Duration::from_millis(5));
            }
            Err(e) => return Err(format!("Resize failed: {}", e)),
        }
    }
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
            // Best-effort close; ignore errors on a half-dead socket.
            live.session.set_blocking(false);
            let _ = live.channel.send_eof();
            let _ = live.channel.close();
        }
    }
    drop(sessions);
    let _ = app.emit(&format!("ssh-status-{}", session_id), "disconnected");
    Ok(())
}

/// Execute a single command on an existing SSH session and return stdout.
/// This uses a new exec channel (separate from the PTY shell channel).
#[tauri::command]
pub async fn ssh_exec_command(
    app: AppHandle,
    session_id: String,
    command: String,
) -> Result<String, String> {
    let state = app.state::<SshState>();
    let live = {
        let sessions = state.sessions.lock().unwrap();
        sessions
            .get(&session_id)
            .ok_or("Session not found — connect via terminal first")?
            .clone()
    };

    let result = tokio::task::spawn_blocking(move || -> Result<String, String> {
        let mut live = live.lock().map_err(|_| "Session lock poisoned".to_string())?;
        // Exec needs blocking semantics; isolate it and always restore.
        live.session.set_blocking(true);
        let exec_result = (|| {
            let mut channel = live
                .session
                .channel_session()
                .map_err(|e| format!("Channel error: {e}"))?;
            channel
                .exec(&command)
                .map_err(|e| format!("Exec error: {e}"))?;

            let mut output = String::new();
            channel
                .read_to_string(&mut output)
                .map_err(|e| format!("Read error: {e}"))?;

            let mut stderr_out = String::new();
            channel.stderr().read_to_string(&mut stderr_out).ok();

            channel.wait_close().ok();

            if !stderr_out.is_empty() && output.is_empty() {
                Ok(stderr_out)
            } else {
                Ok(output)
            }
        })();
        live.session.set_blocking(false);
        exec_result
    })
    .await
    .map_err(|e| format!("Task error: {e}"))??;

    Ok(result)
}
