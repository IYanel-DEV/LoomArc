'use strict';

const fs   = require('fs');
const path = require('path');

const fsp = fs.promises;

async function ensureDir(dirPath) {
  await fsp.mkdir(dirPath, { recursive: true });
}

async function writeFile(filePath, content) {
  await ensureDir(path.dirname(filePath));
  await fsp.writeFile(filePath, content, 'utf8');
}

async function readFile(filePath) {
  return fsp.readFile(filePath, 'utf8');
}

async function exists(p) {
  try { await fsp.access(p); return true; } catch { return false; }
}

async function readDir(dirPath) {
  try {
    return await fsp.readdir(dirPath);
  } catch {
    return [];
  }
}

async function remove(p) {
  await fsp.rm(p, { recursive: true, force: true });
}

async function copyFile(src, dest) {
  await ensureDir(path.dirname(dest));
  await fsp.copyFile(src, dest);
}

/** Find the first *.jar in a directory (non-recursive). */
async function findJar(dirPath) {
  const files = await readDir(dirPath);
  return files.find(f => f.toLowerCase().endsWith('.jar')) || null;
}

module.exports = { ensureDir, writeFile, readFile, exists, readDir, remove, copyFile, findJar };
