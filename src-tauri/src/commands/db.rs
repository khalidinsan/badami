use base64::Engine as _;
use libsql::{Builder, Connection, Database, Value};
use serde::Serialize;
use std::sync::Arc;
use std::time::Duration;
use tauri::Emitter;
use tauri::Manager;
use tokio::sync::Mutex;

pub struct DbInner {
    pub db: Arc<Database>,
    pub conn: Connection,
    pub sync_enabled: bool,
}

pub struct DbState {
    pub inner: Arc<Mutex<Option<DbInner>>>,
}

impl DbState {
    pub fn new() -> Self {
        DbState {
            inner: Arc::new(Mutex::new(None)),
        }
    }
}

#[derive(Serialize)]
pub struct DbInitResult {
    pub success: bool,
    pub sync_enabled: bool,
}

#[derive(Serialize)]
pub struct DbExecuteResult {
    pub rows_affected: u64,
    pub last_insert_id: Option<i64>,
}

#[derive(Serialize)]
pub struct DbSyncResult {
    pub success: bool,
    pub duration_ms: u64,
}

// ── Value conversion helpers ───────────────────────────────────────

fn json_to_libsql_value(val: &serde_json::Value) -> Value {
    match val {
        serde_json::Value::Null => Value::Null,
        serde_json::Value::Bool(b) => Value::Integer(if *b { 1 } else { 0 }),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Value::Integer(i)
            } else if let Some(f) = n.as_f64() {
                Value::Real(f)
            } else {
                Value::Null
            }
        }
        serde_json::Value::String(s) => Value::Text(s.clone()),
        _ => Value::Text(val.to_string()),
    }
}

fn libsql_value_to_json(val: Value) -> serde_json::Value {
    match val {
        Value::Null => serde_json::Value::Null,
        Value::Integer(i) => serde_json::json!(i),
        Value::Real(f) => serde_json::json!(f),
        Value::Text(s) => serde_json::Value::String(s),
        Value::Blob(b) => serde_json::Value::String(
            base64::engine::general_purpose::STANDARD.encode(b),
        ),
    }
}

// ── Sync config (persisted alongside DB, not inside DB) ──────────

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct SyncConfig {
    url: String,
    sync_interval_minutes: u64,
}

fn read_sync_config(path: &std::path::Path) -> Option<SyncConfig> {
    let content = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

fn write_sync_config(path: &std::path::Path, config: &SyncConfig) -> Result<(), String> {
    let content = serde_json::to_string(config).map_err(|e| e.to_string())?;
    std::fs::write(path, content).map_err(|e| e.to_string())
}

// ── Data migration helper ─────────────────────────────────────────
//
// When sync is enabled for the first time, copy every user-data row from the
// old local badami.db connection into the new embedded-replica connection so
// that data created before sync was enabled doesn't get lost.
//
// Strategy: PRAGMA table_info to discover columns, then
// INSERT OR IGNORE so existing rows in Turso are never overwritten.
async fn migrate_tables(src: &Connection, dst: &Connection) {
    let tables_sql = "\
        SELECT name FROM sqlite_master \
        WHERE type='table' \
          AND name NOT LIKE 'sqlite_%' \
          AND name NOT LIKE 'libsql_%' \
          AND name != 'settings'";

    let mut tables_rows = match src.query(tables_sql, ()).await {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[migrate] failed to list tables: {e}");
            return;
        }
    };

    // Collect table names first (can't borrow src while iterating for nested queries)
    let mut tables: Vec<String> = Vec::new();
    while let Ok(Some(row)) = tables_rows.next().await {
        if let Ok(name) = row.get::<String>(0) {
            tables.push(name);
        }
    }

    for table in &tables {
        // Get column names via PRAGMA
        let mut pragma_rows = match src
            .query(&format!("PRAGMA table_info(\"{}\")", table), ())
            .await
        {
            Ok(r) => r,
            Err(_) => continue,
        };

        let mut cols: Vec<String> = Vec::new();
        while let Ok(Some(row)) = pragma_rows.next().await {
            // PRAGMA table_info: cid, name, type, notnull, dflt_value, pk
            if let Ok(name) = row.get::<String>(1) {
                cols.push(name);
            }
        }
        if cols.is_empty() {
            continue;
        }

        // Build SELECT + INSERT statements
        let col_list = cols
            .iter()
            .map(|c| format!("\"{}\"", c))
            .collect::<Vec<_>>()
            .join(", ");
        let placeholders = cols.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
        let select_sql = format!("SELECT {} FROM \"{}\"", col_list, table);
        let insert_sql = format!(
            "INSERT OR IGNORE INTO \"{}\" ({}) VALUES ({})",
            table, col_list, placeholders
        );

        // Stream rows from src → dst
        let mut rows_result = match src.query(&select_sql, ()).await {
            Ok(r) => r,
            Err(e) => {
                eprintln!("[migrate] SELECT {table} failed: {e}");
                continue;
            }
        };

        let mut count = 0usize;
        while let Ok(Some(row)) = rows_result.next().await {
            let values: Vec<Value> = (0..cols.len())
                .map(|i| row.get_value(i as i32).unwrap_or(Value::Null))
                .collect();
            if dst.execute(&insert_sql, values).await.is_ok() {
                count += 1;
            }
        }

        if count > 0 {
            eprintln!("[migrate] {} rows → {}", count, table);
        }
    }
}

