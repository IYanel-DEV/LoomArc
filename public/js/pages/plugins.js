import { plugins, networks, servers } from '../api.js';
import { toastSuccess, toastError } from '../components/toast.js';
import { showModal } from '../components/modal.js';

const escHtml = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

export async function renderPlugins(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Plugin Browser</div>
        <div class="page-subtitle">Search SpigotMC and install plugins directly into your servers</div>
      </div>
    </div>

    <div class="search-bar">
      <input class="form-input" id="plugin-search-input" type="text"
        placeholder="Search for plugins… (e.g. EssentialsX, WorldEdit, Vault)" />
      <select class="form-select" id="sort-select" style="width:auto;min-width:160px">
        <option value="-downloads">Most Downloaded</option>
        <option value="-rating">Top Rated</option>
        <option value="-updateDate">Recently Updated</option>
        <option value="name">Name A→Z</option>
      </select>
      <button class="btn btn-primary" id="plugin-search-btn">Search</button>
    </div>

    <div id="plugin-results"></div>
  `;

  const input = document.getElementById('plugin-search-input');
  const btn   = document.getElementById('plugin-search-btn');
  const sort  = document.getElementById('sort-select');

  let debounce;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSearch();
  });
  btn.addEventListener('click', doSearch);

  async function doSearch() {
    const q = input.value.trim();
    if (!q) return;
    await renderResults(q, sort.value);
  }

  // Load popular plugins on mount
  await renderResults('essentials', '-downloads');
}

async function renderResults(q, sortVal) {
  const resultsEl = document.getElementById('plugin-results');
  resultsEl.innerHTML = `<div class="loading-splash" style="height:200px"><div class="spinner"></div></div>`;

  try {
    const data = await plugins.search(q, { size: 20, sort: sortVal });
    if (!data || data.length === 0) {
      resultsEl.innerHTML = `<div class="empty-state"><p>No plugins found for "${q}".</p></div>`;
      return;
    }
    resultsEl.innerHTML = `<div class="plugin-grid">${data.map(pluginCard).join('')}</div>`;
    resultsEl.querySelectorAll('[data-install-id]').forEach(btn => {
      btn.addEventListener('click', () => showInstallModal(
        parseInt(btn.dataset.installId),
        btn.dataset.installName,
        btn.dataset.installExternal === 'true'
      ));
    });
  } catch (e) {
    resultsEl.innerHTML = `<p class="text-muted">Search failed: ${e.message}</p>`;
  }
}

function pluginCard(p) {
  const downloads = p.downloads?.toLocaleString() ?? '?';
  const rating    = p.rating?.average?.toFixed(1) ?? '?';
  const version   = p.version?.id ?? '?';
  const isExt     = p.external || p.file?.type === 'external';
  const iconUrl   = `https://api.spiget.org/v2/resources/${p.id}/icon`;

  return `
    <div class="plugin-card">
      <div class="plugin-card-header">
        <img class="plugin-icon" src="${iconUrl}" alt=""
             loading="lazy" onerror="this.style.display='none'" />
        <div class="plugin-card-name">${escHtml(p.name)}</div>
      </div>
      <div class="plugin-card-tag">${escHtml((p.tag || '').slice(0, 120))}</div>
      <div class="plugin-card-meta">
        <span>⬇ ${downloads}</span>
        <span>★ ${rating}</span>
        <span class="chip">v${escHtml(String(version))}</span>
        ${isExt ? `<span style="color:var(--yellow)">external</span>` : ''}
      </div>
      <div class="plugin-card-footer">
        <button class="btn btn-sm btn-primary"
          data-install-id="${p.id}"
          data-install-name="${escHtml(p.name)}"
          data-install-external="${isExt}"
          ${isExt ? 'disabled title="Hosted externally — download manually"' : ''}>
          Install →
        </button>
      </div>
    </div>`;
}

async function showInstallModal(spigetId, name, isExternal) {
  if (isExternal) {
    toastError(`"${name}" is hosted externally. Download it from the author's link.`);
    return;
  }

  // Load networks + their servers to pick a target
  let networkList;
  try {
    networkList = await networks.list();
  } catch (e) {
    toastError(`Failed to load networks: ${e.message}`);
    return;
  }

  const allServers = networkList.flatMap(n =>
    (n.servers || []).map(s => ({ ...s, networkName: n.name }))
  );

  if (allServers.length === 0) {
    showModal({
      heading: `Install "${name}"`,
      content: `<p class="text-muted">You need at least one server before installing plugins.</p>`,
      buttons: [{ label: 'Close', cls: 'btn-ghost', onClick: c => c() }],
    });
    return;
  }

  // Also fetch available versions
  let versions = [];
  try {
    versions = await plugins.versions(spigetId);
  } catch {}

  const form = document.createElement('form');
  form.innerHTML = `
    <div class="form-group">
      <label class="form-label">Target server</label>
      <select class="form-select" name="server_id" required>
        ${allServers.map(s =>
          `<option value="${s.id}">[${escHtml(s.networkName)}] ${escHtml(s.name)}</option>`
        ).join('')}
      </select>
    </div>
    ${versions.length > 1 ? `
    <div class="form-group">
      <label class="form-label">Version</label>
      <select class="form-select" name="version_id">
        <option value="">Latest</option>
        ${versions.slice(0, 20).map(v =>
          `<option value="${v.id}">${escHtml(String(v.name || v.id))}</option>`
        ).join('')}
      </select>
    </div>` : ''}
  `;

  showModal({
    heading: `Install "${name}"`,
    content: form,
    buttons: [
      { label: 'Cancel', cls: 'btn-ghost', onClick: c => c() },
      { label: 'Install', cls: 'btn-primary', onClick: async (close) => {
        const serverId  = form.server_id.value;
        const versionId = form.version_id?.value || undefined;
        try {
          await servers.installPlugin(serverId, { spiget_id: spigetId, version_id: versionId });
          toastSuccess(`"${name}" installed!`);
          close();
        } catch (e) {
          toastError(e.message);
        }
      }},
    ],
  });
}
