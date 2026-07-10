'use strict';

const fs           = require('fs');
const path         = require('path');
const axios        = require('axios');
const { v4: uuid } = require('uuid');

const db     = require('../database');
const config = require('../config');
const logger = require('../utils/logger');
const fsu    = require('../utils/fileSystem');

const SPIGET_BASE = 'https://api.spiget.org/v2';
const SPIGET_UA   = 'LoomArc/1.0 (plugin manager)';

const http = axios.create({
  baseURL: SPIGET_BASE,
  timeout: 15000,
  headers: { 'user-agent': SPIGET_UA },
});

class PluginManager {
  // ─── Spiget search / info ─────────────────────────────────────────────────

  async search(query, { page = 1, size = 10, sort = '-downloads' } = {}) {
    const { data } = await http.get(`/search/resources/${encodeURIComponent(query)}`, {
      params: { size, page, sort, fields: 'id,name,tag,downloads,rating,version,file,author' },
    });
    return data;
  }

  async getResource(spigetId) {
    const { data } = await http.get(`/resources/${spigetId}`);
    return data;
  }

  async getResourceVersions(spigetId, { size = 10 } = {}) {
    const { data } = await http.get(`/resources/${spigetId}/versions`, { params: { size } });
    return data;
  }

  // ─── Download ─────────────────────────────────────────────────────────────

  /**
   * Download a plugin JAR from Spiget and install it into a server's plugins/ dir.
   *
   * @param {string}  serverId   Target server UUID
   * @param {number}  spigetId   Spiget resource ID
   * @param {string}  [versionId] Specific version ID (defaults to latest)
   */
  async install(serverId, spigetId, versionId) {
    const server = db.get('SELECT * FROM servers WHERE id = ?', [serverId]);
    if (!server) throw new Error(`Server not found: ${serverId}`);

    const resource = await this.getResource(spigetId);
    const name     = resource.name;
    const version  = resource.version?.id ?? 'latest';

    // External URL plugins (e.g. GitHub releases) — Spiget marks these with file.type = 'external'
    if (resource.file?.type === 'external' || resource.external) {
      throw new Error(
        `"${name}" is hosted externally (not on SpigotMC). ` +
        'Download it manually and upload via the file manager.'
      );
    }

    const downloadUrl = versionId
      ? `${SPIGET_BASE}/resources/${spigetId}/versions/${versionId}/download`
      : `${SPIGET_BASE}/resources/${spigetId}/download`;

    logger.info(`Downloading plugin "${name}" (spiget:${spigetId}) for server ${serverId}`);

    const response = await http.get(downloadUrl, { responseType: 'stream' });

    const pluginsDir = path.join(config.dataDir, 'servers', server.network_id, serverId, 'plugins');
    await fsu.ensureDir(pluginsDir);

    // Derive filename from Content-Disposition or fallback
    const disposition = response.headers['content-disposition'] || '';
    const match       = disposition.match(/filename[^;=\n]*=(['"]?)([^'";\n]+)\1/);
    const fileName    = match?.[2] ?? `${name.replace(/\s+/g, '_')}-${version}.jar`;
    const destPath    = path.join(pluginsDir, fileName);

    await new Promise((resolve, reject) => {
      const stream = fs.createWriteStream(destPath);
      response.data.pipe(stream);
      stream.on('finish', resolve);
      stream.on('error', reject);
    });

    logger.info(`Plugin installed: ${fileName} → ${destPath}`);

    // Track in DB
    const id = uuid();
    db.run(
      'INSERT INTO plugins (id, server_id, spiget_id, name, version, file_name) VALUES (?, ?, ?, ?, ?, ?)',
      [id, serverId, spigetId, name, String(version), fileName]
    );

    return { id, name, version, fileName };
  }

  // ─── File-based install (manual upload) ───────────────────────────────────

  async installFromFile(serverId, sourcePath, pluginName) {
    const server = db.get('SELECT * FROM servers WHERE id = ?', [serverId]);
    if (!server) throw new Error(`Server not found: ${serverId}`);

    const fileName   = path.basename(sourcePath);
    const pluginsDir = path.join(config.dataDir, 'servers', server.network_id, serverId, 'plugins');
    await fsu.ensureDir(pluginsDir);
    await fsu.copyFile(sourcePath, path.join(pluginsDir, fileName));

    const id = uuid();
    db.run(
      'INSERT INTO plugins (id, server_id, name, file_name) VALUES (?, ?, ?, ?)',
      [id, serverId, pluginName || fileName.replace(/\.jar$/i, ''), fileName]
    );

    return { id, name: pluginName || fileName, fileName };
  }

  // ─── Removal ──────────────────────────────────────────────────────────────

  async uninstall(pluginId) {
    const plugin = db.get('SELECT p.*, s.network_id FROM plugins p JOIN servers s ON p.server_id = s.id WHERE p.id = ?', [pluginId]);
    if (!plugin) throw new Error(`Plugin record not found: ${pluginId}`);

    const filePath = path.join(
      config.dataDir, 'servers', plugin.network_id, plugin.server_id, 'plugins', plugin.file_name
    );
    await fsu.remove(filePath);
    db.run('DELETE FROM plugins WHERE id = ?', [pluginId]);
    logger.info(`Uninstalled plugin: ${plugin.name} from server ${plugin.server_id}`);
  }

  // ─── Listing ──────────────────────────────────────────────────────────────

  listForServer(serverId) {
    return db.all('SELECT * FROM plugins WHERE server_id = ? ORDER BY installed_at DESC', [serverId]);
  }
}

module.exports = new PluginManager();
