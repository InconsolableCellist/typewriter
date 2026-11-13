// The documentation shelf: a low two-shelf steel bookcase standing on the floor right of the desk, holding IBM's
// training materials for the Displaywriter (src/render/wp/shelf-items.js says what and where). Each manual is a grey
// vinyl 3-ring binder standing spine out, its spine insert drawn on a canvas; the diskettes, cards, the conversion ruler
// and the tent card lie on the top and in the bays. Built here, no model file.
//
// Cost: everything is merged into four meshes, so four draw calls in the main pass (and three more in the AO's depth
// and normal prepass), none in the shadow pass, and none at all while the shelf is out of the camera's frustum: the
// case, the binders' vinyl, one 2048 px atlas canvas for every printed surface (spine inserts, diskette jackets, cards,
// page edges), and the clear vinyl holders. The hover and click targets are invisible boxes, never drawn. The case
// stands outside the key light's shadow frustum, so a vertex shade darkens the bays toward the back, the walls and the
// shelf above, as the contact shade does on the desk.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { drawIbmLogo, grainCanvas } from './manual.js';
import { SHELF_BINDERS, SHELF_LOOSE, BINDER, BINDERS, CASE, binderPoses, loosePoses, shelfLabel, scanUrl } from './shelf-items.js';

const MM = 1e-3;
const BOARD = 2.4 * MM;                 // a binder's board with its vinyl
const INSERT_H = 0.26;                  // the spine insert's length
const SPX = 3000;                       // atlas pixels per metre on the spine inserts
const FPX = 1100;                       // and on the flat items
const S = 2048;                         // the atlas's side
const VINYL = 0xa29e94;                 // IBM's pebble grey, in vinyl (a shade under the units' paint)
const SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const INK = '#1d1d1f';

// ---- the atlas ----------------------------------------------------------------------------------------------------

/** Lays rectangles { key, w, h } (pixels) in rows across the atlas, from `y0` down. Returns { key: { x, y, w, h } }. */
function pack(list, y0) {
  const out = {};
  let x = 0, y = y0, row = 0;
  for (const r of [...list].sort((a, b) => b.h - a.h)) {
    if (x + r.w > S) { x = 0; y += row + 2; row = 0; }
    out[r.key] = { x, y, w: r.w, h: r.h };
    x += r.w + 2; row = Math.max(row, r.h);
  }
  if (y + row > S) throw new Error('shelf atlas overflow');
  return out;
}

const insertW = (b) => (b.w - 16 * MM);   // the insert, with the grey vinyl framing it
const px = (m, k) => Math.max(4, Math.round(m * k));

function fit(g, text, weight, size, x, y, max) {
  g.font = `${weight} ${Math.round(size)}px ${SANS}`;
  g.fillText(text, x, y, max);
}

/** A spine insert: the logo across its head, then the system's name, the title and the pack set down its length. */
function drawSpine(g, r, b) {
  const { x, y, w, h } = r;
  g.fillStyle = '#efece4'; g.fillRect(x, y, w, h);
  g.fillStyle = 'rgba(0,0,0,0.05)'; g.fillRect(x, y, w, h * 0.004); g.fillRect(x, y + h * 0.996, w, h * 0.004);
  // The logo at the head, across.
  const lh = Math.min(w * 0.22, 26);
  drawIbmLogo(g, x + (w - lh * 3.05) / 2, y + h * 0.035, lh, INK);
  g.fillStyle = INK; g.fillRect(x + w * 0.15, y + h * 0.035 + lh + h * 0.02, w * 0.7, Math.max(2, h * 0.002));
  // A binder whose scan can be read here wears a green band under its logo, a sticker marking the copy to read.
  if (scanUrl(b)) {
    const by = y + h * 0.105, bh = h * 0.055;
    g.fillStyle = '#1f9d55'; g.fillRect(x, by, w, bh);
    g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    fit(g, 'READ', 700, Math.min(bh * 0.62, w * 0.24), x + w / 2, by + bh * 0.52, w * 0.86);
    g.textAlign = 'left';
  }
  // The rest down the spine, read with the head to the right (the way a spine is read on the shelf).
  g.save();
  g.translate(x + w / 2, y + h * 0.18);
  g.rotate(Math.PI / 2);
  const L = h * 0.78;                                   // the length available
  g.textBaseline = 'middle'; g.textAlign = 'left';
  const lines = b.title.length;
  const ts = Math.min(w * (lines > 1 ? 0.2 : 0.26), 36);
  g.fillStyle = '#4a4a4c';
  fit(g, 'IBM Displaywriter System', 400, ts * 0.62, 0, -w * (lines > 1 ? 0.3 : 0.22), L * 0.7);
  g.fillStyle = INK;
  b.title.forEach((t, i) => fit(g, t, 700, ts, 0, (lines > 1 ? -w * 0.03 : w * 0.1) + i * ts * 1.1, L * 0.8));
  if (b.pack) { g.fillStyle = '#303032'; fit(g, b.pack, 400, ts * 0.72, 0, w * 0.36, L * 0.6); }
  g.restore();
  // The order number across the foot.
  g.fillStyle = '#3a3a3c'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  fit(g, b.order, 400, Math.min(w * 0.17, 26), x + w / 2, y + h * 0.985, w * 0.9);
  g.textAlign = 'left';
}

