// The word processor's printwheel printer, headless (milestone M5; architecture.md 6.6 and 12.1). The whole
// mechanism runs in Node: characters reach the paper because the wheel, carrier, hammer and platen moved there,
// and the controller only switched phases and coil currents.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import wordproc1980 from '../src/machine/wordproc1980.js';
import { geometryFor } from '../src/machine/index.js';
import { loadGlyphs } from '../src/machine/glyphs.js';
import { WordprocSim } from '../src/sim/wp/index.js';
import { makeLayout } from '../src/sim/layout.js';
import { createMechanism } from '../src/sim/host-factory.js';
import { createSimClient } from '../src/sim/client.js';
import { FACE_TABLE_N } from '../src/sim/faces.js';
import { Bench, forceGroups, groupEnergies, brakeCurve, seatTime, fireOnce } from '../src/sim/wp/calibrate.js';

const glyphs = await loadGlyphs('glyphs_wp');
const P = wordproc1980.printer;
const ORDER = P.wheel.order;
const STEP = 0.0254 / 240;                 // escapement step, m
const LINE = 0.0254 / 96;                  // index step at the platen surface, m
const HOME = P.carrier.home;
const KEYBOARD = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890°±!@#$%¢&*()_-+=¼½[]:;"\'³²¶§,.?/';

// setParam writes through to the machine object, so each sim gets its own copy.
function fresh(opts = {}) {
  const machine = structuredClone(wordproc1980);
  return new WordprocSim({ machine, geometry: geometryFor(machine), glyphs, ...opts });
}

/** Plays the software's part: keeps the FIFO topped up and collects what comes back. */
class Run {
  constructor(sim) { this.sim = sim; this.queue = []; this.events = []; }
  send(words) { this.queue.push(...words); this.feed(); return this; }
  feed() {
    const room = 32 - this.sim.printerCtl.fifo.length;
    if (room > 0 && this.queue.length) this.sim.command({ dev: 'printer', words: this.queue.splice(0, room) });
  }
  drain() { const o = []; this.sim.drainEvents(o); this.events.push(...o); }
  /** Step for up to `seconds`, or until done() is true. */
  run(seconds, done, each) {
    const sim = this.sim, n = Math.round(seconds / sim.h);
    for (let i = 0; i < n; i++) {
      sim.step();
      if (each) each(sim);
      if ((i & 255) === 0) { this.feed(); this.drain(); if (done?.(this)) return true; }
    }
    this.drain();
    return false;
  }
  get strikes() { return this.events.filter((e) => e.type === 'strike'); }
  get errors() { return this.events.filter((e) => e.type === 'device' && e.ev === 'error'); }
  idle() { const c = this.sim.printerCtl; return !this.queue.length && !c.fifo.length && !c.busy() && c.ci >= c.chars.length; }
}

const petal = (ch) => ORDER.indexOf(ch);
/** Words for petals at a pitch (steps), the first `lead` steps from the present position; left if pitch < 0. */
function line(petals, pitch, lead = pitch) {
  const esc = (n) => 0x2000 | (n < 0 ? 0x800 | -n : n);
  return petals.flatMap((p, i) => [esc(i ? pitch : lead), 0x1000 | p]);
}
/** Words for text at 10 pitch: a space is a 24-step escape folded into the next character's. */
function text(s, pitch = 24) {
  const w = [];
  let gap = 0;
  for (const ch of s) {
    if (ch === ' ') { gap += pitch; continue; }
    w.push(0x2000 | (gap + pitch), 0x1000 | petal(ch));
    gap = 0;
  }
  return w;
}
const xOf = (s) => -s.carriageX;
/** Characters per second over a run of strikes, leaving out the first few (the run-up from rest). */
function cps(strikes, skip = 4) {
  const s = strikes.slice(skip);
  return (s.length - 1) / (s[s.length - 1].tBegin - s[0].tBegin);
}
const PROSE = 'It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness';

// ---- definition, geometry, stability ------------------------------------------------------------------------------

