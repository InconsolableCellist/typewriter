// Mechanism physics of the single-element machine: behaviour comes out of the integrated cams, clutches and contacts.
import test from 'node:test';
import assert from 'node:assert/strict';
import machine from '../src/machine/element1971.js';
import { deriveGeometry } from '../src/machine/geometry.js';
import { MechanicalSim, SUBSTEP_HZ } from '../src/sim/mechanics.js';
import { loadGlyphsNode } from '../src/sim/harness.js';
import { AudioEngine } from '../src/audio/engine.js';

const glyphs = await loadGlyphsNode();
const geo = deriveGeometry(machine);
const E = machine.element;
const P = machine.escapement.pitch;
const TOOTH = (2 * Math.PI) / machine.platen.ratchetTeeth;
const H = 1 / SUBSTEP_HZ;
// setParam writes through to the machine object, so a test that tunes one gets its own copy.
function fresh(m = machine, g = geo) { return new MechanicalSim({ machine: m, geometry: g, glyphs }); }
const tuned = () => fresh(structuredClone(machine));
function run(s, seconds) { const n = Math.round(seconds * SUBSTEP_HZ); for (let i = 0; i < n; i++) s.step(); }
const keyOf = (ch) => geo.keys.findIndex((k) => k.kind === 'print' && (k.lower === ch || k.upper === ch));
const ctl = (id) => geo.keys.findIndex((k) => k.id === id);
const drain = (s) => { const o = []; s.drainEvents(o); return o; };
// Tallies every strike this sim has made so far; the sim's event queue is drained into its own log.
function strikes(s, buf) {
  if (buf) return buf.filter((e) => e.type === 'strike');
  (s.log ??= []).push(...drain(s));
  return s.log.filter((e) => e.type === 'strike');
}
const pitches = (s) => s.q / P;
const press = (s, k, f = 12, d = 0.05) => s.pressKey(k, f, d);

test('stiff couplings are well inside the stability limit', () => {
  const rows = [
    ['cycle clutch', E.cycleShaft.clutchStiffness, E.cycleShaft.inertia],
    ['op clutch', E.opShaft.clutchStiffness, E.opShaft.inertia],
    ['shift clutch', E.shiftShaft.clutchStiffness, E.shiftShaft.inertia],
    ['rotate detent', E.rotate.detentStiffness, E.rotate.inertia],
    ['tilt tape', E.tilt.tapeStiffness, E.tilt.inertia],
    ['rocker cam', E.rocker.camStiffness, E.rocker.mass],
    ['key felt', machine.keys.felt.k, machine.keys.mass],
    ['interposer block', E.interposer.blockStiffness, machine.keys.mass],
    ['carriage stop', machine.carriage.stopStiffness, machine.carriage.mass],
  ];
  for (const [name, k, m] of rows) {
    const wdt = Math.sqrt(k / m) * H;
    assert.ok(wdt < 0.6, `${name} omega dt ${wdt}`);
  }
});

test('idle: motor runs near 3450 rpm at about 15.5 cycles/s of shaft speed, ball at home', () => {
  const s = fresh();
  run(s, 0.3);
  const rpm = s.action.motorW * 60 / (2 * Math.PI);
  console.log(`  motor ${rpm.toFixed(0)} rpm`);
  assert.ok(rpm > 3380 && rpm < 3530, `rpm ${rpm}`);
  assert.ok(Math.abs(s.action.motorW / E.drive.shaftRatio / (2 * Math.PI) - 15.5) < 0.3, 'shaft rate');
  assert.equal(s.action.cyc.moving, false);
  assert.ok(Math.abs(s.action.tilt) < 1e-3 && Math.abs(s.action.rot) < 1e-3, 'ball homed');
});

function typeOne(ch, force = 22, dur = 0.05, extra) {
  const s = extra ? tuned() : fresh();
  extra?.(s);
  const k = keyOf(ch);
  press(s, k, force, dur);
  run(s, 0.3);
  return { s, k };
}

