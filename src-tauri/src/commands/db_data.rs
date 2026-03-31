use super::db_connection::{DbClientState, DbPool};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use sqlx::{Column, Row};

// ── Types ───────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<JsonValue>>,
    pub total_rows: Option<i64>,
    pub duration_ms: u64,
}

#[derive(Debug, Serialize)]
pub struct ExecuteResult {
    pub rows_affected: u64,
    pub duration_ms: u64,
}

#[derive(Debug, Deserialize)]
pub struct CellUpdate {
    pub column: String,
    pub value: JsonValue,
}

// ── Helpers ─────────────────────────────────────────────────────────

pub fn mysql_row_to_json(row: &sqlx::mysql::MySqlRow, columns: &[String]) -> Vec<JsonValue> {
    columns
        .iter()
        .map(|col| {
            // Try common types in order
            if let Ok(v) = row.try_get::<Option<i64>, _>(col.as_str()) {
                return v.map(JsonValue::from).unwrap_or(JsonValue::Null);
            }
            if let Ok(v) = row.try_get::<Option<f64>, _>(col.as_str()) {
                return v
                    .map(|f| serde_json::Number::from_f64(f).map(JsonValue::Number).unwrap_or(JsonValue::Null))
                    .unwrap_or(JsonValue::Null);
            }
            if let Ok(v) = row.try_get::<Option<String>, _>(col.as_str()) {
                return v.map(JsonValue::from).unwrap_or(JsonValue::Null);
            }
            if let Ok(v) = row.try_get::<Option<bool>, _>(col.as_str()) {
                return v.map(JsonValue::from).unwrap_or(JsonValue::Null);
            }
            // Fallback: try raw bytes as string
            if let Ok(v) = row.try_get::<Option<Vec<u8>>, _>(col.as_str()) {
                return v
                    .map(|b| JsonValue::String(String::from_utf8_lossy(&b).into()))
                    .unwrap_or(JsonValue::Null);
            }
            JsonValue::Null
        })
        .collect()
}

pub fn pg_row_to_json(row: &sqlx::postgres::PgRow, columns: &[String]) -> Vec<JsonValue> {
    columns
        .iter()
        .map(|col| {
            if let Ok(v) = row.try_get::<Option<i64>, _>(col.as_str()) {
                return v.map(JsonValue::from).unwrap_or(JsonValue::Null);
            }
            if let Ok(v) = row.try_get::<Option<i32>, _>(col.as_str()) {
                return v.map(JsonValue::from).unwrap_or(JsonValue::Null);
            }
            if let Ok(v) = row.try_get::<Option<f64>, _>(col.as_str()) {
                return v
                    .map(|f| serde_json::Number::from_f64(f).map(JsonValue::Number).unwrap_or(JsonValue::Null))
                    .unwrap_or(JsonValue::Null);
            }
            if let Ok(v) = row.try_get::<Option<bool>, _>(col.as_str()) {
                return v.map(JsonValue::from).unwrap_or(JsonValue::Null);
            }
            if let Ok(v) = row.try_get::<Option<String>, _>(col.as_str()) {
                return v.map(JsonValue::from).unwrap_or(JsonValue::Null);
            }
            JsonValue::Null
        })
        .collect()
}

pub fn libsql_value_to_json(val: libsql::Value) -> JsonValue {
    match val {
        libsql::Value::Null => JsonValue::Null,
        libsql::Value::Integer(i) => JsonValue::from(i),
        libsql::Value::Real(f) => serde_json::Number::from_f64(f)
            .map(JsonValue::Number)
            .unwrap_or(JsonValue::Null),
        libsql::Value::Text(s) => JsonValue::String(s),
        libsql::Value::Blob(b) => JsonValue::String(String::from_utf8_lossy(&b).into()),
    }
}

pub fn libsql_row_to_json(row: &libsql::Row, col_count: i32) -> Vec<JsonValue> {
    (0..col_count)
        .map(|i| libsql_value_to_json(row.get_value(i).unwrap_or(libsql::Value::Null)))
        .collect()
}

