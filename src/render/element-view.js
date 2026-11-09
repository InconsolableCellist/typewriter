// The element1971 office typewriter: housing (GLB) and everything that moves, posed from the snapshot. Same public surface
// as MachineView so the rest of the app needs no special cases, apart from the kinds listed at ElementView.partDefs.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import keycaps from './element-keycaps.json';

export const ELEMENT_ENCLOSURE_URL = '/assets/models/element_enclosure.glb';
const BASE = '/assets/textures/';
const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const tmpM = new THREE.Matrix4();
const X_AXIS = new THREE.Vector3(1, 0, 0);

/**
 * The look.js cavity box for this machine: the slot and key wells, kept off the deck front and apron.
 * The frontstrike values, which are tuned to its open basket, otherwise shade the apron here.
 */
export const ELEMENT_CAVITY = { enabled: true, centerX: 0, centerZ: 0.030, halfX: 0.205, halfZ: 0.150, margin: 0.012, top: 0.118, z0: 0.082, slope: 0.5, depth: 0.05, shade: 0.26, direct: 0.55 };

/** The housing paint, keycap plastics and blacks. Crinkle maps load asynchronously; the materials work before they arrive. */
export function createElementMaterials(mats, maxAniso = 8) {
  const paint = new THREE.MeshPhysicalMaterial({ color: 0xbda98c, roughness: 0.56, metalness: 0, clearcoat: 0, ior: 1.5 });
  const black = new THREE.MeshPhysicalMaterial({ color: 0x0b0b0c, roughness: 0.4, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.35 });
  const blackMatte = new THREE.MeshStandardMaterial({ color: 0x0a0a0b, roughness: 0.8, metalness: 0 });
  const chrome = new THREE.MeshPhysicalMaterial({ color: 0xc8c9cb, roughness: 0.18, metalness: 1, envMapIntensity: 1.15 });
  const cast = new THREE.MeshStandardMaterial({ color: 0x1a1b1d, roughness: 0.55, metalness: 0.35 });
  const keyPlastic = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.26, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.12, envMapIntensity: 0.9 });
  const out = { ...mats, paint, black, blackMatte, chrome, cast, keyPlastic, rubberFoot: mats.rubber };
  const TILE = 0.08, UV = 0.2;
  const load = async (name, srgb) => {
    const blob = await (await fetch(`${BASE}${name}.jpg`)).blob();
    const img = await createImageBitmap(blob, { imageOrientation: 'flipY' });
    const t = new THREE.Texture(img);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = maxAniso; t.flipY = false;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.repeat.set(UV / TILE, UV / TILE); t.needsUpdate = true;
    return t;
  };
  out.ready = (async () => {
    const [a, n, r] = await Promise.all([load('element_crinkle_albedo', true), load('element_crinkle_normal', false), load('element_crinkle_roughness', false)]);
    paint.map = a; paint.normalMap = n; paint.roughnessMap = r; paint.roughness = 1; paint.color.setRGB(0.9, 0.84, 0.76); paint.normalScale.set(1.7, 1.7); paint.needsUpdate = true;
  })();
  return out;
}

/** The housing. Its hood is hinged about the node's own origin; toggle() swings it, picking is via pickEntries(). */
export class ElementEnclosure {
  constructor({ scene, mats }) {
    this.scene = scene; this.mats = mats;
    this.group = new THREE.Group(); this.group.name = 'element_enclosure'; scene.add(this.group);
    this.loaded = false; this.meshes = []; this.hood = null;
    this.angle = 0; this.target = 0; this.raf = 0;
    this.openAngle = 2.0;      // past upright, leaning back over the slot: the whole carrier is in view from the keyboard side, and a loaded sheet is still clear of it
  }

  async load(url = ELEMENT_ENCLOSURE_URL) {
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const gltf = await new GLTFLoader().loadAsync(url);
    const byName = { element_paint: this.mats.paint, element_black: this.mats.black, element_rubber: this.mats.rubberFoot };
    gltf.scene.traverse((o) => {
      o.layers.set(1);
      if (o.name === 'element_hood') this.hood = o;
      if (!o.isMesh) return;
      o.castShadow = o.receiveShadow = true;
      const m = byName[(o.material?.name ?? '').toLowerCase()];
      if (m) o.material = m;
      this.meshes.push(o);
    });
    this.group.add(gltf.scene);
    this.loaded = true;
    return true;
  }

  sync() { this.group.visible = this.loaded; }
  get showing() { return this.group.visible; }

  /** Pose the hood directly, in radians from closed. */
  setOpen(a) { this.angle = a; if (this.hood) this.hood.rotation.x = -a; }
  toggle() { this.target = this.target > 0.1 ? 0 : this.openAngle; this._animate(); }

  _animate() {
    if (this.raf) return;
    let last = performance.now();
    const step = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const d = this.target - this.angle;
      // Closing falls under its own weight and lands; opening is a hand lifting it steadily.
      const v = d > 0 ? 2.6 : (-3.4 - this._drop);
      this._drop = d < 0 ? (this._drop || 0) + dt * 2 : 0;
      this.setOpen(Math.abs(d) < 0.005 ? this.target : this.angle + THREE.MathUtils.clamp(v * dt, -Math.abs(d), Math.abs(d)));
      if (this.angle === this.target) { this.raf = 0; return; }
      this.raf = requestAnimationFrame(step);
    };
    this._drop = 0;
    this.raf = requestAnimationFrame(step);
  }

  /** Entries for the picker: the panels block picks through to the mechanism, the hood is a part. */
  pickEntries() {
    return this.meshes.map((object) => {
      const hood = object === this.hood || object.parent === this.hood;
      if (!hood) return { object, part: () => null, enabled: () => this.showing };
      return { object, enabled: () => this.showing, part: () => ({ kind: 'cover', label: this.target > 0.1 ? 'Top cover (click to close)' : 'Top cover (click to open)', cursor: 'pointer', visual: () => this.hood.isMesh ? this.hood : this.hood.children[0], onClick: () => this.toggle() }) };
    });
  }
}

// ---------- key legend atlas ----------

function drawKeyLegend(ctx, label, cell, wMm, dMm, isPrintPair) {
  // The legend layer is stretched over the key's full footprint, so text is drawn in key millimetres, squeezed for the aspect.
  const aspect = wMm / dMm;
  ctx.save();
  ctx.translate(cell / 2, cell / 2);
  ctx.scale(1 / aspect, 1);
  ctx.fillStyle = '#eef0ec'; ctx.strokeStyle = '#eef0ec'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const fam = '"Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif';
  const pxPerMm = cell / (dMm * 1000);
  if (label === 'BOX') {
    const s = 7.5 * pxPerMm;
    ctx.lineWidth = s * 0.1; ctx.lineJoin = 'round';
    ctx.strokeRect(-s / 2, -s / 2, s, s);
    ctx.beginPath(); ctx.moveTo(-s * 0.32, -s * 0.32); ctx.lineTo(s * 0.32, s * 0.32); ctx.moveTo(s * 0.32, -s * 0.32); ctx.lineTo(-s * 0.32, s * 0.32); ctx.stroke();
    ctx.restore(); return;
  }
  const lines = label.split('\n');
  const single = lines.length === 1 && label.length <= 1;
  const capMm = single ? 5.0 : isPrintPair ? 3.5 : lines.length > 1 ? 2.4 : 2.5;
  const size = capMm * pxPerMm / 0.72;        // cap height of these faces is about 0.72 em
  ctx.font = `${single ? 500 : 700} ${size}px ${fam}`;
  const lh = size * (isPrintPair ? 0.98 : 1.05);
  lines.forEach((line, n) => ctx.fillText(line, 0, (n - (lines.length - 1) / 2) * lh));
  ctx.restore();
}

function keySizeMm(k) {
  const c = keycaps.controls[k.id];
  return c ? [c.w, c.d] : [keycaps.letterW, keycaps.letterD];
}

function makeKeyAtlas(g) {
  const cell = 128, cols = 10;
  const rows = Math.ceil(g.nKeys / cols);
  const can = document.createElement('canvas');
  can.width = cols * cell; can.height = rows * cell;
  const ctx = can.getContext('2d');
  ctx.fillStyle = '#1b2a23'; ctx.fillRect(0, 0, can.width, can.height);    // dark green-charcoal plastic, baked into the legend layer
  const cells = new Map();
  g.keys.forEach((k, i) => {
    const cx = (i % cols) * cell, cy = Math.floor(i / cols) * cell;
    cells.set(k.id, { x: cx / can.width, y: 1 - (cy + cell) / can.height, w: cell / can.width, h: cell / can.height });
    ctx.save(); ctx.translate(cx, cy);
    let label;
    if (k.kind === 'print') {
      const letter = /[a-z]/.test(k.lower);
      label = letter ? k.lower.toUpperCase() : `${k.upper === k.lower ? k.lower : `${k.upper}\n${k.lower}`}`;
    } else {
      label = keycaps.controls[k.id]?.label ?? k.id;
    }
    const size = keySizeMm(k);
    drawKeyLegend(ctx, label, cell, size[0], size[1], k.kind === 'print' && !/[a-z]/.test(k.lower));
    ctx.restore();
  });
  const tex = new THREE.CanvasTexture(can);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.generateMipmaps = true;
  return { tex, cell: (id) => cells.get(id) };
}

/**
 * Sculpted keycap: skirt tapering up to a rounded shoulder and a dished top, from a rounded-rectangle footprint.
 * Local frame: top surface at y = 0 centre, skirt below. uv covers the top (u along x, v along -z) of the footprint.
 */
