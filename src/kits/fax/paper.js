// The FO-70's paper on the desk (docs/fax/plan.md M7): the printed strip coming out of the print slot, its texture
// written line by line from the head model's darkness (the host's `print line` events), the cut sheets falling onto
// the received pile in front of the machine, and the document in the feeder. All in the body's frame
// (docs/fax/models.md: x right, y up, z toward the operator), on the model's paths (fax_print_path, fax_doc_path).
import * as THREE from 'three';

// Along the strip: one canvas row a printed line at fine (7.7 a mm); across: 4 px a mm (two head dots a pixel).
export const ROWS_PER_M = 7700;
const W = 864;
const MAX_ROWS = 3600;                         // 0.47 m of strip: a page and its margins
const PAPER = [238, 235, 222], INK = [38, 36, 48];   // the thermal paper's ground and its black [A]
const WIDTH = 0.216;
const X = 0.0226;                              // the paper path's centre in x (fax_fo70.json printPath.center)
// Where the strip leaves the slot and the way it falls to the desk: [z, y] in the body's frame. The first point is the
// slot's mouth (fax_print_path); then the paper curls down onto the desk and lies flat [A].
const STRIP_PATH = [[0.118, 0.019], [0.132, 0.0175], [0.148, 0.011], [0.162, 0.004], [0.176, 0.0012], [0.6, 0.0012]];

function pathAt(path, d) {
  for (let i = 1; i < path.length; i++) {
    const [z0, y0] = path[i - 1], [z1, y1] = path[i];
    const L = Math.hypot(z1 - z0, y1 - y0);
    if (d <= L || i === path.length - 1) { const f = Math.min(1, d / L); return [z0 + (z1 - z0) * f, y0 + (y1 - y0) * f]; }
    d -= L;
  }
  return path[path.length - 1];
}

/** A canvas of thermal paper rows; `paint(row, darkness)` writes one head line (1728 dots). */
function paperCanvas(rows) {
  const c = document.createElement('canvas');
  c.width = W; c.height = rows;
  const g = c.getContext('2d');
  g.fillStyle = `rgb(${PAPER.join(',')})`; g.fillRect(0, 0, W, rows);
  return { c, g };
}

const rowImage = (g) => g.createImageData(W, 1);
function fillRow(img, darkness) {
  const d = img.data;
  for (let x = 0; x < W; x++) {
    const k = ((darkness[2 * x] + darkness[2 * x + 1]) / 510);
    const o = x * 4;
    d[o] = PAPER[0] + (INK[0] - PAPER[0]) * k; d[o + 1] = PAPER[1] + (INK[1] - PAPER[1]) * k;
    d[o + 2] = PAPER[2] + (INK[2] - PAPER[2]) * k; d[o + 3] = 255;
  }
}

export class PrintedStrip {
  /** exitAt: m of strip from the head line to the slot's mouth (machine.mech.printer.exitAt). */
  constructor({ exitAt = 0.03 } = {}) {
    this.exitAt = exitAt;
    const { c, g } = paperCanvas(MAX_ROWS);
    this.canvas = c; this.g = g; this.img = rowImage(g);
    this.origin = null;                        // the strip coordinate of canvas row 0 (the leading end)
    this.tex = new THREE.CanvasTexture(c);
    this.tex.flipY = false;
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    this.seg = 48;
    this.geo = new THREE.PlaneGeometry(1, 1, 1, this.seg);
    this.mesh = new THREE.Mesh(this.geo, new THREE.MeshStandardMaterial({ map: this.tex, roughness: 0.55, side: THREE.DoubleSide }));
    this.mesh.name = 'printedStrip';
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.dirty = false;
  }

  /** A printed line at strip coordinate `coord` (m). */
  line(coord, darkness, lead) {
    if (this.origin === null) this.origin = lead;
    const r = Math.round((coord - this.origin) * ROWS_PER_M);
    if (r < 0 || r >= MAX_ROWS) return;
    fillRow(this.img, darkness);
    this.g.putImageData(this.img, 0, r);
    this.dirty = true;
  }

