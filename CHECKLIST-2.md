# Badami — Development Checklist (Lanjutan)

> Lanjutan dari `CHECKLIST.md`. Dimulai dari Phase 17.
> Format: `- [ ]` = belum selesai, `- [x]` = selesai

---

## Phase 17 — Database Client (v1.9.0)

### Phase 17.1 — Connection Manager

#### Setup & Infrastruktur
- [x] Buat migration `${number}_db_client_module.sql` (tabel: `db_connections`, `db_saved_queries`, `db_saved_query_folders`, `db_query_history`, `db_er_layouts`)
- [x] Update `src/types/db.ts` — tambah Kysely interface untuk tabel baru
- [x] Buat `src/db/queries/dbClient.ts` — CRUD connections, saved queries, query history, ER layouts
- [x] Update versi di `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` → v1.9.0

#### Cargo.toml — Tambah Dependencies
- [x] Tambah `sqlx` dengan features: `runtime-tokio-rustls`, `mysql`, `postgres`, `sqlite`
- [x] Tambah `csv = "1.3"`
- [x] Tambah `flate2 = "1.0"` untuk kompresi `.gz`

#### npm — Tambah Dependencies
- [x] Install `@codemirror/lang-sql`
- [x] Install `reactflow`
- [x] Install `@tanstack/react-virtual`
- [x] Install `papaparse`

#### Rust Backend — Connection
- [x] Buat `src-tauri/src/commands/db_connection.rs`:
  - `db_connect(connection_id)` — build pool dari config, support MySQL/PG/SQLite
  - `db_disconnect(pool_id)` — release pool dari state
  - `db_test_connection(config)` — test tanpa simpan, return latency
- [x] Buat `DbConnectionManager` state struct dengan `HashMap<String, DbPool>` (MySQL/Postgres/SQLite)
- [x] Register commands di `lib.rs` + tambah state `DbConnectionManager`
- [ ] SSH Tunnel support: buka TCP forward via `ssh2` (reuse session manager Phase 2)
- [ ] SSL/TLS support: inject TLS config (ca_cert, client_cert, client_key) ke sqlx connect options

#### Frontend — Store & Hooks
- [x] Buat `src/stores/dbStore.ts` — active connections, open tabs, pending cell edits
- [x] Buat `src/hooks/useDbConnection.ts` — connect, disconnect, pool state, test connection
- [x] Buat `src/db/queries/dbClient.ts` — CRUD db_connections, query history, saved queries

#### Frontend — Connection UI
- [x] Buat route `src/routes/database/index.tsx` — halaman utama DB Client
- [x] Tambah entry "Database" ke Sidebar navigasi dengan ikon Lucide
- [x] Buat `src/components/database/ConnectionList.tsx` — daftar koneksi grouped by project + global
- [x] Buat `src/components/database/ConnectionCard.tsx` — card dengan engine badge, status dot, actions (Connect, Edit, Duplicate, Delete) *(embedded in ConnectionList)*
- [x] Buat `src/components/database/ConnectionForm.tsx` — form multi-tab (General / SSH Tunnel / SSL / Advanced):
  - Tab General: engine picker, host, port, database, username, password + eye toggle
  - Tab General: field password dengan eye toggle + tombol "Link from Credential Manager" → buka CredentialPicker
  - Tab SSH Tunnel: toggle enable, SSH Server picker (link ke server dari Servers module via ssh_server_id), local port
  - Tab SSL: toggle enable, mode selector, CA/client cert/key file pickers
- [x] Buat `src/components/database/TestConnectionButton.tsx` — coba connect + tampilkan latency/error
- [x] Integrasi Credential Manager: tombol "Link from Credential Manager" di field password (General tab) → reuse `CredentialPicker` dari API module
- [x] Password keychain support: simpan password DB connection ke macOS Keychain (tidak disimpan ke database), mekanisme sama seperti Server module — `save_db_password`, `get_db_password`, `delete_db_password` via `keyring::Entry`
- [x] Password prompt dialog: saat Connect dan tidak ada password tersimpan di keychain, tampilkan dialog minta password dengan opsi "Save to keychain"
- [x] Tambah tab `🗄️ Database` di project detail (`src/routes/projects/$projectId.tsx`) — tampilkan koneksi yang ter-link ke project tersebut
- [x] Buat `src/components/database/ProjectDatabasePanel.tsx` — wrapper ConnectionList + ConnectionForm untuk project detail tab

