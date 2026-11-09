// A small blind-writer of the 1880s: type bars hang under the platen and strike upward at its
// underside. Not the frontstrike machine re-skinned: the point is that the same MechanicalSim runs it
// by dispatching on action.type and on its own geometry. No renderer support.
import base from './frontstrike1926.js';

const deg = Math.PI / 180;

const keys = {
  ...base.keys,
  rows: [
    { y: 0.11, z: 0.13, x0: -0.09, pitch: 0.0205, keys: ['qQ', 'wW', 'eE', 'rR', 'tT', 'yY', 'uU', 'iI', 'oO', 'pP'] },
    { y: 0.095, z: 0.155, x0: -0.085, pitch: 0.0205, keys: ['aA', 'sS', 'dD', 'fF', 'gG', 'hH', 'jJ', 'kK', 'lL'] },
    { y: 0.08, z: 0.18, x0: -0.075, pitch: 0.0205, keys: ['zZ', 'xX', 'cC', 'vV', 'bB', 'nN', 'mM', '..'] },
  ],
};

export default {
  ...base,
  id: 'upstrike1889',
  name: 'Blind-writer upstrike, c. 1889',
  action: { type: 'typebar-upstrike', shift: 'carriage' },
  platen: { ...base.platen, center: [0, 0.20, -0.04] },
  printPoint: { beta: -90 * deg },                  // bottom of the platen
  typebars: { ...base.typebars, length: 0.1, arcHalfAngle: 145 * deg, restDrop: 66 * deg },
  keys,
  carriage: { ...base.carriage, travel: 0.2, startX: 0.09, marginRightX: 0.09 - 0.17 },
  condition: { seed: 1889, barSkewSigma: 0.6 * deg, barOffsetSigma: 0.00008, leverageSigma: 0.05 },
};

const v = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  norm: (a) => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; },
};

/**
 * Geometry for the upstrike basket. Same structure as deriveGeometry() in geometry.js, so MechanicalSim
 * treats it identically: pivots on a cone below the print point, bars pointing up and in at impact.
 */
export function deriveUpstrikeGeometry(m) {
  const { platen, typebars: tb, keys: kd } = m;
  const n = [0, -1, 0];
  const printPoint = v.add(platen.center, v.mul(n, platen.radius));
  const keysOut = [];
  kd.rows.forEach((row, r) => row.keys.forEach((pair, c) => {
    const chars = [...pair];
    keysOut.push({ id: `k${keysOut.length}`, kind: 'print', row: r, col: c, lower: chars[0], upper: chars[1] ?? chars[0], pos: [row.x0 + c * row.pitch, row.y, row.z], travel: m.linkage.keyTravel, returnForce: kd.returnForce, finger: 1 });
  }));
  const nPrint = keysOut.length;
  for (const k of kd.controls) keysOut.push({ ...k, kind: 'control', returnForce: k.returnForce ?? kd.returnForce });
  const inertia = tb.barMass * tb.length ** 2 / 3 + tb.slugMass * tb.length ** 2;
  const bars = [];
  const coneDown = 52 * deg;                       // bars hang outward and down at strike-pose tilt
  for (let i = 0; i < nPrint; i++) {
    const a = -tb.arcHalfAngle + (2 * tb.arcHalfAngle * i) / Math.max(1, nPrint - 1);
    const out = [Math.sin(a) * Math.cos(coneDown), -Math.sin(coneDown), Math.cos(a) * Math.cos(coneDown)];
    const pivot = v.add(printPoint, v.mul(out, tb.length));
    const strikeDir = v.norm(v.sub(printPoint, pivot));
    // The rotation axis is horizontal, perpendicular to the strike plane; the sign is chosen so that
    // rotating the bar away from the strike pose by theta > 0 lets it fall (down) toward rest.
    let axis = v.norm(v.cross(strikeDir, [0, 1, 0]));
    const thetaTravel = tb.restDrop;
    if (dirAt(strikeDir, axis, thetaTravel)[1] > strikeDir[1]) axis = v.mul(axis, -1);
    keysOut[i].bar = i;
    bars.push({ index: i, slot: i, arcAngle: a, pivot, axis, strikeDir, thetaTravel, inertia, length: tb.length, skew: 0, offsetX: 0, offsetY: 0, leverage: 1, lower: keysOut[i].lower, upper: keysOut[i].upper });
  }
  return { printPoint, printNormal: n, strikeDown: [0, 0, 1], keys: keysOut, bars, nPrint, nKeys: keysOut.length };
}

function dirAt(s, k, a) { // Rodrigues for perpendicular k and s.
  const c = Math.cos(a), sn = Math.sin(a);
  return [s[0] * c + (k[1] * s[2] - k[2] * s[1]) * sn, s[1] * c + (k[2] * s[0] - k[0] * s[2]) * sn, s[2] * c + (k[0] * s[1] - k[1] * s[0]) * sn];
}
