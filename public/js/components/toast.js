const container = () => document.getElementById('toast-container');

export function toast(message, type = 'info', duration = 3500) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  container().appendChild(el);
  setTimeout(() => el.remove(), duration);
}

export const toastSuccess = (msg) => toast(msg, 'success');
export const toastError   = (msg) => toast(msg, 'error', 5000);
export const toastInfo    = (msg) => toast(msg, 'info');
