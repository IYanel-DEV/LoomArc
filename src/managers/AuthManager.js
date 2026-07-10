'use strict';

const bcrypt       = require('bcryptjs');
const jwt          = require('jsonwebtoken');
const { v4: uuid } = require('uuid');
const db           = require('../database');
const config       = require('../config');

const SALT_ROUNDS = 12;

class AuthManager {
  // ── User management ──────────────────────────────────────────────────────────

  createUser(username, password, role = 'viewer') {
    if (!['admin', 'viewer'].includes(role)) throw new Error('Invalid role');
    if (db.get('SELECT id FROM users WHERE username = ?', [username])) {
      throw new Error(`User "${username}" already exists`);
    }
    const hash = bcrypt.hashSync(password, SALT_ROUNDS);
    const id   = uuid();
    db.run(
      'INSERT INTO users (id, username, password, role) VALUES (?, ?, ?, ?)',
      [id, username, hash, role]
    );
    return this._safe(db.get('SELECT * FROM users WHERE id = ?', [id]));
  }

  listUsers() {
    return db.all('SELECT id, username, role, created_at FROM users ORDER BY created_at ASC');
  }

  getUser(id) {
    const u = db.get('SELECT * FROM users WHERE id = ?', [id]);
    return u ? this._safe(u) : null;
  }

  getUserByUsername(username) {
    return db.get('SELECT * FROM users WHERE username = ?', [username]);
  }

  deleteUser(id) {
    if (!db.get('SELECT id FROM users WHERE id = ?', [id])) throw new Error('User not found');
    const remaining = db.all('SELECT id FROM users WHERE id != ?', [id]);
    if (remaining.length === 0) throw new Error('Cannot delete the last user');
    db.run('DELETE FROM users WHERE id = ?', [id]);
  }

  updatePassword(id, newPassword) {
    const hash = bcrypt.hashSync(newPassword, SALT_ROUNDS);
    db.run('UPDATE users SET password = ? WHERE id = ?', [hash, id]);
  }

  updateRole(id, role) {
    if (!['admin', 'viewer'].includes(role)) throw new Error('Invalid role');
    db.run('UPDATE users SET role = ? WHERE id = ?', [role, id]);
  }

  hasUsers() {
    return !!db.get('SELECT 1 FROM users LIMIT 1');
  }

  // ── Auth ─────────────────────────────────────────────────────────────────────

  verifyPassword(username, password) {
    const user = this.getUserByUsername(username);
    if (!user) return null;
    return bcrypt.compareSync(password, user.password) ? user : null;
  }

  signToken(user) {
    return jwt.sign(
      { sub: user.id, username: user.username, role: user.role },
      config.jwtSecret,
      { expiresIn: '24h' }
    );
  }

  verifyToken(token) {
    try {
      return jwt.verify(token, config.jwtSecret);
    } catch {
      return null;
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  _safe(user) {
    const { password: _, ...rest } = user;
    return rest;
  }
}

module.exports = new AuthManager();
