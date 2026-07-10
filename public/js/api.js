/** Central API client — JWT Bearer token authentication. */

let _token   = null;
let _session = null; // { id, username, role }

export async function initApi(token) {
  _token = token;
  const res = await fetch('/api/auth/me', {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Invalid or expired session — please log in again.');
  _session = await res.json();
}

export function getToken()   { return _token; }
export function getSession() { return _session; }
export function isAdmin()    { return _session?.role === 'admin'; }

async function request(method, path, body, isFormData = false) {
  const headers = {
    'Authorization': `Bearer ${_token}`,
  };
  if (body && !isFormData) headers['Content-Type'] = 'application/json';

  const opts = {
    method,
    headers,
    ...(body ? { body: isFormData ? body : JSON.stringify(body) } : {}),
  };

  const res = await fetch(`/api${path}`, opts);

  if (res.status === 401) {
    localStorage.removeItem('loomarc-jwt');
    location.reload();
    throw new Error('Session expired — please log in again.');
  }

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

// ── Auth ──────────────────────────────────────────────────────────────────────
export const auth = {
  login:       (username, password) => {
    return fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }).then(async res => {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      return data;
    });
  },
  setup:       (username, password) => {
    return fetch('/api/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }).then(async res => {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      return data;
    });
  },
  me:          ()              => get('/auth/me'),
  users:       {
    list:    ()              => get('/auth/users'),
    create:  (data)          => post('/auth/users', data),
    update:  (id, data)      => patch(`/auth/users/${id}`, data),
    delete:  (id)            => del(`/auth/users/${id}`),
  },
};

// ── Networks ──────────────────────────────────────────────────────────────────
export const networks = {
  list:        ()              => get('/networks'),
  get:         (id)            => get(`/networks/${id}`),
  create:      (data)          => post('/networks', data),
  rename:      (id, name)      => patch(`/networks/${id}`, { name }),
  update:      (id, data)      => patch(`/networks/${id}`, data),
  setMemory:   (id, mb)        => put(`/networks/${id}/memory`, { memory_mb: mb }),
  delete:      (id)            => del(`/networks/${id}`),
  start:       (id)            => post(`/networks/${id}/start`),
  stop:        (id)            => post(`/networks/${id}/stop`),
  kill:        (id)            => post(`/networks/${id}/kill`),
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
  setMemory:   (id, mb)        => put(`/servers/${id}/memory`, { memory_mb: mb }),
  delete:      (id)            => del(`/servers/${id}`),
  start:       (id)            => post(`/servers/${id}/start`),
  stop:        (id)            => post(`/servers/${id}/stop`),
  kill:        (id)            => post(`/servers/${id}/kill`),
  restart:     (id)            => post(`/servers/${id}/restart`),
  command:     (id, command)   => post(`/servers/${id}/command`, { command }),
  console:     (id, lines)     => get(`/servers/${id}/console?lines=${lines || 200}`),
  plugins:     (id)            => get(`/servers/${id}/plugins`),
  installPlugin: (id, data)    => post(`/servers/${id}/plugins/install-spiget`, data),
  removePlugin:  (sid, pid)    => del(`/servers/${sid}/plugins/${pid}`),
  pluginsLocal:  (id)          => get(`/servers/${id}/plugins/local`),
  togglePlugin:  (id, fileName) => post(`/servers/${id}/plugins/toggle`, { file_name: fileName }),
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
  backups: {
    list:     (id)      => get(`/servers/${id}/backups`),
    create:   (id)      => post(`/servers/${id}/backups`),
    download: (id, bid) => `${location.origin}/api/servers/${id}/backups/${bid}/download?token=${encodeURIComponent(_token)}`,
    delete:   (id, bid) => del(`/servers/${id}/backups/${bid}`),
  },
};

// ── Plugin search ─────────────────────────────────────────────────────────────
export const plugins = {
  search:   (q, params = {}) =>
    get(`/plugins/search?q=${encodeURIComponent(q)}&size=${params.size||10}&page=${params.page||1}&sort=${params.sort||'-downloads'}`),
  resource: (spigetId)       => get(`/plugins/resource/${spigetId}`),
  versions: (spigetId)       => get(`/plugins/resource/${spigetId}/versions`),
};

// ── Scheduler ─────────────────────────────────────────────────────────────────
export const scheduler = {
  listTasks:   (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return get(`/scheduler/tasks${qs ? '?' + qs : ''}`);
  },
  createTask:  (data)        => post('/scheduler/tasks', data),
  updateTask:  (id, data)    => patch(`/scheduler/tasks/${id}`, data),
  toggleTask:  (id)          => post(`/scheduler/tasks/${id}/toggle`),
  deleteTask:  (id)          => del(`/scheduler/tasks/${id}`),
};

// ── Templates ─────────────────────────────────────────────────────────────────
export const templates = {
  list:   ()              => get('/templates'),
  get:    (id)            => get(`/templates/${id}`),
  create: (data)          => post('/templates', data),
  delete: (id)            => del(`/templates/${id}`),
  deploy: (id, data)      => post(`/templates/${id}/deploy`, data),
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
  paper: {
    versions: ()        => get('/system/paper/versions'),
    builds:   (version) => get(`/system/paper/versions/${encodeURIComponent(version)}/builds`),
  },
};

// ── Deprecated ────────────────────────────────────────────────────────────────
/** @deprecated Use getToken() */
export function getApiKey() { return _token; }
