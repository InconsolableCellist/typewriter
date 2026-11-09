// The browser end of the local PTY bridge (tools/term-server.py).
export function bridgeUrl({ port, token, cols }) {
  return `ws://127.0.0.1:${port}/tty?token=${encodeURIComponent(token)}&cols=${cols}`;
}

export class TermBridge {
  constructor() { this.ws = null; this.onBytes = null; this.onClose = null; this.open = false; }

  connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      ws.onopen = () => { this.open = true; resolve(); };
      ws.onerror = () => { if (!this.open) reject(new Error('could not reach the bridge')); };
      ws.onclose = (e) => {
        const was = this.open;
        this.open = false;
        if (was) this.onClose?.(e.reason || 'connection closed');
        else reject(new Error('the bridge refused the connection (is `npm run term` running with this token?)'));
      };
      ws.onmessage = (e) => { if (e.data instanceof ArrayBuffer) this.onBytes?.(new Uint8Array(e.data)); };
    });
  }

  send(bytes) { if (this.open) this.ws.send(bytes); }
  control(type) { if (this.open) this.ws.send(JSON.stringify({ type })); }
  close() { this.open = false; this.ws?.close(); this.ws = null; }
}