// ── Migration tracking ─────────────────────────────────────────────
//
// Runs only the migrations that haven't been applied yet, tracked via a
// lightweight `__migrations` table.  This prevents destructive patterns
// (DROP TABLE + recreate in migration 007) from wiping user data on every
// app launch — a bug that manifested after migration 016 added a new column
// to `server_credentials`, causing the SELECT * in migration 007's INSERT to
// fail silently (column-count mismatch) while the subsequent DROP TABLE still
// executed, wiping all server records.
async fn run_pending_migrations(conn: &Connection, migrations: &[String]) {
    // Ensure tracking table exists
    let _ = conn
        .execute(
            "CREATE TABLE IF NOT EXISTS __migrations \
             (idx INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
            (),
        )
        .await;

    // Collect already-applied migration indices
    let mut applied = std::collections::HashSet::<usize>::new();
    if let Ok(mut rows) = conn.query("SELECT idx FROM __migrations", ()).await {
        while let Ok(Some(row)) = rows.next().await {
            if let Ok(i) = row.get::<i64>(0) {
                applied.insert(i as usize);
            }
        }
    }

    for (idx, sql) in migrations.iter().enumerate() {
        if applied.contains(&idx) {
            continue;
        }
        if idx == 0 {
            // First migration: full schema batch (CREATE TABLE IF NOT EXISTS everywhere)
            if conn.execute_batch(sql).await.is_ok() {
                let _ = conn
                    .execute(
                        "INSERT OR IGNORE INTO __migrations (idx, applied_at) \
                         VALUES (0, datetime('now'))",
                        (),
                    )
                    .await;
            }
        } else {
            // Subsequent migrations: split on ';' and execute each statement individually
            for stmt in sql.split(';').map(|s| s.trim()).filter(|s| !s.is_empty()) {
                let _ = conn.execute(stmt, ()).await;
            }
            let _ = conn
                .execute(
                    "INSERT OR IGNORE INTO __migrations (idx, applied_at) \
                     VALUES (?, datetime('now'))",
                    vec![Value::Integer(idx as i64)],
                )
                .await;
        }
    }
}

// ── Commands ───────────────────────────────────────────────────────

