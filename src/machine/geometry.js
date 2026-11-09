// Pure kinematic geometry derived from a machine definition. Shared by sim, soft bodies and renderer.
const v = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  norm: (a) => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; },
};
export { v as vec3 };

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussian(rand) { return Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand()); }

/** Rotate p around unit axis k through the origin (Rodrigues). */
export function rotate(p, k, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return v.add(v.add(v.mul(p, c), v.mul(v.cross(k, p), s)), v.mul(k, v.dot(k, p) * (1 - c)));
}

/**
 * @returns printPoint/printNormal (home carriage, unshifted), keys[] (printing keys then controls),
 * bars[] with pivot, axis, strikeDir and thetaTravel. A bar's direction at angle theta from rest:
 * barDirection(bar, theta). theta = 0 at rest, bar.thetaTravel at nominal impact.
 */
export function deriveGeometry(m) {
  if (m.element) return deriveElementGeometry(m);
  const { platen, typebars: tb, keys: kd, condition: cond } = m;
  const beta = m.printPoint.beta;
  const n = [0, Math.sin(beta), Math.cos(beta)];
  const printPoint = v.add(platen.center, v.mul(n, platen.radius));
  const w = [0, -Math.cos(beta), Math.sin(beta)];  // in the strike plane, pointing down and forward
  const rand = mulberry32(cond.seed);

  const keys = [];
  kd.rows.forEach((row, r) => row.keys.forEach((pair, c) => {
    const chars = [...pair];
    keys.push({
      id: `k${keys.length}`, kind: 'print', row: r, col: c, lower: chars[0], upper: chars[1] ?? chars[0],
      pos: [row.x0 + c * row.pitch, row.y, row.z], travel: m.linkage.keyTravel,
      returnForce: kd.returnForce, finger: fingerFor(r, c, row.keys.length),
    });
  }));
  const nPrint = keys.length;
  for (const k of kd.controls) keys.push({ ...k, kind: 'control', returnForce: k.returnForce ?? kd.returnForce });

  const printing = keys.slice(0, nPrint);
  const order = printing.map((k, i) => i).sort((a, b) => printing[a].pos[0] - printing[b].pos[0] || printing[a].row - printing[b].row);
  const bars = new Array(nPrint);
  const inertia = tb.barMass * tb.length ** 2 / 3 + tb.slugMass * tb.length ** 2;
  order.forEach((keyIndex, slot) => {
    const a = nPrint === 1 ? 0 : -tb.arcHalfAngle + (2 * tb.arcHalfAngle * slot) / (nPrint - 1);
    const pivot = v.add(printPoint, v.mul(v.add(v.mul([1, 0, 0], Math.sin(a)), v.mul(w, Math.cos(a))), tb.length));
    const strikeDir = v.norm(v.sub(printPoint, pivot));
    let axis = v.norm(v.cross(strikeDir, n));
    // Rest elevation: find the rotation that drops the centre bar to restPitch, used for every bar.
    const thetaTravel = Math.PI / 2 + beta - tb.restPitch;
    keys[keyIndex].bar = keyIndex;
    bars[keyIndex] = {
      index: keyIndex, slot, arcAngle: a, pivot, axis, strikeDir, thetaTravel, inertia, length: tb.length,
      skew: gaussian(rand) * cond.barSkewSigma,
      offsetX: gaussian(rand) * cond.barOffsetSigma, offsetY: gaussian(rand) * cond.barOffsetSigma,
      leverage: 1 + gaussian(rand) * cond.leverageSigma,
      lower: printing[keyIndex].lower, upper: printing[keyIndex].upper,
    };
  });
  return { printPoint, printNormal: n, strikeDown: w, keys, bars, nPrint, nKeys: keys.length };
}

/**
 * Single-element machine. Keys are as usual; one "bar" per printing key names which glyphs the ball carries for
 * consumers of bars[]. `element.keys[k]` gives the key's seat on the ball and `element.cells` the inverse.
 * Ball orientation at tilt t, rotate r, hemisphere h: spin about rotateAxis by (r + h*pi), tilt about tiltAxis by t*tiltStep.
 * `center` is the rest ball centre with carriageX = 0; the carrier sits at world x = -carriageX relative to it.
 */
