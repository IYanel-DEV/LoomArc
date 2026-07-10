'use strict';

/**
 * Provisioner — orchestrates the full lifecycle when a new network is created:
 *
 *   Step 1 · Proxy JAR (BungeeCord or Waterfall)
 *     – Check jar cache; download if absent
 *     – Try BungeeCord (ci.md-5.net) first; fall back to Waterfall (Paper API)
 *       Waterfall is a BungeeCord fork with identical config.yml format — our
 *       configGenerator works with both without any changes.
 *
 *   Step 2 · Paper backend JAR
 *     – Check jar cache; download latest build from Paper API if absent
 *
 *   Step 3 · Provision network directory
 *     – Copy proxy JAR → data/servers/<networkId>/bungee/
 *
 * Progress is emitted as 'progress' events so the SSE endpoint can stream live
 * updates to the browser.  State is kept after completion so late SSE connects
 * get the final snapshot immediately.
 */

const fs           = require('fs');
const path         = require('path');
const EventEmitter = require('events');
const { v4: uuid } = require('uuid');

const config     = require('../config');
const db         = require('../database');
const fsu        = require('../utils/fileSystem');
const logger     = require('../utils/logger');
const downloader = require('./JarDownloader');

class Provisioner extends EventEmitter {
  constructor() {
    super();
    // networkId → state  (retained after completion for late SSE connects)
    this._states = new Map();
  }

  /**
   * Start provisioning for a freshly created network.
   * Non-blocking — returns the initial state object immediately.
   */
  provision(networkId) {
    const existing = this._states.get(networkId);
    if (existing && !existing.error) return existing; // already running / done

    const state = {
      networkId,
      step:    'queued',
      message: 'Queued…',
      percent: 0,
      done:    false,
      error:   null,
    };
    this._states.set(networkId, state);

    this._run(networkId, state).catch((err) => {
      logger.error(`[Provisioner] ${networkId}: ${err.message}`);
      this._update(state, {
        step:    'error',
        message: `Provisioning failed: ${err.message}`,
        error:   err.message,
        done:    true,
      });
    });

    return state;
  }

  getState(networkId) {
    return this._states.get(networkId) ?? null;
  }

