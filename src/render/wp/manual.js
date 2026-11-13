// IBM's own manual, S544-2036-0 Operator Reference Guide, Textpack 4 / Reportpack (Feb 1982): a closed ring binder
// lying on top of the diskette unit, a little askew. Built here, no model file: two covered boards with rounded
// corners, a rounded spine over the rings, and the page block between them. Like the rest of the set (the list on
// pp. 1-3 and 1-4, and the shelf, src/render/wp/shelf.js) it came in a grey vinyl 3-ring binder; the blue design is its
// cover sheet, showing through the binder's clear front pocket. Cover and spine are drawn on a canvas by us after the
// scan (no scanned image is used). Clicking it opens the scan from bitsavers in the in-app viewer (MANUAL_URL); our
// own quick-start packet is src/render/wp/packet.js.
import * as THREE from 'three';

const MM = 1e-3;
/** The binder, m: width (across, spine on the left), depth (front to back) and closed thickness. */
export const MANUAL_SIZE = { w: 235 * MM, d: 300 * MM, h: 35 * MM };
const BOARD = 2.6 * MM;              // each cover board with its vinyl
const CORNER = 7 * MM;               // the boards' rounded corners
const SPINE_R = MANUAL_SIZE.h / 2;   // the spine's round over the rings
const INSET = 3.5 * MM;              // the page block stands back from the boards' open edges

const BLUE = '#1a1fa6';     // the cover sheet's IBM blue, from the scan
const GREY = '#c4c0b5';     // the binder's vinyl: IBM's pebble grey
const POCKET = { x0: 0.055, x1: 0.975, y0: 0.022, y1: 0.978 };   // the clear front pocket, as fractions of the cover
/** The scanned manual on bitsavers: IBM's copyright, so we link to it rather than host it. */
export const MANUAL_URL = 'https://bitsavers.org/pdf/ibm/6580_Displaywriter/S544-2036-0_IBM_Displaywriter_Operator_Reference_Guide_Textpack_4_Reportpack_Feb82.pdf';

/** A rounded-rectangle shape, centred, in the shape's x/y plane. */
function roundedRect(w, d, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -d / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/**
 * A cover board lying flat, top at y = `top`, its UVs the top view (u across, v from the front edge to the back),
 * so the cover canvas maps straight onto it; the side walls take the canvas's navy border.
 */
function board(w, d, top) {
  const g = new THREE.ExtrudeGeometry(roundedRect(w, d, CORNER), { depth: BOARD, bevelEnabled: true, bevelThickness: 0.5 * MM, bevelSize: 0.6 * MM, bevelSegments: 2, curveSegments: 6 });
  g.rotateX(-Math.PI / 2);                     // shape y -> world -z, extrusion -> +y
  g.translate(0, top - BOARD - 0.5 * MM, 0);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + w / 2) / w, (d / 2 - p.getZ(i)) / d);
  g.computeVertexNormals();
  return g;
}

