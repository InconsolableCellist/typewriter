// The word processor's diskette unit, headless (milestone M7; architecture.md 8.3, 8.4 and 12.1). Both drives run in
// Node: a diskette is home because a hand pushed it against friction to its stop, it turns because the collet's
// friction drags it after the hub, and a transfer ends when its last sector has passed under a head the stepper
// carried there. The adapter only switched phases and the solenoid, and read the sensors.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import wordproc1980 from '../src/machine/wordproc1980.js';
import { geometryFor } from '../src/machine/index.js';
import { WordprocSim } from '../src/sim/wp/index.js';
import { WAC } from '../src/sim/wp/ports.js';
import { createSimClient } from '../src/sim/client.js';
import { DRIVE, seek, latency, transfer, RECALIBRATE_S } from '../src/wp/devices/timing.js';
import { MEDIA, sectorsPerTrack } from '../src/wp/disk/geometry.js';

const D = wordproc1980.diskettes;
const WORK = { mediaId: 'WORK01', type: '2D' };
const ROT = DRIVE.rotationS;
const CLOSED = D.lever.closed;

// setParam writes through to the machine object, so each sim gets its own copy.
function fresh(opts = {}) {
  const machine = structuredClone(wordproc1980);
  return new WordprocSim({ machine, geometry: geometryFor(machine), ...opts });
}

/** Steps the host and collects device events and acoustic events with their times. */
class Run {
  constructor(sim) { this.sim = sim; this.events = []; this.ac = []; }
  drain() {
    const s = this.sim, o = [];
    s.drainEvents(o);
    this.events.push(...o);
    for (let k = 0; k < s.acN; k++) this.ac.push({ type: s.acQ[3 * k], a: s.acQ[3 * k + 1], b: s.acQ[3 * k + 2], t: s.t });
    s.acN = 0;
  }
  /** Step for up to `seconds`, or until done() is true. */
  run(seconds, done, each) {
    const sim = this.sim, n = Math.round(seconds / sim.h);
    for (let i = 0; i < n; i++) {
      sim.step();
      if (each) each(sim);
      if ((i & 255) === 0) { this.drain(); if (done?.(this)) return true; }
    }
    this.drain();
    return false;
  }
  disk(pred = () => true) { return this.events.filter((e) => e.dev === 'disk' && pred(e)); }
  done(id) { return this.disk((e) => e.id === id)[0]; }
  /** Send a command and run until it completes. */
  op(msg, limit = 2) { this.sim.command({ dev: 'disk', ...msg }); this.run(limit, () => !!this.done(msg.id)); return this.done(msg.id); }
}

/** A hand puts a diskette in the guide's mouth and pushes it home, then turns the lever closed. */
function insertAndClose(r, i, media = WORK) {
  const sim = r.sim, mech = sim.diskette, d = mech.drives[i];
  sim.command({ dev: 'disk', op: 'media', drive: i, ...media });
  const g = sim.grab('disketteSlide', i, { target: mech.home + 0.005 });
  r.run(1, () => d.s > mech.home - 2e-4 && Math.abs(d.sv) < 1e-3);
  sim.release(g);
  let tSwitch = -1;
  const l = sim.grab('lever', i, { target: CLOSED + 0.1 });
  r.run(0.3, null, (s) => { if (tSwitch < 0 && s.diskette.leverClosed(i)) tSwitch = s.t; });
  sim.release(l);
  return tSwitch;
}

// ---- definition, geometry, stability ------------------------------------------------------------------------------

