import { networks, servers, system } from '../api.js';
import { toastSuccess, toastError, toastInfo } from '../components/toast.js';
import { prompt, confirm, showModal } from '../components/modal.js';
import { ConsoleComponent } from '../components/console.js';

const TYPE_ICONS  = { hub:'🏠', survival:'⚔️', bedwars:'🛏️', skywars:'☁️', custom:'⚙️' };
const TYPE_LABELS = { hub:'Hub', survival:'Survival', bedwars:'BedWars', skywars:'SkyWars', custom:'Custom' };

const escHtml = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function statusBadge(s) {
  return `<span class="status-badge status-${s}">${s}</span>`;
}

// Active ConsoleComponent instances — each is destroyed on navigate-away or modal close.
// We track them so unmount() can clean them all up even if a modal was left open.
const _consoles = new Set();

export function unmount() {
  for (const c of _consoles) c.destroy();
  _consoles.clear();
}

export async function renderNetwork(container, networkId) {
  unmount();
  container.innerHTML = `<div class="loading-splash"><div class="spinner"></div></div>`;

  let network;
  try {
    network = await networks.get(networkId);
  } catch (e) {
    container.innerHTML = `<p class="text-muted">Failed to load network: ${e.message}</p>`;
    return;
  }

  render(container, network);
}

function render(container, network) {
  const live = network.liveStatus || network.status;

  container.innerHTML = `
    <div class="page-header">
      <div>
        <a href="#/" style="color:var(--text-muted);font-size:.85rem">← Networks</a>
        <div class="page-title" style="margin-top:6px">${escHtml(network.name)}</div>
        <div class="page-subtitle">BungeeCord proxy · port <span class="chip">${network.bungee_port}</span></div>
      </div>
      <div class="flex gap-2" style="align-items:center">
        ${statusBadge(live)}
        <button class="btn btn-sm btn-ghost" id="btn-rename">Rename</button>
        <button class="btn btn-sm btn-ghost" id="btn-sync-cfg" title="Regenerate BungeeCord config.yml">Sync Config</button>
      </div>
    </div>

    <div class="tabs">
      <button class="tab-btn active" data-tab="servers">Servers</button>
      <button class="tab-btn" data-tab="bungee-console">BungeeCord Console</button>
      <button class="tab-btn" data-tab="bungee-files">Proxy Files</button>
      <button class="tab-btn" data-tab="jars">JAR Manager</button>
    </div>

    <!-- Servers tab -->
    <div data-tab-panel="servers">
      <div class="page-header" style="margin-bottom:14px">
        <div>
          <span class="card-title">Sub-Servers</span>
        </div>
        <div class="flex gap-2">
          <button class="btn btn-sm btn-success" id="btn-start-bungee"
            ${live === 'running' ? 'disabled' : ''}>▶ Start BungeeCord</button>
          <button class="btn btn-sm btn-ghost" id="btn-stop-bungee"
            ${live !== 'running' ? 'disabled' : ''}>■ Stop BungeeCord</button>
          <button class="btn btn-primary btn-sm" id="btn-add-server">+ Add Server</button>
        </div>
      </div>
      <div class="servers-list" id="servers-list"></div>
    </div>

    <!-- BungeeCord console tab -->
    <div data-tab-panel="bungee-console" class="hidden">
      <div class="card-title" style="margin-bottom:10px">BungeeCord Console</div>
      <div id="bungee-console-host"></div>
    </div>

    <!-- BungeeCord file editor tab -->
    <div data-tab-panel="bungee-files" class="hidden">
      <div class="card-title" style="margin-bottom:10px">Proxy Config Files</div>
      <div id="bungee-files-host"></div>
    </div>

    <!-- JAR manager tab -->
    <div data-tab-panel="jars" class="hidden">
      <div class="card-title" style="margin-bottom:10px">JAR Files</div>
      <div id="jar-manager-host"></div>
    </div>
  `;

  // ── Tab switching ────────────────────────────────────────────────────────
  container.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      container.querySelectorAll('[data-tab-panel]').forEach(panel => {
        panel.classList.toggle('hidden', panel.dataset.tabPanel !== tab);
      });
      if (tab === 'bungee-console') initBungeeConsole(network);
      if (tab === 'bungee-files')  initProxyFileManager(network.id);
      if (tab === 'jars')          initJarManager(network, container);
    });
  });

  // ── Actions ──────────────────────────────────────────────────────────────
  document.getElementById('btn-rename').addEventListener('click', () => {
    showRenameModal(network.id, network.name, () => rerenderSilent(container, network.id));
  });

  document.getElementById('btn-sync-cfg').addEventListener('click', async () => {
    try {
      await networks.syncConfig(network.id);
      toastSuccess('BungeeCord config.yml regenerated');
    } catch (e) { toastError(e.message); }
  });

  document.getElementById('btn-start-bungee').addEventListener('click', async () => {
    try {
      await networks.start(network.id);
      toastSuccess('BungeeCord starting…');
      setTimeout(() => rerenderSilent(container, network.id), 1200);
    } catch (e) { toastError(e.message); }
  });

  document.getElementById('btn-stop-bungee').addEventListener('click', async () => {
    try {
      await networks.stop(network.id);
      toastSuccess('BungeeCord stopping…');
      setTimeout(() => rerenderSilent(container, network.id), 1200);
    } catch (e) { toastError(e.message); }
  });

  document.getElementById('btn-add-server').addEventListener('click', () => {
    showAddServerModal(network.id, () => loadServers(network.id));
  });

  loadServers(network.id);
}

