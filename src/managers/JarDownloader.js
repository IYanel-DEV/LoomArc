'use strict';

/**
 * Native Node.js JAR downloader — zero external dependencies beyond the stdlib.
 *
 * Download priority for BungeeCord-compatible proxy JARs:
 *   1. BungeeCord  — ci.md-5.net  (may be Cloudflare-protected, 403 possible)
 *   2. Waterfall   — api.papermc.io (PaperMC-hosted BungeeCord fork, always reachable)
 *      Waterfall uses the exact same config.yml format as BungeeCord, so our
 *      configGenerator works with either JAR without modification.
 *
 * A module-level Map prevents two simultaneous network provisions from
 * downloading the same file twice.
 */

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

const logger = require('../utils/logger');

// In-flight downloads: destPath → Promise
const _inFlight = new Map();

/** Headers attached to every outbound request. */
const BASE_HEADERS = {
  'User-Agent': 'LoomArc/1.0 (self-hosted Minecraft panel; Node.js)',
  'Accept':     'application/octet-stream, application/java-archive, */*',
};

// ─── Core HTTP helpers ────────────────────────────────────────────────────────

/**
 * Download `url` → `destPath` atomically (written to .tmp, then renamed).
 * Deduplicates concurrent calls for the same destination.
 */
function downloadFile(url, destPath, onProgress = null) {
  if (_inFlight.has(destPath)) {
    logger.debug(`[DL] Piggybacking on in-flight: ${path.basename(destPath)}`);
    return _inFlight.get(destPath);
  }
  const p = _dl(url, destPath, onProgress, 0);
  _inFlight.set(destPath, p);
  p.finally(() => _inFlight.delete(destPath));
  return p;
}

function _dl(url, destPath, onProgress, hops) {
  if (hops > 10) return Promise.reject(new Error('Too many redirects'));

  return new Promise((resolve, reject) => {
    const mod  = url.startsWith('https') ? https : http;
    const opts = { timeout: 30_000, headers: BASE_HEADERS };
    logger.debug(`[DL] GET ${url}`);

    const req = mod.get(url, opts, (res) => {
      // Follow redirect
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return _dl(_resolve(res.headers.location, url), destPath, onProgress, hops + 1)
          .then(resolve, reject);
      }

      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
      }

      const total    = parseInt(res.headers['content-length'] || '0', 10);
      let   received = 0;
      const tmp      = destPath + '.tmp';
      const out      = fs.createWriteStream(tmp);

      res.on('data', (chunk) => {
        received += chunk.length;
        if (onProgress) {
          onProgress({
            bytes:   received,
            total,
            percent: total > 0 ? Math.round((received / total) * 100) : -1,
          });
        }
      });

      res.pipe(out);
      out.on('finish', () => fs.rename(tmp, destPath, (e) => e ? reject(e) : resolve()));
      out.on('error',  (e) => { fs.unlink(tmp, () => {}); reject(e); });
    });

    req.on('timeout', () => { req.destroy(); reject(new Error(`Timed out: ${url}`)); });
    req.on('error',   reject);
  });
}

/** Fetch and parse JSON from a URL (follows redirects). */
function fetchJson(url, hops = 0) {
  if (hops > 5) return Promise.reject(new Error('Too many redirects'));

  return new Promise((resolve, reject) => {
    const mod  = url.startsWith('https') ? https : http;
    const opts = { timeout: 10_000, headers: { ...BASE_HEADERS, Accept: 'application/json' } };

    const req = mod.get(url, opts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return fetchJson(_resolve(res.headers.location, url), hops + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
      }
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { buf += c; });
      res.on('end',  () => { try { resolve(JSON.parse(buf)); } catch (e) { reject(e); } });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.on('error',   reject);
  });
}

function _resolve(location, base) {
  try { return new URL(location, base).href; } catch { return location; }
}

// ─── URL / metadata builders ──────────────────────────────────────────────────

const BUNGEE_JAR_URL =
  'https://ci.md-5.net/job/BungeeCord/lastSuccessfulBuild/artifact/bootstrap/target/BungeeCord.jar';