test('the drives are in the definition, the geometry and the snapshot', () => {
  const g = geometryFor(wordproc1980);
  assert.deepEqual(g.diskettes, { drives: 2 });
  const sim = fresh({ drives: [null, WORK] }), L = sim.layout;
  for (const k of ['lever', 'slide', 'clamp', 'diskOmega', 'diskAngle', 'headTrack', 'headLoad', 'motorOmega', 'diskReady']) {
    assert.ok(Number.isInteger(L[k]) && L[k] + 1 < L.length, k);
  }
  const s = new Float32Array(L.length);
  sim.writeSnapshot(s);
  assert.equal(s[L.slide], -1, 'no diskette in the left drive');
  assert.ok(Math.abs(s[L.slide + 1] - sim.diskette.home) < 1e-6 && Math.abs(s[L.lever + 1] - CLOSED) < 1e-6);
  assert.equal(s[L.diskReady + 1], 1);
  // One full step a track: 1.8 degrees of the stepper moves the carriage 1/48 in.
  assert.ok(Math.abs(D.head.pulleyRadius * (2 * Math.PI / D.head.stepsPerRev) - 0.0254 / 48) < 1e-12);
});

test('every stiff coupling is well inside the stability limit', () => {
  const h = 1 / 384000, H = D.head, rh = D.motor.pulleyRadius * D.belt.ratio;
  const Jhead = H.rotorInertia + H.carriageMass * H.pulleyRadius ** 2;
  const rows = [
    ['belt on the motor', D.belt.stiffness * D.motor.pulleyRadius ** 2, D.motor.inertia],
    ['belt on the hub', D.belt.stiffness * rh ** 2, D.hub.inertia],
    ['collet on the diskette', D.clamp.stickStiffness, D.disk.inertia],
    ['head stop pin', H.stopStiffness, Jhead],
    ['head stepper hold', H.holdingTorque * H.stepsPerRev / 4, Jhead],
    ['lever stops', D.lever.stopStiffness, D.lever.inertia],
    ['lever on a diskette edge', D.lever.contactStiffness * D.lever.tipRadius ** 2, D.lever.inertia],
    ['slide end stop', D.slide.stopStiffness, D.slide.mass],
    ['head-load pad', D.headLoad.padStiffness, D.headLoad.mass],
  ];
  for (const [name, k, m] of rows) assert.ok(Math.sqrt(k / m) * h < 0.6, `${name}: omega dt ${(Math.sqrt(k / m) * h).toFixed(3)}`);
});

test('a loaded diskette turns at 360 rpm and its index period is inside the accepted window', () => {
  const sim = fresh({ drives: [WORK, null] }), r = new Run(sim);
  r.op({ op: 'transfer', id: 1, drive: 0, side: 0, track: 37, sector: 1, count: 1 });
  const pulses = [];
  const irq = sim.diskette.irq;
  sim.diskette.irq = new Proxy(irq, { get: (o, k) => (k === 'index' ? (i, t) => { pulses.push(t); o.index(i, t); } : typeof o[k] === 'function' ? o[k].bind(o) : o[k]) });
  r.op({ op: 'transfer', id: 2, drive: 0, side: 0, track: 37, sector: 1, count: 26 });
  r.run(0.6);
  const rpm = (sim.diskette.drives[0].wd * 60) / (2 * Math.PI);
  assert.ok(Math.abs(rpm / 360 - 1) < 0.003, `${rpm} rpm with the head loaded`);
  assert.ok(pulses.length >= 4);
  for (let k = 1; k < pulses.length; k++) {
    const p = pulses[k] - pulses[k - 1];
    assert.ok(p >= D.adapter.minPeriod && p <= D.adapter.maxPeriod, `period ${p}`);
    assert.ok(Math.abs(p - ROT) < 0.0006, `period ${p} against ${ROT}`);
  }
});

test('cold: the motors start with the station and run up to speed through the start winding', () => {
  const sim = fresh({ cold: true }), r = new Run(sim), d = sim.diskette.drives[0];
  assert.equal(d.wm, 0);
  r.run(0.3);
  const warm = fresh().diskette.drives[0];
  assert.ok(Math.abs(d.wm / warm.wm - 1) < 1e-4, `${d.wm} rad/s against ${warm.wm}`);
  assert.ok(Math.abs(d.wh * D.belt.ratio - d.wm) < 1e-3, 'the belt carries the hub');
});

// ---- insertion and the lever ----------------------------------------------------------------------------------------

