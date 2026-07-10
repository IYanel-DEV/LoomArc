PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ─── Networks (one BungeeCord proxy per network) ─────────────────────────────
CREATE TABLE IF NOT EXISTS networks (
  id          TEXT    PRIMARY KEY,
  name        TEXT    UNIQUE NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  bungee_port INTEGER NOT NULL,
  memory_mb   INTEGER NOT NULL DEFAULT 512,
  status      TEXT    NOT NULL DEFAULT 'stopped'
                      CHECK(status IN ('stopped', 'starting', 'running', 'crashed')),
  pid         INTEGER,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ─── Sub-servers (Spigot/Paper instances) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS servers (
  id          TEXT    PRIMARY KEY,
  network_id  TEXT    NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  type        TEXT    NOT NULL DEFAULT 'custom'
                      CHECK(type IN ('hub','survival','bedwars','skywars','custom')),
  port        INTEGER NOT NULL,
  memory_mb   INTEGER NOT NULL DEFAULT 1024,
  extra_flags TEXT    NOT NULL DEFAULT '',
  status      TEXT    NOT NULL DEFAULT 'stopped'
                      CHECK(status IN ('stopped', 'starting', 'running', 'crashed')),
  pid         INTEGER,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(network_id, name)
);

-- ─── Port allocation registry ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS port_allocations (
  port      INTEGER PRIMARY KEY,
  kind      TEXT    NOT NULL CHECK(kind IN ('bungee','server')),
  entity_id TEXT    NOT NULL
);

-- ─── Plugin tracking ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS plugins (
  id           TEXT    PRIMARY KEY,
  server_id    TEXT    NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  spiget_id    INTEGER,
  name         TEXT    NOT NULL,
  version      TEXT    NOT NULL DEFAULT 'unknown',
  file_name    TEXT    NOT NULL,
  installed_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ─── Cached JAR catalogue ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS jars (
  id            TEXT    PRIMARY KEY,
  kind          TEXT    NOT NULL CHECK(kind IN ('bungee','spigot')),
  mc_version    TEXT    NOT NULL,
  file_name     TEXT    NOT NULL,
  file_path     TEXT    NOT NULL,
  downloaded_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ─── Users ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id         TEXT    PRIMARY KEY,
  username   TEXT    UNIQUE NOT NULL,
  password   TEXT    NOT NULL,
  role       TEXT    NOT NULL DEFAULT 'viewer'
                     CHECK(role IN ('admin', 'viewer')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ─── Scheduled tasks ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id          TEXT    PRIMARY KEY,
  network_id  TEXT    REFERENCES networks(id) ON DELETE CASCADE,
  server_id   TEXT    REFERENCES servers(id) ON DELETE CASCADE,
  action      TEXT    NOT NULL CHECK(action IN ('restart', 'command')),
  command     TEXT    NOT NULL DEFAULT '',
  cron_expr   TEXT    NOT NULL,
  label       TEXT    NOT NULL DEFAULT '',
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ─── World backups ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS backups (
  id          TEXT    PRIMARY KEY,
  server_id   TEXT    NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  file_name   TEXT    NOT NULL,
  file_path   TEXT    NOT NULL,
  size_bytes  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ─── Server templates ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS templates (
  id          TEXT    PRIMARY KEY,
  name        TEXT    UNIQUE NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  server_type TEXT    NOT NULL DEFAULT 'custom'
              CHECK(server_type IN ('hub','survival','bedwars','skywars','custom')),
  memory_mb   INTEGER NOT NULL DEFAULT 1024,
  config_yml  TEXT    NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_servers_network   ON servers(network_id);
CREATE INDEX IF NOT EXISTS idx_plugins_server    ON plugins(server_id);
CREATE INDEX IF NOT EXISTS idx_tasks_network     ON scheduled_tasks(network_id);
CREATE INDEX IF NOT EXISTS idx_tasks_server      ON scheduled_tasks(server_id);
CREATE INDEX IF NOT EXISTS idx_backups_server    ON backups(server_id);