async function loadServers(networkId) {
  const list = document.getElementById('servers-list');
  if (!list) return;
  try {
    const network = await networks.get(networkId);
    const srvs    = network.servers || [];
    if (srvs.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <p>No servers yet — add one with the button above.</p>
        </div>`;
      return;
    }
    list.innerHTML = srvs.map(s => serverRow(s)).join('');
    list.querySelectorAll('[data-srv-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleServerAction(btn.dataset.srvAction, btn.dataset.id, networkId, btn.dataset.name || '');
      });
    });
    list.querySelectorAll('.server-card[data-server-id]').forEach(card => {
      card.addEventListener('click', () => {
        showServerConsole(card.dataset.serverId, card.dataset.serverName);
      });
    });
  } catch (e) {
    list.innerHTML = `<p class="text-muted">Error: ${e.message}</p>`;
  }
}

function serverRow(s) {
  const live = s.liveStatus || s.status;
  return `
    <div class="server-card" data-server-id="${s.id}" data-server-name="${escHtml(s.name)}" style="cursor:pointer">
      <div class="server-type-icon type-${s.type}">${TYPE_ICONS[s.type] || '⚙️'}</div>
      <div class="server-info">
        <div class="server-name">${escHtml(s.name)}</div>
        <div class="server-sub">${TYPE_LABELS[s.type] || s.type} · :${s.port} · ${s.memory_mb}MB</div>
      </div>
      <div class="server-actions">
        <span class="status-badge status-${live}" style="margin-right:4px">${live}</span>
        <button class="btn btn-sm btn-success" data-srv-action="start" data-id="${s.id}"
          ${live === 'running' ? 'disabled' : ''}>▶</button>
        <button class="btn btn-sm btn-ghost" data-srv-action="stop" data-id="${s.id}"
          ${live !== 'running' ? 'disabled' : ''}>■</button>
        <button class="btn btn-sm btn-ghost" data-srv-action="edit-files" data-id="${s.id}" data-name="${escHtml(s.name)}" title="Edit Config Files">📝</button>
        <button class="btn btn-sm btn-ghost" data-srv-action="upload-jar" data-id="${s.id}" title="Upload JAR">📦</button>
        <button class="btn btn-sm btn-danger" data-srv-action="delete" data-id="${s.id}">✕</button>
      </div>
    </div>`;
}

async function handleServerAction(action, id, networkId, name = '') {
  try {
    switch (action) {
      case 'start':
        await servers.start(id);
        toastSuccess('Server starting…');
        setTimeout(() => loadServers(networkId), 1000);
        break;
      case 'stop':
        await servers.stop(id);
        toastSuccess('Server stopping…');
        setTimeout(() => loadServers(networkId), 1000);
        break;
      case 'edit-files':
        showFileManagerModal(id, name);
        break;
      case 'upload-jar':
        showJarUploadModal(id, null, () => toastSuccess('JAR uploaded'));
        break;
      case 'delete':
        confirm('Delete this server and all its data?', async () => {
          try {
            await servers.delete(id);
            toastSuccess('Server deleted');
            loadServers(networkId);
          } catch (e) { toastError(e.message); }
        }, { danger: true });
        break;
    }
  } catch (e) {
    toastError(e.message);
  }
}

function showServerConsole(serverId, serverName) {
  const host = document.createElement('div');
  const con  = new ConsoleComponent(host, serverId);
  _consoles.add(con);

  const destroyOnce = (() => {
    let done = false;
    return () => { if (!done) { done = true; con.destroy(); _consoles.delete(con); } };
  })();

  showModal({
    heading: `Console — ${serverName}`,
    content: host,
    buttons: [{ label: 'Close', cls: 'btn-ghost', onClick: (close) => { destroyOnce(); close(); } }],
    onClose: destroyOnce,
  });
  const box = document.getElementById('modal-box');
  if (box) { box.style.maxWidth = '800px'; box.style.width = '96vw'; }
}

function initBungeeConsole(network) {
  const host = document.getElementById('bungee-console-host');
  if (!host || host.dataset.mounted) return; // already mounted in this render
  host.dataset.mounted = '1';
  const con = new ConsoleComponent(host, `bungee-${network.id}`);
  _consoles.add(con);
}

async function initJarManager(network, container) {
  const host = document.getElementById('jar-manager-host');
  if (!host) return;

  try {
    const jars = await system.jars.list();
    const bungeeJars  = jars.filter(j => j.kind === 'bungee');
    const spigotJars  = jars.filter(j => j.kind === 'spigot');

    host.innerHTML = `
      <p class="text-muted text-sm" style="margin-bottom:16px">
        Upload JARs here to store them globally, then link them to any network or server.
      </p>
      <div class="flex gap-2" style="margin-bottom:16px">
        <button class="btn btn-ghost btn-sm" id="jar-upload-bungee">📦 Upload BungeeCord JAR</button>
        <button class="btn btn-ghost btn-sm" id="jar-upload-spigot">📦 Upload Spigot/Paper JAR</button>
      </div>

      <div class="card-title">BungeeCord JARs</div>
      <div style="margin-bottom:16px">${jarTable(bungeeJars, network.id, null)}</div>

      <div class="card-title">Spigot / Paper JARs</div>
      ${jarTable(spigotJars, null, network)}
    `;

    host.querySelector('#jar-upload-bungee').addEventListener('click', () =>
      showJarUploadModal(null, 'bungee', () => initJarManager(network, container))
    );
    host.querySelector('#jar-upload-spigot').addEventListener('click', () =>
      showJarUploadModal(null, 'spigot', () => initJarManager(network, container))
    );

    host.querySelectorAll('[data-jar-action]').forEach(btn => {
      btn.addEventListener('click', () => handleJarAction(btn.dataset.jarAction, btn.dataset.id, btn.dataset.extra, network));
    });
  } catch (e) {
    host.innerHTML = `<p class="text-muted">Error: ${e.message}</p>`;
  }
}

function jarTable(jars, networkId, network) {
  if (!jars.length) return `<p class="text-muted text-sm">No JARs cached yet.</p>`;
  return `<div class="servers-list">${jars.map(j => `
    <div class="server-card" style="cursor:default">
      <div class="server-info">
        <div class="server-name text-mono" style="font-size:.85rem">${escHtml(j.file_name)}</div>
        <div class="server-sub">${j.mc_version}</div>
      </div>
      <div class="server-actions">
        ${networkId ? `<button class="btn btn-sm btn-ghost" data-jar-action="link-network" data-id="${j.id}" data-extra="${networkId}">→ Network</button>` : ''}
        ${network   ? `<button class="btn btn-sm btn-ghost" data-jar-action="link-pick-server" data-id="${j.id}" data-extra="${JSON.stringify(network.servers||[]).replace(/"/g,'&quot;')}">→ Server</button>` : ''}
      </div>
    </div>`).join('')}</div>`;
}

async function handleJarAction(action, jarId, extra, network) {
  try {
    if (action === 'link-network') {
      await system.jars.linkToNetwork(jarId, extra);
      toastSuccess('JAR linked to BungeeCord directory');
    }
    if (action === 'link-pick-server') {
      const srvs = network.servers || [];
      if (!srvs.length) { toastError('No servers in this network yet'); return; }
      showModal({
        heading: 'Pick a server',
        content: `<div class="servers-list">${srvs.map(s =>
          `<div class="server-card" style="cursor:pointer" data-pick-id="${s.id}">
            <div class="server-info"><div class="server-name">${escHtml(s.name)}</div></div>
          </div>`).join('')}</div>`,
        buttons: [{ label: 'Cancel', cls: 'btn-ghost', onClick: c => c() }],
      });
      document.querySelectorAll('[data-pick-id]').forEach(el => {
        el.addEventListener('click', async () => {
          document.getElementById('modal-overlay')?.classList.add('hidden');
          await system.jars.linkToServer(jarId, el.dataset.pickId);
          toastSuccess('JAR linked to server');
        });
      });
    }
  } catch (e) {
    toastError(e.message);
  }
}

function showJarUploadModal(serverId, kind, onDone) {
  const form = document.createElement('form');
  form.innerHTML = `
    <div class="form-group">
      <label class="form-label">JAR file</label>
      <input class="form-input" type="file" name="jar" accept=".jar" required style="padding:6px" />
    </div>
    ${!kind ? `
    <div class="form-group">
      <label class="form-label">Kind</label>
      <select class="form-select" name="kind">
        <option value="spigot">Spigot / Paper</option>
        <option value="bungee">BungeeCord</option>
      </select>
    </div>` : `<input type="hidden" name="kind" value="${kind}" />`}
    <div class="form-group">
      <label class="form-label">Minecraft version</label>
      <input class="form-input" type="text" name="mc_version" placeholder="1.20.4" />
    </div>
  `;
  showModal({
    heading: 'Upload JAR',
    content: form,
    buttons: [
      { label: 'Cancel', cls: 'btn-ghost', onClick: c => c() },
      { label: 'Upload', cls: 'btn-primary', onClick: async (close) => {
        const fd = new FormData(form);
        if (!fd.get('jar').name) { toastError('Select a JAR file'); return; }
        const url = serverId
          ? `/api/servers/${serverId}/upload-jar`
          : '/api/system/jars/upload';
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'x-api-key': (await import('../api.js')).getApiKey() },
            body: fd,
          });
          if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
          toastSuccess('JAR uploaded');
          close();
          if (onDone) onDone();
        } catch (e) { toastError(e.message); }
      }},
    ],
  });
}

