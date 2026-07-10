'use strict';

const path       = require('path');
const { v4: uuid } = require('uuid');

const db             = require('../database');
const config         = require('../config');
const logger         = require('../utils/logger');
const fsu            = require('../utils/fileSystem');
const cfgGen         = require('../utils/configGenerator');
const portAlloc      = require('./PortAllocator');
const processManager = require('./ProcessManager');
const provisioner    = require('./Provisioner');

class NetworkManager {
  // ─── CRUD ──────────────────────────────────────────────────────────────────

  async create(name, description = '') {
    if (db.get('SELECT id FROM networks WHERE name = ?', [name])) {
      throw new Error(`Network "${name}" already exists`);
    }

    const id        = uuid();
    const bungeePort = portAlloc.allocate('bungee', id);
    const bungeeDir  = this._bungeeDir(id);

    await fsu.ensureDir(bungeeDir);
    await fsu.ensureDir(path.join(bungeeDir, 'plugins'));

    // Minimal BungeeCord config (no backend servers yet)
    await cfgGen.generateBungeeConfig(bungeeDir, bungeePort, []);

    db.run(
      'INSERT INTO networks (id, name, description, bungee_port) VALUES (?, ?, ?, ?)',
      [id, name, description, bungeePort]
    );

    logger.info(`Network created: "${name}" (id=${id}, port=${bungeePort})`);

    // Kick off JAR download + folder provisioning in the background.
    // The caller can stream progress via GET /api/networks/:id/provision (SSE).
    provisioner.provision(id);

    return this.get(id);
  }

  async rename(id, newName) {
    this._assertExists(id);
    if (db.get('SELECT id FROM networks WHERE name = ? AND id != ?', [newName, id])) {
      throw new Error(`Network "${newName}" already exists`);
    }
    db.run('UPDATE networks SET name = ?, updated_at = unixepoch() WHERE id = ?', [newName, id]);
    return this.get(id);
  }

  async delete(id) {
    const network = this._assertExists(id);

    // Stop all sub-servers
    const servers = db.all('SELECT id FROM servers WHERE network_id = ?', [id]);
    for (const srv of servers) {
      if (processManager.getStatus(srv.id) === 'running') {
        await processManager.stop(srv.id);
      }
      portAlloc.releaseByEntity(srv.id);
    }

    // Stop BungeeCord
    const bungeeId = this._processId(id);
    if (processManager.getStatus(bungeeId) === 'running') {
      await processManager.stop(bungeeId);
    }

    portAlloc.releaseByEntity(id);
    await fsu.remove(path.join(config.dataDir, 'servers', id));
    db.run('DELETE FROM networks WHERE id = ?', [id]);
    logger.info(`Network deleted: ${id} ("${network.name}")`);
  }

  get(id) {
    return db.get('SELECT * FROM networks WHERE id = ?', [id]) ?? null;
  }

  list() {
    return db.all('SELECT * FROM networks ORDER BY created_at DESC');
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  async start(networkId) {
    const network = this._assertExists(networkId);
    if (processManager.getStatus(this._processId(networkId)) === 'running') {
      throw new Error('BungeeCord is already running for this network');
    }

    const bungeeDir = this._bungeeDir(networkId);
    // Prefer the canonical 'proxy.jar' placed by the provisioner; fall back to
    // any other JAR that the user may have manually uploaded.
    const jarName = (() => {
      const fs = require('fs');
      const canon = require('path').join(bungeeDir, 'proxy.jar');
      if (fs.existsSync(canon)) return 'proxy.jar';
      return null;
    })() || await fsu.findJar(bungeeDir);

    if (!jarName) {
      throw new Error(
        'No proxy JAR found. The network may still be provisioning, or upload ' +
        'a BungeeCord/Waterfall JAR via System → JAR Manager and link it to this network.'
      );
    }

    // Regenerate config so it reflects current server list
    await this.syncConfig(networkId);

    const javaPath = config.javaPath;
    const mem      = network.memory_mb;
    const args     = [
      `-Xms${Math.floor(mem / 2)}M`,
      `-Xmx${mem}M`,
      '-jar', path.join(bungeeDir, jarName),
      '--nojline',
    ];

    processManager.spawn(this._processId(networkId), javaPath, args, bungeeDir);
    db.run("UPDATE networks SET status='starting', updated_at=unixepoch() WHERE id=?", [networkId]);
  }

  async stop(networkId) {
    this._assertExists(networkId);
    await processManager.stop(this._processId(networkId));
    db.run("UPDATE networks SET status='stopped', updated_at=unixepoch() WHERE id=?", [networkId]);
  }

  kill(networkId) {
    this._assertExists(networkId);
    const pid = processManager.getPid(this._processId(networkId));
    processManager.kill(this._processId(networkId));
    db.run("UPDATE networks SET status='stopped', pid=NULL, updated_at=unixepoch() WHERE id=?", [networkId]);
    return pid;
  }

  async restart(networkId) {
    this._assertExists(networkId);
    if (processManager.getStatus(this._processId(networkId)) === 'running') {
      await processManager.stop(this._processId(networkId));
      db.run("UPDATE networks SET status='stopped', updated_at=unixepoch() WHERE id=?", [networkId]);
    }
    await this.start(networkId);
    logger.info(`Restarted BungeeCord for network ${networkId}`);
  }

  /** Regenerate BungeeCord config.yml from current DB server list. */
  async syncConfig(networkId) {
    const network = this._assertExists(networkId);
    const servers  = db.all('SELECT name, port, type FROM servers WHERE network_id = ?', [networkId]);
    await cfgGen.generateBungeeConfig(this._bungeeDir(networkId), network.bungee_port, servers);
  }

  sendCommand(networkId, command) {
    return processManager.sendCommand(this._processId(networkId), command);
  }

  getOutput(networkId, lines) {
    return processManager.getOutput(this._processId(networkId), lines);
  }

  getLiveStatus(networkId) {
    return processManager.getStatus(this._processId(networkId));
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  _processId(networkId) { return `bungee-${networkId}`; }
  _bungeeDir(networkId) { return path.join(config.dataDir, 'servers', networkId, 'bungee'); }

  _assertExists(id) {
    const n = this.get(id);
    if (!n) throw new Error(`Network not found: ${id}`);
    return n;
  }
}

module.exports = new NetworkManager();
