// Choosing the printer's missing numbers (architecture.md 6.6) by running the headless mechanism on a bench. Used by
// tools/wp/calibrate_printer.mjs, which writes src/machine/wp-printer-cal.js, and by the test that checks the
// definition still matches what the tool computes. Every figure here is measured from the integrated mechanism.
import { FACE_TABLE_N } from '../faces.js';
import { deriveWordprocGeometry } from '../../machine/wp-geometry.js';
import { WordprocSim } from './index.js';

/** A printer on the bench: a host whose initial state can be restored between trials. */
export class Bench {
  constructor(machine, glyphs) {
    this.m = machine;
    this.sim = new WordprocSim({ machine, geometry: deriveWordprocGeometry(machine), glyphs });
    this.s0 = this.sim.exportState();
  }
  get ctl() { return this.sim.printerCtl; }
  get mech() { return this.sim.printer; }
  get cal() { return this.m.printer.calibration; }
  reset() { this.sim.importState(this.s0); this.sim.drainEvents([]); }
  /** Step until pred() or `max` seconds; returns the time taken, or Infinity. */
  until(pred, max) {
    const sim = this.sim, t0 = sim.t, n = Math.round(max / sim.h);
    for (let i = 0; i < n; i++) { sim.step(); if (pred()) return sim.t - t0; }
    return Infinity;
  }
  run(seconds) { this.until(() => false, seconds); }
}

// ---- 1. selection ----------------------------------------------------------------------------------------------
const SAMPLE_MOVES = [1, 2, 3, 5, 8, 13, 19, 24, 31, 40, 48];

/** Time for an n-step move from rest to seated. */
export function seatTime(bench, n) {
  bench.reset();
  bench.ctl.selectFor(bench.sim.t, n);
  return bench.until(() => bench.ctl.selSeated, 0.05);
}

/**
 * Braking speed against steps still to go, sqrt(2 a r) scaled by f, where a is the deceleration the motor's mean
 * single-phase torque (0.83 of peak) gives the rotor, wheel and damper ring.
 */
export function brakeCurve(printer, f) {
  const W = printer.wheel, step = (2 * Math.PI) / W.petals;
  const a = (0.83 * printer.selection.peakTorque) / (W.inertia + W.damper.inertia) / step;
  return Array.from({ length: 49 }, (_, r) => f * Math.sqrt(2 * a * r));
}

/** The scale of the braking curve that seats a spread of move lengths soonest on average; installs it. */
export function tuneBrakeCurve(bench) {
  const P = bench.m.printer;
  let best = { f: 1, mean: Infinity };
  for (let k = 6; k <= 24; k++) {
    const f = k / 20;
    P.calibration.brakeCurve = brakeCurve(P, f);
    const mean = SAMPLE_MOVES.reduce((s, n) => s + seatTime(bench, n), 0) / SAMPLE_MOVES.length;
    if (mean < best.mean) best = { f, mean };
  }
  P.calibration.brakeScale = best.f;
  P.calibration.brakeCurve = brakeCurve(P, best.f);
  return best;
}

// ---- 2. hammer -----------------------------------------------------------------------------------------------------
/**
 * Force group of every petal: the manual's lists (MIM p.117-118), and for a character it does not list, the group
 * whose median face area is nearest its own.
 */
export function forceGroups(printer, glyphs) {
  const order = [...printer.wheel.order], lists = printer.hammer.groups;
  const area = (ch) => glyphs.faceAreaMm2[glyphs.chars.indexOf(ch)];
  const listed = order.map((ch) => lists.findIndex((l) => l.includes(ch)));
  const median = lists.map((_, g) => medianOf(order.filter((ch, p) => listed[p] === g).map(area)));
  return order.map((ch, p) => (listed[p] >= 0 ? listed[p] : nearest(median, area(ch))));
}

/** Petal of a group whose face area is the group's median, and of its smallest face. */
export function groupFaces(printer, glyphs, groups, g) {
  const order = [...printer.wheel.order], area = (p) => glyphs.faceAreaMm2[glyphs.chars.indexOf(order[p])];
  const petals = order.map((_, p) => p).filter((p) => groups[p] === g).sort((a, b) => area(a) - area(b));
  return { median: petals[Math.floor(petals.length / 2)], smallest: petals[0] };
}

/** Indentation at which a face has absorbed energy E (from the face tables, J), and the energy at an indentation. */
function indentForEnergy(faces, petal, E) {
  const base = petal * 2 * FACE_TABLE_N, e = faces.energy;
  for (let j = 1; j < FACE_TABLE_N; j++) {
    if (e[base + j] >= E) return (j - 1 + (E - e[base + j - 1]) / (e[base + j] - e[base + j - 1])) * faces.dd;
  }
  return FACE_TABLE_N * faces.dd;
}
function energyAtIndent(faces, petal, d) {
  const base = petal * 2 * FACE_TABLE_N, j = Math.min(FACE_TABLE_N - 2, Math.floor(d / faces.dd)), f = d / faces.dd - j;
  return faces.energy[base + j] * (1 - f) + faces.energy[base + j + 1] * f;
}

/**
 * Impact energy per group (6.6 item 2): the energy at which the group's median face reaches inkPressureFactor x the
 * paper's half-ink pressure, and the peak pressure that energy gives the group's smallest face.
 */
