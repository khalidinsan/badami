use super::db_connection::{DbClientState, DbPool};
use super::db_data::{mysql_row_to_json, pg_row_to_json, libsql_row_to_json, libsql_fetch_all};
use serde::Serialize;
use serde_json::Value as JsonValue;
use sqlx::{Column, Row};
use std::io::Write;

// ── Types ───────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct ExportResult {
    pub rows_exported: u64,
    pub file_path: String,
    pub duration_ms: u64,
}

#[derive(Debug, Serialize)]
pub struct ImportResult {
    pub rows_imported: u64,
    pub rows_failed: u64,
    pub errors: Vec<String>,
    pub duration_ms: u64,
}

// ── Export CSV ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn dbc_export_csv(
    state: tauri::State<'_, DbClientState>,
    pool_id: String,
    sql: String,
    output_path: String,
) -> Result<ExportResult, String> {
    let start = std::time::Instant::now();
    let pools = state.pools.lock().await;
    let pool = pools.get(&pool_id).ok_or("Connection not found")?;

    let query_sql = sql.trim().trim_end_matches(';').to_string();

    let (columns, rows) = fetch_all_rows(pool, &query_sql).await?;

    let mut wtr = csv::Writer::from_path(&output_path)
        .map_err(|e| format!("Failed to create CSV file: {e}"))?;

    wtr.write_record(&columns)
        .map_err(|e| format!("Failed to write CSV header: {e}"))?;

    let mut count = 0u64;
    for row in &rows {
        let record: Vec<String> = row
            .iter()
            .map(|v| match v {
                JsonValue::Null => String::new(),
                JsonValue::String(s) => s.clone(),
                other => other.to_string(),
            })
            .collect();
        wtr.write_record(&record)
            .map_err(|e| format!("Failed to write CSV row: {e}"))?;
        count += 1;
    }

    wtr.flush().map_err(|e| format!("Failed to flush CSV: {e}"))?;

    Ok(ExportResult {
        rows_exported: count,
        file_path: output_path,
        duration_ms: start.elapsed().as_millis() as u64,
    })
}

// ── Export JSON ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn dbc_export_json(
    state: tauri::State<'_, DbClientState>,
    pool_id: String,
    sql: String,
    output_path: String,
) -> Result<ExportResult, String> {
    let start = std::time::Instant::now();
    let pools = state.pools.lock().await;
    let pool = pools.get(&pool_id).ok_or("Connection not found")?;

    let query_sql = sql.trim().trim_end_matches(';').to_string();
    let (columns, rows) = fetch_all_rows(pool, &query_sql).await?;

    let json_rows: Vec<serde_json::Map<String, JsonValue>> = rows
        .iter()
        .map(|row| {
            let mut obj = serde_json::Map::new();
            for (i, col) in columns.iter().enumerate() {
                obj.insert(col.clone(), row.get(i).cloned().unwrap_or(JsonValue::Null));
            }
            obj
        })
        .collect();

    let json_str =
        serde_json::to_string_pretty(&json_rows).map_err(|e| format!("JSON serialize error: {e}"))?;

    std::fs::write(&output_path, json_str).map_err(|e| format!("Failed to write JSON file: {e}"))?;

    Ok(ExportResult {
        rows_exported: rows.len() as u64,
        file_path: output_path,
        duration_ms: start.elapsed().as_millis() as u64,
    })
}

// ── Export SQL (schema + data) ──────────────────────────────────────