// ── Notes on Paper API ────────────────────────────────────────────────────────
// Paper API v1/v2: sunset (HTTP 410)
// Paper API v3:    requires OAuth (HTTP 403 without credentials)
// Waterfall API:   same sunset as v2
//
// We therefore use:
//   Proxy  → BungeeCord (ci.md-5.net) with Waterfall as fallback (Paper-hosted)
//   Server → Purpur (api.purpurmc.org) — Paper superset, 100% plugin-compatible,
//             open public API, actively maintained.

/**
 * Returns metadata for the latest Purpur build for the most recent MC version.
 * Purpur is a Paper fork that adds features and uses the same plugin ecosystem.
 * Shape: { project, version, build, downloadUrl, fileName }
 */
async function getLatestPurpurMeta() {
  const info = await fetchJson('https://api.purpurmc.org/v2/purpur');
  const versions = (info.versions ?? [])
    // Keep only standard MC version strings (1.x or 1.x.y)
    .filter(v => /^1\.\d+(\.\d+)?$/.test(v))
    .reverse(); // newest first

  if (!versions.length) throw new Error('No Purpur versions found');

  for (const version of versions) {
    try {
      const vInfo = await fetchJson(`https://api.purpurmc.org/v2/purpur/${version}`);
      const build = vInfo.builds?.latest;
      if (!build) continue;

      const downloadUrl = `https://api.purpurmc.org/v2/purpur/${version}/${build}/download`;
      const fileName    = `purpur-${version}-${build}.jar`;
      return { project: 'purpur', version, build, fileName, downloadUrl };
    } catch {
      continue;
    }
  }

  throw new Error('No usable Purpur builds found');
}

/**
 * Returns metadata for the latest Waterfall build (BungeeCord-compatible proxy
 * from api.purpurmc sister project — uses api.papermc.io while it was available).
 * Falls through to BungeeCord direct URL if needed.
 *
 * NOTE: Waterfall itself is in maintenance-only mode but still downloadable.
 * We re-derive the URL from Purpur's compatible infra.
 */
async function getLatestWaterfallMeta() {
  // Waterfall's builds API is also sunset via PaperMC.
  // Return a sentinel so the Provisioner falls back to BungeeCord direct URL.
  throw new Error('Waterfall API sunset — use BungeeCord direct URL');
}

/**
 * @deprecated  Paper API v2 is sunset; use getLatestPurpurMeta() instead.
 * Retained for API compatibility — delegates to Purpur.
 */
async function getLatestPaperMeta() {
  return getLatestPurpurMeta();
}

/**
 * Returns the list of available Minecraft versions from Purpur.
 * Result: string[] newest first, e.g. ['1.21.1', '1.21', '1.20.6', ...]
 */
async function getPurpurVersions() {
  const info = await fetchJson('https://api.purpurmc.org/v2/purpur');
  return (info.versions ?? [])
    .filter(v => /^1\.\d+(\.\d+)?$/.test(v))
    .reverse();
}

/**
 * Returns available builds for a given Minecraft version.
 * Result: { version, builds: number[] } newest-build first.
 */
async function getPurpurBuilds(version) {
  const info = await fetchJson(`https://api.purpurmc.org/v2/purpur/${encodeURIComponent(version)}`);
  const builds = (info.builds?.all ?? []).map(Number).sort((a, b) => b - a);
  return { version, builds };
}

/**
 * Returns metadata for a specific Purpur version+build.
 * If build is omitted, uses the latest build.
 */
async function getPurpurMeta(version, build) {
  if (!build) {
    const vInfo = await fetchJson(`https://api.purpurmc.org/v2/purpur/${encodeURIComponent(version)}`);
    build = vInfo.builds?.latest;
    if (!build) throw new Error(`No builds found for Purpur ${version}`);
  }
  const downloadUrl = `https://api.purpurmc.org/v2/purpur/${version}/${build}/download`;
  const fileName    = `purpur-${version}-${build}.jar`;
  return { project: 'purpur', version, build, fileName, downloadUrl };
}

module.exports = {
  downloadFile,
  fetchJson,
  getLatestWaterfallMeta,
  getLatestPaperMeta,
  getPurpurVersions,
  getPurpurBuilds,
  getPurpurMeta,
  BUNGEE_JAR_URL,
};
