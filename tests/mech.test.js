// Mechanism physics: assert that each behaviour emerges from the integrated contacts.
import test from 'node:test';
import assert from 'node:assert/strict';
import machine from '../src/machine/frontstrike1926.js';
import { deriveGeometry } from '../src/machine/geometry.js';
import { MechanicalSim, SUBSTEP_HZ } from '../src/sim/mechanics.js';
import { loadGlyphsNode } from '../src/sim/harness.js';

const glyphs = await loadGlyphsNode();
const geo = deriveGeometry(machine);
const H = 1 / SUBSTEP_HZ;
function fresh() { return new MechanicalSim({ machine, geometry: geo, glyphs }); }
function run(s, seconds) { const n = Math.round(seconds * SUBSTEP_HZ); for (let i = 0; i < n; i++) s.step(); }
function keyOf(ch) { return geo.keys.findIndex((k) => k.kind === 'print' && (k.lower === ch || k.upper === ch)); }
function controlKey(id) { return geo.keys.findIndex((k) => k.id === id); }
function strikes(s) { const out = []; s.drainEvents(out); return out.filter((e) => e.type === 'strike'); }
function typeOnce(ch, force = 28, hold = 0.09) {
  const s = fresh();
  const k = keyOf(ch);
  s.pressKey(k, force, hold);
  run(s, 0.28);
  return { s, k, ev: strikes(s) };
}

test('omega dt of every stiff contact is safely below the stability limit', () => {
  const s = fresh();
  const m = machine, tb = m.typebars;
  const Jbar = geo.bars[0].inertia;
  const mb = Jbar / tb.length ** 2;
  const dd = s.faces.dd;
  const kFaceMax = (s.faces.force[(s.faces.stride - 1)] - s.faces.force[s.faces.stride - 2]) / dd;
  const checks = [
    ['key felt', m.keys.felt.k, m.keys.mass],
    ['tooth/dog', m.escapement.toothStiffness, m.escapement.dogMass],
    ['dog stop', m.escapement.dogStop, m.escapement.dogMass],
    ['carriage stop', m.carriage.stopStiffness, m.carriage.mass],
    ['link (key side)', m.linkage.linkStiffness, m.keys.mass],
    ['rest pad', tb.restPadStiffness / tb.length ** 2, mb],
    ['type guide', tb.typeGuide.stiffness, tb.slugMass + tb.barMass / 3],
    ['slug on full face', kFaceMax || m.slug.foundationKPerM2 * 2.8e-5, mb],
    ['bar-bar', s.action.kBarBar, mb / 2],
    ['bell hammer', 6.5e7, s.hammerJ / s.bellR ** 2],
  ];
  for (const [name, k, mass] of checks) {
    const wdt = Math.sqrt(k / mass) * H;
    console.log(`  omega*dt ${name}: ${wdt.toFixed(3)}`);
    assert.ok(wdt < 0.6, `${name} omega dt ${wdt} not safely below 2`);
  }
});

test('key begins to move at 5-7 N, the weight of a heavy manual', () => {
  // slowly ramp a finger force on a free key, find where it starts moving
  const s = fresh();
  const k = keyOf('e');
  const id = s.grab('key', k, { target: 0.02, k: 1e5, c: 0, maxF: 0 });
  s.gMax[s.gIdToSlot.get(id)] = 0;
  let moved = -1;
  for (let i = 0; i < SUBSTEP_HZ * 0.2; i++) {
    const F = (i * H) * 40; // N
    s.gMax[s.gIdToSlot.get(id)] = F;
    s.step();
    if (moved < 0 && s.kx[k] > 8e-5) { moved = F; break; }
  }
  console.log('  force at first motion', moved.toFixed(2), 'N');
  assert.ok(moved > 4.5 && moved < 7.5, `begin-to-move force ${moved}`);
});

test('a gentle press does not reach the platen, and is silent in the strike port', () => {
  for (const f of [9, 14, 17]) {
    const { ev } = typeOnce('e', f);
    assert.equal(ev.length, 0, `${f} N press reached the platen`);
  }
});

test('impact speed grows monotonically with force, and is plausible in normal typing', () => {
  const forces = [22, 25, 28, 32, 40];
  const speeds = forces.map((f) => {
    const { ev } = typeOnce('e', f);
    assert.ok(ev.length >= 1, `no strike at ${f}N`);
    return ev[0].vImpact;
  });
  console.log('  speeds at', forces, speeds.map((v) => v.toFixed(2)));
  for (let i = 1; i < speeds.length; i++) assert.ok(speeds[i] > speeds[i - 1], 'not monotone');
  assert.ok(speeds[0] > 0.4 && speeds[0] < 2.2, `22N speed ${speeds[0]}`);
  assert.ok(speeds[2] > 1.5 && speeds[2] < 4, `28N speed ${speeds[2]}`);
});

