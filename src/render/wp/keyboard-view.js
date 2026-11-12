// The word processor's keyboard: the moulded case from wp_keyboard.glb (tools/blender/build_wp_keyboard.py) and 84
// sculpted keycaps built here from the key table (src/machine/wp-keys.js), with their legends drawn on one texture
// atlas at run time. Each cap is its own mesh in the tilted `deck` group, so the kit moves it along its stem by the
// mechanism's travel (`pressDir`, the deck's own down) and the pointer picks it. Sizes, profile and legends follow the
// photograph keyboard/KBD_2.JPG and the drawings GIM p.22 and PSM p.34 (docs/displaywriter/models.md, Keyboard).
import * as THREE from 'three';
import { KEYS, KEY_UNIT as U } from '../../machine/wp-keys.js';
import { CASE, deckOrigin, keyRect } from './keyboard-layout.js';

export const KEYBOARD_URL = '/assets/models/wp_keyboard.glb';

// Row profile of the period's sculpted caps (Office System 6 family, GIM p.22): the far rows lean their tops toward
// the typist, the home row is level with the deck, the near rows lean back. h is the top's centre above the cap base.
const DEG = Math.PI / 180;
const PROFILE = [
  { h: 0.0128, tilt: 9 * DEG },    // row above the numbers (left and right groups)
  { h: 0.0128, tilt: 9 * DEG },    // numbers
  { h: 0.0121, tilt: 5 * DEG },    // tab row
  { h: 0.0116, tilt: 0 },          // home (lock) row
  { h: 0.0118, tilt: -4 * DEG },   // shift row
  { h: 0.0106, tilt: -7 * DEG },   // space row
];
const ENTER_DROP = 0.003;           // ENTER sits 3 mm below the space bar (ST p.62)
const TAPER = 0.0025;               // m, the straight skirt draws in this much on each side from base to shoulder
const TOP_K = 1.2;                  // the crown's edge, past the shoulder's roll, in TAPERs
const DISH = 0.001;                 // m, depth of the cylindrical dish across a cap
const R_BASE = 0.0009, R_TOP = 0.0021;

export const KEYCAP_COLOR = 0xdcd8c8;   // pearl white as the photographs show it (KBD_2.JPG, under flash)
const INK = '#1b1a18';

// ---------- outlines ----------

/** Rounded outline of a rectilinear polygon, offset inward by `inset`, each corner a `segs`-point arc of radius r. */
function outline(poly, inset, r, segs) {
  const n = poly.length, out = [], nrm = [];
  let area = 0;
  for (let i = 0; i < n; i++) { const [a, b] = poly[i], [c, d] = poly[(i + 1) % n]; area += a * d - c * b; }
  const sgn = area > 0 ? 1 : -1;      // counter-clockwise in (x, z) has positive area; inward is to the left
  for (let i = 0; i < n; i++) {
    const p = poly[i], a = poly[(i + n - 1) % n], b = poly[(i + 1) % n];
    const ea = norm2([p[0] - a[0], p[1] - a[1]]), eb = norm2([b[0] - p[0], b[1] - p[1]]);
    const na = [-ea[1] * sgn, ea[0] * sgn], nb = [-eb[1] * sgn, eb[0] * sgn];   // inward normals
    const q = [p[0] + (na[0] + nb[0]) * inset, p[1] + (na[1] + nb[1]) * inset];  // offset corner (square corners)
    const convex = (ea[0] * eb[1] - ea[1] * eb[0]) * sgn > 0;
    const rr = convex ? r : Math.max(0.0004, R_BASE * 0.6);
    // Arc centre: inward from both edges by rr (convex), outward (concave).
    const s = convex ? 1 : -1;
    const c = [q[0] + (na[0] + nb[0]) * rr * s, q[1] + (na[1] + nb[1]) * rr * s];
    const a0 = Math.atan2(-na[1] * s, -na[0] * s), a1 = Math.atan2(-nb[1] * s, -nb[0] * s);
    let da = a1 - a0; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
    for (let j = 0; j < segs; j++) {
      const t = a0 + da * (j / (segs - 1));
      out.push([c[0] + rr * Math.cos(t), c[1] + rr * Math.sin(t)]);
      const o = convex ? [Math.cos(t), Math.sin(t)] : [-Math.cos(t), -Math.sin(t)];
      nrm.push(o);                  // outward normal of the outline at this point
    }
  }
  return { pts: out, nrm };
}
const norm2 = (v) => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };

