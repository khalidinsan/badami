use ssh2::Session;
use std::net::TcpStream;

#[tauri::command]
pub async fn test_server_connection(
    host: String,
    port: u16,
    username: String,
    auth_type: String,
    password: Option<String>,
    pem_content: Option<String>,
    passphrase: Option<String>,
) -> Result<String, String> {
    // Run blocking SSH in a spawn_blocking so we don't block the async runtime
    tokio::task::spawn_blocking(move || {
        let addr = format!("{}:{}", host, port);
        let tcp = TcpStream::connect(&addr)
            .map_err(|e| format!("Connection failed: {}", e))?;
        tcp.set_read_timeout(Some(std::time::Duration::from_secs(10)))
            .ok();

        let mut session = Session::new()
            .map_err(|e| format!("SSH session error: {}", e))?;
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

        if session.authenticated() {
            Ok("Connected successfully".to_string())
        } else {
            Err("Authentication failed".to_string())
        }
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}