test('peak force and contact time are physically plausible', () => {
  const { ev } = typeOnce('e', 28);
  const e = ev[0];
  console.log(`  peak ${e.peakForce.toFixed(1)} N, duration ${(e.duration * 1e6).toFixed(0)} us, indent ${(e.maxIndent * 1e6).toFixed(0)} um, restitution ${e.restitution.toFixed(2)}, v ${e.vImpact.toFixed(2)}`);
  assert.ok(e.peakForce > 50 && e.peakForce < 800, 'peak force');
  assert.ok(e.duration > 80e-6 && e.duration < 900e-6, 'contact time');
  assert.ok(e.maxIndent > 15e-6 && e.maxIndent < 800e-6, 'indent');
  assert.ok(e.restitution > 0.1 && e.restitution < 0.95, 'restitution');
  assert.ok(e.trace.force.length > 5, 'trace recorded');
});

test('a period sees higher pressure than a W at the same finger force', () => {
  const dot = typeOnce('.', 28).ev[0];
  const W = typeOnce('w', 28).ev[0];
  console.log(`  period ${(dot.peakPressure / 1e6).toFixed(0)} MPa, W ${(W.peakPressure / 1e6).toFixed(0)} MPa`);
  assert.ok(dot.peakPressure > W.peakPressure * 1.3, 'period pressure not higher');
});

test('one keystroke advances the carriage exactly one pitch, only after release', () => {
  const s = fresh();
  const k = keyOf('e');
  const p = machine.escapement.pitch;
  const x0 = s.carriageX();
  s.pressKey(k, 28, 0.09);
  // During the press: the carriage has only moved the loose slack, far less than a pitch.
  run(s, 0.07);
  const dHold = Math.abs(s.carriageX() - x0);
  assert.ok(dHold < 0.5 * p, `moved ${dHold} while held, pitch ${p}`);
  run(s, 0.4);
  const d = Math.abs(s.carriageX() - x0);
  console.log(`  held ${(dHold * 1e3).toFixed(3)} mm, final ${(d * 1e3).toFixed(4)} mm, pitch ${(p * 1e3).toFixed(3)} mm`);
  assert.ok(Math.abs(d - p) < 0.1e-3, `final advance ${d}, pitch ${p}`);
});

test('a weak press that does not reach the escapement fails to space', () => {
  const s = fresh();
  const k = keyOf('e');
  const x0 = s.carriageX();
  s.pressKey(k, 12, 0.03);
  run(s, 0.4);
  assert.ok(Math.abs(s.carriageX() - x0) < 1e-3, 'should not have spaced');
});

test('typing a sentence: exactly one pitch per printing key, in order, with separated keystrokes', () => {
  const s = fresh();
  const p = machine.escapement.pitch;
  const str = 'the quick brown fox';
  let expected = 0;
  const x0 = s.carriageX();
  for (const ch of str) {
    if (ch === ' ') {
      s.pressKey(controlKey('space'), 28, 0.08);
    } else {
      s.pressKey(keyOf(ch), 28, 0.09);
    }
    expected += 1;
    run(s, 0.18);
  }
  run(s, 0.3);
  const d = Math.abs(s.carriageX() - x0);
  console.log(`  moved ${(d / p).toFixed(3)} pitches for ${expected} characters`);
  assert.ok(Math.abs(d / p - expected) < 0.08, `moved ${d / p} expected ${expected}`);
});

test('carriage return ratchets, line-space lever indexes platen then moves carriage', () => {
  const s = fresh();
  const k = keyOf('a'), p = machine.escapement.pitch;
  // type 8 characters so the carriage has moved away from the line start
  for (let i = 0; i < 8; i++) { s.pressKey(k, 28, 0.09); run(s, 0.18); }
  run(s, 0.2);
  const xTyped = s.carriageX();
  assert.ok(Math.abs(xTyped - s.xStart) > 7.5 * p, 'typed less than expected');
  const psi0 = s.psi;
  const carAtPickup = s.carriageX();
  // Drag the lever to the end of its travel and beyond, continuously.
  const leverTravel = machine.lineSpace.travel;
  const g = s.grab('lsLever', 0, { target: 0, k: 12, c: 0.1, maxF: 4 });
  const N = SUBSTEP_HZ * 1.4;
  let psiAtSomeCarriageMotion = null;
  const xs = [];
  for (let i = 0; i < N; i++) {
    const t = i / N;
    // target rises steadily to well past the travel end: one continuous drag
    s.moveGrab(g, Math.min(1, t * 1.6) * (leverTravel * 1.6));
    s.step();
    if (psiAtSomeCarriageMotion === null && Math.abs(s.carriageX() - carAtPickup) > 2e-4) psiAtSomeCarriageMotion = s.psi;
    if (i % 1024 === 0) xs.push(s.carriageX());
  }
  const dPsi = psiAtSomeCarriageMotion === null ? null : psiAtSomeCarriageMotion - psi0;
  assert.ok(dPsi !== null && dPsi > 0.8 * (2 * Math.PI / machine.platen.ratchetTeeth), `platen indexed by ${dPsi} before carriage moved`);
  run(s, 0.1);
  s.release(g);
  run(s, 0.4);
  assert.ok(Math.abs(s.carriageX() - xTyped) > 5 * p, 'carriage was not returned at all');
  // Ratcheting produced dog impact forces: port was hit many times, and dogs lifted.
  // Each tooth crossing lifts the dog; the final position is a whole number of pitches.
  const pitches = (s.carriageX() - s.xStart) / p;
  assert.ok(Math.abs(pitches - Math.round(pitches)) < 0.06, `carriage ended on fractional tooth ${pitches}`);
  // platen ends in a detent
  const notch = 2 * Math.PI / machine.platen.detentNotches;
  assert.ok(Math.abs(s.psi / notch - Math.round(s.psi / notch)) < 0.08, 'platen not on a detent');
});

