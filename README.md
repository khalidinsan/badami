# Badami

<p align="center">
  <img src="public/logo.png" alt="Badami" height="72" />
</p>

<h1 align="center">Badami</h1>

<p align="center">
  A focused productivity desktop app — projects, tasks, daily planning, and much more.<br/>
  Built with <strong>Tauri v2</strong> · <strong>React 19</strong> · <strong>TypeScript</strong> · <strong>SQLite</strong>
</p>

<p align="center">
  <a href="https://github.com/khalidinsan/badami/releases/tag/v1.14.1"><code>v1.14.1</code></a>
  ·
  <a href="https://github.com/khalidinsan/badami/releases">Releases</a>
</p>

---

## Install (recommended)

Download a prebuilt installer from **[GitHub Releases](https://github.com/khalidinsan/badami/releases/latest)**.

| Platform | Asset |
|----------|--------|
| **macOS (Apple Silicon)** | `badami_*_aarch64.dmg` |
| **Windows** | `badami_*_x64-setup.exe` (or `.msi`) |
| **Linux** | `.AppImage` / `.deb` / `.rpm` |

### macOS first open (quarantine)

Builds are signed for the **in-app updater** but not Apple-notarized yet, so Gatekeeper may block the first launch. Clear quarantine after download:

```bash
# DMG
xattr -cr ~/Downloads/badami_1.14.1_aarch64.dmg
open ~/Downloads/badami_1.14.1_aarch64.dmg

# After dragging to Applications
xattr -cr /Applications/badami.app
open /Applications/badami.app
```

Or only remove the quarantine flag:

```bash
xattr -d com.apple.quarantine /Applications/badami.app
```

### In-app updates

After install, Badami checks **GitHub Releases** for newer versions:

- **About** → Updates  
- **Settings → Updates** → *Check for Updates*

Endpoint used by the updater:

```text
https://github.com/khalidinsan/badami/releases/latest/download/latest.json
```

Artifacts are minisign-signed; the public key is embedded in `src-tauri/tauri.conf.json`.

---

## Features

- **Projects & Pages** — Rich BlockNote editor, project overview, and nested pages
- **Tasks** — Priorities, labels, due dates, subtasks, recurring tasks, reminders, list & Kanban board views, drag-to-reorder, bulk actions
- **Daily Planning** — Drag tasks onto a calendar, free-form daily notes, progress bar
- **Today Window** — Floating compact window with Pomodoro timer (custom durations)
- **Server Management** — SSH terminal (keepalive + auto-reconnect), SFTP/FTP file manager, PEM key manager, saved commands, remote code editor
- **Local Dev** *(macOS)* — Herd-style orchestrator: `*.test` sites, multi-version PHP-FPM, nginx (Mode A `:8080`), MariaDB datadir reuse, Redis; import preserves existing data
- **Credential Vault** — AES-256-GCM encrypted vault, TOTP authenticator, password generator
- **REST API Tool** — Request builder, collections, environments, auth helpers, Postman import, cURL export
- **Database Client** — MySQL/PostgreSQL/SQLite connections, query editor, table viewer, ER diagram, schema management, export/import
- **AI Assistant** — OpenRouter integration, tool-use, streaming responses, multi-model support
- **Notification Center** — Daily summary, task reminders, overdue alerts
- **Quick Search** — ⌘K command palette for fast navigation
- **Stats** — Productivity dashboard with charts
- **Sync** — Optional Turso LibSQL cloud sync with embedded replicas
- **Auto-update** — Signed updates from GitHub Releases

---

## Local Dev (macOS)

**Local Dev** orchestrates a local PHP stack (Laravel Herd–style). Badami does **not** bundle PHP/nginx/MariaDB binaries; it discovers and start/stops existing tools (Herd leftovers, Homebrew, or manual paths) and reuses your MariaDB data in place.

| Capability | Default |
| --- | --- |
| HTTP | **Mode A** — unprivileged nginx on **`127.0.0.1:8080`** (`http://{site}.test:8080`) |
| Sites | Valet-style parks/links, PHP isolation, open in browser |
| MariaDB | Reuse Herd datadir in-place; optional register into Database Client |
| Redis / PHP-FPM | Supervised with nginx as part of **Start stack** |
| DNS `*.test` | Adopt existing `:53`, optional B-lite dnsmasq LaunchDaemon, or degraded mode |

Design notes: [`plan-local-dev.md`](./plan-local-dev.md).

### Safety notes

- **Never deletes** the Herd MariaDB datadir (or Herd app data) as part of normal ops.
- **Mode A (`:8080`)** is the default so nginx needs no root. Port `:80` is optional after explicit bootstrap.
- **Import preserves data** — parks, isolates, and service paths are registered; no `DROP DATABASE` / `mysql_install_db`.
- **Double-open guard** — starting MariaDB hard-fails if another process already holds the same datadir.
- Browser **Secure DNS / DoH** (e.g. Chrome → 1.1.1.1) bypasses `/etc/resolver` — turn it off for `*.test` to work in the browser even when Doctor’s system DNS probe is green.

---

## Prerequisites (development)

### All platforms

| Tool | Version | Install |
|------|---------|---------|
| [Node.js](https://nodejs.org/) | ≥ 20 LTS | `brew install node` / [nodejs.org](https://nodejs.org) |
| [Rust](https://rustup.rs/) | stable (≥ 1.77) | see below |
| [Tauri CLI](https://tauri.app/) | v2 | via `npm run tauri` |

### Installing Rust

**macOS / Linux:**
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
rustup update stable
```

**Windows:**
1. Download and run [rustup-init.exe](https://win.rustup.rs/)
2. Follow the installer (default toolchain)
3. Restart the terminal  
4. Install [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) — **Desktop development with C++**

```bash
rustc --version
cargo --version
```

### Platform-specific dependencies

**macOS:**
```bash
xcode-select --install
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt update
sudo apt install -y \
  libwebkit2gtk-4.1-dev libssl-dev \
  libayatana-appindicator3-dev librsvg2-dev \
  patchelf pkg-config
```

---

## Getting started (from source)

```bash
git clone https://github.com/khalidinsan/badami.git
cd badami
npm install
npm run tauri dev
```

First `tauri dev` compiles Rust crates (**3–5 minutes**). Later runs are incremental.

---

## Building for production

```bash
# Optional: set signing key for updater artifacts
# export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/badami.key)"
# export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""

npm run tauri build
```

Bundles land in `src-tauri/target/release/bundle/`:

| Platform | Artifact |
|----------|----------|
| macOS | `.dmg`, `.app` (+ `.app.tar.gz` when updater artifacts are enabled) |
| Windows | NSIS `.exe`, `.msi` |
| Linux | `.deb`, `.AppImage`, `.rpm` |

### CI releases

Pushing a version tag runs [`.github/workflows/release.yml`](./.github/workflows/release.yml):

```bash
# Bump version in package.json, src-tauri/tauri.conf.json, and Cargo.toml (keep in sync)
git tag v1.14.1
git push origin v1.14.1
```

Required secret: `TAURI_SIGNING_PRIVATE_KEY` (and optional password).  
Matrix: **macOS aarch64**, **Ubuntu**, **Windows**.

---

## Project structure

```
badami/
├── src/                        # React frontend
│   ├── routes/                 # TanStack Router pages
│   ├── components/
│   │   ├── ui/                 # shadcn/ui
│   │   ├── local-dev/          # Local Dev UI
│   │   ├── server/             # SSH / SFTP / IDE
│   │   ├── updater/            # Check for updates UI
│   │   └── …
│   ├── stores/                 # Zustand
│   ├── db/                     # LibSQL + Kysely + migrations
│   ├── hooks/                  # useSshSession, useAppUpdater, …
│   └── types/
├── src-tauri/                  # Rust / Tauri backend
│   ├── src/commands/
│   │   ├── ssh.rs / sftp.rs    # Remote sessions + keepalive
│   │   ├── local_dev/          # Supervisor, sites, doctor, import
│   │   └── …
│   ├── resources/local-dev/    # Valet server + config templates
│   └── tauri.conf.json         # version, updater pubkey + endpoints
├── .github/workflows/release.yml
├── plan-local-dev.md
└── package.json
```

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Tauri v2 |
| Frontend | React 19 + TypeScript + Vite |
| Styling | Tailwind CSS v4 + shadcn/ui |
| Rich text | BlockNote |
| Routing | TanStack Router (file-based) |
| State | Zustand |
| Database | SQLite via libsql + Kysely |
| Icons | Lucide React |
| Terminal | xterm.js |
| SSH / SFTP | Rust `ssh2` |
| FTP | Rust `suppaftp` |
| Crypto | `aes-gcm` + `argon2` |
| HTTP | `reqwest` |
| DB Client | `sqlx` (MySQL / PostgreSQL) |
| Updates | `tauri-plugin-updater` + GitHub Releases |
| AI | OpenRouter API |

---

## Versioning

SemVer across **three files** (must stay in sync):

| File | Field |
|------|--------|
| `package.json` | `"version"` |
| `src-tauri/tauri.conf.json` | `"version"` |
| `src-tauri/Cargo.toml` | `version` |

About page reads the version via Tauri `getVersion()` — no manual UI edit.

---

## License

MIT