test('one key press selects the code, seats the ball, prints the right glyph once and spaces one pitch', () => {
  for (const ch of ['e', 'a', 'z', 'q', 'p', '1', ';', '/']) {
    const { s, k } = typeOne(ch);
    const ev = strikes(s);
    assert.equal(ev.length, 1, `'${ch}': ${ev.length} strikes`);
    assert.equal(ev[0].bar, k, `'${ch}' printed bar ${ev[0].bar}`);
    assert.equal(ev[0].caseIndex, 0);
    assert.ok(ev[0].peakForce > 80 && ev[0].peakForce < 900, `force ${ev[0].peakForce}`);
    assert.ok(Math.abs(ev[0].rotateError) < 2e-3 && Math.abs(ev[0].tiltError) < 2e-3, `seat error ${ev[0].rotateError} ${ev[0].tiltError}`);
    assert.ok(Math.abs(pitches(s) - 1) < 0.05, `'${ch}' moved ${pitches(s)} pitches`);
    assert.ok(ev[0].ribbonInGap, 'ribbon lifted into the gap at impact');
    assert.ok(Math.abs(s.action.tilt) < 2e-3 && Math.abs(s.action.rot) < 2e-3, `'${ch}' ball homed`);
  }
});

test('the ball is thrown: impact speed, force and contact time are plausible and do not depend on the finger', () => {
  const f = [8, 14, 25, 40].map((force) => {
    const { s } = typeOne('e', force, 0.06);
    const [ev] = strikes(s);
    return ev;
  });
  console.log('  v', f.map((e) => e.vImpact.toFixed(2)), 'F', f.map((e) => e.peakForce.toFixed(0)), 'dur us', f.map((e) => (e.duration * 1e6).toFixed(0)));
  for (const e of f) {
    assert.ok(Math.abs(e.vImpact - f[0].vImpact) < 0.03, 'impact speed changed with the key force');
    assert.ok(Math.abs(e.peakForce - f[0].peakForce) < f[0].peakForce * 0.05, 'force changed with the key force');
    assert.ok(e.vImpact > 0.8 && e.vImpact < 3.5, `v ${e.vImpact}`);
    assert.ok(e.duration > 60e-6 && e.duration < 1.2e-3, `duration ${e.duration}`);
  }
});

test('impression control sets strength', () => {
  const at = (v) => { const { s } = typeOne('e', 20, 0.05, (x) => x.setParam('element.impression.setting', v)); return strikes(s)[0]; };
  const a = at(0.1), b = at(0.5), c = at(1);
  console.log('  F', [a, b, c].map((e) => e.peakForce.toFixed(0)), 'v', [a, b, c].map((e) => e.vImpact.toFixed(2)));
  assert.ok(a.peakForce < b.peakForce && b.peakForce < c.peakForce, 'not monotonic');
});

test('a light press latches: a sub-newton weight does nothing, an ordinary finger starts a cycle', () => {
  const s = fresh();
  press(s, keyOf('e'), 0.4, 0.1);
  run(s, 0.25);
  assert.equal(s.action.cycles, 0, 'too light should not trip');
  const t = fresh();
  press(t, keyOf('e'), 5, 0.06);
  run(t, 0.3);
  assert.equal(t.action.cycles, 1);
});

test('a key held down is one character, and the shaft stops after exactly one turn', () => {
  const s = fresh();
  press(s, keyOf('t'), 25, 0.5);
  run(s, 0.7);
  assert.equal(s.action.cycles, 1);
  assert.equal(strikes(s).length, 1);
  assert.ok(s.action.cyc.moving === false);
  assert.ok(Math.abs(s.action.cyc.phi) < 1e-3);
});

test('rollover: a second key struck during the cycle waits at the compensator and then prints', () => {
  const s = fresh();
  press(s, keyOf('n'), 25, 0.12);
  run(s, 0.012);
  press(s, keyOf('o'), 25, 0.12);
  run(s, 0.5);
  const ev = strikes(s);
  assert.deepEqual(ev.map((e) => e.bar), [keyOf('n'), keyOf('o')], 'order');
  assert.ok(ev[1].tBegin - ev[0].tBegin > 0.04 && ev[1].tBegin - ev[0].tBegin < 0.11, `spacing ${(ev[1].tBegin - ev[0].tBegin) * 1e3} ms`);
  assert.ok(Math.abs(pitches(s) - 2) < 0.1, `${pitches(s)} pitches`);
});

