# Tauri + React + Typescript

<p align="center">
  <img src="public/logo.png" alt="Badami" height="72" />
</p>

<h1 align="center">Badami</h1>

<p align="center">
  A focused productivity desktop app — projects, tasks, daily planning, and much more.<br/>
  Built with <strong>Tauri v2</strong> · <strong>React 19</strong> · <strong>TypeScript</strong> · <strong>SQLite</strong>
</p>

<p align="center">
  <code>v1.13.0</code>
</p>

---

## Features

- **Projects & Pages** — Rich BlockNote editor, project overview, and nested pages
- **Tasks** — Priorities, labels, due dates, subtasks, recurring tasks, reminders, list & Kanban board views, drag-to-reorder, bulk actions
- **Daily Planning** — Drag tasks onto a calendar, free-form daily notes, progress bar
- **Today Window** — Floating compact window with Pomodoro timer (custom durations)
- **Server Management** — SSH terminal, SFTP/FTP file manager, PEM key manager, saved commands, remote code editor
- **Local Dev** — macOS Herd-replacement orchestrator: `*.test` sites, multi-version PHP-FPM, nginx (Mode A `:8080`), MariaDB datadir reuse, Redis; import preserves existing data
- **Credential Vault** — AES-256-GCM encrypted vault, TOTP authenticator, password generator
- **REST API Tool** — Request builder, collections, environments, auth helpers, Postman import, cURL export
- **Database Client** — MySQL/PostgreSQL/SQLite connections, query editor, table viewer, ER diagram, schema management, export/import
- **AI Assistant** — OpenRouter integration, tool-use, streaming responses, multi-model support
- **Notification Center** — Daily summary, task reminders, overdue alerts, LLM-generated text
- **Quick Search** — ⌘K command palette for fast navigation
- **Stats** — Productivity dashboard with charts
- **Sync** — Optional Turso LibSQL cloud sync with embedded replicas

---

## Local Dev (macOS, v1.13.0)

**Local Dev** is a manager/orchestrator for a local PHP stack (Laravel Herd replacement). Badami does **not** bundle PHP/nginx/MariaDB binaries; it discovers and start/stops existing tools (Herd leftovers, Homebrew, or manual paths) and reuses your MariaDB data in place.

| Capability | Default |
| --- | --- |
| HTTP | **Mode A** — unprivileged nginx on **`127.0.0.1:8080`** (`http://{site}.test:8080`) |
| Sites | Valet-style parks/links, PHP isolation, open in browser |
| MariaDB | Reuse Herd datadir in-place; optional register into Database Client |
| Redis / PHP-FPM | Supervised with nginx as part of **Start stack** |
| DNS `*.test` | Adopt existing `:53`, optional B-lite dnsmasq LaunchDaemon, or degraded mode |

Design and full acceptance criteria: [`plan-local-dev.md`](./plan-local-dev.md).

### Safety notes

- **Never deletes** the Herd MariaDB datadir (or any Herd app data) as part of normal ops. Import does **not** copy the ~15GB data dir by default and does **not** kill Herd processes automatically.
- **Mode A (`:8080`)** is the default so nginx needs no root. Port `:80` is optional (Mode B LaunchDaemon) after an explicit bootstrap.
- **Import preserves data** — parks, isolates, and service paths are registered; Herd configs on disk are not overwritten; no `DROP DATABASE` / `mysql_install_db`.
- **Double-open guard** — starting MariaDB hard-fails if another process already holds the same datadir (InnoDB protection).
- **`ld_bootstrap_uninstall`** (remove Badami-written LaunchDaemon units only) is **deferred to Phase B** (v1.14.0).

### Acceptance checklist (MVP)

- [ ] Herd import detects datadir candidate + park paths; trailing-slash parks deduped
- [ ] MariaDB starts **or** adopts; second start on same datadir fails safely
- [ ] Redis + php-fpm + nginx Mode A work; `curl -H 'Host: …' http://127.0.0.1:8080/` returns app HTML
- [ ] DNS healthy (adopt / B-lite / high-port) or stack continues with DNS degraded banner
- [ ] Hostname URL `http://{site}.test:8080` works when DNS is healthy
- [ ] `local_dev_%` tables excluded from Turso sync; no Herd datadir deletions
- [ ] Optional Local MariaDB connection registerable in Database Client
- [ ] Sidebar + tab keepalive render Local Dev (macOS only); Servers module unchanged

---

## Prerequisites

### All platforms