test('a diskette pushed into the guide stops at its end stop, and a light push does not move it', () => {
  const sim = fresh(), r = new Run(sim), mech = sim.diskette, d = mech.drives[1];
  sim.command({ dev: 'disk', op: 'media', drive: 1, ...WORK });
  assert.equal(d.s, 0);
  // Friction holds it against a push smaller than the guide's friction.
  let g = sim.grab('disketteSlide', 1, { target: 0.3, maxF: 0.8 * D.slide.friction });
  r.run(0.2);
  sim.release(g);
  assert.equal(d.s, 0, 'stuck by friction');
  g = sim.grab('disketteSlide', 1, { target: 0.3 });
  r.run(1);
  assert.ok(d.s > mech.home - 1e-4 && d.s < mech.home + 1e-3, `home at ${d.s}, stop at ${mech.home}`);
  assert.ok(r.ac.some((e) => e.type === WAC.SLIDE_HOME && e.a === 1 && e.b > 0.1), 'it meets the stop moving');
  sim.release(g);
  r.run(0.2);
  // Let go, it springs off the stop a little and friction holds it there, centred well enough for the collet.
  assert.ok(Math.abs(d.s - mech.home) < 1e-3 && mech.inPlace(d), `it stays home: ${d.s - mech.home}`);
  const s1 = d.s;
  r.run(0.2);
  assert.equal(d.s, s1);
  assert.equal(mech.mediaType(1), '2D');
  // Not taken away while it is in the guide.
  sim.command({ dev: 'disk', op: 'media', drive: 1, mediaId: null });
  assert.equal(d.media.mediaId, 'WORK01');
});

test('the lever cannot close on a half-inserted diskette', () => {
  const sim = fresh(), r = new Run(sim), d = sim.diskette.drives[0];
  sim.command({ dev: 'disk', op: 'media', drive: 0, ...WORK });
  const g = sim.grab('disketteSlide', 0, { target: 0.1 });
  r.run(0.5);
  sim.release(g);
  r.run(0.05);
  const s0 = d.s;
  assert.ok(s0 > 0.09 && s0 < 0.11);
  const l = sim.grab('lever', 0, { target: CLOSED + 0.2 });
  r.run(0.4);
  assert.ok(d.a < D.lever.blockAngle + 3 * Math.PI / 180, `lever stopped at ${(d.a * 180 / Math.PI).toFixed(1)} degrees`);
  assert.ok(Math.abs(d.s - s0) < 1e-3, 'the diskette did not move');
  assert.equal(sim.diskette.leverClosed(0), false);
  sim.release(l);
  r.run(0.4);
  assert.ok(d.a < 0.01, 'the detent takes it back open');
  assert.equal(r.disk((e) => e.ev === 'ready').length, 0);
});

test('the lever closes on an empty slot and stays closed, and then a diskette cannot get past it', () => {
  const sim = fresh(), r = new Run(sim), d = sim.diskette.drives[1];
  const l = sim.grab('lever', 1, { target: CLOSED + 0.1 });
  r.run(0.3);
  sim.release(l);
  r.run(0.3);
  assert.ok(Math.abs(d.a - CLOSED) < 0.02, `closed at ${d.a}`);
  assert.ok(sim.diskette.leverClosed(1));
  assert.ok(d.N > 10, 'the collet seats in the hub');
  assert.ok(r.ac.some((e) => e.type === WAC.LEVER && e.a === 1));
  assert.equal(sim.diskCtl.status(1).ready, false);
  sim.command({ dev: 'disk', op: 'media', drive: 1, ...WORK });
  const g = sim.grab('disketteSlide', 1, { target: 0.3 });
  r.run(0.4);
  assert.ok(d.s < D.slide.leverPlane + 1e-3, `stopped at the mouth: ${d.s}`);
  assert.ok(Math.abs(d.a - CLOSED) < 0.02, 'the lever holds');
  sim.release(g);
  assert.equal(r.disk((e) => e.ev === 'ready').length, 0);
});

