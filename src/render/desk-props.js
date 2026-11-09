// Things left on the desk beside the machine: an enamelled ashtray, a lit cigarette resting in it, and a closed lighter.
// Built from code at startup. Geometry is authored in millimetres (the sizes one would measure) and scaled to metres.
// The smoke is a static strip mesh animated entirely in its vertex shader; at rest update() only writes two numbers.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SheetBurn } from '../pages/burn.js';

const AT = { x: 0.29, z: 0.122 };            // m, desk coordinates of the ashtray's centre; the desk top is y = 0
const LIGHTER_AT = { x: -0.01, z: 0.088, yaw: 0.5 };    // m and rad, relative to the ashtray; lying on its broad side, seam and hinge showing
const MM = 1e-3;

// Ashtray, mm. The rim carries three cigarette rests, a channel cut along the line of a cigarette lying in it.
const RIM_TOP = 27.3;
const REST = { r: 49.5, axisY: 25, radius: 4.4, tilt: 0.115, first: -0.85 };   // first: rad from +x toward +z, so the cigarette's far end stays in the default view
const FLOOR_Y = 6.3;

// Cigarette, mm from the mouth end toward the lit end.
const CIG = { radius: 4, tip: 25, burn: 74, ash: 76, length: 84, atRest: 42 };
const EMBER_LINEAR = [1.05, 0.25, 0.028];

// Smoke life, shared with the shader. Temporal frequencies there are multiples of 0.01 rad/s, so wrapping time at 200 pi is seamless.
const SMOKE_PERIOD = 200 * Math.PI;