/// Initialize the database.
///
/// Strategy (offline-first):
/// 1. If sync-config.json exists AND badami_sync.db already exists (replica from a prior session):
///    Open the replica directly — reads from its local WAL immediately, no network needed.
///    App is live on the replica right away. Background task syncs with Turso (push/pull delta).
///    Both "pending" and "synced" states read from the SAME file → data is always consistent.
/// 2. If sync-config.json exists but badami_sync.db does NOT exist (first-time sync setup, or
///    replica was deleted): fall back to opening local badami.db first, then build the replica
///    in a background task and swap over when it's ready.
/// 3. No sync config: open badami.db as a standard local SQLite database.
#[tauri::command]
pub async fn db_init(
    app: tauri::AppHandle,
    migrations: Vec<String>,
    state: tauri::State<'_, DbState>,
) -> Result<DbInitResult, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;
    std::fs::create_dir_all(&app_dir).map_err(|e| format!("Failed to create app dir: {e}"))?;

    let local_db_path = app_dir.join("badami.db");
    let sync_db_path = app_dir.join("badami_sync.db");
    let sync_config_path = app_dir.join("sync-config.json");

    // If already initialized (e.g. webview reload), return immediately.
    // If sync is enabled, spawn a fresh background sync so the "pending"
    // status the frontend sets on every cold-start resolves to "synced".
    // We clone the Arc<Database> while holding the lock (cheap), then release
    // the lock before the background task starts — queries are never blocked.
    let early_exit = {
        let inner = state.inner.lock().await;
        inner.as_ref().map(|db_inner| {
            (
                db_inner.sync_enabled,
                if db_inner.sync_enabled {
                    Some(db_inner.db.clone())
                } else {
                    None
                },
            )
        })
        // lock released here
    };
    if let Some((sync_enabled, db_opt)) = early_exit {
        if let Some(db) = db_opt {
            let app_clone = app.clone();
            tauri::async_runtime::spawn(async move {
                let _ = app_clone.emit(
                    "sync-status-changed",
                    serde_json::json!({ "status": "syncing" }),
                );
                match db.sync().await {
                    Ok(_) => {
                        let now = chrono::Utc::now().to_rfc3339();
                        let _ = app_clone.emit(
                            "sync-status-changed",
                            serde_json::json!({ "status": "synced", "last_synced_at": now }),
                        );
                    }
                    Err(e) => {
                        let _ = app_clone.emit(
                            "sync-status-changed",
                            serde_json::json!({ "status": "offline", "error": e.to_string() }),
                        );
                    }
                }
            });
        }
        return Ok(DbInitResult {
            success: true,
            sync_enabled,
        });
    }

    // ── Step 0: Offline-first fast path — open existing replica directly ──────
    // If sync is configured AND badami_sync.db exists from a previous session,
    // open it immediately without touching the network. The replica's local WAL
    // has the last session's data, so queries work offline instantly. A background
    // task then syncs the delta with Turso — no pointer swap, no data inconsistency.
    let sync_config = read_sync_config(&sync_config_path);
    if let Some(ref config) = sync_config {
        if sync_db_path.exists() {
            if let Ok(token) = get_sync_token_from_keychain() {
                let interval = config.sync_interval_minutes;

                // Clean stale replica wal_index if present (would prevent open)
                let sync_wal_idx = app_dir.join("badami_sync.db-client_wal_index");
                if sync_wal_idx.exists() {
                    eprintln!("[db_init] stale wal_index on sync db — cleaning up");
                    let _ = std::fs::remove_file(&sync_db_path);
                    let _ = std::fs::remove_file(app_dir.join("badami_sync.db-shm"));
                    let _ = std::fs::remove_file(app_dir.join("badami_sync.db-wal"));
                    let _ = std::fs::remove_file(&sync_wal_idx);
                    // File removed — fall through to slow-path below
                } else {
                    let mut b = Builder::new_remote_replica(
                        &sync_db_path,
                        config.url.clone(),
                        token.clone(),
                    );
                    if interval > 0 {
                        b = b.sync_interval(Duration::from_secs(interval * 60));
                    }

                    match b.build().await {
                        Ok(replica_db) => match replica_db.connect() {
                            Ok(replica_conn) => {
                                let _ = replica_conn.execute("PRAGMA foreign_keys=ON", ()).await;

                                // Apply any pending migrations (only unapplied ones)
                                run_pending_migrations(&replica_conn, &migrations).await;

                                // ── Schema-mismatch guard ──────────────────────────────────
                                // libsql embedded replica: if a migration's DDL (CREATE TABLE)
                                // was already in Turso BEFORE this replica file was created,
                                // the remote-replica no-ops the DDL (table already exists) and
                                // generates NO new WAL frame.  The local file therefore never
                                // receives those schema frames.
                                // Detection: query the max applied __migrations index and verify
                                // it matches the expected count.  If it doesn't, the replica is
                                // stale — delete it and fall through to the slow rebuild path.
                                let expected_max = (migrations.len() - 1) as i64;
                                let schema_ok = async {
                                    let mut rows = replica_conn
                                        .query("SELECT MAX(idx) FROM __migrations", ())
                                        .await
                                        .ok()?;
                                    let row = rows.next().await.ok()??;
                                    row.get::<i64>(0).ok().filter(|&m| m >= expected_max)
                                }
                                .await;

                                if schema_ok.is_none() {
                                    eprintln!(
                                        "[db_init] replica schema mismatch (max migration < {}): \
                                         deleting stale replica for full rebuild",
                                        expected_max
                                    );
                                    drop(replica_conn);
                                    drop(replica_db);
                                    let _ = std::fs::remove_file(&sync_db_path);
                                    let _ = std::fs::remove_file(app_dir.join("badami_sync.db-shm"));
                                    let _ = std::fs::remove_file(app_dir.join("badami_sync.db-wal"));
                                    // Fall through to slow-path below
                                } else {

                                let replica_db = Arc::new(replica_db);

                                // Set inner to replica IMMEDIATELY — app serves from local WAL
                                {
                                    let mut guard = state.inner.lock().await;
                                    *guard = Some(DbInner {
                                        db: replica_db.clone(),
                                        conn: replica_conn,
                                        sync_enabled: true,
                                    });
                                }
                                // Lock released — frontend queries can proceed now.

                                // Background: sync delta with Turso WITHOUT holding the mutex.
                                // We cloned the Arc<Database> above; conn is accessed via the
                                // mutex but only after sync() completes.
                                let state_clone = state.inner.clone();
                                let app_clone = app.clone();
                                let migrations_clone = migrations.clone();
                                let replica_db_clone = replica_db.clone();
                                tauri::async_runtime::spawn(async move {
                                    let _ = app_clone.emit(
                                        "sync-status-changed",
                                        serde_json::json!({ "status": "syncing" }),
                                    );

                                    // sync() does NOT require the mutex — it operates on the
                                    // embedded local WAL + network, independent of Connection.
                                    match replica_db_clone.sync().await {
                                        Ok(_) => {
                                            // Migrations + second sync while holding lock briefly
                                            let inner = state_clone.lock().await;
                                            if let Some(ref db_inner) = *inner {
                                                run_pending_migrations(&db_inner.conn, &migrations_clone).await;
                                            }
                                            drop(inner);
                                            // Second sync to push any local changes
                                            let _ = replica_db_clone.sync().await;

                                            let now = chrono::Utc::now().to_rfc3339();
                                            let _ = app_clone.emit(
                                                "sync-status-changed",
                                                serde_json::json!({
                                                    "status": "synced",
                                                    "last_synced_at": now,
                                                }),
                                            );
                                        }
                                        Err(e) => {
                                            eprintln!("[sync] background sync failed: {e}");
                                            let _ = app_clone.emit(
                                                "sync-status-changed",
                                                serde_json::json!({
                                                    "status": "offline",
                                                    "error": e.to_string(),
                                                }),
                                            );
                                        }
                                    }
                                });

                                return Ok(DbInitResult {
                                    success: true,
                                    sync_enabled: true,
                                });
                                } // end else (schema_ok)
                            }
                            Err(e) => {
                                eprintln!("[db_init] replica connect failed: {e}");
                                let _ = app.emit(
                                    "sync-status-changed",
                                    serde_json::json!({
                                        "status": "error",
                                        "error": format!("Replica connect failed, using local DB: {e}"),
                                    }),
                                );
                            }
                        },
                        Err(e) => {
                            let e_str = e.to_string().to_lowercase();
                            if e_str.contains("locked") || e_str.contains("database is locked") {
                                // Stale WAL lock from a previous crashed session.
                                // Remove shm/wal lock files so the replica can open on next launch.
                                // The replica db itself is kept — Turso is source of truth for data.
                                eprintln!("[db_init] replica locked — clearing stale WAL lock and falling back to local DB");
                                let _ = std::fs::remove_file(app_dir.join("badami_sync.db-shm"));
                                let _ = std::fs::remove_file(app_dir.join("badami_sync.db-wal"));
                            } else {
                                eprintln!("[db_init] replica open failed: {e}");
                            }
                            // Emit warning so frontend knows we're falling back to local
                            let _ = app.emit(
                                "sync-status-changed",
                                serde_json::json!({
                                    "status": "error",
                                    "error": format!("Replica open failed, using local DB: {e}"),
                                }),
                            );
                        }
                    }
                }
            }
        }
    }

    // ── Step 1: Open local badami.db (fallback / no-sync path) ────────────────
    // Covers: no sync config, first-time sync setup (replica not yet built),
    // or replica open failed above — app still starts correctly.

    // If badami.db has a -client_wal_index sidecar it's a libsql replica file,
    // not a standard SQLite. Delete the whole family so we start fresh.
    let wal_index_path = app_dir.join("badami.db-client_wal_index");
    if wal_index_path.exists() {
        eprintln!("[db_init] local db is a replica file — cleaning up");
        let _ = std::fs::remove_file(&local_db_path);
        let _ = std::fs::remove_file(app_dir.join("badami.db-shm"));
        let _ = std::fs::remove_file(app_dir.join("badami.db-wal"));
        let _ = std::fs::remove_file(&wal_index_path);
    }

    let local_db = Builder::new_local(&local_db_path)
        .build()
        .await
        .map_err(|e| format!("Failed to open local database: {e}"))?;
    let local_conn = local_db
        .connect()
        .map_err(|e| format!("Failed to connect to local: {e}"))?;

    // PRAGMA journal_mode=WAL returns a row — drain it
    {
        let mut rows = local_conn
            .query("PRAGMA journal_mode=WAL", ())
            .await
            .map_err(|e| format!("PRAGMA WAL error: {e}"))?;
        while let Ok(Some(_)) = rows.next().await {}
    }
    local_conn
        .execute("PRAGMA foreign_keys=ON", ())
        .await
        .map_err(|e| format!("PRAGMA FK error: {e}"))?;

    // Run migrations — only unapplied ones (tracked in __migrations table)
    run_pending_migrations(&local_conn, &migrations).await;

    // Set inner to local DB — app is ready now
    {
        let mut inner = state.inner.lock().await;
        *inner = Some(DbInner {
            db: Arc::new(local_db),
            conn: local_conn,
            sync_enabled: false,
        });
    }

    // ── Step 2: If sync configured but replica not yet built, create it in background ──
    let sync_enabled = sync_config.is_some();

    if let Some(config) = sync_config {
        if !sync_db_path.exists() {
            if let Ok(token) = get_sync_token_from_keychain() {
                let state_inner = state.inner.clone();
                let app_clone = app.clone();
                let interval = config.sync_interval_minutes;
                let migrations_clone = migrations.clone();

                tauri::async_runtime::spawn(async move {
                    // Build replica (badami_sync.db — separate file to avoid format conflict)
                    let build_replica = |url: String, tok: String| {
                        let path = sync_db_path.clone();
                        async move {
                            let mut b = Builder::new_remote_replica(&path, url, tok);
                            if interval > 0 {
                                b = b.sync_interval(Duration::from_secs(interval * 60));
                            }
                            b.build().await
                        }
                    };

                    let replica_result =
                        match build_replica(config.url.clone(), token.clone()).await {
                            Err(ref e) if e.to_string().contains("wal_index") => {
                                eprintln!("[sync] wal_index on new sync db — recreating");
                                let _ = std::fs::remove_file(&sync_db_path);
                                build_replica(config.url.clone(), token.clone()).await
                            }
                            other => other,
                        };

                    match replica_result {
                        Ok(replica_db) => match replica_db.connect() {
                            Ok(replica_conn) => {
                                let _ = replica_conn.execute("PRAGMA foreign_keys=ON", ()).await;

                                // Initial sync — pull from Turso
                                match replica_db.sync().await {
                                    Ok(_) => {
                                        // Ensure schema parity on fresh replica
                                        run_pending_migrations(&replica_conn, &migrations_clone).await;
                                        let _ = replica_db.sync().await;

                                        // Upgrade inner to replica
                                        let mut guard = state_inner.lock().await;
                                        *guard = Some(DbInner {
                                            db: Arc::new(replica_db),
                                            conn: replica_conn,
                                            sync_enabled: true,
                                        });
                                        let now = chrono::Utc::now().to_rfc3339();
                                        let _ = app_clone.emit(
                                            "sync-status-changed",
                                            serde_json::json!({
                                                "status": "synced",
                                                "last_synced_at": now,
                                            }),
                                        );
                                    }
                                    Err(e) => {
                                        eprintln!("[sync] initial sync failed: {e}");
                                        let _ = app_clone.emit(
                                            "sync-status-changed",
                                            serde_json::json!({
                                                "status": "offline",
                                                "error": e.to_string(),
                                            }),
                                        );
                                    }
                                }
                            }
                            Err(e) => eprintln!("[sync] replica connect failed: {e}"),
                        },
                        Err(e) => eprintln!("[sync] replica build failed: {e}"),
                    }
                });
            }
        }
        // If replica exists but fast-path failed (open error), we're on local DB.
        // Next startup will retry the fast path since the file still exists.
    }

    Ok(DbInitResult {
        success: true,
        sync_enabled,
    })
}

