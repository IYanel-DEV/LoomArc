#!/usr/bin/env node
/**
 * LoomArc setup script
 * Run with: node setup.js
 * Creates directory structure, copies .env, initialises the database.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const readline = require('readline');

const ROOT = __dirname;

// ─── Colour helpers ───────────────────────────────────────────────────────────
const c = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  cyan:   '\x1b[36m',
  purple: '\x1b[35m',
};
const ok   = (msg) => console.log(`  ${c.green}✓${c.reset} ${msg}`);
const warn = (msg) => console.log(`  ${c.yellow}⚠${c.reset} ${msg}`);
const err  = (msg) => console.log(`  ${c.red}✗${c.reset} ${msg}`);
const info = (msg) => console.log(`  ${c.cyan}→${c.reset} ${msg}`);

// ─── ASCII banner ─────────────────────────────────────────────────────────────
function banner() {
  console.log(`
${c.purple}${c.bold}  ██╗      ██████╗  ██████╗ ███╗   ███╗ █████╗ ██████╗  ██████╗
  ██║     ██╔═══██╗██╔═══██╗████╗ ████║██╔══██╗██╔══██╗██╔════╝
  ██║     ██║   ██║██║   ██║██╔████╔██║███████║██████╔╝██║
  ██║     ██║   ██║██║   ██║██║╚██╔╝██║██╔══██║██╔══██╗██║
  ███████╗╚██████╔╝╚██████╔╝██║ ╚═╝ ██║██║  ██║██║  ██║╚██████╗
  ╚══════╝ ╚═════╝  ╚═════╝ ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝${c.reset}
  ${c.cyan}Minecraft Network Management Panel — Setup${c.reset}
  ${'─'.repeat(55)}
`);
}

// ─── Node version check ───────────────────────────────────────────────────────
function checkNode() {
  console.log(`\n${c.bold}[1/5] Checking Node.js version${c.reset}`);
  const [major] = process.versions.node.split('.').map(Number);
  if (major < 18) {
    err(`Node.js 18+ is required (found ${process.version})`);
    process.exit(1);
  }
  ok(`Node.js ${process.version}`);
}

// ─── Java detection ───────────────────────────────────────────────────────────
function detectJava() {
  console.log(`\n${c.bold}[2/5] Detecting Java installations${c.reset}`);

  const candidates = [];

  // Check JAVA_HOME
  if (process.env.JAVA_HOME) {
    const bin = path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
    if (fs.existsSync(bin)) candidates.push(bin);
  }

  // Check PATH
  const which = process.platform === 'win32' ? 'where' : 'which';
  try {
    const out = execSync(`${which} java`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    out.split('\n').forEach(p => { if (p.trim()) candidates.push(p.trim()); });
  } catch {}

  // Common Windows install locations
  if (process.platform === 'win32') {
    const bases = [
      'C:\\Program Files\\Java',
      'C:\\Program Files\\Eclipse Adoptium',
      'C:\\Program Files\\Microsoft',
    ];
    for (const base of bases) {
      if (!fs.existsSync(base)) continue;
      for (const sub of fs.readdirSync(base)) {
        const bin = path.join(base, sub, 'bin', 'java.exe');
        if (fs.existsSync(bin)) candidates.push(bin);
      }
    }
  }

  // De-duplicate and get versions
  const seen = new Set();
  const found = [];
  for (const bin of candidates) {
    if (seen.has(bin)) continue;
    seen.add(bin);
    try {
      const result = spawnSync(bin, ['-version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      const versionLine = (result.stderr || result.stdout || '').split('\n')[0];
      found.push({ bin, version: versionLine });
    } catch {}
  }

  if (found.length === 0) {
    warn('No Java installation found. Install Java 17+ before starting servers.');
    warn('Download: https://adoptium.net/temurin/releases/?version=17');
    return null;
  }

  found.forEach(j => ok(`${j.bin}\n        ${c.yellow}${j.version}${c.reset}`));

  if (found.length > 1) {
    info(`Multiple Java versions found. Set JAVA_PATH in .env to pin one.`);
  }

  return found[0].bin;
}

// ─── Directory scaffolding ────────────────────────────────────────────────────
function createDirectories() {
  console.log(`\n${c.bold}[3/5] Creating directory structure${c.reset}`);

  const dirs = [
    'src/config',
    'src/database',
    'src/managers',
    'src/routes',
    'src/utils',
    'public/css',
    'public/js/pages',
    'public/js/components',
    'data/servers',
    'data/jars',
    'data/backups',
    'data/tmp',
    'logs',
  ];

  for (const dir of dirs) {
    const full = path.join(ROOT, dir);
    fs.mkdirSync(full, { recursive: true });
    ok(dir);
  }
}

// ─── .env setup ───────────────────────────────────────────────────────────────
function setupEnv(detectedJava) {
  console.log(`\n${c.bold}[4/5] Environment configuration${c.reset}`);

  const envPath    = path.join(ROOT, '.env');
  const examplePath = path.join(ROOT, '.env.example');

  if (fs.existsSync(envPath)) {
    ok('.env already exists — skipping');
    return;
  }

  let content = fs.readFileSync(examplePath, 'utf8');

  // Inject detected Java path
  if (detectedJava) {
    // Escape backslashes on Windows
    const escaped = detectedJava.replace(/\\/g, '\\\\');
    content = content.replace(/^JAVA_PATH=.*$/m, `JAVA_PATH=${escaped}`);
  }

  // Generate a random API secret
  const secret = require('crypto').randomBytes(32).toString('hex');
  content = content.replace(/^API_SECRET=.*$/m, `API_SECRET=${secret}`);

  fs.writeFileSync(envPath, content, 'utf8');
  ok('.env created from .env.example');
  ok('Random API_SECRET generated');
}

// ─── Database initialisation ──────────────────────────────────────────────────
function initDatabase() {
  console.log(`\n${c.bold}[5/5] Initialising database + default admin user${c.reset}`);

  // Load env so the DB module can find DATA_DIR
  require('dotenv').config({ path: path.join(ROOT, '.env') });

  try {
    const db = require('./src/database/index');
    ok('SQLite database initialised');

    // Create default admin if no users exist yet
    const existing = db.prepare('SELECT 1 FROM users LIMIT 1').get();
    if (!existing) {
      const username = process.env.ADMIN_USER     || 'admin';
      const password = process.env.ADMIN_PASSWORD || 'changeme123';

      const bcrypt = require('bcryptjs');
      const { v4: uuid } = require('uuid');
      const hash = bcrypt.hashSync(password, 12);
      db.prepare('INSERT INTO users (id, username, password, role) VALUES (?, ?, ?, ?)')
        .run(uuid(), username, hash, 'admin');

      ok(`Default admin user created: ${c.cyan}${username}${c.reset} / ${c.yellow}${password}${c.reset}`);
      info(`Change the password after first login, or set ADMIN_PASSWORD in .env before running setup again.`);
    } else {
      ok('Admin user already exists — skipping');
    }

    db.close();
  } catch (e) {
    err(`Database init failed: ${e.message}`);
    warn('This may be because dependencies are not installed yet.');
    warn('Run "npm install" then re-run "node setup.js"');
    return false;
  }
  return true;
}

// ─── Final instructions ───────────────────────────────────────────────────────
function printNextSteps() {
  console.log(`
${c.bold}${c.green}Setup complete!${c.reset}

${c.bold}Next steps:${c.reset}

  1. ${c.cyan}npm install${c.reset}
       Install all Node.js dependencies.

  2. Place JAR files in ${c.yellow}data/jars/${c.reset}
       • BungeeCord.jar  (from https://ci.md-5.net/job/BungeeCord/)
       • spigot-*.jar    (from https://getbukkit.org/download/spigot)
                          or use the in-panel JAR downloader after first boot.

  3. ${c.cyan}npm start${c.reset}
       Start the panel (default port 3000).

  4. Open ${c.cyan}http://localhost:3000${c.reset} in your browser.

${c.yellow}Note:${c.reset} Log in with the admin credentials shown above.
Change your password at ${c.cyan}Settings → Users${c.reset} after first login.

${'─'.repeat(55)}
`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  banner();
  checkNode();
  const javaPath = detectJava();
  createDirectories();
  setupEnv(javaPath);
  initDatabase();
  printNextSteps();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
