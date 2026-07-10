import { auth } from '../api.js';
import { toastError, toastSuccess } from '../components/toast.js';

const escHtml = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

/**
 * Render the login (or first-run setup) page into `container`.
 * Calls `onSuccess({ token, username, role })` after a successful login/setup.
 */
export async function renderLogin(container, onSuccess) {
  // Check if any users exist — if not, show the first-run setup form
  let hasUsers = true;
  try {
    const session = await fetch('/api/session').then(r => r.json()).catch(() => ({}));
    hasUsers = session.hasUsers !== false;
  } catch {}

  if (!hasUsers) {
    renderSetup(container, onSuccess);
  } else {
    renderLoginForm(container, onSuccess);
  }
}

function renderLoginForm(container, onSuccess) {
  container.innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <div class="login-logo">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="3" width="7" height="7" rx="1"/><rect x="15" y="3" width="7" height="7" rx="1"/>
            <rect x="2" y="14" width="7" height="7" rx="1"/><rect x="15" y="14" width="7" height="7" rx="1"/>
          </svg>
          <span>LoomArc</span>
        </div>
        <h2 class="login-title">Sign in</h2>
        <form id="login-form" class="login-form" autocomplete="on">
          <div class="form-group">
            <label class="form-label">Username</label>
            <input class="form-input" type="text" name="username" autocomplete="username" required autofocus />
          </div>
          <div class="form-group">
            <label class="form-label">Password</label>
            <input class="form-input" type="password" name="password" autocomplete="current-password" required />
          </div>
          <div id="login-error" class="login-error hidden"></div>
          <button class="btn btn-primary" type="submit" id="login-btn" style="width:100%;margin-top:4px">
            Sign in
          </button>
        </form>
      </div>
    </div>
  `;

  const form = container.querySelector('#login-form');
  const errEl = container.querySelector('#login-error');
  const btn   = container.querySelector('#login-btn');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.classList.add('hidden');
    btn.disabled = true;
    btn.textContent = 'Signing in…';

    const { username, password } = Object.fromEntries(new FormData(form));
    try {
      const result = await auth.login(username, password);
      localStorage.setItem('loomarc-jwt', result.token);
      onSuccess(result);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  });
}

function renderSetup(container, onSuccess) {
  container.innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <div class="login-logo">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="3" width="7" height="7" rx="1"/><rect x="15" y="3" width="7" height="7" rx="1"/>
            <rect x="2" y="14" width="7" height="7" rx="1"/><rect x="15" y="14" width="7" height="7" rx="1"/>
          </svg>
          <span>LoomArc</span>
        </div>
        <h2 class="login-title">First-time setup</h2>
        <p style="color:var(--text-dim);font-size:.85rem;margin-bottom:18px">
          Create your admin account to get started.
        </p>
        <form id="setup-form" class="login-form" autocomplete="off">
          <div class="form-group">
            <label class="form-label">Username</label>
            <input class="form-input" type="text" name="username" required autofocus
              pattern="[a-zA-Z0-9_-]+" title="Letters, numbers, hyphens and underscores only" />
          </div>
          <div class="form-group">
            <label class="form-label">Password</label>
            <input class="form-input" type="password" name="password" required minlength="6" />
            <p class="form-hint">At least 6 characters</p>
          </div>
          <div id="setup-error" class="login-error hidden"></div>
          <button class="btn btn-primary" type="submit" id="setup-btn" style="width:100%;margin-top:4px">
            Create account &amp; continue
          </button>
        </form>
      </div>
    </div>
  `;

  const form  = container.querySelector('#setup-form');
  const errEl = container.querySelector('#setup-error');
  const btn   = container.querySelector('#setup-btn');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.classList.add('hidden');
    btn.disabled = true;

    const { username, password } = Object.fromEntries(new FormData(form));
    try {
      const result = await auth.setup(username, password);
      localStorage.setItem('loomarc-jwt', result.token);
      onSuccess(result);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
    }
  });
}
