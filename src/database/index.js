'use strict';

const path    = require('path');
const fs      = require('fs');
const SQLite  = require('better-sqlite3');
const config  = require('../config');

const DB_PATH = path.join(config.dataDir, 'loomarc.sqlite');

// Ensure the data directory exists before opening the file
fs.mkdirSync(config.dataDir, { recursive: true });

const db = new SQLite(DB_PATH);

// Load and execute the schema
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// Migrations — add columns introduced after the initial schema without
// dropping existing tables. SQLite errors if the column already exists;
// the try/catch makes each migration idempotent.
for (const sql of [
  'ALTER TABLE networks ADD COLUMN pid INTEGER',
  'ALTER TABLE servers  ADD COLUMN pid INTEGER',
]) {
  try { db.exec(sql); } catch {}
}

// Convenience wrappers that mirror better-sqlite3's synchronous API
// but with cleaner calling conventions used throughout the codebase.
db.get  = (sql, params = []) => db.prepare(sql).get(...params);
db.all  = (sql, params = []) => db.prepare(sql).all(...params);
db.run  = (sql, params = []) => db.prepare(sql).run(...params);

module.exports = db;