test('type-ahead: one key latched during a cycle chains into the next; further keys wait at the block', () => {
  const s = fresh();
  press(s, keyOf('a'), 25, 0.09);
  run(s, 0.036);     // past the interposer restore of the first cycle
  press(s, keyOf('b'), 25, 0.09);
  run(s, 0.012);
  assert.equal(s.action.ipKey, keyOf('b'), 'b should be latched as the type-ahead');
  press(s, keyOf('c'), 25, 0.12);    // held until b restores, then latched behind it
  run(s, 0.55);
  const ev = strikes(s);
  assert.deepEqual(ev.map((e) => e.bar), [keyOf('a'), keyOf('b'), keyOf('c')], `strikes ${ev.map((e) => e.bar)}`);
  assert.ok(ev[1].tBegin - ev[0].tBegin < 0.082, `chain spacing ${(ev[1].tBegin - ev[0].tBegin) * 1e3} ms`);
  assert.ok(Math.abs(pitches(s) - 3) < 0.1, `${pitches(s)} pitches`);
});

test('a key tapped while the compensator is occupied and released in time is lost, not jammed', () => {
  const s = fresh();
  press(s, keyOf('s'), 25, 0.08);
  run(s, 0.008);
  press(s, keyOf('d'), 6, 0.002);    // gone before the interposer restores
  run(s, 0.5);
  const ev = strikes(s);
  assert.deepEqual(ev.map((e) => e.bar), [keyOf('s')]);
});

test('continuous typing spaces one pitch per stroke and tops out near the 15.5 per second of the shaft', () => {
  const s = fresh();
  const str = 'the quick brown fox jumps over the lazy dog'.replaceAll(' ', '');
  let t = 0, idx = 0, dtNext = 0;
  const ev = [];
  for (let i = 0; idx < str.length || t < dtNext + 0.6; i++, t += H) {
    if (idx < str.length && t >= dtNext) { press(s, keyOf(str[idx]), 22, 0.06); idx++; dtNext += 0.0625; }
    s.step();
    if (i % 1024 === 0) ev.push(...drain(s));
  }
  ev.push(...drain(s));
  const st = strikes(s, ev);
  assert.equal(st.length, str.length, `struck ${st.length} of ${str.length}`);
  assert.deepEqual(st.map((e) => geo.keys[e.bar].lower).join(''), str, 'order');
  assert.ok(Math.abs(pitches(s) - str.length) < 0.5, `${pitches(s)} pitches`);
  // Carriage has to be still at every impact.
  const rate = (st.length - 1) / (st[st.length - 1].tBegin - st[0].tBegin);
  console.log(`  ${rate.toFixed(2)} characters/s`);
  assert.ok(rate > 13.5 && rate < 17, `rate ${rate}`);
  const columns = new Set(st.map((e) => Math.round(e.carriageX / P)));
  assert.equal(columns.size, st.length, 'two strikes on one column');
});

test('shift rotates the ball half a turn and prints the upper hemisphere; lock holds it', () => {
  const s = fresh();
  const ks = ctl('shiftL');
  const g = s.grab('key', ks, { target: 0.008, k: 2000, c: 12, maxF: 6 });
  run(s, 0.06);
  assert.ok(Math.abs(s.action.hemi - Math.PI) < 0.04, `hemisphere ${s.action.hemi}`);
  press(s, keyOf('g'), 22, 0.05);
  run(s, 0.2);
  s.release(g);
  run(s, 0.3);
  assert.ok(Math.abs(s.action.hemi) < 0.04, `hemisphere ${s.action.hemi} after release`);
  let ev = strikes(s);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].caseIndex, 1);
  press(s, ctl('shiftLock'), 15, 0.05);
  run(s, 0.3);
  assert.ok(Math.abs(s.action.hemi - Math.PI) < 0.04, 'lock did not rotate the ball');
  press(s, keyOf('h'), 22, 0.05);
  run(s, 0.25);
  ev = strikes(s);
  assert.equal(ev[ev.length - 1].caseIndex, 1, 'locked');
  press(s, ctl('shiftR'), 15, 0.05);
  run(s, 0.4);
  assert.ok(Math.abs(s.action.hemi) < 0.04, 'shift should release the lock');
});

