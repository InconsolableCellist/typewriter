// A small anti-aliased drawing surface for page sources: a grey reflectance image in millimetres, drawn with
// coverage from signed distances (rectangles, strokes, circles, polygons), text from the repository's own 8 x 16
// font (src/wp/font/font8x16.js, our drawing) traced as strokes between its dots, and per-pixel functions for
// gradients and photographs. Pure module: typed arrays only, no DOM.
//
// A page is { name, title, widthMm, heightMm, dpmmX, dpmmY, w, h, data } with data a Uint8Array of reflectance x 255,
// row-major from the top-left corner. That is the form optics.js scans.

import { FONT8X16 } from '../../wp/font/font8x16.js';

export const PAPER = 0.86;   // reflectance of office paper under the CIS's LED [A]
export const INK = 0.06;     // black toner, ink or pencil-dark ink [A]

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

export class PageCanvas {
  constructor({ widthMm = 210, heightMm = 297, dpmm = 16, paper = PAPER, name = 'page', title = '' } = {}) {
    this.widthMm = widthMm; this.heightMm = heightMm;
    this.dpmmX = dpmm; this.dpmmY = dpmm;
    this.w = Math.round(widthMm * dpmm); this.h = Math.round(heightMm * dpmm);
    this.data = new Uint8Array(this.w * this.h).fill(Math.round(paper * 255));
    this.name = name; this.title = title;
    this.px = 1 / dpmm; // one pixel in mm
  }

  /** The page object for optics.js. */
  page() {
    const { name, title, widthMm, heightMm, dpmmX, dpmmY, w, h, data } = this;
    return { name, title, widthMm, heightMm, dpmmX, dpmmY, w, h, data };
  }

  /** Blend reflectance r into pixel (x, y) with coverage c. */
  blend(x, y, c, r) {
    if (c <= 0) return;
    const o = y * this.w + x;
    const v = this.data[o];
    this.data[o] = Math.round(v + (r * 255 - v) * (c > 1 ? 1 : c));
  }

  /**
   * Shade by a signed distance function sdf(xMm, yMm) (negative inside) over a bounding box in mm.
   * `r` is the reflectance, a number or a function (xMm, yMm) -> reflectance.
   */
  shape(x0, y0, x1, y1, sdf, r = INK) {
    const d = this.dpmmX, px = this.px;
    const ix0 = Math.max(0, Math.floor((x0 - px) * d)), ix1 = Math.min(this.w - 1, Math.ceil((x1 + px) * d));
    const iy0 = Math.max(0, Math.floor((y0 - px) * d)), iy1 = Math.min(this.h - 1, Math.ceil((y1 + px) * d));
    const fn = typeof r === 'function';
    for (let y = iy0; y <= iy1; y++) {
      const ym = (y + 0.5) * px;
      for (let x = ix0; x <= ix1; x++) {
        const xm = (x + 0.5) * px;
        const c = clamp01(0.5 - sdf(xm, ym) / px);
        if (c > 0) this.blend(x, y, c, fn ? r(xm, ym) : r);
      }
    }
  }

  /** An axis-aligned rectangle, exact coverage. */
  rect(x, y, w, h, r = INK) {
    const d = this.dpmmX;
    const ax = x * d, bx = (x + w) * d, ay = y * d, by = (y + h) * d;
    const ix0 = Math.max(0, Math.floor(ax)), ix1 = Math.min(this.w - 1, Math.ceil(bx) - 1);
    const iy0 = Math.max(0, Math.floor(ay)), iy1 = Math.min(this.h - 1, Math.ceil(by) - 1);
    for (let iy = iy0; iy <= iy1; iy++) {
      const cy = Math.min(by, iy + 1) - Math.max(ay, iy);
      for (let ix = ix0; ix <= ix1; ix++) {
        const cx = Math.min(bx, ix + 1) - Math.max(ax, ix);
        this.blend(ix, iy, cx * cy, r);
      }
    }
  }