test('closing the lever clamps the diskette, it spins up, and the drive is ready in under 0.6 s', () => {
  const sim = fresh(), r = new Run(sim), d = sim.diskette.drives[1];
  const tSwitch = insertAndClose(r, 1);
  assert.ok(tSwitch > 0, 'lever switch made');
  assert.ok(Math.abs(d.a - CLOSED) < 0.02);
  const C = D.clamp, nClosed = C.springRate * (C.colletTravel * Math.sin((Math.PI / 2 / C.peakAngle) * CLOSED) - C.clearance);
  assert.ok(Math.abs(d.N - nClosed) < 0.5, `clamp ${d.N} N`);
  // The collet dragged it up to the hub's speed while the lever was still turning (it grips from 17 degrees).
  let tSpeed = -1;
  r.run(0.6, (x) => x.disk((e) => e.ev === 'ready').length > 0, (s) => { if (tSpeed < 0 && d.wd > 0.99 * d.wh) tSpeed = s.t; });
  const ready = r.disk((e) => e.ev === 'ready');
  assert.equal(ready.length, 1);
  assert.deepEqual({ drive: ready[0].drive, mediaId: ready[0].mediaId, type: ready[0].type }, { drive: 1, mediaId: 'WORK01', type: '2D' });
  assert.ok(tSpeed > 0 && tSpeed - tSwitch < 0.3, `up to speed ${tSpeed - tSwitch} s after the switch`);
  const dt = ready[0].t - tSwitch;
  assert.ok(dt > D.adapter.minPeriod && dt < 0.6, `ready ${dt} s after the lever closed`);
  assert.deepEqual(sim.diskStatus(1), { ready: true, type: '2D', mediaId: 'WORK01' });
  assert.ok(Math.abs(d.wd - d.wh) < 1e-3);
});

test('a closed lever traps the diskette, and opening it makes the drive not ready at once', () => {
  const sim = fresh({ drives: [null, WORK] }), r = new Run(sim), mech = sim.diskette, d = mech.drives[1];
  const g = sim.grab('disketteSlide', 1, { target: -0.05 });
  r.run(0.3);
  assert.ok(d.s > mech.trap - 1e-3, `held at ${d.s}`);
  sim.release(g);
  r.run(0.3);
  assert.ok(sim.diskCtl.status(1).ready, 'still ready');
  let tOpen = -1;
  const l = sim.grab('lever', 1, { target: -0.1 });
  r.run(0.3, null, (s) => { if (tOpen < 0 && !s.diskette.leverClosed(1)) tOpen = s.t; });
  sim.release(l);
  const nr = r.disk((e) => e.ev === 'notReady');
  assert.equal(nr.length, 1);
  assert.ok(Math.abs(nr[0].t - tOpen) < 1e-4, 'not ready as the switch opens');
  assert.ok(d.a < 0.01 && d.N === 0, 'open, the collet off the diskette');
  assert.ok(d.wd < 0.2 * d.wh, `the diskette runs down in its jacket: ${d.wd}`);
  // Now it slides out.
  const o = sim.grab('disketteSlide', 1, { target: -0.01 });
  r.run(1);
  sim.release(o);
  assert.ok(d.s < D.slide.leverPlane);
  sim.command({ dev: 'disk', op: 'media', drive: 1, mediaId: null });
  assert.equal(d.media, null);
});

test('a diskette turning too slowly is not ready', () => {
  const sim = fresh({ drives: [WORK, null] }), r = new Run(sim);
  r.run(0.4);
  assert.ok(sim.diskCtl.status(0).ready);
  sim.setParam('diskettes.belt.ratio', D.belt.ratio * 1.06);   // a slipping belt: 6 % slow
  r.run(1.5, (x) => x.disk((e) => e.ev === 'notReady').length > 0);
  const nr = r.disk((e) => e.ev === 'notReady');
  assert.equal(nr.length, 1);
  assert.ok(sim.diskette.drives[0].wd < 0.95 * 2 * Math.PI * 6);
});

// ---- timing against the analytic model (8.4) ----------------------------------------------------------------------

