# Tauri + React + Typescript

<p align="center">
  <img src="public/logo.png" alt="Badami" height="72" />
</p>

<h1 align="center">Badami</h1>

<p align="center">
  A focused productivity desktop app — projects, tasks, daily planning, and a floating sticky note.<br/>
  Built with <strong>Tauri v2</strong> · <strong>React 19</strong> · <strong>TypeScript</strong> · <strong>SQLite</strong>
</p>

---

## Features

- **Projects & Pages** — Rich BlockNote editor, project overview, and nested pages
- **Tasks** — Priorities, labels, due dates, subtasks, list & Kanban board views, drag-to-reorder
- **Daily Planning** — Drag tasks onto a calendar, free-form daily notes, progress bar
- **Today Window** — Floating compact window with Pomodoro timer
- **Server Management** — SSH terminal, SFTP/FTP file manager, PEM key manager
- **Credential Vault** — AES-256-GCM encrypted vault, TOTP, password generator
- **REST API Tool** — Request builder, collections, environments, Postman import
- **Quick Search** — ⌘K command palette
- **Sync** — Optional Turso LibSQL cloud sync

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

> **Windows extra requirement:** Install [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) — select **"Desktop development with C++"** during setup. Alternatively, install the full [Visual Studio Community](https://visualstudio.microsoft.com/vs/) with the C++ workload.

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
├── src/                   # React frontend
│   ├── routes/            # TanStack Router pages
│   ├── components/        # UI components
│   ├── stores/            # Zustand stores
│   ├── db/                # SQLite client + Kysely queries + migrations
│   ├── hooks/             # Custom React hooks
│   ├── lib/               # Utilities
│   └── types/             # TypeScript types
├── src-tauri/             # Rust / Tauri backend
│   ├── src/
│   │   ├── main.rs
│   │   ├── lib.rs
│   │   └── commands/      # Tauri commands (SSH, SFTP, crypto, …)
│   ├── Cargo.toml
│   └── tauri.conf.json
├── public/                # Static assets
├── index.html
├── vite.config.ts
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
| Database | SQLite via `tauri-plugin-sql` + Kysely |
| Animations | Framer Motion |
| Icons | Lucide React |
| SSH / SFTP | Rust `ssh2` crate |
| Crypto | Rust `aes-gcm` + `argon2` |

---

## Contributing

1. Fork the repo and create a feature branch
2. Run `npm run tauri dev` to start development
3. Check `CHECKLIST.md` for open tasks and planned features
4. Open a pull request

---

## License

MIT