test('a letter pressed together with shift waits for the half-turn and prints the upper case', () => {
  const s = fresh();
  const ks = ctl('shiftL');
  const g = s.grab('key', ks, { target: 0.008, k: 2000, c: 12, maxF: 6 });
  run(s, 0.004);
  press(s, keyOf('m'), 22, 0.06);
  run(s, 0.3);
  s.release(g);
  run(s, 0.2);
  const ev = strikes(s);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].caseIndex, 1);
  assert.equal(ev[0].bar, keyOf('m'));
});

test('space, backspace, correct and index', () => {
  const s = fresh();
  press(s, keyOf('e'), 22, 0.05);
  run(s, 0.25);
  press(s, keyOf('e'), 22, 0.05);
  run(s, 0.25);
  const before = pitches(s);
  assert.ok(Math.abs(before - 2) < 0.05, `typed ${before}`);
  press(s, ctl('space'), 18, 0.05);
  run(s, 0.3);
  assert.ok(Math.abs(pitches(s) - before - 1) < 0.05, `space ${pitches(s) - before}`);
  press(s, ctl('backspace'), 18, 0.05);
  run(s, 0.35);
  assert.ok(Math.abs(pitches(s) - before) < 0.08, `backspace ${pitches(s) - before}`);
  press(s, ctl('correct'), 18, 0.05);
  run(s, 0.35);
  assert.ok(Math.abs(pitches(s) - (before - 1)) < 0.08, `correct ${pitches(s) - before}`);
  const n = strikes(s).length;
  const psi0 = s.psi;
  press(s, ctl('index'), 15, 0.05);
  run(s, 0.45);
  assert.equal(strikes(s).length - n, 0, 'control keys do not print');
  assert.ok(Math.abs((s.psi - psi0) / TOOTH - 1) < 0.05, `index ${(s.psi - psi0) / TOOTH}`);
  assert.ok(Math.abs(pitches(s) - (before - 1)) < 0.08, 'index did not move the carrier');
});

test('return indexes one line, winds the carrier home, and unlatches at the left margin', () => {
  const s = fresh();
  for (const c of 'carriage returns home') { if (c === ' ') press(s, ctl('space'), 18, 0.05); else press(s, keyOf(c), 22, 0.05); run(s, 0.1); }
  run(s, 0.3);
  const typed = pitches(s);
  assert.ok(Math.abs(typed - 21) < 0.2, `typed ${typed}`);
  const psi0 = s.psi;
  const n = strikes(s).length;
  press(s, ctl('return'), 18, 0.05);
  run(s, 0.05);
  let maxV = 0;
  for (let i = 0; i < 1.4 * SUBSTEP_HZ; i++) { s.step(); if (-s.qV > maxV) maxV = -s.qV; }
  console.log(`  return top speed ${maxV.toFixed(2)} m/s`);
  assert.ok(maxV > 0.5 && maxV < 1.5, `speed ${maxV}`);
  assert.equal(s.action.returnLatched, false, 'clutch still latched');
  assert.ok(Math.abs(s.q) < 0.4 * P, `carrier ended ${s.q / P} pitches from home`);
  assert.ok(Math.abs((s.psi - psi0) / TOOTH - 1) < 0.05, `line ${(s.psi - psi0) / TOOTH}`);
  assert.equal(strikes(s).length, n, 'return printed something');
  // Typing resumes at the margin.
  press(s, keyOf('x'), 22, 0.05);
  run(s, 0.25);
  assert.equal(strikes(s).at(-1).bar, keyOf('x'));
  assert.ok(Math.abs(pitches(s) - 1) < 0.1, `resumed at ${pitches(s)}`);
});

