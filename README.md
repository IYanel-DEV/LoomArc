<div align="center">

```
  ██╗      ██████╗  ██████╗ ███╗   ███╗ █████╗ ██████╗  ██████╗
  ██║     ██╔═══██╗██╔═══██╗████╗ ████║██╔══██╗██╔══██╗██╔════╝
  ██║     ██║   ██║██║   ██║██╔████╔██║███████║██████╔╝██║
  ██║     ██║   ██║██║   ██║██║╚██╔╝██║██╔══██║██╔══██╗██║
  ███████╗╚██████╔╝╚██████╔╝██║ ╚═╝ ██║██║  ██║██║  ██║╚██████╗
  ╚══════╝ ╚═════╝  ╚═════╝ ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝
```

**Self-hosted Minecraft network panel — BungeeCord + Spigot/Paper, no Docker required.**

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?style=flat-square&logo=node.js)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)
[![Platform: Windows](https://img.shields.io/badge/Platform-Windows-0078d4?style=flat-square&logo=windows)](https://www.microsoft.com/windows)

</div>

---

## Overview

LoomArc is a lightweight, self-hosted control panel for managing Minecraft networks on a single Windows machine. It provisions BungeeCord proxy instances and Spigot/Paper backend servers, streams their console output in real time, and exposes a full file manager — all through a clean, dark-themed web UI.

It runs as a plain Node.js process and spawns Java directly via `child_process.spawn`. There is no Docker, no virtual machines, and no cloud dependency. Everything lives in a single `data/` directory next to the panel.

---

## Features

### Network & Server Lifecycle

- **One-click network creation** — LoomArc automatically downloads BungeeCord (with Waterfall fallback) and a Paper build, scaffolds the directory tree, and writes a ready-to-run `config.yml`
- **PaperMC version picker** — choose any Minecraft version and specific build number at network creation time via the Purpur API
- **Sub-server types** — Hub, Survival, BedWars, SkyWars, or Custom; each gets a dedicated port, pre-generated `server.properties`, `spigot.yml`, `paper-global.yml`, and `eula.txt`
- **Start / Stop / Restart** — one-click lifecycle controls with live status badges; BungeeCord and all its sub-servers are managed independently
- **Port allocator** — automatically assigns non-conflicting ports from configurable ranges; allocations survive restarts
- **Server templates** — save any server configuration as a reusable template; create new servers from a template with one click

### Multi-user Authentication

- **JWT-based login** — every user authenticates with a username and password; sessions are signed JWTs with a 24-hour expiry
- **Role separation** — `admin` role can create, edit, and delete resources; `viewer` role has read-only access to all pages
- **First-run setup** — if no users exist, the panel shows a setup wizard to create the initial admin account
- **User management** — admins can add, delete, and change the role of any user from the sidebar
- **Bcrypt password hashing** — passwords are stored with bcrypt (12 salt rounds); plain-text credentials never touch the database

### Task Scheduler

- **Cron-style schedules** — define any cron expression (`0 6 * * *`, `*/30 * * * *`, etc.) to trigger automated actions
- **Restart or send command** — schedule a server or network restart, or fire an arbitrary console command on a timer
- **Per-network scheduler tab** — each network has a dedicated Scheduler tab listing all tasks with toggle/delete controls
- **Enable / disable** — pause a scheduled task without deleting it; re-enable with one click

### World Backups

- **One-click ZIP** — compresses a server's `world/`, `world_nether/`, and `world_the_end/` directories into a timestamped `.zip` file stored in `data/backups/`
- **Backup list** — each server shows a list of all its backups with creation time and file size
- **Browser download** — click Download to stream the ZIP directly to your browser; no separate tool required
- **Delete** — remove old backups from the UI to free disk space

### Real-time Console

- **Live WebSocket streaming** — every stdout/stderr line is pushed to the browser as it appears; no polling
- **Command input** — send any server command directly from the console panel
- **Per-process history buffer** — configurable line buffer (default 500) so late-connecting clients receive recent output immediately
- **Multi-console support** — open a sub-server console in a modal while the BungeeCord console remains open in the background tab

### Pterodactyl-style File Manager

- **Full directory tree navigation** — breadcrumb path bar, click to descend into any folder
- **Create, delete, rename** — files and directories at any depth
- **Inline text editor** — edit any text-based config file (`.yml`, `.properties`, `.json`, `.conf`, `.log`, `.sh`, etc.) directly in the browser with a monospace editor
- **Path traversal prevention** — every operation is validated server-side against the server's root directory

### Plugin Browser

- **Spiget / SpigotMC integration** — search the full SpigotMC plugin catalogue in real time
- **Plugin icons** — official plugin artwork fetched directly from the Spiget CDN
- **One-click install** — downloads the JAR and places it in the target server's `plugins/` folder; supports version selection
- **Sort controls** — Most Downloaded, Top Rated, Recently Updated, or Name A→Z

### JAR Manager

- **Global JAR cache** — upload BungeeCord or Spigot/Paper JARs once, reuse them across any network or server
- **Link to server / network** — copy a cached JAR into any server or proxy directory without re-uploading
- **Auto-download on provision** — new networks automatically download missing JARs at creation time

### System Dashboard

- **Host metrics** — CPU usage (%), total / used RAM, and data-directory disk utilisation with colour-coded progress bars
- **Active process snapshot** — all running Java instances with PID and start time
- **Java install detector** — scans `JAVA_HOME`, `PATH`, and common Windows install directories; lists every detected version
- **Orphan PID cleanup** — on startup, LoomArc reads PIDs stored in the database from the previous session and kills any stale Java processes before accepting connections; on shutdown it repeats this for all tracked PIDs

---

## Requirements

| Requirement | Minimum | Notes |
|---|---|---|
| **Node.js** | 18.0.0 | 18.15+ recommended for disk stats |
| **Java** | 17 | Required to run Minecraft servers; 21 recommended |
| **OS** | Windows 10 / Server 2019 | Linux is partially supported; macOS is untested |
| **RAM** | 2 GB free | Each server instance needs its own allocation (default 1 GB) |
| **Disk** | 500 MB + per server | JARs, world data, plugin files, and backups |

---

## Installation

### 1 — Clone the repository

```bat
git clone https://github.com/IYanel-DEV/LoomArc.git
cd LoomArc
```

### 2 — Install dependencies

```bat
npm install
```

> `better-sqlite3` includes a native addon. If it fails to build, install the [Visual C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) and re-run `npm install`.

### 3 — Run the setup wizard

```bat
node setup.js
```

The wizard:

- Checks your Node.js version
- Detects Java installations on the system
- Creates the `data/`, `data/jars/`, `data/backups/`, and `logs/` directories
- Copies `.env.example` → `.env` with a randomly generated `API_SECRET`
- Initialises the SQLite database and creates the default admin user

### 4 — Start the panel

**Double-click** `start.bat` — or from a terminal:

```bat
npm start
```

Open **http://localhost:3000** in your browser and log in with the credentials printed by `setup.js` (default: `admin` / `changeme123`).

> Change your password immediately after first login via **Users** in the sidebar.

---

## Java Configuration

LoomArc spawns Java processes directly. No Docker or WSL required.

### Auto-detection

The setup wizard probes:

1. `JAVA_HOME\bin\java.exe`
2. `java` via `where` (system `PATH`)
3. Common Windows install paths:
   - `C:\Program Files\Java\*\bin\java.exe`
   - `C:\Program Files\Eclipse Adoptium\*\bin\java.exe`
   - `C:\Program Files\Microsoft\*\bin\java.exe`

The first valid installation is written to `JAVA_PATH` in your `.env`.

### Pinning a specific version

Edit `.env` and set `JAVA_PATH` to an absolute path:

```ini
JAVA_PATH=C:\Program Files\Eclipse Adoptium\jdk-21.0.3.9-hotspot\bin\java.exe
```

### Recommended Java distribution

[Eclipse Temurin 21 LTS](https://adoptium.net/temurin/releases/?version=21) is the recommended distribution. Minecraft 1.21+ requires Java 21; versions below 1.17 require Java 8 or 11.

---

## Configuration Reference

All settings are read from `.env` at startup. After editing, restart the panel for changes to take effect.

```ini
# ── Panel web server ──────────────────────────────────────────────────────────
PANEL_PORT=3000           # Port the web UI listens on
PANEL_HOST=0.0.0.0        # Bind address; use 127.0.0.1 to restrict to localhost

# ── Security ──────────────────────────────────────────────────────────────────
API_SECRET=<random>       # Auto-generated by setup; used as JWT signing fallback
JWT_SECRET=<random>       # Primary JWT signing secret — set this to a long random string

# ── Default admin user (used by setup.js on first run only) ───────────────────
ADMIN_USER=admin
ADMIN_PASSWORD=changeme123

# ── Storage ───────────────────────────────────────────────────────────────────
DATA_DIR=                 # Absolute path for server data; defaults to ./data
JAVA_PATH=                # Absolute path to java.exe; blank = auto-detect

# ── Port ranges ───────────────────────────────────────────────────────────────
BUNGEE_PORT_START=25565   # BungeeCord proxy ports (one per network)
BUNGEE_PORT_END=25665
SERVER_PORT_START=25701   # Spigot/Paper backend ports (one per sub-server)
SERVER_PORT_END=26200

# ── Process behaviour ─────────────────────────────────────────────────────────
CONSOLE_BUFFER_LINES=500     # Lines kept in memory per process for late WS connects
GRACEFUL_STOP_TIMEOUT=30000  # ms to wait for clean shutdown before force-kill
```

---

## Project Structure

```
LoomArc/
├── src/
│   ├── config/
│   │   └── index.js              # Centralised env-var config with typed defaults
│   ├── database/
│   │   ├── index.js              # better-sqlite3 singleton + idempotent migrations
│   │   └── schema.sql            # Tables: networks, servers, users, plugins, jars,
│   │                             #         scheduled_tasks, backups, templates
│   ├── managers/
│   │   ├── AuthManager.js        # User CRUD, bcrypt hashing, JWT sign/verify
│   │   ├── BackupManager.js      # World ZIP backup creation, list, delete
│   │   ├── JarDownloader.js      # BungeeCord / Paper / Purpur API download logic
│   │   ├── NetworkManager.js     # Network CRUD, BungeeCord start/stop/restart
│   │   ├── PluginManager.js      # Spiget download + plugin install/uninstall
│   │   ├── PortAllocator.js      # Port range management with DB persistence
│   │   ├── ProcessManager.js     # child_process.spawn wrapper, PID tracking, console buffer
│   │   ├── Provisioner.js        # JAR download orchestrator, SSE progress events
│   │   ├── SchedulerManager.js   # node-cron task scheduling (restart / command)
│   │   ├── ServerManager.js      # Server CRUD, Spigot start/stop/restart
│   │   └── TemplateManager.js    # Server template save, clone, and deploy
│   ├── routes/
│   │   ├── auth.js               # /api/auth — login, setup, user management
│   │   ├── backups.js            # /api/servers/:id/backups — create, list, download, delete
│   │   ├── networks.js           # /api/networks — proxy lifecycle + file manager
│   │   ├── plugins.js            # /api/plugins  — Spiget search + resource proxy
│   │   ├── scheduler.js          # /api/scheduler/tasks — CRUD + toggle
│   │   ├── servers.js            # /api/servers  — server lifecycle + file manager
│   │   ├── system.js             # /api/system   — metrics, Java detection, JAR cache, Paper versions
│   │   └── templates.js          # /api/templates — CRUD + deploy
│   ├── utils/
│   │   ├── configGenerator.js    # Generates server.properties, config.yml, etc.
│   │   ├── fileEditor.js         # Path-traversal guard, directory listing
│   │   ├── fileSystem.js         # fs.promises wrapper helpers
│   │   ├── javaDetector.js       # Multi-path Java version detection
│   │   └── logger.js             # Winston logger
│   └── server.js                 # Express app, JWT auth middleware, WebSocket server
│
├── public/
│   ├── css/
│   │   └── main.css              # Dark-theme design tokens, component styles
│   ├── js/
│   │   ├── api.js                # JWT Bearer API client + all endpoint namespaces
│   │   ├── ws.js                 # Shared WebSocket singleton
│   │   ├── app.js                # SPA boot, JWT auth flow, user menu, routing
│   │   ├── components/
│   │   │   ├── console.js        # Real-time console component (WS subscriber)
│   │   │   ├── modal.js          # Modal, prompt, and confirm dialogs
│   │   │   ├── telemetry.js      # SSE-driven live CPU/RAM charts + player list
│   │   │   └── toast.js          # Toast notification system
│   │   └── pages/
│   │       ├── dashboard.js      # Networks overview + create-network modal with version picker
│   │       ├── login.js          # Login page and first-run setup wizard
│   │       ├── network.js        # Network detail, scheduler tab, backup modal, template save
│   │       ├── plugins.js        # Plugin browser + install modal
│   │       └── system.js         # System metrics + JAR cache management
│   └── index.html                # SPA shell
│
├── data/                         # Runtime data (gitignored)
│   ├── backups/                  # World backup ZIP files (per server)
│   ├── jars/                     # Cached JAR files
│   ├── servers/                  # Per-network and per-server working directories
│   ├── tmp/                      # Temporary files during backup compression
│   └── loomarc.sqlite            # SQLite database
│
├── .env                          # Local configuration (gitignored)
├── .env.example                  # Configuration template
├── setup.js                      # Setup wizard + default admin user creation
├── start.bat                     # Windows one-click launcher
└── package.json
```

---

## Architecture Notes

### Authentication

All API routes except `POST /api/auth/login`, `POST /api/auth/setup`, and `GET /api/session` require a valid JWT in the `Authorization: Bearer <token>` header. EventSource (SSE) and WebSocket connections pass the token as a `?token=` query parameter since browsers cannot set custom headers on those connection types.

JWTs are signed with `JWT_SECRET` (falling back to `API_SECRET`) and expire after 24 hours. When a token expires, the frontend automatically redirects to the login page and clears the stored token from `localStorage`.

### Role enforcement

The `adminOnly` middleware is applied per-route to any endpoint that mutates state (POST/PATCH/PUT/DELETE for networks, servers, users, tasks, backups, templates). `viewer`-role tokens can call any GET endpoint but receive `403 Forbidden` on mutating routes.

### Process management

Each BungeeCord proxy and Spigot/Paper server is a separate OS process spawned via `child_process.spawn`. LoomArc does **not** use Docker, virtual machines, or any sandboxing layer.

On Windows, stopping a server uses `taskkill /PID <n> /T /F` to kill the full process tree (including any JVM child processes). This is necessary because `process.kill()` in Node.js does not kill child processes on Windows.

PIDs are persisted to the SQLite database. When the panel restarts after a crash, it reads all non-null PIDs from the database and kills them before accepting connections — preventing orphan Java processes from accumulating in Task Manager.

### WebSocket console streaming

The panel maintains a single WebSocket server (`/ws`). Clients send `{ type: 'subscribe', processId: '...' }` messages to receive output for a specific process. When a client subscribes, the server immediately sends the buffered history (last N lines) followed by live output as it arrives.

### Auto-provisioning

When a new network is created, the provisioner runs asynchronously:

1. Downloads BungeeCord from `ci.md-5.net`; falls back to Waterfall (Paper's BungeeCord fork) if that fails
2. Downloads the requested Paper build from the Purpur API (Paper-compatible); defaults to latest stable if no version is specified
3. Copies JARs into the network directory
4. Emits progress events that the frontend consumes via Server-Sent Events

### Task scheduler

Scheduled tasks are stored in the `scheduled_tasks` table and loaded at startup by `SchedulerManager`. Each task uses `node-cron` internally. When the panel restarts, all enabled tasks are re-registered. Tasks can target a specific server (send command / restart) or an entire network (restart BungeeCord).

### World backups

`BackupManager` uses the `archiver` library to stream a server's world directories into a ZIP file under `data/backups/<serverId>/`. The download endpoint pipes the file directly to the response — no temporary copy is needed. The `?token=` query parameter on the download URL allows the browser to initiate the download natively.

---

## API

All endpoints (except login and setup) require `Authorization: Bearer <token>` with a valid JWT.

### Auth

| Endpoint | Auth | Description |
|---|---|---|
| `POST /api/auth/login` | None | Authenticate and receive a JWT |
| `POST /api/auth/setup` | None | Create the first admin account (fails if users already exist) |
| `GET /api/auth/me` | Any | Returns the current user's id, username, and role |
| `GET /api/auth/users` | Admin | List all users |
| `POST /api/auth/users` | Admin | Create a user |
| `PATCH /api/auth/users/:id` | Admin | Update role or password |
| `DELETE /api/auth/users/:id` | Admin | Delete a user |

### Networks

| Endpoint | Auth | Description |
|---|---|---|
| `GET /api/networks` | Any | List all networks with live status and server list |
| `POST /api/networks` | Admin | Create a new network (triggers auto-provisioning) |
| `GET /api/networks/:id/provision` | Any | SSE stream of provisioning progress |
| `POST /api/networks/:id/start` | Admin | Start BungeeCord |
| `POST /api/networks/:id/stop` | Admin | Stop BungeeCord |
| `POST /api/networks/:id/restart` | Admin | Restart BungeeCord |
| `GET /api/networks/:id/fs?path=` | Any | List directory in BungeeCord working dir |
| `GET /api/networks/:id/fs/read?path=` | Any | Read a text file |
| `PUT /api/networks/:id/fs` | Admin | Write or create a file |
| `POST /api/networks/:id/fs/mkdir` | Admin | Create a directory |
| `DELETE /api/networks/:id/fs?path=` | Admin | Delete a file or directory |
| `POST /api/networks/:id/fs/rename` | Admin | Rename or move a file |

### Servers

| Endpoint | Auth | Description |
|---|---|---|
| `POST /api/servers` | Admin | Create a sub-server |
| `POST /api/servers/:id/start` | Admin | Start a server |
| `POST /api/servers/:id/stop` | Admin | Stop a server |
| `POST /api/servers/:id/restart` | Admin | Restart a server |
| `GET /api/servers/:id/fs?path=` | Any | List directory (same routes as above, server scope) |
| `POST /api/servers/:id/plugins/install-spiget` | Admin | Install a plugin from Spiget |
| `GET /api/servers/:id/backups` | Any | List world backups |
| `POST /api/servers/:id/backups` | Admin | Create a new world backup |
| `GET /api/servers/:id/backups/:bid/download` | Any* | Download a backup ZIP |
| `DELETE /api/servers/:id/backups/:bid` | Admin | Delete a backup |

*Download auth via `?token=` query parameter.

### Scheduler

| Endpoint | Auth | Description |
|---|---|---|
| `GET /api/scheduler/tasks` | Any | List tasks (filter by `network_id` or `server_id`) |
| `POST /api/scheduler/tasks` | Admin | Create a scheduled task |
| `PATCH /api/scheduler/tasks/:id` | Admin | Update a task |
| `POST /api/scheduler/tasks/:id/toggle` | Admin | Enable / disable a task |
| `DELETE /api/scheduler/tasks/:id` | Admin | Delete a task |

### Templates

| Endpoint | Auth | Description |
|---|---|---|
| `GET /api/templates` | Any | List all templates |
| `GET /api/templates/:id` | Any | Get a single template |
| `POST /api/templates` | Admin | Create a template (from scratch or from an existing server) |
| `DELETE /api/templates/:id` | Admin | Delete a template |
| `POST /api/templates/:id/deploy` | Admin | Create a server from a template |

### System

| Endpoint | Auth | Description |
|---|---|---|
| `GET /api/system/metrics` | Any | Host CPU, RAM, and disk stats |
| `GET /api/system/status` | Any | Panel uptime and active process snapshot |
| `GET /api/system/java` | Any | Detected Java installations |
| `GET /api/system/paper/versions` | Any | Available Minecraft versions from the Purpur API |
| `GET /api/system/paper/versions/:version/builds` | Any | Available Paper builds for a given version |

---

## Roadmap

### Near-term

- [x] **Dark/light theme toggle** — persist preference to `localStorage`
- [x] **Server RAM editor** — change `memory_mb` without deleting and recreating the server
- [x] **BungeeCord memory config** — expose `memory_mb` per network, currently fixed at 512 MB
- [x] **Console search** — filter console output by keyword in real time
- [x] **Plugin management** — list installed plugins, enable/disable (rename `.jar` ↔ `.jar.disabled`)

### Medium-term

- [x] **Multi-user auth** — JWT-based accounts with role separation (admin / viewer)
- [x] **Scheduled tasks** — cron-style restart schedules and timed commands per server or network
- [x] **World backup** — zip a server's world directories and offer a browser download
- [x] **Server templates** — save a server configuration as a reusable template for new instances
- [x] **Paper build selector** — choose a specific Minecraft version and Paper build at network creation

### Long-term

- [ ] **Linux support** — replace `taskkill` with `SIGTERM`/`SIGKILL` and test cross-platform
- [ ] **Remote panel** — optional HTTPS + domain support with Let's Encrypt auto-cert
- [ ] **Metrics history** — store CPU/RAM samples in SQLite and render a time-series chart
- [ ] **Resource pack server** — serve a resource pack via HTTP directly from the panel

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit your changes with a clear message
4. Open a pull request against `main`

Please keep pull requests focused — one feature or fix per PR. For larger changes, open an issue first to discuss the approach.

---

## License

MIT — see [LICENSE](LICENSE) for the full text.

---

<div align="center">

Built for Minecraft server owners who want full control without the complexity.

</div>
