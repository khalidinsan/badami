use super::db_connection::DbClientState;
use serde::Serialize;
use sqlx::Row;

// ── Types ───────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Clone)]
pub struct DatabaseInfo {
    pub name: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct TableInfo {
    pub name: String,
    pub table_type: String, // table | view
    pub row_count: Option<i64>,
}

#[derive(Debug, Serialize, Clone)]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub is_nullable: bool,
    pub is_primary_key: bool,
    pub default_value: Option<String>,
    pub extra: Option<String>,
    pub ordinal_position: u32,
}

#[derive(Debug, Serialize, Clone)]
pub struct IndexInfo {
    pub name: String,
    pub index_type: String, // PRIMARY | UNIQUE | INDEX
    pub columns: Vec<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct ForeignKeyInfo {
    pub name: String,
    pub column: String,
    pub ref_table: String,
    pub ref_column: String,
    pub on_delete: Option<String>,
    pub on_update: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct TableStructure {
    pub columns: Vec<ColumnInfo>,
    pub indexes: Vec<IndexInfo>,
    pub foreign_keys: Vec<ForeignKeyInfo>,
}

// ── Commands ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn dbc_list_databases(
    state: tauri::State<'_, DbClientState>,
    pool_id: String,
) -> Result<Vec<DatabaseInfo>, String> {
    let pools = state.pools.lock().await;
    let pool = pools.get(&pool_id).ok_or("Connection not found")?;

    match pool {
        super::db_connection::DbPool::MySQL(p) => {
            let rows = sqlx::query("SHOW DATABASES")
                .fetch_all(p)
                .await
                .map_err(|e| format!("{e}"))?;
            Ok(rows
                .iter()
                .map(|r| DatabaseInfo {
                    name: r.get::<String, _>(0),
                })
                .collect())
        }
        super::db_connection::DbPool::Postgres(p) => {
            let rows = sqlx::query(
                "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname",
            )
            .fetch_all(p)
            .await
            .map_err(|e| format!("{e}"))?;
            Ok(rows
                .iter()
                .map(|r| DatabaseInfo {
                    name: r.get::<String, _>(0),
                })
                .collect())
        }
        super::db_connection::DbPool::Sqlite(_) => {
            Ok(vec![DatabaseInfo {
                name: "main".into(),
            }])
        }
    }
}

#[tauri::command]
pub async fn dbc_list_tables(
    state: tauri::State<'_, DbClientState>,
    pool_id: String,
    database: Option<String>,
) -> Result<Vec<TableInfo>, String> {
    let pools = state.pools.lock().await;
    let pool = pools.get(&pool_id).ok_or("Connection not found")?;

    match pool {
        super::db_connection::DbPool::MySQL(p) => {
            let db_name = database.unwrap_or_default();
            let rows = sqlx::query(
                "SELECT TABLE_NAME, TABLE_TYPE, TABLE_ROWS \
                 FROM information_schema.TABLES \
                 WHERE TABLE_SCHEMA = ? \
                 ORDER BY TABLE_NAME",
            )
            .bind(&db_name)
            .fetch_all(p)
            .await
            .map_err(|e| format!("{e}"))?;

            Ok(rows
                .iter()
                .map(|r| {
                    let tt: String = r.get("TABLE_TYPE");
                    TableInfo {
                        name: r.get("TABLE_NAME"),
                        table_type: if tt.contains("VIEW") {
                            "view".into()
                        } else {
                            "table".into()
                        },
                        row_count: r.try_get("TABLE_ROWS").ok(),
                    }
                })
                .collect())
        }
        super::db_connection::DbPool::Postgres(p) => {
            let schema = database.as_deref().unwrap_or("public");
            let rows = sqlx::query(
                "SELECT c.relname AS table_name, \
                        CASE WHEN c.relkind = 'v' THEN 'view' ELSE 'table' END AS table_type, \
                        c.reltuples::bigint AS row_count \
                 FROM pg_class c \
                 JOIN pg_namespace n ON n.oid = c.relnamespace \
                 WHERE n.nspname = $1 AND c.relkind IN ('r', 'v') \
                 ORDER BY c.relname",
            )
            .bind(schema)
            .fetch_all(p)
            .await
            .map_err(|e| format!("{e}"))?;

            Ok(rows
                .iter()
                .map(|r| TableInfo {
                    name: r.get("table_name"),
                    table_type: r.get("table_type"),
                    row_count: r.try_get::<i64, _>("row_count").ok(),
                })
                .collect())
        }
        super::db_connection::DbPool::Sqlite(db) => {
            let conn = db.connect().map_err(|e| format!("SQLite connect: {e}"))?;
            let mut rows = conn.query(
                "SELECT name, type FROM sqlite_master \
                 WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' \
                 ORDER BY name",
                (),
            ).await.map_err(|e| format!("{e}"))?;

            let mut table_list: Vec<(String, String)> = Vec::new();
            while let Some(row) = rows.next().await.map_err(|e| format!("{e}"))? {
                let name: String = row.get(0).unwrap_or_default();
                let ttype: String = row.get(1).unwrap_or_default();
                table_list.push((name, ttype));
            }

            let mut tables = Vec::new();
            for (name, ttype) in &table_list {
                let row_count = if ttype == "table" {
                    let count_sql = format!("SELECT COUNT(*) FROM \"{}\"", name.replace('"', "\"\""));
                    let mut cr = conn.query(&count_sql, ()).await.ok();
                    match &mut cr {
                        Some(r) => r.next().await.ok().flatten().and_then(|row| row.get::<i64>(0).ok()),
                        None => None,
                    }
                } else {
                    None
                };
                tables.push(TableInfo {
                    name: name.clone(),
                    table_type: ttype.clone(),
                    row_count,
                });
            }
            Ok(tables)
        }
    }
}

#[tauri::command]
pub async fn dbc_get_table_structure(
    state: tauri::State<'_, DbClientState>,
    pool_id: String,
    database: Option<String>,
    table: String,
) -> Result<TableStructure, String> {
    let pools = state.pools.lock().await;
    let pool = pools.get(&pool_id).ok_or("Connection not found")?;

    match pool {
        super::db_connection::DbPool::MySQL(p) => {
            get_mysql_table_structure(p, &database.unwrap_or_default(), &table).await
        }
        super::db_connection::DbPool::Postgres(p) => {
            get_pg_table_structure(p, database.as_deref().unwrap_or("public"), &table).await
        }
        super::db_connection::DbPool::Sqlite(db) => {
            get_sqlite_table_structure(db, &table).await
        }
    }
}

#[tauri::command]
pub async fn dbc_get_create_statement(
    state: tauri::State<'_, DbClientState>,
    pool_id: String,
    database: Option<String>,
    table: String,
) -> Result<String, String> {
    let pools = state.pools.lock().await;
    let pool = pools.get(&pool_id).ok_or("Connection not found")?;

    match pool {
        super::db_connection::DbPool::MySQL(p) => {
            let _db = database.unwrap_or_default();
            let row = sqlx::query(&format!("SHOW CREATE TABLE `{}`", table.replace('`', "``")))
                .fetch_one(p)
                .await
                .map_err(|e| format!("{e}"))?;
            Ok(row.try_get::<String, _>(1).unwrap_or_default())
        }
        super::db_connection::DbPool::Postgres(_p) => {
            // PostgreSQL doesn't have SHOW CREATE TABLE; we'd need pg_dump or manual reconstruction
            // For now, return a placeholder that the frontend can populate via schema info
            Err("PostgreSQL CREATE TABLE reconstruction not yet implemented — use Schema Manager".into())
        }
        super::db_connection::DbPool::Sqlite(db) => {
            let conn = db.connect().map_err(|e| format!("SQLite connect: {e}"))?;
            let mut rows = conn.query(
                &format!("SELECT sql FROM sqlite_master WHERE type='table' AND name='{}'",
                    table.replace('\'', "''")),
                (),
            ).await.map_err(|e| format!("{e}"))?;
            match rows.next().await.map_err(|e| format!("{e}"))? {
                Some(row) => Ok(row.get::<String>(0).unwrap_or_default()),
                None => Err(format!("Table '{}' not found", table)),
            }
        }
    }
}

// ── Helpers ─────────────────────────────────────────────────────────

async fn get_mysql_table_structure(
    p: &sqlx::Pool<sqlx::MySql>,
    db: &str,
    table: &str,
) -> Result<TableStructure, String> {
    // If db is empty, fall back to the pool's current database
    let effective_db: String = if db.is_empty() {
        let row = sqlx::query("SELECT DATABASE()")
            .fetch_one(p)
            .await
            .map_err(|e| format!("Failed to get current database: {e}"))?;
        row.get::<Option<String>, _>(0).unwrap_or_default()
    } else {
        db.to_string()
    };
    let db = effective_db.as_str();
    // Columns
    let col_rows = sqlx::query(
        "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, EXTRA, ORDINAL_POSITION \
         FROM information_schema.COLUMNS \
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? \
         ORDER BY ORDINAL_POSITION",
    )
    .bind(db)
    .bind(table)
    .fetch_all(p)
    .await
    .map_err(|e| format!("{e}"))?;

    let columns: Vec<ColumnInfo> = col_rows
        .iter()
        .map(|r| ColumnInfo {
            name: r.get("COLUMN_NAME"),
            data_type: r.get("COLUMN_TYPE"),
            is_nullable: r.get::<String, _>("IS_NULLABLE") == "YES",
            is_primary_key: r.get::<String, _>("COLUMN_KEY") == "PRI",
            default_value: r.try_get("COLUMN_DEFAULT").ok(),
            extra: r.try_get::<String, _>("EXTRA").ok().filter(|s| !s.is_empty()),
            ordinal_position: r.get::<u64, _>("ORDINAL_POSITION") as u32,
        })
        .collect();

    // Indexes
    let idx_rows = sqlx::query(
        "SELECT INDEX_NAME, NON_UNIQUE, COLUMN_NAME \
         FROM information_schema.STATISTICS \
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? \
         ORDER BY INDEX_NAME, SEQ_IN_INDEX",
    )
    .bind(db)
    .bind(table)
    .fetch_all(p)
    .await
    .map_err(|e| format!("{e}"))?;

    let mut idx_map: std::collections::HashMap<String, (String, Vec<String>)> =
        std::collections::HashMap::new();
    for r in &idx_rows {
        let name: String = r.get("INDEX_NAME");
        let non_unique: i32 = r.try_get("NON_UNIQUE").unwrap_or(1);
        let col: String = r.get("COLUMN_NAME");
        let entry = idx_map.entry(name.clone()).or_insert_with(|| {
            let idx_type = if name == "PRIMARY" {
                "PRIMARY".into()
            } else if non_unique == 0 {
                "UNIQUE".into()
            } else {
                "INDEX".into()
            };
            (idx_type, Vec::new())
        });
        entry.1.push(col);
    }
    let indexes: Vec<IndexInfo> = idx_map
        .into_iter()
        .map(|(name, (index_type, columns))| IndexInfo {
            name,
            index_type,
            columns,
        })
        .collect();

    // Foreign keys
    let fk_rows = sqlx::query(
        "SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME \
         FROM information_schema.KEY_COLUMN_USAGE \
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL",
    )
    .bind(db)
    .bind(table)
    .fetch_all(p)
    .await
    .map_err(|e| format!("{e}"))?;

    let mut foreign_keys: Vec<ForeignKeyInfo> = Vec::new();
    for r in &fk_rows {
        let fk_name: String = r.get("CONSTRAINT_NAME");
        // Get ON DELETE / ON UPDATE from referential constraints
        let rc_row = sqlx::query(
            "SELECT DELETE_RULE, UPDATE_RULE \
             FROM information_schema.REFERENTIAL_CONSTRAINTS \
             WHERE CONSTRAINT_SCHEMA = ? AND CONSTRAINT_NAME = ?",
        )
        .bind(db)
        .bind(&fk_name)
        .fetch_optional(p)
        .await
        .map_err(|e| format!("{e}"))?;

        foreign_keys.push(ForeignKeyInfo {
            name: fk_name,
            column: r.get("COLUMN_NAME"),
            ref_table: r.get("REFERENCED_TABLE_NAME"),
            ref_column: r.get("REFERENCED_COLUMN_NAME"),
            on_delete: rc_row.as_ref().and_then(|rr| rr.try_get("DELETE_RULE").ok()),
            on_update: rc_row.as_ref().and_then(|rr| rr.try_get("UPDATE_RULE").ok()),
        });
    }

    Ok(TableStructure {
        columns,
        indexes,
        foreign_keys,
    })
}

async fn get_pg_table_structure(
    p: &sqlx::Pool<sqlx::Postgres>,
    schema: &str,
    table: &str,
) -> Result<TableStructure, String> {
    // Columns
    let col_rows = sqlx::query(
        "SELECT c.column_name, c.udt_name || COALESCE('(' || c.character_maximum_length || ')', '') AS data_type, \
                c.is_nullable, c.column_default, c.ordinal_position, \
                CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END AS is_pk \
         FROM information_schema.columns c \
         LEFT JOIN ( \
           SELECT ku.column_name FROM information_schema.table_constraints tc \
           JOIN information_schema.key_column_usage ku ON tc.constraint_name = ku.constraint_name \
           WHERE tc.table_schema = $1 AND tc.table_name = $2 AND tc.constraint_type = 'PRIMARY KEY' \
         ) pk ON pk.column_name = c.column_name \
         WHERE c.table_schema = $1 AND c.table_name = $2 \
         ORDER BY c.ordinal_position",
    )
    .bind(schema)
    .bind(table)
    .fetch_all(p)
    .await
    .map_err(|e| format!("{e}"))?;

    let columns: Vec<ColumnInfo> = col_rows
        .iter()
        .map(|r| ColumnInfo {
            name: r.get("column_name"),
            data_type: r.get("data_type"),
            is_nullable: r.get::<String, _>("is_nullable") == "YES",
            is_primary_key: r.get::<bool, _>("is_pk"),
            default_value: r.try_get("column_default").ok(),
            extra: None,
            ordinal_position: r.get::<i32, _>("ordinal_position") as u32,
        })
        .collect();

    // Indexes
    let idx_rows = sqlx::query(
        "SELECT i.relname AS index_name, ix.indisunique, ix.indisprimary, \
                array_agg(a.attname ORDER BY array_position(ix.indkey, a.attnum)) AS columns \
         FROM pg_index ix \
         JOIN pg_class t ON t.oid = ix.indrelid \
         JOIN pg_class i ON i.oid = ix.indexrelid \
         JOIN pg_namespace n ON n.oid = t.relnamespace \
         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey) \
         WHERE n.nspname = $1 AND t.relname = $2 \
         GROUP BY i.relname, ix.indisunique, ix.indisprimary",
    )
    .bind(schema)
    .bind(table)
    .fetch_all(p)
    .await
    .map_err(|e| format!("{e}"))?;

    let indexes: Vec<IndexInfo> = idx_rows
        .iter()
        .map(|r| {
            let is_primary: bool = r.get("indisprimary");
            let is_unique: bool = r.get("indisunique");
            IndexInfo {
                name: r.get("index_name"),
                index_type: if is_primary {
                    "PRIMARY".into()
                } else if is_unique {
                    "UNIQUE".into()
                } else {
                    "INDEX".into()
                },
                columns: r.get::<Vec<String>, _>("columns"),
            }
        })
        .collect();

    // Foreign keys
    let fk_rows = sqlx::query(
        "SELECT tc.constraint_name, kcu.column_name, ccu.table_name AS ref_table, \
                ccu.column_name AS ref_column, rc.delete_rule, rc.update_rule \
         FROM information_schema.table_constraints tc \
         JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name \
         JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name \
         JOIN information_schema.referential_constraints rc ON rc.constraint_name = tc.constraint_name \
         WHERE tc.table_schema = $1 AND tc.table_name = $2 AND tc.constraint_type = 'FOREIGN KEY'",
    )
    .bind(schema)
    .bind(table)
    .fetch_all(p)
    .await
    .map_err(|e| format!("{e}"))?;

    let foreign_keys: Vec<ForeignKeyInfo> = fk_rows
        .iter()
        .map(|r| ForeignKeyInfo {
            name: r.get("constraint_name"),
            column: r.get("column_name"),
            ref_table: r.get("ref_table"),
            ref_column: r.get("ref_column"),
            on_delete: r.try_get("delete_rule").ok(),
            on_update: r.try_get("update_rule").ok(),
        })
        .collect();

    Ok(TableStructure {
        columns,
        indexes,
        foreign_keys,
    })
}

async fn get_sqlite_table_structure(
    db: &libsql::Database,
    table: &str,
) -> Result<TableStructure, String> {
    let conn = db.connect().map_err(|e| format!("SQLite connect: {e}"))?;
    let safe_table = table.replace('"', "\"\"");

    // Columns via PRAGMA
    let mut col_rows = conn
        .query(&format!("PRAGMA table_info(\"{}\")", safe_table), ())
        .await
        .map_err(|e| format!("{e}"))?;

    let mut columns = Vec::new();
    let mut idx: u32 = 0;
    while let Some(r) = col_rows.next().await.map_err(|e| format!("{e}"))? {
        columns.push(ColumnInfo {
            name: r.get::<String>(1).unwrap_or_default(),     // name
            data_type: r.get::<String>(2).unwrap_or_default(), // type
            is_nullable: r.get::<i32>(3).unwrap_or(0) == 0,   // notnull
            is_primary_key: r.get::<i32>(5).unwrap_or(0) > 0, // pk
            default_value: r.get::<String>(4).ok(),            // dflt_value
            extra: None,
            ordinal_position: idx + 1,
        });
        idx += 1;
    }

    // Indexes
    let mut idx_rows = conn
        .query(&format!("PRAGMA index_list(\"{}\")", safe_table), ())
        .await
        .map_err(|e| format!("{e}"))?;

    let mut index_entries: Vec<(String, i32)> = Vec::new();
    while let Some(r) = idx_rows.next().await.map_err(|e| format!("{e}"))? {
        let name: String = r.get(1).unwrap_or_default();
        let unique: i32 = r.get(2).unwrap_or(0);
        index_entries.push((name, unique));
    }

    let mut indexes = Vec::new();
    for (idx_name, unique) in &index_entries {
        let mut detail_rows = conn
            .query(
                &format!("PRAGMA index_info(\"{}\")", idx_name.replace('"', "\"\"")),
                (),
            )
            .await
            .map_err(|e| format!("{e}"))?;

        let mut cols = Vec::new();
        while let Some(d) = detail_rows.next().await.map_err(|e| format!("{e}"))? {
            cols.push(d.get::<String>(2).unwrap_or_default());
        }
        indexes.push(IndexInfo {
            name: idx_name.clone(),
            index_type: if *unique == 1 { "UNIQUE".into() } else { "INDEX".into() },
            columns: cols,
        });
    }

    // Foreign keys
    let mut fk_rows = conn
        .query(&format!("PRAGMA foreign_key_list(\"{}\")", safe_table), ())
        .await
        .map_err(|e| format!("{e}"))?;

    let mut foreign_keys = Vec::new();
    while let Some(r) = fk_rows.next().await.map_err(|e| format!("{e}"))? {
        let from: String = r.get::<String>(3).unwrap_or_default();
        let ref_table: String = r.get::<String>(2).unwrap_or_default();
        let ref_column: String = r.get::<String>(4).unwrap_or_default();
        foreign_keys.push(ForeignKeyInfo {
            name: format!("fk_{}_{}", table, from),
            column: from,
            ref_table,
            ref_column,
            on_delete: r.get::<String>(6).ok(),
            on_update: r.get::<String>(5).ok(),
        });
    }

    Ok(TableStructure {
        columns,
        indexes,
        foreign_keys,
    })
}

// ── DDL Commands (Phase 17.4) ───────────────────────────────────────

#[tauri::command]
pub async fn dbc_execute_ddl(
    state: tauri::State<'_, DbClientState>,
    pool_id: String,
    sql: String,
) -> Result<String, String> {
    let pools = state.pools.lock().await;
    let pool = pools.get(&pool_id).ok_or("Connection not found")?;

    match pool {
        super::db_connection::DbPool::MySQL(p) => {
            sqlx::query(&sql)
                .execute(p)
                .await
                .map_err(|e| format!("{e}"))?;
        }
        super::db_connection::DbPool::Postgres(p) => {
            sqlx::query(&sql)
                .execute(p)
                .await
                .map_err(|e| format!("{e}"))?;
        }
        super::db_connection::DbPool::Sqlite(db) => {
            let conn = db.connect().map_err(|e| format!("SQLite connect: {e}"))?;
            conn.execute(&sql, ()).await.map_err(|e| format!("{e}"))?;
        }
    }

    Ok("DDL executed successfully".to_string())
}

#[tauri::command]
pub async fn dbc_drop_table(
    state: tauri::State<'_, DbClientState>,
    pool_id: String,
    database: Option<String>,
    table: String,
) -> Result<String, String> {
    let safe_table = table.replace(['\'', '"', ';', '\\'], "");
    let sql = match database {
        Some(ref db) => {
            let safe_db = db.replace(['\'', '"', ';', '\\'], "");
            format!("DROP TABLE IF EXISTS `{safe_db}`.`{safe_table}`")
        }
        None => format!("DROP TABLE IF EXISTS \"{safe_table}\""),
    };

    dbc_execute_ddl(state, pool_id, sql).await
}

// ── ER Schema (Phase 17.5) ─────────────────────────────────────────

#[derive(Debug, Serialize, Clone)]
pub struct ErColumnInfo {
    pub name: String,
    pub data_type: String,
    pub is_primary_key: bool,
    pub is_nullable: bool,
}

#[derive(Debug, Serialize, Clone)]
pub struct ErForeignKey {
    pub column: String,
    pub ref_table: String,
    pub ref_column: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct ErTableInfo {
    pub name: String,
    pub columns: Vec<ErColumnInfo>,
    pub foreign_keys: Vec<ErForeignKey>,
}

/// Fetch the full ER schema: all tables with their columns and FK relations.
#[tauri::command]
pub async fn dbc_get_er_schema(
    state: tauri::State<'_, DbClientState>,
    pool_id: String,
    database: Option<String>,
) -> Result<Vec<ErTableInfo>, String> {
    let pools = state.pools.lock().await;
    let pool = pools.get(&pool_id).ok_or("Connection not found")?;

    match pool {
        super::db_connection::DbPool::MySQL(p) => {
            er_schema_mysql(p, database.as_deref()).await
        }
        super::db_connection::DbPool::Postgres(p) => {
            er_schema_postgres(p, database.as_deref()).await
        }
        super::db_connection::DbPool::Sqlite(db) => {
            er_schema_sqlite(db).await
        }
    }
}

async fn er_schema_mysql(
    pool: &sqlx::MySqlPool,
    database: Option<&str>,
) -> Result<Vec<ErTableInfo>, String> {
    let db_clause = match database {
        Some(db) => format!("'{}'", db.replace('\'', "''")),
        None => "DATABASE()".to_string(),
    };

    let table_rows = sqlx::query(&format!(
        "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = {} AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME",
        db_clause
    ))
    .fetch_all(pool)
    .await
    .map_err(|e| format!("{e}"))?;

    let mut result = Vec::new();

    for trow in &table_rows {
        let table_name: String = trow.get(0);

        let col_rows = sqlx::query(&format!(
            "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = {} AND TABLE_NAME = '{}' ORDER BY ORDINAL_POSITION",
            db_clause,
            table_name.replace('\'', "''")
        ))
        .fetch_all(pool)
        .await
        .map_err(|e| format!("{e}"))?;

        let columns: Vec<ErColumnInfo> = col_rows
            .iter()
            .map(|r| ErColumnInfo {
                name: r.get(0),
                data_type: r.get(1),
                is_primary_key: r.get::<String, _>(3) == "PRI",
                is_nullable: r.get::<String, _>(2) == "YES",
            })
            .collect();

        let fk_rows = sqlx::query(&format!(
            "SELECT COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = {} AND TABLE_NAME = '{}' AND REFERENCED_TABLE_NAME IS NOT NULL",
            db_clause,
            table_name.replace('\'', "''")
        ))
        .fetch_all(pool)
        .await
        .map_err(|e| format!("{e}"))?;

        let foreign_keys: Vec<ErForeignKey> = fk_rows
            .iter()
            .map(|r| ErForeignKey {
                column: r.get(0),
                ref_table: r.get(1),
                ref_column: r.get(2),
            })
            .collect();

        result.push(ErTableInfo {
            name: table_name,
            columns,
            foreign_keys,
        });
    }

    Ok(result)
}

async fn er_schema_postgres(
    pool: &sqlx::PgPool,
    database: Option<&str>,
) -> Result<Vec<ErTableInfo>, String> {
    let schema = database.unwrap_or("public");

    let table_rows = sqlx::query(
        "SELECT tablename FROM pg_tables WHERE schemaname = $1 ORDER BY tablename",
    )
    .bind(schema)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("{e}"))?;