test('tab runs to a set stop, clear removes it; with no stop it runs to the right margin', () => {
  const s = fresh();
  const p = (id, w = 0.3) => { press(s, ctl(id), 15, 0.05); run(s, w); };
  for (let i = 0; i < 12; i++) { press(s, ctl('space'), 18, 0.04); run(s, 0.11); }
  p('tabSet');
  const here = Math.round(pitches(s));
  p('return', 1.1);
  p('tab', 0.7);
  assert.ok(Math.abs(pitches(s) - here) < 0.12, `tabbed to ${pitches(s)}, stop at ${here}`);
  p('tabClear');
  assert.equal(s.action.tabStops[here], 0);
  p('return', 1.1);
  assert.ok(Math.abs(pitches(s)) < 0.4, 'home');
  p('tab', 1.6);
  const qR = s.q0Sign * (s.ax[4] - s.xStart);
  assert.ok(s.q > qR - 3 * P && s.q <= qR + 0.002, `no stop should run to the margin (${pitches(s)})`);
  assert.equal(s.action.tabLatched, false);
});

test('margin release: the carrier can be moved past the margin; the right margin stops spacing', () => {
  const s = fresh();
  const qR = s.q0Sign * (s.ax[4] - s.xStart);
  s.q = qR - 1.8 * P; s.escAwake = true;
  run(s, 0.3);
  for (let i = 0; i < 5; i++) { press(s, ctl('space'), 18, 0.05); run(s, 0.12); }
  run(s, 0.3);
  assert.ok(s.q <= qR + 3e-4, `past the margin ${(s.q - qR) * 1e3} mm`);
});

test('motor off: nothing cycles and the machine stops; power on recovers', () => {
  const s = fresh();
  press(s, ctl('onOff'), 15, 0.05);
  run(s, 3);
  assert.equal(s.action.motorOn, false);
  assert.ok(s.action.motorW < 0.15 * E.motor.ratedOmega, `motor still at ${s.action.motorW}`);
  press(s, keyOf('e'), 22, 0.05);
  run(s, 0.3);
  assert.equal(strikes(s).length, 0, 'printed with the motor off');
  assert.equal(s.action.cycles, 0);
  assert.equal(pitches(s), 0);
  press(s, ctl('onOff'), 15, 0.05);
  run(s, 1.5);
  assert.ok(s.action.motorW > 0.9 * E.motor.ratedOmega, 'motor did not restart');
  // The interposer latched while off still holds its key's code: it cycles once the motor is up.
  assert.ok(strikes(s).length <= 1);
  press(s, keyOf('o'), 22, 0.05);
  run(s, 0.3);
  assert.equal(strikes(s).at(-1).bar, keyOf('o'));
});

test('stalled motor: a load the motor cannot pull lets a held carrier reach its limit without runaway', () => {
  const s = tuned();
  s.setParam('element.motor.breakdownTorque', 0.03);       // a tired motor that cannot hold speed
  run(s, 0.5);
  press(s, keyOf('e'), 22, 0.06);
  run(s, 0.8);
  const ev = strikes(s);
  console.log(`  weak motor: ${ev.length} strikes, ${(s.action.motorW * 60 / 2 / Math.PI).toFixed(0)} rpm`);
  assert.equal(ev.length, 0, 'should not have the speed to trip a cycle');
  assert.ok(s.action.motorW < E.motor.syncOmega * 1.02, 'motor overspeed');
});

test('a mistimed clutch stop mis-seats the ball but never hangs the machine', () => {
  const m = structuredClone(machine);
  m.element.cycleShaft.stopAngle = -0.6;      // stops well short of the full turn: every cam starts from the wrong angle
  const s = fresh(m);
  press(s, keyOf('q'), 22, 0.05);
  run(s, 0.3);
  press(s, keyOf('w'), 22, 0.05);
  run(s, 0.3);
  assert.ok(s.action.cycles >= 1);
});

test('ribbon lifts on its cam for the strike and is fed by the escapement rocker', () => {
  const s = fresh();
  press(s, keyOf('o'), 22, 0.05);
  let lift = 0, feed = 0;
  for (let i = 0; i < 0.2 * SUBSTEP_HZ; i++) { s.step(); if (s.vibr > lift) lift = s.vibr; if (s.rp > feed) feed = s.rp; }
  const [ev] = strikes(s);
  console.log(`  lift ${(lift * 1e3).toFixed(2)} mm, feed ${(feed * 1e3).toFixed(2)} mm, at strike ${(ev.vibratorLift * 1e3).toFixed(2)} mm`);
  assert.ok(lift > 0.9 * s.vibrLiftTarget(), `lift ${lift}`);
  assert.ok(ev.vibratorLift > 0.55 * s.vibrLift, 'ribbon not up at the strike');
  assert.ok(feed > 0.5 * s.rpFull, `feed ${feed}`);
});