const rngFrom = (seed) => { let x = seed >>> 0; return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; }; };
const fract = (v) => v - Math.floor(v);
const hash2 = (x, y) => fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453);
function noise2(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

const _c = new THREE.Color();

/** Writes a vertex-colour attribute; fn(x, y, z, i, out) sets the linear colour. */
function paint(geo, fn) {
  const p = geo.attributes.position, col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    fn(p.getX(i), p.getY(i), p.getZ(i), i, _c);
    col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

/** A lathe's normals after its vertices moved: recomputed, with the seam welded and the two poles set. */
function fixLatheNormals(geo, rows, segments) {
  geo.computeVertexNormals();
  const n = geo.attributes.normal, last = segments * rows;
  for (let j = 0; j < rows; j++) {
    const x = n.getX(j) + n.getX(last + j), y = n.getY(j) + n.getY(last + j), z = n.getZ(j) + n.getZ(last + j);
    const l = Math.hypot(x, y, z) || 1;
    n.setXYZ(j, x / l, y / l, z / l); n.setXYZ(last + j, x / l, y / l, z / l);
  }
  return geo;
}

function setPole(geo, rows, segments, j, y) {
  const n = geo.attributes.normal;
  for (let i = 0; i <= segments; i++) n.setXYZ(i * rows + j, 0, y, 0);
}

/** Maps a Y-axis part (origin at y = 0) so +Y runs along dir from origin. */
function placeAlong(geo, origin, dir) {
  const y = dir.clone().normalize();
  const x = new THREE.Vector3(0.31, 0.17, 0.93).cross(y).normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  return geo.applyMatrix4(new THREE.Matrix4().makeBasis(x, y, z).setPosition(origin));
}

// ---- Ashtray ---------------------------------------------------------------------------------------------------------

function restDirs() {
  return [0, 1, 2].map((i) => { const a = REST.first + i * 2 * Math.PI / 3; return { x: Math.cos(a), z: Math.sin(a) }; });
}

/** Height of the rest's channel at a point, or Infinity away from it: a round bottom that flares into the rim. */
function channelY(lateral, along) {
  const R = REST.radius, s = Math.abs(lateral);
  if (s > R * 1.9) return Infinity;
  const axis = REST.axisY + Math.tan(REST.tilt) * (REST.r - along);
  const lip = R * 0.86;
  if (s <= lip) return axis - Math.sqrt(R * R - s * s);
  const atLip = axis - Math.sqrt(R * R - lip * lip);
  return atLip + (RIM_TOP + 1.2 - atLip) * smooth(lip, R * 1.9, s);
}

function buildAshtray() {
  const outline = [
    [0, 0.9], [18, 0.9], [33, 0.9], [36, 0.15], [41, 0], [44, 0.9],
    [48.5, 9], [52.6, 17.5], [54.6, 23], [55, 25.4], [54.3, 26.7], [52.6, RIM_TOP - 0.05], [48.5, RIM_TOP], [46.4, RIM_TOP - 0.15],
    [44.9, 26.1], [43.6, 23.8], [40.8, 15.8], [37, 9.6], [33, 7.2], [28, FLOOR_Y + 0.1], [14, FLOOR_Y - 0.15], [0, FLOOR_Y - 0.25],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const profile = new THREE.SplineCurve(outline).getPoints(78);
  for (const q of profile) { q.x = Math.max(0, q.x); q.y = Math.max(0, q.y); }
  profile[0].x = 0; profile[profile.length - 1].x = 0;
  const segments = 120, rows = profile.length;
  const geo = new THREE.LatheGeometry(profile, segments);
  const dirs = restDirs();
  const lathePhase = Math.atan2(dirs[0].x, dirs[0].z);   // the lathe's angle of the first rest
  const pos = geo.attributes.position;
  // Packs the columns toward the three rests, where the channel needs them.
  const WARP = 0.72;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r > 1e-6) {
      const phi = Math.atan2(x, z);
      const warped = phi - WARP * Math.sin(3 * (phi - lathePhase)) / 3;
      x = r * Math.sin(warped); z = r * Math.cos(warped);
    }
    for (const d of dirs) {
      const along = x * d.x + z * d.z;
      if (along <= 0) continue;
      y = Math.min(y, channelY(x * -d.z + z * d.x, along));
    }
    pos.setXYZ(i, x, y, z);
  }
  fixLatheNormals(geo, rows, segments);
  setPole(geo, rows, segments, 0, -1); setPole(geo, rows, segments, rows - 1, 1);

  const enamel = new THREE.Color(0x12251f), stained = new THREE.Color(0x201c17), rimWorn = new THREE.Color(0x3a4a42);
  paint(geo, (x, y, z, i, out) => {
    const r = Math.hypot(x, z);
    const inWell = (1 - smooth(34, 43, r)) * (1 - smooth(9, 24, y));
    const mottle = noise2(x * 0.14 + 3, z * 0.14 + 9);
    out.copy(enamel).lerp(stained, clamp01(inWell * (0.45 + 0.5 * mottle)));
    const onRim = smooth(RIM_TOP - 1.6, RIM_TOP - 0.2, y) * smooth(0.56, 0.86, noise2(x * 0.5, z * 0.5));
    out.lerp(rimWorn, onRim * 0.55);
  });
  return geo.scale(MM, MM, MM);
}

// ---- Small things: cigarette, ash, butts ------------------------------------------------------------------------------

const PAPER = new THREE.Color(0xe9e4d8), CORK = new THREE.Color(0xb18a58), CORK_DARK = new THREE.Color(0x876339), GILT = new THREE.Color(0xb8944a),
  SCORCH = new THREE.Color(0x6d4a22), CHAR = new THREE.Color(0x0b0a09), ASH_LIGHT = new THREE.Color(0xb7b3ab), ASH_MID = new THREE.Color(0x6f6c67), ASH_DARK = new THREE.Color(0x2d2b29);

/** Burn colour on a paper tube at distance `d` behind the burn front; `n` jitters the front. */
function burnColor(out, d, n) {
  const front = d - (n - 0.5) * 1.6;
  if (front > 3.2) return;
  out.lerp(SCORCH, smooth(3.2, 1.1, front) * 0.9);
  out.lerp(CHAR, smooth(1.3, 0.1, front));
}

function buildCigaretteBody() {
  const r = CIG.radius, pts = [[0, 0], [r - 0.5, 0], [r - 0.08, 0.15], [r, 0.6]];
  const rows = 120;
  for (let i = 1; i <= rows; i++) pts.push([r, 0.6 + (CIG.burn - 0.6) * i / rows]);
  pts.push([r - 0.25, CIG.burn + 0.35], [r - 1.2, CIG.burn + 0.5], [0, CIG.burn + 0.5]);
  const profile = pts.map(([a, b]) => new THREE.Vector2(a, b));
  const segments = 28;
  const geo = new THREE.LatheGeometry(profile, segments);
  paint(geo, (x, y, z, i, out) => {
    const phi = Math.atan2(x, z);
    if (y < CIG.tip) {
      const n = 0.6 * noise2(phi * 11 + 11, y * 1.7) + 0.4 * noise2(phi * 25 + 2, y * 3.5);
      out.copy(CORK).lerp(CORK_DARK, 0.4 * smooth(0.44, 0.78, n));
      if (y < 0.2) out.copy(CORK_DARK).multiplyScalar(0.55);   // the cut end of the filter
    } else if (y < CIG.tip + 0.9) out.copy(GILT);
    else {
      out.copy(PAPER);
      burnColor(out, CIG.burn - y, noise2(Math.cos(phi) * 1.8 + 5, Math.sin(phi) * 1.8));
    }
  });
  return geo;
}

function buildAsh() {
  const r = CIG.radius, pts = [], rows = 26;
  for (let i = 0; i <= rows; i++) {
    const t = i / rows, a = CIG.ash - 0.4 + t * (CIG.length - CIG.ash + 0.4);
    const taper = (r - 0.2) - 1.55 * t * Math.sqrt(t);
    const round = t > 0.9 ? Math.sqrt(Math.max(0, 1 - ((t - 0.9) / 0.1) ** 2)) : 1;
    const layers = 0.06 * Math.sin(t * 23 + 1.1) * Math.sin(t * 7 + 0.4);
    pts.push([Math.max(0.01, (taper + layers) * round), a]);
  }
  pts[rows][0] = 0;
  const profile = pts.map(([a, b]) => new THREE.Vector2(a, b));
  const segments = 26;
  const geo = new THREE.LatheGeometry(profile, segments);
  const p = geo.attributes.position, rowsN = profile.length;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), y = p.getY(i), phi = Math.atan2(x, z);
    const wobble = 1 + 0.2 * (noise2(Math.cos(phi) * 1.7 + 3, y * 0.55) - 0.5) + 0.12 * (noise2(Math.sin(phi) * 3 + 8, y * 1.6) - 0.5);
    p.setXYZ(i, x * wobble, y, z * wobble);
  }
  fixLatheNormals(geo, rowsN, segments);
  setPole(geo, rowsN, segments, rowsN - 1, 1);
  paint(geo, (x, y, z, i, out) => {
    const n = noise2(x * 0.9 + y * 0.5 + 2, z * 0.9 - y * 0.4) * 0.6 + noise2(x * 2.2 - y, z * 2.2 + y * 1.5) * 0.4;
    out.copy(ASH_MID).lerp(ASH_LIGHT, 0.3 + 0.6 * smooth(0.32, 0.7, n));
    out.lerp(ASH_DARK, smooth(CIG.ash + 1.6, CIG.ash, y) * 0.75);
  });
  return geo;
}