/// Execute a SELECT query and return rows as JSON objects.
#[tauri::command]
pub async fn db_query(
    sql: String,
    params: Vec<serde_json::Value>,
    state: tauri::State<'_, DbState>,
) -> Result<Vec<serde_json::Value>, String> {
    let inner = state.inner.lock().await;
    let inner = inner.as_ref().ok_or("Database not initialized")?;

    let libsql_params: Vec<Value> = params.iter().map(json_to_libsql_value).collect();

    let mut rows = inner
        .conn
        .query(&sql, libsql_params)
        .await
        .map_err(|e| format!("Query error: {e}"))?;

    let col_count = rows.column_count();
    // Normalize column names to lowercase — libSQL returns reserved keywords
    // like "key" as "KEY" (uppercased), which breaks TypeScript property access.
    let col_names: Vec<String> = (0..col_count)
        .map(|i| rows.column_name(i).unwrap_or("").to_lowercase())
        .collect();

    let mut result = Vec::new();
    while let Some(row) = rows.next().await.map_err(|e| format!("Row read error: {e}"))? {
        let mut obj = serde_json::Map::new();
        for (i, name) in col_names.iter().enumerate() {
            let val = row
                .get_value(i as i32)
                .map_err(|e| format!("Value read error: {e}"))?;
            obj.insert(name.clone(), libsql_value_to_json(val));
        }
        result.push(serde_json::Value::Object(obj));
    }

    Ok(result)
}