| Tool | Version | Install |
|------|---------|---------|
| [Node.js](https://nodejs.org/) | ≥ 20 LTS | `brew install node` / [nodejs.org](https://nodejs.org) |
| [Rust](https://rustup.rs/) | stable (≥ 1.77) | see below |
| [Tauri CLI](https://tauri.app/) | v2 | included via `npm run tauri` |

### Installing Rust

**macOS / Linux:**
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
rustup update stable
```

**Windows:**
1. Download and run [rustup-init.exe](https://win.rustup.rs/)
2. Follow the installer prompts (choose the default toolchain)
3. Restart your terminal

> **Windows extra requirement:** Install [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) — select **"Desktop development with C++"** during setup.

Verify installation:
```bash
rustc --version   # e.g. rustc 1.77.0
cargo --version   # e.g. cargo 1.77.0
```

### Platform-specific dependencies

**macOS** — no extra dependencies needed (Xcode Command Line Tools are sufficient):
```bash
xcode-select --install
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt update
sudo apt install -y libwebkit2gtk-4.1-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

**Windows** — already covered by the C++ Build Tools above.

---

## Getting started

```bash
# 1. Clone the repo
git clone https://github.com/your-username/badami.git
cd badami

# 2. Install Node dependencies
npm install

# 3. Start development (Vite + Tauri hot-reload)
npm run tauri dev
```

The first `tauri dev` run will compile all Rust crates — this can take **3–5 minutes**. Subsequent runs are incremental and much faster.

---

## Building for production

```bash
npm run tauri build
```

Output bundles are placed in `src-tauri/target/release/bundle/`:

| Platform | Artifact |
|----------|----------|
| macOS | `.dmg` (disk image), `.app` |
| Windows | `.msi` installer, `.exe` (NSIS) |
| Linux | `.deb`, `.AppImage`, `.rpm` |

---

## Project structure

```
badami/
├── src/                        # React frontend
│   ├── routes/                 # TanStack Router pages
│   │   ├── projects/           # Projects & nested pages
│   │   ├── tasks/              # Task management
│   │   ├── planning/           # Daily planning
│   │   ├── servers/            # Server management
│   │   ├── local-dev/          # Local Dev (macOS stack UI)
│   │   ├── credentials/        # Credential vault
│   │   ├── api/                # REST API tool
│   │   ├── database/           # Database client
│   │   ├── ai/                 # AI assistant
│   │   ├── stats/              # Productivity stats
│   │   └── settings/           # App settings
│   ├── components/             # UI components
│   │   ├── ui/                 # shadcn/ui primitives
│   │   ├── layout/             # App shell, sidebar, tabs
│   │   ├── editor/             # BlockNote editor
│   │   ├── projects/           # Project components
│   │   ├── tasks/              # Task components
│   │   ├── planning/           # Planning components
│   │   ├── today/              # Today window & Pomodoro
│   │   ├── server/             # SSH, SFTP, FTP components
│   │   ├── local-dev/          # Local Dev services, sites, import, doctor
│   │   ├── credentials/        # Vault & credential components
│   │   ├── api/                # API tool components
│   │   ├── database/           # DB client components
│   │   ├── ai/                 # AI chat components
│   │   ├── sync/               # Cloud sync components
│   │   └── search/             # Command palette
│   ├── stores/                 # Zustand stores (per domain)
│   ├── db/                     # SQLite client + Kysely queries + migrations
│   ├── hooks/                  # Custom React hooks
│   ├── lib/                    # Utilities
│   └── types/                  # TypeScript types
├── src-tauri/                  # Rust / Tauri backend
│   ├── src/
│   │   ├── main.rs
│   │   ├── lib.rs
│   │   └── commands/           # Tauri commands
│   │       ├── db.rs           # LibSQL database operations
│   │       ├── ssh.rs          # SSH sessions
│   │       ├── sftp.rs         # SFTP file operations
│   │       ├── ftp.rs          # FTP/FTPS operations
│   │       ├── vault.rs        # Encrypted vault
│   │       ├── credential.rs   # Credential management
│   │       ├── totp.rs         # TOTP generation
│   │       ├── password_gen.rs # Password generator
│   │       ├── api.rs          # HTTP request execution
│   │       ├── db_connection.rs # External DB connections
│   │       ├── db_schema.rs    # Schema introspection
│   │       ├── db_data.rs      # Data queries
│   │       ├── db_transfer.rs  # Data export/import
│   │       ├── local_dev/      # Local Dev supervisor, import, sites, doctor
│   │       └── file_watch.rs   # File watching
│   ├── resources/local-dev/    # Vendored valet-server + config templates
│   ├── Cargo.toml
│   └── tauri.conf.json
├── public/                     # Static assets
├── plan-local-dev.md           # Local Dev design (MVP Phase A / v1.13.0)
├── index.html
├── vite.config.ts
└── package.json
```

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Tauri v2 |
| Frontend | React 19 + TypeScript + Vite 7 |
| Styling | Tailwind CSS v4 + shadcn/ui |
| Rich text | BlockNote |
| Routing | TanStack Router (file-based) |
| State | Zustand |
| Database | SQLite via libsql + Kysely |
| Animations | Framer Motion |
| Icons | Lucide React |
| Terminal | xterm.js |
| SSH / SFTP | Rust `ssh2` crate |
| FTP | Rust `suppaftp` crate |
| Crypto | Rust `aes-gcm` + `argon2` |
| HTTP Client | Rust `reqwest` |
| DB Client | Rust `sqlx` (MySQL / PostgreSQL) |
| AI | OpenRouter API (streaming) |

---

## Contributing

1. Fork the repo and create a feature branch
2. Run `npm run tauri dev` to start development
3. Check `CHECKLIST.md` for open tasks and planned features
4. Open a pull request

---

## License

MIT