test('the wheel carries the 96-character keyboard, home is a, and common letters sit near home', () => {
  assert.equal(ORDER.length, 96);
  assert.equal(ORDER[0], 'a');
  assert.deepEqual([...new Set(ORDER)].sort(), [...KEYBOARD].sort());
  for (const ch of KEYBOARD) assert.ok(glyphs.chars.includes(ch), `face for ${ch}`);
  const dist = (ch) => { const p = ORDER.indexOf(ch); return Math.min(p, 96 - p); };
  assert.ok(dist('e') <= 1 && dist('t') <= 2 && dist('o') <= 2, 'e, t and o next to home');
  assert.ok(dist('z') > 20 && dist('§') > 30, 'rare characters far away');
});

test('geometry: the print point is on the platen front at axle height, and the snapshot shares the soft-body names', () => {
  const g = geometryFor(wordproc1980).printer;
  assert.deepEqual(g.printNormal, [0, 0, 1]);
  assert.ok(Math.abs(g.printPoint[1] - P.platen.center[1]) < 1e-12 && Math.abs(g.printPoint[2] - P.platen.center[2] - P.platen.radius) < 1e-12);
  assert.equal(g.nPrint, 96);
  // One index step is 1/96 in at the surface: 180 steps a motor turn, 2.8 motor turns a platen turn.
  assert.ok(Math.abs((2 * Math.PI * P.platen.radius) / (180 * 2.8) - LINE) < 1e-12);
  const sim = fresh(), L = sim.layout, T = makeLayout({ nKeys: 0, nPrint: 0 });
  for (const k of ['time', 'carriageX', 'carriageV', 'platenPsi', 'platenOmega', 'shiftY', 'vibratorLift', 'ribbonPawlTravel', 'ribbonSelector', 'paperRelease', 'bail', 'lastForce', 'rms', 'dspLoad']) {
    assert.ok(k in T && Number.isInteger(L[k]), k);
  }
  const s = new Float32Array(L.length);
  sim.writeSnapshot(s);
  assert.ok(Math.abs(s[L.carriageX] + HOME) < 1e-6, 'carriageX is minus the carrier position');
});

test('every stiff coupling is well inside the stability limit', () => {
  const h = 1 / 384000, W = P.wheel, H = P.hammer, C = P.carrier;
  const screwMass = C.rotorInertia / (C.lead / (2 * Math.PI)) ** 2;
  const sim = fresh(), f = sim.printer.faces;
  let kFace = 0;   // steepest slope of any face's force table
  for (let i = 0; i < f.n; i++) {
    const b = i * FACE_TABLE_N;
    for (let j = 1; j < FACE_TABLE_N; j++) kFace = Math.max(kFace, (f.force[b + j] - f.force[b + j - 1]) / f.dd);
  }
  const rows = [
    ['follower', C.followerStiffness, (C.mass * screwMass) / (C.mass + screwMass)],
    ['carrier stop', C.stopStiffness, C.mass],
    ['hammer pickup', H.pickupStiffness, W.petal.mass],
    ['hammer backstop', H.backstopStiffness, H.armatureMass],
    ['petal face (deepest)', kFace, W.petal.mass],
    ['selection hold', P.selection.peakTorque * W.rotorTeeth * (2 * Math.PI / 3), W.inertia],
    ['timing belt', P.index.beltStiffness, P.index.rotorInertia * P.index.beltRatio ** 2 * P.platen.inertia / (P.index.rotorInertia * P.index.beltRatio ** 2 + P.platen.inertia)],
    ['ribbon lift cam', P.ribbonFeed.lift.camStiffness, P.ribbonFeed.lift.mass],
    ['paper cam follower', P.cam.release.camStiffness, P.cam.release.inertia],
    ['panel key stop', P.panel.stopStiffness, P.panel.mass],
    ['cover stop', P.cover.stopStiffness, P.cover.inertia],
  ];
  for (const [name, k, m] of rows) assert.ok(Math.sqrt(k / m) * h < 0.6, `${name}: omega dt ${(Math.sqrt(k / m) * h).toFixed(3)}`);
});

// ---- throughput (6.6 item 3) --------------------------------------------------------------------------------------