/// Execute a write statement (INSERT/UPDATE/DELETE) and return affected rows.
#[tauri::command]
pub async fn db_execute(
    sql: String,
    params: Vec<serde_json::Value>,
    state: tauri::State<'_, DbState>,
) -> Result<DbExecuteResult, String> {
    let inner = state.inner.lock().await;
    let inner = inner.as_ref().ok_or("Database not initialized")?;

    let libsql_params: Vec<Value> = params.iter().map(json_to_libsql_value).collect();

    let rows_affected = inner
        .conn
        .execute(&sql, libsql_params)
        .await
        .map_err(|e| format!("Execute error: {e}"))?;

    // Get last insert rowid
    let last_insert_id = match inner.conn.query("SELECT last_insert_rowid()", ()).await {
        Ok(mut rows) => {
            if let Ok(Some(row)) = rows.next().await {
                row.get::<i64>(0).ok()
            } else {
                None
            }
        }
        Err(_) => None,
    };

    Ok(DbExecuteResult {
        rows_affected,
        last_insert_id,
    })
}

/// Execute a batch of SQL statements (for migrations).
#[tauri::command]
pub async fn db_execute_batch(
    sql: String,
    state: tauri::State<'_, DbState>,
) -> Result<(), String> {
    let inner = state.inner.lock().await;
    let inner = inner.as_ref().ok_or("Database not initialized")?;
    inner
        .conn
        .execute_batch(&sql)
        .await
        .map_err(|e| format!("Batch execute error: {e}"))?;
    Ok(())
}

