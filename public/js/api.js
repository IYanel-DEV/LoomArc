/** Central API client — auto-injects x-api-key from session. */

let _apiKey = null;

export async function initApi() {
  const res = await fetch('/api/session');
  const data = await res.json();
  _apiKey = data.apiKey;
}

async function request(method, path, body) {
  const opts = {
    method,
    headers: {
      'x-api-key': _apiKey,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
  const res = await fetch(`/api${path}`, opts);
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const get    = (path)        => request('GET',    path);
const post   = (path, body)  => request('POST',   path, body);
const patch  = (path, body)  => request('PATCH',  path, body);
const put    = (path, body)  => request('PUT',    path, body);
const del    = (path)        => request('DELETE', path);

// ── Networks ──────────────────────────────────────────────────────────────────
export const networks = {
  list:        ()              => get('/networks'),
  get:         (id)            => get(`/networks/${id}`),
  create:      (data)          => post('/networks', data),
  rename:      (id, name)      => patch(`/networks/${id}`, { name }),
  update:      (id, data)      => patch(`/networks/${id}`, data),
  delete:      (id)            => del(`/networks/${id}`),
  start:       (id)            => post(`/networks/${id}/start`),
  stop:        (id)            => post(`/networks/${id}/stop`),
  restart:     (id)            => post(`/networks/${id}/restart`),
  command:     (id, command)   => post(`/networks/${id}/command`, { command }),
  console:     (id, lines)     => get(`/networks/${id}/console?lines=${lines || 200}`),
  syncConfig:  (id)            => post(`/networks/${id}/sync-config`),
  listFiles:   (id)            => get(`/networks/${id}/files`),
  readFile:    (id, p)         => get(`/networks/${id}/files/read?path=${encodeURIComponent(p)}`),
  writeFile:   (id, p, content) => put(`/networks/${id}/files`, { path: p, content }),
  fs: {
    list:   (id, p)          => get(`/networks/${id}/fs?path=${encodeURIComponent(p || '')}`),
    read:   (id, p)          => get(`/networks/${id}/fs/read?path=${encodeURIComponent(p)}`),
    write:  (id, p, content) => put(`/networks/${id}/fs`, { path: p, content }),
    mkdir:  (id, p)          => post(`/networks/${id}/fs/mkdir`, { path: p }),
    remove: (id, p)          => del(`/networks/${id}/fs?path=${encodeURIComponent(p)}`),
    rename: (id, from, to)   => post(`/networks/${id}/fs/rename`, { from, to }),
  },
};

// ── Servers ───────────────────────────────────────────────────────────────────
export const servers = {
  create:      (data)          => post('/servers', data),
  get:         (id)            => get(`/servers/${id}`),
  update:      (id, data)      => patch(`/servers/${id}`, data),
  delete:      (id)            => del(`/servers/${id}`),
  start:       (id)            => post(`/servers/${id}/start`),
  stop:        (id)            => post(`/servers/${id}/stop`),
  restart:     (id)            => post(`/servers/${id}/restart`),
  command:     (id, command)   => post(`/servers/${id}/command`, { command }),
  console:     (id, lines)     => get(`/servers/${id}/console?lines=${lines || 200}`),
  plugins:     (id)            => get(`/servers/${id}/plugins`),
  installPlugin: (id, data)    => post(`/servers/${id}/plugins/install-spiget`, data),
  removePlugin:  (sid, pid)    => del(`/servers/${sid}/plugins/${pid}`),
  listFiles:   (id)            => get(`/servers/${id}/files`),
  readFile:    (id, p)         => get(`/servers/${id}/files/read?path=${encodeURIComponent(p)}`),
  writeFile:   (id, p, content) => put(`/servers/${id}/files`, { path: p, content }),
  fs: {
    list:   (id, p)          => get(`/servers/${id}/fs?path=${encodeURIComponent(p || '')}`),
    read:   (id, p)          => get(`/servers/${id}/fs/read?path=${encodeURIComponent(p)}`),
    write:  (id, p, content) => put(`/servers/${id}/fs`, { path: p, content }),
    mkdir:  (id, p)          => post(`/servers/${id}/fs/mkdir`, { path: p }),
    remove: (id, p)          => del(`/servers/${id}/fs?path=${encodeURIComponent(p)}`),
    rename: (id, from, to)   => post(`/servers/${id}/fs/rename`, { from, to }),
  },
};

// ── Plugin search ─────────────────────────────────────────────────────────────
export const plugins = {
  search:   (q, params = {})   => get(`/plugins/search?q=${encodeURIComponent(q)}&size=${params.size||10}&page=${params.page||1}&sort=${params.sort||'-downloads'}`),
  resource: (spigetId)         => get(`/plugins/resource/${spigetId}`),
  versions: (spigetId)         => get(`/plugins/resource/${spigetId}/versions`),
};

// ── System ────────────────────────────────────────────────────────────────────
export const system = {
  status:  () => get('/system/status'),
  metrics: () => get('/system/metrics'),
  java:    () => get('/system/java'),
  jars:    {
    list:          ()           => get('/system/jars'),
    delete:        (id)         => del(`/system/jars/${id}`),
    linkToServer:  (id, sid)    => post(`/system/jars/${id}/link-to-server`,  { server_id: sid }),
    linkToNetwork: (id, nid)    => post(`/system/jars/${id}/link-to-network`, { network_id: nid }),
  },
};

export function getApiKey() { return _apiKey; }