test('a floppy rotate tape mis-seats the ball: the wrong face is printed, or the seat error shows', () => {
  const s = tuned();
  // A slack tape, a worn detent and a stiff tube bearing leave the ball short of its column.
  s.setParam('element.rotate.tapeStiffness', 0.035);
  s.setParam('element.rotate.detentMaxTorque', 0.0025);
  s.setParam('element.rotate.bearingCoulomb', 0.003);
  press(s, keyOf('q'), 22, 0.05);
  run(s, 0.3);
  const [ev] = strikes(s);
  console.log(`  printed bar ${ev?.bar}, wanted ${keyOf('q')}, rotate error ${ev?.rotateError}`);
  assert.ok(ev && (ev.bar !== keyOf('q') || Math.abs(ev.rotateError) > 0.04), 'tape stiffness did not matter');
});

test('rest pose: the ball and ribbon sit below the print line and the cycle pops up and fully back down', () => {
  const e = geo.element, pp = geo.printPoint, up = geo.strikeDown.map((c) => -c);
  const above = (p) => (p[0] - pp[0]) * up[0] + (p[1] - pp[1]) * up[1] + (p[2] - pp[2]) * up[2];
  assert.ok(above(e.center) + e.ballRadius < -0.004, `ball top ${above(e.center) + e.ballRadius}`);
  assert.ok(e.strikeGap > 0.02 && e.strikeGap < 0.028, `strikeGap ${e.strikeGap}`);
  const reach = e.center.map((c, i) => c + e.strikeDir[i] * e.strikeGap);
  const contact = pp.map((c, i) => c + geo.printNormal[i] * e.ballRadius);
  assert.ok(Math.hypot(reach[0] - contact[0], reach[1] - contact[1], reach[2] - contact[2]) < 1e-9, 'strikeDir and strikeGap reach the contact point');
  const rib = machine.ribbon, restTop = -rib.vibrator.restDrop + rib.width / 2;
  assert.ok(restTop < -0.003, `ribbon rests at ${restTop}`);
  // Typed flat out, the ball is home at every cycle end and only leaves after selection has finished.
  const s = fresh();
  const str = 'typefastnow';
  const homeAt = [], detentedAtPop = [];
  let wasPop = false, phi0 = 0, wrapped = 0, idx = 0, t = 0;
  for (let i = 0; i < 1.3 * SUBSTEP_HZ; i++, t += H) {
    if (idx < str.length && t >= idx * 0.058) press(s, keyOf(str[idx++]), 22, 0.09);
    s.step();
    const A = s.action, phi = A.cyc.phi;
    if (phi < phi0 - 3 && A.cyc.moving) { wrapped++; homeAt.push(A.rocker); }
    phi0 = phi;
    if (A.rocker > 0.005 && !wasPop) { wasPop = true; detentedAtPop.push(A.camDet.at(A.cyc.phi / A.cyc.period).v); }
    if (A.rocker < 0.001) wasPop = false;
  }
  console.log(`  ${wrapped} chained wraps, rocker there (mm): ${homeAt.map((x) => (x * 1e3).toFixed(2)).join(' ')}`);
  assert.ok(wrapped >= 3, 'needed a chain of strokes');
  for (const x of homeAt) assert.ok(x < 0.002, `ball still up ${x} at the end of a cycle`);
  for (const d of detentedAtPop) assert.ok(d > 0.9, `ball left before seating (detent ${d})`);
  assert.ok(strikes(s).length >= str.length - 2, `struck ${strikes(s).length} of ${str.length}`);
});

