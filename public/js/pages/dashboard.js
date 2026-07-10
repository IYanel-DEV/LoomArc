import { networks } from '../api.js';
import { getApiKey } from '../api.js';
import { toastSuccess, toastError } from '../components/toast.js';
import { prompt, confirm, showModal } from '../components/modal.js';

const escHtml = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function statusBadge(status) {
  return `<span class="status-badge status-${status}">${status}</span>`;
}

function provisioningCard(n, provState) {
  const pct = provState?.percent ?? 0;
  const msg = provState?.message ?? 'Provisioning…';
  const isError = !!provState?.error;

  return `
    <div class="network-card provisioning-card" data-network-id="${n.id}">
      <div class="network-card-header">
        <div>
          <div class="network-name">${escHtml(n.name)}</div>
          <div class="network-desc">Setting up network…</div>
        </div>
        <span class="status-badge status-starting">${isError ? 'error' : 'provisioning'}</span>
      </div>
      <div class="provision-progress" style="margin-top:14px">
        <div class="progress-bar-track">
          <div class="progress-bar-fill ${isError ? 'error' : ''}" style="width:${pct}%"></div>
        </div>
        <div class="provision-message">${escHtml(msg)}</div>
      </div>
      <div class="network-meta" style="margin-top:12px">
        <span class="meta-chip">:${n.bungee_port}</span>
      </div>
    </div>
  `;
}

function networkCard(n) {
  const live = n.liveStatus || n.status;
  const serverCount = (n.servers || []).length;
  const runningCount = (n.servers || []).filter(s => s.liveStatus === 'running').length;

  return `
    <div class="network-card" data-network-id="${n.id}">
      <div class="network-card-header">
        <div>
          <div class="network-name">${escHtml(n.name)}</div>
          ${n.description ? `<div class="network-desc">${escHtml(n.description)}</div>` : ''}
        </div>
        ${statusBadge(live)}
      </div>
      <div class="network-meta">
        <span class="meta-chip">:${n.bungee_port}</span>
        <span>${serverCount} server${serverCount !== 1 ? 's' : ''}</span>
        ${runningCount > 0 ? `<span style="color:var(--green)">${runningCount} running</span>` : ''}
      </div>
      <div class="network-actions">
        <button class="btn btn-sm btn-success" data-action="start" data-id="${n.id}"
          ${live === 'running' ? 'disabled' : ''}>▶ Start</button>
        <button class="btn btn-sm btn-ghost"   data-action="stop"  data-id="${n.id}"
          ${live !== 'running' ? 'disabled' : ''}>■ Stop</button>
        <button class="btn btn-sm btn-danger"  data-action="kill"  data-id="${n.id}"
          ${live !== 'running' ? 'disabled' : ''} title="Force kill (SIGKILL / taskkill)">☠ Kill</button>
        <button class="btn btn-sm btn-ghost"   data-action="open"  data-id="${n.id}"
          style="margin-left:auto">Open →</button>
        <button class="btn btn-sm btn-danger"  data-action="delete" data-id="${n.id}">Delete</button>
      </div>
    </div>
  `;
}

// Active SSE connections keyed by networkId — closed when we navigate away or provisioning ends
const _sseSources = new Map();

