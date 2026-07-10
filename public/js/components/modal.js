const overlay = () => document.getElementById('modal-overlay');
const box     = () => document.getElementById('modal-box');
const title   = () => document.getElementById('modal-title');
const body    = () => document.getElementById('modal-body');
const footer  = () => document.getElementById('modal-footer');
const closeBtn = () => document.getElementById('modal-close');

let _onClose = null;

function close() {
  overlay().classList.add('hidden');
  body().innerHTML   = '';
  footer().innerHTML = '';
  if (_onClose) { _onClose(); _onClose = null; }
}

document.addEventListener('click', (e) => {
  if (e.target === overlay()) close();
});

export function showModal({ heading, content, buttons = [], onClose } = {}) {
  title().textContent = heading || '';
  body().innerHTML    = typeof content === 'string' ? content : '';
  if (typeof content === 'object' && content?.nodeType) {
    body().innerHTML = '';
    body().appendChild(content);
  }

  footer().innerHTML = '';
  for (const btn of buttons) {
    const el = document.createElement('button');
    el.className  = `btn ${btn.cls || 'btn-ghost'}`;
    el.textContent = btn.label;
    if (btn.onClick) el.addEventListener('click', () => btn.onClick(close));
    footer().appendChild(el);
  }

  _onClose = onClose || null;
  closeBtn().onclick = close;
  overlay().classList.remove('hidden');
  return close;
}

export function confirm(message, onConfirm, { danger = false } = {}) {
  return showModal({
    heading: 'Confirm',
    content: `<p style="color:var(--text-dim)">${message}</p>`,
    buttons: [
      { label: 'Cancel', cls: 'btn-ghost', onClick: (close) => close() },
      { label: 'Confirm', cls: danger ? 'btn-danger' : 'btn-primary', onClick: (close) => { close(); onConfirm(); } },
    ],
  });
}

export function prompt(heading, fields, onSubmit) {
  const form = document.createElement('form');
  form.style.display = 'flex';
  form.style.flexDirection = 'column';
  form.style.gap = '14px';

  for (const f of fields) {
    const group = document.createElement('div');
    group.className = 'form-group';
    group.style.marginBottom = '0';

    const label = document.createElement('label');
    label.className   = 'form-label';
    label.textContent = f.label;
    group.appendChild(label);

    let input;
    if (f.type === 'select') {
      input = document.createElement('select');
      input.className = 'form-select';
      for (const opt of (f.options || [])) {
        const o = document.createElement('option');
        o.value = opt.value ?? opt;
        o.textContent = opt.label ?? opt;
        input.appendChild(o);
      }
    } else {
      input = document.createElement('input');
      input.className   = 'form-input';
      input.type        = f.type || 'text';
      input.placeholder = f.placeholder || '';
      input.value       = f.default || '';
    }
    input.name = f.name;
    if (f.required) input.required = true;
    group.appendChild(input);

    if (f.hint) {
      const hint = document.createElement('p');
      hint.className   = 'form-hint';
      hint.textContent = f.hint;
      group.appendChild(hint);
    }
    form.appendChild(group);
  }

  return showModal({
    heading,
    content: form,
    buttons: [
      { label: 'Cancel', cls: 'btn-ghost', onClick: (close) => close() },
      {
        label: 'Create',
        cls: 'btn-primary',
        onClick: (close) => {
          const data = Object.fromEntries(new FormData(form));
          if (!form.checkValidity()) { form.reportValidity(); return; }
          onSubmit(data, close);
        },
      },
    ],
  });
}
