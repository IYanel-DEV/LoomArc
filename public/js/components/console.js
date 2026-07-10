/**
 * Console component — renders a live scrollable console for any process.
 * Usage:
 *   const con = new Console(parentEl, processId, wsClient);
 *   con.destroy(); // when navigating away
 */

import wsClient from '../ws.js';

function formatTs(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export class ConsoleComponent {
  constructor(container, processId) {
    this._processId = processId;
    this._autoScroll = true;
    this._filterText = '';
    this._handler = this._onMessage.bind(this);
    this._onFilter = this._onFilterInput.bind(this);

    this._el = document.createElement('div');
    this._el.className = 'console-panel';
    this._el.innerHTML = `
      <div class="console-filter-row">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;opacity:.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        <input class="console-filter-input" type="text" placeholder="Filter logs… (regex: /pattern/i)" autocomplete="off" spellcheck="false" />
      </div>
      <div class="console-output" id="co-${processId}"></div>
      <div class="console-input-row">
        <span class="console-prompt">$</span>
        <input class="console-input" type="text" placeholder="Send command…" autocomplete="off" spellcheck="false" />
        <button class="console-send-btn">Send</button>
      </div>
    `;
    container.appendChild(this._el);

    this._output = this._el.querySelector('.console-output');
    this._input  = this._el.querySelector('.console-input');
    this._sendBtn = this._el.querySelector('.console-send-btn');
    this._filterInput = this._el.querySelector('.console-filter-input');

    // Send command on Enter or button click
    const send = () => {
      const cmd = this._input.value.trim();
      if (!cmd) return;
      wsClient.sendCommand(processId, cmd);
      this._input.value = '';
    };
    this._sendBtn.addEventListener('click', send);
    this._input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });

    // Filter input
    this._filterInput.addEventListener('input', this._onFilter);

    // Pause auto-scroll when user scrolls up
    this._output.addEventListener('scroll', () => {
      const { scrollTop, scrollHeight, clientHeight } = this._output;
      this._autoScroll = scrollHeight - scrollTop - clientHeight < 40;
    });

    wsClient.subscribe(processId, this._handler);
  }

  _onFilterInput() {
    this._filterText = this._filterInput.value.trim();
    const lines = this._output.querySelectorAll('.console-line');
    if (!this._filterText) {
      for (const l of lines) l.style.display = '';
      return;
    }

    let re = null;
    if (this._filterText.length > 2 && this._filterText[0] === '/' && this._filterText.lastIndexOf('/') > 1) {
      const lastSlash = this._filterText.lastIndexOf('/');
      const pattern = this._filterText.slice(1, lastSlash);
      const flags = this._filterText.slice(lastSlash + 1);
      try { re = new RegExp(pattern, flags); } catch {}
    }

    for (const l of lines) {
      const text = l.dataset.text || l.textContent;
      l.dataset.text = text;
      if (re) {
        l.style.display = re.test(text) ? '' : 'none';
      } else {
        l.style.display = text.toLowerCase().includes(this._filterText.toLowerCase()) ? '' : 'none';
      }
    }
  }

  _onMessage(msg) {
    if (msg.type === 'history') {
      this._output.innerHTML = '';
      msg.lines.forEach(l => this._appendLine(l));
      return;
    }
    if (msg.type === 'line') {
      this._appendLine(msg);
    }
    if (msg.type === 'status') {
      this._appendLine({ ts: Date.now(), text: `[LoomArc] Process status → ${msg.status}`, stream: 'stderr' });
    }
  }

  _appendLine({ ts, text, stream }) {
    const line = document.createElement('div');
    line.className = `console-line${stream === 'stderr' ? ' stderr' : ''}`;
    const tsSpan = document.createElement('span');
    tsSpan.className   = 'ts';
    tsSpan.textContent = formatTs(ts);
    line.appendChild(tsSpan);
    line.appendChild(document.createTextNode(text));
    line.dataset.text = text;

    if (this._filterText) {
      let re = null;
      if (this._filterText.length > 2 && this._filterText[0] === '/' && this._filterText.lastIndexOf('/') > 1) {
        const lastSlash = this._filterText.lastIndexOf('/');
        const pattern = this._filterText.slice(1, lastSlash);
        const flags = this._filterText.slice(lastSlash + 1);
        try { re = new RegExp(pattern, flags); } catch {}
      }
      if (re) {
        line.style.display = re.test(text) ? '' : 'none';
      } else {
        line.style.display = text.toLowerCase().includes(this._filterText.toLowerCase()) ? '' : 'none';
      }
    }

    this._output.appendChild(line);

    // Keep buffer manageable in DOM
    while (this._output.childElementCount > 1000) {
      this._output.removeChild(this._output.firstChild);
    }

    if (this._autoScroll) {
      this._output.scrollTop = this._output.scrollHeight;
    }
  }

  destroy() {
    wsClient.unsubscribe(this._processId, this._handler);
    this._el.remove();
  }
}
