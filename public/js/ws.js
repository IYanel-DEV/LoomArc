/**
 * WebSocket client with auto-reconnect and subscription management.
 * Usage:
 *   import ws from './ws.js';
 *   ws.subscribe('bungee-<id>', (msg) => { ... });
 *   ws.sendCommand('server-<id>', '/list');
 *   ws.unsubscribe('bungee-<id>');
 */

import { getApiKey } from './api.js';

class WsClient {
  constructor() {
    this._socket      = null;
    this._handlers    = new Map();   // processId → Set<handler>
    this._pendingSubs = new Set();   // processIds to subscribe on reconnect
    this._reconnectDelay = 2000;
    this._dead        = false;
  }

  connect() {
    const key = getApiKey();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url   = `${proto}://${location.host}/ws?key=${encodeURIComponent(key)}`;

    this._socket = new WebSocket(url);

    this._socket.addEventListener('open', () => {
      console.debug('[WS] Connected');
      this._reconnectDelay = 2000;
      // Re-subscribe to all active subscriptions
      for (const pid of this._pendingSubs) {
        this._doSubscribe(pid);
      }
    });

    this._socket.addEventListener('message', ({ data }) => {
      let msg;
      try { msg = JSON.parse(data); } catch { return; }

      const handlers = this._handlers.get(msg.processId);
      if (handlers) {
        for (const h of handlers) h(msg);
      }
    });

    this._socket.addEventListener('close', () => {
      if (this._dead) return;
      console.debug(`[WS] Disconnected — reconnecting in ${this._reconnectDelay}ms`);
      setTimeout(() => this.connect(), this._reconnectDelay);
      this._reconnectDelay = Math.min(this._reconnectDelay * 1.5, 30000);
    });

    this._socket.addEventListener('error', () => {/* close fires too */});
  }

  subscribe(processId, handler) {
    if (!this._handlers.has(processId)) {
      this._handlers.set(processId, new Set());
    }
    this._handlers.get(processId).add(handler);
    this._pendingSubs.add(processId);

    if (this._socket?.readyState === WebSocket.OPEN) {
      this._doSubscribe(processId);
    }
  }

  unsubscribe(processId, handler) {
    const set = this._handlers.get(processId);
    if (!set) return;
    if (handler) {
      set.delete(handler);
      if (set.size > 0) return;
    }
    this._handlers.delete(processId);
    this._pendingSubs.delete(processId);
    this._send({ type: 'unsubscribe', processId });
  }

  sendCommand(processId, command) {
    this._send({ type: 'command', processId, command });
  }

  _doSubscribe(processId) {
    this._send({ type: 'subscribe', processId });
  }

  _send(obj) {
    if (this._socket?.readyState === WebSocket.OPEN) {
      this._socket.send(JSON.stringify(obj));
    }
  }

  destroy() {
    this._dead = true;
    this._socket?.close();
  }
}

const wsClient = new WsClient();
export default wsClient;