function title(g, r, lines, { color = INK, size = 0.07, top = 0.12, left = 0.08 } = {}) {
  g.fillStyle = color; g.textBaseline = 'alphabetic';
  lines.forEach(([t, wgt, k = 1], i) => fit(g, t, wgt, r.h * size * k, r.x + r.w * left, r.y + r.h * (top + i * size * 1.25), r.w * (1 - 2 * left)));
}

/** Grey rules for lines of type too small to read at this size. */
function typeLines(g, r, y0, y1, n, color = 'rgba(40,40,44,0.35)', x0 = 0.08, x1 = 0.92) {
  g.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const yy = r.y + r.h * (y0 + (y1 - y0) * i / Math.max(1, n - 1));
    const len = (x1 - x0) * (0.55 + 0.45 * Math.abs(Math.sin(i * 7.31)));
    g.fillRect(r.x + r.w * x0, yy, r.w * len, Math.max(1, r.h * 0.008));
  }
}

const DRAW = {
  diskette(g, r, it) {
    const { x, y, w, h } = r;
    g.fillStyle = '#18181a'; g.fillRect(x, y, w, h);
    g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(x, y, w, h * 0.5);
    // The hub, the index hole and the head window, the brown oxide showing through.
    g.fillStyle = '#4b3a2b'; g.beginPath(); g.arc(x + w / 2, y + h / 2, w * 0.17, 0, 7); g.fill();
    g.fillStyle = '#9b958a'; g.beginPath(); g.arc(x + w / 2, y + h / 2, w * 0.095, 0, 7); g.fill();
    g.fillStyle = '#4b3a2b'; g.beginPath(); g.arc(x + w * 0.66, y + h * 0.58, w * 0.012, 0, 7); g.fill();
    g.beginPath(); g.roundRect?.(x + w * 0.46, y + h * 0.72, w * 0.08, h * 0.22, w * 0.04); g.fill();
    // The label, top left.
    const lx = x + w * 0.06, ly = y + h * 0.05, lw = w * 0.62, lh = h * 0.24;
    g.fillStyle = '#f2efe6'; g.fillRect(lx, ly, lw, lh);
    drawIbmLogo(g, lx + lw * 0.05, ly + lh * 0.1, lh * 0.15, INK);
    g.fillStyle = INK; g.textBaseline = 'alphabetic';
    fit(g, 'Displaywriter System', 400, lh * 0.13, lx + lw * 0.32, ly + lh * 0.24, lw * 0.64);
    fit(g, it.kind === 'diskette' && it.id === 'memory' ? 'Memory Record Diskette' : 'Training Diskette', 400, lh * 0.13, lx + lw * 0.05, ly + lh * 0.46, lw * 0.9);
    fit(g, it.label === 'MEMORY RECORD' ? 'MEMORY' : it.label, 700, lh * 0.27, lx + lw * 0.05, ly + lh * 0.76, lw * 0.9);
    g.fillStyle = '#444'; fit(g, `${it.order}${it.id === 'report' ? '  Reportpack' : it.id === 'memory' ? '' : '  Textpack 4'}`, 400, lh * 0.11, lx + lw * 0.05, ly + lh * 0.93, lw * 0.9);
    g.fillStyle = '#d8d3c6'; g.fillRect(x + w * 0.74, y + h * 0.05, w * 0.2, h * 0.03);   // write-protect notch tab
  },
  tent(g, r, it) {
    g.fillStyle = '#f3f1ea'; g.fillRect(r.x, r.y, r.w, r.h);
    g.fillStyle = '#1a1fa6'; g.fillRect(r.x, r.y, r.w, r.h * 0.26);
    drawIbmLogo(g, r.x + r.w * 0.06, r.y + r.h * 0.06, r.h * 0.13, '#eef');
    title(g, r, [['IBM Displaywriter System', 400, 0.8], ['Training', 700, 1.6]], { top: 0.52, size: 0.13 });
    g.fillStyle = '#555'; fit(g, it.order, 400, r.h * 0.07, r.x + r.w * 0.08, r.y + r.h * 0.93, r.w * 0.5);
  },
  ruler(g, r, it) {
    const { x, y, w, h } = r;
    g.fillStyle = '#ece9df'; g.fillRect(x, y, w, h);
    g.fillStyle = INK;
    // Three scales: inches above, 10 and 12 characters to the inch below, each ticked from the left end.
    const scale = (perIn, y0, dir, long) => {
      const n = Math.floor(12 * perIn);
      for (let i = 0; i <= n; i++) {
        const xx = x + w * 0.01 + (w * 0.98) * i / (12 * perIn);
        const len = (i % long === 0 ? 0.3 : i % (long / 2) === 0 ? 0.2 : 0.12) * h;
        g.fillRect(xx, dir > 0 ? y0 : y0 - len, 1, len);
      }
    };
    scale(8, y, 1, 8); scale(10, y + h, -1, 10);
    g.font = `400 ${Math.round(h * 0.2)}px ${SANS}`; g.textBaseline = 'middle';
    g.fillText('IBM Conversion Ruler    10 pitch    12 pitch    inches', x + w * 0.12, y + h * 0.5, w * 0.6);
    g.fillText(it.order, x + w * 0.8, y + h * 0.5, w * 0.15);
  },
  template(g, r, it) {
    g.fillStyle = '#f1efe8'; g.fillRect(r.x, r.y, r.w, r.h);
    title(g, r, [[`${it.pack} Keyboard Template`, 700]], { size: 0.08, top: 0.11, left: 0.04 });
    g.fillStyle = '#666'; fit(g, it.order, 400, r.h * 0.06, r.x + r.w * 0.82, r.y + r.h * 0.11, r.w * 0.16);
    // The four key groups as boxes.
    const kx = r.x + r.w * 0.04, ky = r.y + r.h * 0.2, kw = r.w * 0.92, kh = r.h * 0.74;
    g.strokeStyle = 'rgba(30,30,34,0.7)'; g.lineWidth = 1;
    const unit = kw / 20;
    for (let row = 0; row < 5; row++) {
      for (let c = 0; c < 18; c++) {
        const cx = kx + unit * (c + (row % 2) * 0.5 + (c > 13 ? 1 : 0)), cy = ky + (kh / 5) * row;
        g.strokeRect(cx + 1, cy + 1, unit - 3, kh / 5 - 3);
        if ((c * 3 + row) % 4 === 0) { g.fillStyle = it.pack === 'Reportpack' ? 'rgba(160,40,40,0.35)' : 'rgba(26,31,166,0.3)'; g.fillRect(cx + 2, cy + kh / 10, unit - 5, kh / 10 - 4); }
      }
    }
  },
  bypass(g, r, it) {
    g.fillStyle = '#f2efe4'; g.fillRect(r.x, r.y, r.w, r.h);
    title(g, r, [['Menu Bypass', 700], ['Abbreviations', 700]], { size: 0.075, top: 0.1 });
    typeLines(g, r, 0.32, 0.9, 16);
    g.fillStyle = '#666'; fit(g, it.order, 400, r.h * 0.04, r.x + r.w * 0.08, r.y + r.h * 0.97, r.w * 0.6);
  },
  assembly(g, r, it) {
    g.fillStyle = '#f3f0e6'; g.fillRect(r.x, r.y, r.w, r.h);
    drawIbmLogo(g, r.x + r.w * 0.08, r.y + r.h * 0.06, r.h * 0.035, INK);
    title(g, r, [['IBM Displaywriter System', 400, 0.8], [it.pack === 'Reportpack' ? 'Reportpack Assembly Card' : 'Assembly Card', 700], [it.pack ?? '', 400, 0.8]], { size: 0.05, top: 0.17 });
    typeLines(g, r, 0.36, 0.86, 14);
    g.fillStyle = '#666'; fit(g, it.order, 400, r.h * 0.03, r.x + r.w * 0.08, r.y + r.h * 0.95, r.w * 0.5);
  },
  divider(g, r, it) {
    g.fillStyle = '#d6bd78'; g.fillRect(r.x, r.y, r.w * 0.92, r.h);
    // The tab, standing out at the right.
    const ty = it.tab ? 0.08 : 0.3;
    g.fillRect(r.x + r.w * 0.92, r.y + r.h * ty, r.w * 0.08, r.h * 0.14);
    g.fillStyle = 'rgba(0,0,0,0)';
    g.save(); g.translate(r.x + r.w * 0.96, r.y + r.h * (ty + 0.07)); g.rotate(Math.PI / 2);
    g.fillStyle = INK; g.textAlign = 'center'; g.textBaseline = 'middle';
    fit(g, it.tab ?? '', 700, r.w * 0.04, 0, 0, r.h * 0.13);
    g.restore(); g.textAlign = 'left';
    g.fillStyle = 'rgba(90,70,30,0.6)'; fit(g, `IBM ${it.order}`, 400, r.h * 0.025, r.x + r.w * 0.06, r.y + r.h * 0.96, r.w * 0.4);
  },
  labels(g, r, it) {
    g.fillStyle = '#efe7b8'; g.fillRect(r.x, r.y, r.w, r.h);
    title(g, r, [['Program Diskette (Duplicate) Labels', 700]], { size: 0.032, top: 0.07 });
    for (let j = 0; j < 6; j++) for (let i = 0; i < 2; i++) {
      const lx = r.x + r.w * (0.07 + i * 0.45), ly = r.y + r.h * (0.12 + j * 0.135);
      g.fillStyle = '#fbfaf5'; g.fillRect(lx, ly, r.w * 0.41, r.h * 0.115);
      drawIbmLogo(g, lx + r.w * 0.02, ly + r.h * 0.015, r.h * 0.016, INK);
      g.fillStyle = INK; fit(g, 'Textpack 4  Duplicate', 400, r.h * 0.018, lx + r.w * 0.02, ly + r.h * 0.06, r.w * 0.37);
      typeLines(g, { x: lx, y: ly, w: r.w * 0.41, h: r.h * 0.115 }, 0.7, 0.9, 2);
    }
    g.fillStyle = '#666'; fit(g, it.order, 400, r.h * 0.022, r.x + r.w * 0.07, r.y + r.h * 0.95, r.w * 0.5);
  },
  pageEdge(g, r) {
    g.fillStyle = '#e9e5d8'; g.fillRect(r.x, r.y, r.w, r.h);
    for (let yy = 0; yy < r.h; yy += 2) { g.fillStyle = `rgba(90,80,60,${0.05 + 0.08 * Math.abs(Math.sin(yy * 12.9898) % 1)})`; g.fillRect(r.x, r.y + yy, r.w, 1); }
    for (const [f, c] of [[0.3, '#c9b25a'], [0.62, '#6f8fb5']]) { g.fillStyle = c; g.fillRect(r.x, r.y + r.h * f, r.w, r.h * 0.03); }
  },
};

