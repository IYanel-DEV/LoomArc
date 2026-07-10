'use strict';

const cron         = require('node-cron');
const { v4: uuid } = require('uuid');
const db           = require('../database');
const logger       = require('../utils/logger');

class SchedulerManager {
  constructor() {
    this._jobs = new Map(); // taskId → ScheduledTask
  }

  // ── Bootstrap ────────────────────────────────────────────────────────────────

  init() {
    const tasks = db.all('SELECT * FROM scheduled_tasks WHERE enabled = 1');
    for (const task of tasks) {
      this._schedule(task);
    }
    logger.info(`[Scheduler] ${tasks.length} task(s) loaded`);
  }

  // ── CRUD ─────────────────────────────────────────────────────────────────────

  create({ networkId, serverId, action, command, cronExpr, label }) {
    if (!cron.validate(cronExpr)) throw new Error(`Invalid cron expression: "${cronExpr}"`);
    if (!['restart', 'command'].includes(action)) throw new Error('action must be "restart" or "command"');
    if (!networkId && !serverId) throw new Error('networkId or serverId is required');
    if (action === 'command' && !(command || '').trim()) throw new Error('command is required for command action');

    const id = uuid();
    db.run(
      `INSERT INTO scheduled_tasks (id, network_id, server_id, action, command, cron_expr, label, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [id, networkId || null, serverId || null, action, command || '', cronExpr, label || '']
    );

    const task = this.getTask(id);
    this._schedule(task);
    return task;
  }

  listTasks({ networkId, serverId } = {}) {
    if (networkId) return db.all('SELECT * FROM scheduled_tasks WHERE network_id = ? ORDER BY created_at ASC', [networkId]);
    if (serverId)  return db.all('SELECT * FROM scheduled_tasks WHERE server_id  = ? ORDER BY created_at ASC', [serverId]);
    return db.all('SELECT * FROM scheduled_tasks ORDER BY created_at ASC');
  }

  getTask(id) {
    return db.get('SELECT * FROM scheduled_tasks WHERE id = ?', [id]);
  }

  updateTask(id, { cronExpr, label, command, enabled } = {}) {
    const task = this.getTask(id);
    if (!task) throw new Error('Task not found');

    const newCron    = cronExpr !== undefined ? cronExpr  : task.cron_expr;
    const newLabel   = label   !== undefined ? label    : task.label;
    const newCommand = command  !== undefined ? command   : task.command;
    const newEnabled = enabled  !== undefined ? (enabled ? 1 : 0) : task.enabled;

    if (!cron.validate(newCron)) throw new Error(`Invalid cron expression: "${newCron}"`);

    db.run(
      'UPDATE scheduled_tasks SET cron_expr=?, label=?, command=?, enabled=? WHERE id=?',
      [newCron, newLabel, newCommand, newEnabled, id]
    );

    this._deschedule(id);
    const updated = this.getTask(id);
    if (updated.enabled) this._schedule(updated);
    return updated;
  }

  deleteTask(id) {
    if (!this.getTask(id)) throw new Error('Task not found');
    this._deschedule(id);
    db.run('DELETE FROM scheduled_tasks WHERE id = ?', [id]);
  }

  toggleTask(id) {
    const task = this.getTask(id);
    if (!task) throw new Error('Task not found');
    return this.updateTask(id, { enabled: !task.enabled });
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  _schedule(task) {
    if (!cron.validate(task.cron_expr)) {
      logger.warn(`[Scheduler] Invalid cron for task ${task.id}: "${task.cron_expr}"`);
      return;
    }
    const job = cron.schedule(task.cron_expr, () => this._execute(task), { timezone: 'UTC' });
    this._jobs.set(task.id, job);
    logger.debug(`[Scheduler] Scheduled "${task.label || task.id}" (${task.cron_expr})`);
  }

  _deschedule(id) {
    const job = this._jobs.get(id);
    if (job) { job.stop(); this._jobs.delete(id); }
  }

  async _execute(task) {
    logger.info(`[Scheduler] Firing task "${task.label || task.id}" (${task.action})`);
    try {
      const fresh = this.getTask(task.id);
      if (!fresh || !fresh.enabled) return;

      if (fresh.action === 'restart') {
        if (fresh.server_id) {
          await require('./ServerManager').restart(fresh.server_id);
        } else if (fresh.network_id) {
          await require('./NetworkManager').restart(fresh.network_id);
        }
      } else if (fresh.action === 'command') {
        const processId = fresh.server_id || `bungee-${fresh.network_id}`;
        require('./ProcessManager').sendCommand(processId, fresh.command);
      }
    } catch (e) {
      logger.error(`[Scheduler] Task "${task.id}" failed: ${e.message}`);
    }
  }
}

module.exports = new SchedulerManager();
