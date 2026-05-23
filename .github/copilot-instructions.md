---
applyTo: '**'
---

# Badami — Copilot Agent Instructions


## Aturan Wajib: Update Versi Aplikasi

Setiap kali ada dokumen perencanaan baru (misalnya `plan-xxx.md`) atau spec yang mendefinisikan **target versi rilis baru**, atau sesuai user request, kamu **WAJIB** mengupdate versi di **3 file berikut secara bersamaan**:

| File | Lokasi field |
|---|---|
| `src-tauri/tauri.conf.json` | `"version": "x.y.z"` |
| `src-tauri/Cargo.toml` | `version = "x.y.z"` |
| `package.json` | `"version": "x.y.z"` |

### Aturan Versi

- Format SemVer: `MAJOR.MINOR.PATCH`
- Setiap Phase besar = increment **MINOR** (e.g. Phase 15 → v1.7.0, Phase 16 → v1.8.0)
- Bugfix/hotfix = increment **PATCH** (e.g. v1.7.0 → v1.7.1)
- Versi di halaman About (`src/routes/about/index.tsx`) dibaca otomatis dari Tauri (`getVersion()`) — **tidak perlu diubah manual**

### Kapan Update

- Saat mulai mengimplementasikan phase baru yang punya target versi di dokumen plan-nya
- Saat user secara eksplisit menyebut versi baru
- **Jangan** update versi hanya karena bug fix kecil atau style tweak

---

## Database Access — MCP SQLite Server

Ketika membutuhkan akses langsung ke database untuk exploration, debugging, atau query kompleks, gunakan **MCP SQLite Server**:

**Database location:**
```
/Users/khalid/Library/Application Support/com.khalid.badami/badami.db
```
```
/Users/khalid/Library/Application Support/com.khalid.badami/badami_sync.db
```

**Arsitektur:**
- Database dikelola oleh Rust backend via **libsql** (bukan `tauri-plugin-sql`)
- Frontend menggunakan **Kysely** dengan custom dialect yang invoke Tauri commands (`db_query`, `db_execute`)
- `badami.db` — database utama lokal (selalu ada)
- `badami_sync.db` — embedded replica Turso (hanya ada jika cloud sync enabled)
- Strategi koneksi (offline-first):
  1. Sync enabled + `badami_sync.db` exists → buka replica langsung (instant, no network)
  2. Sync enabled + `badami_sync.db` belum ada → buka `badami.db`, build replica di background
  3. Sync disabled → buka `badami.db` sebagai SQLite biasa
- Migrations dijalankan via `db_init` Tauri command, dikirim sebagai array SQL strings dari frontend

**Cara mengakses:**
1. Aktivasi MCP SQLite Server tool (sudah tersedia di Copilot)
2. Gunakan tools berikut sesuai kebutuhan:
   - `mcp_mcp_sqlite_se_db_info` — info database (path, size, jumlah tabel)
   - `mcp_mcp_sqlite_se_list_tables` — daftar semua tabel
   - `mcp_mcp_sqlite_se_get_table_schema` — lihat struktur tabel (kolom, tipe, constraints)
   - `mcp_mcp_sqlite_se_query` — jalankan custom SQL query
   - `mcp_mcp_sqlite_se_read_records` — baca records dengan filter/limit/offset
   - `mcp_mcp_sqlite_se_create_record` — insert data baru
   - `mcp_mcp_sqlite_se_update_records` — update data berdasarkan kondisi
   - `mcp_mcp_sqlite_se_delete_records` — delete data berdasarkan kondisi

**Gunakan untuk:**
- Debugging data dalam database
- Exploring schema tabel baru
- Query kompleks yang sulit dilakukan via Kysely
- Verifikasi data setelah migrasi
- Testing query sebelum diimplementasikan di code

**JANGAN gunakan untuk:**
- Operasi data di production tanpa dokumentasi/backup (selalu backup database terlebih dahulu)
- Bypass logic aplikasi — update data harus melalui aplikasi jika ada business logic terkait

---

## Konvensi Kode Project