export async function renderDashboard(container) {
  // Clean up any lingering SSE sources from a previous render
  _sseSources.forEach(s => s.close());
  _sseSources.clear();

  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Networks</div>
        <div class="page-subtitle">Each network is an independent BungeeCord proxy with its own sub-servers</div>
      </div>
      <button class="btn btn-primary" id="btn-new-network">+ New Network</button>
    </div>
    <div class="networks-grid" id="networks-grid">
      <div class="loading-splash"><div class="spinner"></div></div>
    </div>
  `;

  document.getElementById('btn-new-network').addEventListener('click', showCreateNetwork);
  await loadNetworks();
}

async function loadNetworks() {
  const grid = document.getElementById('networks-grid');
  if (!grid) return;

  try {
    const list = await networks.list();

    if (list.length === 0) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
            <path d="M2 17l10 5 10-5"/>
            <path d="M2 12l10 5 10-5"/>
          </svg>
          <p>No networks yet — create your first one.</p>
        </div>`;
      return;
    }

    grid.innerHTML = list.map(n =>
      n.provisioning ? provisioningCard(n, n.provisioning) : networkCard(n)
    ).join('');

    // Wire up normal card buttons
    grid.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleAction(btn.dataset.action, btn.dataset.id);
      });
    });

    // Navigate into network on card click (non-action area)
    grid.querySelectorAll('.network-card:not(.provisioning-card)').forEach(card => {
      card.addEventListener('click', () => {
        location.hash = `#/network/${card.dataset.networkId}`;
      });
    });

    // Attach SSE listeners for any cards that are still provisioning
    list.filter(n => n.provisioning).forEach(n => attachProvisionSSE(n.id));

  } catch (e) {
    grid.innerHTML = `<p class="text-muted">Failed to load networks: ${e.message}</p>`;
  }
}

// ─── Provisioning SSE ─────────────────────────────────────────────────────────

function attachProvisionSSE(networkId) {
  if (_sseSources.has(networkId)) return; // already attached

  const key = getApiKey();
  const url = `/api/networks/${networkId}/provision?key=${encodeURIComponent(key)}`;
  const source = new EventSource(url);
  _sseSources.set(networkId, source);

  source.onmessage = (e) => {
    let data;
    try { data = JSON.parse(e.data); } catch { return; }

    // Update the card in-place if it's still on screen
    updateProvisionCard(networkId, data);

    if (data.done) {
      source.close();
      _sseSources.delete(networkId);
      // Replace provisioning card with normal card after a short pause
      setTimeout(() => loadNetworks(), 600);
    }
    if (data.error) {
      source.close();
      _sseSources.delete(networkId);
      toastError(`Provisioning failed: ${data.error}`);
    }
  };

  source.onerror = () => {
    source.close();
    _sseSources.delete(networkId);
  };
}

function updateProvisionCard(networkId, data) {
  const card = document.querySelector(`.provisioning-card[data-network-id="${networkId}"]`);
  if (!card) return;

  const fill = card.querySelector('.progress-bar-fill');
  const msg  = card.querySelector('.provision-message');

  if (fill) {
    fill.style.width = `${data.percent ?? 0}%`;
    fill.classList.toggle('error', !!data.error);
  }
  if (msg) msg.textContent = data.message ?? '';
}

// ─── Provisioning progress modal (shown right after creation) ─────────────────

function showProvisionModal(network, initialState) {
  const pct = initialState?.percent ?? 0;
  const msg = initialState?.message ?? 'Starting…';

  const body = document.createElement('div');
  body.innerHTML = `
    <p style="color:var(--text-dim);margin-bottom:16px;font-size:.88rem">
      LoomArc is downloading BungeeCord and Paper JARs and provisioning the
      network directory. This happens once — subsequent networks reuse the cache.
    </p>
    <div class="provision-progress">
      <div style="display:flex;justify-content:space-between;margin-bottom:6px">
        <span class="text-sm text-muted" id="pm-msg">${escHtml(msg)}</span>
        <span class="text-sm text-mono" id="pm-pct">${pct}%</span>
      </div>
      <div class="progress-bar-track">
        <div class="progress-bar-fill" id="pm-fill" style="width:${pct}%"></div>
      </div>
    </div>
    <div id="pm-log" class="provision-log"></div>
  `;

  const closeModal = showModal({
    heading: `Provisioning "${network.name}"`,
    content: body,
    buttons: [], // no close button until done
  });

  let source = null;

  if (initialState?.done) {
    // Already done before modal opened (cached JARs, very fast)
    finaliseModal(body, closeModal);
    return;
  }

  const key = getApiKey();
  source = new EventSource(
    `/api/networks/${network.id}/provision?key=${encodeURIComponent(key)}`
  );

  source.onmessage = (e) => {
    let data;
    try { data = JSON.parse(e.data); } catch { return; }

    const fillEl = body.querySelector('#pm-fill');
    const msgEl  = body.querySelector('#pm-msg');
    const pctEl  = body.querySelector('#pm-pct');
    const logEl  = body.querySelector('#pm-log');

    if (fillEl) fillEl.style.width = `${data.percent ?? 0}%`;
    if (msgEl)  msgEl.textContent  = data.message ?? '';
    if (pctEl)  pctEl.textContent  = `${data.percent ?? 0}%`;

    // Append each distinct message to the log
    if (logEl && data.message) {
      const line = document.createElement('div');
      line.className   = 'provision-log-line';
      line.textContent = data.message;
      logEl.appendChild(line);
      logEl.scrollTop = logEl.scrollHeight;
    }

    if (data.error) {
      if (fillEl) fillEl.classList.add('error');
      source.close();
      source = null;
      addModalCloseButton(body, closeModal, 'Done', 'btn-ghost');
      toastError(`Provisioning failed: ${data.error}`);
    }

    if (data.done) {
      source.close();
      source = null;
      finaliseModal(body, closeModal);
    }
  };

  source.onerror = () => {
    source?.close();
    source = null;
  };
}