/**
 * One sculpted cap. Local frame: the base's centre at the origin, y up the stem, z toward the typist. `poly` is the
 * base footprint (rectilinear, counter-clockwise in x, z), `star` a point every part of it sees (for the crown's rings).
 * Returns the geometry and the regions its legend uv covers: the top's box and the front face's slant height.
 */
function capGeometry(poly, star, h, tilt, cell, opts = {}) {
  const segs = 7;
  const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
  const box = { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
  const ti = TAPER * TOP_K, topBox = { x0: box.x0 + ti, x1: box.x1 - ti, z0: box.z0 + ti, z1: box.z1 - ti };
  const hw = (topBox.x1 - topBox.x0) / 2, cx = (topBox.x0 + topBox.x1) / 2;
  const dish = opts.dish ?? DISH;
  // Height of the crown: a plane leaning by `tilt` with a cylinder cut across it (the axis runs front to back).
  const crown = (x, z) => { const q = Math.min(1, ((x - cx) / hw) ** 2); return h - (z - (box.z0 + box.z1) / 2) * Math.tan(tilt) - dish * (1 - q); };
  // Skirt rings from the base to the shoulder: [inset fraction, height fraction]; the last ones roll over the shoulder.
  const RINGS = [[0, 0], [0.3, 0.3], [0.6, 0.6], [0.86, 0.86], [0.99, 0.955], [1.1, 0.987], [TOP_K, 1]];
  const ring = (k) => outline(poly, TAPER * k, R_BASE + (R_TOP - R_BASE) * Math.min(1, k), segs);
  const rings = RINGS.map(([k, f]) => ({ ...ring(k), f }));
  const N = rings[0].pts.length;
  const pos = [], uv = [], uv1 = [], nor = [], idx = [];
  const blank = cell.blank;
  const P = (i, j) => { const r = rings[i], [x, z] = r.pts[j]; return new THREE.Vector3(x, crown(x, z) * r.f + 0 * (1 - r.f), z); };
  const grid = rings.map((_, i) => Array.from({ length: N }, (__, j) => P(i, j)));
  const slant = grid[0].map((p, j) => p.distanceTo(grid[rings.length - 1][j]));
  const slantFront = Math.max(...slant);
  // Skirt normals from the grid itself (smooth across the front-face seam, where the vertices are doubled).
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
  const normalAt = (i, j) => {
    const g = grid, i0 = Math.max(0, i - 1), i1 = Math.min(rings.length - 1, i + 1);
    tmpA.subVectors(g[i][(j + 1) % N], g[i][(j + N - 1) % N]);
    tmpB.subVectors(g[i1][j], g[i0][j]);
    const n = new THREE.Vector3().crossVectors(tmpA, tmpB).normalize();
    const o = rings[i].nrm[j];
    if (n.x * o[0] + n.z * o[1] < 0) n.negate();
    return n;
  };
  const front = rings[0].nrm.map((o) => o[1] > 0.55);
  const add = (p, n, u, v) => { pos.push(p.x, p.y, p.z); nor.push(n.x, n.y, n.z); uv.push(u, v); uv1.push((p.x + p.z * 0.3) / 0.2, (p.y + p.z * 0.95) / 0.2); return pos.length / 3 - 1; };
  const frontUv = (p, i, j) => cell.front
    ? cell.front((p.x - box.x0), slantFront * (1 - (i === 0 ? 0 : grid[0][j].distanceTo(p) / slant[j])))
    : blank;
  // Two copies of each skirt vertex: with the front legend's uv, and with the plain one.
  const vf = [], vn = [];
  for (let i = 0; i < rings.length; i++) {
    vf.push([]); vn.push([]);
    for (let j = 0; j < N; j++) {
      const p = grid[i][j], n = normalAt(i, j);
      vn[i].push(add(p, n, ...blank));
      vf[i].push(front[j] ? add(p, n, ...frontUv(p, i, j)) : -1);
    }
  }
  for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < N; j++) {
    const j2 = (j + 1) % N;
    const V = front[j] && front[j2] ? vf : vn;
    const a = V[i][j], b = V[i][j2], c = V[i + 1][j], d = V[i + 1][j2];
    idx.push(a, b, c, b, d, c);
  }
  // The crown: rings drawn in toward the star point, on the crown's height function, normals from its gradient.
  const top = rings[rings.length - 1];
  const scales = [1, 0.9, 0.78, 0.64, 0.5, 0.36, 0.22, 0.1];
  const e = 1e-4;
  const crownN = (x, z) => new THREE.Vector3(-(crown(x + e, z) - crown(x - e, z)) / (2 * e), 1, -(crown(x, z + e) - crown(x, z - e)) / (2 * e)).normalize();
  const topUv = (x, z) => (cell.top ? cell.top((x - topBox.x0) / (topBox.x1 - topBox.x0), (z - topBox.z0) / (topBox.z1 - topBox.z0)) : blank);
  const crownRings = scales.map((s, r) => top.pts.map(([x, z], j) => {
    const px = star[0] + (x - star[0]) * s, pz = star[1] + (z - star[1]) * s;
    const p = new THREE.Vector3(px, crown(px, pz), pz);
    // The outermost ring is the shoulder's last ring: same place, the crown's normal blended with the skirt's.
    const n = r === 0 ? crownN(px, pz).lerp(normalAt(rings.length - 1, j), 0.35).normalize() : crownN(px, pz);
    return add(p, n, ...topUv(px, pz));
  }));
  // Stitch the shoulder's last ring (blank uv) to the crown's first (legend uv): same positions, so no gap.
  for (let r = 0; r < crownRings.length - 1; r++) for (let j = 0; j < N; j++) {
    const j2 = (j + 1) % N;
    const a = crownRings[r][j], b = crownRings[r][j2], c = crownRings[r + 1][j], d = crownRings[r + 1][j2];
    idx.push(a, b, c, b, d, c);
  }
  const centre = add(new THREE.Vector3(star[0], crown(...star), star[1]), crownN(...star), ...topUv(...star));
  const last = crownRings[crownRings.length - 1];
  for (let j = 0; j < N; j++) idx.push(last[j], last[(j + 1) % N], centre);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('uv1', new THREE.Float32BufferAttribute(uv1, 2));
  geo.setIndex(idx);
  // Winding: faces must point out of the cap. Checked once on a skirt triangle against its vertex normal.
  const t0 = new THREE.Vector3().fromArray(pos, idx[0] * 3), t1 = new THREE.Vector3().fromArray(pos, idx[1] * 3), t2 = new THREE.Vector3().fromArray(pos, idx[2] * 3);
  const fn = new THREE.Vector3().crossVectors(t1.sub(t0), t2.sub(t0));
  if (fn.dot(new THREE.Vector3().fromArray(nor, idx[0] * 3)) < 0) { for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } geo.setIndex(idx); }
  geo.computeBoundingSphere();
  return { geo, topBox, box, slantFront };
}