/// Trigger a manual sync (push local changes + pull remote changes).
#[tauri::command]
pub async fn db_sync(
    state: tauri::State<'_, DbState>,
    app: tauri::AppHandle,
) -> Result<DbSyncResult, String> {
    // Clone Arc<Database> so we can release the mutex before the network call
    let db = {
        let inner = state.inner.lock().await;
        let db_inner = inner.as_ref().ok_or("Database not initialized")?;
        if !db_inner.sync_enabled {
            return Err("Sync is not enabled".into());
        }
        db_inner.db.clone() // cheap Arc clone
    }; // mutex released here

    // Emit syncing status
    let _ = app.emit("sync-status-changed", serde_json::json!({ "status": "syncing" }));

    let start = std::time::Instant::now();
    match db.sync().await {
        Ok(_) => {
            let duration_ms = start.elapsed().as_millis() as u64;
            let now = chrono::Utc::now().to_rfc3339();
            let _ = app.emit(
                "sync-status-changed",
                serde_json::json!({
                    "status": "synced",
                    "last_synced_at": now,
                    "duration_ms": duration_ms,
                }),
            );
            Ok(DbSyncResult {
                success: true,
                duration_ms,
            })
        }
        Err(e) => {
            let _ = app.emit(
                "sync-status-changed",
                serde_json::json!({
                    "status": "error",
                    "error": e.to_string(),
                }),
            );
            Err(format!("Sync failed: {e}"))
        }
    }
}