test('a 10-pitch line of short wheel moves prints at the rated 60 cps, carrier limited', () => {
  const r = new Run(fresh()).send(line(Array.from({ length: 40 }, (_, i) => (i % 3 === 2 ? 95 : i % 3)), 24));
  r.run(1.2, (x) => x.strikes.length >= 40);
  assert.equal(r.strikes.length, 40);
  assert.equal(r.errors.length, 0, JSON.stringify(r.errors));
  const rate = cps(r.strikes);
  console.log(`  short moves: ${rate.toFixed(2)} cps`);
  assert.ok(Math.abs(rate - 60) <= 1, `${rate} cps`);
  // The carrier does not stop between characters: the escapement motor steps at its print rate.
  const gaps = r.strikes.slice(5).map((s, i) => s.tBegin - r.strikes[4 + i].tBegin);
  assert.ok(Math.max(...gaps) < 0.0175, `longest gap ${Math.max(...gaps)}`);
});

test('English prose prints at 45 to 60 cps (spaces counted), with no cancelled fire', () => {
  const r = new Run(fresh()).send(text(PROSE));
  const n = PROSE.replace(/ /g, '').length;
  r.run(3, (x) => x.strikes.length >= n);
  assert.equal(r.strikes.length, n);
  assert.equal(r.errors.length, 0, JSON.stringify(r.errors));
  const s = r.strikes, span = (xOf(s[s.length - 1]) - xOf(s[0])) / (24 * STEP);   // character positions passed
  const rate = span / (s[s.length - 1].tBegin - s[0].tBegin);
  console.log(`  prose: ${rate.toFixed(1)} cps`);
  assert.ok(rate >= 45 && rate <= 60, `${rate} cps`);
  // Each character landed on its own petal.
  assert.equal(s.map((e) => ORDER[e.bar]).join(''), PROSE.replace(/ /g, ''));
});

test('the worst alternation (half a turn every character) still prints at 30 cps or more, with no cancelled fire', () => {
  const r = new Run(fresh()).send(line(Array.from({ length: 24 }, (_, i) => (i % 2 ? 48 : 0)), 24));
  r.run(1.5, (x) => x.strikes.length >= 24);
  assert.equal(r.strikes.length, 24);
  assert.equal(r.errors.length, 0, JSON.stringify(r.errors));
  const rate = cps(r.strikes, 2);
  console.log(`  worst alternation: ${rate.toFixed(1)} cps`);
  assert.ok(rate >= 30, `${rate} cps`);
});

// ---- the tested rules of section 2 ---------------------------------------------------------------------------------

test('every strike is produced by contact, and without hammer force there is none', async () => {
  const r = new Run(fresh()).send(text('Strike me'));
  r.run(1, (x) => x.strikes.length >= 8);
  assert.equal(r.strikes.length, 8);
  assert.equal(r.sim.printer.strikes, 8, 'one face contact per strike event');
  for (const s of r.strikes) {
    const peak = Math.max(...s.trace.force);
    assert.ok(s.peakForce > 0 && s.maxIndent > 0 && s.duration > 0 && s.trace.force.length > 3, 'a real contact');
    assert.ok(Math.abs(peak - s.peakForce) / s.peakForce < 0.1, 'the trace is the contact force history');
    for (const k of ['bar', 'caseIndex', 'tBegin', 'duration', 'carriageX', 'platenPsi', 'shiftY', 'lateral', 'vImpact', 'peakForce', 'maxIndent', 'restitution', 'skewRad', 'vibratorLift', 'ribbonInGap']) assert.ok(k in s, `strike.${k}`);
  }
  // A coil that makes no force: the controller fires, nothing strikes, and it says so (error 60).
  const quiet = fresh();
  quiet.setParam('printer.hammer.forceConstant', 0);
  const q = new Run(quiet).send(text('ab'));
  q.run(0.3);
  assert.equal(q.strikes.length, 0);
  assert.ok(q.errors.some((e) => e.code === 60), 'no impact reported');
  // The controller has no way to make a strike: it imports nothing and emits only device events.
  const src = await readFile(new URL('../src/sim/wp/printer-ctl.js', import.meta.url), 'utf8');
  assert.ok(!/^import /m.test(src), 'printer-ctl.js imports nothing');
  assert.ok(!src.includes("'strike'") && !src.includes('emitEvent'), 'no strike from the controller');
});