  /** A rectangle outline of stroke width t, inside the box. */
  frame(x, y, w, h, t = 0.3, r = INK) {
    this.rect(x, y, w, t, r); this.rect(x, y + h - t, w, t, r);
    this.rect(x, y + t, t, h - 2 * t, r); this.rect(x + w - t, y + t, t, h - 2 * t, r);
  }

  /** A straight stroke of width t with round (cap 'round') or flat ends. */
  line(xa, ya, xb, yb, t = 0.3, r = INK, cap = 'round') {
    const dx = xb - xa, dy = yb - ya, L2 = dx * dx + dy * dy || 1e-12, L = Math.sqrt(L2), h = t / 2;
    const sdf = cap === 'round'
      ? (x, y) => {
        let s = ((x - xa) * dx + (y - ya) * dy) / L2; s = s < 0 ? 0 : s > 1 ? 1 : s;
        return Math.hypot(x - xa - s * dx, y - ya - s * dy) - h;
      }
      : (x, y) => {
        const along = ((x - xa) * dx + (y - ya) * dy) / L, across = Math.abs((x - xa) * dy - (y - ya) * dx) / L;
        return Math.max(across - h, -along, along - L);
      };
    this.shape(Math.min(xa, xb) - h, Math.min(ya, yb) - h, Math.max(xa, xb) + h, Math.max(ya, yb) + h, sdf, r);
  }

  /** A filled circle, or a ring when t > 0. */
  circle(cx, cy, rad, { t = 0, r = INK } = {}) {
    const sdf = t > 0 ? (x, y) => Math.abs(Math.hypot(x - cx, y - cy) - rad) - t / 2 : (x, y) => Math.hypot(x - cx, y - cy) - rad;
    const e = rad + t;
    this.shape(cx - e, cy - e, cx + e, cy + e, sdf, r);
  }

  /** A filled polygon [[x, y], ...] (even-odd), or its outline when t > 0. */
  polygon(pts, { t = 0, r = INK } = {}) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const n = pts.length;
    const sdf = (x, y) => {
      let d = Infinity, inside = false;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        const ex = xi - xj, ey = yi - yj, L2 = ex * ex + ey * ey || 1e-12;
        let s = ((x - xj) * ex + (y - yj) * ey) / L2; s = s < 0 ? 0 : s > 1 ? 1 : s;
        d = Math.min(d, Math.hypot(x - xj - s * ex, y - yj - s * ey));
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return t > 0 ? d - t / 2 : inside ? -d : d;
    };
    this.shape(x0 - t, y0 - t, x1 + t, y1 + t, sdf, r);
  }

  /** Fill a box with a function (xMm, yMm) -> reflectance. */
  fill(x, y, w, h, f) {
    const d = this.dpmmX, px = this.px;
    const ix0 = Math.max(0, Math.round(x * d)), ix1 = Math.min(this.w, Math.round((x + w) * d));
    const iy0 = Math.max(0, Math.round(y * d)), iy1 = Math.min(this.h, Math.round((y + h) * d));
    for (let iy = iy0; iy < iy1; iy++) {
      for (let ix = ix0; ix < ix1; ix++) this.data[iy * this.w + ix] = Math.round(clamp01(f((ix + 0.5) * px, (iy + 0.5) * px)) * 255);
    }
  }

  /**
   * Text in the 8 x 16 font, top-left of the cell at (x, y) mm, capitals `size` mm tall (the font's capitals span 9
   * dot rows). `weight` is the stroke width in dot pitches. Returns the advance in mm.
   */
  text(str, x, y, size = 3, { weight = 1.1, r = INK, spacing = 1 } = {}) {
    const p = size / 9;               // one font dot, mm
    const adv = 8 * p * spacing;
    for (let k = 0; k < str.length; k++) {
      const code = str.charCodeAt(k);
      if (code > 32 && code < 256) this._glyph(code, x + k * adv, y, p, weight * p, r);
    }
    return str.length * adv;
  }

  textWidth(str, size = 3, spacing = 1) { return str.length * 8 * (size / 9) * spacing; }

  _glyph(code, gx, gy, p, t, r) {
    const segs = glyphSegments(code);
    if (!segs.length) return;
    const h = t / 2, d = this.dpmmX, px = this.px;
    // distance field for the glyph's cell
    const ix0 = Math.max(0, Math.floor((gx - h) * d) - 1), ix1 = Math.min(this.w - 1, Math.ceil((gx + 8 * p + h) * d) + 1);
    const iy0 = Math.max(0, Math.floor((gy - h) * d) - 1), iy1 = Math.min(this.h - 1, Math.ceil((gy + 16 * p + h) * d) + 1);
    const W = ix1 - ix0 + 1, H = iy1 - iy0 + 1;
    if (W <= 0 || H <= 0) return;
    const field = scratch(W * H);
    field.fill(1e9, 0, W * H);
    for (let s = 0; s < segs.length; s += 4) {
      const xa = gx + (segs[s] + 0.5) * p, ya = gy + (segs[s + 1] + 0.5) * p;
      const xb = gx + (segs[s + 2] + 0.5) * p, yb = gy + (segs[s + 3] + 0.5) * p;
      const dx = xb - xa, dy = yb - ya, L2 = dx * dx + dy * dy || 1e-12;
      const bx0 = Math.max(ix0, Math.floor((Math.min(xa, xb) - h) * d) - 1), bx1 = Math.min(ix1, Math.ceil((Math.max(xa, xb) + h) * d) + 1);
      const by0 = Math.max(iy0, Math.floor((Math.min(ya, yb) - h) * d) - 1), by1 = Math.min(iy1, Math.ceil((Math.max(ya, yb) + h) * d) + 1);
      for (let y = by0; y <= by1; y++) {
        const ym = (y + 0.5) * px;
        for (let x = bx0; x <= bx1; x++) {
          const xm = (x + 0.5) * px;
          let u = ((xm - xa) * dx + (ym - ya) * dy) / L2; u = u < 0 ? 0 : u > 1 ? 1 : u;
          const dist = Math.hypot(xm - xa - u * dx, ym - ya - u * dy);
          const o = (y - iy0) * W + (x - ix0);
          if (dist < field[o]) field[o] = dist;
        }
      }
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = clamp01(0.5 - (field[y * W + x] - h) / px);
        if (c > 0) this.blend(ix0 + x, iy0 + y, c, r);
      }
    }
  }
}

