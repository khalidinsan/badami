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
  <a href="https://github.com/khalidinsan/badami/releases/tag/v1.15.0"><code>v1.15.0</code></a>
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
xattr -cr ~/Downloads/badami_1.15.0_aarch64.dmg
open ~/Downloads/badami_1.15.0_aarch64.dmg

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
- **Local Dev** *(macOS)* — self-contained local stack: `*.test` sites, multi-version PHP-FPM, nginx (Mode A `:8080`), MariaDB, Redis, all with Badami-owned binaries
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

**Local Dev** runs a local PHP stack from binaries Badami owns: services live under `runtime/<role>/<version>/` and the MariaDB data under `data/mariadb`. Nothing depends on another local dev tool being installed.

| Capability | Default |
| --- | --- |
| HTTP | **Mode A** — unprivileged nginx on **`127.0.0.1:8080`** (`http://{site}.test:8080`) |
| HTTPS *(opt-in per site)* | Unprivileged nginx on **`127.0.0.1:8443`** (`https://{site}.test:8443`) — per-user CA + per-site leaf cert; Trust CA helper previews the exact `security add-trusted-cert` argv before the admin prompt |
| Sites | Valet-style parks/links, PHP isolation, Secure / Unsecure per site, open in browser |
| Runtime | nginx / PHP / MariaDB / Redis / dnsmasq under `runtime/`, recorded in a SHA-256 manifest; a binary whose hash no longer matches reads as absent |
| MariaDB data | Lives in `data/mariadb`. Moving it in uses an APFS clone (copy-on-write, no extra disk, source untouched) |
| Binary updates | Upstream install for PHP 8.x (static-php-cli) and dnsmasq (Homebrew bottle), checksum-verified before extraction |
| Redis / PHP-FPM | Supervised with nginx as part of **Start stack** |
| DNS `*.test` | Adopt existing `:53`, optional B-lite dnsmasq LaunchDaemon, or degraded mode |
| Uninstall | `ld_bootstrap_uninstall` reverses only Badami-written LaunchDaemon units + staged plist; resolver file removal opt-in, gated on `# managed-by: badami` marker |

Design notes: [`plan-local-dev.md`](./plan-local-dev.md).

### Safety notes

- **Never deletes the MariaDB datadir** as part of normal ops. Moving data uses an APFS clone, so the source keeps its blocks and is left byte-identical, verified by hashing `ibdata1` before and after.
- **A provisioned binary is only advertised once its recorded SHA-256 matches the file on disk**, so a half-copied or tampered component reads as absent rather than as installed.
- **MariaDB is the one binary that needs relocation** (its dylibs are referenced by absolute path). The copy rewrites those references to `@loader_path` and re-signs ad hoc, and the install is refused if any reference outside the runtime survives.
- **Mode A (`:8080` / `:8443`)** is the default so nginx needs no root. Port `:80` is optional after explicit bootstrap.
- **Root-owned LaunchDaemon staging** — Badami renders a **root variant** of every nginx/dnsmasq config (rewriting `include`, `error_log`, `pid`, `log-facility`, and `ssl_certificate*` paths so they point under `/Library/Application Support/Badami/local-dev-root/<role>/`), tokenizes the config (quote- and comment-aware, multi-line + inline `;`-chain safe), and rejects outright-dangerous directives (`load_module`, `env`, `ssl_engine`, `perl*`, `js_*`, `lua*`, `*_by_lua*`, `njs*`, `user root`; dnsmasq `dhcp-script`, `conf-*`, `*hostsfile`, `tftp-*`, `user=root`, backslash line-continuation, and anything outside the dnsmasq allowlist) before any admin prompt. The privileged shell first **reclaims the ancestor chain** (`/Library/Application Support/Badami` + `.../local-dev-root`) to `root:wheel 755`, rejecting any pre-planted symlink or non-dir with `exit 1`, so an admin-group user process cannot swap staged dirs between hash verify and `launchctl`. It then `install -o root -g wheel` the pending files into place and **verifies each root-owned copy's SHA-256 against the Rust-computed digest with `/usr/bin/shasum`** before `launchctl bootstrap` runs; every pending digest is bound to the source bytes Rust read in-process, so overwriting the pending file after staging still fails the privileged shasum check. Mismatch → rollback of plist + staging dir + `exit 1`. Labels must match `^[A-Za-z0-9][A-Za-z0-9.-]{0,127}$` and start with the Tauri bundle identifier (`com.khalid.badami.local-dev.*`).
- **Resolver install writes in-process content** — `/etc/resolver/<tld>` is populated via `printf '%s' <content> > <tmp> && mv -f <tmp> /etc/resolver/<tld>` where `<content>` is composed in Rust (not read from a user-writable draft at exec time), so a user process cannot race between the osascript admin prompt and the kernel exec to swap in a different resolver file.
- **Trust CA via root-owned copy** — the CA cert is `install -o root -g wheel -m 0644`'d into `/Library/Application Support/Badami/local-dev-root/tls/BadamiLocalDevCA.crt` and shasum-verified against a Rust-computed SHA-256 inside the same privileged sequence; `security add-trusted-cert` only runs against the hash-verified root-owned copy. Trust **removal** is manual — run `security remove-trusted-cert …` or use Keychain Access.
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
git tag v1.15.0
git push origin v1.15.0
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
