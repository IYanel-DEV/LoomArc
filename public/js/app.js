/**
 * LoomArc SPA — hash-based router
 */

import { initApi }           from './api.js';
import wsClient              from './ws.js';
import { renderDashboard }   from './pages/dashboard.js';
import { renderNetwork, unmount as unmountNetwork } from './pages/network.js';
import { renderPlugins }     from './pages/plugins.js';
import { renderSystem }      from './pages/system.js';
import { toastError }        from './components/toast.js';

const container = document.getElementById('page-container');
const navLinks  = document.querySelectorAll('.nav-link');

// ── Routing ───────────────────────────────────────────────────────────────────

const routes = [
  { pattern: /^#?\/?$/,                page: 'dashboard',  handler: () => renderDashboard(container) },
  { pattern: /^#\/network\/([^/]+)$/,  page: 'network',    handler: (m) => renderNetwork(container, m[1]) },
  { pattern: /^#\/plugins\/?$/,        page: 'plugins',    handler: () => renderPlugins(container) },
  { pattern: /^#\/system\/?$/,         page: 'system',     handler: () => renderSystem(container) },
];

let _currentPage = null;

async function navigate() {
  const hash = location.hash || '#/';

  // Clean up previous page
  if (_currentPage === 'network') unmountNetwork();

  let matched = false;
  for (const route of routes) {
    const m = hash.match(route.pattern);
    if (m) {
      _currentPage = route.page;
      setActiveNav(route.page);
      container.innerHTML = `<div class="loading-splash"><div class="spinner"></div></div>`;
      try {
        await route.handler(m);
      } catch (e) {
        container.innerHTML = `<p class="text-muted" style="padding:40px">Error: ${e.message}</p>`;
        toastError(e.message);
        console.error(e);
      }
      matched = true;
      break;
    }
  }

  if (!matched) {
    container.innerHTML = `<div class="empty-state"><p>404 — Page not found.</p></div>`;
  }
}

function setActiveNav(page) {
  navLinks.forEach(link => {
    link.classList.toggle('active', link.dataset.page === page);
  });
}

// ── Theme toggle ──────────────────────────────────────────────────────────────

function initTheme() {
  const stored = localStorage.getItem('loomarc-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = stored || (prefersDark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
  const cb = document.getElementById('theme-checkbox');
  if (cb) {
    cb.checked = theme === 'light';
    cb.addEventListener('change', () => {
      const t = cb.checked ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', t);
      localStorage.setItem('loomarc-theme', t);
    });
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function boot() {
  initTheme();

  try {
    await initApi();
  } catch (e) {
    container.innerHTML = `
      <div class="empty-state" style="padding-top:80px">
        <p style="color:var(--red)">Cannot reach panel API.<br>Make sure <code>npm start</code> is running.</p>
      </div>`;
    return;
  }

  // Show version
  try {
    const { system } = await import('./api.js');
    const status = await system.status();
    const badge  = document.getElementById('panel-version');
    if (badge) badge.textContent = `v${status.version}`;
  } catch {}

  // Connect WebSocket
  wsClient.connect();

  // Initial route + listen for changes
  await navigate();
  window.addEventListener('hashchange', navigate);
}

boot();