test('dragging the carriage back by hand ratchets dogs tooth by tooth', () => {
  const s = fresh();
  const k = keyOf('a'), p = machine.escapement.pitch;
  for (let i = 0; i < 6; i++) { s.pressKey(k, 28, 0.09); run(s, 0.18); }
  run(s, 0.2);
  const xT = s.carriageX();
  // grab carriage, pull it back toward line start (increasing x when q0Sign is -1)
  const g = s.grab('carriage', 0, { target: xT + 3.2 * p * -s.q0Sign, k: 4000, c: 60, maxF: 40 });
  run(s, 0.4);
  const dd = (s.carriageX() - xT) * -s.q0Sign;
  s.release(g);
  run(s, 0.3);
  const after = (s.carriageX() - xT) * -s.q0Sign / p;
  console.log(`  dragged ${(dd / p).toFixed(2)} pitches, after release ${after.toFixed(3)} pitches`);
  // Dogs dropped into a tooth: settles on an integer offset (the carriage does not run away)
  assert.ok(after > 2.5, 'carriage did not stay returned');
  assert.ok(Math.abs(after - Math.round(after)) < 0.08, `fractional: ${after}`);
});

function barPair(slot, sep) {
  const a = geo.bars.findIndex((b) => b.slot === slot), b = geo.bars.findIndex((c) => c.slot === slot + sep);
  assert.ok(a >= 0 && b >= 0, 'bars found');
  return [a, b];
}
function twoKeys(a, b, offsetMs, force = 28, hold = 0.09) {
  const s = fresh();
  s.pressKey(a, force, hold);
  for (let i = 0; i < offsetMs * 1e-3 * SUBSTEP_HZ; i++) s.step();
  s.pressKey(b, force, hold);
  run(s, 1.2);
  return s;
}
const jammedNow = (s, a, b) => s.action.theta[a] > 0.25 || s.action.theta[b] > 0.25;

test('two nearly simultaneous adjacent bars jam, stay jammed, and clear when a bar is pulled back', () => {
  const [a, b] = barPair(18, 1);
  for (const [k, c, maxF] of [[8, 0.05, 2.5], [0.8, 0.015, 0.9]]) {
    const s = twoKeys(a, b, 0);
    assert.ok(jammedNow(s, a, b), 'no jam at simultaneous launch');
    const th = [s.action.theta[a], s.action.theta[b]];
    run(s, 1.5);
    assert.ok(Math.abs(s.action.theta[a] - th[0]) < 0.02 && Math.abs(s.action.theta[b] - th[1]) < 0.02, 'jam did not persist');
    const g = s.grab('bar', a, { target: 0, k, c, maxF });
    run(s, 0.8);
    s.release(g);
    run(s, 1.2);
    console.log(`  grab ${maxF} N m: thetas ${s.action.theta[a].toFixed(3)} ${s.action.theta[b].toFixed(3)}`);
    assert.ok(s.action.theta[a] < 0.1 && s.action.theta[b] < 0.1, `jam did not clear at ${maxF} N m: ${s.action.theta[a]} ${s.action.theta[b]}`);
  }
});