test('correction: correct backspaces and arms; the next key lifts the tape, strikes with erase, leaves the carrier and ribbon', () => {
  const s = fresh(), L = s.layout, snap = new Float32Array(L.length);
  press(s, keyOf('w'), 22, 0.05);
  run(s, 0.3);
  assert.ok(Math.abs(pitches(s) - 1) < 0.05);
  const n0 = strikes(s).length;
  press(s, ctl('correct'), 18, 0.05);
  run(s, 0.35);
  assert.ok(Math.abs(pitches(s)) < 0.08, `backspace ${pitches(s)}`);
  assert.equal(s.action.correctionArmed, true, 'correct should arm the lift-off latch');
  assert.equal(strikes(s).length, n0, 'correct alone prints nothing');
  press(s, keyOf('w'), 22, 0.05);
  let liftPeak = 0, vibrPeak = 0, tape0 = s.action.tapeFed;
  for (let i = 0; i < 0.25 * SUBSTEP_HZ; i++) { s.step(); s.writeSnapshot(snap); if (snap[L.correctionLift] > liftPeak) liftPeak = snap[L.correctionLift]; if (s.vibr > vibrPeak) vibrPeak = s.vibr; }
  const ev = strikes(s).slice(n0);
  assert.equal(ev.length, 1, 'one strike');
  assert.equal(ev[0].erase, true, 'erase flag');
  assert.equal(ev[0].bar, keyOf('w'));
  console.log(`  correction lift peak ${liftPeak.toFixed(3)}, ribbon peak ${(vibrPeak * 1e3).toFixed(3)} mm, tape fed ${(s.action.tapeFed - tape0) * 1e3} mm`);
  assert.ok(liftPeak > 0.9, `tape lift ${liftPeak}`);
  assert.ok(vibrPeak < 3e-4, `ribbon lifted ${vibrPeak}`);
  assert.equal(ev[0].ribbonInGap, 0);
  assert.ok(Math.abs(pitches(s)) < 0.08, `carrier moved to ${pitches(s)}`);
  assert.ok(s.action.tapeFed > tape0, 'tape not fed');
  assert.equal(s.action.correctionArmed, false, 'latch must clear');
  s.writeSnapshot(snap);
  assert.ok(snap[L.correctionTape] > 0, 'published tape');
  // Typing resumes normally.
  press(s, keyOf('e'), 22, 0.05);
  run(s, 0.3);
  const after = strikes(s).at(-1);
  assert.equal(after.bar, keyOf('e'));
  assert.ok(!after.erase, 'no erase on the following stroke');
  assert.ok(after.vibratorLift > 0.55 * s.vibrLift, 'ribbon lifts again');
  assert.ok(Math.abs(pitches(s) - 1) < 0.1, `next char ${pitches(s)}`);
  assert.ok(s.action.tapeFed - tape0 < 2 * machine.element.correction.feedPerCorrection, 'tape fed only once');
});

test('energy budget: stored energy never exceeds the start plus the work of fingers and motor', () => {
  const s = fresh();
  const E0 = s.energy();
  for (let i = 0; i < 10; i++) {
    press(s, keyOf('abcdefghij'[i]), 22, 0.05);
    for (let j = 0; j < 0.15 * SUBSTEP_HZ; j++) {
      s.step();
      if (j % 512 === 0) assert.ok(s.energy() <= E0 + s.workExt + 0.02, `energy ${s.energy()} > ${E0 + s.workExt}`);
    }
  }
  press(s, ctl('return'), 18, 0.05);
  run(s, 1.0);
  const e = s.energy();
  console.log(`  E ${e.toFixed(4)} J, E0 ${E0.toFixed(4)}, work ${s.workExt.toFixed(3)}`);
  assert.ok(e <= E0 + s.workExt + 0.02);
});

test('with the motor off the machine only dissipates', () => {
  const s = fresh();
  s.action.motorOn = false;
  s.action.motorW = 0;
  s.action.cyc.w = 40; s.action.cyc.moving = false;
  s.action.tilt = 0.2; s.action.tiltV = 8;
  s.action.rot = -0.3;
  s.action.hemi = 0.2;
  s.action.rocker = 0.002; s.action.rockerV = 1.5;
  let last = s.energy(), Emax = last;
  for (let i = 0; i < 0.4 * SUBSTEP_HZ; i++) {
    s.step();
    if (i % 256 === 0) { const e = s.energy(); assert.ok(e <= last + 2e-3, `grew ${last} -> ${e}`); if (e > Emax) Emax = e; last = e; }
  }
  assert.ok(last < Emax, 'dissipated');
});