test('transfers complete when the analytic model says, within 4 ms, over 20 operations across seek lengths', () => {
  const sim = fresh({ drives: [null, WORK] }), r = new Run(sim), mech = sim.diskette, d = mech.drives[1];
  const m = MEDIA['2D'];
  // The model of devices/virtual.js, from the same start: after a recalibrate, on track 00 with the head lifted.
  r.op({ op: 'recalibrate', id: 100, drive: 1 });
  const model = { track: 0, known: true, headUntil: -1 };
  const tracks = [3, 3, 4, 6, 14, 34, 71, 74, 37, 0, 1, 76, 20, 21, 21, 9, 58, 60, 2, 45];   // 20 operations
  let rng = 7;
  const rand = () => ((rng = (rng * 16807) % 2147483647) / 2147483647);
  let worst = 0, id = 0;
  for (const track of tracks) {
    r.run(0.01 + 0.3 * rand());
    if (rand() < 0.2) r.run(2.2);                          // sometimes long enough for the head to lift
    const t0 = sim.t, turn0 = d.phi / (2 * Math.PI);
    // The model's moment the head is ready to read, then the latency from the diskette's angle at the command.
    let t = t0;
    if (!model.known) t += RECALIBRATE_S;
    t += seek(Math.abs(track - (model.known ? model.track : 0)));
    if (t > model.headUntil) t += DRIVE.headLoadS;
    const spt = sectorsPerTrack(m, track), count = 1 + Math.floor(rand() * 6);
    // A sector whose start is not within 8 ms of the head becoming ready either way (there the mechanism and the
    // model may honestly differ by a whole turn).
    let sector, lat;
    do {
      sector = 1 + Math.floor(rand() * (spt - count + 1));
      lat = latency(t - t0 + turn0 * ROT, sector, spt);
    } while (lat < 0.008 || lat > ROT - 0.008);
    const expected = t + lat + transfer(count, spt);
    const e = r.op({ op: 'transfer', id: ++id, drive: 1, side: id & 1, track, sector, count, write: !!(id % 3) });
    assert.ok(e && e.ok, `transfer ${id} completes`);
    const err = e.t - expected;
    worst = Math.max(worst, Math.abs(err));
    assert.ok(Math.abs(err) < 0.004, `track ${track} sector ${sector} x${count}: ${(err * 1e3).toFixed(2)} ms from the model (${((e.t - t0) * 1e3).toFixed(1)} ms)`);
    assert.ok(Math.abs(e.t - t0 - (expected - t0)) / (expected - t0) < 0.05);
    model.track = track; model.known = true; model.headUntil = e.t + DRIVE.headUnloadS;
    assert.equal(Math.round(mech.headTrack(1)), track);
  }
  assert.ok(worst > 0, 'times come from the mechanism');
});

test('the head loads in about the 40 ms the model assumes, and lifts after 2 s idle', () => {
  const sim = fresh({ drives: [WORK, null] }), r = new Run(sim), d = sim.diskette.drives[0];
  r.op({ op: 'recalibrate', id: 1, drive: 0 });
  assert.equal(d.coilCmd, 0);
  const t0 = sim.t;
  sim.command({ dev: 'disk', op: 'transfer', id: 2, drive: 0, side: 0, track: 0, sector: 1, count: 1 });
  let tRead = -1;
  r.run(0.6, (x) => !!x.done(2), (s) => { if (tRead < 0 && d.readable) tRead = s.t; });
  assert.ok(Math.abs(tRead - t0 - DRIVE.headLoadS) < 0.004, `readable ${tRead - t0} s after the solenoid`);
  assert.ok(r.ac.some((e) => e.type === WAC.HEAD_LAND && e.a === 0));
  const tDone = r.done(2).t;
  r.run(2.1);
  assert.equal(d.coilCmd, 0);
  assert.ok(d.y < 1e-5, 'lifted');
  assert.ok(sim.t - tDone > DRIVE.headUnloadS);
});