function showAddServerModal(networkId, onDone) {
  prompt('Add Server', [
    { name: 'name', label: 'Server name', placeholder: 'hub', required: true,
      hint: 'This name is used in BungeeCord routing.' },
    { name: 'type', label: 'Type', type: 'select',
      options: ['hub','survival','bedwars','skywars','custom'].map(t => ({ value: t, label: TYPE_LABELS[t] })) },
    { name: 'memory_mb', label: 'Memory (MB)', type: 'number', default: '1024',
      hint: '512–8192 recommended' },
  ], async (data, close) => {
    try {
      await servers.create({
        network_id: networkId,
        name:       data.name,
        type:       data.type,
        memory_mb:  parseInt(data.memory_mb) || 1024,
      });
      toastSuccess(`Server "${data.name}" created`);
      close();
      onDone();
    } catch (e) { toastError(e.message); }
  });
}

function showRenameModal(networkId, currentName, onDone) {
  prompt('Rename Network', [
    { name: 'name', label: 'New name', default: currentName, required: true },
  ], async (data, close) => {
    try {
      await networks.rename(networkId, data.name);
      toastSuccess('Network renamed');
      close();
      onDone();
    } catch (e) { toastError(e.message); }
  });
}

async function rerenderSilent(container, networkId) {
  try {
    const network = await networks.get(networkId);
    render(container, network);
  } catch {}
}

