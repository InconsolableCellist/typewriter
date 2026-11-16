// Drawing for the correspondents' pages: typed text (the period's typewriters and printers, in our dot matrix at
// pica pitch with a little irregularity), a handwritten-style hand (the matrix's dots joined into strokes, slanted
// and wobbled, drawn with a round felt-tip), rules, frames, a dithered grey for halftone. All at fine resolution,
// 1728 pels across. Pure and seeded: the same arguments draw the same page.

import { Raster, glyph } from '../../firmware/chargen.js';

/** US letter at fine resolution: 279.4 mm x 7.7 lines/mm (North American default, plan decision 5). */
export const LETTER_ROWS = 2151;
export const DOTS_PER_MM = 8;

export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let x = s; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}

export function newPage(rows = LETTER_ROWS) { return new Raster(rows); }

export function toPage(r) { return { width: r.width, height: r.height, vres: 'fine', rows: r.data }; }

/** Typed text: 10 characters an inch (20 dots), the matrix at 3 x 4; each character a row up or down and now and then light. */
export function typed(r, x, y, text, { seed = 1, pitch = 20, sx = 3, sy = 4, bold = false } = {}) {
  const rand = rng(seed);
  for (const ch of String(text)) {
    const cols = glyph(ch);
    const dy = rand() < 0.15 ? (rand() < 0.5 ? -1 : 1) : 0;
    const light = rand() < 0.06;
    for (let c = 0; c < 5; c++) for (let row = 0; row < 7; row++) {
      if (!((cols[c] >> row) & 1)) continue;
      for (let yy = 0; yy < sy; yy++) for (let xx = 0; xx < sx + (bold ? 1 : 0); xx++) {
        if (light && rand() < 0.35) continue;
        r.set(x + c * sx + xx, y + dy + row * sy + yy);
      }
    }
    x += pitch;
  }
  return x;
}

/** Lines of typed text from (x, y), `lead` rows apart. Returns the y after the last. */
export function typedBlock(r, x, y, lines, { lead = 46, seed = 1, ...o } = {}) {
  lines.forEach((s, i) => typed(r, x, y + i * lead, s, { seed: seed * 131 + i, ...o }));
  return y + lines.length * lead;
}

/** A filled disc. */
export function disc(r, cx, cy, rad) {
  const r2 = rad * rad;
  for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++) if (x * x + y * y <= r2) r.set(Math.round(cx + x), Math.round(cy + y));
}

/** A line with a round pen. */
export function stroke(r, x0, y0, x1, y1, rad = 2) {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / Math.max(1, rad * 0.7)));
  for (let i = 0; i <= n; i++) disc(r, x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, rad);
}

/**
 * A handwritten-style line of text: each matrix dot joined to its set neighbours by pen strokes, slanted forward,
 * each letter a little out of line, the baseline drifting. `size` is matrix dots in head dots (7: about 5.5 mm
 * capitals).
 */
export function handwritten(r, x, y, text, { seed = 1, size = 7, slant = 0.22, pen = 2 } = {}) {
  const rand = rng(seed);
  let drift = 0;
  for (const ch of String(text)) {
    drift += (rand() - 0.5) * 1.2;
    drift = Math.max(-6, Math.min(6, drift));
    if (ch === ' ') { x += size * 4 + Math.round(rand() * size); continue; }
    const cols = glyph(ch);
    const jx = (rand() - 0.5) * size * 0.6, jy = (rand() - 0.5) * size * 0.8 + drift;
    const wob = () => (rand() - 0.5) * size * 0.35;
    const P = (c, row) => [x + jx + c * size - (row - 6) * size * slant, y + jy + row * size * 1.15];
    const on = (c, row) => c >= 0 && c < 5 && row >= 0 && row < 7 && ((cols[c] >> row) & 1);
    let any = false;
    for (let c = 0; c < 5; c++) for (let row = 0; row < 7; row++) {
      if (!on(c, row)) continue;
      any = true;
      const [ax, ay] = P(c, row);
      const nbrs = [[1, 0], [0, 1], [1, 1], [-1, 1]];
      let joined = false;
      for (const [dc, dr] of nbrs) {
        if (!on(c + dc, row + dr)) continue;
        // Skip a diagonal when the square around it is already joined orthogonally.
        if (dc !== 0 && dr !== 0 && (on(c + dc, row) || on(c, row + dr))) continue;
        const [bx, by] = P(c + dc, row + dr);
        stroke(r, ax + wob() * 0.3, ay + wob() * 0.3, bx + wob() * 0.3, by + wob() * 0.3, pen);
        joined = true;
      }
      if (!joined) disc(r, ax, ay, pen + 1);
    }
    x += size * (any ? 6 : 4) + Math.round((rand() - 0.3) * size);
  }
  return x;
}

/** Lines of handwriting. */
export function handBlock(r, x, y, lines, { lead = 84, seed = 1, ...o } = {}) {
  lines.forEach((s, i) => handwritten(r, x + Math.round((rng(seed + i)() - 0.5) * 12), y + i * lead, s, { seed: seed * 977 + i, ...o }));
  return y + lines.length * lead;
}

/** Ordered-dither grey (0 white .. 1 black) over a rectangle: the halftone the far machine's scanner would make. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export function grey(r, x0, y0, w, h, level) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const v = typeof level === 'function' ? level(x, y) : level;
    if (v * 16 > BAYER[(y & 3) * 4 + (x & 3)] + 0.5) r.set(x, y);
  }
}

/** Draw a raster drawn at fine resolution onto a page of any vres, at (x0, y0) in fine rows (OR). */
export function overlayFine(page, src, x0, y0) {
  const ratio = { standard: 3.85, fine: 7.7, superfine: 15.4 }[page.vres ?? 'fine'] / 7.7;
  const stride = page.width >>> 3;
  const rows = page.rows.slice();
  const out = { ...page, rows };
  const h = Math.floor(src.height * ratio);
  for (let i = 0; i < h; i++) {
    const py = Math.floor(y0 * ratio) + i;
    if (py < 0 || py >= page.height) continue;
    const sy = Math.min(src.height - 1, Math.floor(i / ratio));
    for (let x = 0; x < src.width; x++) {
      if (!src.get(x, sy)) continue;
      const px = x0 + x;
      if (px < 0 || px >= page.width) continue;
      rows[py * stride + (px >>> 3)] |= 0x80 >>> (px & 7);
    }
  }
  return out;
}