#[tauri::command]
pub async fn dbc_export_sql(
    state: tauri::State<'_, DbClientState>,
    pool_id: String,
    database: Option<String>,
    tables: Vec<String>,
    output_path: String,
    with_data: bool,
    compress: bool,
) -> Result<ExportResult, String> {
    let start = std::time::Instant::now();
    let pools = state.pools.lock().await;
    let pool = pools.get(&pool_id).ok_or("Connection not found")?;

    let mut sql_output = String::new();
    sql_output.push_str("-- Exported by Badami Database Client\n");
    sql_output.push_str(&format!(
        "-- Date: {}\n\n",
        chrono::Local::now().format("%Y-%m-%d %H:%M:%S")
    ));

    let mut total_rows = 0u64;

    for table in &tables {
        // Get CREATE TABLE statement
        let create_stmt = get_create_statement(pool, database.as_deref(), table).await?;
        sql_output.push_str(&format!("-- Table: {}\n", table));
        sql_output.push_str(&format!("DROP TABLE IF EXISTS {};\n", quote_identifier(pool, table)));
        sql_output.push_str(&create_stmt);
        sql_output.push_str(";\n\n");

        if with_data {
            let select_sql = format!("SELECT * FROM {}", quote_identifier(pool, table));
            let (columns, rows) = fetch_all_rows(pool, &select_sql).await?;

            if !rows.is_empty() {
                for row in &rows {
                    let vals: Vec<String> = row
                        .iter()
                        .map(|v| match v {
                            JsonValue::Null => "NULL".into(),
                            JsonValue::Bool(b) => if *b { "1".into() } else { "0".into() },
                            JsonValue::Number(n) => n.to_string(),
                            JsonValue::String(s) => format!("'{}'", s.replace('\'', "''")),
                            _ => format!("'{}'", v.to_string().replace('\'', "''")),
                        })
                        .collect();

                    let col_list = columns
                        .iter()
                        .map(|c| quote_identifier(pool, c))
                        .collect::<Vec<_>>()
                        .join(", ");

                    sql_output.push_str(&format!(
                        "INSERT INTO {} ({}) VALUES ({});\n",
                        quote_identifier(pool, table),
                        col_list,
                        vals.join(", ")
                    ));
                    total_rows += 1;
                }
                sql_output.push('\n');
            }
        }
    }

    if compress {
        use flate2::write::GzEncoder;
        use flate2::Compression;

        let file = std::fs::File::create(&output_path)
            .map_err(|e| format!("Failed to create file: {e}"))?;
        let mut encoder = GzEncoder::new(file, Compression::default());
        encoder
            .write_all(sql_output.as_bytes())
            .map_err(|e| format!("Failed to write compressed file: {e}"))?;
        encoder
            .finish()
            .map_err(|e| format!("Failed to finish compression: {e}"))?;
    } else {
        std::fs::write(&output_path, &sql_output)
            .map_err(|e| format!("Failed to write SQL file: {e}"))?;
    }

    Ok(ExportResult {
        rows_exported: total_rows,
        file_path: output_path,
        duration_ms: start.elapsed().as_millis() as u64,
    })
}

// ── Import CSV ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn dbc_import_csv(
    state: tauri::State<'_, DbClientState>,
    pool_id: String,
    table: String,
    file_path: String,
    column_mapping: std::collections::HashMap<String, String>,
    skip_header: bool,
    delimiter: Option<String>,
) -> Result<ImportResult, String> {
    let start = std::time::Instant::now();
    let pools = state.pools.lock().await;
    let pool = pools.get(&pool_id).ok_or("Connection not found")?;

    let delim = delimiter
        .as_deref()
        .and_then(|s| s.bytes().next())
        .unwrap_or(b',');

    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(skip_header)
        .delimiter(delim)
        .from_path(&file_path)
        .map_err(|e| format!("Failed to open CSV file: {e}"))?;

    let headers: Vec<String> = if skip_header {
        rdr.headers()
            .map_err(|e| format!("Failed to read CSV headers: {e}"))?
            .iter()
            .map(String::from)
            .collect()
    } else {
        (0..column_mapping.len())
            .map(|i| i.to_string())
            .collect()
    };

    // Build target column list from mapping
    let target_columns: Vec<String> = headers
        .iter()
        .filter_map(|h| column_mapping.get(h).cloned())
        .collect();

    if target_columns.is_empty() {
        return Err("No column mappings provided".into());
    }

    let col_list = target_columns
        .iter()
        .map(|c| quote_identifier(pool, c))
        .collect::<Vec<_>>()
        .join(", ");

    let mut imported = 0u64;
    let mut failed = 0u64;
    let mut errors = Vec::new();
    let mut row_num = 0u64;

    for result in rdr.records() {
        row_num += 1;
        let record = match result {
            Ok(r) => r,
            Err(e) => {
                failed += 1;
                errors.push(format!("Row {}: parse error - {}", row_num, e));
                if errors.len() >= 100 {
                    errors.push("... (truncated, too many errors)".into());
                    break;
                }
                continue;
            }
        };

        let vals: Vec<String> = headers
            .iter()
            .enumerate()
            .filter(|(_, h)| column_mapping.contains_key(*h))
            .map(|(i, _)| {
                let val = record.get(i).unwrap_or("");
                if val.is_empty() {
                    "NULL".into()
                } else {
                    format!("'{}'", val.replace('\'', "''"))
                }
            })
            .collect();

        let insert_sql = format!(
            "INSERT INTO {} ({}) VALUES ({})",
            quote_identifier(pool, &table),
            col_list,
            vals.join(", ")
        );

        let exec_result: Result<(), String> = match pool {
            DbPool::MySQL(p) => sqlx::query(&insert_sql).execute(p).await.map(|_| ()).map_err(|e| e.to_string()),
            DbPool::Postgres(p) => sqlx::query(&insert_sql).execute(p).await.map(|_| ()).map_err(|e| e.to_string()),
            DbPool::Sqlite(db) => {
                let conn = db.connect().map_err(|e| e.to_string())?;
                conn.execute(&insert_sql, ()).await.map(|_| ()).map_err(|e| e.to_string())
            }
        };

        match exec_result {
            Ok(_) => imported += 1,
            Err(e) => {
                failed += 1;
                if errors.len() < 100 {
                    errors.push(format!("Row {}: {}", row_num, e));
                }
            }
        }
    }

    Ok(ImportResult {
        rows_imported: imported,
        rows_failed: failed,
        errors,
        duration_ms: start.elapsed().as_millis() as u64,
    })
}

