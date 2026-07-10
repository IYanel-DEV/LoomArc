'use strict';

const fs           = require('fs');
const path         = require('path');
const archiver     = require('archiver');
const { v4: uuid } = require('uuid');
const db           = require('../database');
const config       = require('../config');
const logger       = require('../utils/logger');
const fsu          = require('../utils/fileSystem');

class BackupManager {
  // ── Public API ───────────────────────────────────────────────────────────────

  async createBackup(serverId) {
    const server = db.get('SELECT * FROM servers WHERE id = ?', [serverId]);
    if (!server) throw new Error('Server not found');

    const worldDir = path.join(config.dataDir, 'servers', server.network_id, serverId, 'world');
    if (!fs.existsSync(worldDir)) {
      throw new Error(`world/ directory not found — start the server at least once first`);
    }

    const outDir = path.join(config.dataDir, 'backups', serverId);
    await fsu.ensureDir(outDir);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
    const fileName  = `world-${server.name}-${timestamp}.zip`;
    const filePath  = path.join(outDir, fileName);

    await this._zip(worldDir, filePath);

    const stat = fs.statSync(filePath);
    const id   = uuid();
    db.run(
      'INSERT INTO backups (id, server_id, file_name, file_path, size_bytes) VALUES (?, ?, ?, ?, ?)',
      [id, serverId, fileName, filePath, stat.size]
    );

    logger.info(`[Backup] ${fileName} created (${(stat.size / 1048576).toFixed(1)} MB)`);
    return db.get('SELECT * FROM backups WHERE id = ?', [id]);
  }

  listBackups(serverId) {
    return db.all(
      'SELECT * FROM backups WHERE server_id = ? ORDER BY created_at DESC',
      [serverId]
    );
  }

  getBackup(id) {
    return db.get('SELECT * FROM backups WHERE id = ?', [id]);
  }

  deleteBackup(id) {
    const backup = this.getBackup(id);
    if (!backup) throw new Error('Backup not found');
    try { fs.unlinkSync(backup.file_path); } catch {}
    db.run('DELETE FROM backups WHERE id = ?', [id]);
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  _zip(sourceDir, destPath) {
    return new Promise((resolve, reject) => {
      const output  = fs.createWriteStream(destPath);
      const archive = archiver('zip', { zlib: { level: 6 } });

      output.on('close', resolve);
      archive.on('error', reject);

      archive.pipe(output);
      archive.directory(sourceDir, 'world');
      archive.finalize();
    });
  }
}

module.exports = new BackupManager();
