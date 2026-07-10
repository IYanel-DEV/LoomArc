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
    this._handler = this._onMessage.bind(this);

    this._el = document.createElement('div');
    this._el.className = 'console-panel';
    this._el.innerHTML = `
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

    // Send command on Enter or button click
    const send = () => {
      const cmd = this._input.value.trim();
      if (!cmd) return;
      wsClient.sendCommand(processId, cmd);
      this._input.value = '';
    };
    this._sendBtn.addEventListener('click', send);
    this._input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });

    // Pause auto-scroll when user scrolls up
    this._output.addEventListener('scroll', () => {
      const { scrollTop, scrollHeight, clientHeight } = this._output;
      this._autoScroll = scrollHeight - scrollTop - clientHeight < 40;
    });

    wsClient.subscribe(processId, this._handler);
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