test('jam probability map: fast close typing sometimes jams, comfortable typing does not', () => {
  const offsets = [0, 5, 20, 40, 60, 80, 120, 180, 250];
  const seps = [1, 2, 3, 8];
  const starts = [14, 24];
  const map = {};
  for (const sep of seps) {
    const row = [];
    for (const off of offsets) {
      let j = 0, n = 0;
      for (const st of starts) {
        const [a, b] = barPair(st, sep);
        for (const [x, y] of [[a, b], [b, a]]) { n += 1; if (jammedNow(twoKeys(x, y, off), x, y)) j += 1; }
      }
      row.push(Math.round((100 * j) / n));
    }
    map[sep] = row;
    console.log(`  sep ${sep}: ${row.join(' ')}`);
  }
  console.log(`  offsets (ms): ${offsets.join(' ')}`);
  const at = (sep, off) => map[sep][offsets.indexOf(off)];
  assert.ok(at(1, 0) > 40, 'simultaneous adjacent bars should jam often');
  const fast = seps.flatMap((sep) => offsets.filter((o) => o >= 40 && o <= 80).map((o) => at(sep, o)));
  assert.ok(fast.some((p) => p > 0), 'second bar meeting a returning bar should sometimes jam');
  for (const sep of seps) for (const off of [180, 250]) assert.equal(at(sep, off), 0, `comfortable typing jammed: sep ${sep} offset ${off}`);
});

test('adjacent bars typed at a comfortable pace do not jam', () => {
  const [a, b] = barPair(18, 1);
  const s = fresh();
  for (let i = 0; i < 8; i++) { s.pressKey(i % 2 ? b : a, 28, 0.09); run(s, 0.2); }
  run(s, 1.0);
  assert.ok(s.action.theta[a] < 0.05 && s.action.theta[b] < 0.05, `jammed: ${s.action.theta[a]} ${s.action.theta[b]}`);
  const ev = strikes(s);
  assert.ok(ev.length >= 8, `strikes ${ev.length}`);
});

test('a single keystroke makes one contact up to 42 N at any hold; hard abuse may rebound', () => {
  const chars = ['e', 'n', 'm', '.', 'w', 'q', 'p'];
  const holds = [0.04, 0.06, 0.09, 0.13, 0.18, 0.25];
  for (const force of [28, 30, 34, 38, 42]) {
    let n = 0, second = 0;
    for (const ch of chars) {
      for (const hold of holds) {
        const { ev } = typeOnce(ch, force, hold);
        if (ev.length === 0) { assert.ok(hold <= 0.06, `${force} N hold ${hold} '${ch}' did not strike`); continue; }
        n += 1; second += ev.length - 1;
        assert.equal(ev.length, 1, `${force} N hold ${hold} '${ch}': ${ev.map((e) => `${e.vImpact.toFixed(2)} m/s ${e.peakForce.toFixed(0)} N`)}`);
      }
    }
    console.log(`  ${force} N: ${n} strokes, ${second} second contacts`);
  }
  for (const force of [50, 60]) {
    let n = 0, second = 0, v = 0, f = 0;
    for (const ch of chars) {
      const { ev } = typeOnce(ch, force, 0.13);
      n += 1; second += ev.length - 1;
      for (const e of ev.slice(1)) { v = Math.max(v, e.vImpact); f = Math.max(f, e.peakForce); }
    }
    console.log(`  ${force} N: ${n} strokes, ${second} rebound contacts, fastest ${v.toFixed(2)} m/s, ${f.toFixed(0)} N`);
  }
});

test('a compliant held finger (virtual coupling) cannot throw the bar back at the platen', () => {
  for (const ch of ['e', '.']) {
    for (const force of [34, 42]) {
      for (const hold of [0.09, 0.25]) {
        const s = fresh();
        const k = keyOf(ch);
        const g = s.grab('key', k, { target: 0, k: 260, c: 0.6, maxF: 70 });
        const N = Math.round(0.5 * SUBSTEP_HZ);
        const ev = [];
        let held = true;
        for (let i = 0; i < N; i++) {
          const t = i * H;
          if (held && i % 1152 === 0) {
            const out = [];
            s.drainEvents(out);
            ev.push(...out.filter((e) => e.type === 'strike'));
            const f = ev.length ? 7 : force * 0.75 * Math.min(1, t / 0.085);
            s.moveGrab(g, s.kx[k] + f / 260);
          }
          if (held && t >= hold) { held = false; s.release(g); }
          s.step();
        }
        ev.push(...strikes(s));
        console.log(`  grab '${ch}' ${force} N ${hold} s: ${ev.map((e) => `${e.vImpact.toFixed(2)} m/s ${e.peakForce.toFixed(0)} N`).join(', ')}`);
        assert.equal(ev.length, 1, `'${ch}' ${force} N hold ${hold}`);
      }
    }
  }
});