  /**
   * The cutter parted the strip at `to` (m): returns the piece's canvas (from the leading end to the cut) and moves
   * what remains to the canvas's top.
   */
  cut({ from, to }) {
    if (this.origin === null) this.origin = from;
    const r0 = Math.max(0, Math.round((from - this.origin) * ROWS_PER_M));
    const r1 = Math.min(MAX_ROWS, Math.max(r0 + 1, Math.round((to - this.origin) * ROWS_PER_M)));
    const piece = paperCanvas(r1 - r0);
    piece.g.drawImage(this.canvas, 0, r0, W, r1 - r0, 0, 0, W, r1 - r0);
    const rest = MAX_ROWS - r1;
    if (rest > 0) this.g.drawImage(this.canvas, 0, r1, W, rest, 0, 0, W, rest);
    this.g.fillStyle = `rgb(${PAPER.join(',')})`; this.g.fillRect(0, Math.max(0, rest), W, MAX_ROWS - Math.max(0, rest));
    this.origin = to;
    this.dirty = true;
    return { canvas: piece.c, lengthM: to - from };
  }

  /** Lay the strip's out-of-slot part along the path: u the payout, lead the leading end's coordinate. */
  update(u, lead) {
    if (this.origin === null) this.origin = lead;
    const L = u - lead - this.exitAt;
    this.mesh.visible = L > 0.0015;
    if (!this.mesh.visible) return;
    const pos = this.geo.attributes.position, uv = this.geo.attributes.uv;
    const n = this.seg;
    for (let j = 0; j <= n; j++) {
      const d = (L * j) / n;                         // from the slot outward
      const [z, y] = pathAt(STRIP_PATH, d);
      const coord = u - this.exitAt - d;
      const v = ((coord - this.origin) * ROWS_PER_M) / MAX_ROWS;
      for (let i = 0; i <= 1; i++) {
        const k = j * 2 + i;
        pos.setXYZ(k, X + (i ? WIDTH / 2 : -WIDTH / 2), y, z);
        uv.setXY(k, 1 - i, v);     // print side up, the page's top furthest out: seen from the front, upside down
      }
    }
    pos.needsUpdate = true; uv.needsUpdate = true;
    this.geo.computeVertexNormals();
    this.geo.computeBoundingSphere();
    if (this.dirty) { this.tex.needsUpdate = true; this.dirty = false; }
  }
}

/**
 * The received pages: each cut sheet falls from the strip's place onto the pile in front of the machine. `pile` is
 * the pile's place in the body's frame ({ x, z }). Pages are { canvas, lengthM, at }.
 */
export class ReceivedPile {
  constructor({ pile, onPage = null } = {}) {
    this.group = new THREE.Group();
    this.group.name = 'receivedPile';
    this.pile = pile;
    this.pages = [];
    this.falling = [];
    this.onPage = onPage;
  }

  add({ canvas, lengthM }) {
    const tex = new THREE.CanvasTexture(canvas);        // flipY: the canvas's top row (the page's top) at the far edge
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const geo = new THREE.PlaneGeometry(WIDTH, lengthM);
    geo.rotateX(-Math.PI / 2);                        // lying on the desk face up, its top toward the machine (turned round to be read)
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, side: THREE.DoubleSide }));
    m.castShadow = m.receiveShadow = true;
    m.name = `received${this.pages.length + 1}`;
    const k = this.pages.length;
    const yaw = Math.sin(k * 2.3) * 0.06;
    const to = new THREE.Vector3(this.pile.x + Math.sin(k * 1.7) * 0.006, 0.0006 + k * 0.0003, this.pile.z + Math.cos(k * 1.3) * 0.005);
    const from = new THREE.Vector3(X, 0.02, 0.118 + 0.012 + lengthM / 2);
    m.position.copy(from);
    this.group.add(m);
    const page = { canvas, lengthM, mesh: m, wallMs: Date.now() };
    this.pages.push(page);
    this.falling.push({ m, from, to, yaw, t: 0 });
    this.onPage?.(page);
    return page;
  }

  /** The fall: slide forward off the strip's end and settle on the pile, with a little turn. */
  update(dt) {
    for (const f of this.falling) {
      f.t = Math.min(1, f.t + dt / 0.9);
      const e = f.t * f.t * (3 - 2 * f.t);
      f.m.position.lerpVectors(f.from, f.to, e);
      f.m.position.y += Math.sin(Math.PI * f.t) * 0.02;
      f.m.rotation.y = f.yaw * e;
      f.m.rotation.x = Math.sin(Math.PI * f.t) * 0.25;
    }
    this.falling = this.falling.filter((f) => f.t < 1);
  }

  get meshes() { return this.pages.map((p) => p.mesh); }
}