/** A stubbed-out cigarette: short, bent where it was pressed, its burnt end crushed. */
function buildButt(seed, { length, filter, bend }) {
  const r = CIG.radius, rows = 34, segments = 18, pts = [[0, 0], [r - 0.5, 0], [r, 0.5]];
  for (let i = 1; i <= rows; i++) pts.push([r, 0.5 + (length - 0.5) * i / rows]);
  pts.push([0.01, length + 0.6]);
  const profile = pts.map(([a, b]) => new THREE.Vector2(a, b));
  const geo = new THREE.LatheGeometry(profile, segments);
  const p = geo.attributes.position, nRows = profile.length;
  const ph = seed * 1.7;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), z = p.getZ(i); const y = p.getY(i), phi = Math.atan2(x, z);
    const crush = smooth(length * 0.55, length, y);
    const sq = 1 - crush * 0.5 * (0.6 + 0.4 * Math.sin(2 * phi + ph)) - crush * 0.26 * noise2(phi * 2.2 + ph, y * 0.9);
    x *= sq; z *= sq * (1 - crush * 0.34);
    x += bend * ((Math.max(0, y - length * 0.5)) ** 2) / length;
    x += crush * (noise2(ph, y * 0.8) - 0.5) * 0.9;
    p.setXYZ(i, x, y, z);
  }
  fixLatheNormals(geo, nRows, segments);
  paint(geo, (x, y, z, i, out) => {
    const phi = Math.atan2(x, z);
    if (y < filter) out.copy(CORK).lerp(CORK_DARK, 0.4 * smooth(0.42, 0.78, noise2(phi * 11 + ph, y * 1.8)));
    else {
      out.copy(PAPER).multiplyScalar(0.92);
      burnColor(out, length - 1.2 - y, noise2(Math.cos(phi) * 2 + ph, Math.sin(phi) * 2));
    }
  });
  return geo;
}

function buildAshHeap() {
  const pts = [], rows = 34;
  for (let i = 0; i <= rows; i++) {
    const t = i / rows, r = 25 * t;
    const y = (1 - t * t) ** 1.6 * 2.6 - 0.1 * (1 - t) - 0.5 * smooth(0.82, 1, t);
    pts.push(new THREE.Vector2(r, FLOOR_Y + y));
  }
  pts.reverse();   // from rim to centre, facing up
  const segments = 96;
  const geo = new THREE.LatheGeometry(pts, segments);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), r = Math.hypot(x, z);
    const lump = smooth(25, 18, r) * (noise2(x * 0.3 + 4, z * 0.3) * 1.4 + noise2(x * 0.75, z * 0.75 + 3) * 0.4 - 0.85);
    p.setY(i, p.getY(i) + lump);
  }
  fixLatheNormals(geo, rows + 1, segments);
  setPole(geo, rows + 1, segments, rows, 1);
  paint(geo, (x, y, z, i, out) => {
    const n = noise2(x * 0.26 + 2, z * 0.26) * 0.6 + noise2(x * 0.8, z * 0.8 + 7) * 0.4;
    out.copy(ASH_MID).lerp(ASH_DARK, 0.35 * smooth(0.5, 0.25, n)).lerp(ASH_LIGHT, 0.45 * smooth(0.48, 0.75, n));
    out.lerp(ASH_DARK, 0.75 * smooth(19, 25, Math.hypot(x, z)));
  });
  return geo;
}

function buildAshFlakes(n) {
  const rnd = rngFrom(42), parts = [];
  const unit = new THREE.SphereGeometry(1, 6, 4);
  for (let i = 0; i < n; i++) {
    const g = unit.clone(), a = rnd() * 6.283, r = 6 + rnd() * 26;
    const size = 0.4 + rnd() * rnd() * 1.5;
    g.scale(size * (0.7 + rnd() * 0.8), size * (0.25 + rnd() * 0.4), size * (0.7 + rnd() * 0.8));
    g.rotateY(rnd() * 6.283);
    const x = r * Math.cos(a), z = r * Math.sin(a), rise = smooth(30, 38, r) * 3;
    g.translate(x, FLOOR_Y + 0.25 + rise + (r < 25 ? 1.6 * (1 - r / 25) : 0), z);
    const tone = rnd();
    paint(g, (vx, vy, vz, vi, out) => out.copy(ASH_DARK).lerp(ASH_LIGHT, 0.2 + 0.55 * tone * tone));
    parts.push(g);
  }
  return parts;
}