/// Enable sync: build embedded replica at badami_sync.db, write sync-config.json.
#[tauri::command]
pub async fn db_enable_sync(
    url: String,
    sync_interval_minutes: u64,
    app: tauri::AppHandle,
    state: tauri::State<'_, DbState>,
) -> Result<DbSyncResult, String> {
    let token = get_sync_token_from_keychain()
        .map_err(|e| format!("Token not found in keychain: {e}"))?;

    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;
    let sync_db_path = app_dir.join("badami_sync.db");
    let sync_config_path = app_dir.join("sync-config.json");

    // Save current local connection so we can restore on failure
    let mut inner = state.inner.lock().await;
    let previous = inner.take();

    // Build embedded replica (badami_sync.db — separate from local SQLite)
    let url2 = url.clone();
    let token2 = token.clone();
    let mut builder = Builder::new_remote_replica(&sync_db_path, url.clone(), token.clone());
    if sync_interval_minutes > 0 {
        builder = builder.sync_interval(Duration::from_secs(sync_interval_minutes * 60));
    }
    let build_result = match builder.build().await {
        Err(ref e) if e.to_string().contains("wal_index") => {
            eprintln!("[enable_sync] wal_index mismatch — recreating sync db");
            let _ = std::fs::remove_file(&sync_db_path);
            let mut b2 = Builder::new_remote_replica(&sync_db_path, url2, token2);
            if sync_interval_minutes > 0 {
                b2 = b2.sync_interval(Duration::from_secs(sync_interval_minutes * 60));
            }
            b2.build().await
        }
        other => other,
    };

    let db = match build_result {
        Ok(db) => db,
        Err(e) => {
            // RESTORE previous connection so app keeps working
            *inner = previous;
            return Err(format!("Failed to open replica: {e}"));
        }
    };

    let conn = match db.connect() {
        Ok(c) => c,
        Err(e) => {
            *inner = previous;
            return Err(format!("Failed to connect: {e}"));
        }
    };
    if let Err(e) = conn.execute("PRAGMA foreign_keys=ON", ()).await {
        *inner = previous;
        return Err(format!("PRAGMA FK error: {e}"));
    }

    let db = Arc::new(db);
    *inner = Some(DbInner {
        db: db.clone(),
        conn,
        sync_enabled: true,
    });

    // Initial sync — if this fails, keep the replica conn (it works locally)
    // but write the config so next restart will retry
    // Note: sync() is called on the Arc clone without holding the inner lock.
    let start = std::time::Instant::now();
    drop(inner); // Release lock before network call

    // ── Migrate local data to replica (first-time sync enable only) ──────────
    // If the previous connection was a plain local DB (not sync_enabled), any rows
    // created before sync was turned on live only in badami.db and would be silently
    // lost once we switch the active connection to the replica.  Copy every row with
    // INSERT OR IGNORE so Turso data always wins on conflict.
    let was_local = previous
        .as_ref()
        .map(|p| !p.sync_enabled)
        .unwrap_or(false);
    if was_local {
        if let Some(ref prev_inner) = previous {
            // Open a second connection to the replica just for the migration
            match db.connect() {
                Ok(migration_conn) => {
                    eprintln!("[migrate] migrating local data → replica …");
                    let _ = migration_conn.execute("PRAGMA foreign_keys=OFF", ()).await;
                    migrate_tables(&prev_inner.conn, &migration_conn).await;
                    let _ = migration_conn.execute("PRAGMA foreign_keys=ON", ()).await;
                    eprintln!("[migrate] done");
                }
                Err(e) => eprintln!("[migrate] could not open migration conn: {e}"),
            }
        }
    }

    let sync_error = match db.sync().await {
        Ok(_) => None,
        Err(e) => Some(e.to_string()),
    };
    let duration_ms = start.elapsed().as_millis() as u64;

    // Persist sync config so next restart opens replica directly
    write_sync_config(
        &sync_config_path,
        &SyncConfig {
            url,
            sync_interval_minutes,
        },
    )?;

    if let Some(err) = sync_error {
        let _ = app.emit(
            "sync-status-changed",
            serde_json::json!({ "status": "error", "error": err }),
        );
        // Return success — replica is configured, sync will retry later
        return Ok(DbSyncResult {
            success: true,
            duration_ms,
        });
    }

    let now = chrono::Utc::now().to_rfc3339();
    let _ = app.emit(
        "sync-status-changed",
        serde_json::json!({ "status": "synced", "last_synced_at": now }),
    );

    Ok(DbSyncResult {
        success: true,
        duration_ms,
    })
}

/// Disable sync: close replica, delete sync-config.json, reopen badami.db as local.
#[tauri::command]
pub async fn db_disable_sync(
    app: tauri::AppHandle,
    state: tauri::State<'_, DbState>,
) -> Result<(), String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;
    let local_db_path = app_dir.join("badami.db");
    let sync_config_path = app_dir.join("sync-config.json");

    let mut inner = state.inner.lock().await;
    let previous = inner.take();

    // Remove sync config so next restart uses local path
    let _ = std::fs::remove_file(&sync_config_path);

    // Reopen / create local SQLite
    let db = match Builder::new_local(&local_db_path).build().await {
        Ok(db) => db,
        Err(e) => {
            *inner = previous;
            return Err(format!("Failed to reopen local: {e}"));
        }
    };
    let conn = match db.connect() {
        Ok(c) => c,
        Err(e) => {
            *inner = previous;
            return Err(format!("Failed to connect: {e}"));
        }
    };
    {
        let mut rows = conn.query("PRAGMA journal_mode=WAL", ()).await
            .map_err(|e| format!("PRAGMA WAL: {e}"))?;
        while let Ok(Some(_)) = rows.next().await {}
    }
    conn.execute("PRAGMA foreign_keys=ON", ())
        .await
        .map_err(|e| format!("PRAGMA FK: {e}"))?;

    *inner = Some(DbInner {
        db: Arc::new(db),
        conn,
        sync_enabled: false,
    });

    let _ = app.emit(
        "sync-status-changed",
        serde_json::json!({ "status": "disabled" }),
    );

    Ok(())
}