test('a press that only just reaches the platen still lifts the ribbon', () => {
  for (const [force, hold] of [[20, 0.14], [22, 0.09], [25, 0.06]]) {
    const s = fresh();
    s.pressKey(keyOf('e'), force, hold);
    let lift = 0;
    let liftAtStrike = -1;
    const out = [];
    for (let i = 0; i < 0.3 * SUBSTEP_HZ; i++) {
      s.step();
      if (s.vibr > lift) lift = s.vibr;
      if (i % 64 === 0) { s.drainEvents(out); if (liftAtStrike < 0 && out.some((e) => e.type === 'strike')) liftAtStrike = s.vibr; }
    }
    s.drainEvents(out);
    const ev = out.filter((e) => e.type === 'strike');
    console.log(`  ${force} N ${hold} s: strikes ${ev.length}, peak lift ${(lift * 1e3).toFixed(2)} mm, at strike ${(liftAtStrike * 1e3).toFixed(2)} mm`);
    assert.ok(ev.length === 1, `${force} N should strike`);
    assert.ok(ev[0].ribbonInGap > 0.5, 'ribbon not in the gap at impact');
    assert.ok(lift > 0.6 * s.vibrLiftTarget(), `vibrator lifted only ${lift} of ${s.vibrLiftTarget()}`);
  }
});

const TOOTH = (2 * Math.PI) / machine.platen.ratchetTeeth;
const GRABS = { test: { k: 40, c: 0.2, maxF: 1.5 }, drag: { k: 5, c: 0.05, maxF: 2.4 }, hands: { k: 6, c: 0.09, maxF: 2.2 } };

/** One out-and-back lever stroke; returns teeth indexed once everything has settled. */
function leverStroke(s, T, beyond, grab, hold = 0) {
  const travel = machine.lineSpace.travel;
  const g = s.grab('lsLever', 0, { target: 0, ...grab });
  const psi0 = s.psi;
  const n = Math.round((2 * T + hold + 0.4) * SUBSTEP_HZ);
  for (let i = 0; i < n; i++) {
    const t = i * H;
    const a = t < T ? t / T : t < T + hold ? 1 : t < 2 * T + hold ? (2 * T + hold - t) / T : 0;
    s.moveGrab(g, a * travel * beyond);
    s.step();
  }
  s.release(g);
  run(s, 0.4);
  return (s.psi - psi0) / TOOTH;
}

test('line-space lever: exactly the set spacing per stroke at any stroke speed', () => {
  for (const setting of [1, 2, 3]) {
    for (const [name, grab] of Object.entries(GRABS)) {
      for (const T of [0.02, 0.05, 0.1, 0.25, 0.6]) {
        for (const beyond of [1, 1.6]) {
          const s = fresh();
          s.lineSpaceSetting = setting;
          const teeth = leverStroke(s, T, beyond, grab);
          assert.ok(Math.abs(teeth - setting) < 0.05, `setting ${setting} ${name} T=${T} x${beyond}: ${teeth} teeth`);
        }
      }
    }
  }
});

test('line-space lever: repeated strokes keep counting, and jiggling near the pick point adds nothing', () => {
  const s = fresh();
  for (let n = 1; n <= 4; n++) {
    leverStroke(s, 0.04, 1.3, GRABS.drag);
    assert.ok(Math.abs(s.psi / TOOTH - n) < 0.05, `after ${n} strokes: ${s.psi / TOOTH}`);
  }
  // Stroke, then hover the hand across the pick point without ever going home.
  const pick = s.lsPick, travel = machine.lineSpace.travel;
  const psi0 = s.psi;
  const g = s.grab('lsLever', 0, { target: 0, ...GRABS.drag });
  for (let i = 0; i < 0.1 * SUBSTEP_HZ; i++) { s.moveGrab(g, travel * (i * H) / 0.1); s.step(); }
  for (let i = 0; i < 1.5 * SUBSTEP_HZ; i++) {
    s.moveGrab(g, pick * (1 + 0.6 * Math.sin(2 * Math.PI * 9 * i * H)));
    s.step();
  }
  // Bounce the lever into its end of travel and back onto the pick point too.
  for (let i = 0; i < 1.0 * SUBSTEP_HZ; i++) {
    s.moveGrab(g, (i * H * 8) % 1 < 0.5 ? travel * 1.5 : pick * 1.2);
    s.step();
  }
  s.release(g);
  run(s, 0.5);
  const teeth = (s.psi - psi0) / TOOTH;
  console.log(`  jiggled stroke indexed ${teeth.toFixed(3)} teeth`);
  assert.ok(Math.abs(teeth - 1) < 0.05, `jiggle indexed ${teeth} teeth`);
});