test('recalibrate runs the head back against the stop pin and leaves it on track 00', () => {
  const sim = fresh({ drives: [null, WORK] }), r = new Run(sim), mech = sim.diskette;
  r.op({ op: 'transfer', id: 1, drive: 1, side: 0, track: 40, sector: 1, count: 1 });
  assert.equal(Math.round(mech.headTrack(1)), 40);
  r.ac.length = 0;
  const t0 = sim.t;
  const e = r.op({ op: 'recalibrate', id: 2, drive: 1 });
  assert.ok(e.ok);
  const took = e.t - t0;
  assert.ok(took >= RECALIBRATE_S - 1e-4 && took <= RECALIBRATE_S + 3 * DRIVE.stepS + 1e-3, `recalibrate took ${took} s`);
  assert.ok(Math.abs(took / RECALIBRATE_S - 1) < 0.05);
  r.run(0.05);
  assert.ok(Math.abs(mech.headTrack(1)) < 0.05, `head at ${mech.headTrack(1)}`);
  assert.equal(sim.diskCtl.track(1), 0);
  // Forty steps past the stop: the pulley hits its pin again and again (the documented buzz).
  const hits = r.ac.filter((x) => x.type === WAC.HEAD_STOP && x.a === 1).length;
  assert.ok(hits >= 10, `${hits} hits on the stop`);
  // Track 00 reads: 26 sectors of 128 bytes.
  assert.ok(r.op({ op: 'transfer', id: 3, drive: 1, side: 0, track: 0, sector: 26, count: 1 }).ok);
});

test('a head that is not on the track it should be is found by its ID fields, recalibrated and retried', () => {
  const sim = fresh({ drives: [WORK, null] }), r = new Run(sim), st = sim.diskette.st[0];
  r.op({ op: 'transfer', id: 1, drive: 0, side: 0, track: 10, sector: 1, count: 1 });
  // A knock moves the carriage four tracks (one electrical turn), where the same phase holds it.
  st.th += 4 * st.step;
  r.run(0.1);
  assert.equal(Math.round(sim.diskette.headTrack(0)), 14);
  const t0 = sim.t;
  const e = r.op({ op: 'transfer', id: 2, drive: 0, side: 0, track: 12, sector: 3, count: 1 });
  assert.ok(e.ok, 'recovered');
  assert.ok(e.t - t0 > RECALIBRATE_S, 'after a recalibrate');
  assert.equal(Math.round(sim.diskette.headTrack(0)), 12);
});

test('opening the lever mid-transfer ends it with not ready', () => {
  const sim = fresh({ drives: [null, WORK] }), r = new Run(sim), d = sim.diskette.drives[1];
  r.op({ op: 'transfer', id: 1, drive: 1, side: 0, track: 2, sector: 1, count: 1 });
  sim.command({ dev: 'disk', op: 'transfer', id: 2, drive: 1, side: 1, track: 70, sector: 9, count: 4, write: true });
  r.run(0.15);
  assert.ok(!r.done(2), 'still seeking');
  let tOpen = -1;
  const l = sim.grab('lever', 1, { target: -0.1 });
  r.run(0.3, null, (s) => { if (tOpen < 0 && !s.diskette.leverClosed(1)) tOpen = s.t; });
  sim.release(l);
  const e = r.done(2);
  assert.ok(e && !e.ok && e.error === 'notReady');
  assert.ok(Math.abs(e.t - tOpen) < 1e-4);
  assert.equal(r.disk((x) => x.ev === 'notReady').length, 1);
  r.run(0.1);
  assert.ok(d.y < 1e-5, 'the bail lifts the head');
  // Further commands answer not ready.
  const t1 = sim.t, f = r.op({ op: 'transfer', id: 3, drive: 1, side: 0, track: 70, sector: 1, count: 1 });
  assert.equal(f.error, 'notReady');
  assert.ok(Math.abs(f.t - t1 - 2 * ROT) < 1e-3);
});

test('one adapter serves both drives, one operation at a time', () => {
  const sim = fresh({ drives: [WORK, { mediaId: 'PROG', type: '2D' }] }), r = new Run(sim);
  sim.command({ dev: 'disk', op: 'recalibrate', id: 1, drive: 0 });
  sim.command({ dev: 'disk', op: 'recalibrate', id: 2, drive: 1 });
  r.run(1.2, () => !!r.done(2));
  const a = r.done(1), b = r.done(2);
  assert.ok(a.ok && b.ok);
  assert.ok(b.t - a.t >= RECALIBRATE_S - 1e-4, 'the second waited for the first');
});