test('no controller writes a mechanical state: it only commands drives and reads sensors', async () => {
  const sim = fresh(), ctl = sim.printerCtl;
  const drives = new Set(['setCarrier', 'setWheel', 'setIndex', 'setRibbon', 'setHammer', 'setCam']);
  const sensors = new Set(['encoder', 'pickup', 'wheelSpeed', 'wheelHome', 'camReeds', 'coverClosed', 'panelKey', 'powered', 'ribbonLeft', 'paperAtSensor', 'paperPresent']);
  assert.ok(Object.isFrozen(ctl.io), 'io is frozen');
  assert.deepEqual(new Set(Object.keys(ctl.io)), new Set([...drives, ...sensors]));
  const used = new Set();
  ctl.io = new Proxy(ctl.io, {
    get: (o, k) => { used.add(k); return o[k]; },
    set: () => { throw new Error('the controller wrote to io'); },
  });
  const r = new Run(sim).send([...text('Moves by force'), 0x3010, ...line([1, 2, 3], -24, 0)]);
  // The carrier follows its screw: carrier and nut never part by more than a step and a half, which is what the
  // follower's spring gives when a full step starts it from rest.
  let worst = 0;
  r.run(1.2, (x) => x.strikes.length >= 15, (s) => {
    const p = s.printer, xs = P.carrier.home + p.screw.th * (P.carrier.lead / (2 * Math.PI));
    worst = Math.max(worst, Math.abs(xs - p.xc));
  });
  assert.equal(r.strikes.length, 15);
  for (const k of used) assert.ok(drives.has(k) || sensors.has(k), `io.${k}`);
  assert.ok(worst < 1.5 * STEP, `carrier and nut apart by ${worst}`);
  const src = await readFile(new URL('../src/sim/wp/printer-ctl.js', import.meta.url), 'utf8');
  assert.ok(!/\b(mech|printer)\.(xc|vc|th|w|psi|xa|va|xp|lift|cover|power)\b\s*=/.test(src), 'no position assignment');
});

// ---- selection --------------------------------------------------------------------------------------------------

test('the wheel takes the shortest way and seats within a quarter step at every impact', () => {
  const seq = [0, 95, 50, 2, 47, 49, 0, 48, 10];
  const r = new Run(fresh());
  const path = [];
  r.send(line(seq, 24));
  r.run(1.5, (x) => x.strikes.length >= seq.length, (s) => { if ((Math.round(s.t / s.h) & 31) === 0) path.push([s.t, s.printer.sel.th / s.printer.sel.step]); });
  const st = r.strikes;
  assert.equal(st.length, seq.length);
  assert.deepEqual(st.map((s) => s.bar), seq);
  let unwrapped = 0;
  for (let i = 1; i < seq.length; i++) {
    let d = (((seq[i] - seq[i - 1]) % 96) + 96) % 96;
    if (d > 48) d -= 96;
    const lo = Math.min(unwrapped, unwrapped + d) - 1, hi = Math.max(unwrapped, unwrapped + d) + 1;
    for (const [t, p] of path) if (t > st[i - 1].tBegin && t < st[i].tBegin) assert.ok(p >= lo && p <= hi, `move ${seq[i - 1]}->${seq[i]} went to ${p.toFixed(2)} outside ${lo}..${hi}`);
    unwrapped += d;
  }
  for (const s of st) assert.ok(Math.abs(s.selectionError) < (2 * Math.PI) / 96 / 4, `selection error ${s.selectionError}`);
  for (const s of st) assert.ok(Math.abs(s.lateral) < P.wheel.tipRadius * (2 * Math.PI) / 96 / 4);
});

// ---- registration, pitch, line feed ---------------------------------------------------------------------------------

test('strikes land within 0.03 mm of their columns, and print the same both ways within 0.05 mm', () => {
  const n = 20, r = new Run(fresh());
  r.send([...line(Array(n).fill(petal('e')), 24), 0x3010, ...line(Array(n).fill(petal('o')), -24, 0)]);
  r.run(2, (x) => x.strikes.length >= 2 * n);
  assert.equal(r.strikes.length, 2 * n);
  assert.equal(r.errors.length, 0);
  const right = r.strikes.slice(0, n), left = r.strikes.slice(n).reverse();
  let worst = 0, worstBi = 0;
  for (let c = 0; c < n; c++) {
    const want = HOME + (c + 1) * 24 * STEP;
    worst = Math.max(worst, Math.abs(xOf(right[c]) - want), Math.abs(xOf(left[c]) - want));
    worstBi = Math.max(worstBi, Math.abs(xOf(right[c]) - xOf(left[c])));
  }
  console.log(`  column error ${(worst * 1e3).toFixed(4)} mm, bidirectional ${(worstBi * 1e3).toFixed(4)} mm`);
  assert.ok(worst < 0.03e-3, `column error ${worst}`);
  assert.ok(worstBi < 0.05e-3, `bidirectional ${worstBi}`);
  // The line between them is one 6 lpi line feed: 16 index steps of 1/96 in.
  const dPsi = left[0].platenPsi - right[0].platenPsi;
  assert.ok(Math.abs(dPsi * P.platen.radius - 16 * LINE) < 0.01 * LINE, `line feed ${dPsi * P.platen.radius}`);
});