let SCRATCH = new Float32Array(1 << 14);
function scratch(n) {
  if (SCRATCH.length < n) SCRATCH = new Float32Array(n);
  return SCRATCH;
}

const SEGS = new Map();
/**
 * The font's lit dots of a glyph joined into strokes: every lit dot to its lit right and lower neighbours, and to a
 * lit diagonal neighbour when neither dot between them is lit (so a diagonal is one stroke, a corner is not doubled).
 * A dot with no neighbour becomes a zero-length stroke (a point). Flat [x0, y0, x1, y1, ...] in dot units.
 */
export function glyphSegments(code) {
  let s = SEGS.get(code);
  if (s) return s;
  const lit = (x, y) => x >= 0 && x < 8 && y >= 0 && y < 16 && ((FONT8X16[code * 16 + y] >>> (7 - x)) & 1) === 1;
  const out = [];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 8; x++) {
      if (!lit(x, y)) continue;
      let joined = false;
      if (lit(x + 1, y)) { out.push(x, y, x + 1, y); joined = true; }
      if (lit(x, y + 1)) { out.push(x, y, x, y + 1); joined = true; }
      if (lit(x + 1, y + 1) && !lit(x + 1, y) && !lit(x, y + 1)) { out.push(x, y, x + 1, y + 1); joined = true; }
      if (lit(x - 1, y + 1) && !lit(x - 1, y) && !lit(x, y + 1)) { out.push(x, y, x - 1, y + 1); joined = true; }
      if (!joined && !lit(x - 1, y) && !lit(x, y - 1) && !lit(x - 1, y - 1) && !lit(x + 1, y - 1)) out.push(x, y, x, y);
    }
  }
  s = Int8Array.from(out);
  SEGS.set(code, s);
  return s;
}