/**
 * The document in the feeder: the sheet lying on the sloping table (the model's fax_doc_path, its first leg), slid
 * along it as the feeder takes it in (the snapshot's sheetS), and shown out at the front once fed through.
 */
const DOC_PATH = [[-0.03, 0.126], [-0.004, 0.101], [0.05, 0.066], [0.1, 0.0385], [0.118, 0.0318], [0.16, 0.03]];

export class FeederSheet {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'feederSheets';
    this.sheets = new Map();          // id -> { mesh, lengthM, state: 'tray' | 'out', t }
  }

  /** A sheet laid in the tray: `thumb` a canvas of its face, `index` its place in the stack. */
  add(id, { thumb, widthMm = 216, heightMm = 279, index = 0 }) {
    const tex = new THREE.CanvasTexture(thumb);
    tex.colorSpace = THREE.SRGBColorSpace;
    const L = heightMm / 1000;
    const geo = new THREE.PlaneGeometry(widthMm / 1000, L);
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, side: THREE.DoubleSide }));
    m.castShadow = m.receiveShadow = true;
    m.name = `document-${id}`;
    this.group.add(m);
    this.sheets.set(id, { mesh: m, lengthM: L, state: 'tray', index, t: 0 });
  }

  /** The sheet has left the feeder at the front. */
  out(id) { const s = this.sheets.get(id); if (s) { s.state = 'out'; s.t = 0; } }
  remove(id) { const s = this.sheets.get(id); if (s) { this.group.remove(s.mesh); this.sheets.delete(id); } }

  /** fed: how far the first moving sheet's leading edge is past the separation nip (m), or < 0. */
  update(dt, firstId, fed) {
    const [z0, y0] = DOC_PATH[0], [z1, y1] = DOC_PATH[1];
    const dir = new THREE.Vector2(z1 - z0, y1 - y0).normalize();
    const slope = Math.atan2(-(y1 - y0), z1 - z0);
    for (const [id, s] of this.sheets) {
      const m = s.mesh;
      if (s.state === 'out') {
        s.t += dt;
        m.position.set(X, 0.03 - Math.min(0.028, s.t * 0.05), 0.118 + s.lengthM / 2 + Math.min(0.06, s.t * 0.2));
        m.rotation.set(-Math.PI / 2, 0, 0);
        if (s.t > 2.5) this.remove(id);
        continue;
      }
      // The lead at the slot (the path's second point) when fed = 0; the rest up the table behind it.
      const f = id === firstId && fed > 0 ? fed : 0;
      const inside = Math.min(s.lengthM, f);
      const visible = s.lengthM - inside;
      m.visible = visible > 0.003;
      const c = (visible / 2);                        // the visible part's centre, up the table from the slot
      m.scale.set(1, visible / s.lengthM, 1);
      m.position.set(X, y1 - dir.y * c + 0.002 + s.index * 0.0004, z1 - dir.x * c);
      m.rotation.set(-Math.PI / 2 + slope, 0, 0);
      const map = m.material.map;
      map.repeat.set(1, visible / s.lengthM); map.offset.set(0, 0);
    }
  }
}