/// Helper: run a libsql query and collect all rows as (columns, rows_data).
pub async fn libsql_fetch_all(
    db: &libsql::Database,
    sql: &str,
) -> Result<(Vec<String>, Vec<Vec<JsonValue>>), String> {
    let conn = db.connect().map_err(|e| format!("SQLite connect: {e}"))?;
    let mut rows = conn.query(sql, ()).await.map_err(|e| format!("{e}"))?;

    let col_count = rows.column_count() as i32;
    let columns: Vec<String> = (0..col_count)
        .map(|i| rows.column_name(i).unwrap_or("").to_string())
        .collect();

    let mut data = Vec::new();
    while let Some(row) = rows.next().await.map_err(|e| format!("{e}"))? {
        data.push(libsql_row_to_json(&row, col_count));
    }

    Ok((columns, data))
}

// ── Commands ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn dbc_query(
    state: tauri::State<'_, DbClientState>,
    pool_id: String,
    sql: String,
    database: Option<String>,
    page: Option<u32>,
    page_size: Option<u32>,
) -> Result<QueryResult, String> {
    let start = std::time::Instant::now();
    let pools = state.pools.lock().await;
    let pool = pools.get(&pool_id).ok_or("Connection not found")?;

    let limit = page_size.unwrap_or(100) as i64;
    let offset = ((page.unwrap_or(1) as i64) - 1) * limit;

    // Wrap SQL with LIMIT/OFFSET for pagination (MySQL style — subquery)
    let paginated_sql = format!(
        "SELECT * FROM ({}) AS _q LIMIT {} OFFSET {}",
        sql.trim().trim_end_matches(';'),
        limit,
        offset
    );

    match pool {
        DbPool::MySQL(p) => {
            // Acquire a dedicated connection so USE db + query share the same session
            let mut conn = p.acquire().await.map_err(|e| format!("Acquire connection: {e}"))?;

            // Switch database context when requested
            if let Some(db_name) = &database {
                if !db_name.is_empty() {
                    sqlx::query(&format!("USE `{}`", db_name.replace('`', "``")))
                        .execute(&mut *conn)
                        .await
                        .map_err(|e| format!("USE database failed: {e}"))?;
                }
            }

            // Get total count
            let count_sql = format!(
                "SELECT COUNT(*) AS cnt FROM ({}) AS _c",
                sql.trim().trim_end_matches(';')
            );
            let total = sqlx::query(&count_sql)
                .fetch_one(&mut *conn)
                .await
                .ok()
                .and_then(|r| r.try_get::<i64, _>(0).ok());

            let rows = sqlx::query(&paginated_sql)
                .fetch_all(&mut *conn)
                .await
                .map_err(|e| format!("{e}"))?;

            let columns: Vec<String> = if let Some(first) = rows.first() {
                first.columns().iter().map(|c| c.name().to_string()).collect()
            } else {
                Vec::new()
            };

            let data: Vec<Vec<JsonValue>> = rows
                .iter()
                .map(|r| mysql_row_to_json(r, &columns))
                .collect();

            Ok(QueryResult {
                columns,
                rows: data,
                total_rows: total,
                duration_ms: start.elapsed().as_millis() as u64,
            })
        }
        DbPool::Postgres(p) => {
            let count_sql = format!(
                "SELECT COUNT(*) AS cnt FROM ({}) AS _c",
                sql.trim().trim_end_matches(';')
            );
            let total = sqlx::query(&count_sql)
                .fetch_one(p)
                .await
                .ok()
                .and_then(|r| r.try_get::<i64, _>(0).ok());

            // PG doesn't need the subquery alias syntax the same way
            let pg_paginated = format!(
                "{} LIMIT {} OFFSET {}",
                sql.trim().trim_end_matches(';'),
                limit,
                offset
            );

            let rows = sqlx::query(&pg_paginated)
                .fetch_all(p)
                .await
                .map_err(|e| format!("{e}"))?;

            let columns: Vec<String> = if let Some(first) = rows.first() {
                first.columns().iter().map(|c| c.name().to_string()).collect()
            } else {
                Vec::new()
            };

            let data: Vec<Vec<JsonValue>> = rows
                .iter()
                .map(|r| pg_row_to_json(r, &columns))
                .collect();

            Ok(QueryResult {
                columns,
                rows: data,
                total_rows: total,
                duration_ms: start.elapsed().as_millis() as u64,
            })
        }
        DbPool::Sqlite(db) => {
            let conn = db.connect().map_err(|e| format!("SQLite connect: {e}"))?;

            let count_sql = format!(
                "SELECT COUNT(*) FROM ({})",
                sql.trim().trim_end_matches(';')
            );
            let total = {
                let mut cr = conn.query(&count_sql, ()).await.ok();
                match &mut cr {
                    Some(r) => r.next().await.ok().flatten().and_then(|row| row.get::<i64>(0).ok()),
                    None => None,
                }
            };

            let sqlite_paginated = format!(
                "{} LIMIT {} OFFSET {}",
                sql.trim().trim_end_matches(';'),
                limit,
                offset
            );

            let mut rows = conn.query(&sqlite_paginated, ()).await.map_err(|e| format!("{e}"))?;

            let col_count = rows.column_count() as i32;
            let columns: Vec<String> = (0..col_count)
                .map(|i| rows.column_name(i).unwrap_or("").to_string())
                .collect();

            let mut data = Vec::new();
            while let Some(row) = rows.next().await.map_err(|e| format!("{e}"))? {
                data.push(libsql_row_to_json(&row, col_count));
            }

            Ok(QueryResult {
                columns,
                rows: data,
                total_rows: total,
                duration_ms: start.elapsed().as_millis() as u64,
            })
        }
    }
}