    let mut result = Vec::new();

    for trow in &table_rows {
        let table_name: String = trow.get(0);

        let col_rows = sqlx::query(
            "SELECT c.column_name, c.data_type, c.is_nullable, \
             CASE WHEN tc.constraint_type = 'PRIMARY KEY' THEN true ELSE false END as is_pk \
             FROM information_schema.columns c \
             LEFT JOIN information_schema.key_column_usage kcu ON c.column_name = kcu.column_name AND c.table_name = kcu.table_name AND c.table_schema = kcu.table_schema \
             LEFT JOIN information_schema.table_constraints tc ON kcu.constraint_name = tc.constraint_name AND tc.constraint_type = 'PRIMARY KEY' \
             WHERE c.table_schema = $1 AND c.table_name = $2 \
             ORDER BY c.ordinal_position"
        )
        .bind(schema)
        .bind(&table_name)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("{e}"))?;

        let columns: Vec<ErColumnInfo> = col_rows
            .iter()
            .map(|r| ErColumnInfo {
                name: r.get(0),
                data_type: r.get(1),
                is_primary_key: r.try_get::<bool, _>(3).unwrap_or(false),
                is_nullable: r.get::<String, _>(2) == "YES",
            })
            .collect();

        let fk_rows = sqlx::query(
            "SELECT kcu.column_name, ccu.table_name AS ref_table, ccu.column_name AS ref_column \
             FROM information_schema.table_constraints tc \
             JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema \
             JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema \
             WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1 AND tc.table_name = $2"
        )
        .bind(schema)
        .bind(&table_name)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("{e}"))?;