function finaliseModal(body, closeModal) {
  const fillEl = body.querySelector('#pm-fill');
  const msgEl  = body.querySelector('#pm-msg');
  if (fillEl) { fillEl.style.width = '100%'; }
  if (msgEl)  { msgEl.textContent  = 'Network ready!'; }
  addModalCloseButton(body, closeModal, 'Open Network', 'btn-primary');
  toastSuccess('Network provisioned!');
  loadNetworks();
}

function addModalCloseButton(body, closeModal, label, cls) {
  const footer = document.getElementById('modal-footer');
  if (!footer || footer.querySelector('button')) return;
  const btn = document.createElement('button');
  btn.className   = `btn ${cls}`;
  btn.textContent = label;
  btn.onclick     = () => closeModal();
  footer.appendChild(btn);
}

// ─── Network CRUD actions ─────────────────────────────────────────────────────

async function handleAction(action, id) {
  try {
    switch (action) {
      case 'start':
        await networks.start(id);
        toastSuccess('BungeeCord starting…');
        setTimeout(loadNetworks, 1000);
        break;
      case 'stop':
        await networks.stop(id);
        toastSuccess('BungeeCord stopping…');
        setTimeout(loadNetworks, 1000);
        break;
      case 'kill':
        confirm('Force-kill the BungeeCord process? This may cause data loss.', async () => {
          try {
            const result = await networks.kill(id);
            toastSuccess(`BungeeCord killed (PID ${result.pid})`);
            loadNetworks();
          } catch (e) { toastError(e.message); }
        }, { danger: true });
        break;
      case 'open':
        location.hash = `#/network/${id}`;
        break;
      case 'delete':
        confirm('Delete this network and all its servers? This cannot be undone.', async () => {
          try {
            await networks.delete(id);
            toastSuccess('Network deleted');
            loadNetworks();
          } catch (err) { toastError(err.message); }
        }, { danger: true });
        break;
    }
  } catch (e) {
    toastError(e.message);
  }
}

function showCreateNetwork() {
  prompt('Create Network', [
    {
      name: 'name', label: 'Network name', placeholder: 'my-network', required: true,
      hint: 'Letters, numbers, hyphens and underscores only.',
    },
    {
      name: 'description', label: 'Description (optional)',
      placeholder: 'My awesome Minecraft network',
    },
  ], async (data, close) => {
    try {
      const network = await networks.create(data);
      close();
      toastSuccess(`Network "${network.name}" created`);

      // Immediately update the grid with a provisioning card
      await loadNetworks();

      // Open the live provisioning progress modal
      const provState = network.provisioning;
      showProvisionModal(network, provState);

    } catch (e) {
      toastError(e.message);
    }
  });
}
