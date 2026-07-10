/**
 * LoomArc SPA — hash-based router + JWT auth flow
 */

import { initApi, getSession, isAdmin } from './api.js';
import wsClient                          from './ws.js';
import { renderDashboard }               from './pages/dashboard.js';
import { renderNetwork, unmount as unmountNetwork } from './pages/network.js';
import { renderPlugins }                 from './pages/plugins.js';
import { renderSystem }                  from './pages/system.js';
import { renderLogin }                   from './pages/login.js';
import { toastError, toastSuccess }      from './components/toast.js';
import { confirm, showModal }            from './components/modal.js';
import { auth }                          from './api.js';

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

// ── User menu ─────────────────────────────────────────────────────────────────

function initUserMenu() {
  const session = getSession();
  if (!session) return;

  const footer = document.querySelector('.sidebar-footer');
  if (!footer) return;

  // Remove old user chip if re-initialising
  footer.querySelector('.user-chip')?.remove();

  const chip = document.createElement('div');
  chip.className = 'user-chip';
  chip.innerHTML = `
    <span class="user-chip-name" title="${session.username}">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
        <circle cx="12" cy="7" r="4"/>
      </svg>
      ${session.username}
    </span>
    <span class="role-badge role-${session.role}">${session.role}</span>
    <button class="btn btn-xs btn-ghost" id="btn-logout" title="Sign out">↩</button>
  `;
  footer.insertBefore(chip, footer.firstChild);

  chip.querySelector('#btn-logout').addEventListener('click', () => {
    confirm('Sign out?', () => {
      localStorage.removeItem('loomarc-jwt');
      location.reload();
    });
  });

  // Admin: add user management button if admin
  if (isAdmin()) {
    const usersBtn = document.createElement('button');
    usersBtn.className = 'btn btn-xs btn-ghost user-mgmt-btn';
    usersBtn.textContent = 'Users';
    usersBtn.title = 'Manage users';
    usersBtn.addEventListener('click', showUserManager);
    chip.appendChild(usersBtn);
  }
}

function showUserManager() {
  const host = document.createElement('div');
  host.innerHTML = `<div class="loading-splash" style="height:80px"><div class="spinner"></div></div>`;

  showModal({
    heading: 'User Management',
    content: host,
    buttons: [{ label: 'Close', cls: 'btn-ghost', onClick: c => c() }],
  });
  loadUserList(host);
}

async function loadUserList(host) {
  try {
    const users = await auth.users.list();
    const session = getSession();

    host.innerHTML = `
      <div style="margin-bottom:14px">
        <button class="btn btn-sm btn-primary" id="um-add">+ Add user</button>
      </div>
      <div class="servers-list">
        ${users.map(u => `
          <div class="server-card" style="cursor:default">
            <div class="server-info">
              <div class="server-name">${u.username}</div>
              <div class="server-sub">${u.role}</div>
            </div>
            <div class="server-actions">
              <select class="form-select" style="height:28px;font-size:.78rem;padding:2px 6px" data-uid="${u.id}" data-role-sel>
                <option value="admin"  ${u.role==='admin'  ?'selected':''}>Admin</option>
                <option value="viewer" ${u.role==='viewer' ?'selected':''}>Viewer</option>
              </select>
              ${u.id !== session.id ? `<button class="btn btn-sm btn-danger" data-del-uid="${u.id}">✕</button>` : ''}
            </div>
          </div>`).join('')}
      </div>
    `;

    host.querySelector('#um-add')?.addEventListener('click', () => showAddUserModal(host));

    host.querySelectorAll('[data-role-sel]').forEach(sel => {
      sel.addEventListener('change', async () => {
        try {
          await auth.users.update(sel.dataset.uid, { role: sel.value });
          toastSuccess('Role updated');
        } catch (e) { toastError(e.message); loadUserList(host); }
      });
    });

    host.querySelectorAll('[data-del-uid]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await auth.users.delete(btn.dataset.delUid);
          toastSuccess('User deleted');
          loadUserList(host);
        } catch (e) { toastError(e.message); }
      });
    });
  } catch (e) {
    host.innerHTML = `<p class="text-muted">Error: ${e.message}</p>`;
  }
}

function showAddUserModal(host) {
  import('./components/modal.js').then(({ prompt }) => {
    prompt('Add User', [
      { name: 'username', label: 'Username', required: true },
      { name: 'password', label: 'Password', type: 'password', required: true },
      { name: 'role', label: 'Role', type: 'select',
        options: [{ value: 'viewer', label: 'Viewer' }, { value: 'admin', label: 'Admin' }] },
    ], async (data, close) => {
      try {
        await auth.users.create(data);
        toastSuccess(`User "${data.username}" created`);
        close();
        loadUserList(host);
      } catch (e) { toastError(e.message); }
    });
  });
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function boot() {
  initTheme();

  const storedToken = localStorage.getItem('loomarc-jwt');

  const sidebar = document.getElementById('sidebar');

  const onLogin = async (result) => {
    sidebar.style.display = '';
    await continueBootWith(result.token);
  };

  if (!storedToken) {
    sidebar.style.display = 'none';
    renderLogin(container, onLogin);
    return;
  }

  // Validate stored token
  try {
    await initApi(storedToken);
  } catch {
    localStorage.removeItem('loomarc-jwt');
    sidebar.style.display = 'none';
    renderLogin(container, onLogin);
    return;
  }

  await finishBoot();
}

async function continueBootWith(token) {
  try {
    await initApi(token);
    await finishBoot();
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><p style="color:var(--red)">${e.message}</p></div>`;
  }
}

async function finishBoot() {
  initUserMenu();

  // Show version
  try {
    const { system } = await import('./api.js');
    const status = await system.status();
    const badge = document.getElementById('panel-version');
    if (badge) badge.textContent = `v${status.version}`;
  } catch {}

  // Connect WebSocket
  wsClient.connect();

  // Restore nav links for authenticated state
  document.querySelectorAll('.nav-link').forEach(link => {
    link.style.display = '';
  });

  // Initial route + listen for changes
  await navigate();
  window.addEventListener('hashchange', navigate);
}

boot();