---

### Phase 17.2 — Object Browser & Table Viewer

#### Rust Backend — Schema
- [x] Buat `src-tauri/src/commands/db_schema.rs`:
  - `db_list_databases(pool_id)` — list semua database/schema
  - `db_list_tables(pool_id, database)` — list tables, views, procedures, functions dengan row count
  - `db_get_table_structure(pool_id, database, table)` — kolom, tipe, nullable, PK, default, extra
  - `db_get_indexes(pool_id, database, table)` — index list
  - `db_get_foreign_keys(pool_id, database, table)` — FK list
  - `db_get_create_statement(pool_id, database, table)` — raw CREATE TABLE statement

#### Rust Backend — Data
- [x] Buat `src-tauri/src/commands/db_data.rs`:
  - `db_query(pool_id, sql, page, page_size)` — paginasi + return kolom + rows
  - `db_execute(pool_id, sql)` — non-SELECT, return rows affected + duration
  - `db_update_cell(pool_id, table, pk_col, pk_val, column, value)` — update satu cell
  - `db_insert_row(pool_id, table, data)` — insert row baru
  - `db_delete_rows(pool_id, table, pk_col, pk_vals)` — hapus baris berdasarkan PK

#### Frontend — Object Browser
- [x] Buat `src/components/database/DbSidebar.tsx` — panel kiri dengan tree objek DB
- [x] ~~Buat `src/components/database/DbObjectTree.tsx`~~ *(merged into DbSidebar — tree for tables & views with search + expand/collapse)*
- [x] Buat `src/components/database/DbWorkspace.tsx` — area utama dengan sidebar + tab manager
- [x] Buat `src/components/database/DbTabBar.tsx` — multi-tab bar, bisa close, new query
- [x] Buat `src/hooks/useDbSchema.ts` — fetch schema data, list databases/tables/structure

#### Frontend — Table Viewer
- [x] Buat `src/components/database/TableViewer.tsx` — render data tabel *(toolbar, filter panel, inline edit, pagination all-in-one)*
- [x] ~~Buat `src/components/database/TableToolbar.tsx`~~ *(merged into TableViewer toolbar row)*
- [x] ~~Buat `src/components/database/CellEditor.tsx`~~ *(inline edit built into TableViewer)*
- [x] ~~Buat `src/components/database/FilterPanel.tsx`~~ *(filter bar built into TableViewer)*
- [x] ~~Buat `src/hooks/useTableData.ts`~~ *(useDbData hook in useDbSchema.ts)*
- [x] Fitur Table Viewer:
  - [x] Pagination (50/100/500/1000 rows per page)
  - [x] Sort per kolom (klik header)
  - [ ] Resize lebar kolom (drag header border)
  - [ ] Freeze kolom pertama (pin)
  - [x] NULL ditampilkan sebagai label `NULL` abu-abu miring
  - [x] Inline cell edit — pending changes di-highlight kuning
  - [x] Apply semua pending changes (UPDATE)
  - [x] Rollback pending changes
  - [ ] Add Row — baris baru di bawah, langsung editable
  - [x] Delete Row (multi-select)
  - [x] Copy cell value (right-click)
  - [x] Copy row as JSON (right-click)
  - [ ] Copy row as SQL INSERT

---

### Phase 17.3 — SQL Query Editor

#### Frontend — Query Editor
- [x] Buat `src/components/database/QueryEditor.tsx` — CodeMirror 6 dengan SQL language mode
- [x] Buat `src/lib/sqlDialect.ts` — konfigurasi CodeMirror dialect per engine (MySQL/PostgreSQL/generic)
- [x] Buat `src/components/database/QueryToolbar.tsx` — Run, Run Selection, Stop, Save, Export
- [x] Buat `src/components/database/ResultGrid.tsx` — hasil query (reuse TableViewer)
- [x] Buat `src/hooks/useQueryEditor.ts` — run query, cancel, result state, multi-statement split
- [x] Fitur Query Editor:
  - [x] Syntax highlighting per engine dialect
  - [x] Auto-complete: SQL keywords, table names (dari schema cache), column names (context-aware setelah `FROM table.`)
  - [x] Run seluruh konten editor (Ctrl+Enter / Cmd+Enter)
  - [x] Run selection — hanya teks yang di-select
  - [x] Stop/cancel query yang sedang berjalan
  - [x] Multi-statement support (split by `;`, run satu per satu)
  - [x] Error highlight — underline merah di baris error + pesan di bawah
  - [x] Tab state persist (re-open app, query tab tetap ada)
  - [x] Double-click tab label → rename tab
  - [x] DB selector per tab (dropdown pilih database aktif)
  - [x] Tampilkan: rows count, duration, status (non-SELECT: "N rows affected")
  - [x] Multiple result set tabs (jika query multi-statement)

