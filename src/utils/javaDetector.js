'use strict';

const fs       = require('fs');
const path     = require('path');
const { spawnSync } = require('child_process');

function getVersion(javaBin) {
  try {
    const r = spawnSync(javaBin, ['-version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000,
    });
    // java -version prints to stderr
    return (r.stderr || r.stdout || '').split('\n')[0].trim();
  } catch {
    return null;
  }
}

function detectAll() {
  const seen      = new Set();
  const results   = [];

  const tryBin = (bin) => {
    if (seen.has(bin)) return;
    seen.add(bin);
    if (!fs.existsSync(bin)) return;
    const version = getVersion(bin);
    if (version) results.push({ bin, version });
  };

  // 1. JAVA_HOME
  if (process.env.JAVA_HOME) {
    tryBin(path.join(process.env.JAVA_HOME, 'bin', javaBinName()));
  }

  // 2. PATH lookup
  try {
    const { execSync } = require('child_process');
    const which = process.platform === 'win32' ? 'where' : 'which';
    const out   = execSync(`${which} java`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    out.split('\n').map(s => s.trim()).filter(Boolean).forEach(tryBin);
  } catch {}

  // 3. Common Windows locations
  if (process.platform === 'win32') {
    const roots = [
      'C:\\Program Files\\Java',
      'C:\\Program Files\\Eclipse Adoptium',
      'C:\\Program Files\\Microsoft',
      'C:\\Program Files\\Zulu',
    ];
    for (const root of roots) {
      if (!fs.existsSync(root)) continue;
      for (const sub of fs.readdirSync(root)) {
        tryBin(path.join(root, sub, 'bin', 'java.exe'));
      }
    }
  }

  return results;
}

function javaBinName() {
  return process.platform === 'win32' ? 'java.exe' : 'java';
}

module.exports = { detectAll, getVersion };