### Stack
- **Frontend:** React 19 + TypeScript + Vite
- **Desktop:** Tauri v2
- **Styling:** Tailwind CSS v4 + shadcn/ui (customized) + Lucide React Icons
- **Font:** Plus Jakarta Sans (variable)
- **Design:** Glassmorphism, macOS Tahoe Blue accent (#007AFF), clean & minimal
- **State:** Zustand
- **Routing:** TanStack Router (file-based)
- **DB:** SQLite via `tauri-plugin-sql` + Kysely (type-safe query builder)
- **Editor:** BlockNote
- **Icons:** Lucide React (JANGAN gunakan emoticon/emoji untuk icon UI)

### Struktur Folder Penting
```
src/
  routes/       → TanStack Router pages
  components/   → React components
    ui/         → shadcn/ui components
    layout/     → Sidebar, MainLayout, TodayWindow
    editor/     → BlockNote editor + extensions
    projects/   → Project components
    tasks/      → Task components
    planning/   → Planning/calendar components
    today/      → Sticky note window components
    search/     → Command palette
    server/     → Server Management (SSH terminal, file manager) — Phase 9
    credentials/ → Credential Manager (vault, encrypt/decrypt, TOTP) — Phase 10
  stores/       → Zustand stores
  db/
    client.ts   → SQLite connection
    migrations/ → SQL migration files
    queries/    → Kysely query functions
  hooks/        → Custom React hooks
  lib/          → Utilities (utils, dateUtils, fileSystem, osOpen)
  types/        → TypeScript type definitions
```

### Referensi Dokumen Perencanaan
- `plan-server.md` — Spesifikasi lengkap modul Server Management (Phase 9): SSH terminal, SFTP/FTP file manager, PEM key manager, arsitektur Rust backend, skema database baru, dan struktur folder. **Baca file ini sebelum mengimplementasikan fitur apapun di Phase 9.**
- `plan-credential.md` — Spesifikasi lengkap modul Credential Manager (Phase 10): 9 tipe credential, arsitektur enkripsi AES-256-GCM + Argon2id, vault & master password, TOTP, password generator, skema database, dan struktur folder. **Baca file ini sebelum mengimplementasikan fitur apapun di Phase 10.**
- `plan-api.md` — Spesifikasi lengkap modul REST API Tool (Phase 11): request builder, collections & folder organizer, environment variables, auth helpers (Bearer/Basic/API Key/OAuth2), integrasi Credential Manager, request history, import/export Postman, arsitektur reqwest Rust backend, skema database baru, dan struktur folder. **Baca file ini sebelum mengimplementasikan fitur apapun di Phase 11.**
- `plan-db-client.md` — Spesifikasi lengkap modul Database Client (Phase 17): connection manager MySQL/PostgreSQL/SQLite, table viewer, SQL query editor multi-tab, schema manager, ER diagram, export/import, SSH tunnel & SSL/TLS, arsitektur sqlx Rust backend, skema database baru, dan struktur folder. **Baca file ini sebelum mengimplementasikan fitur apapun di Phase 17.**

### Panduan Implementasi
- Selalu gunakan TypeScript strict mode
- Gunakan Kysely untuk semua query database — jangan raw SQL di frontend kecuali di migration files
- State management via Zustand — buat store terpisah per domain (projects, tasks, planning, pomodoro, settings)
- Komponen UI dasar ambil dari shadcn/ui, kustomisasi sesuai kebutuhan
- Semua konten rich text disimpan sebagai BlockNote JSON string di kolom `content`
- ID menggunakan UUID v4
- Timestamp disimpan sebagai ISO string di SQLite

### Panduan Styling
- Gunakan **glassmorphism** untuk card, sidebar, dan popover: `glass-card`, `glass-sidebar`, `glass` utility classes
- Warna utama: macOS Tahoe Blue (`#007AFF` light, `#0A84FF` dark)
- Font: `Plus Jakarta Sans Variable` — sudah di-setup di `index.css`
- **JANGAN** gunakan emoji/emoticon sebagai icon — selalu gunakan Lucide React icons
- Gunakan `PROJECT_ICONS` map dari `ProjectCard.tsx` untuk icon project (Lucide-based)
- Untuk warna project, gunakan pattern `bg-{color}-500/15 text-{color}-600` (soft tint, bukan solid)
- Border gunakan `rgba` transparency untuk efek glass
- Radius default: `rounded-xl` untuk card, `rounded-lg` untuk button/input