#### Query History & Saved Queries
- [x] Auto-save setiap query ke `db_query_history` saat dieksekusi
- [x] Buat `src/components/database/QueryHistory.tsx` — panel history dengan filter (connection, database, status, tanggal, search text)
- [x] Klik history item → load ke editor
- [x] Retensi default 90 hari (cleanup otomatis saat open)
- [x] Buat `src/components/database/SavedQueries.tsx` — panel saved queries + folder organizer
- [x] CRUD saved query: simpan dengan nama + deskripsi + tag
- [x] CRUD folder untuk saved queries
- [x] Quick access saved query dari sidebar

#### Export Result
- [x] Export result query ke CSV
- [x] Export result query ke JSON
- [x] Export result query ke SQL INSERT statements

---

### Phase 17.4 — Schema Manager

#### Rust Backend — DDL
- [x] Tambah commands di `db_schema.rs`:
  - `db_execute_ddl(pool_id, sql)` — jalankan DDL statement
  - `db_drop_table(pool_id, database, table)` — DROP TABLE IF EXISTS
  - `db_create_table(pool_id, sql)` — CREATE TABLE dari generated DDL
  - `db_alter_table(pool_id, sql)` — ALTER TABLE

#### Frontend — Schema Manager
- [x] Buat `src/lib/ddlGenerator.ts` — generate SQL DDL (`ALTER TABLE`, `CREATE TABLE`) dari schema changes
- [x] Buat `src/components/database/schema/TableStructureEditor.tsx` — editor kolom, index, FK dalam satu view tabular
- [x] ~~Buat `src/components/database/schema/ColumnForm.tsx`~~ *(inlined in TableStructureEditor)*
- [x] ~~Buat `src/components/database/schema/IndexForm.tsx`~~ *(inlined in TableStructureEditor)*
- [x] ~~Buat `src/components/database/schema/ForeignKeyForm.tsx`~~ *(inlined in TableStructureEditor)*
- [x] Buat `src/components/database/schema/CreateTableWizard.tsx` — wizard multi-step: nama tabel → kolom → index+FK → preview DDL → execute
- [x] Buat `src/components/database/schema/DdlPreviewModal.tsx` — modal tampil SQL DDL hasil generate sebelum eksekusi
- [x] Buat `src/hooks/useSchemaManager.ts` (update) — fetch + mutate struktur tabel
- [x] Fitur Schema Manager:
  - [x] Tampilkan struktur tabel (kolom, index, FK) dari kanan sidebar atau context menu
  - [x] Add column
  - [x] Edit column (nama, tipe, nullable, default, extra)
  - [ ] Reorder column (drag)
  - [x] Drop column dengan konfirmasi
  - [x] Add index
  - [x] Edit index
  - [x] Drop index
  - [x] Add foreign key
  - [x] Edit foreign key
  - [x] Drop foreign key
  - [x] Preview DDL sebelum apply
  - [x] Generate + tampilkan full `CREATE TABLE` statement

---

### Phase 17.5 — ER Diagram

#### Rust Backend — ER
- [x] ~~Buat `src-tauri/src/commands/db_er.rs`~~ *(merged into db_schema.rs)*:
  - `db_get_er_schema(pool_id, database)` — fetch semua tabel beserta kolom + FK relasi