test('pitch steps are 1/240 in: 10, 12 and 15 pitch columns', () => {
  for (const pitch of [24, 20, 16]) {
    const r = new Run(fresh()).send(line(Array(12).fill(1), pitch));
    r.run(0.8, (x) => x.strikes.length >= 12);
    const s = r.strikes;
    const mean = (xOf(s[11]) - xOf(s[3])) / 8;
    assert.ok(Math.abs(mean - pitch * STEP) < 0.002e-3, `${pitch} steps: ${mean}`);
  }
});

test('a 16-step line feed takes no more than 66 ms', () => {
  const sim = fresh(), r = new Run(sim);
  const psi0 = sim.printer.psi, target = psi0 + (16 * LINE) / P.platen.radius;
  r.send([0x3010, 0x6002]);
  const t0 = sim.t;
  let settled = Infinity;   // when the platen came within 5 % of a step of the line and stayed
  r.run(0.15, null, (s) => {
    const near = Math.abs(s.printer.psi - target) * P.platen.radius < 0.05 * LINE && Math.abs(s.printer.psiV) * P.platen.radius < 2e-3;
    if (!near) settled = Infinity; else if (settled === Infinity) settled = s.t - t0;
  });
  console.log(`  16-step line feed: ${(settled * 1e3).toFixed(1)} ms`);
  assert.ok(settled <= 0.066, `${settled}`);
  assert.ok(r.events.some((e) => e.ev === 'done'), 'end of data reported');
});

// ---- hammer -------------------------------------------------------------------------------------------------------

test('the flight-time servo pulls a 20 % on-time error in: within 5 % of target by the eighth strike', () => {
  const sim = fresh(), ctl = sim.printerCtl;
  ctl.tOn = ctl.tOn.map((x) => x * (1 + P.hammer.powerOnError));   // as after power-on
  const r = new Run(sim).send(line(Array(10).fill(petal('e')), 24));
  r.run(0.8, (x) => x.strikes.length >= 10);
  const target = P.calibration.groups[1].flightTarget;
  const f = [];
  for (let i = 0; i < ctl.flights.length; i += 2) if (ctl.flights[i] === 1) f.push(ctl.flights[i + 1]);
  console.log(`  flight errors (%): ${f.map((x) => ((x / target - 1) * 100).toFixed(1)).join(' ')}`);
  assert.ok(Math.abs(f[0] / target - 1) > 0.05, 'the first strikes are off');
  for (const x of f.slice(7)) assert.ok(Math.abs(x / target - 1) < 0.05, `${x} against ${target}`);
});

test('face pressures sit in the ink window and under perforation', () => {
  const r = new Run(fresh()).send(text('Mm Ww .,:; @% Il|i'.replace('|', '!')));
  r.run(1.2, (x) => x.idle() && x.strikes.length > 0);
  for (const s of r.strikes) {
    assert.ok(s.peakPressure > 0.8 * P.paper.inkHalfPressure, `${ORDER[s.bar]} ${s.peakPressure}`);
    assert.ok(s.peakPressure < P.paper.perforationPressure, `${ORDER[s.bar]} ${s.peakPressure}`);
  }
});

// ---- carrier ---------------------------------------------------------------------------------------------------

test('no lost carrier steps in 1000 random moves of up to half an inch, at slew speed', () => {
  const sim = fresh(), ctl = sim.printerCtl;
  let seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  let lost = 0;
  for (let i = 0; i < 1000; i++) {
    const d = 1 + Math.floor(rand() * 120), to = ctl.S + (ctl.S + d > 3000 || (ctl.S - d >= 0 && rand() < 0.5) ? -d : d);
    ctl.moveTo(sim.t, to);
    while (ctl.prof) sim.step();
    for (let k = 0; k < 0.01 / sim.h; k++) sim.step();
    // A lost step is a whole step (four make an electrical cycle); the encoder reads half steps.
    if (Math.abs(sim.printer.encoder() / 2 - ctl.S) >= 1) lost++;
  }
  assert.equal(lost, 0);
});

