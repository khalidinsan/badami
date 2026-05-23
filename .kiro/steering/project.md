# Badami — Project Steering

## Overview

Badami adalah desktop productivity app (all-in-one workspace) dibangun dengan Tauri v2 + React 19 + TypeScript + SQLite. Fitur: projects, tasks, daily planning, floating sticky note, server management, credential vault, REST API tool, database client, cloud sync.

## Aturan Wajib: Update Versi

Setiap phase baru atau user request versi baru, update versi di **3 file sekaligus**:

- `src-tauri/tauri.conf.json` → `"version": "x.y.z"`
- `src-tauri/Cargo.toml` → `version = "x.y.z"`
- `package.json` → `"version": "x.y.z"`

Format SemVer. Phase besar = MINOR increment. Bugfix = PATCH increment. Jangan update versi untuk style tweak atau fix kecil.

## Stack

- **Frontend:** React 19 + TypeScript + Vite 7
- **Desktop:** Tauri v2
- **Styling:** Tailwind CSS v4 + shadcn/ui + Lucide React Icons
- **Font:** Plus Jakarta Sans (variable)
- **State:** Zustand
- **Routing:** TanStack Router (file-based)
- **DB:** SQLite via libsql (Rust) + Kysely (frontend query builder)
- **Editor:** BlockNote
- **Icons:** Lucide React — JANGAN gunakan emoji/emoticon sebagai icon

## Database

- Database dikelola Rust backend via **libsql**
- Frontend pakai **Kysely** dengan custom dialect → invoke Tauri commands (`db_query`, `db_execute`)
- `badami.db` — database utama lokal (selalu ada)
- `badami_sync.db` — embedded replica Turso (jika sync enabled)
- Migrations dikirim sebagai array SQL strings dari frontend via `db_init`
- Path: `~/Library/Application Support/com.khalid.badami/`

## Struktur Folder

```
src/
  routes/        → TanStack Router pages
  components/    → React components (ui/, layout/, editor/, projects/, tasks/, planning/, today/, search/, server/, credentials/, api/, database/, ai/, sync/)
  stores/        → Zustand stores (per domain)
  db/
    client.ts    → Kysely + libsql dialect setup
    migrations/  → SQL migration files
    queries/     → Kysely query functions
  hooks/         → Custom React hooks
  lib/           → Utilities
  types/         → TypeScript types
src-tauri/
  src/
    lib.rs       → Tauri app setup + command registration
    commands/    → Rust command modules (db, ssh, sftp, ftp, vault, credential, api, etc.)
  Cargo.toml
  tauri.conf.json
```

## Panduan Implementasi

- TypeScript strict mode
- Kysely untuk semua query — jangan raw SQL di frontend (kecuali migration files)
- Store Zustand terpisah per domain
- Rich text disimpan sebagai BlockNote JSON string di kolom `content`
- ID: UUID v4
- Timestamp: ISO string di SQLite
- Komponen UI dari shadcn/ui, kustomisasi sesuai kebutuhan

## Panduan Styling

- Glassmorphism: `glass-card`, `glass-sidebar`, `glass` utility classes
- Warna utama: macOS Tahoe Blue (`#007AFF` light, `#0A84FF` dark)
- JANGAN emoji sebagai icon — selalu Lucide React
- Border: `rgba` transparency untuk efek glass
- Radius: `rounded-xl` card, `rounded-lg` button/input
- Warna project: `bg-{color}-500/15 text-{color}-600`

## Referensi Dokumen Perencanaan

- `plan-server.md` — Server Management (Phase 9)
- `plan-credential.md` — Credential Manager (Phase 10)
- `plan-api.md` — REST API Tool (Phase 11)
- `plan-turso.md` — Cloud Sync (Phase 14)
- `plan-db-client.md` — Database Client (Phase 17)

Baca file plan yang relevan sebelum implementasi fitur phase tersebut.
