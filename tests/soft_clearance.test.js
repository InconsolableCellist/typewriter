// Clearance of the ribbon against the carriage's real parts, from the positions the renderer draws them at.
import test from 'node:test';
import assert from 'node:assert/strict';
import machine from '../src/machine/frontstrike1926.js';
import { deriveGeometry } from '../src/machine/geometry.js';
import { deriveRig } from '../src/render/rig.js';
import { makeLayout } from '../src/sim/layout.js';
import { loadGlyphs } from '../src/machine/glyphs.js';
import { SoftWorld } from '../src/soft/index.js';

const geometry = deriveGeometry(machine);
const rig = deriveRig(machine, geometry);
const glyphs = await loadGlyphs();

/** Metres of air between a ribbon edge point and a cylinder along x, in the y-z plane; ignored if x is off the part. */
function gap(px, py, pz, part, carX, shift) {
  if (px < carX + part.x0 || px > carX + part.x1) return Infinity;
  if (part.box) {
    const dy = Math.max(part.y0 + shift - py, py - part.y1 - shift, 0), dz = Math.max(part.z0 - pz, pz - part.z1, 0);
    return dy === 0 && dz === 0 ? -Math.min(py - part.y0 - shift, part.y1 + shift - py, pz - part.z0, part.z1 - pz) : Math.hypot(dy, dz);
  }
  return Math.hypot(py - (part.y + shift), pz - part.z) - part.r;
}

function parts() {
  const out = [];
  const w = machine.paper.feedRollWidth / 2;
  for (const r of rig.feedRolls) for (const fx of machine.paper.feedRollX) out.push({ name: 'feed roll', x0: fx - w, x1: fx + w, y: r.center[1], z: r.center[2], r: r.radius });
  out.push({ name: 'bail bar', x0: -rig.halfL, x1: rig.halfL, y: rig.bail.bar[1], z: rig.bail.bar[2], r: rig.bail.radius });
  out.push({ name: 'platen', x0: -rig.halfL, x1: rig.halfL, y: rig.c[1], z: rig.c[2], r: rig.R });
  for (const s of [-1, 1]) {
    const a = s * machine.platen.length / 2 + s * machine.platen.knobOffset;
    out.push({ name: 'knob', x0: Math.min(a, a + s * 0.0165), x1: Math.max(a, a + s * 0.0165), y: rig.c[1], z: rig.c[2], r: machine.platen.knobRadius });
    out.push({ name: 'end plate', box: true, x0: s * rig.endPlateX - 0.0035, x1: s * rig.endPlateX + 0.0035, y0: 0.15, y1: 0.2046, z0: -0.069, z1: -0.038 });
  }
  for (const fx of machine.paper.feedRollX) {
    out.push({ name: 'bail roller', x0: fx - machine.paper.bailRollerWidth / 2, x1: fx + machine.paper.bailRollerWidth / 2, y: rig.bail.bar[1], z: rig.bail.bar[2], r: machine.paper.bailRollerRadius });
  }
  return out;
}

for (const shift of [0, machine.carriage.shiftTravel]) for (const lift of [0, 0.72 * machine.ribbon.vibrator.fullLift, machine.ribbon.vibrator.fullLift]) {
  test(`ribbon clears the carriage parts over the margins at shift ${shift}, lift ${lift}`, () => {
    const world = new SoftWorld({ machine, geometry, glyphs });
    const L = makeLayout(geometry), state = new Float32Array(L.length);
    state[L.carriageX] = 0; state[L.shiftY] = shift; state[L.vibratorLift] = lift;
    for (let f = 0; f < 40; f++) world.step(1 / 60, state, L);
    const r = world.ribbon, hw = machine.ribbon.width / 2;
    const ps = parts();
    let worst = Infinity, what = '';
    for (const carX of [machine.carriage.marginLeftX, 0.06, 0, -0.06, machine.carriage.marginRightX]) {
      for (let i = 0; i < r.count; i++) for (const e of [-1, -0.5, 0, 0.5, 1]) {
        const x = r.positions[i * 3] + r.up[i * 3] * hw * e, y = r.positions[i * 3 + 1] + r.up[i * 3 + 1] * hw * e, z = r.positions[i * 3 + 2] + r.up[i * 3 + 2] * hw * e;
        for (const p of ps) {
          const g = gap(x, y, z, p, carX, shift);
          if (g < worst) { worst = g; what = `${p.name} at carriage ${carX}, node ${i}`; }
        }
      }
    }
    assert.ok(worst > 0.0002, `ribbon clears everything, closest ${(worst * 1e3).toFixed(2)} mm to ${what}`);
  });
}

test('the guide posts clear the feed rolls and the end plates', () => {
  const r = machine.ribbon, f = geometry.printPoint[2] + geometry.printNormal[2] * r.standoff + geometry.strikeDown[2] * r.vibrator.restDrop;
  const postZ = f + r.guidePostRadius + 0.0005 + (r.guidePostForward ?? 0);
  const fy = geometry.printPoint[1] + geometry.printNormal[1] * r.standoff + geometry.strikeDown[1] * r.vibrator.restDrop;
  for (const roll of rig.feedRolls) {
    for (const shift of [0, machine.carriage.shiftTravel]) {
      const dy = Math.max(0, (fy - 0.019) - (roll.center[1] + shift));   // nearest height on the post
      assert.ok(Math.hypot(dy, postZ - roll.center[2]) - roll.radius - r.guidePostRadius > 0, 'post clears the feed roll');
    }
  }
});