/** Vinyl grain, as a bump map and a matching roughness: fine noise with a faint pebble. */
export function grainCanvas(S = 512, seed = 7) {
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), img = g.createImageData(S, S);
  let x = seed >>> 0;
  const rnd = () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; };
  const pebble = new Float32Array(S * S);
  for (let n = 0; n < 2600; n++) {
    const cx = rnd() * S, cy = rnd() * S, r = 2 + rnd() * 3.5;
    for (let j = -5; j <= 5; j++) for (let i = -5; i <= 5; i++) {
      const d2 = (i * i + j * j) / (r * r);
      if (d2 < 1) pebble[((Math.floor(cy) + j + S) % S) * S + ((Math.floor(cx) + i + S) % S)] += 1 - d2;
    }
  }
  for (let k = 0; k < S * S; k++) {
    const v = Math.max(0, Math.min(255, 118 + 60 * Math.min(1, pebble[k]) + (rnd() - 0.5) * 34));
    img.data[k * 4] = img.data[k * 4 + 1] = img.data[k * 4 + 2] = v; img.data[k * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/**
 * The striped IBM logo, drawn: slab letters I, B and M in white, then the seven gaps cut across them so eight bars
 * remain. `h` the letters' height in pixels, at (x, y) top left. Returns its width.
 */
export function drawIbmLogo(g, x, y, h, color = '#f2f2ee') {
  const c = document.createElement('canvas');
  const W = Math.ceil(h * 3.05), H = Math.ceil(h);
  c.width = W; c.height = H;
  const k = c.getContext('2d');
  k.fillStyle = color;
  k.save(); k.scale(h, h);
  const rect = (x0, y0, x1, y1) => k.fillRect(x0, y0, x1 - x0, y1 - y0);
  // I
  rect(0, 0, 0.62, 0.255); rect(0.15, 0, 0.47, 1); rect(0, 0.745, 0.62, 1);
  // B: the left of an I, a waist, and two bowls, the lower a little wider.
  const bx = 0.72;
  rect(bx, 0, bx + 0.66, 0.255); rect(bx + 0.15, 0, bx + 0.47, 1); rect(bx, 0.745, bx + 0.7, 1); rect(bx + 0.15, 0.44, bx + 0.66, 0.56);
  k.beginPath(); k.arc(bx + 0.62, 0.25, 0.25, -Math.PI / 2, Math.PI / 2); k.fill();
  k.beginPath(); k.arc(bx + 0.66, 0.75, 0.25, -Math.PI / 2, Math.PI / 2); k.fill();
  rect(bx + 0.47, 0.255, bx + 0.62, 0.44);
  rect(bx + 0.47, 0.56, bx + 0.66, 0.745);
  k.globalCompositeOperation = 'destination-out';
  k.beginPath(); k.arc(bx + 0.62, 0.25, 0.075, -Math.PI / 2, Math.PI / 2); k.rect(bx + 0.47, 0.175, 0.15, 0.15); k.fill();
  k.beginPath(); k.arc(bx + 0.66, 0.75, 0.075, -Math.PI / 2, Math.PI / 2); k.rect(bx + 0.47, 0.675, 0.19, 0.15); k.fill();
  k.globalCompositeOperation = 'source-over';
  // M: two stems with serifs and the V between them.
  const mx = 1.72, mw = 1.3;
  rect(mx, 0, mx + 0.34, 0.255); rect(mx + mw - 0.34, 0, mx + mw, 0.255);
  rect(mx, 0.745, mx + 0.4, 1); rect(mx + mw - 0.4, 0.745, mx + mw, 1);
  rect(mx + 0.07, 0, mx + 0.3, 1); rect(mx + mw - 0.3, 0, mx + mw - 0.07, 1);
  k.beginPath();
  k.moveTo(mx + 0.07, 0); k.lineTo(mx + 0.36, 0); k.lineTo(mx + mw / 2, 0.6); k.lineTo(mx + mw - 0.36, 0);
  k.lineTo(mx + mw - 0.07, 0); k.lineTo(mx + mw / 2 + 0.11, 1); k.lineTo(mx + mw / 2 - 0.11, 1); k.closePath(); k.fill();
  k.restore();
  // Eight bars, seven gaps.
  const bar = 1 / (8 + 7 * 0.72), gap = bar * 0.72;
  k.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 7; i++) k.fillRect(0, (bar + i * (bar + gap)) * h, W, gap * h);
  g.drawImage(c, x, y);
  return (mx + mw) * h;
}

/**
 * The front cover of S544-2036-0 (Feb 1982), drawn after the scan: IBM blue, the striped logo top left, the title
 * block set bold and flush right beside it, and below them three staggered rows of three chevron blocks, each a
 * nest of lavender chevrons standing up off the page on dark sides. Proportions are fractions of the scanned cover.
 */
function drawCoverSheet(canvas) {
  const g = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
  g.fillStyle = BLUE; g.fillRect(0, 0, W, H);
  const sheen = g.createLinearGradient(0, 0, W, H);
  sheen.addColorStop(0, 'rgba(255,255,255,0.06)'); sheen.addColorStop(0.55, 'rgba(255,255,255,0)'); sheen.addColorStop(1, 'rgba(0,0,30,0.18)');
  g.fillStyle = sheen; g.fillRect(0, 0, W, H);
  // The chevron blocks: in scan pixels (766 x 983), scaled to the canvas.
  const sx = W / 766, sy = H / 983;
  const block = (x0, y0) => {
    const t = 15, depth = 78, step = 37;
    const arms = [0, 1, 2, 3, 4].map((i) => ({ ax: x0 + 50 + i * step, ay: y0 + 95, h: 12 + i * 26 }));
    const path = (a, dy) => { g.beginPath(); g.moveTo((a.ax - a.h) * sx, (a.ay - a.h + dy) * sy); g.lineTo(a.ax * sx, (a.ay + dy) * sy); g.lineTo((a.ax - a.h) * sx, (a.ay + a.h + dy) * sy); };
    g.lineJoin = 'miter'; g.lineCap = 'butt'; g.lineWidth = t * sx;
    // The sides: the stroke swept down.
    for (const a of arms) for (let dy = depth; dy > 0; dy -= 2) { g.strokeStyle = dy > depth - 3 ? '#05062a' : '#0a0b3c'; path(a, dy); g.stroke(); }
    for (const a of arms) { g.strokeStyle = '#5b44c8'; path(a, 0); g.stroke(); }
    // Light catching the upper arms' top edges.
    g.lineWidth = 2 * sx; g.strokeStyle = 'rgba(190,175,255,0.35)';
    for (const a of arms) { g.beginPath(); g.moveTo((a.ax - a.h - 6) * sx, (a.ay - a.h - 7) * sy); g.lineTo((a.ax - 6) * sx, (a.ay - 7) * sy); g.stroke(); }
  };
  for (const [x0, y0] of [[150, 300], [52, 480], [150, 665]]) for (let c = 0; c < 3; c++) block(x0 + c * 200, y0);
  // The logo and the titles.
  drawIbmLogo(g, 128 * sx, 95 * sy, 31 * sy, '#e9e9f2');
  g.fillStyle = '#f2f2f6'; g.textAlign = 'right'; g.textBaseline = 'alphabetic';
  const fit = (text, weight, px, right, base, width, spacing = 0) => {
    g.font = `${weight} ${Math.round(px * sy)}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
    if ('letterSpacing' in g) g.letterSpacing = `${spacing * sx}px`;
    g.fillText(text, right * sx, base * sy, width * sx);
  };
  fit('IBM Displaywriter System', 700, 25, 750, 140, 330, 0.6);
  fit('Operator Reference Guide', 700, 25, 750, 169, 330, 0.6);
  fit('Textpack 4/Reportpack', 700, 15, 748, 199, 220, 1.4);
  if ('letterSpacing' in g) g.letterSpacing = '0px';
  g.textAlign = 'left';
}

/**
 * The front board: grey vinyl, the hinge groove by the spine, and the cover sheet under the clear pocket, which is
 * welded round its edge and catches a little light across its face.
 */
function drawCover(canvas) {
  const g = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
  g.fillStyle = GREY; g.fillRect(0, 0, W, H);
  const x0 = W * POCKET.x0, x1 = W * POCKET.x1, y0 = H * POCKET.y0, y1 = H * POCKET.y1;
  const sheet = document.createElement('canvas');
  sheet.width = Math.round(x1 - x0 - W * 0.008); sheet.height = Math.round(y1 - y0 - H * 0.006);
  drawCoverSheet(sheet);
  g.drawImage(sheet, x0 + W * 0.004, y0 + H * 0.003);
  // The pocket's weld, a slightly darker seam just outside the sheet, and the vinyl's sheen over the sheet.
  g.strokeStyle = 'rgba(70,66,58,0.55)'; g.lineWidth = Math.max(2, W * 0.004); g.strokeRect(x0, y0, x1 - x0, y1 - y0);
  const sheen = g.createLinearGradient(x0, y0, x1, y1);
  sheen.addColorStop(0, 'rgba(255,255,255,0.10)'); sheen.addColorStop(0.35, 'rgba(255,255,255,0.02)'); sheen.addColorStop(0.5, 'rgba(255,255,255,0.09)'); sheen.addColorStop(0.62, 'rgba(255,255,255,0)'); sheen.addColorStop(1, 'rgba(255,255,255,0.05)');
  g.fillStyle = sheen; g.fillRect(x0, y0, x1 - x0, y1 - y0);
  // The hinge groove where the board bends by the spine.
  g.fillStyle = 'rgba(40,36,30,0.35)'; g.fillRect(W * 0.018, 0, W * 0.007, H);
}

/** The spine: grey vinyl with its insert, the title and the form number set sideways, and the logo at its foot. */
function drawSpine(canvas) {
  const g = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
  g.fillStyle = GREY; g.fillRect(0, 0, W, H);
  g.fillStyle = '#efece4'; g.fillRect(W * 0.3, H * 0.03, W * 0.4, H * 0.94);
  g.strokeStyle = 'rgba(70,66,58,0.5)'; g.lineWidth = 2; g.strokeRect(W * 0.28, H * 0.025, W * 0.44, H * 0.95);
  g.save();
  g.translate(W / 2, H); g.rotate(-Math.PI / 2);     // the text runs from the canvas's foot to its head
  g.fillStyle = '#1d1d1f'; g.textBaseline = 'middle';
  g.font = `700 ${Math.round(W * 0.16)}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
  g.fillText('IBM Displaywriter System   Operator Reference Guide   Textpack 4/Reportpack', H * 0.2, 0, H * 0.62);
  g.font = `400 ${Math.round(W * 0.12)}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
  g.fillText('S544-2036-0', H * 0.86, 0, H * 0.12);
  g.restore();
  g.save(); g.translate(W / 2, H * 0.1); g.rotate(-Math.PI / 2);
  drawIbmLogo(g, -W * 0.33, -W * 0.11, W * 0.22, '#1d1d1f');
  g.restore();
}

/** The page block's edges: off-white with the fine lines of the sheets and a tab divider or two. */
function drawEdges(canvas) {
  const g = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
  g.fillStyle = '#e9e5d8'; g.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += 2) { g.fillStyle = `rgba(90,80,60,${0.05 + 0.08 * Math.abs(Math.sin(y * 12.9898) % 1)})`; g.fillRect(0, y, W, 1); }
  for (const [y, c] of [[0.3, '#c9b25a'], [0.62, '#6f8fb5']]) { g.fillStyle = c; g.fillRect(0, H * y, W, H * 0.03); }
}

/**
 * Lays the binder on a surface. `at` [x, y, z] the centre of its footprint in world space (y = the surface), `yaw`
 * its turn about the vertical. Returns { group, box, hit } with `hit` the mesh to pick.
 */
export function createManual({ scene, renderer, at, yaw = 0 }) {
  const { w, d, h } = MANUAL_SIZE;
  const aniso = renderer?.capabilities?.getMaxAnisotropy?.() ?? 4;
  const group = new THREE.Group();
  group.name = 'manual';

  const coverCanvas = document.createElement('canvas');
  coverCanvas.width = 1024; coverCanvas.height = Math.round(1024 * d / w);
  drawCover(coverCanvas);
  const coverTex = new THREE.CanvasTexture(coverCanvas);
  coverTex.colorSpace = THREE.SRGBColorSpace; coverTex.anisotropy = aniso;
  // The fonts may arrive after the first draw: draw again once they are in.
  document.fonts?.ready?.then(() => { drawCover(coverCanvas); coverTex.needsUpdate = true; });
  const grain = new THREE.CanvasTexture(grainCanvas());
  grain.wrapS = grain.wrapT = THREE.RepeatWrapping; grain.repeat.set(5, 6); grain.anisotropy = aniso;

  const vinyl = (map) => new THREE.MeshPhysicalMaterial({
    color: map ? 0xffffff : GREY, map: map ?? null, roughness: 0.66, roughnessMap: grain, bumpMap: grain, bumpScale: 0.6,
    metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.55, sheen: 0.2, sheenColor: new THREE.Color(0x9098a8),
  });
  const plain = vinyl(null);
  // The front: the clear pocket is smooth and glossy over the sheet, so its coat is smoother and the grain fainter.
  const pocket = vinyl(coverTex);
  Object.assign(pocket, { roughness: 0.42, bumpScale: 0.15, clearcoat: 0.85, clearcoatRoughness: 0.12 });
  const solid = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = m.receiveShadow = true; group.add(m); return m; };

  // The boards stop short of the spine's round, which wraps their left edges.
  const bw = w - SPINE_R, bx = SPINE_R / 2;
  const front = solid(board(bw, d, h), [pocket, plain]);
  front.position.x = bx;
  const back = solid(board(bw, d, BOARD + 1 * MM), plain);
  back.position.x = bx;
  // The covers sag a hair toward the open edge, where the pages do not quite fill them.
  front.rotation.z = -0.004;

  // The spine: half a tube over the rings, closed at its ends, its flat inside facing the pages.
  const spineCanvas = document.createElement('canvas'); spineCanvas.width = 160; spineCanvas.height = 1600;
  drawSpine(spineCanvas);
  const spineTex = new THREE.CanvasTexture(spineCanvas); spineTex.colorSpace = THREE.SRGBColorSpace; spineTex.anisotropy = aniso;
  document.fonts?.ready?.then(() => { drawSpine(spineCanvas); spineTex.needsUpdate = true; });
  // The round's u runs over the outside, u = 0.5 outermost; v along its length.
  const spine = solid(new THREE.CylinderGeometry(SPINE_R, SPINE_R, d - 1.2 * MM, 28, 1, false, Math.PI, Math.PI), [vinyl(spineTex), plain, plain]);
  spine.rotation.x = Math.PI / 2;
  spine.position.set(-w / 2 + SPINE_R, h / 2, 0);
  // The page block.
  const edgeCanvas = document.createElement('canvas'); edgeCanvas.width = 64; edgeCanvas.height = 512;
  drawEdges(edgeCanvas);
  const edgeTex = new THREE.CanvasTexture(edgeCanvas); edgeTex.colorSpace = THREE.SRGBColorSpace; edgeTex.anisotropy = aniso;
  const paper = new THREE.MeshStandardMaterial({ color: 0xece8dc, roughness: 0.9 });
  const edges = new THREE.MeshStandardMaterial({ map: edgeTex, roughness: 0.92 });
  const pw = w - SPINE_R - INSET - 2 * MM, pd = d - 2 * INSET, ph = h - 2 * BOARD - 1.6 * MM;
  const pages = solid(new THREE.BoxGeometry(pw, ph, pd), [edges, paper, paper, paper, edges, edges]);
  pages.position.set(-w / 2 + SPINE_R + 2 * MM + pw / 2, BOARD + 0.5 * MM + ph / 2 + 0.3 * MM, 0);

  group.position.set(at[0], at[1], at[2]);
  group.rotation.y = yaw;
  scene.add(group);
  group.updateMatrixWorld(true);

  // One box to pick, a little larger than the binder.
  const hit = new THREE.Mesh(new THREE.BoxGeometry(w + 4 * MM, h + 3 * MM, d + 4 * MM), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.y = h / 2;
  hit.name = 'manual-hit';
  group.add(hit);
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  return { group, hit, box: { min: box.min.toArray(), max: box.max.toArray() } };
}