test('opening the cover while printing stops the carrier at once and reports 06', () => {
  const sim = fresh(), r = new Run(sim).send(text('The cover opens part way through this line'));
  r.run(0.2);
  const before = r.strikes.length;
  assert.ok(before > 3);
  const g = sim.grab('printerCover', 0, { target: 0.6 });
  r.run(0.1);
  assert.ok(r.errors.some((e) => e.code === 6), 'error 06');
  assert.ok(sim.printerCtl.posLost && !sim.printerCtl.ready);
  const x = sim.printer.xc;
  r.run(0.1);
  assert.ok(Math.abs(sim.printer.xc - x) < 1e-6 && Math.abs(sim.printer.vc) < 1e-3, 'carrier stopped');
  assert.ok(r.strikes.length <= before + 1, 'no printing with the cover open');
  sim.release(g);
});

// ---- ribbon, paper, panel, power -----------------------------------------------------------------------------------

test('the ribbon feeds a third of 0.37 mm per character and lifts through its three tracks', () => {
  const r = new Run(fresh()).send(line(Array(6).fill(1), 24));
  const lifts = [];
  r.run(0.6, (x) => x.strikes.length >= 6);
  r.run(0.05);
  for (const s of r.strikes) lifts.push(Math.abs(Math.round(s.vibratorLift / P.ribbonFeed.lift.trackPitch)));
  assert.deepEqual(lifts, [0, 1, 2, 0, 1, 2]);
  assert.ok(Math.abs(r.sim.printer.ribbonFed() - 6 * 0.00037 / 3) < 0.02e-3, `fed ${r.sim.printer.ribbonFed()}`);
});

test('PAPER bail open and close turn the cam to its positions and move the bail', () => {
  const sim = fresh(), r = new Run(sim).send([0x5003]);
  r.run(0.6, (x) => x.events.some((e) => e.ev === 'paper'));
  assert.ok(Math.abs(sim.printer.bail - P.cam.bail.table[4]) < 0.02, `bail ${sim.printer.bail}`);
  assert.equal(sim.printerCtl.camPos, 4);
  r.events.length = 0;
  r.send([0x5004]);
  r.run(0.6, (x) => x.events.some((e) => e.ev === 'paper'));
  assert.ok(Math.abs(sim.printer.bail) < 0.02 && sim.printerCtl.camPos === 0 && sim.printer.camReeds().home);
  assert.equal(r.errors.length, 0);
});

test('Paper Up moves 1/48 in on a press, and keeps going while held', () => {
  const sim = fresh(), r = new Run(sim);
  const g = sim.grab('panelKey', 6, { target: P.panel.travel * 1.2 });
  r.run(0.1);
  assert.equal(sim.printerCtl.idxS, 2);
  r.run(0.6);
  sim.release(g);
  r.run(0.1);
  assert.ok(sim.printerCtl.idxS >= 2 + 14 + 16, `held: ${sim.printerCtl.idxS}`);
});

test('cold start: switched on, it tests itself, homes, and prints where it should after Start', () => {
  const sim = fresh({ cold: true }), r = new Run(sim), ctl = sim.printerCtl;
  r.run(0.05);
  assert.equal(ctl.on, false);
  const g = sim.grab('printerPower', 0, { target: P.power.travel });
  r.run(0.1); sim.release(g);
  assert.ok(ctl.on && ctl.selfTest, 'self-test running');
  r.run(16, () => !ctl.selfTest);
  assert.ok(sim.t > 14.9 && sim.t < 15.6, `self-test took ${sim.t} s`);
  assert.equal(ctl.selfTest, null);
  assert.equal(ctl.err, 0);
  assert.ok(Math.abs(sim.printer.xc - HOME) < 2 * STEP, `homed to ${sim.printer.xc}`);
  const k = sim.grab('panelKey', 0, { target: P.panel.travel * 1.2 });
  r.run(0.05); sim.release(k);
  assert.ok(ctl.ready && ctl.online);
  r.send(line([petal('x')], 48));
  r.run(0.3, (x) => x.strikes.length > 0);
  assert.equal(r.strikes.length, 1);
  assert.equal(ORDER[r.strikes[0].bar], 'x');
  // The hammer's on-times start off after power-on (6.5), so the first characters land a little early or late.
  assert.ok(Math.abs(xOf(r.strikes[0]) - (HOME + 48 * STEP)) < 0.1e-3, `x ${xOf(r.strikes[0]) - HOME - 48 * STEP}`);
});