// ---- the rules -----------------------------------------------------------------------------------------------------

test('no controller writes a mechanical state: it only commands drives and reads sensors', async () => {
  const sim = fresh(), r = new Run(sim), ctl = sim.diskCtl;
  const drives = new Set(['setHead', 'setHeadLoad']);
  const sensors = new Set(['leverClosed', 'mediaType', 'indexHole']);
  assert.ok(Object.isFrozen(ctl.io), 'io is frozen');
  assert.deepEqual(new Set(Object.keys(ctl.io)), new Set([...drives, ...sensors]));
  const used = new Set();
  ctl.io = new Proxy(ctl.io, {
    get: (o, k) => { used.add(k); return o[k]; },
    set: () => { throw new Error('the controller wrote to io'); },
  });
  insertAndClose(r, 0);
  r.run(0.6, (x) => x.disk((e) => e.ev === 'ready').length > 0);
  assert.ok(r.op({ op: 'transfer', id: 1, drive: 0, side: 0, track: 30, sector: 4, count: 2 }).ok);
  sim.command({ dev: 'disk', op: 'transfer', id: 2, drive: 0, side: 0, track: 2, sector: 4, count: 2 });
  const l = sim.grab('lever', 0, { target: -0.1 });
  r.run(0.3);
  sim.release(l);
  assert.equal(r.done(2).error, 'notReady');
  for (const k of used) assert.ok(drives.has(k) || sensors.has(k), `io.${k}`);
  const src = await readFile(new URL('../src/sim/wp/diskette-ctl.js', import.meta.url), 'utf8');
  assert.ok(!/^import /m.test(src), 'diskette-ctl.js imports nothing');
  assert.ok(!/\b(mech|diskette|drives?\[\w+\]|st\[\w+\])\.(a|av|s|sv|y|yv|wd|wm|wh|phi|th|w|N|z)\b\s*=/.test(src), 'no position or speed assignment');
  // And the mechanism's sector timing knows no sector bytes.
  const mech = await readFile(new URL('../src/sim/wp/diskette-mech.js', import.meta.url), 'utf8');
  assert.ok(!/\.bytes\b|Uint8Array|readSector|writeSector|sectorView|disk\//.test(mech), 'no data in the mechanism');
});

// ---- state transfer, host ---------------------------------------------------------------------------------------

test('export and import mid-transfer continues identically', () => {
  const a = fresh({ drives: [WORK, null] }), ra = new Run(a);
  ra.op({ op: 'transfer', id: 1, drive: 0, side: 0, track: 5, sector: 1, count: 1 });
  a.command({ dev: 'disk', op: 'transfer', id: 2, drive: 0, side: 1, track: 50, sector: 17, count: 5, write: true });
  ra.run(0.12);
  const b = fresh({ drives: [WORK, null] }), rb = new Run(b);
  b.importState(structuredClone(a.exportState()));
  ra.run(0.8, () => !!ra.done(2));
  rb.run(0.8, () => !!rb.done(2));
  assert.ok(ra.done(2).ok);
  assert.equal(rb.done(2).t, ra.done(2).t);
  const da = a.diskette.drives[0], db = b.diskette.drives[0];
  for (const k of ['phi', 'wd', 'wm', 'y', 'a', 's']) assert.equal(db[k], da[k], k);
  assert.equal(b.diskette.headTrack(0), a.diskette.headTrack(0));
});

test('the client carries disk commands and their completions', async () => {
  const machine = structuredClone(wordproc1980), geometry = geometryFor(machine);
  const client = await createSimClient({ machine, geometry, autoRun: false });
  const device = [];
  client.on('device', (e) => device.push(e));
  client.command({ dev: 'disk', op: 'recalibrate', id: 9, drive: 0 });
  client.advance(0.5);
  const e = device.find((x) => x.dev === 'disk' && x.id === 9);
  assert.ok(e && !e.ok && e.error === 'notReady', 'an empty drive is not ready');
  assert.ok(Number.isInteger(client.layout.headTrack));
});