/** Where the rest's cigarette axis is, mm. */
function cigaretteFrame() {
  const d = restDirs()[0], c = Math.cos(REST.tilt), s = Math.sin(REST.tilt);
  const notch = new THREE.Vector3(d.x * REST.r, REST.axisY, d.z * REST.r);
  const axis = new THREE.Vector3(-d.x * c, s, -d.z * c);
  const origin = notch.clone().addScaledVector(axis, -CIG.atRest);
  return { origin, axis, at: (a, target = new THREE.Vector3()) => target.copy(origin).addScaledVector(axis, a) };
}

function buildSmallThings(frame) {
  const parts = [buildCigaretteBody(), buildAsh()].map((g) => placeAlong(g, frame.origin, frame.axis));
  const butts = [
    { seed: 1, length: 29, filter: 23, bend: 0.012, at: [-16, -13], yaw: 2.35, lift: 0.1 },
    { seed: 2, length: 22, filter: 20, bend: -0.02, at: [-5, 20], yaw: -0.5, lift: 0.14 },
  ];
  for (const b of butts) {
    const g = buildButt(b.seed, b);
    const dir = new THREE.Vector3(Math.cos(b.yaw) * Math.cos(b.lift), Math.sin(b.lift), Math.sin(b.yaw) * Math.cos(b.lift));
    const origin = new THREE.Vector3(b.at[0], FLOOR_Y + CIG.radius + 1.0, b.at[1]);
    parts.push(placeAlong(g, origin, dir));
  }
  parts.push(buildAshHeap(), ...buildAshFlakes(38));
  return mergeGeometries(parts.map((g) => { g.deleteAttribute('uv'); return g; })).scale(MM, MM, MM);
}

function buildEmber(frame) {
  const r = CIG.radius, a0 = CIG.burn - 0.3, a1 = CIG.ash + 0.5, rows = 8, pts = [];
  for (let i = 0; i <= rows; i++) pts.push(new THREE.Vector2(r - 0.12 - 0.3 * Math.abs(i / rows - 0.4), a0 + (a1 - a0) * i / rows));
  const segments = 32;
  const geo = new THREE.LatheGeometry(pts, segments);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const phi = Math.atan2(p.getX(i), p.getZ(i)), y = p.getY(i);
    const bump = 1 + 0.06 * (noise2(Math.cos(phi) * 4 + 9, y * 1.7) - 0.5);
    p.setX(i, p.getX(i) * bump); p.setZ(i, p.getZ(i) * bump);
  }
  fixLatheNormals(geo, pts.length, segments);
  const hot = new THREE.Color().setRGB(...EMBER_LINEAR), dull = new THREE.Color().setRGB(0.24, 0.024, 0.006), dead = new THREE.Color().setRGB(0.012, 0.009, 0.008);
  paint(geo, (x, y, z, i, out) => {
    const phi = Math.atan2(x, z);
    const n = noise2(Math.cos(phi) * 4.5 + 1, y * 3.4 + Math.sin(phi) * 4.5) * 0.7 + noise2(x * 2.4, z * 2.4 + y) * 0.3;
    const t = clamp01((y - a0) / (a1 - a0));
    const middle = smooth(0, 0.3, t) * smooth(1, 0.55, t);
    out.copy(dull).lerp(hot, smooth(0.36, 0.68, n) * (0.2 + 0.8 * middle));
    out.lerp(dead, smooth(0.42, 0.18, n) * (1 - middle * 0.6));
  });
  placeAlong(geo, frame.origin, frame.axis);
  return geo.scale(MM, MM, MM);
}

// ---- Lighter ---------------------------------------------------------------------------------------------------------

/**
 * A rounded-rectangular solid between y0 and y1, its edges rounded with radii bevel0 and bevel1, normals analytic.
 * UVs: u around the outline, v up the side, in units of 40 mm, so the brushing runs vertically.
 */