#[tauri::command]
pub async fn dbc_execute(
    state: tauri::State<'_, DbClientState>,
    pool_id: String,
    sql: String,
) -> Result<ExecuteResult, String> {
    let start = std::time::Instant::now();
    let pools = state.pools.lock().await;
    let pool = pools.get(&pool_id).ok_or("Connection not found")?;

    let affected = match pool {
        DbPool::MySQL(p) => {
            sqlx::query(&sql)
                .execute(p)
                .await
                .map_err(|e| format!("{e}"))?
                .rows_affected()
        }
        DbPool::Postgres(p) => {
            sqlx::query(&sql)
                .execute(p)
                .await
                .map_err(|e| format!("{e}"))?
                .rows_affected()
        }
        DbPool::Sqlite(db) => {
            let conn = db.connect().map_err(|e| format!("SQLite connect: {e}"))?;
            conn.execute(&sql, ())
                .await
                .map_err(|e| format!("{e}"))? as u64
        }
    };

    Ok(ExecuteResult {
        rows_affected: affected,
        duration_ms: start.elapsed().as_millis() as u64,
    })
}

#[tauri::command]
pub async fn dbc_update_cell(
    state: tauri::State<'_, DbClientState>,
    pool_id: String,
    table: String,
    pk_column: String,
    pk_value: JsonValue,
    column: String,
    value: JsonValue,
) -> Result<(), String> {
    let pools = state.pools.lock().await;
    let pool = pools.get(&pool_id).ok_or("Connection not found")?;

    let val_str = json_to_sql_literal(&value);
    let pk_str = json_to_sql_literal(&pk_value);

    let sql = match pool {
        DbPool::MySQL(_) => format!(
            "UPDATE `{}` SET `{}` = {} WHERE `{}` = {}",
            table.replace('`', "``"),
            column.replace('`', "``"),
            val_str,
            pk_column.replace('`', "``"),
            pk_str,
        ),
        DbPool::Postgres(_) => format!(
            "UPDATE \"{}\" SET \"{}\" = {} WHERE \"{}\" = {}",
            table.replace('"', "\"\""),
            column.replace('"', "\"\""),
            val_str,
            pk_column.replace('"', "\"\""),
            pk_str,
        ),
        DbPool::Sqlite(_) => format!(
            "UPDATE \"{}\" SET \"{}\" = {} WHERE \"{}\" = {}",
            table.replace('"', "\"\""),
            column.replace('"', "\"\""),
            val_str,
            pk_column.replace('"', "\"\""),
            pk_str,
        ),
    };

    match pool {
        DbPool::MySQL(p) => {
            sqlx::query(&sql).execute(p).await.map_err(|e| format!("{e}"))?;
        }
        DbPool::Postgres(p) => {
            sqlx::query(&sql).execute(p).await.map_err(|e| format!("{e}"))?;
        }
        DbPool::Sqlite(db) => {
            let conn = db.connect().map_err(|e| format!("SQLite connect: {e}"))?;
            conn.execute(&sql, ()).await.map_err(|e| format!("{e}"))?;
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn dbc_insert_row(
    state: tauri::State<'_, DbClientState>,
    pool_id: String,
    table: String,
    data: std::collections::HashMap<String, JsonValue>,
) -> Result<(), String> {
    let pools = state.pools.lock().await;
    let pool = pools.get(&pool_id).ok_or("Connection not found")?;

    let cols: Vec<String> = data.keys().cloned().collect();
    let vals: Vec<String> = data.values().map(json_to_sql_literal).collect();

    let sql = match pool {
        DbPool::MySQL(_) => {
            let col_list = cols.iter().map(|c| format!("`{}`", c.replace('`', "``"))).collect::<Vec<_>>().join(", ");
            format!("INSERT INTO `{}` ({}) VALUES ({})", table.replace('`', "``"), col_list, vals.join(", "))
        }
        DbPool::Postgres(_) | DbPool::Sqlite(_) => {
            let col_list = cols.iter().map(|c| format!("\"{}\"", c.replace('"', "\"\""))).collect::<Vec<_>>().join(", ");
            format!("INSERT INTO \"{}\" ({}) VALUES ({})", table.replace('"', "\"\""), col_list, vals.join(", "))
        }
    };

    match pool {
        DbPool::MySQL(p) => {
            sqlx::query(&sql).execute(p).await.map_err(|e| format!("{e}"))?;
        }
        DbPool::Postgres(p) => {
            sqlx::query(&sql).execute(p).await.map_err(|e| format!("{e}"))?;
        }
        DbPool::Sqlite(db) => {
            let conn = db.connect().map_err(|e| format!("SQLite connect: {e}"))?;
            conn.execute(&sql, ()).await.map_err(|e| format!("{e}"))?;
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn dbc_delete_rows(
    state: tauri::State<'_, DbClientState>,
    pool_id: String,
    table: String,
    pk_column: String,
    pk_values: Vec<JsonValue>,
) -> Result<u64, String> {
    let pools = state.pools.lock().await;
    let pool = pools.get(&pool_id).ok_or("Connection not found")?;

    let in_list = pk_values
        .iter()
        .map(json_to_sql_literal)
        .collect::<Vec<_>>()
        .join(", ");

    let sql = match pool {
        DbPool::MySQL(_) => format!(
            "DELETE FROM `{}` WHERE `{}` IN ({})",
            table.replace('`', "``"),
            pk_column.replace('`', "``"),
            in_list,
        ),
        DbPool::Postgres(_) | DbPool::Sqlite(_) => format!(
            "DELETE FROM \"{}\" WHERE \"{}\" IN ({})",
            table.replace('"', "\"\""),
            pk_column.replace('"', "\"\""),
            in_list,
        ),
    };

    let affected = match pool {
        DbPool::MySQL(p) => sqlx::query(&sql).execute(p).await.map_err(|e| format!("{e}"))?.rows_affected(),
        DbPool::Postgres(p) => sqlx::query(&sql).execute(p).await.map_err(|e| format!("{e}"))?.rows_affected(),
        DbPool::Sqlite(db) => {
            let conn = db.connect().map_err(|e| format!("SQLite connect: {e}"))?;
            conn.execute(&sql, ()).await.map_err(|e| format!("{e}"))? as u64
        }
    };

    Ok(affected)
}

// ── Utility ─────────────────────────────────────────────────────────

fn json_to_sql_literal(val: &JsonValue) -> String {
    match val {
        JsonValue::Null => "NULL".into(),
        JsonValue::Bool(b) => if *b { "1".into() } else { "0".into() },
        JsonValue::Number(n) => n.to_string(),
        JsonValue::String(s) => {
            // Escape single quotes
            format!("'{}'", s.replace('\'', "''"))
        }
        _ => format!("'{}'", val.to_string().replace('\'', "''")),
    }
}