// ---- state transfer, host ---------------------------------------------------------------------------------------

test('export and import mid-line continues identically', () => {
  const a = fresh(), words = text('Same again');
  a.command({ dev: 'printer', words });
  for (let i = 0; i < 0.07 * 384000; i++) a.step();
  a.drainEvents([]);
  const b = fresh();
  b.importState(structuredClone(a.exportState()));
  const ea = [], eb = [];
  for (let i = 0; i < 0.12 * 384000; i++) { a.step(); b.step(); }
  a.drainEvents(ea); b.drainEvents(eb);
  const sa = ea.filter((e) => e.type === 'strike'), sb = eb.filter((e) => e.type === 'strike');
  assert.ok(sa.length >= 3, `${sa.length} strikes after the transfer`);
  assert.equal(sb.length, sa.length);
  for (let i = 0; i < sa.length; i++) {
    for (const k of ['bar', 'tBegin', 'carriageX', 'peakForce', 'maxIndent', 'platenPsi']) assert.equal(sb[i][k], sa[i][k], `${k} of strike ${i}`);
  }
  assert.equal(b.printer.xc, a.printer.xc);
});

test('the host factory builds the word processor host, and the client carries strikes and device events', async () => {
  const machine = structuredClone(wordproc1980), geometry = geometryFor(machine);
  assert.ok(createMechanism({ machine, geometry, glyphs }) instanceof WordprocSim);
  const client = await createSimClient({ machine, geometry, glyphs, autoRun: false });
  const strikes = [], device = [];
  client.on('strike', (e) => strikes.push(e)).on('device', (e) => device.push(e));
  client.command({ dev: 'printer', words: text('ok') });
  client.advance(0.25);
  assert.equal(strikes.length, 2);
  assert.ok(device.some((e) => e.ev === 'credit' && e.n > 0));
  assert.ok(Math.abs(client.state[client.layout.carriageX] - strikes[1].carriageX) < 0.01);
});

// ---- calibration ----------------------------------------------------------------------------------------------------

test('the definition matches what the calibration tool computes', () => {
  const machine = structuredClone(wordproc1980), cal = machine.printer.calibration;
  const bench = new Bench(machine, glyphs);
  assert.deepEqual(forceGroups(machine.printer, glyphs), cal.petalGroups);
  groupEnergies(bench, cal.petalGroups).forEach((G, g) => {
    assert.ok(Math.abs(G.energy / cal.groups[g].energy - 1) < 1e-6, `group ${g} energy`);
    assert.ok(G.smallestPressure < machine.printer.paper.perforationPressure, `group ${g} smallest face`);
  });
  const curve = brakeCurve(machine.printer, cal.brakeScale);
  curve.forEach((v, i) => assert.ok(Math.abs(v - cal.brakeCurve[i]) < 1e-6 * (1 + v)));
  for (const n of [1, 24, 48]) assert.ok(Math.abs(seatTime(bench, n) - cal.moveTime[n]) < 1e-9, `move ${n}`);
  const g = 1, med = groupEnergies(bench, cal.petalGroups)[g].median;
  const shot = fireOnce(bench, med, cal.groups[g].current, cal.groups[g].tOn);
  assert.ok(Math.abs(shot.vIn / cal.groups[g].speed - 1) < 0.01, `impact speed ${shot.vIn}`);
  assert.ok(Math.abs(shot.flight - cal.groups[g].flightTarget) < 3 / 384000, 'flight target');
  // 6.6 item 1: a 24-step move, its settle and a medium flight in 15.0 +/- 0.3 ms.
  assert.ok(Math.abs(cal.moveTime[24] + cal.groups[1].flightTarget - 0.015) <= 0.0003);
});