test('line-space lever: a full carriage return into the end stop spaces once', () => {
  const p = machine.escapement.pitch;
  for (const setting of [1, 2, 3]) {
    for (const [name, grab] of Object.entries(GRABS)) {
      for (const T of [0.03, 0.12, 0.4]) {
        const s = fresh();
        s.lineSpaceSetting = setting;
        s.q = 30 * p; s.escAwake = true;
        run(s, 0.3);
        const xTyped = s.carriageX();
        const psi0 = s.psi;
        const travel = machine.lineSpace.travel;
        const g = s.grab('lsLever', 0, { target: 0, ...grab });
        // Pull past the end of travel and keep pulling until the carriage has banged into the stop and settled.
        for (let i = 0; i < 1.6 * SUBSTEP_HZ; i++) { s.moveGrab(g, Math.min(1, (i * H) / T) * travel * 2.2); s.step(); }
        const carried = Math.abs(s.carriageX() - xTyped) / p;
        for (let i = 0; i < T * SUBSTEP_HZ; i++) { s.moveGrab(g, (1 - (i * H) / T) * travel * 2.2); s.step(); }
        s.release(g);
        run(s, 0.5);
        const teeth = (s.psi - psi0) / TOOTH;
        assert.ok(carried > 5, `${name} T=${T}: carriage only moved ${carried} pitches`);
        assert.ok(Math.abs(teeth - setting) < 0.05, `setting ${setting} ${name} T=${T}: ${teeth} teeth after carrying ${carried} pitches`);
      }
    }
  }
});

const SENTENCES = ['the quick brown fox jumps over the lazy dog', 'we hold these truths to be evident that all men', 'she sells fine linen and wool at the corner store', 'in the morning there was a letter on the table', 'however long the night it will end with the dawn'];
function typeSentence(text, ms, seed) {
  let x = seed;
  const rnd = () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; };
  const s = fresh();
  const presses = [];
  const ev = [];
  const x0 = s.carriageX();
  let i = 0, next = 0, n = 0;
  const endN = (text.length * ms * 1e-3 + 1.5) * SUBSTEP_HZ;
  while (n < endN) {
    if (i < text.length && n * H >= next) {
      const c = text[i];
      const k = c === ' ' ? controlKey('space') : keyOf(c);
      const f = (c === ' ' ? 27 : 34 * geo.keys[k].finger) * (1 + 0.08 * (2 * rnd() - 1));
      s.pressKey(k, f, 0.06 + 0.03 * rnd());
      presses.push({ c, k, double: i > 0 && text[i - 1] === c });
      i += 1;
      next += ms * 1e-3 * (1 + 0.1 * (2 * rnd() - 1));
    }
    s.step();
    n += 1;
    if (n % 512 === 0) s.drainEvents(ev);
  }
  s.drainEvents(ev);
  const strikesOut = ev.filter((e) => e.type === 'strike' && e.vImpact > 0.45);
  const used = new Set();
  let printed = 0, letters = 0, doubles = 0, lost = 0;
  for (const p of presses) {
    if (p.c === ' ') continue;
    letters += 1;
    const j = strikesOut.findIndex((e, ix) => !used.has(ix) && e.bar === p.k);
    if (j >= 0) { used.add(j); printed += 1; } else if (p.double) doubles += 1; else lost += 1;
  }
  return { printed, letters, lost, doubles, chars: text.length, pitches: Math.abs(s.carriageX() - x0) / machine.escapement.pitch, jam: [...s.action.theta].some((t) => t > 0.25) };
}

test('English typed at 120-140 wpm prints every letter that is not a double, and does not jam', () => {
  for (const ms of [200, 100, 85]) {
    const totals = { printed: 0, letters: 0, lost: 0, doubles: 0, chars: 0, pitches: 0, jams: 0 };
    SENTENCES.forEach((text, t) => {
      const r = typeSentence(text, ms, t * 17 + 3);
      for (const key of ['printed', 'letters', 'lost', 'doubles', 'chars', 'pitches']) totals[key] += r[key];
      totals.jams += r.jam ? 1 : 0;
    });
    console.log(`  ${ms} ms: printed ${totals.printed}/${totals.letters}, lost ${totals.lost}, double letters lost ${totals.doubles}, pitches ${totals.pitches.toFixed(0)}/${totals.chars}, jammed sentences ${totals.jams}/5`);
    assert.ok(totals.lost <= (ms >= 100 ? 1 : 3), `${ms} ms lost ${totals.lost} letters`);
    assert.equal(totals.jams, 0, `${ms} ms jammed`);
    assert.ok(totals.pitches >= totals.chars * (ms >= 100 ? 0.99 : 0.93), `${ms} ms pitches ${totals.pitches}/${totals.chars}`);
  }
});

const FIFTY = 'thequickbrownfoxjumpsoverthelazydogpackmyboxwithfi';
function typeUnlimited(ms) {
  const s = fresh();
  s.setParam('typing.unlimited', true);
  const x0 = s.carriageX(), ev = [];
  const gap = Math.round(ms * 1e-3 * SUBSTEP_HZ);
  for (const c of FIFTY) { s.pressKey(keyOf(c), 34, 0.08); for (let i = 0; i < gap; i++) s.step(); s.drainEvents(ev); }
  run(s, 1);
  s.drainEvents(ev);
  return { s, x0, st: ev.filter((e) => e.type === 'strike') };
}

