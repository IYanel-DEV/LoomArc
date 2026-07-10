'use strict';

const db     = require('../database');
const config = require('../config');

/**
 * Allocates ports from two non-overlapping ranges:
 *   bungee  → BUNGEE_PORT_START … BUNGEE_PORT_END
 *   server  → SERVER_PORT_START … SERVER_PORT_END
 *
 * All allocations are persisted to the port_allocations table so they
 * survive panel restarts.
 */
class PortAllocator {
  allocate(kind, entityId) {
    const { start, end } = this._range(kind);

    // Build the set of already-used ports for this kind
    const used = new Set(
      db.all('SELECT port FROM port_allocations WHERE kind = ?', [kind]).map(r => r.port)
    );

    for (let port = start; port <= end; port++) {
      if (!used.has(port)) {
        db.run(
          'INSERT INTO port_allocations (port, kind, entity_id) VALUES (?, ?, ?)',
          [port, kind, entityId]
        );
        return port;
      }
    }

    throw new Error(
      `No free ${kind} ports in range ${start}–${end}. ` +
      `Extend the range in .env or free up existing ports.`
    );
  }

  release(port) {
    db.run('DELETE FROM port_allocations WHERE port = ?', [port]);
  }

  releaseByEntity(entityId) {
    db.run('DELETE FROM port_allocations WHERE entity_id = ?', [entityId]);
  }

  isInUse(port) {
    return !!db.get('SELECT port FROM port_allocations WHERE port = ?', [port]);
  }

  listAllocations() {
    return db.all('SELECT * FROM port_allocations ORDER BY port');
  }

  _range(kind) {
    if (kind === 'bungee') {
      return { start: config.ports.bungeeStart, end: config.ports.bungeeEnd };
    }
    if (kind === 'server') {
      return { start: config.ports.serverStart, end: config.ports.serverEnd };
    }
    throw new Error(`Unknown allocation kind: ${kind}`);
  }
}

module.exports = new PortAllocator();