        let foreign_keys: Vec<ErForeignKey> = fk_rows
            .iter()
            .map(|r| ErForeignKey {
                column: r.get(0),
                ref_table: r.get(1),
                ref_column: r.get(2),
            })
            .collect();

        result.push(ErTableInfo {
            name: table_name,
            columns,
            foreign_keys,
        });
    }

    Ok(result)
}

async fn er_schema_sqlite(
    db: &libsql::Database,
) -> Result<Vec<ErTableInfo>, String> {
    let conn = db.connect().map_err(|e| format!("SQLite connect: {e}"))?;

    let mut table_rows = conn
        .query(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
            (),
        )
        .await
        .map_err(|e| format!("{e}"))?;

    let mut table_names = Vec::new();
    while let Some(row) = table_rows.next().await.map_err(|e| format!("{e}"))? {
        table_names.push(row.get::<String>(0).unwrap_or_default());
    }

    let mut result = Vec::new();

    for table_name in &table_names {
        let safe_table = table_name.replace(['\'', '"', ';', '\\'], "");

        let mut col_rows = conn
            .query(&format!("PRAGMA table_info(\"{}\")", safe_table), ())
            .await
            .map_err(|e| format!("{e}"))?;

        let mut columns = Vec::new();
        while let Some(r) = col_rows.next().await.map_err(|e| format!("{e}"))? {
            columns.push(ErColumnInfo {
                name: r.get::<String>(1).unwrap_or_default(),
                data_type: r.get::<String>(2).unwrap_or_default(),
                is_primary_key: r.get::<i32>(5).unwrap_or(0) > 0,
                is_nullable: r.get::<i32>(3).unwrap_or(0) == 0,
            });
        }

        let mut fk_rows = conn
            .query(&format!("PRAGMA foreign_key_list(\"{}\")", safe_table), ())
            .await
            .map_err(|e| format!("{e}"))?;

        let mut foreign_keys = Vec::new();
        while let Some(r) = fk_rows.next().await.map_err(|e| format!("{e}"))? {
            foreign_keys.push(ErForeignKey {
                column: r.get::<String>(3).unwrap_or_default(),
                ref_table: r.get::<String>(2).unwrap_or_default(),
                ref_column: r.get::<String>(4).unwrap_or_default(),
            });
        }

        result.push(ErTableInfo {
            name: table_name.clone(),
            columns,
            foreign_keys,
        });
    }

    Ok(result)
}
