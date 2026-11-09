// Real key events to the bytes a terminal would send. Pure, so it can be tested without a browser.
const CTRL_PUNCT = { '@': 0, '[': 0x1b, '\\': 0x1c, ']': 0x1d, '^': 0x1e, '_': 0x1f, ' ': 0, '?': 0x7f, '/': 0x1f };
const SPECIAL = {
  Enter: '\r', Tab: '\t', Backspace: '\x7f', Escape: '\x1b',
  ArrowUp: '\x1b[A', ArrowDown: '\x1b[B', ArrowRight: '\x1b[C', ArrowLeft: '\x1b[D',
  Home: '\x1b[H', End: '\x1b[F', Delete: '\x1b[3~', PageUp: '\x1b[5~', PageDown: '\x1b[6~', Insert: '\x1b[2~',
};

/** @returns a string of bytes (Latin-1 range) for this keydown, or null if the terminal does not take it. */
export function keyEventToBytes(e) {
  if (e.metaKey) return null;
  const key = e.key;
  if (e.ctrlKey && !e.altKey) {
    if (e.shiftKey && /^[a-zA-Z]$/.test(key)) return null;                // Ctrl-Shift-V and friends stay with the browser
    if (/^[a-zA-Z]$/.test(key)) return String.fromCharCode(key.toUpperCase().charCodeAt(0) - 64);
    if (key in CTRL_PUNCT) return String.fromCharCode(CTRL_PUNCT[key]);
    return null;
  }
  if (key in SPECIAL) return (e.altKey ? '\x1b' : '') + SPECIAL[key];
  if (key.length === 1 && key >= ' ' && key <= '~') return (e.altKey ? '\x1b' : '') + key;
  return null;
}

/** Pasted text as the bytes typing it would produce: line endings become Return, non-ASCII is dropped. */
export function pasteToBytes(text) {
  return text.replace(/\r\n?/g, '\n').replace(/\n/g, '\r').replace(/[^\x09\x0d\x20-\x7e]/g, '');
}

export function stringToBytes(s) {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
  return b;
}