// ── Import SQL ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn dbc_import_sql(
    state: tauri::State<'_, DbClientState>,
    pool_id: String,
    file_path: String,
) -> Result<ImportResult, String> {
    let start = std::time::Instant::now();
    let pools = state.pools.lock().await;
    let pool = pools.get(&pool_id).ok_or("Connection not found")?;

    let content = if file_path.ends_with(".gz") {
        use flate2::read::GzDecoder;
        use std::io::Read;

        let file = std::fs::File::open(&file_path)
            .map_err(|e| format!("Failed to open file: {e}"))?;
        let mut decoder = GzDecoder::new(file);
        let mut s = String::new();
        decoder.read_to_string(&mut s)
            .map_err(|e| format!("Failed to decompress file: {e}"))?;
        s
    } else {
        std::fs::read_to_string(&file_path)
            .map_err(|e| format!("Failed to read SQL file: {e}"))?
    };

    let statements = split_sql_statements(&content);

    let mut executed = 0u64;
    let mut failed_count = 0u64;
    let mut errors = Vec::new();

    for (i, stmt) in statements.iter().enumerate() {
        let trimmed = stmt.trim();
        if trimmed.is_empty() || trimmed.starts_with("--") {
            continue;
        }

        let exec_result: Result<(), String> = match pool {
            DbPool::MySQL(p) => sqlx::query(trimmed).execute(p).await.map(|_| ()).map_err(|e| e.to_string()),
            DbPool::Postgres(p) => sqlx::query(trimmed).execute(p).await.map(|_| ()).map_err(|e| e.to_string()),
            DbPool::Sqlite(db) => {
                let conn = db.connect().map_err(|e| e.to_string())?;
                conn.execute(trimmed, ()).await.map(|_| ()).map_err(|e| e.to_string())
            }
        };

        match exec_result {
            Ok(_) => executed += 1,
            Err(e) => {
                failed_count += 1;
                if errors.len() < 100 {
                    errors.push(format!("Statement {}: {}", i + 1, e));
                }
            }
        }
    }

    Ok(ImportResult {
        rows_imported: executed,
        rows_failed: failed_count,
        errors,
        duration_ms: start.elapsed().as_millis() as u64,
    })
}

// ── Preview CSV (for import wizard) ─────────────────────────────────

#[tauri::command]
pub async fn dbc_preview_csv(
    file_path: String,
    delimiter: Option<String>,
    max_rows: Option<usize>,
) -> Result<CsvPreview, String> {
    let delim = delimiter
        .as_deref()
        .and_then(|s| s.bytes().next())
        .unwrap_or(b',');

    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(true)
        .delimiter(delim)
        .from_path(&file_path)
        .map_err(|e| format!("Failed to open CSV: {e}"))?;

    let headers: Vec<String> = rdr
        .headers()
        .map_err(|e| format!("Failed to read headers: {e}"))?
        .iter()
        .map(String::from)
        .collect();

    let limit = max_rows.unwrap_or(5);
    let mut preview_rows = Vec::new();
    let mut total_rows = 0u64;

    for result in rdr.records() {
        total_rows += 1;
        if preview_rows.len() < limit {
            if let Ok(record) = result {
                preview_rows.push(record.iter().map(String::from).collect::<Vec<_>>());
            }
        }
    }

    Ok(CsvPreview {
        headers,
        rows: preview_rows,
        total_rows,
    })
}

#[derive(Debug, Serialize)]
pub struct CsvPreview {
    pub headers: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub total_rows: u64,
}

// ── Helpers ─────────────────────────────────────────────────────────

fn quote_identifier(pool: &DbPool, name: &str) -> String {
    match pool {
        DbPool::MySQL(_) => format!("`{}`", name.replace('`', "``")),
        DbPool::Postgres(_) | DbPool::Sqlite(_) => {
            format!("\"{}\"", name.replace('"', "\"\""))
        }
    }
}

