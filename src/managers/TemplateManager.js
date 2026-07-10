'use strict';

const { v4: uuid } = require('uuid');
const db     = require('../database');
const logger = require('../utils/logger');

class TemplateManager {
  list() {
    return db.all('SELECT * FROM templates ORDER BY created_at DESC');
  }

  get(id) {
    return db.get('SELECT * FROM templates WHERE id = ?', [id]);
  }

  create({ name, description, serverType, memoryMb, configYml }) {
    if (db.get('SELECT id FROM templates WHERE name = ?', [name])) {
      throw new Error(`Template "${name}" already exists`);
    }
    const id = uuid();
    db.run(
      'INSERT INTO templates (id, name, description, server_type, memory_mb, config_yml) VALUES (?, ?, ?, ?, ?, ?)',
      [id, name, description || '', serverType || 'custom', memoryMb || 1024, configYml || '']
    );
    logger.info(`[Templates] Created template "${name}"`);
    return this.get(id);
  }

  createFromServer(serverId, name, description) {
    const server = db.get('SELECT * FROM servers WHERE id = ?', [serverId]);
    if (!server) throw new Error('Server not found');

    return this.create({
      name,
      description: description || `Cloned from server "${server.name}"`,
      serverType:  server.type,
      memoryMb:    server.memory_mb,
      configYml:   JSON.stringify({ extra_flags: server.extra_flags }),
    });
  }

  delete(id) {
    if (!this.get(id)) throw new Error('Template not found');
    db.run('DELETE FROM templates WHERE id = ?', [id]);
  }

  /** Returns the params needed to create a server with this template applied. */
  serverParams(templateId, networkId, serverName) {
    const tpl = this.get(templateId);
    if (!tpl) throw new Error('Template not found');

    let extra = {};
    try { extra = JSON.parse(tpl.config_yml || '{}'); } catch {}

    return {
      network_id:  networkId,
      name:        serverName,
      type:        tpl.server_type,
      memory_mb:   tpl.memory_mb,
      extra_flags: extra.extra_flags || '',
    };
  }
}

module.exports = new TemplateManager();