// ---------- legends ----------

const FONT = '"Helvetica Neue", Helvetica, Arial, "Liberation Sans", FreeSans, sans-serif';
const ARROWS = new Set(['↑', '↓', '←', '→', '↖', '↙', '⇤', '⇥', '⇧', '⇩']);

/** An arrow of length L (px) pointing along angle a (0 = right, canvas y down), centred at (x, y). */
function arrow(ctx, x, y, L, a, lw, { hollow = false, bar = null } = {}) {
  const c = Math.cos(a), s = Math.sin(a), hl = L * 0.36, hwid = L * 0.2;
  const tip = [x + c * L / 2, y + s * L / 2], tail = [x - c * L / 2, y - s * L / 2];
  const base = [tip[0] - c * hl, tip[1] - s * hl];
  ctx.lineWidth = lw; ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
  if (hollow) {
    // The outlined shift-style arrow of ½⇧ and ½⇩.
    const sw = hwid * 0.45;
    ctx.beginPath();
    ctx.moveTo(...tip);
    ctx.lineTo(base[0] - s * hwid * 1.3, base[1] + c * hwid * 1.3);
    ctx.lineTo(base[0] - s * sw, base[1] + c * sw);
    ctx.lineTo(tail[0] - s * sw, tail[1] + c * sw);
    ctx.lineTo(tail[0] + s * sw, tail[1] - c * sw);
    ctx.lineTo(base[0] + s * sw, base[1] - c * sw);
    ctx.lineTo(base[0] + s * hwid * 1.3, base[1] - c * hwid * 1.3);
    ctx.closePath(); ctx.stroke();
    return;
  }
  ctx.beginPath(); ctx.moveTo(...tail); ctx.lineTo(base[0] + c * lw, base[1] + s * lw); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(...tip); ctx.lineTo(base[0] - s * hwid, base[1] + c * hwid); ctx.lineTo(base[0] + s * hwid, base[1] - c * hwid); ctx.closePath(); ctx.fill();
  if (bar) {
    // A stop bar across the arrow's head (boundary keys) or under it.
    const [bx, by, bl, ba] = bar;
    ctx.beginPath(); ctx.moveTo(bx - Math.cos(ba) * bl / 2, by - Math.sin(ba) * bl / 2); ctx.lineTo(bx + Math.cos(ba) * bl / 2, by + Math.sin(ba) * bl / 2); ctx.stroke();
  }
}