  /**
   * Return the path of the newest cached Paper JAR, or null.
   * Called by ServerManager to auto-link a JAR on sub-server creation.
   */
  getBestPaperJar() {
    const row = db.get(
      "SELECT file_path FROM jars WHERE kind='spigot' ORDER BY downloaded_at DESC LIMIT 1"
    );
    if (row && fs.existsSync(row.file_path)) return row.file_path;

    const jarsDir = path.join(config.dataDir, 'jars');
    if (!fs.existsSync(jarsDir)) return null;
    const match = fs.readdirSync(jarsDir)
      .find(f => f.toLowerCase().startsWith('paper') && f.endsWith('.jar'));
    return match ? path.join(jarsDir, match) : null;
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  async _run(networkId, state) {
    const jarsDir = path.join(config.dataDir, 'jars');
    await fsu.ensureDir(jarsDir);

    // ── 1 · Proxy JAR (BungeeCord → Waterfall fallback) ─────────────────────
    this._update(state, { step: 'proxy-check', message: 'Checking proxy jar cache…', percent: 5 });

    let proxyJarPath = this._findCached('bungee', jarsDir);

    if (!proxyJarPath) {
      proxyJarPath = await this._downloadProxy(state, jarsDir);
    } else {
      const name = path.basename(proxyJarPath);
      this._update(state, { message: `Proxy jar found in cache (${name}) ✓`, percent: 42 });
    }

    // ── 2 · Paper backend JAR ─────────────────────────────────────────────────
    this._update(state, { step: 'paper-check', message: 'Checking Paper jar cache…', percent: 44 });

    let paperJarPath = this._findCached('spigot', jarsDir);

    if (!paperJarPath) {
      paperJarPath = await this._downloadPaper(state, jarsDir);
    } else {
      const name = path.basename(paperJarPath);
      this._update(state, { message: `Paper jar found in cache (${name}) ✓`, percent: 82 });
    }

    // ── 3 · Provision network directory ───────────────────────────────────────
    await this._finalize(networkId, proxyJarPath, state);
  }

  /** Try BungeeCord; fall back to Waterfall on any error. */
  async _downloadProxy(state, jarsDir) {
    // First attempt: BungeeCord from ci.md-5.net
    this._update(state, { step: 'bungee-dl', message: 'Downloading BungeeCord…', percent: 8 });

    const bungeeDest = path.join(jarsDir, 'BungeeCord.jar');
    try {
      await downloader.downloadFile(
        downloader.BUNGEE_JAR_URL,
        bungeeDest,
        ({ percent }) => {
          if (percent >= 0) {
            this._update(state, {
              message: `Downloading BungeeCord… ${percent}%`,
              percent: 8 + Math.round(percent * 0.34),
            });
          }
        }
      );
      this._registerJar('bungee', 'latest', 'BungeeCord.jar', bungeeDest);
      logger.info('[Provisioner] BungeeCord.jar downloaded');
      return bungeeDest;

    } catch (bungeeErr) {
      // BungeeCord download failed (likely Cloudflare 403) — fall back to Waterfall
      logger.warn(`[Provisioner] BungeeCord download failed (${bungeeErr.message}), falling back to Waterfall`);
      this._update(state, {
        step:    'waterfall-meta',
        message: `BungeeCord unavailable — fetching Waterfall (BungeeCord-compatible)…`,
        percent: 14,
      });

      let meta;
      try {
        meta = await downloader.getLatestWaterfallMeta();
      } catch (metaErr) {
        throw new Error(
          `Could not download proxy JAR — BungeeCord: ${bungeeErr.message}; ` +
          `Waterfall: ${metaErr.message}. ` +
          `Upload a BungeeCord or Waterfall JAR via the panel's JAR manager.`
        );
      }

      this._update(state, {
        step:    'waterfall-dl',
        message: `Downloading Waterfall ${meta.version} #${meta.build} (BungeeCord-compatible)…`,
        percent: 16,
      });

      const dest = path.join(jarsDir, meta.fileName);
      await downloader.downloadFile(
        meta.url,
        dest,
        ({ percent }) => {
          if (percent >= 0) {
            this._update(state, {
              message: `Downloading Waterfall ${meta.version} #${meta.build}… ${percent}%`,
              percent: 16 + Math.round(percent * 0.26),
            });
          }
        }
      );
      this._registerJar('bungee', meta.version, meta.fileName, dest);
      logger.info(`[Provisioner] ${meta.fileName} downloaded as proxy`);
      return dest;
    }
  }

  async _downloadPaper(state, jarsDir) {
    // getLatestPaperMeta() now delegates to Purpur (Paper API v2 is sunset,
    // v3 requires OAuth). Purpur is 100% Paper-plugin-compatible.
    this._update(state, { step: 'paper-meta', message: 'Fetching latest Purpur (Paper-compatible) version…', percent: 46 });

    let meta;
    try {
      meta = await downloader.getLatestPaperMeta(); // → getLatestPurpurMeta()
    } catch (apiErr) {
      logger.warn(`[Provisioner] Server JAR API unreachable: ${apiErr.message}`);
      this._update(state, {
        step:    'paper-skip',
        message: 'Server JAR API unreachable. Upload a Spigot/Paper/Purpur JAR via the panel after launch.',
        percent: 82,
      });
      return null;
    }

    // Purpur uses `downloadUrl`; keep `url` as fallback for any future compatible source
    const jarUrl = meta.downloadUrl ?? meta.url;
    const label  = `${meta.project ?? 'server'} ${meta.version} #${meta.build}`;

    this._update(state, {
      step:    'paper-dl',
      message: `Downloading ${label}…`,
      percent: 48,
    });

    const dest = path.join(jarsDir, meta.fileName);
    await downloader.downloadFile(
      jarUrl,
      dest,
      ({ percent }) => {
        if (percent >= 0) {
          this._update(state, {
            message: `Downloading ${label}… ${percent}%`,
            percent: 48 + Math.round(percent * 0.34),
          });
        }
      }
    );
    this._registerJar('spigot', meta.version, meta.fileName, dest);
    logger.info(`[Provisioner] ${meta.fileName} downloaded`);
    return dest;
  }

  async _finalize(networkId, proxyJarPath, state) {
    this._update(state, {
      step:    'copy-proxy',
      message: 'Placing proxy JAR into network directory…',
      percent: 84,
    });

    const bungeeDir = path.join(config.dataDir, 'servers', networkId, 'bungee');
    await fsu.ensureDir(bungeeDir);

    const destName = 'proxy.jar'; // neutral name so both BungeeCord & Waterfall work
    const dest     = path.join(bungeeDir, destName);
    if (!fs.existsSync(dest)) {
      await fsu.copyFile(proxyJarPath, dest);
    }

    // The start command must use whatever file we placed
    this._update(state, {
      step:    'done',
      message: 'Network provisioned — ready to add servers and start!',
      percent: 100,
      done:    true,
      proxyJar: path.basename(proxyJarPath),
    });

    logger.info(`[Provisioner] Network ${networkId} fully provisioned`);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  _update(state, patch) {
    Object.assign(state, patch);
    this.emit('progress', { ...state });
    logger.debug(`[Provisioner][${state.networkId}] ${state.message}`);
  }

  _findCached(kind, jarsDir) {
    const row = db.get(
      'SELECT file_path FROM jars WHERE kind=? ORDER BY downloaded_at DESC LIMIT 1',
      [kind]
    );
    if (row && fs.existsSync(row.file_path)) return row.file_path;

    if (!fs.existsSync(jarsDir)) return null;
    const prefixes = kind === 'bungee'
      ? ['BungeeCord', 'waterfall', 'bungee']
      : ['paper', 'spigot'];
    const file = fs.readdirSync(jarsDir).find(f => {
      const fl = f.toLowerCase();
      return prefixes.some(p => fl.startsWith(p.toLowerCase())) && f.endsWith('.jar');
    });
    return file ? path.join(jarsDir, file) : null;
  }

  _registerJar(kind, mcVersion, fileName, filePath) {
    if (db.get('SELECT id FROM jars WHERE file_path=?', [filePath])) return;
    db.run(
      'INSERT INTO jars (id, kind, mc_version, file_name, file_path) VALUES (?, ?, ?, ?, ?)',
      [uuid(), kind, mcVersion, fileName, filePath]
    );
  }
}

module.exports = new Provisioner();