#### Frontend — ER Diagram
- [x] Install dan setup React Flow
- [x] Buat `src/lib/erLayoutEngine.ts` — dagre auto-layout untuk node posisi awal
- [x] Buat `src/hooks/useErDiagram.ts` — fetch schema → transform ke React Flow nodes/edges, load/save layout dari DB
- [x] Buat `src/components/database/er/ErDiagram.tsx` — canvas React Flow
- [x] Buat `src/components/database/er/TableNode.tsx` — node per tabel: nama tabel + daftar kolom (nama + tipe, PK icon)
- [x] Buat `src/components/database/er/ErToolbar.tsx` — toolbar: auto-layout, fit screen, export PNG/SVG, filter tabel
- [x] Fitur ER Diagram:
  - [x] Generate otomatis dari FK yang ada di schema
  - [x] Edge per FK dengan crow's foot notation (1-to-many)
  - [ ] Klik node → highlight semua relasi tabel tersebut
  - [ ] Klik edge → tampilkan detail FK (kolom, ON DELETE/UPDATE rule)
  - [x] Drag node untuk reposisi manual
  - [x] Zoom in/out, fit to screen
  - [ ] Filter: tampilkan/sembunyikan tabel tertentu
  - [x] Dagre auto-layout button
  - [x] Simpan posisi node ke `db_er_layouts`
  - [x] Export diagram sebagai PNG
  - [x] Export diagram sebagai SVG

---

### Phase 17.6 — Export & Import

#### Rust Backend — Transfer
- [x] Buat `src-tauri/src/commands/db_transfer.rs`:
  - `dbc_export_csv(pool_id, sql, output_path)` — export result query ke file CSV via `csv` crate
  - `dbc_export_json(pool_id, sql, output_path)` — export result query ke JSON
  - `dbc_export_sql(pool_id, database, tables, output_path, with_data, compress)` — export schema+data ke `.sql` / `.sql.gz`
  - `dbc_import_csv(pool_id, table, file_path, column_mapping, skip_header, delimiter)` — import CSV, return per-row error log
  - `dbc_import_sql(pool_id, file_path)` — run file `.sql`/`.sql.gz`, return progress + error log
  - `dbc_preview_csv(file_path, delimiter, max_rows)` — preview CSV headers + first N rows

#### Frontend — Export & Import
- [x] Buat `src/components/database/transfer/ExportModal.tsx` — opsi export (format, tabel/query selector, kompresi)
- [x] Buat `src/components/database/transfer/ImportModal.tsx` — wizard import:
  - [x] Pilih format (CSV / SQL)
  - [x] File picker
  - [x] Preview 5 baris pertama (untuk CSV)
  - [x] Column mapping (CSV kolom → DB kolom, auto-match by name)
  - [x] Opsi: skip header, delimiter
  - [x] Run import + progress result
  - [x] Summary: N rows inserted, M rows failed + detail error per baris
- [x] Buat `src/components/database/transfer/TransferProgress.tsx` — progress display + error log
- [x] Buat `src/hooks/useDbTransfer.ts` — export/import progress state, invoke Rust commands
- [x] Tambah tombol Export & Import di DbSidebar header

---

### Phase 17.7 — Polish & QA

- [x] Engine badge warna di connection card (MySQL: orange, PostgreSQL: blue, SQLite: green, MariaDB: teal)
- [x] Query execution plan viewer — tombol "Explain" di query editor → run `EXPLAIN`/`EXPLAIN ANALYZE` + tampilkan result
- [x] Keyboard shortcuts:
  - [x] `Ctrl/Cmd+Enter` = Run query
  - [x] `Ctrl/Cmd+Shift+Enter` = Run selection
  - [x] `Ctrl/Cmd+W` = Close current tab
  - [x] `Ctrl/Cmd+T` = New query tab
- [x] Empty states yang informatif:
  - [x] Empty state halaman connection list (no connections yet)
  - [x] Empty state saat table kosong (no rows)
  - [x] Empty state query history (no history yet)
- [ ] Error handling informatif:
  - [x] Connection timeout
  - [x] Auth failed (wrong password)
  - [x] DB not found
  - [x] Query syntax error
  - [ ] SSL handshake failure
  - [ ] SSH tunnel failure
- [x] Loading skeleton untuk table data saat fetch
- [x] Loading skeleton untuk object tree saat expand node
- [x] Truncate table action dengan konfirmasi dialog
- [x] Refresh schema tree setelah DDL dieksekusi
- [x] Tambah entry "Database Client" ke sidebar Badami dengan Lucide `Database` icon
- [x] Update `CHECKLIST-2.md` setiap fitur selesai