const LOOSE = Object.fromEntries(SHELF_LOOSE.map((it) => [it.id, it]));
const itemOf = (id) => LOOSE[id] ?? LOOSE[id.replace(/2$/, '')];

/** Where everything goes in the atlas, then draws it. Returns { canvas, rects, draw }. */
function makeAtlas() {
  const binders = Object.fromEntries(SHELF_BINDERS.map((b) => [b.id, b]));
  const spineRects = [];
  let x = 0;
  for (const b of SHELF_BINDERS) {
    const w = px(insertW({ w: binderSpine(b) }), SPX), h = px(INSERT_H, SPX);
    spineRects.push([b.id, { x, y: 0, w, h }]);
    x += w + 2;
  }
  if (x > S) throw new Error('shelf atlas: spines overflow');
  const flats = [];
  const poses = loosePoses();
  const seen = new Set();
  for (const p of poses) {
    const it = itemOf(p.id);
    if (it.kind === 'holder' || seen.has(it.id)) continue;
    seen.add(it.id);
    const [w, , d] = it.kind === 'tent' ? [p.size[0], 0, p.size[1]] : p.size;
    flats.push({ key: it.id, w: px(w, FPX), h: px(d, FPX) });
  }
  flats.push({ key: 'white', w: 8, h: 8 }, { key: 'black', w: 8, h: 8 }, { key: 'buff', w: 8, h: 8 }, { key: 'pageEdge', w: 64, h: 256 });
  const rects = { ...Object.fromEntries(spineRects), ...pack(flats, px(INSERT_H, SPX) + 4) };
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = S;
  const draw = () => {
    const g = canvas.getContext('2d');
    g.fillStyle = '#efece4'; g.fillRect(0, 0, S, S);
    for (const [id, r] of spineRects) drawSpine(g, r, binders[id]);
    for (const id of seen) DRAW[LOOSE[id].kind](g, rects[id], LOOSE[id]);
    g.fillStyle = '#f2efe7'; g.fillRect(rects.white.x, rects.white.y, 8, 8);
    g.fillStyle = '#18181a'; g.fillRect(rects.black.x, rects.black.y, 8, 8);
    g.fillStyle = '#c9b06c'; g.fillRect(rects.buff.x, rects.buff.y, 8, 8);
    DRAW.pageEdge(g, rects.pageEdge);
  };
  draw();
  return { canvas, rects, draw };
}