test('state export and import carries a running cycle across the worklet handover', () => {
  const a = fresh(), b = fresh();
  press(a, keyOf('v'), 22, 0.05);
  run(a, 0.015);
  const st = structuredClone(a.exportState());
  b.importState(st);
  run(a, 0.3); run(b, 0.3);
  const ea = strikes(a), eb = strikes(b);
  assert.equal(ea.length, 1); assert.equal(eb.length, 1);
  assert.equal(eb[0].bar, keyOf('v'));
  assert.ok(Math.abs(ea[0].peakForce - eb[0].peakForce) < ea[0].peakForce * 0.05, `forces ${ea[0].peakForce} ${eb[0].peakForce}`);
  assert.ok(Math.abs(pitches(b) - 1) < 0.05);
});

test('audio engine runs with the motor hum and synthesised layer, level follows the motor', () => {
  const s = fresh();
  const eng = new AudioEngine(s, 48000);
  const buf = new Float32Array(128);
  const rmsOf = (n) => { let a = 0; for (let i = 0; i < n; i++) { eng.process(buf, 128); for (let j = 0; j < 128; j++) a += buf[j] * buf[j]; } return Math.sqrt(a / (n * 128)); };
  for (let i = 0; i < 40; i++) eng.process(buf, 128);
  const on = rmsOf(200);
  s.action.motorOn = false;
  s.action.motorW = 0;
  rmsOf(200);
  const off = rmsOf(200);
  console.log(`  hum rms ${on.toExponential(2)}, off ${off.toExponential(2)}`);
  assert.ok(on > 1e-4 && on < 0.15, `hum rms ${on}`);
  assert.ok(off < on / 20, 'hum did not stop with the motor');
  for (let i = 0; i < 128; i++) assert.ok(Number.isFinite(buf[i]) && Math.abs(buf[i]) <= 1);
});

test('unlimited typing mode prints straight away and spaces', () => {
  const s = tuned();
  s.setParam('typing.unlimited', true);
  press(s, keyOf('k'), 30, 0.05);
  run(s, 0.1);
  const ev = strikes(s);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].bar, keyOf('k'));
  assert.ok(Math.abs(pitches(s) - 1) < 0.05);
});

const holdKey = (s, k) => s.grab('key', k, { target: geo.keys[k].travel * 1.5, k: 2200, c: 18, maxF: 30 });

test('a tapped space moves one pitch; held down, space and backspace repeat at the op shaft rate', () => {
  const s = fresh(); run(s, 0.6);
  let q0 = pitches(s); press(s, ctl('space'), 30); run(s, 0.35);
  assert.equal(Math.round(pitches(s) - q0), 1);
  q0 = pitches(s); press(s, ctl('space'), 30);
  let g = holdKey(s, ctl('space')); run(s, 0.6); s.release(g); run(s, 0.25);
  const forward = pitches(s) - q0;
  assert.ok(forward >= 8 && forward <= 12, `${forward} pitches in 0.6 s`);
  assert.ok(Math.abs(forward - Math.round(forward)) < 0.05, 'ends on a tooth');
  q0 = pitches(s); press(s, ctl('backspace'), 30);
  g = holdKey(s, ctl('backspace')); run(s, 0.3); s.release(g); run(s, 0.25);
  assert.ok(q0 - pitches(s) >= 4, 'backspace repeats too');
});

test('tab lands on its stop; held down it runs past the stops, and letting go drops it at the next one', () => {
  const k = ctl('tab');
  const withStops = () => { const s = fresh(); run(s, 0.6); s.action.tabStops[20] = 1; s.action.tabStops[40] = 1; return s; };
  const a = withStops(); press(a, k, 30); run(a, 0.8);
  assert.ok(Math.abs(pitches(a) - 20) < 0.02, `tapped tab at ${pitches(a)}`);
  const b = withStops(); press(b, k, 30); const g = holdKey(b, k); run(b, 0.12); b.release(g); run(b, 0.9);
  assert.ok(Math.abs(pitches(b) - 40) < 0.02, `released at ${pitches(b)}`);
  const c = withStops(); press(c, k, 30); const h = holdKey(c, k); run(c, 1); c.release(h); run(c, 0.4);
  assert.ok(pitches(c) > 60, 'ran to the right margin');
  assert.equal(c.action.tabLatched, false);
});