test('unlimited typing: fifty letters at any speed print once each at their own column, no jam', () => {
  const p = machine.escapement.pitch;
  assert.equal(FIFTY.length, 50);
  for (const ms of [10, 20, 40]) {
    const { s, x0, st } = typeUnlimited(ms);
    assert.equal(st.length, 50, `${ms} ms: ${st.length} strikes`);
    st.forEach((e, i) => {
      assert.equal(e.bar, keyOf(FIFTY[i]), `${ms} ms letter ${i} wrong bar`);
      assert.ok(Math.abs(e.carriageX - (x0 + s.q0Sign * i * p)) < 1e-6, `${ms} ms letter ${i}: column off by ${(e.carriageX - x0 - s.q0Sign * i * p) * 1e3} mm`);
      assert.ok(e.peakForce > 20 && e.maxIndent > 0 && e.trace.force.length > 3, `${ms} ms letter ${i}: empty strike`);
    });
    assert.ok(Math.abs(s.carriageX() - x0 - s.q0Sign * 50 * p) < 1e-6, `${ms} ms final carriage`);
    assert.ok([...s.action.theta].every((t) => t < 0.05), `${ms} ms: bars did not come home`);
  }
});

test('unlimited typing: the same bar re-fires however fast, and spaces advance one pitch', () => {
  const p = machine.escapement.pitch;
  const s = fresh();
  s.setParam('typing.unlimited', true);
  const x0 = s.carriageX(), ev = [], k = keyOf('e');
  for (let n = 0; n < 40; n++) { s.pressKey(n % 4 === 3 ? controlKey('space') : k, 34, 0.09); run(s, 0.005); s.drainEvents(ev); }
  run(s, 0.5);
  s.drainEvents(ev);
  assert.equal(ev.filter((e) => e.type === 'strike').length, 30);
  assert.ok(Math.abs(s.carriageX() - x0 - s.q0Sign * 40 * p) < 1e-6, 'pitch count');
});

test('unlimited typing: turning it on frees a jam, and off leaves the machine behaving exactly as before', () => {
  const [a, b] = barPair(18, 1);
  const s = twoKeys(a, b, 0);
  assert.ok(jammedNow(s, a, b), 'needs a jam to start with');
  s.setParam('typing.unlimited', true);
  run(s, 1.2);
  assert.ok(s.action.theta[a] < 0.1 && s.action.theta[b] < 0.1, `still jammed: ${s.action.theta[a]} ${s.action.theta[b]}`);
  // Off again: identical to a machine on which the switch was never touched.
  const script = (m) => { const out = []; m.pressKey(a, 34, 0.08); run(m, 0.02); m.pressKey(b, 34, 0.08); run(m, 0.5); m.pressKey(keyOf('e'), 28, 0.09); run(m, 0.5); m.drainEvents(out); return out.filter((e) => e.type === 'strike').map((e) => [e.bar, e.vImpact, e.peakForce, e.carriageX]); };
  const plain = fresh();
  const toggled = fresh();
  toggled.setParam('typing.unlimited', true);
  toggled.setParam('typing.unlimited', false);
  assert.deepEqual(script(toggled), script(plain));
  const again = fresh();
  assert.equal(again.setParam('typing.unlimited', false), true);
  assert.deepEqual(script(again), script(fresh()));
});

test('margin bell rings before the right margin, not on the return', () => {
  const s = fresh();
  const p = machine.escapement.pitch;
  const bellQ = s.q0Sign * (s.ax[4] - s.xStart) - s.bellRing;
  // Jump the carriage near the bell point, then type a few characters.
  s.q = bellQ - 5 * p;
  s.escAwake = true;
  run(s, 0.25);
  const out = [];
  const k = keyOf('m');
  for (let i = 0; i < 9; i++) { s.pressKey(k, 28, 0.09); run(s, 0.18); }
  run(s, 0.2);
  s.drainEvents(out);
  const bells = out.filter((e) => e.type === 'bell');
  console.log(`  bells ${bells.length}, peak force ${bells.map((b) => b.peakForce.toFixed(0))}`);
  assert.ok(bells.length >= 1, 'bell did not ring');
  // Return the carriage through the zone; no further ring.
  const before = bells.length;
  const g = s.grab('carriage', 0, { target: s.carriageX() + s.q0Sign * -0.05, k: 3000, c: 80, maxF: 50 });
  run(s, 0.8);
  s.release(g);
  run(s, 0.2);
  const out2 = [];
  s.drainEvents(out2);
  assert.equal(out2.filter((e) => e.type === 'bell').length, 0, 'bell rang on return');
  void before;
});

