// The 80 x 25 display buffer: one character byte and one attribute byte per cell, 4 KB, the size of the real
// display buffer. Rows and columns are 1-based here, as in the grids of software-screens.md (SS 0).
// Regions (SS 0): status lines 1 and 2, the scale line, rows 4 to 23 for text or a menu, the prompt line, the
// message line. Only the menu runner, the typing view, the message queue and the start-up code write cells.
import { SYM, SYMBOL_TEXT, SYMBOL_OF } from './charset.js';

export const ROWS = 25, COLS = 80;
export const ATTR = { UNDER: 1, REVERSE: 2, BRIGHT: 4, BLINK: 8, HALF_UP: 16, HALF_DOWN: 32, SYMBOL: 64 };
export const ROW = { STATUS1: 1, STATUS2: 2, SCALE: 3, TOP: 4, BOTTOM: 23, PROMPT: 24, MESSAGE: 25 };
export const TEXT_ROWS = 20;

// Status-line fields, first and last column (SS 0, measured from ORG p.30 and p.558).
export const FIELD = {
  A: [1, 20], B: [22, 41], C: [43, 46], D: [48, 51], E: [53, 71], F: [73, 80],
  G: [1, 6], H: [8, 13], I: [36, 48], J: [50, 58], K: [60, 69], L: [71, 80],
};
const BARS1 = [21, 42, 47, 52, 72];
const BARS2 = [7, 14, 35, 49, 59, 70];

export class Screen {
  constructor() {
    this.chars = new Uint8Array(ROWS * COLS);
    this.attrs = new Uint8Array(ROWS * COLS);
    this.cursor = { row: 1, col: 1, on: false };
    this.version = 0;
  }

  touch() { this.version++; }

  clear() { this.chars.fill(0x20); this.attrs.fill(0); this.cursor.on = false; this.touch(); }

  clearRows(r0, r1 = r0) {
    const a = (r0 - 1) * COLS, b = r1 * COLS;
    this.chars.fill(0x20, a, b); this.attrs.fill(0, a, b); this.touch();
  }

  /** Write text at a cell. Characters outside Latin-1 are symbol stand-ins (charset.js) and go to the symbol font. */
  put(row, col, text, attr = 0) {
    let k = (row - 1) * COLS + col - 1;
    const end = row * COLS;
    for (const ch of text) {
      if (k >= end) break;
      if (k >= (row - 1) * COLS) {
        const c = ch.codePointAt(0);
        if (c <= 0xff) { this.chars[k] = c; this.attrs[k] = attr; }
        else { this.chars[k] = SYMBOL_OF.get(ch) ?? SYM.SQUARE; this.attrs[k] = attr | ATTR.SYMBOL; }
      }
      k++;
    }
    this.touch();
  }

  /** One cell by code: a text byte, or a symbol code when attr has ATTR.SYMBOL. */
  cell(row, col, code, attr = 0) {
    if (row < 1 || row > ROWS || col < 1 || col > COLS) return;
    const k = (row - 1) * COLS + col - 1;
    this.chars[k] = code; this.attrs[k] = attr; this.touch();
  }

  sym(row, col, code, attr = 0) { this.cell(row, col, code, attr | ATTR.SYMBOL); }

  /** Set (or with clear=true remove) attribute bits over n cells. */
  attr(row, col, n, bits, clear = false) {
    const k0 = (row - 1) * COLS + col - 1;
    for (let k = k0; k < k0 + n && k < row * COLS; k++) this.attrs[k] = clear ? this.attrs[k] & ~bits : this.attrs[k] | bits;
    this.touch();
  }

  setCursor(row, col, on = true) {
    const c = this.cursor;
    if (c.row !== row || c.col !== col || c.on !== on) { c.row = row; c.col = col; c.on = on; this.touch(); }
  }

  /** Field text, padded to the field width. */
  field(name, text = '', attr = 0) {
    const [a, b] = FIELD[name];
    const row = 'ABCDEF'.includes(name) ? 1 : 2;
    this.put(row, a, String(text).slice(0, b - a + 1).padEnd(b - a + 1), attr | (row === 2 ? ATTR.UNDER : 0));
  }

  /** Both status lines with their bars; fields given as { A, B, ... }. Row 2 is underlined along its whole length. */
  status(f = {}) {
    this.clearRows(1, 2);
    for (const c of BARS1) this.sym(1, c, SYM.BAR);
    for (const c of BARS2) this.sym(2, c, SYM.BAR);
    for (const [k, v] of Object.entries(f)) if (v != null && FIELD[k]) this.field(k, v);
    this.attr(2, 1, COLS, ATTR.UNDER);
  }

  text(row) {
    if (row === undefined) return Array.from({ length: ROWS }, (_, r) => this.text(r + 1)).join('\n');
    let s = '';
    for (let k = (row - 1) * COLS; k < row * COLS; k++) {
      const c = this.chars[k];
      s += this.attrs[k] & ATTR.SYMBOL ? SYMBOL_TEXT[c] : c === 0 ? ' ' : String.fromCharCode(c);
    }
    return s;
  }

  attrAt(row, col) { return this.attrs[(row - 1) * COLS + col - 1]; }
}
