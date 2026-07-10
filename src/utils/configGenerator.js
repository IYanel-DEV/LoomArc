'use strict';

/**
 * Generates BungeeCord config.yml and Spigot/Paper server.properties / yml files.
 */

const yaml = require('js-yaml');
const path = require('path');
const fsu  = require('./fileSystem');

// ─── BungeeCord config.yml ────────────────────────────────────────────────────

/**
 * @param {string}   bungeeDir   Absolute path to the BungeeCord working directory
 * @param {number}   proxyPort   The public port BungeeCord binds on
 * @param {Array}    servers     Array of { name, port } — the backend Spigot servers
 * @param {string}   [defaultServer='hub']
 */
async function generateBungeeConfig(bungeeDir, proxyPort, servers, defaultServer) {
  const serverMap = {};
  let firstHub = defaultServer;

  for (const srv of servers) {
    serverMap[srv.name] = {
      motd: `&b${srv.name}`,
      address: `127.0.0.1:${srv.port}`,
      restricted: false,
    };
    if (!firstHub && srv.type === 'hub') firstHub = srv.name;
  }
  if (!firstHub && servers.length > 0) firstHub = servers[0].name;

  const cfg = {
    server_connect_timeout: 5000,
    remote_ping_cache: -1,
    forge_support: false,
    player_limit: -1,
    permissions: {
      default: ['bungeecord.command.server', 'bungeecord.command.list'],
      admin: ['bungeecord.command.alert', 'bungeecord.command.end', 'bungeecord.command.ip', 'bungeecord.command.reload'],
    },
    listeners: [
      {
        host: `0.0.0.0:${proxyPort}`,
        query_port: proxyPort + 1,
        motd: '&aPowered by LoomArc',
        tab_list: 'GLOBAL_PING',
        query_enabled: false,
        proxy_protocol: false,
        forced_hosts: {},
        ping_passthrough: false,
        priorities: firstHub ? [firstHub] : [],
        bind_local_address: true,
        max_players: 500,
        tab_size: 60,
        force_default_server: false,
      },
    ],
    ip_forward: true,
    network_compression_threshold: 256,
    groups: { LoomArcAdmin: ['admin'] },
    servers: serverMap,
    timeout: 30000,
    log_pings: false,
    online_mode: true,
    disabled_commands: [],
  };

  await fsu.ensureDir(bungeeDir);
  await fsu.writeFile(path.join(bungeeDir, 'config.yml'), yaml.dump(cfg, { lineWidth: -1 }));
}

// ─── Spigot server.properties ─────────────────────────────────────────────────

const SERVER_TYPE_PRESETS = {
  hub: {
    gamemode:    'adventure',
    difficulty:  'peaceful',
    'spawn-monsters': 'false',
    'max-players': '100',
    motd: '\\u00A7aHub \\u00A77| LoomArc',
  },
  survival: {
    gamemode:   'survival',
    difficulty: 'normal',
    'spawn-monsters': 'true',
    'max-players': '50',
    motd: '\\u00A76Survival \\u00A77| LoomArc',
  },
  bedwars: {
    gamemode:   'survival',
    difficulty: 'easy',
    'spawn-monsters': 'false',
    'max-players': '64',
    motd: '\\u00A7cBedWars \\u00A77| LoomArc',
  },
  skywars: {
    gamemode:   'survival',
    difficulty: 'easy',
    'spawn-monsters': 'false',
    'max-players': '64',
    motd: '\\u00A7bSkyWars \\u00A77| LoomArc',
  },
  custom: {
    gamemode:   'survival',
    difficulty: 'normal',
    'spawn-monsters': 'true',
    'max-players': '20',
    motd: '\\u00A77LoomArc Server',
  },
};

async function generateServerProperties(serverDir, port, type = 'custom') {
  const preset = SERVER_TYPE_PRESETS[type] || SERVER_TYPE_PRESETS.custom;

  const props = {
    'server-port':             String(port),
    'server-ip':               '127.0.0.1',
    'online-mode':             'false',       // BungeeCord handles auth
    'enforce-secure-profile':  'false',
    'enable-rcon':             'false',
    'enable-query':            'false',
    'allow-flight':            'true',
    'view-distance':           '10',
    'simulation-distance':     '8',
    'level-name':              'world',
    'pvp':                     'true',
    'white-list':              'false',
    ...preset,
  };

  const lines = Object.entries(props).map(([k, v]) => `${k}=${v}`).join('\n');
  await fsu.writeFile(path.join(serverDir, 'server.properties'), lines + '\n');
}

/** spigot.yml — must have settings.bungeecord: true */
async function generateSpigotYml(serverDir) {
  const cfg = {
    settings: {
      bungeecord: true,
      'save-user-cache-on-stop-only': false,
      'log-villager-deaths': false,
      'log-named-deaths': true,
    },
    messages: { restart: 'Server is restarting' },
    world_settings: {},
    stats: { disable_saving: false, forced_stats: {} },
    players: { disable_saving: false },
    config_version: 12,
  };
  await fsu.writeFile(path.join(serverDir, 'spigot.yml'), yaml.dump(cfg, { lineWidth: -1 }));
}

/** paper-global.yml (PaperMC 1.19+) */
async function generatePaperConfig(serverDir) {
  const cfg = {
    '_version': 28,
    proxies: {
      'proxy-protocol': false,
      velocity: { enabled: false, 'online-mode': false, secret: '' },
      bungeecord: true,
    },
  };
  const cfgDir = path.join(serverDir, 'config');
  await fsu.ensureDir(cfgDir);
  await fsu.writeFile(path.join(cfgDir, 'paper-global.yml'), yaml.dump(cfg, { lineWidth: -1 }));
}

/** eula.txt — required for Spigot/Paper to start */
async function generateEula(serverDir) {
  await fsu.writeFile(
    path.join(serverDir, 'eula.txt'),
    '#By setting eula=true you agree to the Minecraft EULA\n#https://account.mojang.com/documents/minecraft_eula\neula=true\n'
  );
}

module.exports = {
  generateBungeeConfig,
  generateServerProperties,
  generateSpigotYml,
  generatePaperConfig,
  generateEula,
};
