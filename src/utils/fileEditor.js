'use strict';

const fs   = require('fs');
const path = require('path');
const fsu  = require('./fileSystem');

const EDITABLE_EXTS  = new Set(['.properties', '.yml', '.yaml', '.json', '.txt', '.conf']);
const MAX_FILE_BYTES = 512 * 1024;  // 512 KB  — legacy file-picker limit
const MAX_READ_BYTES = 2 * 1024 * 1024; // 2 MB  — full file-manager read limit

/**
 * Resolve and validate a user-supplied relative path against a trusted base dir.
 * Throws on path traversal or disallowed extension (legacy file-editor guard).
 * @returns {string} Absolute path
 */
function safeFilePath(baseDir, relPath) {
  const abs = path.resolve(baseDir, relPath);
  if (!abs.startsWith(baseDir + path.sep) && abs !== baseDir) {
    throw new Error('Path traversal not allowed');
  }
  if (!EDITABLE_EXTS.has(path.extname(abs).toLowerCase())) {
    throw new Error('File type not editable');
  }
  return abs;
}

/**
 * Path-traversal guard with NO extension check — for the full file manager.
 * @returns {string} Absolute path
 */
function safePath(baseDir, relPath) {
  const abs = path.resolve(baseDir, relPath || '.');
  if (abs !== baseDir && !abs.startsWith(baseDir + path.sep)) {
    throw new Error('Path traversal not allowed');
  }
  return abs;
}

/**
 * List editable config files under baseDir (max 1 sub-directory deep).
 * @returns {Promise<Array<{path:string, size:number}>>} Paths use forward slashes.
 */
async function listEditableFiles(baseDir) {
  const results = [];

  const scan = async (dir, depth) => {
    if (depth > 1) return;
    for (const entry of await fsu.readDir(dir)) {
      if (entry.startsWith('.')) continue;
      const abs = path.join(dir, entry);
      let stat;
      try { stat = fs.statSync(abs); } catch { continue; }
      const rel = path.relative(baseDir, abs).replace(/\\/g, '/');
      if (stat.isFile() && EDITABLE_EXTS.has(path.extname(entry).toLowerCase()) && stat.size <= MAX_FILE_BYTES) {
        results.push({ path: rel, size: stat.size });
      } else if (stat.isDirectory()) {
        await scan(abs, depth + 1);
      }
    }
  };

  await scan(baseDir, 0);
  return results;
}

/**
 * List the direct contents of one directory (non-recursive).
 * Hidden entries (starting with '.') are excluded.
 * Result is sorted: directories first, then files, both alphabetically.
 * @returns {Promise<Array<{name:string, type:'file'|'dir', size:number, path:string}>>}
 */
async function listDir(baseDir, relPath) {
  const abs   = safePath(baseDir, relPath);
  const names = await fsu.readDir(abs);
  const results = [];

  for (const name of names) {
    if (name.startsWith('.')) continue;
    const entryAbs = path.join(abs, name);
    let stat;
    try { stat = fs.statSync(entryAbs); } catch { continue; }
    const relEntry = relPath ? `${relPath}/${name}` : name;
    results.push(
      stat.isDirectory()
        ? { name, type: 'dir',  size: 0,          path: relEntry }
        : { name, type: 'file', size: stat.size,  path: relEntry }
    );
  }

  results.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  return results;
}

module.exports = { safeFilePath, safePath, listEditableFiles, listDir, MAX_READ_BYTES };