/// Check if sync is currently enabled.
#[tauri::command]
pub async fn db_get_sync_status(
    app: tauri::AppHandle,
    state: tauri::State<'_, DbState>,
) -> Result<serde_json::Value, String> {
    let inner = state.inner.lock().await;

    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("App dir: {e}"))?;
    let local_size = std::fs::metadata(app_dir.join("badami.db"))
        .map(|m| m.len())
        .unwrap_or(0);
    let sync_size = std::fs::metadata(app_dir.join("badami_sync.db"))
        .map(|m| m.len())
        .unwrap_or(0);

    match inner.as_ref() {
        Some(db_inner) => Ok(serde_json::json!({
            "initialized": true,
            "sync_enabled": db_inner.sync_enabled,
            "local_db_size": local_size,
            "sync_db_size": sync_size,
        })),
        None => Ok(serde_json::json!({
            "initialized": false,
            "sync_enabled": false,
            "local_db_size": local_size,
            "sync_db_size": sync_size,
        })),
    }
}

// ── Sync token helpers (keychain) ──────────────────────────────────

#[tauri::command]
pub async fn save_sync_token(token: String) -> Result<(), String> {
    let entry =
        keyring::Entry::new("badami-turso", "auth-token").map_err(|e| format!("Keyring: {e}"))?;
    entry
        .set_password(&token)
        .map_err(|e| format!("Failed to save token: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn get_sync_token() -> Result<Option<String>, String> {
    match get_sync_token_from_keychain() {
        Ok(t) => Ok(Some(t)),
        Err(_) => Ok(None),
    }
}

#[tauri::command]
pub async fn delete_sync_token() -> Result<(), String> {
    let entry =
        keyring::Entry::new("badami-turso", "auth-token").map_err(|e| format!("Keyring: {e}"))?;
    let _ = entry.delete_credential();
    Ok(())
}

#[tauri::command]
pub async fn test_sync_connection(url: String, token: String) -> Result<serde_json::Value, String> {
    let start = std::time::Instant::now();

    // Try connecting as remote (not replica — just test connectivity)
    let db = Builder::new_remote(url, token)
        .build()
        .await
        .map_err(|e| format!("Connection failed: {e}"))?;

    let conn = db
        .connect()
        .map_err(|e| format!("Failed to connect: {e}"))?;

    // Test with a simple query
    let _ = conn
        .query("SELECT 1", ())
        .await
        .map_err(|e| format!("Query test failed: {e}"))?;

    let latency_ms = start.elapsed().as_millis() as u64;

    Ok(serde_json::json!({
        "ok": true,
        "latency_ms": latency_ms,
    }))
}

// ── Turso Platform API helpers ─────────────────────────────────────

/// Fetch organizations for the given Platform API token.
#[tauri::command]
pub async fn turso_list_organizations(
    platform_token: String,
) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let resp = client
        .get("https://api.turso.tech/v1/organizations")
        .header("Authorization", format!("Bearer {platform_token}"))
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("API error ({status}): {body}"));
    }

    resp.json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Parse error: {e}"))
}

/// Fetch available regions from Turso Platform API.
#[tauri::command]
pub async fn turso_list_regions(
    platform_token: String,
) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let resp = client
        .get("https://api.turso.tech/v1/locations")
        .header("Authorization", format!("Bearer {platform_token}"))
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("API error ({status}): {body}"));
    }

    resp.json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Parse error: {e}"))
}

/// Create a new Turso database via Platform API.
#[tauri::command]
pub async fn turso_create_database(
    platform_token: String,
    org_slug: String,
    db_name: String,
    region: String,
) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let resp = client
        .post(format!(
            "https://api.turso.tech/v1/organizations/{org_slug}/databases"
        ))
        .header("Authorization", format!("Bearer {platform_token}"))
        .json(&serde_json::json!({
            "name": db_name,
            "group": "default",
            "primary": region,
        }))
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("API error ({status}): {body}"));
    }

    resp.json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Parse error: {e}"))
}

/// Generate an auth token for a Turso database.
#[tauri::command]
pub async fn turso_create_token(
    platform_token: String,
    org_slug: String,
    db_name: String,
) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let resp = client
        .post(format!(
            "https://api.turso.tech/v1/organizations/{org_slug}/databases/{db_name}/auth/tokens"
        ))
        .header("Authorization", format!("Bearer {platform_token}"))
        .json(&serde_json::json!({}))
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("API error ({status}): {body}"));
    }

    resp.json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Parse error: {e}"))
}

// ── Internal helpers ───────────────────────────────────────────────

fn get_sync_token_from_keychain() -> Result<String, String> {
    let entry =
        keyring::Entry::new("badami-turso", "auth-token").map_err(|e| format!("Keyring: {e}"))?;
    entry
        .get_password()
        .map_err(|e| format!("Token not found: {e}"))
}