function binderSpine(b) { return BINDERS[b.ring].spine; }

// ---- geometry -----------------------------------------------------------------------------------------------------

/** Sets a box's faces' UVs to atlas rects: `faces` [px, nx, py, ny, pz, nz], each a rect or null (left 0..1). */
function boxUV(geo, faces) {
  const uv = geo.attributes.uv;
  faces.forEach((r, f) => {
    if (!r) return;
    const inset = r.w > 16 ? 0 : 2;     // a solid patch: sample its middle
    const u0 = (r.x + inset) / S, u1 = (r.x + r.w - inset) / S, v1 = 1 - (r.y + inset) / S, v0 = 1 - (r.y + r.h - inset) / S;
    for (let i = f * 4; i < f * 4 + 4; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  });
  return geo;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(1, 1, 1), _v = new THREE.Vector3();
function placed(geo, m) { return geo.applyMatrix4(m); }
function mat4(x, y, z, rx = 0, ry = 0, rz = 0, order = 'YZX') {
  return new THREE.Matrix4().compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, order)), _s);
}

/** The shade of the bays at a point of the case's frame: darker toward the back, the walls and the shelf above. */
function shadeAt(x, y, z) {
  const inside = Math.abs(x) < CASE.inner / 2 + 1e-4 && y < CASE.h - CASE.board + 1e-4 && y > CASE.plinth - 1e-4;
  if (!inside) return 1;
  const cl = (t) => Math.max(0, Math.min(1, t));
  const back = 1 - 0.6 * cl((CASE.d / 2 - z) / 0.3);
  const bay = y >= CASE.bays[1] - 1e-4 ? 1 : 0;
  const ceil = CASE.bays[bay] + CASE.bay;
  const top = 1 - 0.45 * (1 - cl((ceil - y) / 0.1));
  const wall = 1 - 0.25 * (1 - cl((CASE.inner / 2 - Math.abs(x)) / 0.08));
  return back * top * wall;
}