export function groupEnergies(bench, groups) {
  const P = bench.m.printer, faces = bench.mech.faces, glyphs = bench.mech.glyphs;
  const target = (P.hammer.inkPressureFactor * P.paper.inkHalfPressure) / faces.kf;
  return P.hammer.groups.map((_, g) => {
    const { median, smallest } = groupFaces(P, glyphs, groups, g);
    const energy = energyAtIndent(faces, median, target);
    const speed = Math.sqrt((2 * energy) / (P.hammer.armatureMass + P.wheel.petal.mass));
    return { energy, speed, median, smallest, smallestPressure: faces.kf * indentForEnergy(faces, smallest, energy) };
  });
}

/** Fire the hammer at a seated petal with current I for tOn; what the impact sensor and the strike report. */
export function fireOnce(bench, petal, current, tOn) {
  bench.reset();
  const { sim, ctl, mech } = bench;
  ctl.selectFor(sim.t, petal);
  bench.until(() => ctl.selSeated, 0.05);
  bench.run(0.004);
  const t0 = sim.t;
  mech.setHammer(current);
  let tImpact = Infinity, tClear = Infinity;
  const irq = mech.irq, free = bench.m.printer.hammer.freeTravel;
  mech.irq = { encoder() {}, impact: (t) => { tImpact = t; }, rebound() {} };
  bench.until(() => sim.t - t0 >= tOn, 0.01);
  mech.setHammer(0);
  // Clear: the nose back behind the petals' plane, so the wheel may turn.
  bench.until(() => { if (tImpact < Infinity && mech.xa < free && mech.va < 0) tClear = sim.t; return tClear < Infinity; }, 0.01);
  bench.run(0.002);
  mech.irq = irq;
  const out = []; sim.drainEvents(out);
  const s = out.find((e) => e.type === 'strike');
  if (!s) return null;
  let k = 0;
  for (let i = 1; i < s.trace.force.length; i++) if (s.trace.force[i] > s.trace.force[k]) k = i;
  return { vIn: s.vImpact, flight: tImpact - t0, tPeak: k * s.trace.dt, clear: tClear - tImpact, strike: s };
}

/** On-time that brings the petal to the platen at `speed` with the group's current, by bisection. */
export function onTimeFor(bench, petal, current, speed) {
  let lo = 1e-4, hi = 4e-3;
  for (let i = 0; i < 26; i++) {
    const mid = 0.5 * (lo + hi), r = fireOnce(bench, petal, current, mid);
    if (!r || r.vIn < speed) lo = mid; else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/** The hammer's part of the calibration: per group energy, speed, on-time, flight target and its slope. */
export function calibrateHammer(bench, groups) {
  const P = bench.m.printer;
  return groupEnergies(bench, groups).map((G, g) => {
    const current = P.hammer.groupCurrents[g];
    const tOn = onTimeFor(bench, G.median, current, G.speed);
    const r = fireOnce(bench, G.median, current, tOn);
    const a = fireOnce(bench, G.median, current, tOn * 1.05), b = fireOnce(bench, G.median, current, tOn * 0.95);
    return {
      energy: G.energy, speed: G.speed, current, tOn, flightTarget: r.flight, tPeak: r.tPeak,
      dTonDFlight: (0.1 * tOn) / (a.flight - b.flight), clear: r.clear, smallestPressure: G.smallestPressure,
    };
  });
}

// ---- 3. the escapement's timing -----------------------------------------------------------------------------------
/** Words for a line of petals at a pitch (1/240 in), starting `lead` steps right of the present position. */
export function lineWords(petals, pitch, lead = pitch) {
  const w = [];
  petals.forEach((p, i) => { w.push(0x2000 | (i ? pitch : lead), 0x1000 | p); });
  return w;
}

/** Run words through the printer until `count` strikes; the strikes, and how late each impact was on its plan. */
function printLine(bench, words, count) {
  bench.reset();
  const { sim, ctl, mech } = bench, strikes = [], late = [];
  mech.irq = {
    encoder: (t, e) => ctl.encoder(t, e), rebound: (t) => ctl.rebound(t),
    impact: (t) => { if (ctl.ham === 1) late.push(t - ctl.chars[ctl.hamChar].impact); ctl.impact(t); },
  };
  let i = 0;
  const feed = () => { const room = 32 - ctl.fifo.length; if (room > 0 && i < words.length) { sim.command({ dev: 'printer', words: words.slice(i, i + room) }); i += room; } };
  bench.until(() => {
    if ((Math.round(sim.t / sim.h) & 255) === 0) { feed(); const o = []; sim.drainEvents(o); strikes.push(...o.filter((e) => e.type === 'strike')); }
    return strikes.length >= count;
  }, 6);
  mech.irq = ctl;
  return { strikes, late };
}

/**
 * Over a line each way at 10 pitch: the mean of (strike x - commanded x) along the direction of travel, in steps.
 * Over that and a line of half-turn wheel moves: the latest any impact came after its planned time (s).
 */
export function escapementTiming(bench, n = 30) {
  const step = 0.0254 / 240, home = bench.m.printer.carrier.home;
  const a = printLine(bench, [...lineWords(Array(n).fill(1), 24), 0x3010, ...lineWords(Array(n).fill(1), 0x800 | 24, 0)], 2 * n);
  const err = a.strikes.map((s, k) => {
    const col = k < n ? k + 1 : n - (k - n);
    return ((-s.carriageX - home) / step - col * 24) * (k < n ? 1 : -1);
  });
  const b = printLine(bench, lineWords(Array.from({ length: 12 }, (_, k) => (k % 2 ? 48 : 0)), 24), 12);
  return { error: err.reduce((x, y) => x + y, 0) / err.length, lag: Math.max(0, ...a.late, ...b.late) };
}

function medianOf(a) { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }
function nearest(values, x) { let k = 0; values.forEach((v, i) => { if (Math.abs(v - x) < Math.abs(values[k] - x)) k = i; }); return k; }