function deriveElementGeometry(m) {
  const { platen, keys: kd, element: E } = m;
  const beta = m.printPoint.beta;
  const n = [0, Math.sin(beta), Math.cos(beta)];
  const printPoint = v.add(platen.center, v.mul(n, platen.radius));
  const w = [0, -Math.cos(beta), Math.sin(beta)];

  const keys = [];
  kd.rows.forEach((row, r) => row.keys.forEach((pair, c) => {
    const chars = [...pair];
    keys.push({
      id: `k${keys.length}`, kind: 'print', row: r, col: c, lower: chars[0], upper: chars[1] ?? chars[0],
      pos: [row.x0 + c * row.pitch, row.y, row.z], travel: m.linkage.keyTravel,
      returnForce: kd.returnForce, finger: fingerFor(r, c, row.keys.length),
    });
  }));
  const nPrint = keys.length;
  for (const k of kd.controls) keys.push({ ...k, kind: 'control', returnForce: k.returnForce ?? kd.returnForce });

  // Seat every printing key on the ball: most frequent character first, onto the cheapest move.
  const nBands = E.ball.bands, nCols = E.ball.columns / 2;
  const seats = [];
  for (let t = 0; t < nBands; t++) for (let r = -Math.floor(nCols / 2); r <= Math.floor(nCols / 2); r++) seats.push({ tilt: t, rotate: r });
  seats.sort((a, b) => (Math.abs(a.rotate) + 1.3 * a.tilt) - (Math.abs(b.rotate) + 1.3 * b.tilt) || b.rotate - a.rotate || a.tilt - b.tilt);
  const rank = (k) => { const i = E.frequency.indexOf(k.lower); return i < 0 ? E.frequency.length + k.row * 16 + k.col : i; };
  const order = keys.slice(0, nPrint).map((k, i) => i).sort((a, b) => rank(keys[a]) - rank(keys[b]) || a - b);
  const seatOf = new Array(nPrint);
  order.forEach((keyIndex, i) => { seatOf[keyIndex] = seats[i]; });
  const cells = new Int32Array(nBands * nCols).fill(-1);     // (tilt * nCols + rotate + 5) -> key
  const table = keys.slice(0, nPrint).map((k, i) => {
    const s = seatOf[i];
    cells[s.tilt * nCols + s.rotate + Math.floor(nCols / 2)] = i;
    return { tilt: s.tilt, rotate: s.rotate, hemisphere: 0, lower: k.lower, upper: k.upper };
  });

  // Rest: low and in front of the print position. strikeDir is the straight-line pop from rest to contact.
  const contact = v.add(printPoint, v.mul(n, E.ball.radius));
  const center = v.add(contact, v.add(v.mul(w, E.rest.drop), v.mul(n, E.rest.standoff)));
  const strikeDir = v.norm(v.sub(contact, center));
  const element = {
    keys: table, cells, nBands, nCols, ballRadius: E.ball.radius, center,
    strikeDir, strikeGap: E.strikeGap, correction: E.correction,
    rotateAxis: [0, 1, 0], tiltAxis: [1, 0, 0],
    rotateStep: E.ball.columnStep, tiltStep: E.ball.bandStep,
  };

  const bars = keys.slice(0, nPrint).map((k, i) => ({
    index: i, slot: i, arcAngle: 0, pivot: center,
    axis: [1, 0, 0], strikeDir, thetaTravel: 1, inertia: E.rocker.mass * 1e-4, length: 0.01,
    skew: 0, offsetX: 0, offsetY: 0, leverage: 1, lower: k.lower, upper: k.upper,
  }));
  keys.forEach((k, i) => { if (i < nPrint) k.bar = i; });
  return { printPoint, printNormal: n, strikeDown: w, keys, bars, nPrint, nKeys: keys.length, element };
}

/** Unit vector from a bar's pivot toward its slug at angle theta from rest. */
export function barDirection(bar, theta) { return rotate(bar.strikeDir, bar.axis, bar.thetaTravel - theta); }

function fingerFor(row, col, n) {
  const c = Math.min(col, 9);
  return [0.88, 0.93, 1, 1.04, 1.04, 1.04, 1.04, 1, 0.93, 0.88][c];
}