test('right margin stops the carriage: typing past it does not space', () => {
  const s = fresh();
  const p = machine.escapement.pitch;
  // Put the carriage just before the right margin and let it settle.
  const qR = s.q0Sign * (s.ax[4] - s.xStart);
  s.q = qR - 2 * p + 0.1 * p;
  s.escAwake = true;
  run(s, 0.3);
  const k = keyOf('j');
  for (let i = 0; i < 10; i++) { s.pressKey(k, 28, 0.09); run(s, 0.18); }
  run(s, 0.3);
  assert.ok(s.q <= qR + 3e-4, `carriage passed the right margin: ${(s.q - qR) * 1e3} mm`);
});

test('shift DOF raises the carriage, and the slug prints the upper case band', () => {
  const s = fresh();
  const shiftKey = controlKey('shiftL');
  s.pressKey(shiftKey, 25, 0.22);
  run(s, 0.1);
  assert.ok(s.shiftY > machine.carriage.shiftTravel * 0.85, `shift only reached ${s.shiftY}`);
  s.pressKey(keyOf('a'), 28, 0.09);
  run(s, 0.25);
  const ev = strikes(s);
  assert.equal(ev.length >= 1 ? ev[0].caseIndex : -1, 1, 'should strike upper case band');
  run(s, 0.6);
  assert.ok(s.shiftY < 1e-3, 'shift returned');
});

test('platen is indexed by the detent and rests on a detent after a knob twist', () => {
  const s = fresh();
  const g = s.grab('platen', 0, { target: 0.05, k: 2, c: 0.02, maxF: 0.2 });
  run(s, 0.3);
  s.release(g);
  run(s, 0.5);
  const notch = 2 * Math.PI / machine.platen.detentNotches;
  assert.ok(Math.abs(s.psi / notch - Math.round(s.psi / notch)) < 0.05, `psi ${s.psi}`);
});

test('energy never grows: free bars, carriage and platen conserve or dissipate only', () => {
  const s = fresh();
  // Inject motion directly, with nothing driving afterwards.
  s.action.wake(5);
  s.action.theta[5] = 1.4; s.action.omega[5] = 18;
  s.action.wake(30);
  s.action.theta[30] = 2.0; s.action.omega[30] = -5; s.action.lat[30] = 2e-4;
  s.q = 3 * machine.escapement.pitch - 1e-6; s.qV = -0.1; s.escAwake = true;
  s.psi = 0.03; s.psiV = 4; s.platenAwake = true;
  s.vibr = 0.004; s.vibrAwake = true;
  s.hammer = 0.3; s.bellAwake = true;
  s.ll = 0.04; s.platenAwake = true;
  s.ax[1] = 0.2; s.aAwake[1] = 1;
  const kk = controlKey('space');
  s.wakeKey(kk); s.kx[kk] = 0.004;
  let E0 = s.energy();
  let Emax = E0;
  let last = E0;
  const N = SUBSTEP_HZ * 1.2;
  for (let i = 0; i < N; i++) {
    s.step();
    if (i % 128 === 0) {
      const E = s.energy();
      if (E > Emax) Emax = E;
      assert.ok(E < E0 + 2.5e-4, `energy grew to ${E} from ${E0} at step ${i}`);
      last = E;
    }
  }
  console.log(`  energy ${E0.toExponential(3)} -> ${last.toExponential(3)}`);
  assert.ok(last < E0, 'energy should have been dissipated');
});

test('energy never exceeds the work done by fingers and hands (typing + return)', () => {
  const s = fresh();
  const k = keyOf('f');
  for (let i = 0; i < 6; i++) { s.pressKey(k, 28, 0.09); run(s, 0.18); }
  const g = s.grab('lsLever', 0, { target: machine.lineSpace.travel * 1.3, k: 10, c: 0.1, maxF: 3 });
  run(s, 0.5);
  s.release(g);
  run(s, 0.5);
  const E0 = new MechanicalSim({ machine, geometry: geo, glyphs }).energy();
  const E = s.energy();
  console.log(`  E ${E.toFixed(4)} J, E0 ${E0.toFixed(4)} J, external work ${s.workExt.toFixed(4)} J`);
  assert.ok(E <= E0 + s.workExt + 1e-3, `energy ${E} exceeds budget ${E0 + s.workExt}`);
});

test('sleeping: an idle machine costs nothing, a keystroke wakes only what it touches', () => {
  const s = fresh();
  run(s, 0.1);
  assert.equal(s.nActiveK, 0); assert.equal(s.action.nActive, 0);
  assert.equal(s.escAwake, false); assert.equal(s.platenAwake, false);
  s.pressKey(keyOf('q'), 28, 0.09);
  run(s, 0.03);
  assert.ok(s.nActiveK >= 1 && s.action.nActive >= 1);
  run(s, 1.2);
  assert.equal(s.nActiveK, 0, 'key should sleep');
  assert.equal(s.action.nActive, 0, 'bar should sleep');
  assert.equal(s.escAwake, false, 'escapement should sleep');
});