/** Draws one glyph or word centred at (x, y) with cap height `cap` px; arrows by hand, everything else as text. */
function glyph(ctx, ch, x, y, cap, weight) {
  const lw = cap * 0.13;
  switch (ch) {
    case '↑': return arrow(ctx, x, y, cap * 1.25, -Math.PI / 2, lw);
    case '↓': return arrow(ctx, x, y, cap * 1.25, Math.PI / 2, lw);
    case '←': return arrow(ctx, x, y, cap * 1.25, Math.PI, lw);
    case '→': return arrow(ctx, x, y, cap * 1.25, 0, lw);
    case '↖': return arrow(ctx, x + cap * 0.1, y + cap * 0.1, cap * 1.1, -3 * Math.PI / 4, lw, { bar: [x - cap * 0.2, y - cap * 0.55, cap * 0.8, 0] });
    case '↙': return arrow(ctx, x + cap * 0.1, y - cap * 0.1, cap * 1.1, 3 * Math.PI / 4, lw, { bar: [x - cap * 0.2, y + cap * 0.55, cap * 0.8, 0] });
    case '⇤': return arrow(ctx, x + cap * 0.1, y, cap * 1.3, Math.PI, lw, { bar: [x - cap * 0.6, y, cap * 0.75, Math.PI / 2] });
    case '⇥': return arrow(ctx, x - cap * 0.1, y, cap * 1.3, 0, lw, { bar: [x + cap * 0.6, y, cap * 0.75, Math.PI / 2] });
    case '⇧': return arrow(ctx, x, y, cap * 1.05, -Math.PI / 2, lw * 0.8, { hollow: true });
    case '⇩': return arrow(ctx, x, y, cap * 1.05, Math.PI / 2, lw * 0.8, { hollow: true });
    case '_': ctx.fillRect(x - cap * 0.5, y - lw / 2, cap, lw); return undefined;
    default:
      ctx.font = `${weight} ${cap / 0.716}px ${FONT}`;   // Helvetica's cap height is 0.716 em
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.fillText(ch, x, y + cap / 2);
      return undefined;
  }
}

/** A line of text that may hold arrows: laid out left to right with the text measured, centred at (x, y). */
function line(ctx, text, x, y, cap, weight) {
  const parts = [...text];
  if (!parts.some((c) => ARROWS.has(c))) return glyph(ctx, text, x, y, cap, weight);
  ctx.font = `${weight} ${cap / 0.716}px ${FONT}`;
  const wOf = (c) => (ARROWS.has(c) ? cap * 1.25 : ctx.measureText(c).width);
  const total = parts.reduce((s, c) => s + wOf(c), 0) + (parts.length - 1) * cap * 0.15;
  let px = x - total / 2;
  for (const c of parts) { const w = wOf(c); glyph(ctx, c, px + w / 2, y, cap, weight); px += w + cap * 0.15; }
  return undefined;
}