function shade(geo) {
  const p = geo.attributes.position, c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { const k = shadeAt(p.getX(i), p.getY(i), p.getZ(i)); c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = k; }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}

/** The case: two sides, the plinth, three boards and the back, in one geometry, each with UVs in metres for the grain. */
function caseGeometry() {
  const { w, d, h, side, board, back, plinth, inner, bays, bay } = CASE;
  const parts = [];
  const add = (sx, sy, sz, x, y, z) => parts.push(new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z));
  add(side, h, d, -w / 2 + side / 2, h / 2, 0);
  add(side, h, d, w / 2 - side / 2, h / 2, 0);
  add(inner, plinth, side, 0, plinth / 2, d / 2 - 0.03);                 // the toe kick, set back
  add(inner, board, d - back, 0, bays[0] - board / 2, back / 2);
  add(inner, board, d - back, 0, bays[1] - board / 2, back / 2);
  add(w + 0.006, board, d + 0.006, 0, h - board / 2, 0.002);              // the top overhangs a hair
  add(inner, h - plinth, back, 0, plinth + (h - plinth) / 2, -d / 2 + back / 2);
  void bay;
  return mergeGeometries(parts);
}

/** One binder in its own frame: foot centred at the origin, spine toward +z. Returns { vinyl, printed }. */
function binderGeometry(b, w, rects) {
  const { h, d } = BINDER;
  const vinyl = [
    new THREE.BoxGeometry(BOARD, h, d - BOARD).translate(-w / 2 + BOARD / 2, h / 2, -BOARD / 2),
    new THREE.BoxGeometry(BOARD, h, d - BOARD).translate(w / 2 - BOARD / 2, h / 2, -BOARD / 2),
    new THREE.BoxGeometry(w, h, BOARD).translate(0, h / 2, d / 2 - BOARD / 2),
  ];
  const pw = w - 2 * BOARD - 4 * MM, ph = h - 10 * MM, pd = d - BOARD - 9 * MM;
  const E = rects.pageEdge, W = rects.white;
  const pages = boxUV(new THREE.BoxGeometry(pw, ph, pd), [E, E, W, W, E, E]).translate(0, h / 2, -BOARD - pd / 2 + d / 2 - 2 * MM);
  const insert = boxUV(new THREE.PlaneGeometry(insertW({ w }), INSERT_H), [rects[b.id]]).translate(0, h / 2 + 2 * MM, d / 2 + 0.35 * MM);
  return { vinyl, printed: [pages, insert] };
}