// ─── Pterodactyl-style File Manager ──────────────────────────────────────────

function showFileManagerModal(serverId, serverName) {
  const host = document.createElement('div');
  host.style.minHeight = '480px';

  showModal({
    heading: `Files — ${serverName}`,
    content: host,
    buttons: [{ label: 'Close', cls: 'btn-ghost', onClick: c => c() }],
  });
  const box = document.getElementById('modal-box');
  if (box) { box.style.maxWidth = '920px'; box.style.width = '96vw'; }

  initFileManager(host, {
    list:   p          => servers.fs.list(serverId, p),
    read:   p          => servers.fs.read(serverId, p),
    write:  (p, c)     => servers.fs.write(serverId, p, c),
    mkdir:  p          => servers.fs.mkdir(serverId, p),
    remove: p          => servers.fs.remove(serverId, p),
    rename: (from, to) => servers.fs.rename(serverId, from, to),
  });
}

async function initProxyFileManager(networkId) {
  const host = document.getElementById('bungee-files-host');
  if (!host || host.dataset.loaded) return;
  host.dataset.loaded = '1';

  await initFileManager(host, {
    list:   p          => networks.fs.list(networkId, p),
    read:   p          => networks.fs.read(networkId, p),
    write:  (p, c)     => networks.fs.write(networkId, p, c),
    mkdir:  p          => networks.fs.mkdir(networkId, p),
    remove: p          => networks.fs.remove(networkId, p),
    rename: (from, to) => networks.fs.rename(networkId, from, to),
  });
}

