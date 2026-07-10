'use strict';

const path         = require('path');
const { v4: uuid } = require('uuid');

const db             = require('../database');
const config         = require('../config');
const logger         = require('../utils/logger');
const fsu            = require('../utils/fileSystem');
const cfgGen         = require('../utils/configGenerator');
const portAlloc      = require('./PortAllocator');
const processManager = require('./ProcessManager');
const networkManager = require('./NetworkManager');
const provisioner    = require('./Provisioner');

class ServerManager {
  // ─── CRUD ──────────────────────────────────────────────────────────────────

  async create(networkId, name, type = 'custom', memoryMb = 1024) {
    // Validate network
    const network = db.get('SELECT id FROM networks WHERE id = ?', [networkId]);
    if (!network) throw new Error(`Network not found: ${networkId}`);

    // Name must be unique within network
    if (db.get('SELECT id FROM servers WHERE network_id = ? AND name = ?', [networkId, name])) {
      throw new Error(`Server "${name}" already exists in this network`);
    }

    const id   = uuid();
    const port = portAlloc.allocate('server', id);
    const dir  = this._serverDir(networkId, id);

    // Scaffold directory
    await fsu.ensureDir(path.join(dir, 'plugins'));
    await fsu.ensureDir(path.join(dir, 'world'));

    // Generate starter config files
    await cfgGen.generateServerProperties(dir, port, type);
    await cfgGen.generateSpigotYml(dir);
    await cfgGen.generatePaperConfig(dir);
    await cfgGen.generateEula(dir);

    db.run(
      'INSERT INTO servers (id, network_id, name, type, port, memory_mb) VALUES (?, ?, ?, ?, ?, ?)',
      [id, networkId, name, type, port, memoryMb]
    );

    // Regenerate BungeeCord config to include this new server
    await networkManager.syncConfig(networkId);

    // Auto-link the best available Paper JAR from the cache so the server
    // can be started immediately without a manual upload step.
    const paperJar = provisioner.getBestPaperJar();
    if (paperJar) {
      const destJar = path.join(dir, path.basename(paperJar));
      if (!require('fs').existsSync(destJar)) {
        await fsu.copyFile(paperJar, destJar);
        logger.info(`Auto-linked ${path.basename(paperJar)} → ${destJar}`);
      }
    }

    logger.info(`Server created: "${name}" (id=${id}, network=${networkId}, port=${port})`);
    return this.get(id);
  }

  async rename(id, newName) {
    const server = this._assert(id);
    if (db.get('SELECT id FROM servers WHERE network_id = ? AND name = ? AND id != ?', [server.network_id, newName, id])) {
      throw new Error(`Server "${newName}" already exists in this network`);
    }
    db.run('UPDATE servers SET name = ?, updated_at = unixepoch() WHERE id = ?', [newName, id]);
    await networkManager.syncConfig(server.network_id);
    return this.get(id);
  }

  async delete(id) {
    const server = this._assert(id);

    if (processManager.getStatus(id) === 'running') {
      await processManager.stop(id);
    }

    portAlloc.release(server.port);
    portAlloc.releaseByEntity(id);
    await fsu.remove(this._serverDir(server.network_id, id));
    db.run('DELETE FROM servers WHERE id = ?', [id]);

    await networkManager.syncConfig(server.network_id);
    logger.info(`Server deleted: ${id} ("${server.name}")`);
  }

  get(id) {
    return db.get('SELECT * FROM servers WHERE id = ?', [id]) ?? null;
  }

  listByNetwork(networkId) {
    return db.all('SELECT * FROM servers WHERE network_id = ? ORDER BY created_at', [networkId]);
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  async start(id) {
    const server = this._assert(id);
    if (processManager.getStatus(id) === 'running') {
      throw new Error(`Server "${server.name}" is already running`);
    }

    const dir     = this._serverDir(server.network_id, id);
    const jarName = await fsu.findJar(dir);
    if (!jarName) {
      throw new Error('No JAR file found in server directory. Upload a Spigot/Paper JAR first.');
    }

    const mem  = server.memory_mb;
    const args = [
      `-Xms${Math.floor(mem / 2)}M`,
      `-Xmx${mem}M`,
      ...(server.extra_flags ? server.extra_flags.split(' ').filter(Boolean) : []),
      '-jar', path.join(dir, jarName),
      '--nogui',
    ];

    processManager.spawn(id, config.javaPath, args, dir);
    db.run("UPDATE servers SET status='starting', updated_at=unixepoch() WHERE id=?", [id]);
    logger.info(`Started server "${server.name}" (${id})`);
  }

  async stop(id) {
    const server = this._assert(id);
    await processManager.stop(id);
    db.run("UPDATE servers SET status='stopped', updated_at=unixepoch() WHERE id=?", [id]);
    logger.info(`Stopped server "${server.name}" (${id})`);
  }

  kill(id) {
    const server = this._assert(id);
    const pid = processManager.getPid(id);
    processManager.kill(id);
    db.run("UPDATE servers SET status='stopped', pid=NULL, updated_at=unixepoch() WHERE id=?", [id]);
    logger.info(`Killed server "${server.name}" (${id}) — PID ${pid}`);
    return pid;
  }

  async restart(id) {
    const server = this._assert(id);
    if (processManager.getStatus(id) === 'running') {
      await processManager.stop(id);
      db.run("UPDATE servers SET status='stopped', updated_at=unixepoch() WHERE id=?", [id]);
    }
    await this.start(id);
    logger.info(`Restarted server "${server.name}" (${id})`);
  }

  sendCommand(id, command) {
    return processManager.sendCommand(id, command);
  }

  getOutput(id, lines) {
    return processManager.getOutput(id, lines);
  }

  getLiveStatus(id) {
    return processManager.getStatus(id);
  }

  /** Update memory or extra JVM flags (takes effect on next start). */
  async updateSettings(id, { memoryMb, extraFlags }) {
    this._assert(id);
    const fields = [];
    const vals   = [];
    if (memoryMb  !== undefined) { fields.push('memory_mb = ?');   vals.push(memoryMb); }
    if (extraFlags !== undefined) { fields.push('extra_flags = ?'); vals.push(extraFlags); }
    if (!fields.length) return this.get(id);
    vals.push(id);
    db.run(`UPDATE servers SET ${fields.join(', ')}, updated_at=unixepoch() WHERE id=?`, vals);
    return this.get(id);
  }

  /** Copy a JAR from the global jar cache into this server's directory. */
  async linkJar(id, jarSourcePath) {
    const server = this._assert(id);
    const dir    = this._serverDir(server.network_id, id);
    const dest   = path.join(dir, path.basename(jarSourcePath));
    await fsu.copyFile(jarSourcePath, dest);
    logger.info(`Linked JAR to server ${id}: ${path.basename(jarSourcePath)}`);
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  _serverDir(networkId, serverId) {
    return path.join(config.dataDir, 'servers', networkId, serverId);
  }

  _assert(id) {
    const s = this.get(id);
    if (!s) throw new Error(`Server not found: ${id}`);
    return s;
  }
}

module.exports = new ServerManager();