// ---- the shelf ----------------------------------------------------------------------------------------------------

/**
 * Stands the bookcase at layout spot { x, z, floor, yaw }. Returns { group, box, boxes: { shelf, shelfBinders,
 * shelfTop }, picks: [{ object, item }], drawCalls }.
 */
export function createShelf({ scene, renderer, spot }) {
  const aniso = renderer?.capabilities?.getMaxAnisotropy?.() ?? 4;
  const group = new THREE.Group();
  group.name = 'shelf';
  const atlas = makeAtlas(), R = atlas.rects;
  const tex = new THREE.CanvasTexture(atlas.canvas);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = aniso;
  document.fonts?.ready?.then(() => { atlas.draw(); tex.needsUpdate = true; });

  const vinylParts = [], printed = [], clear = [], picks = [];
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  const addHit = (size, m, item) => {
    const hit = new THREE.Mesh(new THREE.BoxGeometry(...size), hitMat);
    hit.applyMatrix4(m); hit.name = `shelf-${item.id}`;
    group.add(hit); picks.push({ object: hit, item });
  };

  const byId = Object.fromEntries(SHELF_BINDERS.map((b) => [b.id, b]));
  for (const p of binderPoses()) {
    const b = byId[p.id];
    const m = mat4(p.x, p.y, p.z, 0, p.yaw, p.tilt, 'ZYX');
    const g = binderGeometry(b, p.w, R);
    for (const v of g.vinyl) vinylParts.push(placed(v, m));
    for (const v of g.printed) printed.push(placed(v, m));
    addHit([p.w + 3 * MM, BINDER.h + 2 * MM, 0.03], new THREE.Matrix4().multiplyMatrices(m, new THREE.Matrix4().makeTranslation(0, BINDER.h / 2, BINDER.d / 2 - 0.015)), b);
  }

  for (const p of loosePoses()) {
    const it = itemOf(p.id), [w, t, d] = p.size;
    const m = mat4(p.at[0], p.at[1], p.at[2], 0, p.yaw, 0);
    if (it.kind === 'holder') {
      clear.push(placed(new THREE.BoxGeometry(w, t, d).translate(0, t / 2, 0), m));
      if (p.id === 'holder') addHit([w, 0.006, d], new THREE.Matrix4().multiplyMatrices(m, new THREE.Matrix4().makeTranslation(0, 0.003, 0)), it);
      continue;
    }
    if (it.kind === 'tent') {
      // Two panels leaning together, the title on both faces.
      const L = p.size[1], half = p.size[2] / 2, a = Math.asin(half / L), T = 0.5 * MM;
      for (const sgn of [1, -1]) {
        const g = boxUV(new THREE.BoxGeometry(w, L, T), [R.white, R.white, R.white, R.white, sgn > 0 ? R.tent : R.white, sgn > 0 ? R.white : R.tent]);
        g.applyMatrix4(mat4(0, (L * Math.cos(a)) / 2, (sgn * half) / 2, -sgn * a, 0, 0));
        printed.push(placed(g, m));
      }
      addHit([w, L, p.size[2]], new THREE.Matrix4().multiplyMatrices(m, new THREE.Matrix4().makeTranslation(0, L / 2, 0)), it);
      continue;
    }
    const side = it.kind === 'diskette' ? R.black : it.kind === 'divider' ? R.buff : R.white;
    const g = boxUV(new THREE.BoxGeometry(w, t, d), [side, side, R[it.id], side, side, side]).translate(0, t / 2, 0);
    printed.push(placed(g, m));
    if (!p.id.endsWith('2')) addHit([w, Math.max(t, 0.004), d], new THREE.Matrix4().multiplyMatrices(m, new THREE.Matrix4().makeTranslation(0, t / 2, 0)), it);
  }

  // The materials: four draw calls in all.
  const grain = new THREE.CanvasTexture(grainCanvas(256, 13));
  grain.wrapS = grain.wrapT = THREE.RepeatWrapping; grain.repeat.set(4, 4);
  const meshes = [
    [shade(caseGeometry()), new THREE.MeshStandardMaterial({ color: 0x3f3a35, roughness: 0.62, metalness: 0, vertexColors: true })],
    [shade(mergeGeometries(vinylParts)), new THREE.MeshPhysicalMaterial({ color: VINYL, roughness: 0.66, roughnessMap: grain, bumpMap: grain, bumpScale: 0.4, clearcoat: 0.25, clearcoatRoughness: 0.5, sheen: 0.2, sheenColor: new THREE.Color(0x9098a8), vertexColors: true })],
    [shade(mergeGeometries(printed)), new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.62, clearcoat: 0.3, clearcoatRoughness: 0.3, vertexColors: true })],
    [shade(mergeGeometries(clear)), new THREE.MeshPhysicalMaterial({ color: 0xdfe6ea, roughness: 0.18, transparent: true, opacity: 0.22, depthWrite: false, vertexColors: true })],
  ];
  const names = ['case', 'binders', 'printed', 'holders'];
  const [caseMesh] = meshes.map(([geo, mat], i) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `shelf-${names[i]}`;
    // Outside the key light's shadow frustum, whose edge would cut across the case: the vertex shade stands in.
    mesh.castShadow = false; mesh.receiveShadow = false;
    group.add(mesh);
    return mesh;
  });

  group.position.set(spot.x, spot.floor, spot.z);
  group.rotation.y = spot.yaw ?? 0;
  scene.add(group);
  group.updateMatrixWorld(true);
  const toBox = (objs) => {
    const b = new THREE.Box3();
    for (const o of objs) b.expandByObject(o);
    return { min: b.min.toArray(), max: b.max.toArray() };
  };
  const binderHits = picks.filter((p) => p.item.title).map((p) => p.object);
  const topHits = picks.filter((p) => !p.item.title && p.object.getWorldPosition(new THREE.Vector3()).y > spot.floor + CASE.h - 0.01).map((p) => p.object);
  const shelf = toBox([caseMesh]);
  const top = toBox(topHits);
  top.max[1] += 0.03;                   // a little air over the cards
  return {
    group, picks, drawCalls: meshes.length, box: shelf,
    boxes: { shelf, shelfBinders: toBox(binderHits), shelfTop: top },
    label: (item) => shelfLabel(item),
  };
}