async function initFileManager(host, apiFns) {
  let curPath  = '';
  let editFile = null;

  host.innerHTML = `
    <div class="fm">
      <div class="fm-toolbar">
        <nav class="fm-breadcrumb"></nav>
        <div class="flex gap-1">
          <button class="btn btn-sm btn-ghost fm-new-file">+ File</button>
          <button class="btn btn-sm btn-ghost fm-new-dir">+ Folder</button>
        </div>
      </div>
      <div class="fm-list-area"></div>
      <div class="fm-editor-area hidden">
        <div class="fm-editor-bar">
          <button class="btn btn-sm btn-ghost fm-back">← Files</button>
          <span class="fm-editor-name text-mono"></span>
          <button class="btn btn-sm btn-primary fm-save">Save</button>
        </div>
        <textarea class="form-input fm-textarea" spellcheck="false"></textarea>
      </div>
    </div>
  `;

  const $ = s => host.querySelector(s);
  const listArea   = $('.fm-list-area');
  const editorArea = $('.fm-editor-area');
  const textarea   = $('.fm-textarea');

  const showList   = () => { listArea.classList.remove('hidden');  editorArea.classList.add('hidden'); };
  const showEditor = () => { listArea.classList.add('hidden');     editorArea.classList.remove('hidden'); };

  function renderBreadcrumb() {
    const bc    = $('.fm-breadcrumb');
    const parts = curPath ? curPath.split('/') : [];
    const crumbs = [{ label: 'root', path: '' }];
    parts.forEach((p, i) => crumbs.push({ label: p, path: parts.slice(0, i + 1).join('/') }));
    bc.innerHTML = crumbs.map((c, i) => {
      const isLast = i === crumbs.length - 1;
      return (i > 0 ? '<span class="fm-sep">/</span>' : '') +
        `<span class="fm-crumb ${isLast ? 'fm-crumb-cur' : 'fm-crumb-link'}" data-nav="${escHtml(c.path)}">${escHtml(c.label)}</span>`;
    }).join('');
    bc.querySelectorAll('.fm-crumb-link').forEach(el =>
      el.addEventListener('click', () => navigate(el.dataset.nav))
    );
  }

  async function navigate(p) {
    curPath  = p;
    editFile = null;
    showList();
    await loadDir();
  }

  async function loadDir() {
    renderBreadcrumb();
    listArea.innerHTML = `<div class="loading-splash" style="height:80px"><div class="spinner"></div></div>`;
    try {
      const { entries } = await apiFns.list(curPath);
      if (!entries || entries.length === 0) {
        listArea.innerHTML = `<div class="fm-empty text-muted">This folder is empty.</div>`;
        return;
      }
      renderEntries(entries);
    } catch (e) {
      listArea.innerHTML = `<p class="text-muted">Error: ${escHtml(e.message)}</p>`;
    }
  }

  function renderEntries(entries) {
    listArea.innerHTML = `<div class="fm-list">${entries.map(e => {
      const icon  = e.type === 'dir' ? '📁' : fmFileIcon(e.name);
      const canEdit = e.type === 'file' && fmIsText(e.name);
      return `
        <div class="fm-entry" data-type="${e.type}" data-name="${escHtml(e.name)}" data-path="${escHtml(e.path)}">
          <span class="fm-icon">${icon}</span>
          <span class="fm-name">${escHtml(e.name)}</span>
          ${e.type === 'file' ? `<span class="fm-size">${fmFmtSize(e.size)}</span>` : ''}
          <div class="fm-row-actions">
            ${canEdit ? `<button class="btn btn-xs btn-ghost" data-act="edit">Edit</button>` : ''}
            <button class="btn btn-xs btn-ghost" data-act="rename">Rename</button>
            <button class="btn btn-xs btn-danger" data-act="del">✕</button>
          </div>
        </div>`;
    }).join('')}</div>`;

    listArea.querySelectorAll('.fm-entry').forEach(row => {
      const { type, name } = row.dataset;
      const entryPath = row.dataset.path;

      row.querySelector('.fm-name')?.addEventListener('click', () => {
        if (type === 'dir') navigate(entryPath);
        else if (fmIsText(name)) openEditor(entryPath);
      });
      row.querySelectorAll('[data-act]').forEach(btn => {
        btn.addEventListener('click', ev => {
          ev.stopPropagation();
          const act = btn.dataset.act;
          if (act === 'edit')   openEditor(entryPath);
          if (act === 'rename') doRename(entryPath, name);
          if (act === 'del')    doDelete(entryPath, type, name);
        });
      });
    });
  }

  async function openEditor(filePath) {
    editFile = filePath;
    $('.fm-editor-name').textContent = filePath.split('/').pop();
    textarea.value    = 'Loading…';
    textarea.disabled = true;
    showEditor();
    try {
      const { content } = await apiFns.read(filePath);
      textarea.value    = content;
      textarea.disabled = false;
      textarea.focus();
    } catch (e) {
      textarea.value    = `Error: ${e.message}`;
      textarea.disabled = false;
      editFile = null;
    }
  }

  function doRename(filePath, oldName) {
    prompt('Rename', [
      { name: 'name', label: 'New name', default: oldName, required: true },
    ], async (data, close) => {
      try {
        const dir     = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : '';
        const newPath = dir ? `${dir}/${data.name}` : data.name;
        await apiFns.rename(filePath, newPath);
        toastSuccess('Renamed');
        close();
        await loadDir();
      } catch (e) { toastError(e.message); }
    });
  }

  function doDelete(filePath, type, name) {
    confirm(
      `Delete ${type === 'dir' ? 'folder' : 'file'} "${name}"? This cannot be undone.`,
      async () => {
        try {
          await apiFns.remove(filePath);
          toastSuccess(`"${name}" deleted`);
          await loadDir();
        } catch (e) { toastError(e.message); }
      },
      { danger: true }
    );
  }

  $('.fm-back').addEventListener('click', () => { editFile = null; showList(); loadDir(); });

  $('.fm-save').addEventListener('click', async () => {
    if (!editFile) { toastError('No file open'); return; }
    try {
      await apiFns.write(editFile, textarea.value);
      toastSuccess(`Saved: ${editFile.split('/').pop()}`);
    } catch (e) { toastError(e.message); }
  });

  $('.fm-new-file').addEventListener('click', () => {
    prompt('New File', [
      { name: 'name', label: 'File name', placeholder: 'config.yml', required: true },
    ], async (data, close) => {
      try {
        const newPath = curPath ? `${curPath}/${data.name}` : data.name;
        await apiFns.write(newPath, '');
        toastSuccess(`"${data.name}" created`);
        close();
        await loadDir();
      } catch (e) { toastError(e.message); }
    });
  });

  $('.fm-new-dir').addEventListener('click', () => {
    prompt('New Folder', [
      { name: 'name', label: 'Folder name', placeholder: 'myfolder', required: true },
    ], async (data, close) => {
      try {
        const newPath = curPath ? `${curPath}/${data.name}` : data.name;
        await apiFns.mkdir(newPath);
        toastSuccess(`Folder "${data.name}" created`);
        close();
        await loadDir();
      } catch (e) { toastError(e.message); }
    });
  });

  await navigate('');
}

function fmFileIcon(name) {
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : '';
  if (['.yml', '.yaml'].includes(ext))         return '⚙️';
  if (['.json'].includes(ext))                 return '{}';
  if (['.properties'].includes(ext))           return '📋';
  if (['.txt', '.md'].includes(ext))           return '📝';
  if (['.log'].includes(ext))                  return '📃';
  if (['.jar'].includes(ext))                  return '📦';
  if (['.sh', '.bat', '.cmd'].includes(ext))   return '💻';
  return '📄';
}

function fmIsText(name) {
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : '';
  return new Set([
    '.properties', '.yml', '.yaml', '.json', '.txt', '.conf', '.cfg',
    '.ini', '.xml', '.log', '.sh', '.bat', '.cmd', '.md', '.html',
    '.css', '.js', '.ts', '.toml', '.env', '.htaccess',
  ]).has(ext) || !ext;
}

function fmFmtSize(bytes) {
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
  if (bytes >= 1e3) return (bytes / 1e3).toFixed(0) + ' KB';
  return bytes + ' B';
}