/**
 * Top legend, as the photographs show them: a letter alone, large, in the middle; two characters one above the other
 * (shifted over unshifted); words in small bold capitals, one or two lines.
 */
function drawTop(ctx, text, w, d, mm) {
  const lines = text.split('\n');
  const single = lines.length === 1 && [...text].length === 1;
  ctx.save(); ctx.translate(w / 2, d / 2);
  if (single && /[A-Z]/.test(text)) glyph(ctx, text, 0, -0.3 * mm, 5.0 * mm, 600);
  else if (single) glyph(ctx, text, 0, -0.3 * mm, 4.6 * mm, 600);
  else if (lines.length === 2 && lines.every((l) => [...l].length === 1)) {
    const [hi, lo] = lines;
    glyph(ctx, hi, 0, -2.6 * mm, hi === '°' ? 2.6 * mm : 3.3 * mm, 600);
    glyph(ctx, lo, 0, 2.1 * mm, 3.7 * mm, 600);
  } else {
    // Small bold capitals, made smaller where a word would crowd the cap's edges (INDEX on its narrow cap).
    ctx.font = `700 ${1.9 * mm / 0.716}px ${FONT}`;
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const k = Math.min(1, (w - 2.2 * mm) / widest);
    const cap = 1.9 * mm * k, lh = 2.55 * mm * Math.max(k, 0.85);
    lines.forEach((l, i) => line(ctx, l, 0, (i - (lines.length - 1) / 2) * lh - 0.5 * mm, cap, 700));
  }
  ctx.restore();
}

/** Front legend: small bold capitals just under the top edge (or ½ with a hollow arrow, or a boundary arrow). */
function drawFront(ctx, text, w, mm) {
  const lines = text.split('\n');
  const cap = (/[½⇤⇥↖↙]/.test(text) ? 2.0 : 1.6) * mm, lh = 2.25 * mm;
  lines.forEach((l, i) => line(ctx, l, w / 2, 1.9 * mm + cap / 2 + i * lh, cap, 700));
}

/** Shelf-packs every key's legend regions into one atlas and returns the uv mappers per key. */
function makeAtlas(caps, maxAniso) {
  const PX = 12 / 0.001;     // px per metre: 12 px/mm, crisp from the operator's seat
  const W = 2048, PAD = 6;
  let x = PAD, y = PAD + 8, rowH = 0;
  const cells = caps.map((c) => {
    const k = c.key;
    if (!k.top && !k.front) return null;
    const w = Math.ceil((c.box.x1 - c.box.x0) * PX) + PAD;
    const th = k.top ? Math.ceil((c.topBox.z1 - c.topBox.z0) * PX) : 0;
    const fh = k.front ? Math.ceil(c.slantFront * PX) : 0;
    const h = th + fh + PAD;
    if (x + w > W) { x = PAD; y += rowH; rowH = 0; }
    const cell = { x, y, w, th, fh };
    x += w; rowH = Math.max(rowH, h);
    return cell;
  });
  const H = Math.ceil((y + rowH + PAD) / 64) * 64;
  const can = document.createElement('canvas');
  can.width = W; can.height = H;
  const ctx = can.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = INK; ctx.strokeStyle = INK;
  const mm = PX * 0.001;
  const blank = [2 / W, 1 - 2 / H];
  const mappers = caps.map((c, i) => {
    const cell = cells[i];
    if (!cell) return { blank };
    const k = c.key;
    const tw = (c.topBox.x1 - c.topBox.x0) * PX, ox = (c.topBox.x0 - c.box.x0) * PX;
    if (k.top) { ctx.save(); ctx.translate(cell.x + ox, cell.y); drawTop(ctx, k.top, tw, cell.th, mm); ctx.restore(); }
    if (k.front) { ctx.save(); ctx.translate(cell.x, cell.y + cell.th); drawFront(ctx, k.front, (c.box.x1 - c.box.x0) * PX, mm); ctx.restore(); }
    return {
      blank,
      // u, v across the top's box (v from the back edge toward the typist); canvas y runs down the cell.
      top: k.top ? (u, v) => [(cell.x + ox + u * tw) / W, 1 - (cell.y + v * cell.th) / H] : null,
      // x from the base's left edge and s down the face from the top edge, in metres.
      front: k.front ? (xm, s) => [(cell.x + xm * PX) / W, 1 - (cell.y + cell.th + s * PX) / H] : null,
    };
  });
  const tex = new THREE.CanvasTexture(can);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = maxAniso; tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return { tex, mappers };
}