function roundedPrism({ w, d, y0, y1, corner, bevel0, bevel1 }) {
  const ARC = 6, cs = 7;
  const rings = [];
  for (let i = 0; i <= ARC; i++) { const th = -Math.PI / 2 + (i / ARC) * Math.PI / 2; rings.push({ y: y0 + bevel0 * (1 + Math.sin(th)), inset: bevel0 * (1 - Math.cos(th)), th }); }
  for (let i = 0; i <= ARC; i++) { const th = (i / ARC) * Math.PI / 2; rings.push({ y: y1 - bevel1 + bevel1 * Math.sin(th), inset: bevel1 * (1 - Math.cos(th)), th }); }
  const cx = w / 2 - corner, cz = d / 2 - corner;
  const corners = [[cx, cz, 0], [-cx, cz, 1], [-cx, -cz, 2], [cx, -cz, 3]];
  const outline = [];
  for (const [ox, oz, q] of corners) for (let i = 0; i <= cs; i++) { const a = (q + i / cs) * Math.PI / 2; outline.push({ ox, oz, a }); }
  outline.push(outline[0]);
  const count = outline.length;
  const pos = [], nor = [], uv = [], idx = [];
  const perimeter = [0];
  for (let i = 1; i < count; i++) {
    const a = outline[i - 1], b = outline[i];
    const ax = a.ox + corner * Math.cos(a.a), az = a.oz + corner * Math.sin(a.a), bx = b.ox + corner * Math.cos(b.a), bz = b.oz + corner * Math.sin(b.a);
    perimeter.push(perimeter[i - 1] + Math.hypot(bx - ax, bz - az));
  }
  for (const ring of rings) {
    const r = Math.max(0.1, corner - ring.inset), cth = Math.cos(ring.th), sth = Math.sin(ring.th);
    outline.forEach((o, i) => {
      const nx = Math.cos(o.a), nz = Math.sin(o.a);
      pos.push(o.ox + r * nx, ring.y, o.oz + r * nz);
      nor.push(nx * cth, sth, nz * cth);
      uv.push(perimeter[i] / 40, ring.y / 40);
    });
  }
  for (let j = 0; j < rings.length - 1; j++) for (let i = 0; i < count - 1; i++) {
    const a = j * count + i, c = j * count + i + 1, b = a + count, e = c + count;
    idx.push(a, b, c, b, e, c);
  }
  for (const [ring, y, ny] of [[rings[0], y0, -1], [rings[rings.length - 1], y1, 1]]) {
    const r = Math.max(0.1, corner - ring.inset), base = pos.length / 3;
    pos.push(0, y, 0); nor.push(0, ny, 0); uv.push(0, 0);
    outline.forEach((o) => {
      const vx = o.ox + r * Math.cos(o.a), vz = o.oz + r * Math.sin(o.a);
      pos.push(vx, y, vz); nor.push(0, ny, 0); uv.push(vx / 40, vz / 40);
    });
    for (let i = 1; i < count; i++) { if (ny > 0) idx.push(base, base + i + 1, base + i); else idx.push(base, base + i, base + i + 1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function buildLighter() {
  const W = 37, D = 13, H = 56, SEAM = 37.8, GAP = 0.55, CORNER = 3.0;
  const white = (g) => paint(g, (x, y, z, i, out) => out.setRGB(1, 1, 1));
  const body = white(roundedPrism({ w: W, d: D, y0: 0, y1: SEAM - GAP / 2, corner: CORNER, bevel0: 1.3, bevel1: 0.45 }));
  const lid = white(roundedPrism({ w: W, d: D, y0: SEAM + GAP / 2, y1: H, corner: CORNER, bevel0: 0.45, bevel1: 1.7 }));
  // The inner case, seen only in the seam.
  const core = paint(roundedPrism({ w: W - 1.3, d: D - 1.3, y0: SEAM - 2.5, y1: SEAM + 2.5, corner: CORNER - 0.6, bevel0: 0.1, bevel1: 0.1 }), (x, y, z, i, out) => out.setRGB(0.09, 0.09, 0.1));
  const parts = [body, lid, core];
  // The hinge barrel, across the case's thickness: alternating knuckles on a pin, half sunk in the narrow end.
  const hingeX = W / 2 - 0.15, knuckles = 5, gap = 0.28, each = (D - 2.2 - gap * (knuckles - 1)) / knuckles;
  for (let i = 0; i < knuckles; i++) {
    const g = white(new THREE.CylinderGeometry(1.75, 1.75, each, 18, 1));
    g.rotateX(Math.PI / 2);
    g.translate(hingeX, SEAM, -(D - 2.2) / 2 + each / 2 + i * (each + gap));
    parts.push(g);
  }
  const pin = paint(new THREE.CylinderGeometry(0.75, 0.75, D - 2.4, 12, 1), (x, y, z, i, out) => out.setRGB(0.32, 0.32, 0.34));
  pin.rotateX(Math.PI / 2); pin.translate(hingeX, SEAM, 0);
  parts.push(pin);
  // Centred, for lying down on its broad side.
  return { geometry: mergeGeometries(parts).translate(0, -H / 2, 0).scale(MM, MM, MM), size: [W * MM, H * MM, D * MM] };
}

/** Fine vertical brushing: streak height as roughness and as a normal map. */
function makeBrushMaps(maxAniso) {
  const W = 512, H = 24, rnd = rngFrom(19);
  const column = new Float32Array(W);
  for (let i = 0; i < W; i++) column[i] = rnd() * rnd();
  const height = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) height[x + y * W] = column[x] + 0.35 * noise2(x * 0.7, y * 0.25) * rnd();
  }
  const rough = new Uint8Array(W * H * 4), normal = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (x + y * W) * 4, v = height[x + y * W];
    const dx = (height[((x + 1) % W) + y * W] - height[((x + W - 1) % W) + y * W]) * 1.1;
    const l = Math.hypot(dx, 1);
    normal[i] = 127.5 * (1 - dx / l); normal[i + 1] = 127.5; normal[i + 2] = 127.5 * (1 + 1 / l); normal[i + 3] = 255;
    const r = 192 + 58 * (v - 0.4);
    rough[i] = rough[i + 1] = rough[i + 2] = r; rough[i + 3] = 255;
  }
  const tex = (data) => {
    const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true; t.anisotropy = maxAniso; t.needsUpdate = true;
    return t;
  };
  return { roughnessMap: tex(rough), normalMap: tex(normal) };
}

// ---- Smoke -----------------------------------------------------------------------------------------------------------

const SMOKE_VERT = /* glsl */`
uniform float uT;
varying vec3 vQ;     // x: across the strip (-1..1), y: along it (0..1), z: strand (-1..1)
varying float vA;

const float LIFE = 6.2;      // seconds an element of smoke takes to climb the strip
const float RISE = 0.5;      // metres at the end of its life

float ss(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0., 1.); return t * t * (3. - 2. * t); }

// An element born at time b, in a room air current u(t) = a cos(w t + p): integrated from birth, so it is zero at the ember and the column sways as a whole.
float draught(float t, float b, float a, float w, float p) { return a / w * (sin(w * t + p) - sin(w * b + p)); }

vec3 smokeAt(float s, float k) {
  float age = s * LIFE, b = uT - age;
  float y = RISE * (1. - exp(-2.6 * s)) / (1. - exp(-2.6));
  vec3 c = vec3(0., y, 0.);

  // Slow drift of the room's air, carrying the whole column, with a faint set toward the machine.
  c.x -= 0.06 * s * s;
  c.x += draught(uT, b, 0.018, 0.37, 0.6) + draught(uT, b, 0.012, 0.91, 2.2) + draught(uT, b, 0.008, 1.63, 4.1);
  c.z += draught(uT, b, 0.015, 0.53, 1.4) + draught(uT, b, 0.009, 1.21, 0.2);

  // The stream is smooth near the ember, then its instability grows: waves born at the ember, amplified as they climb.
  float g = ss(0.05, 0.42, s), g2 = ss(0.16, 0.62, s);
  float spread = ss(0.1, 0.85, s);
  float kPhase = k * (1.1 + 2.6 * g2);
  c.x += 0.0058 * g * sin(9.47 * b + 10. * s + 0.7) + 0.0062 * g2 * sin(16.3 * b - 14. * s + 1.9 + kPhase) + 0.0026 * g2 * g2 * sin(31.7 * b + 22. * s + kPhase * 1.7);
  c.z += 0.0052 * g * sin(7.93 * b + 12. * s + 3.1) + 0.0056 * g2 * sin(13.7 * b + 9. * s + kPhase * 0.7) + 0.0024 * g2 * g2 * sin(27.1 * b - 18. * s + kPhase * 1.3);

  // Rolling up: an element's path turns on itself where a slowly varying envelope lets the rotation outrun the climb, making the curls.
  float env = 0.5 + 0.5 * sin(0.83 * b + 1.5 + k * 1.3 + 3. * s);
  env *= 0.45 + 0.55 * sin(0.31 * b + k + 0.8);
  env = max(env, 0.) ;
  float roll = g2 * ss(0.2, 0.68, s) * (0.008 + 0.04 * env) * (1. + 0.4 * sin(k * 7.3));
  float th = 18. * s * s * (5.2 + 0.9 * k) + 4.13 * b + k * 2.2;
  c.x += roll * cos(th);
  c.y += roll * sin(th) * 0.9;
  c.z += roll * sin(th + 1.1) * 0.7;

  // Strands that began as one thread part as they climb.
  c.x += k * spread * (0.016 + 0.007 * sin(2.33 * b + k * 5.));
  c.z += sin(k * 11.7) * spread * 0.017;
  return c;
}

void main() {
  float s = position.x, side = position.y, k = position.z;
  float ds = 0.006;
  vec3 c = smokeAt(s, k);
  vec3 t = smokeAt(min(s + ds, 1.), k) - smokeAt(max(s - ds, 0.), k);
  vec4 w = modelMatrix * vec4(c, 1.);
  vec3 toCam = normalize(cameraPosition - w.xyz);
  vec3 across = cross(normalize(t + vec3(1e-5, 1e-5, 0.)), toCam);
  float l = length(across);
  across = l > 1e-4 ? across / l : vec3(1., 0., 0.);
  float width = mix(0.00072, 0.0092, pow(ss(0.04, 1., s), 1.45));
  vec3 p = w.xyz + across * side * width;
  float mass = pow(0.00072 / width, 0.58);
  float strand = 0.6 + 0.4 * sin(k * 19.1 + 0.5);
  vA = strand * mass * pow(1. - s, 1.2) * ss(0., 0.012, s) * mix(0.7, 1., ss(0.04, 0.22, s));
  vQ = vec3(side, s, k);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.);
}`;

const SMOKE_FRAG = /* glsl */`
precision highp float;
varying vec3 vQ;
varying float vA;
uniform float uDensity;
void main() {
  float v = vQ.x, s = vQ.y;
  float profile = exp(-3.2 * v * v) * (1. - v * v);
  // Where a sheet folds it is seen edge on and reads denser: thin bright lines along the strip, stronger as it climbs.
  float folds = 0.72 + 0.28 * sin(s * 310. + vQ.z * 37. + v * 4.) * sin(s * 73. - vQ.z * 13.);
  float alpha = uDensity * vA * profile * mix(1., folds, smoothstep(0.1, 0.55, s));
  // Blue-white side-stream smoke at the source, greyer where it has thinned and mixed.
  vec3 col = mix(vec3(0.70, 0.78, 0.92), vec3(0.60, 0.62, 0.65), smoothstep(0.15, 0.8, s));
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}`;

function buildSmoke() {
  const STRANDS = 7, SEGMENTS = 150;
  const positions = new Float32Array(STRANDS * (SEGMENTS + 1) * 2 * 3);
  const index = [];
  let n = 0, base = 0;
  for (let j = 0; j < STRANDS; j++) {
    const k = STRANDS > 1 ? -1 + 2 * j / (STRANDS - 1) : 0;
    for (let i = 0; i <= SEGMENTS; i++) {
      const s = i / SEGMENTS;
      positions[n++] = s; positions[n++] = -1; positions[n++] = k;
      positions[n++] = s; positions[n++] = 1; positions[n++] = k;
      if (i < SEGMENTS) { const a = base + i * 2; index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    base += (SEGMENTS + 1) * 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(index);
  // The shader decides where the vertices go; culling needs a sphere that holds the whole plume and its sway.
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.25, 0), 0.34);
  const material = new THREE.ShaderMaterial({
    vertexShader: SMOKE_VERT, fragmentShader: SMOKE_FRAG,
    uniforms: { uT: { value: 0 }, uDensity: { value: 0.3 } },
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.renderOrder = 8;
  mesh.castShadow = mesh.receiveShadow = false;
  return mesh;
}

// ---- Sparks from a burning sheet ---------------------------------------------------------------------------------------

/** A small fixed pool of points that rise off the burn front. Only does any work while something is burning or still glowing. */
function buildSparks(canvas) {
  const N = 72, LIFE_S = 1.1, TRIES = 14;
  const positions = new Float32Array(N * 3), velocity = new Float32Array(N * 3), life = new Float32Array(N);
  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
  const lifeAttr = new THREE.BufferAttribute(life, 1).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('aLife', lifeAttr);
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uScale: { value: 1000 } },
    vertexShader: /* glsl */`
      attribute float aLife; uniform float uScale; varying float vL;
      void main() { vL = aLife; vec4 mv = modelViewMatrix * vec4(position, 1.); gl_Position = projectionMatrix * mv;
        gl_PointSize = aLife > 0. ? max(1.5, uScale * 0.0026 * (0.5 + 0.5 * aLife) / -mv.z) : 0.; }`,
    fragmentShader: /* glsl */`
      varying float vL;
      void main() { if (vL <= 0.) discard; float a = smoothstep(0.5, 0.1, length(gl_PointCoord - 0.5));
        gl_FragColor = vec4(vec3(2.0, 0.5, 0.06) * vL * a, a); }`,
  });
  const points = new THREE.Points(geo, material);
  points.frustumCulled = false; points.visible = false; points.renderOrder = 9;
  let alive = 0, cursor = 0;
  const clear = () => { life.fill(0); alive = 0; points.visible = false; lifeAttr.needsUpdate = true; };
  return {
    points, clear,
    step(dt, sim, burn) {
      if (!burn.active && alive === 0) return;
      if (burn.active && sim) {
        // A few random particles a frame; any that happens to lie on the front throws a spark.
        for (let tries = 0; tries < TRIES; tries++) {
          const i = Math.floor(Math.random() * sim.n);
          const dist = Math.hypot((sim.uvs[i * 2] - burn.u) * burn.width, (sim.uvs[i * 2 + 1] - burn.v) * burn.height);
          if (dist < burn.radius - 0.022 || dist > burn.radius + 0.002 || life[cursor] > 0.25) continue;
          positions[cursor * 3] = sim.x[i]; positions[cursor * 3 + 1] = sim.y[i]; positions[cursor * 3 + 2] = sim.z[i];
          velocity[cursor * 3] = (Math.random() - 0.5) * 0.05;
          velocity[cursor * 3 + 1] = 0.05 + Math.random() * 0.1;
          velocity[cursor * 3 + 2] = (Math.random() - 0.5) * 0.05;
          life[cursor] = 0.7 + 0.3 * Math.random();
          cursor = (cursor + 1) % N;
        }
      }
      alive = 0;
      for (let i = 0; i < N; i++) {
        if (life[i] <= 0) continue;
        life[i] -= dt / LIFE_S;
        positions[i * 3] += velocity[i * 3] * dt; positions[i * 3 + 1] += velocity[i * 3 + 1] * dt; positions[i * 3 + 2] += velocity[i * 3 + 2] * dt;
        velocity[i * 3 + 1] += 0.5 * dt;
        if (life[i] > 0) alive++; else life[i] = 0;
      }
      material.uniforms.uScale.value = canvas.height / 0.517;   // pixels per unit of size at the default field of view
      points.visible = alive > 0;
      posAttr.needsUpdate = true; lifeAttr.needsUpdate = true;
    },
  };
}

// ---- The group --------------------------------------------------------------------------------------------------------

/** Adds the props to the scene and their hover labels to the picker. Call update(dt) each frame. */
export function installDeskProps({ stage, interaction, soft, paper, hands, machine }) {
  const group = new THREE.Group();
  group.name = 'desk-props';
  group.position.set(AT.x, 0, AT.z);
  stage.scene.add(group);

  const solid = (geometry, material) => {
    const m = new THREE.Mesh(geometry, material);
    m.castShadow = m.receiveShadow = true;
    return m;
  };

  const ashtray = solid(buildAshtray(), new THREE.MeshPhysicalMaterial({
    vertexColors: true, roughness: 0.42, metalness: 0, clearcoat: 0.9, clearcoatRoughness: 0.22, envMapIntensity: 0.85,
  }));
  group.add(ashtray);

  const frame = cigaretteFrame();
  const small = solid(buildSmallThings(frame), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 }));
  group.add(small);

  const emberMaterial = new THREE.MeshBasicMaterial({ vertexColors: true });
  const ember = new THREE.Mesh(buildEmber(frame), emberMaterial);
  group.add(ember);

  const { geometry: lighterGeometry, size: lighterSize } = buildLighter();
  const brush = makeBrushMaps(stage.renderer.capabilities.getMaxAnisotropy());
  const lighter = solid(lighterGeometry, new THREE.MeshPhysicalMaterial({
    vertexColors: true, color: 0xcdd1d9, metalness: 1, roughness: 0.46, ...brush, normalScale: new THREE.Vector2(0.22, 0.22),
    anisotropy: 0.55, envMapIntensity: 0.95,
  }));
  // On its side, flat on the desk: one broad face down.
  lighter.position.set(LIGHTER_AT.x, lighterSize[2] / 2, LIGHTER_AT.z);
  lighter.rotation.set(-Math.PI / 2, LIGHTER_AT.yaw, 0, 'YXZ');
  group.add(lighter);

  const smoke = buildSmoke();
  // Rises from the upper side of the burning band.
  const smokeOrigin = frame.at(CIG.burn + 1.6).multiplyScalar(MM);
  smoke.position.set(smokeOrigin.x, smokeOrigin.y + (CIG.radius + 0.35) * MM, smokeOrigin.z);
  group.add(smoke);

  // Hover targets: simple shapes rather than the full meshes.
  const hit = new THREE.MeshBasicMaterial({ visible: false });
  const proxy = (geometry) => { const m = new THREE.Mesh(geometry, hit); group.add(m); return m; };
  const ashtrayProxy = proxy(new THREE.CylinderGeometry(0.056, 0.052, 0.0285, 24));
  ashtrayProxy.position.y = 0.0142;
  const cigaretteProxy = proxy(new THREE.BoxGeometry(0.014, 0.014, CIG.length * MM));
  cigaretteProxy.position.copy(frame.at(CIG.length / 2)).multiplyScalar(MM);
  cigaretteProxy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), frame.axis);
  const lighterProxy = proxy(new THREE.BoxGeometry(lighterSize[0] + 0.004, lighterSize[1] + 0.002, lighterSize[2] + 0.004));
  lighterProxy.position.set(LIGHTER_AT.x, lighterSize[2] / 2 + 0.001, LIGHTER_AT.z);
  lighterProxy.rotation.copy(lighter.rotation);
  // Raycasting ignores .visible, so hiding the group alone would leave invisible hover targets.
  let visible = true;
  const info = (object, label) => interaction.picker.add({ object, enabled: () => visible, part: () => ({ kind: 'info', label, visual: () => null }) });
  info(ashtrayProxy, 'Ashtray');
  info(cigaretteProxy, 'Cigarette');
  info(lighterProxy, 'Lighter');

  // The easter egg: hold the sheet to the ember.
  const emberAt = frame.at(CIG.burn + 1).multiplyScalar(MM).add(group.position);
  const burn = soft?.paperSim ? new SheetBurn({
    soft, view: paper, ember: emberAt.toArray(), width: machine.paper.width, height: machine.paper.height,
    onDone: () => { hands.cancelLoad?.(); interaction.cancelPaperDrag(); soft.destroySheet(); },
  }) : null;
  const sparks = burn ? buildSparks(stage.renderer.domElement) : null;
  if (sparks) stage.scene.add(sparks.points);

  const smokeTime = smoke.material.uniforms.uT;
  let t = 0;
  return {
    group,
    burn,
    /** Hidden means gone: no drawing, no hover targets, no per-frame work, and nothing can catch. */
    setVisible(on) {
      visible = on;
      group.visible = on;
      if (!on) { burn?.cancel(); sparks?.clear(); }
    },
    update(dt) {
      if (!visible) return;
      if (burn) { burn.update(dt); sparks.step(dt, soft.paperSim, burn); }
      t += dt;
      smokeTime.value = (smokeTime.value + dt) % SMOKE_PERIOD;
      // A resting cigarette smoulders: a slow breath with a little flutter, never a flare.
      const pulse = 0.86 + 0.13 * Math.sin(t * 1.15) * Math.sin(t * 0.41 + 0.9) + 0.035 * Math.sin(t * 7.3 + 1.2 * Math.sin(t * 2.1));
      emberMaterial.color.setScalar(pulse);
    },
  };
}