function capGeometry(w, d, h, opts = {}) {
  const { radius = Math.min(w, d) * 0.18, taper = 0.84, dish = 0.0009, segs = 12, topRings = 8 } = opts;
  const N = segs * 4;
  const hw = w / 2, hd = d / 2, r = Math.min(radius, Math.min(hw, hd) * 0.95);
  const rect = (hx, hz, rc) => {
    const pts = [];
    const corners = [[hx - rc, -hz + rc, -Math.PI / 2], [hx - rc, hz - rc, 0], [-hx + rc, hz - rc, Math.PI / 2], [-hx + rc, -hz + rc, Math.PI]];
    for (const [cx, cz, a0] of corners) for (let i = 0; i < segs; i++) {
      const a = a0 + (i / segs) * (Math.PI / 2);
      pts.push([cx + rc * Math.cos(a), cz + rc * Math.sin(a)]);
    }
    return pts;
  };
  // Dish: a smooth elliptical bowl reaching zero at the shoulder line, so the crown has no diagonal creases.
  const dishAt = (x, z, sx, sz) => { const q = (x * x) / (sx * sx) + (z * z) / (sz * sz); return q >= 1 ? 0 : -dish * (1 - q) * (1 - q * 0.4); };
  const shoulder = taper * 0.965;
  // Rings: skirt, shoulder rounding (fixed heights, top rim at y = 0), then the crown as ever smaller rings on the dish height function.
  const skirt = [[1.0, -h], [0.985, -h * 0.72], [0.955, -h * 0.28], [taper + 0.015, -0.0014], [shoulder + 0.012, -0.0005], [shoulder, 0]];
  const pos = [], uv = [], idx = [];
  const addRing = (s, y, useDish) => {
    const pts = rect(hw * s, hd * s, r * Math.max(0.4, s));
    for (const [x, z] of pts) {
      const yy = useDish ? dishAt(x, z, hw * shoulder, hd * shoulder) : y;
      pos.push(x, yy, z);
      uv.push(x / w + 0.5, 0.5 - z / d);
    }
  };
  skirt.forEach(([s, y]) => addRing(s, y, false));
  for (let i = 1; i <= topRings; i++) addRing(shoulder * (1 - i / (topRings + 1)), 0, true);
  pos.push(0, -dish, 0); uv.push(0.5, 0.5);
  const totalRings = skirt.length + topRings;
  const centre = pos.length / 3 - 1;
  for (let i = 0; i < totalRings - 1; i++) for (let j = 0; j < N; j++) {
    const a = i * N + j, b = i * N + (j + 1) % N, c = (i + 1) * N + j, e = (i + 1) * N + (j + 1) % N;
    idx.push(a, c, b, b, c, e);
  }
  for (let j = 0; j < N; j++) idx.push((totalRings - 1) * N + j, centre, (totalRings - 1) * N + (j + 1) % N);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // Crown normals from the height function itself: the rings are not uniform and area weighting would leave creases in the gloss.
  const posA = geo.getAttribute('position'), norA = geo.getAttribute('normal');
  const e = 0.00015, base = skirt.length * N;
  for (let i = base; i < posA.count; i++) {
    const x = posA.getX(i), z = posA.getZ(i);
    const dx = (dishAt(x + e, z, hw * shoulder, hd * shoulder) - dishAt(x - e, z, hw * shoulder, hd * shoulder)) / (2 * e);
    const dz = (dishAt(x, z + e, hw * shoulder, hd * shoulder) - dishAt(x, z - e, hw * shoulder, hd * shoulder)) / (2 * e);
    const l = Math.hypot(dx, 1, dz);
    norA.setXYZ(i, -dx / l, 1 / l, -dz / l);
  }
  return geo;
}

// ---------- type element ----------

function glyphHeightSampler(glyphs, ch) {
  const i = glyphs.chars.indexOf(ch);
  if (i < 0) return null;
  const N = glyphs.N;
  const hf = glyphs.data.subarray(i * N * N, (i + 1) * N * N);
  // Bilinear, u right and v up across the tile, in 0..1; returns 0..1.
  return (u, v) => {
    const x = u * N - 0.5, y = (1 - v) * N - 0.5;
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const at = (a, b) => (a < 0 || b < 0 || a >= N || b >= N ? 0 : hf[a + b * N] / 255);
    return (1 - fy) * ((1 - fx) * at(ix, iy) + fx * at(ix + 1, iy)) + fy * ((1 - fx) * at(ix, iy + 1) + fx * at(ix + 1, iy + 1));
  };
}

/**
 * The ring's mounting angle: the ball stands about upright at rest with the bottom band at its equator. Higher bands tilt its top
 * toward the platen; the published tilt is steps from rest, so the four bands run from the equator up over the upper hemisphere.
 */
const TILT_ZERO = (m) => -m.printPoint.beta;

/**
 * The ribbon cartridge's place on the carrier, set by the ball's rest. tilt is the plane's slope toward the typist; ballV is where the ball sits
 * along that plane from the hub line, so the cut in the rear edge wraps its front. Hubs at +-hubX, in one plane a little below the ball's middle.
 */
const CARTRIDGE = { tilt: 0.30, hubX: 0.0365, lobeR: 0.0373, front: 0.034, T: 0.0075, notchR: 0.028, ballV: -0.031 };
function cartridgeHub(c) {
  return { y: c.y - 0.0259, z: c.z - CARTRIDGE.ballV * Math.cos(CARTRIDGE.tilt) };
}

/** 88 raised characters as a normal map plus a low real displacement, on the patches where they sit. */
function buildTypeBall(m, g, glyphs) {
  const R = m.element.ball.radius;
  const E = g.element, relief = 0.00032;
  const tile = glyphs.N * glyphs.texelMm * 1e-3;   // the patch holds the whole glyph tile (as on the slug atlases), glyph at its print size
  const N = 22 * 96, atlasC = document.createElement('canvas');
  // Normals are in the patch's own tangent space: R = +right, G = +up.
  atlasC.width = N; atlasC.height = 4 * 96;
  const actx = atlasC.getContext('2d');
  const nImg = actx.createImageData(atlasC.width, atlasC.height);
  for (let i = 0; i < nImg.data.length; i += 4) { nImg.data[i] = 128; nImg.data[i + 1] = 128; nImg.data[i + 2] = 255; nImg.data[i + 3] = 255; }
  // Patch frames from the published orientation rule: a seat prints when the ball has spun by rotate*step + h*pi and tilted by tilt*step.
  const c = new THREE.Vector3(), up0 = V(g.strikeDown).negate(), right0 = new THREE.Vector3(1, 0, 0), strike = V(g.printNormal).negate();   // the face toward the platen, not the direction the ball travels
  const ballLocal = (dir, tilt, rotate, hemisphere) => {
    const a = rotate * E.rotateStep + hemisphere * Math.PI, b = TILT_ZERO(m) - tilt * E.tiltStep;
    const q = new THREE.Quaternion().setFromAxisAngle(V(E.tiltAxis), b).multiply(new THREE.Quaternion().setFromAxisAngle(V(E.rotateAxis), a));
    return dir.clone().applyQuaternion(q.invert());
  };
  const patches = [];
  E.keys.forEach((key, k) => {
    for (const h of [0, 1]) {
      const ch = h === 0 ? key.lower : key.upper;
      const sampler = glyphHeightSampler(glyphs, ch) ?? glyphHeightSampler(glyphs, key.lower);
      const d = ballLocal(strike, key.tilt, key.rotate, h);
      const r = ballLocal(right0, key.tilt, key.rotate, h).normalize();
      const u = ballLocal(up0, key.tilt, key.rotate, h).normalize();
      patches.push({ k, h, ch, sampler, d, r, u, col: k % 22, row: Math.floor(k / 22) });
    }
  });
  // Atlas slot per patch.
  const sampleCount = 32;
  const positions = [], uvs = [], normals = [], indices = [];
  patches.forEach((p, idx) => {
    const col = idx % 22, row = Math.floor(idx / 22);
    const cellX = col * 96, cellY = (row % 4) * 96;
    // Normal texels from the height, with a slope that matches the relief.
    const s = p.sampler;
    if (s) {
      for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) {
        const hAt = (ax, ay) => s((ax + 0.5) / 96, 1 - (ay + 0.5) / 96);
        const dx = (hAt(x + 1, y) - hAt(x - 1, y)) * 4.0, dy = (hAt(x, y - 1) - hAt(x, y + 1)) * 4.0;
        const len = Math.hypot(dx, dy, 1);
        const px = cellX + x, py = cellY + y, i = (px + py * atlasC.width) * 4;
        nImg.data[i] = 127.5 * (1 - dx / len); nImg.data[i + 1] = 127.5 * (1 - dy / len); nImg.data[i + 2] = 127.5 * (1 + 1 / len);
      }
    }
    // Patch mesh: grid on the sphere, normal to it, displaced by the blurred height for a real silhouette at very close range.
    const base = positions.length / 3;
    for (let j = 0; j <= sampleCount; j++) for (let i = 0; i <= sampleCount; i++) {
      const su = i / sampleCount, sv = j / sampleCount;
      const x0 = (su - 0.5) * tile, y0 = (sv - 0.5) * tile;
      c.copy(p.d).addScaledVector(p.r, x0 / R).addScaledVector(p.u, y0 / R).normalize();
      let h = 0;
      if (s) {
        const kernel = 0.012;
        h = 0.25 * (s(su, sv) + s(su + kernel, sv) + s(su, sv + kernel) + s(su - kernel, sv));
      }
      const off = (su < 0.04 || su > 0.96 || sv < 0.04 || sv > 0.96) ? 0 : 0.00003;
      const rr = R + off + h * relief;
      positions.push(c.x * rr, c.y * rr, c.z * rr);
      normals.push(c.x, c.y, c.z);
      uvs.push((cellX + su * 96) / atlasC.width, 1 - (cellY + (1 - sv) * 96) / atlasC.height);
    }
    const row2 = sampleCount + 1;
    for (let j = 0; j < sampleCount; j++) for (let i = 0; i < sampleCount; i++) {
      const a = base + j * row2 + i, b = a + 1, c2 = a + row2, d2 = c2 + 1;
      indices.push(a, c2, b, b, c2, d2);
    }
  });
  actx.putImageData(nImg, 0, 0);
  const normalTex = new THREE.CanvasTexture(atlasC);
  normalTex.flipY = true; normalTex.colorSpace = THREE.NoColorSpace; normalTex.anisotropy = 8; normalTex.generateMipmaps = true;
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  geom.computeVertexNormals();    // the displaced surface's own shading under the map

  // The ball body: a sphere with an open skirt below the bands and a hub rising through the top.
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const a = THREE.MathUtils.degToRad(-58 + (122 * i) / 24);
    pts.push(new THREE.Vector2(R * Math.cos(a), R * Math.sin(a)));
  }
  pts.push(new THREE.Vector2(R * 0.62, R * 0.86));
  pts.push(new THREE.Vector2(R * 0.3, R * 0.9));
  const body = new THREE.LatheGeometry(pts, 64);
  body.computeVertexNormals();
  return { geom, body, normalTex };
}

function lathe(points, segs = 40) {
  const g = new THREE.LatheGeometry(points.map((p) => new THREE.Vector2(p[0], p[1])), segs);
  g.computeVertexNormals();
  return g;
}

function box(sx, sy, sz, x = 0, y = 0, z = 0) { return new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z); }
function cylX(r, len, x = 0, y = 0, z = 0, seg = 24) { return new THREE.CylinderGeometry(r, r, len, seg).rotateZ(Math.PI / 2).translate(x, y, z); }
function merged(geoms) {
  const clean = geoms.map((a) => { const b = a.index ? a.toNonIndexed() : a; b.deleteAttribute('uv2'); return b; });
  return mergeGeometries(clean);
}