// ---------- the keyboard ----------

function keyShape(key) {
  const r = keyRect(key);
  const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
  const poly = (r.poly ?? [[r.x1, r.z0], [r.x0, r.z0], [r.x0, r.z1], [r.x1, r.z1]]).map(([x, z]) => [x - cx, z - cz]);
  // The L's crown is drawn from inside the corner where its arm meets its leg.
  const star = key.tall ? [r.x1 - cx - key.leg * U * 0.5, r.z0 + U * 0.5 - cz] : [0, 0];
  return { cx, cz, poly, star };
}

/**
 * Builds the keyboard in its unit frame (origin on the desk under its centre, z toward the typist). Resolves once the
 * case is loaded; the caps are built first, so they exist even if the case fails to load.
 */
export async function buildKeyboard(size, slope, mats, { url = KEYBOARD_URL, maxAniso = 8 } = {}) {
  const group = new THREE.Group();
  const deck = new THREE.Group();
  deck.name = 'deck';
  deck.position.fromArray(deckOrigin(size, slope));
  deck.rotation.x = slope;
  group.add(deck);

  // Geometry first (the atlas needs the regions), then the atlas, then the uvs into it.
  const shapes = KEYS.map((key) => ({ key, ...keyShape(key) }));
  const pre = shapes.map((s) => {
    const p = PROFILE[s.key.row];
    const h = p.h - (s.key.pos === 65 ? ENTER_DROP : 0);
    return { ...s, h, tilt: p.tilt, ...capGeometry(s.poly, s.star, h, p.tilt, { blank: [0, 0] }) };
  });
  const atlas = makeAtlas(pre, maxAniso);
  const capMat = new THREE.MeshPhysicalMaterial({ color: KEYCAP_COLOR, roughness: 0.55, metalness: 0, map: atlas.tex, ior: 1.49 });   // matte (GIM p.104)
  capMat.name = 'wp_keycap_legend';
  const keys = pre.map((s, i) => {
    s.geo.dispose();
    const wide = s.key.pos === 64 ? { dish: 0.0006 } : {};
    const { geo } = capGeometry(s.poly, s.star, s.h, s.tilt, atlas.mappers[i], wide);
    const m = new THREE.Mesh(geo, capMat);
    m.castShadow = m.receiveShadow = true;
    m.position.set(s.cx, CASE.capBase, s.cz);
    m.userData.rest = m.position.clone();
    m.name = `key${s.key.pos}`;
    deck.add(m);
    return m;
  });
  // The keycap plastic's grain once the unit materials' textures arrive, on the caps' own box uvs (uv1).
  Promise.resolve(mats.ready).then(() => {
    for (const k of ['normalMap', 'roughnessMap']) {
      const t = mats.keycap?.[k];
      if (!t) continue;
      const c = t.clone(); c.channel = 1; c.needsUpdate = true;
      capMat[k] = c;
    }
    if (capMat.roughnessMap) capMat.roughness = 0.85;
    capMat.needsUpdate = true;
  }).catch(() => {});

  try {
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const gltf = await new GLTFLoader().loadAsync(url);
    const byName = { wp_pearl: mats.pearl, wp_gray: mats.pebble, wp_dark: mats.dark, wp_rubber: mats.rubber };
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = o.receiveShadow = true;
      const m = byName[(o.material?.name ?? '').toLowerCase()];
      if (m) o.material = m;
    });
    gltf.scene.name = 'wp_keyboard_case';
    group.add(gltf.scene);
  } catch (e) { console.info('keyboard case', e); }

  const pressDir = new THREE.Vector3(0, -1, 0);   // in the deck's frame: down the stems, normal to the slope
  return { group, parts: { keys, deck, pressDir } };
}