async fn fetch_all_rows(
    pool: &DbPool,
    sql: &str,
) -> Result<(Vec<String>, Vec<Vec<JsonValue>>), String> {
    match pool {
        DbPool::MySQL(p) => {
            let rows = sqlx::query(sql)
                .fetch_all(p)
                .await
                .map_err(|e| format!("{e}"))?;

            let columns: Vec<String> = rows
                .first()
                .map(|r| r.columns().iter().map(|c| c.name().to_string()).collect())
                .unwrap_or_default();

            let data = rows.iter().map(|r| mysql_row_to_json(r, &columns)).collect();
            Ok((columns, data))
        }
        DbPool::Postgres(p) => {
            let rows = sqlx::query(sql)
                .fetch_all(p)
                .await
                .map_err(|e| format!("{e}"))?;

            let columns: Vec<String> = rows
                .first()
                .map(|r| r.columns().iter().map(|c| c.name().to_string()).collect())
                .unwrap_or_default();

            let data = rows.iter().map(|r| pg_row_to_json(r, &columns)).collect();
            Ok((columns, data))
        }
        DbPool::Sqlite(db) => {
            libsql_fetch_all(db, sql).await
        }
    }
}

async fn get_create_statement(
    pool: &DbPool,
    database: Option<&str>,
    table: &str,
) -> Result<String, String> {
    match pool {
        DbPool::MySQL(p) => {
            let sql = if let Some(db) = database {
                format!("SHOW CREATE TABLE `{}`.`{}`", db, table)
            } else {
                format!("SHOW CREATE TABLE `{}`", table)
            };
            let row = sqlx::query(&sql)
                .fetch_one(p)
                .await
                .map_err(|e| format!("{e}"))?;
            row.try_get::<String, _>(1)
                .map_err(|e| format!("{e}"))
        }
        DbPool::Postgres(p) => {
            // PG doesn't have SHOW CREATE TABLE — generate a basic one
            let sql = format!(
                "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = '{}' ORDER BY ordinal_position",
                table.replace('\'', "''")
            );
            let rows = sqlx::query(&sql)
                .fetch_all(p)
                .await
                .map_err(|e| format!("{e}"))?;

            let mut cols = Vec::new();
            for row in &rows {
                let name: String = row.try_get("column_name").unwrap_or_default();
                let dtype: String = row.try_get("data_type").unwrap_or_default();
                let nullable: String = row.try_get("is_nullable").unwrap_or_default();
                let default: Option<String> = row.try_get("column_default").ok();

                let mut col = format!("  \"{}\" {}", name, dtype);
                if nullable == "NO" {
                    col.push_str(" NOT NULL");
                }
                if let Some(d) = default {
                    col.push_str(&format!(" DEFAULT {}", d));
                }
                cols.push(col);
            }

            Ok(format!(
                "CREATE TABLE \"{}\" (\n{}\n)",
                table,
                cols.join(",\n")
            ))
        }
        DbPool::Sqlite(db) => {
            let conn = db.connect().map_err(|e| format!("SQLite connect: {e}"))?;
            let sql = format!(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='{}'",
                table.replace('\'', "''")
            );
            let mut rows = conn.query(&sql, ()).await.map_err(|e| format!("{e}"))?;
            match rows.next().await.map_err(|e| format!("{e}"))? {
                Some(row) => Ok(row.get::<String>(0).unwrap_or_default()),
                None => Err(format!("Table '{}' not found", table)),
            }
        }
    }
}

fn split_sql_statements(content: &str) -> Vec<String> {
    let mut statements = Vec::new();
    let mut current = String::new();
    let mut in_single_quote = false;
    let mut in_double_quote = false;
    let mut prev_char = '\0';

    for ch in content.chars() {
        match ch {
            '\'' if !in_double_quote && prev_char != '\\' => {
                in_single_quote = !in_single_quote;
                current.push(ch);
            }
            '"' if !in_single_quote && prev_char != '\\' => {
                in_double_quote = !in_double_quote;
                current.push(ch);
            }
            ';' if !in_single_quote && !in_double_quote => {
                let trimmed = current.trim().to_string();
                if !trimmed.is_empty() {
                    statements.push(trimmed);
                }
                current.clear();
            }
            _ => current.push(ch),
        }
        prev_char = ch;
    }

    let trimmed = current.trim().to_string();
    if !trimmed.is_empty() {
        statements.push(trimmed);
    }

    statements
}