export class ElementView {
  /** partDefs: kind -> the part object; every moving thing here registers in pickables with the same shape as MachineView. */
  constructor({ machine: m, geometry: g, rig, mats, atlas, glyphs }) {
    this.m = m; this.g = g; this.rig = rig; this.glyphs = glyphs;
    this.emats = mats.paint ? mats : createElementMaterials(mats);
    this.mats = this.emats; this.atlas = atlas;
    this.root = new THREE.Group(); this.root.name = 'machine';
    this.pickables = [];
    this.partDefs = new Map();
    this.buildFrame();
    this.buildPlaten();
    this.buildTableAndBail();
    this.buildKeys();
    this.buildStrip();
    this.buildCarrier();
    this.buildCornerLevers();
    this.buildCord();
    this.highlight = this.makeHighlight();
    this._knobAngle = 0;
  }

  async tryLoadGLB() { return false; }   // the frame of this machine is part of its own build, there is no frame.glb

  addMesh(geo, mat, parent, name) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = mesh.receiveShadow = true;
    if (name) mesh.name = name;
    (parent ?? this.root).add(mesh);
    return mesh;
  }

  info(object, label) {
    this.pickables.push({ object, low: true, part: () => ({ kind: 'info', label, visual: () => null }) });
  }

  // ---------- fixed interior ----------
  buildFrame() {
    const { m, g, emats: e } = this;
    this.frame = new THREE.Group(); this.frame.name = 'frame'; this.root.add(this.frame);
    const c = V(m.platen.center);
    // Two side frames carrying the platen, the rail and the print shaft, and a cross tie: black castings seen with the hood up.
    const sideShape = () => {
      const s = new THREE.Shape();
      // Top line stays below the hood's inner skin and the rear cover; the side frames carry the platen shaft at the rear.
      s.moveTo(0.060, 0.044); s.lineTo(0.060, 0.128); s.lineTo(0.020, 0.140); s.lineTo(-0.040, 0.176); s.lineTo(-0.130, 0.190);
      s.lineTo(-0.150, 0.160); s.lineTo(-0.150, 0.044); s.closePath();
      return s;
    };
    const plate = new THREE.ExtrudeGeometry(sideShape(), { depth: 0.006, bevelEnabled: true, bevelThickness: 0.001, bevelSize: 0.001, bevelSegments: 1 }).rotateY(-Math.PI / 2);
    const side = (sign) => plate.clone().translate(sign * 0.222 + (sign > 0 ? 0.003 : -0.003), 0, 0);
    this.addMesh(merged([side(1), side(-1)]), e.cast, this.frame);
    const tie = merged([
      box(0.46, 0.012, 0.016, 0, 0.052, 0.04),
      box(0.46, 0.012, 0.016, 0, 0.052, -0.12),
      box(0.46, 0.018, 0.022, 0, 0.126, -0.135),   // upper rear tie, behind the platen
    ]);
    this.addMesh(tie, e.cast, this.frame);
    // A black inner tray under the opening: what you see of the machine's innards is black paint, as on the real thing.
    this.addMesh(box(0.47, 0.004, 0.27, 0, 0.060, -0.052), e.blackMatte, this.frame);
    // Carrier rails: a round rail and the print shaft, in front of the platen.
    const rest = V(g.element.center);   // under the ball's rest position; the rocker and cartridge sit above these
    this.railY = rest.y - 0.040; this.railZ = rest.z - 0.008; this.shaftY = rest.y - 0.052; this.shaftZ = rest.z + 0.012;
    this.addMesh(cylX(0.0052, 0.44, 0, this.railY, this.railZ, 28), e.chrome, this.frame);
    this.addMesh(cylX(0.0044, 0.44, 0, this.shaftY, this.shaftZ, 6), e.steelDark, this.frame);
    this.frameRailMesh = this.frame.children.at(-2);
    this.info(this.frameRailMesh, 'Carrier rail');
    this.info(this.frame.children.at(-1), 'Print shaft');
    // Tilt and rotate tapes run along the carrier path behind the rail.
    const tape = (y, z) => box(0.44, 0.0004, 0.004, 0, y, z);
    this.addMesh(merged([tape(this.railY - 0.012, this.railZ - 0.02), tape(this.railY - 0.018, this.railZ - 0.02)]), e.steelDark, this.frame);
  }

  // ---------- platen and knobs: fixed in x, turned by the snapshot ----------
  buildPlaten() {
    const { m, emats: e } = this;
    const c = V(m.platen.center), R = m.platen.radius;
    const pg = new THREE.Group(); pg.position.copy(c); this.root.add(pg); this.platen = pg; pg.name = 'platen';
    this.platenRubber = this.addMesh(cylX(R, m.platen.length, 0, 0, 0, 96), e.rubber, pg, 'platen_rubber');
    this.addMesh(cylX(0.0052, 0.60, 0, 0, 0, 20), e.steel, pg);
    const hub = (sign) => cylX(0.0098, 0.018, sign * (m.platen.length / 2 + 0.008));
    this.addMesh(merged([hub(1), hub(-1)]), e.cast, pg);
    // Ratchet wheel at the left end.
    const teeth = m.platen.ratchetTeeth, sh = new THREE.Shape();
    const rO = R * 0.95, rI = R * 0.84;
    for (let i = 0; i < teeth; i++) {
      const a0 = (i / teeth) * Math.PI * 2, a1 = ((i + 0.72) / teeth) * Math.PI * 2, a2 = ((i + 1) / teeth) * Math.PI * 2;
      if (i === 0) sh.moveTo(Math.cos(a0) * rI, Math.sin(a0) * rI);
      sh.lineTo(Math.cos(a1) * rO, Math.sin(a1) * rO); sh.lineTo(Math.cos(a2) * rI, Math.sin(a2) * rI);
    }
    const ratchet = new THREE.ExtrudeGeometry(sh, { depth: 0.004, bevelEnabled: false }).rotateY(Math.PI / 2).translate(-m.platen.length / 2 - 0.005, 0, 0);
    this.addMesh(ratchet, e.cast, pg);
    // Knobs on the sides of the machine: lathed bodies with real knurl ribs and a recessed disc face.
    const r = m.platen.knobRadius;
    // Lathe axis y runs along the shaft, outward: skirt, knurled band, shoulder, and a shallow recess holding a black disc face.
    const knobBody = lathe([[0.0, 0.000], [r * 0.80, 0.000], [r * 0.96, 0.0020], [r, 0.0045], [r, 0.0195], [r * 0.975, 0.0222], [r * 0.87, 0.0242], [r * 0.83, 0.0272], [r * 0.81, 0.0276], [r * 0.79, 0.0252], [0, 0.0252]], 96);
    const faceDisc = lathe([[0, 0.0], [r * 0.785, 0.0], [r * 0.79, 0.0006], [0, 0.0006]], 64);
    const ribsTotal = 72;
    const ribGeo = () => {
      const rib = new THREE.BoxGeometry(0.0013, 0.0159, 0.0014).translate(0, 0.0119, 0).applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0, r + 0.0004));
      const all = [];
      for (let i = 0; i < ribsTotal; i++) all.push(rib.clone().applyMatrix4(new THREE.Matrix4().makeRotationY((i / ribsTotal) * Math.PI * 2)));
      return merged(all);
    };
    const knobX = Math.max(m.platen.length / 2 + m.platen.knobOffset, 0.2800);   // on the outside of the housing, as the machine has them
    this.knobs = {};
    const pgKnob = new THREE.Group(); pg.add(pgKnob);
    for (const sign of [-1, 1]) {
      const kg = new THREE.Group(); kg.position.x = sign * knobX; pgKnob.add(kg);
      kg.rotation.z = sign > 0 ? -Math.PI / 2 : Math.PI / 2;       // lathe +y becomes outward along the shaft on both sides
      const body = this.addMesh(knobBody.clone(), e.knob, kg);
      this.addMesh(faceDisc.clone().translate(0, 0.0254, 0), e.blackMatte, kg);
      this.addMesh(ribGeo(), e.knob, kg);
      if (sign < 0) this.knobL = body; else this.knobR = body;
      this.knobs[sign] = body;
    }
    this.knobX = knobX;
    this.knobNum = { L: this.knobL, R: this.knobR };
    const proxy = new THREE.CylinderGeometry(r + 0.002, r + 0.002, 0.036, 20).rotateZ(Math.PI / 2);
    for (const sign of [-1, 1]) {
      const pr = new THREE.Mesh(proxy.clone().translate(sign * (knobX + 0.015), 0, 0), new THREE.MeshBasicMaterial({ visible: false }));
      pg.add(pr);
      this.pickables.push({ object: pr, part: () => ({ kind: 'knob', side: sign, visual: () => (sign < 0 ? this.knobL : this.knobR) }) });
    }
    const platenProxy = new THREE.Mesh(cylX(R + 0.0006, m.platen.length, 0, 0, 0, 24), new THREE.MeshBasicMaterial({ visible: false }));
    pg.add(platenProxy);
    this.pickables.push({ object: platenProxy, part: () => ({ kind: 'platen', visual: () => this.platenRubber }) });
    // Feed rolls, under the platen; two rollers each on two rods, seen with the cover up.
    const feeds = [];
    for (const da of m.paper.feedRollAngle) {
      const a = m.printPoint.beta + da;
      const rr = 0.0052, dist = R + rr + 0.00018;
      const y = c.y + Math.sin(a) * dist, z = c.z + Math.cos(a) * dist;
      for (const fx of m.paper.feedRollX) feeds.push(cylX(rr, m.paper.feedRollWidth, fx, y, z, 20));
      feeds.push(cylX(0.0022, m.platen.length + 0.02, 0, y, z, 10));
    }
    this.addMesh(merged(feeds), e.rubber, this.root);
  }

  // ---------- paper table with printed scale; bail ----------
  buildTableAndBail() {
    const { m, rig, emats: e } = this;
    const c = V(m.platen.center), R = m.platen.radius;
    const beta = m.printPoint.beta;
    // Table: from the pan entry up-slope, the same line the sheet's collision uses, stopped at the rear cover's lip.
    const tipBeta = beta + m.paper.panArc[0];
    const tipR = R + m.paper.panClearance / 2;
    const tip = new THREE.Vector3(0, c.y + Math.sin(tipBeta) * tipR, c.z + Math.cos(tipBeta) * tipR);
    const tN = new THREE.Vector3(0, -Math.sin(tipBeta), -Math.cos(tipBeta));
    const tS = new THREE.Vector3(0, -Math.cos(tipBeta), Math.sin(tipBeta));
    const visible = (0.1985 - tip.y) / tS.y;         // up to the lip of the rear cover
    const w = 0.4120, h = visible;
    const can = document.createElement('canvas'); can.width = 2048; can.height = Math.round(2048 * h / w);
    const ctx = can.getContext('2d');
    ctx.fillStyle = '#0d0e10'; ctx.fillRect(0, 0, can.width, can.height);
    ctx.fillStyle = '#d9dad6'; ctx.strokeStyle = '#d9dad6'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    // Scale: 0 at the centre, numbered both ways every 10 characters at 10 pitch (a tick per character).
    const pxPerM = can.width / w, midX = can.width / 2, y0 = can.height * 0.28;
    const pitch = m.escapement.pitch;
    for (let k = -80; k <= 80; k++) {
      const x = midX + k * pitch * pxPerM;
      const tall = k % 10 === 0 ? 0.26 : k % 5 === 0 ? 0.18 : 0.11;
      ctx.lineWidth = k % 10 === 0 ? 2.4 : 1.2;
      ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y0 + can.height * tall); ctx.stroke();
    }
    ctx.font = `600 ${Math.round(can.height * 0.13)}px "Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif`;
    for (let k = -8; k <= 8; k++) ctx.fillText(`${Math.abs(k)}`, midX + k * 10 * pitch * pxPerM, y0 - can.height * 0.1);
    const tex = new THREE.CanvasTexture(can); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const tableMat = e.black.clone(); tableMat.map = tex; tableMat.roughness = 0.5; tableMat.color.set(0xffffff);
    const grp = new THREE.Group();
    grp.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X_AXIS, tN, tS.clone().negate()));
    grp.position.copy(tip).addScaledVector(tS, h / 2).addScaledVector(tN, -0.0009);
    // The printed face is a plane on top of a black slab, so only that one side carries the scale.
    this.addMesh(new THREE.BoxGeometry(w, 0.0015, h).translate(0, -0.00085, 0), e.blackMatte, grp);
    const printed = new THREE.PlaneGeometry(w, h).rotateX(-Math.PI / 2);
    this.table = this.addMesh(printed, tableMat, grp, 'table');
    this.root.add(grp);
    this.info(this.table, 'Paper table');
    // Pan shell under the platen, on the arc the paper's collision uses.
    const a0 = beta + m.paper.panArc[0], a1 = beta + m.paper.panArc[1], rP = R + m.paper.panClearance, thick = m.paper.panThickness, halfPan = m.paper.width / 2 + 0.05;
    const nA = 26, pan = [], idx = [];
    for (let i = 0; i <= nA; i++) {
      const a = a0 + (a1 - a0) * (i / nA);
      const y = c.y + Math.sin(a) * rP, z = c.z + Math.cos(a) * rP, y2 = c.y + Math.sin(a) * (rP + thick), z2 = c.z + Math.cos(a) * (rP + thick);
      pan.push(-halfPan, y, z, halfPan, y, z, -halfPan, y2, z2, halfPan, y2, z2);
    }
    const tri = (a, b, c2) => idx.push(a, b, c2);
    for (let i = 0; i < nA; i++) {
      const s0 = i * 4, s1 = (i + 1) * 4;
      tri(s0, s0 + 1, s1); tri(s0 + 1, s1 + 1, s1); tri(s0 + 2, s1 + 2, s0 + 3); tri(s0 + 3, s1 + 2, s1 + 3);
      tri(s0, s1, s0 + 2); tri(s0 + 2, s1, s1 + 2); tri(s0 + 1, s0 + 3, s1 + 1); tri(s0 + 3, s1 + 3, s1 + 1);
    }
    const panG = new THREE.BufferGeometry(); panG.setAttribute('position', new THREE.Float32BufferAttribute(pan, 3)); panG.setIndex(idx); panG.computeVertexNormals();
    this.addMesh(panG, e.cast, this.root);

    // Bail: chrome rod with three black rollers, chrome end brackets rising from the side frames. Pivot from the rig.
    const bailG = new THREE.Group(); bailG.position.set(0, rig.bail.pivot[1], rig.bail.pivot[2]); this.root.add(bailG); this.bailGroup = bailG; bailG.name = 'bail';
    const bar = new THREE.Vector3(0, rig.bail.bar[1] - rig.bail.pivot[1], rig.bail.bar[2] - rig.bail.pivot[2]);
    const half = m.platen.length / 2 + 0.007;
    const rod = cylX(m.paper.bailRodRadius, half * 2, 0, bar.y, bar.z, 24);
    this.bailMesh = this.addMesh(rod, e.chrome, bailG);
    const rollers = [-m.paper.feedRollX[1], 0, m.paper.feedRollX[1]].map((x) => cylX(m.paper.bailRollerRadius, 0.022, x, bar.y, bar.z, 24));
    this.addMesh(merged(rollers), e.black, bailG);
    // End brackets: flat chrome plates from the pivot pin up to the rod, with the small foot the photographs show.
    const br = (sign) => {
      const hw = 0.0052, len = bar.length() + 0.012;
      const pl = new THREE.Shape();
      pl.moveTo(-hw, -0.008); pl.lineTo(hw, -0.008); pl.lineTo(hw * 0.7, len); pl.lineTo(-hw * 0.7, len); pl.closePath();
      const g2 = new THREE.ExtrudeGeometry(pl, { depth: 0.0018, bevelEnabled: true, bevelSize: 0.0003, bevelThickness: 0.0003, bevelSegments: 1 }).rotateY(Math.PI / 2);
      g2.translate(sign * half - 0.0009, 0, 0);
      g2.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.atan2(bar.z, bar.y)));
      return g2;
    };
    this.bailBrackets = this.addMesh(merged([br(1), br(-1)]), e.chrome, bailG);
    const pr = new THREE.Mesh(cylX(0.0058, half * 2, 0, bar.y, bar.z, 8), new THREE.MeshBasicMaterial({ visible: false }));
    bailG.add(pr);
    this.pickables.push({ object: pr, part: () => ({ kind: 'bail', visual: () => this.bailMesh }) });
  }

  // ---------- keyboard ----------
  buildKeys() {
    const { g, emats: e } = this;
    this.keysGroup = new THREE.Group(); this.keysGroup.name = 'keys'; this.root.add(this.keysGroup);
    this.keyAtlas = makeKeyAtlas(g);
    const capMat = e.keyPlastic.clone(); capMat.map = this.keyAtlas.tex; capMat.color.set(0xffffff);
    capMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aAtlas;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n vMapUv = uv * aAtlas.zw + aAtlas.xy;\n#endif');
    };
    capMat.customProgramCacheKey = () => 'element-keycap';
    this.capMat = capMat;
    const letterCap = capGeometry(keycaps.letterW, keycaps.letterD, 0.0108, { dish: 0.00085 });
    const prints = g.keys.map((k, i) => ({ k, i })).filter(({ k }) => k.kind === 'print');
    const inst = new THREE.InstancedMesh(letterCap, capMat, prints.length);
    inst.frustumCulled = false; inst.castShadow = inst.receiveShadow = true; inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const atlasAttr = new Float32Array(prints.length * 4);
    prints.forEach(({ k }, j) => { const a = this.keyAtlas.cell(k.id); atlasAttr.set([a.x, a.y, a.w, a.h], j * 4); });
    letterCap.setAttribute('aAtlas', new THREE.InstancedBufferAttribute(atlasAttr, 4));
    this.keysGroup.add(inst);
    this.prints = prints; this.printsInst = inst;
    const stem = new THREE.BoxGeometry(0.009, 0.012, 0.009).translate(0, -0.0155, 0);
    const stems = new THREE.InstancedMesh(stem, e.blackMatte, prints.length);
    stems.frustumCulled = false; stems.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.keysGroup.add(stems); this.printsStem = stems;
    // Proxies for picking.
    const proxy = new THREE.InstancedMesh(new THREE.BoxGeometry(keycaps.letterW, 0.007, keycaps.letterD).translate(0, -0.0015, 0), new THREE.MeshBasicMaterial({ visible: false }), prints.length);
    proxy.frustumCulled = false; proxy.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.keysGroup.add(proxy); this.printsProxy = proxy;
    this.pickables.push({ object: proxy, part: (id) => ({ kind: 'key', index: prints[id].i, visual: () => this.keyVisual(id) }) });

    // Controls: one mesh each, sized from the shared table. Atlas rect lives in vertex uv: no instancing shader needed.
    this.controlMeshes = [];
    const plainCap = e.keyPlastic.clone(); plainCap.color.set(0x132019);
    g.keys.forEach((k, i) => {
      if (k.kind === 'print') return;
      const c = keycaps.controls[k.id];
      const opts = k.id === 'space' ? { radius: 0.0048, taper: 0.88, dish: 0.0012 } : { dish: 0.0007 };
      const geo = capGeometry(c.w, c.d, k.id === 'space' ? 0.0082 : 0.0108, opts);
      const a = this.keyAtlas.cell(k.id);
      if (a) {
        const uv = geo.getAttribute('uv');
        for (let p = 0; p < uv.count; p++) uv.setXY(p, uv.getX(p) * a.w + a.x, uv.getY(p) * a.h + a.y);
        uv.needsUpdate = true;
      }
      const stm = new THREE.BoxGeometry(c.w * 0.5, 0.012, c.d * 0.5).translate(0, -0.0155, 0);
      const group = new THREE.Group(); group.position.set(k.pos[0], k.pos[1], k.pos[2]);
      const mat = a ? capMat.clone() : plainCap;
      if (a) { mat.onBeforeCompile = () => {}; mat.customProgramCacheKey = () => 'element-keycap-plain'; }
      const mesh = this.addMesh(geo, mat, group);
      this.addMesh(stm, e.blackMatte, group);
      this.keysGroup.add(group);
      if (k.id === 'onOff') {
        // The red band below OFF, on the skirt.
        const red = new THREE.BoxGeometry(c.w * 0.82, 0.0014, 0.0012).translate(0, -0.0074, c.d * 0.49);
        this.addMesh(red, new THREE.MeshPhysicalMaterial({ color: 0x8a1c14, roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.25 }), group);
      }
      const pr = new THREE.Mesh(new THREE.BoxGeometry(c.w, 0.007, c.d).translate(0, -0.0015, 0), new THREE.MeshBasicMaterial({ visible: false }));
      group.add(pr);
      this.pickables.push({ object: pr, part: () => ({ kind: 'key', index: i, label: keycaps.controls[k.id].label.replace('\n', ' ') || 'Space bar', visual: () => mesh }) });
      this.controlMeshes.push({ group, k, i });
    });
    this.keyDown = new Float32Array(g.nKeys).fill(-1);
    this.updateKeys(new Float32Array(g.nKeys), 0, true);
  }

  keyVisual(id) {
    this.printsInst.getMatrixAt(id, this._hlM ||= new THREE.Matrix4());
    return { geometry: this.printsInst.geometry, matrix: this._hlM, parent: this.keysGroup };
  }

  updateKeys(s, off, force) {
    const { keyDown } = this;
    let dirty = !!force;
    for (let j = 0; j < this.prints.length; j++) {
      const { k, i } = this.prints[j];
      const x = s[off + i];
      if (!force && x === keyDown[i]) continue;
      keyDown[i] = x; dirty = true;
      tmpM.identity().setPosition(k.pos[0], k.pos[1] - x, k.pos[2]);
      this.printsInst.setMatrixAt(j, tmpM); this.printsStem.setMatrixAt(j, tmpM); this.printsProxy.setMatrixAt(j, tmpM);
    }
    if (dirty) { this.printsInst.instanceMatrix.needsUpdate = this.printsStem.instanceMatrix.needsUpdate = this.printsProxy.instanceMatrix.needsUpdate = true; this.printsProxy.boundingSphere = null; }
    for (const { group, k, i } of this.controlMeshes) {
      const x = s[off + i];
      if (force || x !== keyDown[i]) { keyDown[i] = x; group.position.y = k.pos[1] - x; }
    }
    return dirty;
  }

  // ---------- dual scale strip at the foot of the hood, margin sliders below it ----------
  buildStrip() {
    const { m, emats: e } = this;
    const zTop = 0.0600, yTop = 0.1372, zBot = 0.0660, yBot = 0.1178;
    const up = new THREE.Vector3(0, yTop - yBot, zTop - zBot);
    const H = up.length(); up.normalize();
    const W = 0.4830, n = new THREE.Vector3().crossVectors(X_AXIS, up).normalize();
    const can = document.createElement('canvas'); can.width = 4096; can.height = Math.round(4096 * H / W * 0.5) * 2;
    const ctx = can.getContext('2d');
    ctx.fillStyle = '#0a0b0c'; ctx.fillRect(0, 0, can.width, can.height);
    const px = can.width / W, h = can.height, wht = '#e8e9e4';
    ctx.fillStyle = wht; ctx.strokeStyle = wht; ctx.textBaseline = 'alphabetic';
    const fam = '"Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif';
    const pitchA = m.escapement.pitch, pitchB = 0.0254 / 12;
    const leftPad = 0.0355;
    ctx.font = `600 ${h * 0.14}px ${fam}`; ctx.textAlign = 'left';
    ctx.fillText('10', px * 0.003, h * 0.27); ctx.fillText('12', px * 0.003, h * 0.72);
    const tri = (x, y, s, filled) => { ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x + s * 0.8, y + s * 0.6); ctx.lineTo(x - s * 0.8, y + s * 0.6); ctx.closePath(); if (filled) ctx.fill(); else { ctx.lineWidth = 1.6; ctx.stroke(); } };
    tri(px * 0.012, h * 0.21, h * 0.06, true); tri(px * 0.012, h * 0.66, h * 0.06, false);
    const scale = (pitch, count, yLine, yNum, numAbove) => {
      ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(px * leftPad, yLine); ctx.lineTo(can.width - px * 0.004, yLine); ctx.stroke();
      ctx.textAlign = 'center';
      ctx.font = `500 ${h * 0.115}px ${fam}`;
      for (let i = 0; i <= count; i++) {
        const x = px * leftPad + i * pitch * px;
        const big = i % 5 === 0;
        ctx.lineWidth = big ? 1.8 : 1.1;
        ctx.beginPath(); ctx.moveTo(x, yLine); ctx.lineTo(x, yLine + (numAbove ? -1 : 1) * h * (big ? 0.075 : 0.04)); ctx.stroke();
        if (big) ctx.fillText(`${i}`, x, yNum);
      }
    };
    scale(pitchA, 130, h * 0.42, h * 0.25, true);
    scale(pitchB, 155, h * 0.62, h * 0.85, false);
    const tex = new THREE.CanvasTexture(can); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const stripMat = e.black.clone(); stripMat.map = tex; stripMat.color.set(0xffffff); stripMat.roughness = 0.35;
    const geo = new THREE.PlaneGeometry(W, H);
    const strip = new THREE.Mesh(geo, stripMat);
    strip.castShadow = false; strip.receiveShadow = true;
    const cent = new THREE.Vector3(0, (yTop + yBot) / 2, (zTop + zBot) / 2);
    strip.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X_AXIS, up, n));
    strip.position.copy(cent);
    this.root.add(strip); this.strip = strip;
    // Rail and backing for the margin sliders.
    const back = new THREE.Mesh(new THREE.BoxGeometry(W + 0.006, H + 0.008, 0.003).translate(0, 0, -0.002), e.black);
    back.quaternion.copy(strip.quaternion); back.position.copy(cent).addScaledVector(n, -0.0004);
    back.receiveShadow = true; this.root.add(back);
    const railY = yBot - 0.0012, railZ = zBot + 0.0030;
    this.addMesh(box(W, 0.0026, 0.0038, 0, railY, railZ), e.cast, this.root);
    // Margin sliders: a chrome saddle on the rail with a short tongue pointing up the face of the strip.
    const sliderGeo = merged([
      box(0.0078, 0.0034, 0.0066, 0, 0, 0),
      new THREE.BoxGeometry(0.0034, 0.0150, 0.0009).translate(0, 0.0075, 0.0022).rotateX(-0.28),
    ]);
    this.margins = { L: this.addMesh(sliderGeo, e.chrome, this.root), R: this.addMesh(sliderGeo.clone(), e.chrome, this.root) };
    this.margins.L.position.set(0, railY + 0.0030, railZ + 0.0012); this.margins.R.position.set(0, railY + 0.0030, railZ + 0.0012);
    for (const side of ['L', 'R']) {
      const pr = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.02, 0.014).translate(0, 0.006, 0), new THREE.MeshBasicMaterial({ visible: false }));
      this.margins[side].add(pr);
      this.pickables.push({ object: pr, raised: () => true, part: () => ({ kind: 'margin', side, visual: () => this.margins[side] }) });
    }
    // Red carrier pointer, moving with the carrier along the strip's rail: a small L with its tongue up the scale.
    const pointer = merged([box(0.0020, 0.0100, 0.0008, 0, 0.0050, 0), box(0.0058, 0.0020, 0.0014, 0.0019, 0.0006, 0.0004)]);
    this.pointer = this.addMesh(pointer, new THREE.MeshPhysicalMaterial({ color: 0xa41610, roughness: 0.45, clearcoat: 0.6, clearcoatRoughness: 0.3 }), this.root);
    this.pointer.rotation.x = -0.18;
    this.pointer.position.set(0, yBot + 0.0030, zBot + 0.0012);
  }

  // ---------- carrier: ball, tilt ring, rotate tube, ribbon cartridge ----------
  buildCarrier() {
    const { m, g, emats: e, glyphs } = this;
    const E = g.element;
    const carrier = new THREE.Group(); carrier.name = 'carriage'; this.root.add(carrier); this.carriage = carrier;
    const c = V(E.center);
    const n = V(g.printNormal), wDown = V(g.strikeDown);
    // Rocker plate under the ball; the body stops just below it, and the rocker lifts clear of the body on a strike.
    const plateY = c.y - E.ballRadius * 1.3 - 0.0035, bodyTop = plateY - 0.0046, bodyBot = this.railY - 0.012;
    const bodyGeo = merged([
      box(0.052, bodyTop - bodyBot, 0.022, 0, (bodyTop + bodyBot) / 2, this.railZ - 0.001),
      box(0.030, bodyTop - bodyBot, 0.030, 0, (bodyTop + bodyBot) / 2, this.railZ + 0.018),
    ]);
    this.plateMesh = this.addMesh(bodyGeo, e.cast, carrier, 'carrier_body');
    this.pickables.push({ object: this.plateMesh, low: true, part: () => ({ kind: 'carriage', visual: () => this.plateMesh }) });
    // The rocker carries head, ring and tube; it swings the ball toward the platen.
    const rocker = new THREE.Group(); rocker.name = 'rocker'; rocker.position.set(0, 0, 0); carrier.add(rocker); this.rocker = rocker;
    const postX = E.ballRadius + 0.0080;
    const rockerYoke = merged([
      box(0.0496, 0.0065, 0.019, 0, plateY, c.z),
      box(0.0030, c.y + 0.0030 - plateY, 0.0050, -postX, (c.y + 0.0030 + plateY) / 2, c.z),
      box(0.0030, c.y + 0.0030 - plateY, 0.0050, postX, (c.y + 0.0030 + plateY) / 2, c.z),
      new THREE.CylinderGeometry(0.0052, 0.0052, c.y - E.ballRadius * 1.3 - plateY, 24).translate(0, (c.y - E.ballRadius * 1.3 + plateY) / 2, c.z),
    ]);
    const yokeM = this.addMesh(rockerYoke, e.cast, rocker);
    this.info(yokeM, 'Rocker');
    const tilt = new THREE.Group(); tilt.name = 'tilt'; tilt.position.copy(c); rocker.add(tilt); this.tiltRing = tilt;
    // Tilt ring: a U of round bar around the ball, carried on trunnions at the ball's centre height, closing into a collar under the ball.
    const armX = E.ballRadius + 0.0045, ringLow = -E.ballRadius * 1.02;
    const uPath = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-armX, 0.0018, 0), new THREE.Vector3(-armX, -0.006, 0), new THREE.Vector3(-armX * 0.82, ringLow * 0.8, 0),
      new THREE.Vector3(-armX * 0.42, ringLow, 0), new THREE.Vector3(0, ringLow * 1.03, 0), new THREE.Vector3(armX * 0.42, ringLow, 0),
      new THREE.Vector3(armX * 0.82, ringLow * 0.8, 0), new THREE.Vector3(armX, -0.006, 0), new THREE.Vector3(armX, 0.0018, 0),
    ], false, 'catmullrom', 0.25);
    const ringG = merged([
      new THREE.TubeGeometry(uPath, 64, 0.0012, 12, false),
      new THREE.CylinderGeometry(0.0034, 0.0034, 0.0036, 20).rotateZ(Math.PI / 2).translate(-(postX - 0.0034), 0, 0),
      new THREE.CylinderGeometry(0.0034, 0.0034, 0.0036, 20).rotateZ(Math.PI / 2).translate(postX - 0.0034, 0, 0),
      new THREE.TorusGeometry(0.0062, 0.0012, 10, 32).rotateX(Math.PI / 2).translate(0, ringLow, 0),
    ]);
    const ringMesh = this.addMesh(ringG, e.chrome, tilt);
    this.info(ringMesh, 'Tilt ring');
    const tube = new THREE.Group(); tube.name = 'rotate'; tilt.add(tube); this.rotateTube = tube;
    const tubeGeo = lathe([[0, -E.ballRadius * 1.3], [0.0042, -E.ballRadius * 1.3], [0.0042, E.ballRadius * 0.02], [0.0030, E.ballRadius * 0.2], [0, E.ballRadius * 0.2]], 28);
    const tubeM = this.addMesh(tubeGeo, e.chrome, tube);
    this.info(tubeM, 'Rotate tube');
    // Detent teeth on the rotate tube's lower collar.
    const collar = lathe([[0, -E.ballRadius * 0.98], [E.ballRadius * 0.40, -E.ballRadius * 0.98], [E.ballRadius * 0.42, -E.ballRadius * 0.95], [E.ballRadius * 0.42, -E.ballRadius * 0.86], [E.ballRadius * 0.34, -E.ballRadius * 0.82], [0, -E.ballRadius * 0.82]], 40);
    this.addMesh(collar, e.chrome, tube);
    // The ball.
    const ballMat = new THREE.MeshPhysicalMaterial({ color: 0xcfd0cf, roughness: 0.3, metalness: 1, envMapIntensity: 1.1 });
    const ball = buildTypeBall(m, g, glyphs);
    const typedMat = ballMat.clone(); typedMat.normalMap = ball.normalTex; typedMat.normalScale.set(1.1, 1.1);
    const ballG = new THREE.Group(); ballG.name = 'type_element'; tube.add(ballG); this.ballGroup = ballG;
    this.ballBody = this.addMesh(ball.body, ballMat, ballG, 'ball_body');
    this.typeFaces = this.addMesh(ball.geom, typedMat, ballG, 'ball_faces');
    // The black cap on top of the ball: a low knob with a pale typeface label and a small ridge to lift it by.
    const Rb = E.ballRadius, capTop = Rb * 1.09;
    const cap = merged([
      lathe([[0, Rb * 0.78], [0.0105, Rb * 0.78], [0.0112, Rb * 0.86], [0.0100, Rb * 1.02], [0.0060, capTop - 0.0002], [0, capTop]], 48),
      box(0.0048, 0.0030, 0.0070, 0, capTop + 0.0010, -0.0058),
    ]);
    this.addMesh(cap, e.black, ballG);
    const can = document.createElement('canvas'); can.width = can.height = 256;
    const ctx = can.getContext('2d');
    ctx.fillStyle = '#0b0b0c'; ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = '#d8d6c8'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '700 62px "Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif';
    ctx.fillText('10', 128, 96);
    ctx.font = '600 38px "Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif';
    ctx.fillText('PITCH', 128, 164);
    const labelTex = new THREE.CanvasTexture(can); labelTex.colorSpace = THREE.SRGBColorSpace; labelTex.anisotropy = 8;
    const label = new THREE.Mesh(new THREE.CircleGeometry(0.0072, 40).rotateX(-Math.PI / 2).translate(0, capTop + 0.0001, 0), new THREE.MeshPhysicalMaterial({ map: labelTex, roughness: 0.35, clearcoat: 0.4, clearcoatRoughness: 0.3 }));
    label.name = 'ball_label'; ballG.add(label);
    const ballProxy = new THREE.Mesh(new THREE.SphereGeometry(E.ballRadius + 0.001, 20, 14), new THREE.MeshBasicMaterial({ visible: false }));
    ballG.add(ballProxy);
    this.pickables.push({ object: ballProxy, raised: () => true, part: () => ({ kind: 'info', label: 'Type element', visual: () => null }) });
    this.buildCartridge(carrier, c);
    this.buildCardHolder(carrier);
    this.buildCorrectionTape(carrier);
    this._nDir = n; this._w = wDown;
    this.ballCenter0 = c.clone();
  }

  // ---------- ribbon cartridge: the large grey moulding in front of and below the ball ----------
  buildCartridge(carrier, c) {
    const { emats: e } = this;
    const tilt = CARTRIDGE.tilt, { hubX, lobeR, front, T, notchR, ballV } = CARTRIDGE, hw = hubX + lobeR;
    const hub = cartridgeHub(c);
    const cart = new THREE.Group(); cart.name = 'ribbon_cartridge';
    cart.position.set(0, hub.y, hub.z); cart.rotation.x = tilt;
    carrier.add(cart); this.cartridge = cart;
    const grey = new THREE.MeshPhysicalMaterial({ color: 0x8c908d, roughness: 0.58, clearcoat: 0.12, clearcoatRoughness: 0.5 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x0c0d0e, roughness: 0.7 });
    const orange = new THREE.MeshPhysicalMaterial({ color: 0xee5a14, roughness: 0.42, clearcoat: 0.3, clearcoatRoughness: 0.4 });

    // Outline in the moulding's own plane: x across, y toward the typist, the hub line at y = 0. Two lobes meet at a smooth concave cut that the ball sits in.
    const smax = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * 0.25; };
    const outline = [];
    const nRear = 160;
    for (let i = 0; i <= nRear; i++) {
      const x = -hw + (2 * hw * i) / nRear;
      const u = Math.abs(x) - hubX;
      const lobe = -Math.sqrt(Math.max(lobeR * lobeR - u * u, 0));
      const notch = Math.abs(x) < notchR ? ballV + Math.sqrt(notchR * notchR - x * x) : -1;
      outline.push(new THREE.Vector2(x, smax(lobe, notch, 0.006)));
    }
    const rc = 0.009;
    const corner = (cx, cy, a0) => { for (let i = 0; i <= 10; i++) { const a = a0 + (i / 10) * Math.PI / 2; outline.push(new THREE.Vector2(cx + Math.cos(a) * rc, cy + Math.sin(a) * rc)); } };
    corner(hw - rc, front - rc, 0);
    corner(-hw + rc, front - rc, Math.PI / 2);
    const inset = (pts, d) => pts.map((p, i) => {
      const a = pts[(i + pts.length - 1) % pts.length], b = pts[(i + 1) % pts.length];
      const t = new THREE.Vector2().subVectors(b, a).normalize();
      return new THREE.Vector2(p.x - t.y * d, p.y + t.x * d);      // left of the counter-clockwise direction of travel is inward
    });
    const sector = (cx, a0, a1, rIn, rOut) => {
      const path = new THREE.Path(), n = 28, deg = Math.PI / 180;
      for (let i = 0; i <= n; i++) { const a = (a0 + ((a1 - a0) * i) / n) * deg; const px = cx + Math.cos(a) * rOut, py = Math.sin(a) * rOut; if (i === 0) path.moveTo(px, py); else path.lineTo(px, py); }
      for (let i = n; i >= 0; i--) { const a = (a0 + ((a1 - a0) * i) / n) * deg; path.lineTo(cx + Math.cos(a) * rIn, Math.sin(a) * rIn); }
      path.closePath();
      return path;
    };
    const circlePath = (cx, cy, r) => { const p = new THREE.Path(); p.absarc(cx, cy, r, 0, Math.PI * 2, true); return p; };
    const top = new THREE.Shape(outline);
    const rIn = 0.0214, rOut = lobeR - 0.0034, rOutFront = Math.min(rOut, front - 0.0036);
    for (const side of [-1, 1]) {
      const cx = side * hubX;
      top.holes.push(sector(cx, -128, -56, rIn, rOut));                                                  // rear window
      top.holes.push(side < 0 ? sector(cx, 154, 214, rIn, rOut) : sector(cx, -34, 26, rIn, rOut));       // outer window
      top.holes.push(sector(cx, 40, 140, rIn, rOutFront));                                               // front window
    }
    top.holes.push(circlePath(hubX, 0, 0.0118));      // the drive hub's round opening
    const extrude = (shape, depth, bevel = 0) => new THREE.ExtrudeGeometry(shape, { depth, curveSegments: 36, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2 }).rotateX(Math.PI / 2);
    const topG = extrude(top, 0.0016, 0.0003).translate(0, T, 0);
    const floorG = extrude(new THREE.Shape(outline), 0.0012).translate(0, -T + 0.0012, 0);
    const wall = new THREE.Shape(outline);
    wall.holes.push(new THREE.Path(inset(outline, 0.0016).reverse()));
    const wallG = extrude(wall, 2 * T - 0.0028).translate(0, T - 0.0016, 0);
    // The circular moulded dishes around each hub, and the central label panel.
    const ring = (cx, rA, rB) => { const sh = new THREE.Shape(); sh.absarc(cx, 0, rA, 0, Math.PI * 2, false); sh.holes.push(circlePath(cx, 0, rB)); return sh; };
    const surface = T + 0.0003;      // the top plate's face, its bevel included
    const dishes = [extrude(ring(-hubX, 0.0212, 0.0198), 0.0005).translate(0, surface + 0.0005, 0), extrude(ring(hubX, 0.0212, 0.0198), 0.0005).translate(0, surface + 0.0005, 0)];
    this.cartShell = this.addMesh(merged([topG, floorG, wallG, ...dishes]), grey, cart, 'cartridge_shell');
    this.info(this.cartShell, 'Ribbon cartridge');
    const panel = new THREE.Shape();
    const px0 = -0.0165, px1 = 0.0165, py0 = 0.0085, py1 = 0.0285, pr = 0.0028;
    panel.moveTo(px0 + pr, py0); panel.lineTo(px1 - pr, py0); panel.quadraticCurveTo(px1, py0, px1, py0 + pr); panel.lineTo(px1, py1 - pr); panel.quadraticCurveTo(px1, py1, px1 - pr, py1); panel.lineTo(px0 + pr, py1); panel.quadraticCurveTo(px0, py1, px0, py1 - pr); panel.lineTo(px0, py0 + pr); panel.quadraticCurveTo(px0, py0, px0 + pr, py0);
    this.addMesh(extrude(panel, 0.0003).translate(0, surface + 0.00035, 0), new THREE.MeshPhysicalMaterial({ color: 0xc2c6c2, roughness: 0.38 }), cart);
    // The slot from the left hub toward the middle, and two arrows round the drive hub: moulded dark marks standing just proud of the plate.
    const slot = new THREE.Shape();
    const sx0 = -hubX + 0.0100, sx1 = -hubX + 0.0390, sh = 0.0036;
    slot.moveTo(sx0, -sh); slot.lineTo(sx1 - sh, -sh); slot.absarc(sx1 - sh, 0, sh, -Math.PI / 2, Math.PI / 2, false); slot.lineTo(sx0, sh); slot.closePath();
    const arrow = (a0, a1, r) => {
      const n = 22, deg = Math.PI / 180, w = 0.0006, sh2 = new THREE.Shape(), d = Math.sign(a1 - a0);
      const at = (a, rr) => [hubX + Math.cos(a * deg) * rr, Math.sin(a * deg) * rr];
      for (let i = 0; i <= n; i++) { const [x, y] = at(a0 + ((a1 - a0) * i) / n, r + w); if (i === 0) sh2.moveTo(x, y); else sh2.lineTo(x, y); }
      const [hx, hy] = at(a1 + d * 12, r); const [ox, oy] = at(a1, r + 0.0030); const [ix, iy] = at(a1, r - 0.0030);
      sh2.lineTo(ox, oy); sh2.lineTo(hx, hy); sh2.lineTo(ix, iy);
      for (let i = n; i >= 0; i--) { const [x, y] = at(a0 + ((a1 - a0) * i) / n, r - w); sh2.lineTo(x, y); }
      return sh2;
    };
    this.addMesh(merged([extrude(slot, 0.0003), extrude(arrow(112, 42, 0.0172), 0.0003), extrude(arrow(-68, -138, 0.0172), 0.0003)]).translate(0, surface + 0.00035, 0), dark, cart);

    // A dark floor round each hub, so the windows only ever show ribbon and shadow.
    this.addMesh(merged([new THREE.CylinderGeometry(lobeR - 0.003, lobeR - 0.003, 0.0004, 56).translate(-hubX, -T + 0.0016, 0), new THREE.CylinderGeometry(lobeR - 0.003, lobeR - 0.003, 0.0004, 56).translate(hubX, -T + 0.0016, 0)]), dark, cart);
    // Hubs and wound ribbon, turning inside the moulding.
    const windG = new THREE.CylinderGeometry(1, 1, 2 * T - 0.0048, 48);
    const spool = (x, side) => {
      const grp = new THREE.Group(); grp.position.set(x, 0, 0); cart.add(grp);
      const wind = this.addMesh(windG, this.windMat ||= new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.62 }), grp);
      wind.scale.set(0.030, 1, 0.030);
      const pr2 = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 2 * T + 0.006, 12), new THREE.MeshBasicMaterial({ visible: false }));
      grp.add(pr2);
      this.pickables.push({ object: pr2, part: () => ({ kind: 'spool', side, visual: () => wind }) });
      return { group: grp, wind };
    };
    this.spools = { L: spool(-hubX, 'L'), R: spool(hubX, 'R') };
    // Supply side: a black flanged hub and a steel centre on the plate.
    const hubL = merged([lathe([[0, surface], [0.0092, surface], [0.0094, surface + 0.0005], [0.0088, surface + 0.0011], [0.0040, surface + 0.0011], [0.0034, surface + 0.0005], [0, surface + 0.0005]], 40)]);
    this.addMesh(hubL, e.black, this.spools.L.group);
    this.addMesh(new THREE.CylinderGeometry(0.0026, 0.0026, 0.0012, 20).translate(0, surface + 0.0006, 0), e.chrome, this.spools.L.group);
    // Drive side: the orange geared hub in its opening, a pale wheel beside it.
    const gear = new THREE.Shape();
    for (let i = 0; i < 18; i++) {
      const a0 = (i / 18) * Math.PI * 2, a1 = ((i + 0.5) / 18) * Math.PI * 2;
      const rA = 0.0072, rB = 0.0080;
      if (i === 0) gear.moveTo(Math.cos(a0) * rB, Math.sin(a0) * rB); else gear.lineTo(Math.cos(a0) * rB, Math.sin(a0) * rB);
      gear.lineTo(Math.cos(a1) * rB, Math.sin(a1) * rB); gear.lineTo(Math.cos(a1) * rA, Math.sin(a1) * rA); gear.lineTo(Math.cos(a0 + (Math.PI * 2) / 18) * rA, Math.sin(a0 + (Math.PI * 2) / 18) * rA);
    }
    gear.closePath();
    gear.holes.push(circlePath(0, 0, 0.0028));
    this.addMesh(new THREE.ExtrudeGeometry(gear, { depth: 0.0058, bevelEnabled: false, curveSegments: 12 }).rotateX(Math.PI / 2).translate(0, T + 0.0020, 0), orange, this.spools.R.group);
    this.addMesh(new THREE.CylinderGeometry(0.0028, 0.0028, 0.002, 18).translate(0, T - 0.0016, 0), dark, this.spools.R.group);
    this.addMesh(new THREE.CylinderGeometry(0.0046, 0.0046, 0.0016, 28).translate(hubX + 0.0064, T - 0.0024, 0.0034), new THREE.MeshStandardMaterial({ color: 0xcdc7ae, roughness: 0.5 }), cart);
    this.addMesh(new THREE.CylinderGeometry(0.0118, 0.0118, 0.0014, 40).translate(hubX, -T + 0.0036, 0), dark, cart);
    // Chrome posts either side of the print point: the ribbon's guides, and the frame the card holder hangs between.
    this.cartridgeHub = hub;
  }

  // ---------- clear plastic card holder in front of the print point, between two chrome posts ----------
  buildCardHolder(carrier) {
    const { m, g, emats: e } = this;
    const R = m.platen.radius, ctr = V(m.platen.center), beta = m.printPoint.beta;
    const rp = R + 0.00065, W = 0.0255, sB = -0.0120, sT = 0.0112;
    const cw = 1024, ch = Math.round((1024 * (sT - sB)) / (2 * W));
    const can = document.createElement('canvas'); can.width = cw; can.height = ch;
    const ctx = can.getContext('2d');
    const X = (u) => ((u + W) / (2 * W)) * cw, Y = (s) => ((sT - s) / (sT - sB)) * ch, S = cw / (2 * W);
    const outline = () => {
      const r = 0.0085, notchW = 0.0011, notchD = 0.0016;
      ctx.beginPath();
      ctx.moveTo(X(-W), Y(sB)); ctx.lineTo(X(-W), Y(sT - r));
      ctx.quadraticCurveTo(X(-W), Y(sT), X(-W + r), Y(sT));
      ctx.lineTo(X(-notchW), Y(sT)); ctx.lineTo(X(0), Y(sT - notchD)); ctx.lineTo(X(notchW), Y(sT));
      ctx.lineTo(X(W - r), Y(sT)); ctx.quadraticCurveTo(X(W), Y(sT), X(W), Y(sT - r));
      ctx.lineTo(X(W), Y(sB)); ctx.closePath();
    };
    outline(); ctx.fillStyle = 'rgba(224,228,220,0.13)'; ctx.fill();
    // Printed marks, under the arch and at the shoulders.
    const printLine = (u0, u1, s, color, lw) => { ctx.strokeStyle = color; ctx.lineWidth = lw * S; ctx.beginPath(); ctx.moveTo(X(u0), Y(s)); ctx.lineTo(X(u1), Y(s)); ctx.stroke(); };
    const red = 'rgba(196,44,24,0.92)', tan = 'rgba(150,118,70,0.55)';
    printLine(-W + 0.0015, -0.0106, -0.0030, red, 0.0007); printLine(0.0106, W - 0.0015, -0.0030, red, 0.0007);
    printLine(-W + 0.0015, W - 0.0015, 0.0078, tan, 0.00035);
    ctx.strokeStyle = tan; ctx.lineWidth = 0.00045 * S;
    for (const u of [-0.013, 0, 0.013]) { ctx.beginPath(); ctx.moveTo(X(u), Y(sT - 0.0002)); ctx.lineTo(X(u), Y(0.0050)); ctx.stroke(); }
    // The arch the type strikes through: cut clean away, so the line being typed is seen without the plastic over it.
    const archR = 0.0108, archY = -0.0050;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.moveTo(X(-archR), Y(sB - 0.001)); ctx.lineTo(X(-archR), Y(archY));
    ctx.arc(X(0), Y(archY), archR * S, Math.PI, 0, false);
    ctx.lineTo(X(archR), Y(sB - 0.001)); ctx.closePath(); ctx.fillStyle = '#000'; ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    // A bright moulded rim along the edges and the arch.
    ctx.strokeStyle = 'rgba(248,250,246,0.55)'; ctx.lineWidth = 0.00035 * S;
    outline(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(X(-archR), Y(sB)); ctx.lineTo(X(-archR), Y(archY)); ctx.arc(X(0), Y(archY), archR * S, Math.PI, 0, false); ctx.lineTo(X(archR), Y(sB)); ctx.stroke();
    const tex = new THREE.CanvasTexture(can); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.premultiplyAlpha = false;
    // A curved sheet on the platen's own arc, a hair off the paper and behind the ribbon and tape.
    const nU = 8, nV = 28, pos = [], uv = [], nor = [], idx = [];
    for (let j = 0; j <= nV; j++) for (let i = 0; i <= nU; i++) {
      const u = -W + (2 * W * i) / nU, s = sB + ((sT - sB) * j) / nV, a = beta + s / rp;
      pos.push(u, ctr.y + Math.sin(a) * rp, ctr.z + Math.cos(a) * rp);
      nor.push(0, Math.sin(a), Math.cos(a));
      uv.push(i / nU, j / nV);
      if (i < nU && j < nV) { const q = j * (nU + 1) + i; idx.push(q, q + 1, q + nU + 1, q + 1, q + nU + 2, q + nU + 1); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx);
    const mat = new THREE.MeshPhysicalMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, roughness: 0.12, metalness: 0, ior: 1.49, envMapIntensity: 1.0 });
    const holder = new THREE.Mesh(geo, mat); holder.name = 'card_holder'; holder.renderOrder = 8; holder.castShadow = false; holder.receiveShadow = false;
    carrier.add(holder); this.cardHolder = holder;
    this.pickables.push({ object: holder, low: true, part: () => ({ kind: 'info', label: 'Card holder', visual: () => null }) });
    // The two chrome posts and their black feet on the carrier. The feet stay clear of the ball's path, either side of it.
    const r = m.ribbon, nV3 = V(g.printNormal), w = V(g.strikeDown);
    const forkZ = g.printPoint[2] + nV3.z * (r.standoff ?? 0.0009) + w.z * (r.vibrator?.restDrop ?? 0.0165);
    const postZ = forkZ + r.guidePostRadius + 0.0005 + (r.guidePostForward ?? 0);
    const topY = ctr.y + Math.sin(beta + sT / rp) * rp, footY = ctr.y + Math.sin(beta + sB / rp) * rp - 0.0115;
    const posts = merged([-1, 1].map((sg) => new THREE.CylinderGeometry(r.guidePostRadius, r.guidePostRadius, topY - footY, 16).translate(sg * r.guidePostX, (topY + footY) / 2, postZ)));
    this.addMesh(posts, e.chrome, carrier);
    const feet = merged([-1, 1].flatMap((sg) => [box(0.0118, 0.0105, 0.0065, sg * 0.0236, footY + 0.00525, postZ + 0.0002)]));
    this.addMesh(feet, e.black, carrier);
  }

  // ---------- correction tape: white supply roll left of the ball, orange take-up right, the tape across in front of the platen ----------
  buildCorrectionTape(carrier) {
    const { g, emats: e } = this;
    const C = g.element.correction;
    if (!C) return;                                     // the definition has not landed yet
    const tapeWhite = new THREE.MeshStandardMaterial({ color: 0xd9d4c2, roughness: 0.78 });
    const orange = new THREE.MeshPhysicalMaterial({ color: 0xee5a14, roughness: 0.42, clearcoat: 0.3, clearcoatRoughness: 0.4 });
    const lean = 0.42;
    const roll = (spec, take) => {
      const grp = new THREE.Group(); grp.position.set(spec.x, spec.y, spec.z); grp.rotation.x = lean; carrier.add(grp);
      const spin = new THREE.Group(); grp.add(spin);
      const h = C.tapeWidth;
      const rOut = take ? 0.0105 : spec.radiusFull;
      this.addMesh(new THREE.CylinderGeometry(rOut, rOut, h, 40), tapeWhite, spin);
      if (take) {
        // Take-up: an orange housing with a raised tab, its tape mostly covered.
        this.addMesh(merged([lathe([[0, h / 2 + 0.0002], [0.0108, h / 2 + 0.0002], [0.0112, h / 2 + 0.0012], [0.0106, h / 2 + 0.0020], [0, h / 2 + 0.0020]], 40), box(0.0044, 0.0026, 0.0150, 0, h / 2 + 0.0030, -0.0010)]), orange, spin);
        this.addMesh(lathe([[0, -h / 2 - 0.0002], [0.0104, -h / 2 - 0.0002], [0.0104, -h / 2 - 0.0012], [0, -h / 2 - 0.0012]], 32), orange, grp);
      } else {
        // Supply: a white roll with an orange flange and a black domed centre.
        this.addMesh(lathe([[0, h / 2 + 0.0001], [0.0078, h / 2 + 0.0001], [0.0084, h / 2 + 0.0008], [0.0076, h / 2 + 0.0012], [0, h / 2 + 0.0012]], 40), orange, spin);
        this.addMesh(lathe([[0, h / 2 + 0.0012], [0.0052, h / 2 + 0.0012], [0.0050, h / 2 + 0.0030], [0.0030, h / 2 + 0.0058], [0.0014, h / 2 + 0.0070], [0, h / 2 + 0.0072]], 40), e.black, spin);
      }
      this.info(grp.children.at(-1).isMesh ? grp.children.at(-1) : spin.children[0], take ? 'Correction tape take-up' : 'Correction tape');
      return spin;
    };
    this.tapeSupply = roll(C.supply, false);
    this.tapeTakeup = roll(C.takeup, true);
    // The span: a ribbon of white between small fork guides, lifted to the print point by correctionLift.
    const nSeg = 14;
    const pos = new Float32Array((nSeg + 1) * 2 * 3), nor = new Float32Array((nSeg + 1) * 2 * 3), idx = [];
    for (let i = 0; i < nSeg; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(idx);
    const span = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xcfcab8, roughness: 0.7, side: THREE.DoubleSide }));
    span.name = 'correction_tape'; span.castShadow = true; span.receiveShadow = true; span.frustumCulled = false;
    carrier.add(span); this.tapeSpan = span;
    const guideX = 0.0345;
    const guide = new THREE.MeshStandardMaterial({ color: 0xd9d2bb, roughness: 0.55 });
    this.tapeGuides = this.addMesh(merged([-1, 1].map((sg) => box(0.0030, C.tapeWidth + 0.0022, 0.0028, sg * guideX, 0, 0))), guide, carrier);
    this.tapeGuideX = guideX;
    this.updateCorrection(0, 0);
  }

  /** Lays the tape's span for a lift of 0..1 (rest below the print line, 1 at the print point) and turns the rolls by metres fed. */
  updateCorrection(lift, fed) {
    const C = this.g.element.correction;
    if (!C || !this.tapeSpan) return;
    const P = V(this.g.printPoint), n = V(this.g.printNormal), w = V(this.g.strikeDown);
    const centre = P.clone().addScaledVector(n, C.standoff).addScaledVector(w, C.restDrop - C.lift * lift);
    const up = w.clone().negate();
    const gx = this.tapeGuideX;
    this.tapeGuides.position.copy(centre).setX(0);
    // Anchor points on each roll's near side, leaving toward the guides.
    const a = new THREE.Vector3(C.supply.x + C.supply.radiusFull * 0.7, C.supply.y, C.supply.z + C.supply.radiusFull * 0.55);
    const b = new THREE.Vector3(C.takeup.x - 0.0074, C.takeup.y, C.takeup.z + 0.0078);
    const G0 = centre.clone().setX(-gx), G1 = centre.clone().setX(gx);
    const pts = [];
    const lerp = (A, B, t) => A.clone().lerp(B, t);
    for (let i = 0; i <= 4; i++) pts.push({ p: lerp(a, G0, i / 4), blend: i / 4 });
    for (let i = 1; i <= 5; i++) pts.push({ p: lerp(G0, G1, i / 5), blend: 1 });
    for (let i = 1; i <= 5; i++) pts.push({ p: lerp(G1, b, i / 5), blend: 1 - i / 5 });
    const hw = C.tapeWidth / 2;
    const pa = this.tapeSpan.geometry.getAttribute('position'), na = this.tapeSpan.geometry.getAttribute('normal');
    const vy = new THREE.Vector3(0, 1, 0);
    pts.forEach(({ p, blend }, i) => {
      const u = vy.clone().lerp(up, blend).normalize().multiplyScalar(hw);
      pa.setXYZ(i * 2, p.x - u.x, p.y - u.y, p.z - u.z); pa.setXYZ(i * 2 + 1, p.x + u.x, p.y + u.y, p.z + u.z);
      na.setXYZ(i * 2, n.x, n.y, n.z); na.setXYZ(i * 2 + 1, n.x, n.y, n.z);
    });
    pa.needsUpdate = true; na.needsUpdate = true;
    this.tapeSupply.rotation.y = fed / C.supply.radiusFull;
    this.tapeTakeup.rotation.y = -fed / 0.0105;
  }

  // ---------- corner paddle levers in the rear cover's wings ----------
  buildCornerLevers() {
    const { emats: e } = this;
    this.paddles = [];
    // Pressed sheet steel, chromed: a short stem and a small flat paddle head.
    const blade = merged([
      box(0.0042, 0.0130, 0.0012, 0, 0.0065, 0),
      new THREE.CylinderGeometry(0.0021, 0.0021, 0.0012, 20).rotateX(Math.PI / 2).translate(0, 0.0130, 0),
      box(0.0034, 0.0030, 0.0024, 0, 0.0002, 0),
    ]);
    const heel = box(0.0054, 0.0028, 0.0094, 0, -0.0010, 0);
    keycaps.paddles.forEach((p, i) => {
      for (const sign of [-1, 1]) {
        const g2 = new THREE.Group(); g2.position.set(sign * p.x, p.y + 0.0005, p.z);
        this.root.add(g2);
        const m1 = this.addMesh(blade.clone(), e.chrome, g2);
        this.addMesh(heel.clone(), e.chrome, g2);
        const kind = sign > 0 && i === 0 ? 'paperRelease' : null;
        const pr = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.03, 0.012).translate(0, 0.009, 0), new THREE.MeshBasicMaterial({ visible: false }));
        g2.add(pr);
        if (kind) this.pickables.push({ object: pr, part: () => ({ kind, visual: () => m1 }) });
        else this.info(pr, sign > 0 ? `Paper bail lever` : `Line-space and impression lever`);
        this.paddles.push({ group: g2, sign, kind, rest: g2.quaternion.clone() });
      }
    });
  }

  // ---------- the cord, drops out of the rear ----------
  buildCord() {
    const { emats: e } = this;
    const pts = [[0, 0.0235, -0.2385], [0, 0.021, -0.2470], [0.003, 0.012, -0.265], [0.01, 0.004, -0.30], [0.05, 0.0035, -0.38], [0.075, 0.0035, -0.47], [0.04, 0.0035, -0.56]].map((p) => new THREE.Vector3(...p));
    const curve = new THREE.CatmullRomCurve3(pts);
    const geo = new THREE.TubeGeometry(curve, 100, 0.0031, 10, false);
    this.cord = this.addMesh(geo, new THREE.MeshPhysicalMaterial({ color: 0x24261f, roughness: 0.62 }), this.root, 'power_cord');
  }

  // ---------- highlight ----------
  makeHighlight() {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.mats.highlight);
    mesh.frustumCulled = false; mesh.renderOrder = 9; mesh.visible = false; mesh.matrixAutoUpdate = false;
    this.root.add(mesh);
    return { mesh, part: null, visual: null };
  }

  setHighlight(part) {
    const h = this.highlight;
    if (part === h.part) return;
    h.part = part; h.visual = part ? part.visual() : null;
    this.refreshHighlight();
  }

  refreshHighlight() {
    const { mesh, visual } = this.highlight;
    if (!visual) { mesh.visible = false; return; }
    const obj = visual.isObject3D ? visual : null;
    const parent = obj ?? visual.parent;
    parent.updateWorldMatrix(true, false);
    const base = obj ? obj.matrixWorld : parent.matrixWorld.clone().multiply(visual.matrix);
    mesh.geometry = (obj ?? visual).geometry;
    mesh.matrix.copy(base); mesh.matrixWorld.copy(base);
    mesh.matrixWorldNeedsUpdate = false;
    mesh.visible = true;
  }

  // ---------- master update ----------
  update(s, L, soft) {
    const { g } = this;
    this.updateKeys(s, L.keyX);
    const psi = s[L.platenPsi];
    this.platen.rotation.x = -psi;
    this.bailGroup.rotation.x = -s[L.bail] * 0.5;
    // Carrier: carriageX positive at the left margin, world x = -carriageX.
    const x = -s[L.carriageX];
    this.carriage.position.x = x;
    this.pointer.position.x = x;
    const E = g.element;
    if (E) {
      const q = (name) => (L[name] !== undefined ? s[L[name]] : 0);
      const tilt = q('tilt'), rotate = q('rotate'), hemi = q('hemisphere');
      // All three are published in radians, seated on multiples of the steps.
      this.tiltRing.rotation.x = TILT_ZERO(this.m) - tilt;
      this.rotateTube.rotation.y = rotate + hemi;
      this.rocker.position.copy(V(E.strikeDir)).multiplyScalar(q('printRocker'));
    }
    const place = (o, v) => { o.position.x = -v; };
    place(this.margins.L, s[L.marginL]); place(this.margins.R, s[L.marginR]);
    const paper = s[L.paperRelease];
    for (const p of this.paddles) if (p.kind === 'paperRelease') { p.group.quaternion.copy(p.rest); p.group.rotateX(paper * 0.7); }
    if (L.correctionLift !== undefined) this.updateCorrection(s[L.correctionLift], s[L.correctionTape]);
    this.updateSpools(soft?.ribbon);
    if (this.highlight.part) this.refreshHighlight();
  }

  updateSpools(ribbon) {
    if (!ribbon) return;
    const read = (sp) => (typeof sp === 'number' ? { angle: sp, radius: undefined } : sp || {});
    const set = (sp, val) => {
      sp.group.rotation.y = val.angle ?? 0;
      if (val.radius) sp.wind.scale.set(Math.min(Math.max(val.radius * 1.8, 0.030), 0.034), 1, Math.min(Math.max(val.radius * 1.8, 0.030), 0.034));
    };
    set(this.spools.L, read(ribbon.spoolL)); set(this.spools.R, read(ribbon.spoolR));
  }
}
