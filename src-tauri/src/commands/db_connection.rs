use serde::{Deserialize, Serialize};
use sqlx::{
    mysql::MySqlPoolOptions,
    postgres::PgPoolOptions,
    MySqlPool, PgPool,
};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

// ── Pool enum ───────────────────────────────────────────────────────

pub enum DbPool {
    MySQL(MySqlPool),
    Postgres(PgPool),
    Sqlite(Arc<libsql::Database>),
}

impl DbPool {
    pub fn engine_name(&self) -> &'static str {
        match self {
            DbPool::MySQL(_) => "mysql",
            DbPool::Postgres(_) => "postgresql",
            DbPool::Sqlite(_) => "sqlite",
        }
    }
}

// ── State ───────────────────────────────────────────────────────────

pub struct DbClientState {
    pub pools: Arc<Mutex<HashMap<String, DbPool>>>,
}

impl DbClientState {
    pub fn new() -> Self {
        Self {
            pools: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

// ── Param / Result types ────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct ConnectParams {
    pub connection_id: String,
    pub engine: String,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub database_name: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub sqlite_file_path: Option<String>,
    // SSL
    pub use_ssl: Option<bool>,
    pub ssl_mode: Option<String>,
    pub ssl_ca_path: Option<String>,
    // SSH tunnel – the frontend opens the tunnel before calling connect,
    // so we receive the local forwarded port here.
    pub tunnel_local_port: Option<u16>,
}

#[derive(Debug, Serialize)]
pub struct ConnectionTestResult {
    pub success: bool,
    pub message: String,
    pub latency_ms: u64,
}

// ── Commands ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn dbc_connect(
    state: tauri::State<'_, DbClientState>,
    params: ConnectParams,
) -> Result<String, String> {
    let pool_id = params.connection_id.clone();

    let effective_host = if params.tunnel_local_port.is_some() {
        "127.0.0.1".to_string()
    } else {
        params.host.clone().unwrap_or_default()
    };
    let effective_port = params
        .tunnel_local_port
        .or(params.port)
        .unwrap_or(match params.engine.as_str() {
            "mysql" | "mariadb" => 3306,
            "postgresql" => 5432,
            _ => 0,
        });

    let pool = match params.engine.as_str() {
        "mysql" | "mariadb" => {
            let url = format!(
                "mysql://{}:{}@{}:{}/{}",
                params.username.as_deref().unwrap_or("root"),
                params.password.as_deref().unwrap_or(""),
                effective_host,
                effective_port,
                params.database_name.as_deref().unwrap_or(""),
            );
            let p = MySqlPoolOptions::new()
                .max_connections(5)
                .acquire_timeout(std::time::Duration::from_secs(10))
                .connect(&url)
                .await
                .map_err(|e| format!("MySQL connection failed: {e}"))?;
            DbPool::MySQL(p)
        }
        "postgresql" => {
            let ssl_mode = params.ssl_mode.as_deref().unwrap_or("prefer");
            let url = format!(
                "postgres://{}:{}@{}:{}/{}?sslmode={}",
                params.username.as_deref().unwrap_or("postgres"),
                params.password.as_deref().unwrap_or(""),
                effective_host,
                effective_port,
                params.database_name.as_deref().unwrap_or(""),
                ssl_mode,
            );
            let p = PgPoolOptions::new()
                .max_connections(5)
                .acquire_timeout(std::time::Duration::from_secs(10))
                .connect(&url)
                .await
                .map_err(|e| format!("PostgreSQL connection failed: {e}"))?;
            DbPool::Postgres(p)
        }
        "sqlite" => {
            let path = params
                .sqlite_file_path
                .ok_or("SQLite file path is required")?;
            let db = libsql::Builder::new_local(&path)
                .build()
                .await
                .map_err(|e| format!("SQLite connection failed: {e}"))?;
            // Verify connectivity
            let conn = db.connect().map_err(|e| format!("SQLite connection failed: {e}"))?;
            let _ = conn.execute("PRAGMA foreign_keys=ON", ()).await;
            DbPool::Sqlite(Arc::new(db))
        }
        other => return Err(format!("Unsupported engine: {other}")),
    };

    let mut pools = state.pools.lock().await;
    pools.insert(pool_id.clone(), pool);

    Ok(pool_id)
}

#[tauri::command]
pub async fn dbc_disconnect(
    state: tauri::State<'_, DbClientState>,
    pool_id: String,
) -> Result<(), String> {
    let mut pools = state.pools.lock().await;
    if let Some(pool) = pools.remove(&pool_id) {
        match pool {
            DbPool::MySQL(p) => p.close().await,
            DbPool::Postgres(p) => p.close().await,
            DbPool::Sqlite(_) => { /* Arc<Database> drops automatically */ }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn dbc_test_connection(
    params: ConnectParams,
) -> Result<ConnectionTestResult, String> {
    let start = std::time::Instant::now();

    let effective_host = if params.tunnel_local_port.is_some() {
        "127.0.0.1".to_string()
    } else {
        params.host.clone().unwrap_or_default()
    };
    let effective_port = params
        .tunnel_local_port
        .or(params.port)
        .unwrap_or(match params.engine.as_str() {
            "mysql" | "mariadb" => 3306,
            "postgresql" => 5432,
            _ => 0,
        });

    let result: Result<(), String> = match params.engine.as_str() {
        "mysql" | "mariadb" => {
            let url = format!(
                "mysql://{}:{}@{}:{}/{}",
                params.username.as_deref().unwrap_or("root"),
                params.password.as_deref().unwrap_or(""),
                effective_host,
                effective_port,
                params.database_name.as_deref().unwrap_or(""),
            );
            let p = MySqlPoolOptions::new()
                .max_connections(1)
                .acquire_timeout(std::time::Duration::from_secs(10))
                .connect(&url)
                .await
                .map_err(|e| format!("{e}"))?;
            p.close().await;
            Ok(())
        }
        "postgresql" => {
            let ssl_mode = params.ssl_mode.as_deref().unwrap_or("prefer");
            let url = format!(
                "postgres://{}:{}@{}:{}/{}?sslmode={}",
                params.username.as_deref().unwrap_or("postgres"),
                params.password.as_deref().unwrap_or(""),
                effective_host,
                effective_port,
                params.database_name.as_deref().unwrap_or(""),
                ssl_mode,
            );
            let p = PgPoolOptions::new()
                .max_connections(1)
                .acquire_timeout(std::time::Duration::from_secs(10))
                .connect(&url)
                .await
                .map_err(|e| format!("{e}"))?;
            p.close().await;
            Ok(())
        }
        "sqlite" => {
            let path = params
                .sqlite_file_path
                .ok_or("SQLite file path is required")?;
            let db = libsql::Builder::new_local(&path)
                .build()
                .await
                .map_err(|e| format!("{e}"))?;
            let conn = db.connect().map_err(|e| format!("{e}"))?;
            let _ = conn.query("SELECT 1", ()).await.map_err(|e| format!("{e}"))?;
            Ok(())
        }
        other => Err(format!("Unsupported engine: {other}")),
    };

    let latency = start.elapsed().as_millis() as u64;

    match result {
        Ok(()) => Ok(ConnectionTestResult {
            success: true,
            message: "Connection successful".into(),
            latency_ms: latency,
        }),
        Err(msg) => Ok(ConnectionTestResult {
            success: false,
            message: msg,
            latency_ms: latency,
        }),
    }
}

#[tauri::command]
pub async fn dbc_is_connected(
    state: tauri::State<'_, DbClientState>,
    pool_id: String,
) -> Result<bool, String> {
    let pools = state.pools.lock().await;
    Ok(pools.contains_key(&pool_id))
}
